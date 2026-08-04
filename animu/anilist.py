import httpx
import time
from typing import Optional, List, Dict, Any
from .config import get_config

ANILIST_API = "https://graphql.anilist.co"

class AnilistClient:
    def __init__(self):
        # verify=False is useful if there are TLS/handshake proxy issues
        self.client = httpx.Client(verify=False, timeout=15)

    def _query(self, query: str, variables: Optional[Dict[str, Any]] = None, require_auth: bool = False) -> Optional[Dict[str, Any]]:
        """Sends a GraphQL POST request to AniList with retry, proxy, and auth handling."""
        config = get_config()
        token = config.bearer_token_anilist
        
        headers = {
            "Accept": "application/json",
            "Content-Type": "application/json",
        }
        if token:
            headers["Authorization"] = f"Bearer {token}"
        elif require_auth:
            print("AniList token missing for authenticated request.")
            return {"errors": [{"message": "AniList Bearer Token is not configured in Settings."}]}

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

                # Expired/invalid token fallback ONLY for public reads (when require_auth is False)
                if not require_auth and not auth_fallback_tried and token and status in (400, 401):
                    headers.pop("Authorization", None)
                    auth_fallback_tried = True
                    continue

                if status == 200:
                    return resp.json()

                if require_auth:
                    print(f"Authenticated AniList request failed with status {status}")
                    try:
                        data = resp.json()
                        if isinstance(data, dict) and "errors" in data:
                            return data
                    except Exception:
                        pass
                    return {"errors": [{"message": f"AniList API error (status {status})"}]}

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
                if require_auth:
                    return {"errors": [{"message": f"Connection error: {e}"}]}
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

    def get_discover_anime(self, type_str: str = "trending", page: int = 1, per_page: int = 20) -> Dict[str, Any]:
        """Fetch paginated anime discovery feed (trending, popular, or top)."""
        sort_map = {
            "trending": ["TRENDING_DESC", "POPULARITY_DESC"],
            "popular": ["POPULARITY_DESC"],
            "top": ["SCORE_DESC"],
        }
        sort = sort_map.get(type_str.lower(), ["TRENDING_DESC", "POPULARITY_DESC"])

        query = """
        query ($page: Int, $perPage: Int, $sort: [MediaSort]) {
          Page(page: $page, perPage: $perPage) {
            pageInfo {
              total
              perPage
              currentPage
              lastPage
              hasNextPage
            }
            media(type: ANIME, sort: $sort) {
              id
              title {
                romaji
                english
                native
              }
              coverImage {
                extraLarge
                large
                medium
                color
              }
              bannerImage
              format
              status
              episodes
              duration
              season
              seasonYear
              averageScore
              meanScore
              popularity
              genres
              nextAiringEpisode {
                id
                episode
                timeUntilAiring
                airingAt
              }
              mediaListEntry {
                id
                status
                progress
                score
              }
            }
          }
        }
        """
        resp = self._query(query, {"page": page, "perPage": per_page, "sort": sort})
        if resp and "data" in resp and resp["data"] and "Page" in resp["data"]:
            return resp["data"]["Page"]
        return {"pageInfo": {"total": 0, "perPage": per_page, "currentPage": page, "lastPage": 1, "hasNextPage": False}, "media": []}

    def search_anime(self, query_text: str, page: int = 1, per_page: int = 20) -> Dict[str, Any]:
        """Search anime on AniList with pagination."""
        query = """
        query ($search: String, $page: Int, $perPage: Int) {
          Page(page: $page, perPage: $perPage) {
            pageInfo {
              total
              perPage
              currentPage
              lastPage
              hasNextPage
            }
            media(search: $search, type: ANIME, sort: [POPULARITY_DESC]) {
              id
              title {
                romaji
                english
                native
              }
              coverImage {
                extraLarge
                large
                medium
                color
              }
              bannerImage
              format
              status
              episodes
              duration
              season
              seasonYear
              averageScore
              meanScore
              popularity
              genres
              nextAiringEpisode {
                id
                episode
                timeUntilAiring
                airingAt
              }
              mediaListEntry {
                id
                status
                progress
                score
              }
            }
          }
        }
        """
        resp = self._query(query, {"search": query_text, "page": page, "perPage": per_page})
        if resp and "data" in resp and resp["data"] and "Page" in resp["data"]:
            return resp["data"]["Page"]
        return {"pageInfo": {"total": 0, "perPage": per_page, "currentPage": page, "lastPage": 1, "hasNextPage": False}, "media": []}

    def get_media_detail(self, media_id: int) -> Optional[Dict[str, Any]]:
        """Retrieve detailed anime metadata, airing schedule, relations, and user list entry."""
        query = """
        query ($id: Int) {
          Media(id: $id, type: ANIME) {
            id
            title {
              romaji
              english
              native
            }
            coverImage {
              extraLarge
              large
              medium
              color
            }
            bannerImage
            description(asHtml: false)
            format
            status
            episodes
            duration
            season
            seasonYear
            startDate {
              year
              month
              day
            }
            endDate {
              year
              month
              day
            }
            averageScore
            meanScore
            popularity
            favourites
            genres
            synonyms
            nextAiringEpisode {
              id
              episode
              timeUntilAiring
              airingAt
            }
            airingSchedule(page: 1, perPage: 25) {
              nodes {
                id
                episode
                airingAt
                timeUntilAiring
              }
            }
            relations {
              edges {
                relationType
                node {
                  id
                  type
                  title {
                    romaji
                    english
                  }
                  format
                  status
                  coverImage {
                    medium
                    large
                  }
                }
              }
            }
            mediaListEntry {
              id
              status
              progress
              score
            }
          }
        }
        """
        resp = self._query(query, {"id": media_id})
        if resp and "data" in resp and resp["data"]:
            return resp["data"].get("Media")
        return None

    def save_media_list_entry(
        self,
        media_id: int,
        status: Optional[str] = None,
        progress: Optional[int] = None,
        score: Optional[float] = None
    ) -> Dict[str, Any]:
        """Authenticated mutation to create or update a user's media list entry."""
        query = """
        mutation SaveMediaListEntry($mediaId: Int, $status: MediaListStatus, $progress: Int, $score: Float) {
          SaveMediaListEntry(mediaId: $mediaId, status: $status, progress: $progress, score: $score) {
            id
            mediaId
            status
            progress
            score
          }
        }
        """
        variables: Dict[str, Any] = {"mediaId": media_id}
        if status:
            variables["status"] = status
        if progress is not None:
            variables["progress"] = progress
        if score is not None:
            variables["score"] = score

        resp = self._query(query, variables, require_auth=True)
        if not resp:
            return {"success": False, "error": "No response received from AniList API."}

        if "errors" in resp:
            errors = resp["errors"]
            msg = ", ".join([e.get("message", "Unknown error") for e in errors])
            return {"success": False, "error": msg}

        if "data" in resp and resp["data"] and resp["data"].get("SaveMediaListEntry"):
            return {"success": True, "entry": resp["data"]["SaveMediaListEntry"]}

        return {"success": False, "error": "Unexpected response payload from AniList API."}

    def set_anime_to_rewatching(self, media_id: int) -> bool:
        """Update an anime entry on user list to REPEATING (Rewatching) status."""
        res = self.save_media_list_entry(media_id, status="REPEATING")
        return res.get("success", False)

anilist = AnilistClient()
