import httpx
import time
from typing import Optional, List, Dict, Any
from .config import get_config

ANILIST_API = "https://graphql.anilist.co"

class AnilistClient:
    def __init__(self):
        # verify=False is useful if there are TLS/handshake proxy issues
        self.client = httpx.Client(verify=False, timeout=15)

    def _query(self, query: str, variables: Optional[Dict[str, Any]] = None) -> Optional[Dict[str, Any]]:
        """Sends a GraphQL POST request to AniList with retry, proxy, and auth fallback."""
        config = get_config()
        token = config.bearer_token_anilist
        
        headers = {
            "Accept": "application/json",
            "Content-Type": "application/json",
        }
        if token:
            headers["Authorization"] = f"Bearer {token}"

        # Setup proxy if enabled
        proxy_url = None
        if config.use_proxy and config.proxy_address and config.proxy_port:
            proxy_url = f"http://{config.proxy_address}:{config.proxy_port}"

        max_retries = 3
        retry_delays = [2, 4, 8]
        auth_fallback_tried = False

        for attempt in range(max_retries + 1):
            try:
                # Use a localized client to apply per-request proxy properly
                with httpx.Client(verify=False, proxy=proxy_url, timeout=15) as client:
                    resp = client.post(
                        ANILIST_API,
                        json={"query": query, "variables": variables},
                        headers=headers
                    )
                    
                status = resp.status_code

                # Expired/invalid token fallback (since list queries are public)
                if not auth_fallback_tried and token and status in (400, 401):
                    headers.pop("Authorization", None)
                    auth_fallback_tried = True
                    continue

                if status == 200:
                    return resp.json()

                # Retry on cloudflare 502, proxy errors, or 5xx server issues
                is_retryable = status == 502 or status == 404 or status >= 500
                if is_retryable and attempt < max_retries:
                    delay = retry_delays[attempt]
                    print(f"AniList request failed with status {status}, retrying in {delay}s (attempt {attempt + 1}/{max_retries})")
                    time.sleep(delay)
                    continue

                if attempt >= max_retries:
                    print(f"AniList request failed after {max_retries} retries with status {status}: {resp.text}")
                    return None
                    
            except Exception as e:
                if attempt < max_retries:
                    delay = retry_delays[attempt]
                    print(f"AniList request connection error: {e}, retrying in {delay}s (attempt {attempt + 1}/{max_retries})")
                    time.sleep(delay)
                    continue
                print(f"AniList request connection failed after {max_retries} retries: {e}")
                return None

        return None

    def get_watching_list(self) -> List[Dict[str, Any]]:
        """Fetch user's current watching list with minimal details."""
        query = """
        query ($userName :String) {
          MediaListCollection(userName: $userName, type: ANIME, status_in: CURRENT) {
            lists {
              name
              entries {
                progress
                mediaId
                media {
                  title {
                    romaji
                  }
                }
              }
            }
          }
        }
        """
        config = get_config()
        if not config.ani_user_name:
            print("aniUserName not set in config.")
            return []

        resp = self._query(query, {"userName": config.ani_user_name})
        if resp and "data" in resp:
            data = resp["data"]
            if data and "MediaListCollection" in data and data["MediaListCollection"]:
                lists = data["MediaListCollection"].get("lists", [])
                if lists:
                    return lists[0].get("entries", [])
        return []

    def get_anime_user_list(self) -> List[Dict[str, Any]]:
        """Fetch user's current watching list with detailed anime info."""
        query = """
        query ($userName :String) {
          MediaListCollection(userName: $userName, type: ANIME, status_in: CURRENT) {
            lists {
              name
              entries {
                progress
                mediaId
                media {
                  coverImage {
                    extraLarge
                    large
                    medium
                    color
                  }
                  genres
                  format
                  episodes
                  status
                  endDate {
                    year
                    month
                    day
                  }
                  nextAiringEpisode {
                    id
                    episode
                    timeUntilAiring
                  }
                  synonyms
                  title {
                    romaji
                    english
                    native
                  }
                }
              }
            }
          }
        }
        """
        config = get_config()
        if not config.ani_user_name:
            print("aniUserName not set in config.")
            return []

        resp = self._query(query, {"userName": config.ani_user_name})
        if resp and "data" in resp:
            data = resp["data"]
            if data and "MediaListCollection" in data and data["MediaListCollection"]:
                lists = data["MediaListCollection"].get("lists", [])
                if lists:
                    return lists[0].get("entries", [])
        return []

    def get_airing_schedule(self, page: int, media_id: int) -> Optional[Dict[str, Any]]:
        """Retrieve the airing schedule for a specific anime by its ID."""
        query = """
        query($id: Int, $page: Int) {
          Media(id: $id) {
            title {
              romaji
              english
            }
            airingSchedule(page: $page, perPage: 25) {
              nodes {
                airingAt
                episode
              }
            }
          }
        }
        """
        resp = self._query(query, {"id": media_id, "page": page})
        if resp and "data" in resp and resp["data"]:
            media = resp["data"].get("Media")
            if media:
                return media.get("airingSchedule")
        return None

    def get_previous_relations(self, media_id: int) -> Optional[List[Dict[str, Any]]]:
        """Retrieve previous relations (e.g. prequels) for an anime."""
        query = """
        query ($id: Int) {
          Media(id: $id) {
            relations {
              edges {
                relationType
                node {
                  id
                  episodes
                  title {
                    romaji
                    english
                  }
                }
              }
            }
          }
        }
        """
        resp = self._query(query, {"id": media_id})
        if resp and "data" in resp and resp["data"]:
            media = resp["data"].get("Media")
            if media and "relations" in media and media["relations"]:
                return media["relations"].get("edges", [])
        return None

    def set_anime_to_rewatching(self, media_id: int) -> bool:
        """Update an anime entry on user list to REPEATING (Rewatching) status."""
        query = """
        mutation SaveMediaListEntry($mediaId: Int, $status: MediaListStatus) {
            SaveMediaListEntry(mediaId: $mediaId, status: $status) {
                status
            }
        }
        """
        resp = self._query(query, {"mediaId": media_id, "status": "REPEATING"})
        if resp and "data" in resp and resp["data"]:
            save_entry = resp["data"].get("SaveMediaListEntry")
            if save_entry and save_entry.get("status") == "REPEATING":
                return True
        return False

anilist = AnilistClient()
