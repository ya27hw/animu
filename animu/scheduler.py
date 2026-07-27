import time
from datetime import datetime, timezone
from typing import List, Dict, Any, Optional

from .config import get_config
from .database import db
from .models import OfflineAnime
from .anilist import anilist
from .nyaa import nyaa
from .qbittorrent import qbit
from .discord import alert_user, send_anime_downloaded_hook
from .utils import fix_anime_season, count_past_relations
from .history import history_manager

class Scheduler:
    def __init__(self):
        self.is_running = False

    def download_torrents(self, anime: Dict[str, Any], record: OfflineAnime, torrents: List[Dict[str, Any]]) -> Optional[List[int]]:
        """Download torrents via qBittorrent, send success embeds and save to DB."""
        newly_downloaded = []
        use_proxy_download = nyaa.should_use_proxy_download(anime)
        romaji_title = anime["media"]["title"]["romaji"]

        for torrent in torrents:
            episode = torrent.get("episode")
            link = torrent["link"]
            title = torrent["title"]
            
            # Add and check torrent
            success = qbit.add_check_torrent(
                link=link,
                title=romaji_title,
                episode=episode,
                use_proxy_download=use_proxy_download
            )

            if not success:
                # Increment timeout and alert user
                record.set_timeout()
                db.upsert(anime["mediaId"], record)
                alert_user(romaji_title, anime["media"]["coverImage"]["extraLarge"])
                return None

            if episode is not None:
                newly_downloaded.append(episode)
            else:
                # If it's a batch, we assume all episodes are downloaded
                total_episodes = anime["media"].get("episodes") or 1
                newly_downloaded.extend(range(1, total_episodes + 1))
            
            print(f"Downloading: {title} (Episode: {episode})")

            # Record history entry
            cover_img = anime["media"].get("coverImage", {}).get("extraLarge") or anime["media"].get("coverImage", {}).get("medium")
            history_manager.add_entry(
                title=title,
                link=link,
                anime_title=romaji_title,
                episode=episode,
                size=torrent.get("nyaa:size") or torrent.get("size") or "Unknown",
                seeders=torrent.get("nyaa:seeders") or torrent.get("seeders") or "N/A",
                cover_image=cover_img,
                source="auto"
            )

        # Update offline DB record details
        record.downloaded_episodes = list(set(record.downloaded_episodes + newly_downloaded))
        record.downloaded_episodes.sort()
        record.reset_timeout()
        db.upsert(anime["mediaId"], record)

        # Calculate discord embed details
        cover_color_str = anime["media"]["coverImage"].get("color")
        color = 0x0997e3
        if cover_color_str:
            try:
                color = int(cover_color_str.replace("#", "0x"), 16)
            except ValueError:
                pass

        episodes_str = ", ".join(map(str, newly_downloaded))
        sizes_str = ", ".join(t.get("nyaa:size", "Unknown") for t in torrents)
        seeders_str = ", ".join(t.get("nyaa:seeders", "0") for t in torrents)

        send_anime_downloaded_hook(
            f"**{romaji_title}** is downloading!",
            color,
            anime["media"]["coverImage"]["extraLarge"],
            {"name": "Title ID", "value": str(anime["mediaId"])},
            {"name": "Episode(s)", "value": episodes_str},
            {"name": "Size", "value": sizes_str},
            {"name": "Seeders", "value": seeders_str},
            {"name": "Title", "value": torrents[0]["title"]}
        )

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
        db.upsert(anime["mediaId"], record)

        print(f"Downloaded all episodes for {anime['media']['title']['romaji']}. Setting to rewatching...")
        try:
            success = anilist.set_anime_to_rewatching(anime["mediaId"])
            if success:
                record.pending_rewatching_update = False
                db.upsert(anime["mediaId"], record)
            else:
                print(f"Failed to set {anime['media']['title']['romaji']} to rewatching on AniList.")
        except Exception as e:
            print(f"Failed to set {anime['media']['title']['romaji']} to rewatching: {e}")

    def handle_anime(self, anime: Dict[str, Any], record: OfflineAnime) -> None:
        """Handle Nyaa search combinations and download matching torrents for an anime."""
        config = get_config()
        starting_episode = record.starting_episode
        alternative_title = record.alternative_title or anime["media"]["title"]["romaji"]
        
        # Override title dynamically
        anime["media"]["title"]["romaji"] = alternative_title

        start_episode = anime["progress"] + starting_episode
        
        # NextAiringEpisode can be null if the anime is finished
        next_ep = anime["media"].get("nextAiringEpisode")
        if next_ep:
            end_episode = next_ep["episode"] - 1 + starting_episode
        else:
            end_episode = (anime["media"].get("episodes") or 0) + starting_episode

        if end_episode <= start_episode:
            return

        # Check if already up to date
        anime_progress = list(range(start_episode + 1, end_episode + 1))
        is_up_to_date = all(ep in record.downloaded_episodes for ep in anime_progress)

        if is_up_to_date:
            if record.pending_rewatching_update:
                self.sync_anime_rewatching_status(anime, record)
            return

        # Search default title
        primary_torrent = nyaa.get_torrents(
            anime=anime,
            start_episode=start_episode,
            end_episode=end_episode,
            starting_episode=starting_episode,
            downloaded_episodes=record.downloaded_episodes
        )

        primary_seed_count = 0
        if primary_torrent:
            primary_seed_count = sum(int(t.get("nyaa:seeders", 0)) for t in primary_torrent)

        # Alternative title search logic if not overridden and has no downloaded episodes
        if not record.alternative_title and not record.downloaded_episodes:
            ex3 = fix_anime_season(anime["media"]["title"]["romaji"])
            ex2 = count_past_relations(anime["mediaId"])

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

            print(f"Attempting combinations for {anime['media']['title']['romaji']} -> {[c['title'] for c in unique_combinations]}")

            best_combo = None
            best_combo_torrent = None
            best_seed_count = primary_seed_count

            # Evaluate combinations sequentially
            for combo in unique_combinations:
                time.sleep(2.0)
                try:
                    result = nyaa.get_torrents(
                        anime=anime,
                        start_episode=start_episode + combo["episode_offset"],
                        end_episode=end_episode + combo["episode_offset"],
                        starting_episode=starting_episode + combo["episode_offset"],
                        downloaded_episodes=record.downloaded_episodes,
                        alt_anime_title=combo["title"]
                    )
                    seed_count = sum(int(t.get("nyaa:seeders", 0)) for t in result) if result else 0
                    if seed_count > best_seed_count:
                        best_seed_count = seed_count
                        best_combo = combo
                        best_combo_torrent = result
                except Exception as e:
                    print(f"Combo search error for {combo['title']}: {e}")

            if best_combo and best_seed_count > primary_seed_count:
                primary_torrent = best_combo_torrent
                anime["media"]["title"]["romaji"] = best_combo["title"]
                record.alternative_title = best_combo["title"]
                record.starting_episode = best_combo["episode_offset"]
                db.upsert(anime["mediaId"], record)
                
                # Recalculate range based on the new starting episode
                starting_episode = best_combo["episode_offset"]
                start_episode = anime["progress"] + starting_episode
                if next_ep:
                    end_episode = next_ep["episode"] - 1 + starting_episode
                else:
                    end_episode = (anime["media"].get("episodes") or 0) + starting_episode

        if primary_torrent:
            newly_downloaded = self.download_torrents(anime, record, primary_torrent)
            if newly_downloaded:
                self.sync_anime_rewatching_status(anime, record)
            # Torrent found and downloaded successfully, remove any failure trace
            from .nyaa import failed_traces
            failed_traces.pop(anime["mediaId"], None)
        else:
            # Increment timeouts and print failure log
            record.set_timeout()
            db.upsert(anime["mediaId"], record)
            
            # Store trace for failed run
            from .nyaa import active_traces, failed_traces
            if anime["mediaId"] in active_traces:
                failed_traces[anime["mediaId"]] = active_traces[anime["mediaId"]]
            else:
                # Stub trace if no active trace was recorded (e.g. error or empty results)
                failed_traces[anime["mediaId"]] = {
                    "anime_title": anime["media"]["title"]["romaji"],
                    "media_id": anime["mediaId"],
                    "search_query": anime["media"]["title"]["romaji"],
                    "status": "NO_RESULTS",
                    "candidates": [],
                    "timestamp": time.time()
                }
            
            interval = config.interval or 30
            total_minutes = record.timeouts * interval
            now = datetime.now()
            # Calculate next run timestamp
            from datetime import timedelta
            next_run = now + timedelta(minutes=total_minutes)
            
            print(f"❌ Failed to find {anime['media']['title']['romaji']}. Next run in {total_minutes} minutes. (At {next_run.strftime('%I:%M %p')})")

    def check(self) -> None:
        """Core check loop: queries AniList collection and checks missing episodes against database."""
        # Clear previous run's traces
        from .nyaa import active_traces, failed_traces
        active_traces.clear()
        failed_traces.clear()

        # Sync any unsynced offline local changes first
        try:
            db.sync_local_changes()
        except Exception as e:
            print(f"Local database sync failed: {e}")
            
        anime_list = anilist.get_anime_user_list()
        if not anime_list:
            print("No anime in watching list.")
            return

        # Load all records from PocketBase
        pb_records = db.get_all()
        pb_map = {r.media_id: r for r in pb_records}

        # Build execution list
        execution_list = []
        config = get_config()
        interval = config.interval or 30

        for anime in anime_list:
            media_id = anime["mediaId"]
            record = pb_map.get(media_id)

            print(f"[SYNC_STATE] {anime['media']['title']['romaji']} (ID {media_id}) "
                  f"downloaded_episodes={len(record.downloaded_episodes) if record else 0}, "
                  f"timeouts={record.timeouts if record else 0}")

            if not record:
                record = OfflineAnime(media_id=media_id)
                db.upsert(media_id, record)
                pb_map[media_id] = record
                execution_list.append((anime, record))
            else:
                if record.timeouts > 0:
                    print(f"ℹ️ Next run for {anime['media']['title']['romaji']} in {record.timeouts * interval} minutes")
                    record.timeouts -= 1
                    db.upsert(media_id, record)
                    continue

                # Compute airing status
                next_ep = anime["media"].get("nextAiringEpisode")
                if next_ep:
                    airing_episodes = next_ep["episode"] - 1
                else:
                    airing_episodes = anime["media"].get("episodes") or 0

                if airing_episodes == 0:
                    continue

                start_episode = anime["progress"] + record.starting_episode
                end_episode = airing_episodes + record.starting_episode
                
                # Check for missing episodes
                has_missing = False
                for ep in range(start_episode + 1, end_episode + 1):
                    if ep not in record.downloaded_episodes:
                        has_missing = True
                        break

                if has_missing:
                    execution_list.append((anime, record))

        # Handle matches with concurrency control
        for anime, record in execution_list:
            time.sleep(2.0)  # Throttling between anime items
            try:
                self.handle_anime(anime, record)
            except Exception as e:
                print(f"Error handling anime {anime['media']['title']['romaji']}: {e}")

    def run_loop(self) -> None:
        """Run scheduler on a recurring loop adjusting for peak/off-peak runtimes."""
        last_run_min = -1
        print("Starting scheduler daemon loop...")

        while True:
            now = time.localtime()
            hour = now.tm_hour
            is_peak = (hour >= 12 or hour <= 4)
            config = get_config()
            interval = config.interval if is_peak else config.offpeak_interval
            interval = interval or 30

            if now.tm_min % interval == 0 and now.tm_min != last_run_min and not self.is_running:
                last_run_min = now.tm_min
                self.is_running = True
                print(f"\n>>> Running scheduler at {time.strftime('%Y-%m-%d %H:%M:%S')} <<<")
                try:
                    self.check()
                except Exception as e:
                    print(f"Error during scheduled execution: {e}")
                finally:
                    self.is_running = False

            time.sleep(10)

    def run_once(self) -> None:
        """Run scheduler check exactly once, then exit."""
        print("Running check cycle once...")
        try:
            self.check()
        except Exception as e:
            print(f"Error during check cycle: {e}")

scheduler = Scheduler()
