"""Cached air schedule fallback for Animu when AniList is unreachable or stale.

Provides local extrapolation of episode air times based on the last recorded
`nextAiringEpisode` data received during healthy AniList fetches.
"""
from __future__ import annotations

import copy
import json
import math
import os
import threading
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Optional, Tuple, Union

from .storage import atomic_write_json

EPISODE_INTERVAL_DAYS: int = 7
RETENTION_DAYS: int = 60

DEFAULT_CACHE_DIR = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "logs", "cache")
)
DEFAULT_STORE_PATH = os.path.join(DEFAULT_CACHE_DIR, "air_schedule.json")
STORE_PATH = DEFAULT_STORE_PATH

_lock = threading.Lock()
_corrupt_logged_paths: set[str] = set()
# (path, mtime_ns, size) -> parsed store. The scheduler asks for the store
# several times per anime per cycle; re-parsing the JSON each time was pure
# overhead. Treat the returned dict as read-only (writers deep-copy first).
_store_cache: Optional[Tuple[Tuple[str, int, int], Dict[str, Any]]] = None


def _now_utc() -> datetime:
    """Return the current datetime in UTC."""
    return datetime.now(timezone.utc)


def _parse_iso_utc(val: Union[str, datetime]) -> datetime:
    """Parse an ISO-8601 string or normalize a datetime to UTC."""
    if isinstance(val, datetime):
        if val.tzinfo is None:
            return val.replace(tzinfo=timezone.utc)
        return val.astimezone(timezone.utc)
    s = str(val).strip()
    if s.endswith("Z"):
        s = s[:-1] + "+00:00"
    dt = datetime.fromisoformat(s)
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _store_signature(path: str) -> Optional[Tuple[str, int, int]]:
    try:
        st = os.stat(path)
    except OSError:
        return None
    return (path, st.st_mtime_ns, st.st_size)


def _load_store() -> Dict[str, Any]:
    """Load air schedule disk store. Tolerate missing or corrupt JSON.

    The parsed store is cached and revalidated against the file's
    mtime/size, so repeated reads cost one ``stat`` instead of a JSON parse.
    The returned dict must not be mutated; copy it first when writing.
    """
    global _store_cache
    path = STORE_PATH
    signature = _store_signature(path)
    if signature is None:
        _store_cache = None
        return {}
    cached = _store_cache
    if cached is not None and cached[0] == signature:
        return cached[1]
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        if isinstance(data, dict):
            _store_cache = (signature, data)
            return data
        raise ValueError(f"Root element in {path} is not a dictionary")
    except Exception as e:
        if path not in _corrupt_logged_paths:
            print(f"[WARNING] Corrupt air schedule store at {path}: {e}")
            _corrupt_logged_paths.add(path)
        return {}


def _save_store(store: Dict[str, Any]) -> None:
    """Persist air schedule store atomically using a temporary file."""
    global _store_cache
    path = STORE_PATH
    try:
        atomic_write_json(path, store)
        _corrupt_logged_paths.discard(path)
        signature = _store_signature(path)
        _store_cache = (signature, store) if signature else None
    except Exception as e:
        print(f"[ERROR] Failed to save air schedule store to {path}: {e}")


def get_anchor(media_id: Union[int, str]) -> Optional[Dict[str, Any]]:
    """Retrieve recorded air schedule anchor for a media ID."""
    with _lock:
        store = _load_store()
        return store.get(str(media_id))


def record_from_media_list(
    entries: Optional[List[Dict[str, Any]]],
    *,
    now: Optional[Union[datetime, int, float]] = None,
) -> int:
    """Record air schedule anchors from genuine AniList user list entries.

    Called on every real AniList fetch of the user list. For each entry with
    `media.nextAiringEpisode`, stores anchor keyed by `mediaId`.
    Only updates media present in the payload (never deletes others); prunes
    entries not updated for 60 days.
    """
    if not entries or not isinstance(entries, (list, tuple)):
        return 0

    if now is None:
        now_dt = _now_utc()
    elif isinstance(now, (int, float)):
        now_dt = datetime.fromtimestamp(now, tz=timezone.utc)
    else:
        now_dt = _parse_iso_utc(now)

    recorded_count = 0
    with _lock:
        original = _load_store()
        store = copy.deepcopy(original)

        # Prune entries not updated for 60 days
        for key, entry in list(store.items()):
            rec_str = entry.get("recorded_at")
            if rec_str:
                try:
                    rec_dt = _parse_iso_utc(rec_str)
                    if (now_dt - rec_dt).total_seconds() > RETENTION_DAYS * 86400:
                        del store[key]
                except Exception:
                    pass

        # Update media present in payload
        for entry in entries:
            if not isinstance(entry, dict):
                continue
            media = entry.get("media")
            if not isinstance(media, dict):
                continue
            next_ep = media.get("nextAiringEpisode")
            if not isinstance(next_ep, dict):
                continue

            media_id = entry.get("mediaId") or media.get("id")
            if not media_id:
                continue

            next_ep_num = next_ep.get("episode")
            if next_ep_num is None:
                continue

            time_until = next_ep.get("timeUntilAiring") or 0
            air_at_dt = now_dt + timedelta(seconds=int(time_until))

            title = None
            title_obj = media.get("title")
            if isinstance(title_obj, dict):
                title = title_obj.get("romaji") or title_obj.get("english")
            if not title:
                title = str(media_id)

            total_eps = media.get("episodes")
            if not isinstance(total_eps, int) or total_eps <= 0:
                total_eps = None

            store[str(media_id)] = {
                "next_episode": int(next_ep_num),
                "air_at": air_at_dt.strftime("%Y-%m-%dT%H:%M:%SZ"),
                "total_episodes": total_eps,
                "recorded_at": now_dt.strftime("%Y-%m-%dT%H:%M:%SZ"),
                "title": title,
            }
            recorded_count += 1

        if recorded_count > 0 or len(store) != len(original):
            _save_store(store)

    return recorded_count


def estimate_aired(
    media_id: Union[int, str],
    *,
    now: Optional[Union[datetime, int, float]] = None,
    total_episodes: Optional[int] = None,
) -> Optional[int]:
    """Estimate how many episodes have aired using locally cached air schedule.

    - No anchor -> None.
    - If now < air_at -> N - 1.
    - Else -> N + floor((now - air_at) / 7 days), capped by total_episodes
      when that is a positive int.
    """
    with _lock:
        store = _load_store()
        anchor = store.get(str(media_id))

    if not anchor:
        return None

    if now is None:
        now_dt = _now_utc()
    elif isinstance(now, (int, float)):
        now_dt = datetime.fromtimestamp(now, tz=timezone.utc)
    else:
        now_dt = _parse_iso_utc(now)

    try:
        air_at_dt = _parse_iso_utc(anchor["air_at"])
        next_ep = int(anchor["next_episode"])
    except (KeyError, ValueError, TypeError):
        return None

    cap = total_episodes if total_episodes is not None else anchor.get("total_episodes")

    if now_dt < air_at_dt:
        aired = next_ep - 1
    else:
        diff_seconds = (now_dt - air_at_dt).total_seconds()
        interval_seconds = EPISODE_INTERVAL_DAYS * 86400
        weeks = math.floor(diff_seconds / interval_seconds)
        aired = next_ep + weeks

    if isinstance(cap, int) and cap > 0:
        aired = min(aired, cap)

    return max(0, aired)


def _end_date_passed(media: Dict[str, Any], now: Optional[Union[datetime, int, float]]) -> bool:
    """True when AniList reports a complete ``endDate`` that is already past."""
    end = media.get("endDate")
    if not isinstance(end, dict):
        return False
    try:
        year, month, day = int(end["year"]), int(end["month"]), int(end["day"])
        end_dt = datetime(year, month, day, tzinfo=timezone.utc)
    except (KeyError, TypeError, ValueError):
        return False
    if now is None:
        now_dt = _now_utc()
    elif isinstance(now, (int, float)):
        now_dt = datetime.fromtimestamp(now, tz=timezone.utc)
    else:
        now_dt = _parse_iso_utc(now)
    return end_dt <= now_dt


def aired_episodes(
    anime: Dict[str, Any],
    *,
    now: Optional[Union[datetime, int, float]] = None,
) -> int:
    """Compute how many episodes of anime have aired. Single source of truth.

    payload_aired = nextAiringEpisode.episode - 1 if present else (media.episodes or 0)
    returns max(payload_aired, estimate_aired(...) or 0)

    When the estimate wins, prints:
    [OFFLINE] <title>: cached air schedule says episode <n> has aired (AniList data last confirmed <recorded_at>)
    """
    media = anime.get("media") if isinstance(anime, dict) else {}
    if not isinstance(media, dict):
        media = {}

    media_id = anime.get("mediaId") or media.get("id") if isinstance(anime, dict) else None
    next_ep = media.get("nextAiringEpisode")

    status = str(media.get("status") or "").upper()
    if isinstance(next_ep, dict) and next_ep.get("episode") is not None:
        payload_aired = int(next_ep["episode"]) - 1
    elif status == "NOT_YET_RELEASED":
        # Nothing has aired yet; ``media.episodes`` is only the planned count.
        payload_aired = 0
    elif status in ("RELEASING", "HIATUS") and not _end_date_passed(media, now):
        # AniList dropped the next-airing pointer (hiatus / TBD schedule): the
        # planned episode count says nothing about what actually aired. Rely
        # on the cached schedule estimate below instead of claiming every
        # episode exists, which sent the scheduler hunting for releases that
        # were never published.
        payload_aired = 0
    else:
        payload_aired = media.get("episodes") or 0
    payload_aired = max(0, int(payload_aired))

    total_episodes = media.get("episodes")
    estimated: Optional[int] = None
    if media_id is not None and status not in ("FINISHED", "CANCELLED", "NOT_YET_RELEASED"):
        # A finished show's anchor is stale by definition; extrapolating it
        # past the payload would invent episodes when the total is unknown.
        estimated = estimate_aired(media_id, now=now, total_episodes=total_episodes)

    if estimated is not None and estimated > payload_aired:
        anchor = get_anchor(media_id) if media_id is not None else None

        title = None
        title_obj = media.get("title")
        if isinstance(title_obj, dict):
            title = title_obj.get("romaji") or title_obj.get("english")
        if not title and anchor:
            title = anchor.get("title")
        if not title:
            title = str(media_id) if media_id else "Unknown"

        recorded_at = anchor.get("recorded_at") if anchor else "unknown"
        print(
            f"[OFFLINE] {title}: cached air schedule says episode {estimated} has aired "
            f"(AniList data last confirmed {recorded_at})"
        )
        return estimated

    return payload_aired
