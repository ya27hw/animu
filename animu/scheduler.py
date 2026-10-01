import copy
import os
import signal
import threading
import time
import traceback
from dataclasses import dataclass, field
from datetime import datetime
from typing import List, Dict, Any, Optional

from .config import get_config
from .database import db, DatabaseUnavailable
from .models import OfflineAnime
from .anilist import anilist
from .nyaa import nyaa, safe_int, SearchUnavailable
from .qbittorrent import qbit
from .discord import alert_user, alert_unresolved_anime, clear_alert_history, send_anime_downloaded_hook
from .utils import fix_anime_season, count_past_relations, get_explicit_season
from .history import history_manager
from .ignored import ignored_manager
from .prefs import get_requirements, prefers_japanese_dub
from .airschedule import aired_episodes
from . import readiness

try:  # advisory cross-process cycle lock (POSIX only)
    import fcntl
except ImportError:  # pragma: no cover - Windows
    fcntl = None

# Fields each writer owns. ``db.upsert(..., fields=...)`` merges only these into
# the stored record, so the scheduler (which holds a record for minutes) can
# no longer overwrite what the user edited in the web UI in the meantime.
F_PROGRESS = ("downloaded_episodes",)
F_BACKOFF = ("timeouts", "max_timeouts", "next_attempt_at")
F_TITLE = ("alternative_title", "starting_episode")
F_REWATCH = ("pending_rewatching_update",)

# Pause between anime so Nyaa/AniList are not hammered.
THROTTLE_SECONDS = 2.0
# Alternative-title search: how many title variants one anime may try.
MAX_TITLE_COMBINATIONS = 8
# A missing episode that aired this recently is "not uploaded yet", not "not
# found": retry quickly without escalating back-off or counting a failure.
FRESH_RELEASE_HOURS = 6.0
FRESH_RETRY_MINUTES = 10
# Never wake the loop more often than this, however many retries are pending.
MIN_CYCLE_GAP_SECONDS = 300
# After this many consecutive failures against one dependency the rest of the
# cycle is abandoned (and nothing is blamed on the individual anime).
SERVICE_FAILURE_LIMIT = 3
# qBittorrent states that mean "the torrent is there but broken".
QBIT_BAD_STATES = ("missingFiles", "error")


class CycleAborted(RuntimeError):
    """The whole cycle could not run (dependency down / data unavailable)."""


class ServiceDown(Exception):
    """A dependency failed repeatedly; stop processing further anime."""

    def __init__(self, service: str):
        super().__init__(f"{service} appears to be unavailable")
        self.service = service


@dataclass
class CycleResult:
    """Summary of one scheduler cycle (exposed through /api/health and the UI)."""
    started_at: float = field(default_factory=time.time)
    duration: float = 0.0
    total: int = 0
    ignored: int = 0
    backing_off: int = 0
    up_to_date: int = 0
    queued: int = 0
    downloaded_episodes: int = 0
    not_found: int = 0
    search_errors: int = 0
    failed: List[Dict[str, str]] = field(default_factory=list)
    aborted: Optional[str] = None
    anilist_stale_seconds: Optional[float] = None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "started_at": datetime.fromtimestamp(self.started_at).astimezone().isoformat(),
            "duration_seconds": round(self.duration, 1),
            "total": self.total,
            "ignored": self.ignored,
            "backing_off": self.backing_off,
            "up_to_date": self.up_to_date,
            "queued": self.queued,
            "downloaded_episodes": self.downloaded_episodes,
            "not_found": self.not_found,
            "search_errors": self.search_errors,
            "failed": list(self.failed),
            "aborted": self.aborted,
            "anilist_stale_seconds": self.anilist_stale_seconds,
        }


class Scheduler:
    def __init__(self):
        self.is_running = False
        self._cycle_lock = threading.Lock()
        self._stop = threading.Event()
        self._wake = threading.Event()
        self._manual_requested = False
        self._loop_active = False
        self._last_start = 0.0
        self._earliest_retry: Optional[float] = None
        # Media ids on the current watching list (not ignored): only these may
        # pull the loop awake at their air time.
        self._watched_ids: set = set()
        self._qbit_failures = 0
        self._nyaa_failures = 0
        self.last_result: Optional[CycleResult] = None
        # media_id -> {"status", "detail", "at"} for the UI; updated as each anime is handled.
        self.anime_state: Dict[int, Dict[str, Any]] = {}

    # ------------------------------------------------------------------ timing

    def get_cycle_interval(self, now: time.struct_time | None = None) -> int:
        """Return the effective cycle interval in minutes based on peak/off-peak."""
        current = now or time.localtime()
        hour = current.tm_hour
        is_peak = (hour >= 12 or hour <= 4)
        config = get_config()
        interval = config.interval if is_peak else config.offpeak_interval
        return interval or 30

    def get_cycle_interval_seconds(self, now: time.struct_time | None = None) -> int:
        """Return the effective cycle interval in seconds."""
        return self.get_cycle_interval(now) * 60

    def initialize(self) -> None:
        """Mark scheduler initialization without performing network work."""
        readiness.reconcile_threshold(self.get_cycle_interval_seconds())
        readiness.mark_scheduler_initialized()

    def stop(self) -> None:
        """Ask the loop (and any running cycle) to finish up and exit."""
        self._stop.set()
        self._wake.set()

    def request_run(self) -> bool:
        """Start a cycle now (manual trigger). False if one is already running."""
        if self._cycle_lock.locked():
            return False
        if self._loop_active:
            self._manual_requested = True
            self._wake.set()
        else:
            threading.Thread(target=self._run_cycle, daemon=True, name="manual-cycle").start()
        return True

    def _set_state(self, media_id: int, status: str, detail: str = "") -> None:
        self.anime_state[media_id] = {"status": status, "detail": detail, "at": time.time()}

    # ------------------------------------------------------------------- cycle

    def _acquire_process_lock(self):
        """Hold an advisory file lock for the cycle so a second process
        (e.g. ``main.py --once`` beside the service) cannot run concurrently."""
        if fcntl is None:
            return None
        try:
            root = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
            os.makedirs(os.path.join(root, "logs"), exist_ok=True)
            handle = open(os.path.join(root, "logs", "animu-cycle.lock"), "w")
        except OSError:
            return None
        try:
            fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            handle.close()
            raise CycleAborted("another Animu process is already running a cycle")
        return handle

    def _run_cycle(self) -> None:
        if not self._cycle_lock.acquire(blocking=False):
            print("A scheduler cycle is already running; skipping this trigger.")
            return
        self.is_running = True
        lock_handle = None
        try:
            try:
                lock_handle = self._acquire_process_lock()
            except CycleAborted as exc:
                # Not a failure of this process: another one is mid-cycle.
                print(f"Skipping cycle: {exc}")
                return
            readiness.reconcile_threshold(self.get_cycle_interval_seconds())
            readiness.mark_cycle_started()
            readiness.set_next_run_at(None)
            readiness.record_event("info", "Cycle started")
            try:
                result = self.check()
            except Exception as exc:
                readiness.mark_cycle_completed(success=False, error=exc)
                readiness.record_event("error", f"Cycle failed: {exc}")
                raise
            else:
                readiness.mark_cycle_stats(result.to_dict())
                readiness.mark_cycle_completed(success=True, degraded=bool(result.failed))
                readiness.record_event(
                    "info",
                    f"Cycle finished in {result.duration:.0f}s: "
                    f"{result.downloaded_episodes} episode(s) downloaded, "
                    f"{len(result.failed)} failed, {result.backing_off} backing off",
                )
        finally:
            if lock_handle is not None:
                try:
                    lock_handle.close()
                except OSError:
                    pass
            self.is_running = False
            self._cycle_lock.release()

    # ---------------------------------------------------------------- retries

    def _episode_is_fresh(self, anime: Dict[str, Any], episode: int) -> bool:
        """True when ``episode`` aired so recently that a miss is expected.

        AniList only exposes the *next* airing; the previous episode aired one
        interval earlier (weekly assumption), which is good enough to tell
        "uploaded minutes ago" from "genuinely absent".
        """
        next_ep = (anime.get("media") or {}).get("nextAiringEpisode") or {}
        try:
            if int(next_ep.get("episode")) - 1 != int(episode):
                return False
            until = float(next_ep.get("timeUntilAiring"))
        except (TypeError, ValueError):
            return False
        aired_ago = 7 * 86400 - until
        return 0 <= aired_ago <= FRESH_RELEASE_HOURS * 3600

    def _schedule_retry(self, anime: Dict[str, Any], record: OfflineAnime, missing: List[int]) -> int:
        """Back off after a miss; returns the minutes until the next attempt."""
        interval = self.get_cycle_interval()
        first_missing = min(missing) if missing else None
        if first_missing is not None and self._episode_is_fresh(anime, first_missing):
            # Not uploaded yet: poll soon, don't escalate, don't count a failure.
            minutes = min(interval, FRESH_RETRY_MINUTES)
            record.set_timeout_until(minutes * 60)
            return minutes
        record.set_timeout(interval)
        return max(1, round((record.next_attempt_at - time.time()) / 60))

    # ---------------------------------------------------------------- download

    def _credit(self, anime: Dict[str, Any], record: OfflineAnime, episodes: List[int]) -> None:
        """Record episodes as downloaded and persist immediately.

        Persisting per torrent (not once after the whole loop) means a crash,
        restart or later exception can no longer make the next cycle add the
        same torrents again.
        """
        if not episodes:
            return
        record.downloaded_episodes = sorted(set(record.downloaded_episodes) | set(episodes))
        db.upsert(anime["mediaId"], record, fields=F_PROGRESS)

    def download_torrents(self, anime: Dict[str, Any], record: OfflineAnime, torrents: List[Dict[str, Any]]) -> Optional[List[int]]:
        """Download torrents via qBittorrent, send success embeds and save to DB."""
        newly_downloaded: List[int] = []
        fresh_torrents = []
        use_proxy_download = nyaa.should_use_proxy_download(anime)
        romaji_title = anime["media"]["title"]["romaji"]
        cover = anime["media"].get("coverImage") or {}
        cover_large = cover.get("extraLarge") or cover.get("large") or cover.get("medium") or ""

        for torrent in torrents:
            episode = torrent.get("episode")
            link = torrent["link"]
            title = torrent["title"]

            # Episodes this torrent stands for. A batch only credits the
            # episodes it explicitly covers; with no stated range it is a
            # complete pack of a finished show.
            if episode is not None:
                covers = [episode]
            else:
                batch_eps = torrent.get("batch_episodes")
                total_episodes = anime["media"].get("episodes") or 1
                covers = list(batch_eps) if isinstance(batch_eps, list) and batch_eps else list(range(1, total_episodes + 1))

            # Outcome flags are per add; clear anything left from a previous one.
            qbit.last_add_existing = None
            qbit.last_add_was_duplicate = False

            # Add and check torrent
            success = qbit.add_check_torrent(
                link=link,
                title=romaji_title,
                episode=episode,
                use_proxy_download=use_proxy_download
            )

            if not success:
                existing = getattr(qbit, "last_add_existing", None)
                if isinstance(existing, dict) and existing.get("state") not in QBIT_BAD_STATES:
                    # Already in qBittorrent (queued / at 0% / metadata): the
                    # download exists, this is not a failed add.
                    print(f"Torrent already in qBittorrent ({existing.get('state') or 'unknown state'}), "
                          f"marking {romaji_title} episode {episode} as downloaded.")
                    self._credit(anime, record, covers)
                    newly_downloaded.extend(covers)
                    continue
                # If the episode already exists in qBittorrent (e.g. a
                # previously downloaded episode the offline DB does not
                # list), count it as downloaded and continue instead of
                # failing the whole anime.
                if episode is not None and qbit.check_torrent_episode(romaji_title, episode):
                    print(f"Torrent already in qBittorrent, marking {romaji_title} episode {episode} as downloaded.")
                    self._credit(anime, record, covers)
                    newly_downloaded.extend(covers)
                    continue
                # Progress already verified in this pass was persisted above.
                self._qbit_failures += 1
                record.set_timeout(self.get_cycle_interval())
                db.upsert(anime["mediaId"], record, fields=F_BACKOFF)
                alert_user(romaji_title, cover_large)
                if self._qbit_failures >= SERVICE_FAILURE_LIMIT:
                    raise ServiceDown("qBittorrent")
                return None

            self._qbit_failures = 0

            if qbit.last_add_was_duplicate is True:
                self._credit(anime, record, covers)
                newly_downloaded.extend(covers)
                print(f"Already present in qBittorrent: {title} - {episode}")
                continue

            self._credit(anime, record, covers)
            newly_downloaded.extend(covers)
            fresh_torrents.append(torrent)
            print(f"Downloading: {title} (Episode: {episode})")

            # Record history entry
            history_manager.add_entry(
                title=title,
                link=link,
                anime_title=romaji_title,
                episode=episode,
                size=torrent.get("nyaa:size") or torrent.get("size") or "Unknown",
                seeders=torrent.get("nyaa:seeders") or torrent.get("seeders") or "N/A",
                cover_image=cover.get("extraLarge") or cover.get("medium"),
                source="auto"
            )

        # Progress was already persisted per torrent by _credit(); back-off is
        # cleared by the caller only once nothing in the window is still missing.
        record.downloaded_episodes = sorted(set(record.downloaded_episodes) | set(newly_downloaded))

        if not fresh_torrents:
            return newly_downloaded

        # Calculate discord embed details
        cover_color_str = cover.get("color")
        color = 0x0997e3
        if cover_color_str:
            try:
                color = int(cover_color_str.replace("#", "0x"), 16)
            except ValueError:
                pass

        episodes_str = ", ".join(map(str, newly_downloaded))
        sizes_str = ", ".join(t.get("nyaa:size", "Unknown") for t in fresh_torrents)
        seeders_str = ", ".join(t.get("nyaa:seeders", "0") for t in fresh_torrents)

        try:
            send_anime_downloaded_hook(
                f"**{romaji_title}** is downloading!",
                color,
                cover_large,
                {"name": "Title ID", "value": str(anime["mediaId"])},
                {"name": "Episode(s)", "value": episodes_str},
                {"name": "Size", "value": sizes_str},
                {"name": "Seeders", "value": seeders_str},
                {"name": "Title", "value": fresh_torrents[0]["title"]}
            )
        except Exception as exc:
            # The torrents are added and persisted; a webhook problem must not
            # turn that into a failed anime.
            print(f"Discord download hook failed: {exc}")

        return newly_downloaded

    def should_set_anime_to_rewatching(self, anime: Dict[str, Any], downloaded: List[int]) -> bool:
        """Helper to determine if anime is complete and should be set to rewatching."""
        config = get_config()
        total_episodes = anime["media"].get("episodes") or 0
        downloaded_count = len(set(downloaded))

        return (
            bool(config.set_completed_to_rewatching) and
            anime["media"].get("status") == "FINISHED" and
            total_episodes > 0 and
            downloaded_count >= total_episodes
        )

    def sync_anime_rewatching_status(self, anime: Dict[str, Any], record: OfflineAnime) -> None:
        """Sets AniList collection entry status to REPEATING if completed."""
        if not self.should_set_anime_to_rewatching(anime, record.downloaded_episodes):
            return

        record.pending_rewatching_update = True
        db.upsert(anime["mediaId"], record, fields=F_REWATCH)

        print(f"Downloaded all episodes for {anime['media']['title']['romaji']}. Setting to rewatching...")
        try:
            success = anilist.set_anime_to_rewatching(anime["mediaId"])
            if success:
                record.pending_rewatching_update = False
                db.upsert(anime["mediaId"], record, fields=F_REWATCH)
            else:
                print(f"Failed to set {anime['media']['title']['romaji']} to rewatching on AniList.")
        except Exception as e:
            print(f"Failed to set {anime['media']['title']['romaji']} to rewatching: {e}")

    # ----------------------------------------------------------------- search

    def _note_search_ok(self) -> None:
        self._nyaa_failures = 0

    def _note_search_unavailable(self, title: str, exc: Exception) -> None:
        """A search failed for infrastructure reasons: log it, do not back off."""
        self._nyaa_failures += 1
        print(f"[SEARCH_UNAVAILABLE] {title}: {exc}")
        readiness.record_event("warning", f"Search unavailable for {title}: {exc}")
        if self._nyaa_failures >= SERVICE_FAILURE_LIMIT:
            raise ServiceDown("Nyaa/AniList search")

    def handle_anime(self, anime: Dict[str, Any], record: OfflineAnime) -> None:
        """Handle Nyaa search combinations and download matching torrents for an anime."""
        anime = copy.deepcopy(anime)
        config = get_config()
        media_id = anime["mediaId"]
        starting_episode = record.starting_episode
        original_romaji = anime["media"]["title"]["romaji"]
        alternative_title = record.alternative_title or original_romaji

        # Per-anime release requirements (Japanese audio / English subtitles).
        # Resolved once per anime and applied to every search this method makes,
        # so the whole point of the store is not lost in the alt-title fallback.
        _requirements = get_requirements(media_id)
        search_kwargs = {
            "prefer_japanese_dub": prefers_japanese_dub(media_id),
            "require_japanese_audio": _requirements["require_japanese_audio"],
            "require_english_subs": _requirements["require_english_subs"],
        }
        if any(search_kwargs.values()):
            print(f"[AUDIO] {alternative_title}: release requirements {search_kwargs}")

        # Stored alternative titles sometimes drop the season marker (e.g.
        # "Mairimashita! Iruma-kun" for the 4th season). Season-conflict
        # verification then assumes Season 1 and rejects every later-season
        # release. If the canonical AniList title carries a season > 1 that
        # get_explicit_season cannot see (bare trailing digit), append the
        # S{n} token so verification accepts the correct releases. Shows whose
        # title already carries an explicit season marker (e.g. "2nd Season")
        # are left untouched, since their releases use absolute numbering
        # without a season token.
        if (record.alternative_title
                and get_explicit_season(alternative_title) is None
                and get_explicit_season(original_romaji) is None):
            fx = fix_anime_season(original_romaji)
            if fx["seasonCount"] > 1:
                alternative_title = f"{alternative_title} S{fx['seasonCount']}"

        # Override title dynamically (on deep copy — never mutate the shared
        # anime dict returned by AniList, which callers may reuse)
        anime["media"]["title"] = dict(anime["media"]["title"])
        anime["media"]["title"]["romaji"] = alternative_title

        start_episode = anime["progress"]

        end_episode = aired_episodes(anime)

        if end_episode <= start_episode:
            return

        # Check if already up to date
        anime_progress = list(range(start_episode + 1, end_episode + 1))
        is_up_to_date = all(ep in record.downloaded_episodes for ep in anime_progress)

        if is_up_to_date:
            self._clear_failure_state(anime, record)
            if record.pending_rewatching_update:
                self.sync_anime_rewatching_status(anime, record)
            from .nyaa import remove_failed_trace
            remove_failed_trace(media_id)
            clear_alert_history(media_id)
            self._set_state(media_id, "up_to_date")
            return

        # AniList prequel chain (cached for 24 h). None means AniList could not
        # be reached: fall back to "season 1, no offset" for this pass.
        relations = count_past_relations(media_id)
        if relations is None:
            print(f"[RELATIONS] could not resolve prequels for {alternative_title}; assuming season 1")
            relations = {"episodeOffset": 0, "seasonCount": 1}

        # Batch reconciliation: the anime may already be fully downloaded as a
        # complete season/batch torrent (e.g. 'Season 01-02' full-pack) even
        # though the offline DB lists no episodes. Search the file lists of
        # completed matching qBittorrent torrents and credit the episodes that
        # are genuinely present, so an already-downloaded anime is marked
        # "added" instead of looping through failed per-episode searches.
        try:
            batch_season = relations.get("seasonCount", 1)
            present_eps = qbit.check_episodes_in_batch(
                alternative_title, list(anime_progress), season=batch_season
            )
            if present_eps:
                new_eps = [ep for ep in present_eps if ep not in record.downloaded_episodes]
                if new_eps:
                    self._credit(anime, record, new_eps)
                    print(
                        f"Reconciled {len(new_eps)} already-downloaded episode(s) "
                        f"({new_eps}) for {alternative_title} from qBittorrent batch."
                    )
                if all(ep in record.downloaded_episodes for ep in anime_progress):
                    self._clear_failure_state(anime, record)
                    if record.pending_rewatching_update:
                        self.sync_anime_rewatching_status(anime, record)
                    self._set_state(media_id, "up_to_date", "found in an existing batch")
                    return
        except Exception as e:
            print(f"Batch reconciliation failed for {alternative_title}: {e}")

        # Search default title. An infrastructure failure here is not "no
        # release": skip the anime for now without touching its back-off.
        try:
            primary_torrent = nyaa.get_torrents(
                anime=anime,
                start_episode=start_episode,
                end_episode=end_episode,
                starting_episode=starting_episode,
                downloaded_episodes=record.downloaded_episodes,
                **search_kwargs,
            )
            self._note_search_ok()
        except SearchUnavailable as exc:
            self._note_search_unavailable(alternative_title, exc)
            self._set_state(media_id, "search_error", str(exc))
            return

        primary_seed_count = 0
        if primary_torrent:
            primary_seed_count = sum(safe_int(t.get("nyaa:seeders", 0)) for t in primary_torrent)

        # Alternative title search logic if not overridden and has no downloaded episodes
        if not record.alternative_title and not record.downloaded_episodes:
            ex3 = fix_anime_season(anime["media"]["title"]["romaji"])
            ex2 = relations

            romaji = anime["media"]["title"]["romaji"]
            english = anime["media"]["title"].get("english")

            possible_combinations = [
                {"title": ex3["title"], "episode_offset": 0}
            ]

            if english:
                possible_combinations.append({"title": english, "episode_offset": 0})

            # Handle multi-season title variations (S2, Season 2, 2nd Season, II, III)
            season_num = ex3.get("seasonCount", 1)
            if season_num == 1 and ex2["seasonCount"] > 1:
                season_num = ex2["seasonCount"]

            if season_num > 1:
                roman_map = {2: "II", 3: "III", 4: "IV", 5: "V"}
                roman = roman_map.get(season_num, "")

                titles_to_expand = [ex3["title"]]
                if english:
                    eng_season = fix_anime_season(english)
                    titles_to_expand.append(eng_season["title"])

                for base in titles_to_expand:
                    possible_combinations.extend([
                        {"title": f"{base} S{season_num}", "episode_offset": ex2["episodeOffset"]},
                        {"title": f"{base} S{season_num}", "episode_offset": 0},
                        {"title": f"{base} Season {season_num}", "episode_offset": 0},
                    ])
                    if roman:
                        possible_combinations.append({"title": f"{base} {roman}", "episode_offset": 0})

            synonyms = anime["media"].get("synonyms") or []
            for synonym in synonyms:
                if synonym.lower() != romaji.lower():
                    possible_combinations.append({"title": synonym, "episode_offset": 0})

            short_name = romaji.split(":")[0]
            if short_name != romaji:
                possible_combinations.insert(0, {"title": short_name, "episode_offset": 0})

            # Filter duplicates
            seen = set()
            unique_combinations = []
            for combo in possible_combinations:
                key = (combo["title"].lower(), combo["episode_offset"])
                if key not in seen:
                    seen.add(key)
                    unique_combinations.append(combo)
            # Bound the work: every variant costs a Nyaa query per missing episode.
            unique_combinations = unique_combinations[:MAX_TITLE_COMBINATIONS]

            print(f"Attempting combinations for {anime['media']['title']['romaji']} -> {[c['title'] for c in unique_combinations]}")

            best_combo = None
            best_combo_torrent = None
            best_seed_count = primary_seed_count

            # Evaluate combinations sequentially
            for combo in unique_combinations:
                time.sleep(THROTTLE_SECONDS)
                try:
                    result = nyaa.get_torrents(
                        anime=anime,
                        start_episode=start_episode,
                        end_episode=end_episode,
                        starting_episode=starting_episode + combo["episode_offset"],
                        downloaded_episodes=record.downloaded_episodes,
                        alt_anime_title=combo["title"],
                        **search_kwargs,
                    )
                    seed_count = sum(safe_int(t.get("nyaa:seeders", 0)) for t in result) if result else 0
                    if seed_count > best_seed_count:
                        best_seed_count = seed_count
                        best_combo = combo
                        best_combo_torrent = result
                except SearchUnavailable as e:
                    # The same upstream is down for every remaining variant.
                    print(f"Combo search unavailable for {combo['title']}: {e}")
                    break
                except Exception as e:
                    print(f"Combo search error for {combo['title']}: {e}")

            if best_combo and best_seed_count > primary_seed_count:
                primary_torrent = best_combo_torrent
                anime["media"]["title"] = dict(anime["media"]["title"])
                anime["media"]["title"]["romaji"] = best_combo["title"]
                record.alternative_title = best_combo["title"]
                record.starting_episode = best_combo["episode_offset"]
                db.upsert(media_id, record, fields=F_TITLE)

                # Recalculate range based on the new starting episode
                starting_episode = best_combo["episode_offset"]
                start_episode = anime["progress"]
                end_episode = aired_episodes(anime)

        if primary_torrent:
            newly_downloaded = self.download_torrents(anime, record, primary_torrent)
            if newly_downloaded:
                self.sync_anime_rewatching_status(anime, record)
                self._set_state(media_id, "downloaded", f"episode(s) {', '.join(map(str, newly_downloaded))}")

            # Anything in the window still missing (found only some episodes)
            # backs off like a miss; a complete pass clears the failure state.
            remaining = [ep for ep in range(start_episode + 1, end_episode + 1)
                         if ep not in record.downloaded_episodes]
            if newly_downloaded is not None:
                if remaining:
                    self._schedule_retry(anime, record, remaining)
                    db.upsert(media_id, record, fields=F_BACKOFF)
                else:
                    record.reset_timeout()
                    db.upsert(media_id, record, fields=F_BACKOFF)
                    # Torrent found and downloaded successfully, remove any failure trace and alert history
                    from .nyaa import remove_failed_trace
                    remove_failed_trace(media_id)
                    clear_alert_history(media_id)
        else:
            self._handle_not_found(anime, record, start_episode, end_episode, config)

    def _handle_not_found(self, anime: Dict[str, Any], record: OfflineAnime,
                          start_episode: int, end_episode: int, config) -> None:
        """Nothing matched on Nyaa: back off, trace, and alert at the threshold."""
        media_id = anime["mediaId"]
        missing = [ep for ep in range(start_episode + 1, end_episode + 1)
                   if ep not in record.downloaded_episodes]
        fresh = bool(missing) and self._episode_is_fresh(anime, min(missing))
        minutes = self._schedule_retry(anime, record, missing)
        db.upsert(media_id, record, fields=F_BACKOFF)

        # Store persistent trace for failed run
        from .nyaa import record_failed_trace
        record_failed_trace(media_id, anime=anime, record=record, status="NO_RESULTS")

        if fresh:
            # The episode only just aired; releases usually appear within hours.
            self._set_state(media_id, "waiting_release", f"episode {min(missing)} aired recently; retrying in {minutes} min")
            print(f"⏳ {anime['media']['title']['romaji']} episode {min(missing)} aired recently and "
                  f"is not on Nyaa yet. Retrying in {minutes} minutes.")
            return

        # Send deduplicated alert only once consecutive failure threshold is reached
        threshold = getattr(config, "discord_fail_threshold", 7) or 7
        if record.max_timeouts >= threshold:
            cover = anime.get("media", {}).get("coverImage") or {}
            alert_unresolved_anime(
                media_id=media_id,
                anime_title=anime["media"]["title"]["romaji"],
                image=cover.get("extraLarge") or "",
                reason=f"No matching torrents found on Nyaa.si (Backoff timeout {record.timeouts}/10)",
                season_info=f"Media ID {media_id}"
            )

        next_run = datetime.fromtimestamp(record.next_attempt_at)
        self._set_state(media_id, "not_found", f"retrying at {next_run.strftime('%H:%M')}")
        print(f"❌ Failed to find {anime['media']['title']['romaji']}. Next run in {minutes} minutes. "
              f"(At {next_run.strftime('%I:%M %p')})")

    def _clear_failure_state(self, anime: Dict[str, Any], record: OfflineAnime) -> None:
        """Forget old failures once the anime is up to date.

        Without this, a show that failed repeatedly and was later completed by
        other means kept its inflated failure count, so the *next* episode's
        first miss jumped straight to the maximum back-off.
        """
        if record.max_timeouts or record.timeouts or record.next_attempt_at:
            record.reset_timeout()
            db.upsert(anime["mediaId"], record, fields=F_BACKOFF)

    # -------------------------------------------------------------------- check

    def check(self) -> CycleResult:
        """Core check loop: queries AniList collection and checks missing episodes against database."""
        # Clear active traces for new run; failed_traces remains persistent for unresolved items
        from .nyaa import active_traces, failed_traces, remove_failed_trace
        active_traces.clear()

        result = CycleResult()
        self._qbit_failures = 0
        self._nyaa_failures = 0
        self._earliest_retry = None

        # Sync any unsynced offline local changes first
        try:
            db.sync_local_changes()
        except Exception as e:
            print(f"Local database sync failed: {e}")
            raise RuntimeError("local database sync failed") from e

        # Ask AniList for fresh data: the cached copy is usually the previous
        # cycle's, so a new episode would be noticed one whole cycle late.
        anime_list = anilist.get_anime_user_list(force_refresh=True)
        served = getattr(anilist.get_anime_user_list, "last_served", None)
        if isinstance(served, dict) and served.get("stale"):
            age = served.get("age")
            result.anilist_stale_seconds = age
            print(f"[WARNING] AniList unreachable; using cached watching list"
                  f"{f' ({age / 60:.0f} min old)' if isinstance(age, (int, float)) else ''}.")
            readiness.record_event("warning", "AniList unreachable; using cached watching list")
        if anime_list is None:
            print("[WARNING] AniList request failed and no cached list exists; skipping cycle to preserve local state.")
            raise CycleAborted("AniList unavailable")
        if not anime_list:
            print("No anime in watching list.")
            return self._finish(result)

        # Prune failed traces & alert history for anime no longer in watching list
        active_media_ids = {a["mediaId"] for a in anime_list}
        self._watched_ids = set(active_media_ids)
        stale_ids = [mid for mid in list(failed_traces.keys()) if mid not in active_media_ids]
        for mid in stale_ids:
            remove_failed_trace(mid)
            clear_alert_history(mid)

        # Load all records from PocketBase (or, if it is down, the local mirror)
        try:
            pb_records = db.get_all()
        except DatabaseUnavailable as exc:
            raise CycleAborted(f"database unavailable: {exc}") from exc
        degraded = getattr(db, "degraded", False) is True
        pb_map = {r.media_id: r for r in pb_records}

        # Build execution list
        execution_list = []
        interval = self.get_cycle_interval()
        now = time.time()

        for anime in anime_list:
            result.total += 1
            try:
                media_id = anime["mediaId"]
                title_info = (anime.get("media") or {}).get("title") or {}
                romaji_title = title_info["romaji"]
                english_title = title_info.get("english")
                synonyms = anime["media"].get("synonyms") or []

                if ignored_manager.is_ignored(romaji_title, media_id=media_id, english_title=english_title, synonyms=synonyms):
                    print(f"[IGNORED] {romaji_title} skipped")
                    result.ignored += 1
                    continue

                record = pb_map.get(media_id)

                print(f"[SYNC_STATE] {romaji_title} (ID {media_id}) "
                      f"downloaded_episodes={len(record.downloaded_episodes) if record else 0}, "
                      f"timeouts={record.timeouts if record else 0}")

                if not record:
                    if degraded:
                        # Cannot tell "new" from "missing because the lookup
                        # failed"; writing a blank record could overwrite real
                        # progress once PocketBase is back.
                        print(f"[WARNING] {romaji_title}: no local record and database is degraded; skipping this cycle.")
                        continue
                    record = OfflineAnime(media_id=media_id)
                    db.upsert(media_id, record)
                    pb_map[media_id] = record
                    execution_list.append((anime, record))
                    continue

                # Records written by older versions only carry a per-cycle
                # countdown; convert it to a point in time once.
                if record.timeouts > 0 and not record.next_attempt_at:
                    record.next_attempt_at = now + record.timeouts * interval * 60
                    db.upsert(media_id, record, fields=F_BACKOFF)

                if not record.is_due(now):
                    wait_min = max(1, round((record.next_attempt_at - now) / 60))
                    print(f"ℹ️ Next run for {romaji_title} in {wait_min} minutes")
                    result.backing_off += 1
                    self._set_state(media_id, "backoff", f"next attempt in {wait_min} min")
                    if self._earliest_retry is None or record.next_attempt_at < self._earliest_retry:
                        self._earliest_retry = record.next_attempt_at
                    continue

                # Compute airing status
                airing_episodes = aired_episodes(anime)

                if airing_episodes == 0:
                    continue

                start_episode = anime["progress"]

                # Check for missing episodes
                has_missing = any(ep not in record.downloaded_episodes
                                  for ep in range(start_episode + 1, airing_episodes + 1))

                if has_missing or record.pending_rewatching_update:
                    execution_list.append((anime, record))
                else:
                    result.up_to_date += 1
                    self._clear_failure_state(anime, record)
                    self._set_state(media_id, "up_to_date")
            except Exception as e:
                # One malformed entry (null media/title, bad progress…) must not
                # abort the cycle for every other anime.
                self._record_failure(result, anime, e)

        result.queued = len(execution_list)

        # Handle matches. One torrent-list snapshot is shared by every batch /
        # episode lookup in the pass instead of one full fetch per anime.
        with qbit.snapshot():
            for index, (anime, record) in enumerate(execution_list):
                if self._stop.is_set():
                    result.aborted = "stopped"
                    print("Stop requested; ending cycle early.")
                    break
                if index:
                    time.sleep(THROTTLE_SECONDS)  # Throttling between anime items
                before = len(record.downloaded_episodes)
                try:
                    self.handle_anime(anime, record)
                except ServiceDown as down:
                    result.aborted = f"{down.service} unavailable"
                    result.search_errors += 1
                    print(f"[ABORT] {down}; skipping the remaining {len(execution_list) - index - 1} anime this cycle.")
                    readiness.record_event("error", f"{down}; cycle cut short")
                    break
                except Exception as e:
                    self._record_failure(result, anime, e)
                else:
                    gained = len(record.downloaded_episodes) - before
                    if gained > 0:
                        result.downloaded_episodes += gained
                    state = self.anime_state.get(anime["mediaId"], {}).get("status")
                    if state == "not_found":
                        result.not_found += 1
                    elif state == "search_error":
                        result.search_errors += 1
                    # Remember when the earliest pending retry is due.
                    if record.next_attempt_at > time.time() and (
                            self._earliest_retry is None or record.next_attempt_at < self._earliest_retry):
                        self._earliest_retry = record.next_attempt_at

        return self._finish(result)

    def _record_failure(self, result: CycleResult, anime: Dict[str, Any], exc: Exception) -> None:
        title = ((anime.get("media") or {}).get("title") or {}).get("romaji") or str(anime.get("mediaId"))
        print(f"Error handling anime {title}: {exc}")
        print(traceback.format_exc())
        result.failed.append({"title": title, "error": f"{type(exc).__name__}: {exc}"})
        if isinstance(anime.get("mediaId"), int):
            self._set_state(anime["mediaId"], "error", str(exc))
        readiness.record_event("error", f"{title}: {type(exc).__name__}: {exc}")

    def _finish(self, result: CycleResult) -> CycleResult:
        result.duration = time.time() - result.started_at
        self.last_result = result
        return result

    # --------------------------------------------------------------------- loop

    def _next_airing_wake(self, now: float) -> Optional[float]:
        """Earliest cached air time (plus a short grace) that is still ahead."""
        try:
            from . import airschedule
            from datetime import timezone
            earliest = None
            for media_id, entry in airschedule._load_store().items():
                if str(media_id) not in {str(i) for i in self._watched_ids}:
                    continue
                try:
                    air_at = airschedule._parse_iso_utc(entry["air_at"]).timestamp() + 300
                except Exception:
                    continue
                if air_at > now and (earliest is None or air_at < earliest):
                    earliest = air_at
            return earliest
        except Exception:
            return None

    def _compute_next_run(self, now: float) -> float:
        """When the loop should next wake.

        One regular tick per interval, pulled earlier by (a) a pending retry
        and (b) the next known air time, so a new episode is searched for
        minutes after it airs rather than up to a whole interval later. Never
        sooner than ``MIN_CYCLE_GAP_SECONDS`` after the previous start.
        """
        interval = self.get_cycle_interval_seconds()
        candidate = self._last_start + interval
        for early in (self._earliest_retry, self._next_airing_wake(now)):
            if early is not None and now < early < candidate:
                candidate = early
        # The gap is measured from the end of the previous cycle too: when a
        # cycle overruns its interval, ``candidate`` is already in the past and
        # the next one would otherwise start immediately, back to back.
        return max(candidate, self._last_start + MIN_CYCLE_GAP_SECONDS, now + MIN_CYCLE_GAP_SECONDS)

    def _install_signal_handlers(self) -> None:
        def _handler(signum, _frame):
            print(f"Received signal {signum}; shutting down after the current step.")
            self.stop()
        try:
            signal.signal(signal.SIGTERM, _handler)
            signal.signal(signal.SIGINT, _handler)
        except ValueError:
            pass  # not the main thread (e.g. embedded in tests)

    def run_loop(self) -> None:
        """Run the scheduler loop: immediately at start-up, then on a monotonic
        cadence that adapts to peak/off-peak, retries and air times."""
        self.initialize()
        readiness.mark_scheduler_running(True)
        self._loop_active = True
        self._stop.clear()
        self._install_signal_handlers()
        print("Starting scheduler daemon loop...")
        next_run = time.time()
        try:
            while not self._stop.is_set():
                now = time.time()
                interval = self.get_cycle_interval_seconds()
                readiness.reconcile_threshold(interval)
                if self._manual_requested or now >= next_run:
                    self._manual_requested = False
                    self._wake.clear()
                    self._last_start = now
                    print(f"\n>>> Running scheduler at {time.strftime('%Y-%m-%d %H:%M:%S')} <<<")
                    try:
                        self._run_cycle()
                    except Exception as e:
                        print(f"Error during scheduled execution: {e}")
                        print(traceback.format_exc())
                    finished = time.time()
                    if finished - now > interval:
                        print(f"[WARNING] Cycle took {finished - now:.0f}s, longer than the {interval}s interval.")
                    next_run = self._compute_next_run(finished)
                    readiness.set_next_run_at(next_run)
                    print(f"Next cycle at {datetime.fromtimestamp(next_run).strftime('%H:%M:%S')}")
                    continue
                # Sleep in slices so interval/config changes and stop requests apply promptly.
                if self._wake.wait(timeout=max(0.0, min(next_run - now, 30.0))):
                    self._wake.clear()
                else:
                    # Interval may have changed (peak/off-peak, hot reload).
                    next_run = min(next_run, self._compute_next_run(time.time())) \
                        if self._last_start else next_run
        finally:
            self._loop_active = False
            readiness.set_next_run_at(None)
            readiness.mark_scheduler_running(False)

    def run_once(self) -> None:
        """Run scheduler check exactly once, then exit."""
        self.initialize()
        readiness.mark_scheduler_running(True)
        print("Running check cycle once...")
        try:
            self._run_cycle()
        except Exception as e:
            print(f"Error during check cycle: {e}")
        finally:
            readiness.mark_scheduler_running(False)

scheduler = Scheduler()
