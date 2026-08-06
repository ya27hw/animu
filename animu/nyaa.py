import feedparser
import httpx
import time
import anitopy
import math
from typing import Optional, List, Dict, Any
from .config import get_config
from .utils import verify_query

class NyaaClient:
    def __init__(self):
        self.client = httpx.Client(verify=False, timeout=20)

    def should_use_proxy_download(self, anime: Dict[str, Any]) -> bool:
        """Determines if the anime genres trigger proxy requirements (e.g. Ecchi genre)."""
        config = get_config()
        genres = anime.get("media", {}).get("genres") or []
        trigger = config.trigger_genre or "Ecchi"
        return trigger in genres

    def get_search_context(self, anime: Dict[str, Any]) -> tuple[str, bool]:
        """Returns the appropriate Nyaa URL and proxy setting for the given anime."""
        config = get_config()
        if self.should_use_proxy_download(anime):
            return config.alt_nyaa_url or "https://nyaa.si", True
        return config.nyaa_url or "https://nyaa.si", bool(config.use_proxy)

    def _set_params(self, url: str, query: str) -> Dict[str, str]:
        """Sets standard query params for Nyaa RSS feeds."""
        config = get_config()
        # c=1_2 for Anime (default) or c=1_1 for alternative URLs (Art/non-anime)
        category = "1_2" if url == (config.nyaa_url or "https://nyaa.si") else "1_1"
        return {
            "page": "rss",
            "q": query,
            "c": category,
            "f": "0",
            "o": "desc",
            "s": "seeders"
        }

    def fetch_rss_feed(self, query: str, url: str, enable_proxy: bool) -> Dict[str, Any]:
        """Fetch RSS feed from Nyaa with retry and proxy options."""
        params = self._set_params(url, query)
        config = get_config()

        proxy_url = None
        if enable_proxy and config.proxy_address and config.proxy_port:
            proxy_url = f"http://{config.proxy_address}:{config.proxy_port}"

        max_retries = 2
        retry_delay = 3.0

        for attempt in range(max_retries + 1):
            try:
                # Use a localized client to ensure proxy is loaded correctly per request
                with httpx.Client(verify=False, proxy=proxy_url, timeout=20) as client:
                    resp = client.get(url, params=params)

                if resp.status_code != 200:
                    if attempt < max_retries:
                        print(f"Nyaa RSS fetch returned status {resp.status_code}, retrying in {retry_delay}s (attempt {attempt + 1}/{max_retries})")
                        time.sleep(retry_delay)
                        continue
                    return {
                        "status": resp.status_code,
                        "message": f"Failed to fetch RSS feed. HTTP status: {resp.status_code}",
                        "data": None
                    }

                feed = feedparser.parse(resp.text)
                items = []
                for entry in feed.entries:
                    items.append({
                        "title": entry.title,
                        "link": entry.link,
                        # feedparser normalizes nyaa namespace to nyaa_seeders and nyaa_size
                        "nyaa:seeders": entry.get("nyaa_seeders", "0"),
                        "nyaa:size": entry.get("nyaa_size", "0"),
                        "pubDate": entry.published,
                        "guid": entry.id
                    })

                # Sort by seeders descending
                items.sort(key=lambda x: int(x["nyaa:seeders"]), reverse=True)

                return {
                    "status": 200,
                    "message": "RSS feed fetched successfully.",
                    "data": items
                }
            except Exception as e:
                if attempt < max_retries:
                    print(f"Nyaa RSS fetch error, retrying in {retry_delay}s (attempt {attempt + 1}/{max_retries}): {e}")
                    time.sleep(retry_delay)
                    continue
                print(f"Failed to retrieve Nyaa RSS feed after {max_retries} retries: {e}")
                return {
                    "status": 500,
                    "message": str(e),
                    "data": None
                }
        return {"status": 500, "message": "Max retries exhausted.", "data": None}

    def get_episode_air_dates(
        self,
        media_id: int,
        episode_list: List[int],
        starting_episode: int
    ) -> Optional[Dict[str, Any]]:
        """Retrieve airing schedules from AniList, paginating as required by the episode list."""
        if not episode_list:
            return {"nodes": []}

        # Paginate to fetch airdates
        query = """
        query ($mediaId: Int, $page: Int) {
          Page(page: $page, perPage: 25) {
            pageInfo {
              hasNextPage
            }
            airingSchedules(mediaId: $mediaId, sort: EPISODE_DESC) {
              episode
              airingAt
            }
          }
        }
        """

        from .anilist import anilist
        nodes = []
        page = 1

        for attempt in range(3):
            try:
                res = anilist._query(query, {"mediaId": media_id, "page": page})
                if res and res.get("data") and res["data"].get("Page"):
                    page_data = res["data"]["Page"]
                    nodes.extend(page_data.get("airingSchedules", []))
                    if page_data["pageInfo"].get("hasNextPage") and len(nodes) < 100:
                        page += 1
                        continue
                    break
                else:
                    return None
            except Exception:
                if attempt == 2:
                    return None
                time.sleep(1)

        return {"nodes": nodes}

    def get_best_torrent(
        self,
        items: List[Dict[str, Any]],
        search_query: str,
        search_mode: str,
        use_alt_url: bool,
        air_dates: Dict[str, Any],
        ignore_airdate_checks: bool,
        starting_episode: int = 0,
        *episodes: int,
        verbose_trace: Optional[list] = None
    ) -> Optional[Dict[str, Any]]:
        """Grades torrents from Nyaa and selects the best candidate matching criteria."""
        config = get_config()
        best_rating = -1.0
        best_torrent = None
        episode_num = episodes[0] if episodes and search_mode == "EPISODE" else None

        for item in items:
            try:
                seeders = int(item.get("nyaa:seeders", 0))
            except ValueError:
                seeders = 0

            title = item["title"]
            pub_date = item["pubDate"]
            parsed_data = anitopy.parse(title)

            res_mode = "0" if use_alt_url else config.resolution

            if seeders == 0:
                if verbose_trace is not None:
                    verbose_trace.append({
                        "title": title,
                        "link": item.get("link", ""),
                        "seeders": 0,
                        "episode": episode_num,
                        "rating": 0.0,
                        "rejection_reason": "No seeders available",
                        "episode_match": None,
                        "resolution_match": None,
                        "air_date_match": None,
                        "title_similarity": 0.0
                    })
                continue

            rating, details = verify_query(
                search_query,
                parsed_data,
                res_mode,
                search_mode,
                pub_date,
                air_dates,
                ignore_airdate_checks,
                starting_episode,
                *episodes,
                verbose=True
            )

            if verbose_trace is not None:
                verbose_trace.append({
                    "title": title,
                    "link": item.get("link", ""),
                    "seeders": seeders,
                    "episode": episode_num,
                    "rating": rating,
                    "rejection_reason": details.get("rejection_reason", ""),
                    "episode_match": details.get("episode_match"),
                    "resolution_match": details.get("resolution_match"),
                    "air_date_match": details.get("air_date_match"),
                    "title_similarity": details.get("title_similarity", 0.0)
                })

            if rating > best_rating:
                best_rating = rating
                best_torrent = item
                if best_rating >= 3.88:
                    break

        if best_rating >= 3.88 and best_torrent:
            return best_torrent
        return None

    def get_torrents(
        self,
        anime: Dict[str, Any],
        start_episode: int,
        end_episode: int,
        starting_episode: int,
        downloaded_episodes: List[int],
        alt_anime_title: Optional[str] = None
    ) -> Optional[List[Dict[str, Any]]]:
        """Fetch matching torrents from Nyaa for batch or individual episodes."""
        config = get_config()
        search_url, enable_proxy = self.get_search_context(anime)
        ignore_airdate_checks = self.should_use_proxy_download(anime)

        episode_list = [i for i in range(start_episode + 1, end_episode + 1) if i not in downloaded_episodes]
        if not episode_list:
            return None

        anime_title = alt_anime_title if alt_anime_title else anime["media"]["title"]["romaji"]
        print(f"Searching for {anime_title} (ID: {anime['mediaId']}) episode(s) {episode_list}")

        air_dates = {"nodes": []} if ignore_airdate_checks else self.get_episode_air_dates(
            anime["mediaId"], episode_list, starting_episode
        )
        if air_dates is None:
            return None
        if starting_episode:
            # Candidate filenames use release/global numbering; align the
            # AniList airing schedule to that same namespace once.
            air_dates = {"nodes": [
                {**node, "episode": node.get("episode", 0) + (starting_episode if starting_episode > 0 else 0)}
                for node in air_dates.get("nodes", [])
            ]}

        status = anime["media"].get("status")
        search_mode = "BATCH" if status == "FINISHED" and start_episode == 0 and not downloaded_episodes else "EPISODE"

        if search_mode == "BATCH":
            rss_res = self.fetch_rss_feed(anime_title, search_url, enable_proxy)
            trace_candidates = []
            if rss_res["status"] == 200 and rss_res["data"]:
                best = self.get_best_torrent(
                    rss_res["data"],
                    anime_title,
                    "BATCH",
                    search_url == (config.alt_nyaa_url or "https://nyaa.si"),
                    air_dates,
                    ignore_airdate_checks,
                    start_episode,
                    end_episode,
                    verbose_trace=trace_candidates
                )
                trace_status = "SUCCESS" if best else "NO_MATCH"
                record_trace(anime["mediaId"], anime["media"]["title"]["romaji"], anime_title, trace_status, trace_candidates)
                if best:
                    return [best]
            else:
                record_trace(anime["mediaId"], anime["media"]["title"]["romaji"], anime_title, "NO_RESULTS", [])
            search_mode = "EPISODE"

        found_torrents = []
        for episode in episode_list:
            release_episode = episode + (starting_episode if starting_episode > 0 else 0)
            formatted_ep = f"{release_episode:02d}"
            query_str = f'{anime_title} "{formatted_ep}"'
            rss_res = self.fetch_rss_feed(query_str, search_url, enable_proxy)
            trace_candidates = []
            if rss_res["status"] == 200 and rss_res["data"]:
                best = self.get_best_torrent(
                    rss_res["data"],
                    query_str,
                    "EPISODE",
                    search_url == (config.alt_nyaa_url or "https://nyaa.si"),
                    air_dates,
                    ignore_airdate_checks,
                    starting_episode,
                    release_episode,
                    verbose_trace=trace_candidates
                )
                trace_status = "SUCCESS" if best else "NO_MATCH"
                record_trace(anime["mediaId"], anime["media"]["title"]["romaji"], query_str, trace_status, trace_candidates)
                if best:
                    torrent_copy = dict(best)
                    torrent_copy["episode"] = episode
                    found_torrents.append(torrent_copy)
            else:
                record_trace(anime["mediaId"], anime["media"]["title"]["romaji"], query_str, "NO_RESULTS", [])

        return found_torrents if found_torrents else None

    def search_episode_candidates(
        self,
        anime: Dict[str, Any],
        episode: int,
        starting_episode: int,
        alt_anime_title: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        """Fetch candidates for a single episode, scored and sorted by rating/seeders."""
        config = get_config()
        search_url, enable_proxy = self.get_search_context(anime)
        ignore_airdate_checks = self.should_use_proxy_download(anime)
        anime_title = alt_anime_title if alt_anime_title else anime["media"]["title"]["romaji"]

        air_dates = {"nodes": []} if ignore_airdate_checks else self.get_episode_air_dates(
            anime["mediaId"], [episode], starting_episode
        )
        if air_dates is None:
            return []
        if starting_episode:
            air_dates = {"nodes": [
                {**node, "episode": node.get("episode", 0) + (starting_episode if starting_episode > 0 else 0)}
                for node in air_dates.get("nodes", [])
            ]}

        release_episode = episode + (starting_episode if starting_episode > 0 else 0)
        formatted_ep = f"{release_episode:02d}"
        rss_res = self.fetch_rss_feed(f'{anime_title} "{formatted_ep}"', search_url, enable_proxy)
        if rss_res["status"] != 200 or not rss_res["data"]:
            return []

        use_alt_url = (search_url == (config.alt_nyaa_url or "https://nyaa.si"))
        res_mode = "0" if use_alt_url else config.resolution

        candidates = []
        for item in rss_res["data"]:
            parsed = anitopy.parse(item["title"])
            score_result = verify_query(
                f'{anime_title} "{formatted_ep}"',
                parsed,
                res_mode,
                "EPISODE",
                item["pubDate"],
                air_dates,
                ignore_airdate_checks,
                release_episode,
                verbose=True
            )
            score, details = score_result if isinstance(score_result, tuple) else (score_result, {})
            if score > 0:
                cand = dict(item)
                cand["episode"] = episode
                cand["score"] = score
                cand["details"] = {
                    "episode_match": details.get("episode_match"),
                    "resolution_match": details.get("resolution_match"),
                    "air_date_match": details.get("air_date_match"),
                    "title_similarity": details.get("title_similarity", 0.0)
                }
                cand["parsedTitle"] = parsed.get("anime_title")
                candidates.append(cand)

        # Sort by score desc, then seeders desc
        candidates.sort(key=lambda x: (-x["score"], -int(x.get("nyaa:seeders", 0))))
        return candidates

    def search_title_candidates(
        self,
        anime: Dict[str, Any],
        starting_episode: int,
        alt_anime_title: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        """Fetch candidates by title only (used by Web UI when episode is not specified)."""
        config = get_config()
        search_url, enable_proxy = self.get_search_context(anime)
        anime_title = alt_anime_title if alt_anime_title else anime["media"]["title"]["romaji"]

        rss_res = self.fetch_rss_feed(anime_title, search_url, enable_proxy)
        if rss_res["status"] != 200 or not rss_res["data"]:
            return []

        return [{
            **item,
            "score": 0.0,
            "parsedTitle": None
        } for item in rss_res["data"]]

    def search_raw_title_candidates(self, anime_title: str, use_alt_url: bool) -> List[Dict[str, Any]]:
        """Retrieve raw unsorted search listings from Nyaa (for manual web search)."""
        config = get_config()
        query = anime_title.strip()
        if not query:
            return []

        search_url = (config.alt_nyaa_url or "https://nyaa.si") if use_alt_url else (config.nyaa_url or "https://nyaa.si")
        enable_proxy = True if use_alt_url else bool(config.use_proxy)

        rss_res = self.fetch_rss_feed(query, search_url, enable_proxy)
        if rss_res["status"] != 200 or not rss_res["data"]:
            return []
        return rss_res["data"]


# Global variables to track search traces for debugging
active_traces = {}
failed_traces = {}


def record_trace(media_id: int, anime_title: str, query: str, status: str, candidates: list, english_title: str = None, season_info: dict = None):
    """Save the top 3 scored candidates for debugging purposes."""
    candidates_copy = list(candidates) if candidates else []
    candidates_copy.sort(key=lambda x: x.get("rating", 0), reverse=True)
    top_candidates = candidates_copy[:3]
    now = time.time()
    active_traces[media_id] = {
        "media_id": media_id,
        "anime_title": anime_title,
        "english_title": english_title,
        "season_info": season_info or {},
        "search_query": query,
        "status": status,
        "candidates": top_candidates,
        "timestamp": now,
        "last_attempt": now,
        "unresolved": True
    }


def record_failed_trace(media_id: int, anime: dict = None, record = None, status: str = "NO_RESULTS"):
    """Persist a failed trace for an unresolved anime across scheduler runs."""
    existing = active_traces.get(media_id)
    now = time.time()

    anime_obj = anime or {}
    media_data = anime_obj.get("media", {})
    romaji_title = media_data.get("title", {}).get("romaji") if media_data.get("title") else None
    english_title = media_data.get("title", {}).get("english") if media_data.get("title") else None

    season_info = {
        "format": media_data.get("format"),
        "episodes": media_data.get("episodes"),
        "status": media_data.get("status")
    }

    if existing:
        trace = dict(existing)
        trace["unresolved"] = True
        trace["last_attempt"] = now
        trace["season_info"] = season_info
        if record:
            trace["timeouts"] = record.timeouts
            trace["max_timeouts"] = getattr(record, "max_timeouts", 10)
        failed_traces[media_id] = trace
    else:
        title = romaji_title or f"Anime-{media_id}"
        failed_traces[media_id] = {
            "media_id": media_id,
            "anime_title": title,
            "english_title": english_title,
            "season_info": season_info,
            "search_query": title,
            "status": status,
            "candidates": [],
            "timestamp": now,
            "last_attempt": now,
            "timeouts": record.timeouts if record else 0,
            "max_timeouts": getattr(record, "max_timeouts", 10) if record else 10,
            "unresolved": True
        }


def remove_failed_trace(media_id: int):
    """Evict resolved trace when missing episodes are downloaded or anime is up to date."""
    failed_traces.pop(media_id, None)


nyaa = NyaaClient()
