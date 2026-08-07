import time
from typing import Optional, List, Dict, Any, Callable, Tuple
from .config import get_config
from .anilist_auth import execute_graphql

# ---------------------------------------------------------------------------
# TTL Cache — a simple in-memory cache with time-to-live for discovery feeds
# and notifications.  Honours the 30 req/min degraded AniList rate limit by
# preventing repeated fetches of the same feed within the TTL window.
# ---------------------------------------------------------------------------


class TTLCache:
    """A minimal thread-safe-enough TTL cache for read-side feed results.

    ``ttl`` is the time-to-live in seconds.  Cached values expire after that
    window; expired entries are evicted lazily on access.
    """

    def __init__(self, ttl: int = 60):
        self.ttl = ttl
        self._store: Dict[str, Tuple[Any, float]] = {}

    def get(self, key: str) -> Optional[Any]:
        entry = self._store.get(key)
        if entry is None:
            return None
        value, expires_at = entry
        if time.time() > expires_at:
            # Lazy expiry
            del self._store[key]
            return None
        return value

    def set(self, key: str, value: Any) -> None:
        self._store[key] = (value, time.time() + self.ttl)

    def clear(self) -> None:
        """Drop all cached entries (e.g. after authentication changes)."""
        self._store.clear()

    def clear_key(self, key: str) -> None:
        self._store.pop(key, None)


def _cached(ttl: int = 60):
    """Decorator factory: cache a method's return value with ``ttl`` seconds.

    The cache key is derived from the bound instance + positional/keyword args
    so each argument combination gets its own slot.
    """
    def decorator(func: Callable) -> Callable:
        # Each decorated method gets its own TTLCache instance
        cache = TTLCache(ttl=ttl)

        def wrapper(self, *args, **kwargs):
            key_parts = [func.__name__]
            key_parts.extend(str(a) for a in args)
            key_parts.extend(f"{k}={v}" for k, v in sorted(kwargs.items()))
            key = "|".join(key_parts)

            cached = cache.get(key)
            if cached is not None:
                return cached

            result = func(self, *args, **kwargs)
            cache.set(key, result)
            return result

        wrapper._cache = cache  # exposed for testing (ttl expiry / clear)
        return wrapper

    return decorator


# PerPage constant — AniList API maximum is 50
PAGE_PER_PAGE = 50


class AnilistClient:
    def __init__(self):
        pass

    def _query(self, query: str, variables: Optional[Dict[str, Any]] = None, require_auth: bool = False) -> Optional[Dict[str, Any]]:
        """Sends a GraphQL POST request to AniList with retry, proxy, and auth handling.

        Delegates to the shared ``execute_graphql`` primitive in
        ``anilist_auth``, which centralises 429/Retry-After handling,
        auth-fallback logic (reads only), and fail-closed behaviour for
        mutations (``require_auth=True``).
        """
        return execute_graphql(query, variables, require_auth=require_auth)

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
                  description(asHtml: false)
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

    # ------------------------------------------------------------------
    # Section 4 read-side queries (spec: Animu-AniList-Client-Spec.md §4)
    # All below are READ-ONLY queries — no mutations.
    # ------------------------------------------------------------------

    # === Page rails (paginated media lists with MediaSort) ===

    def _page_media_query(self) -> str:
        """Shared Page query fragment for rails that return media nodes."""
        return """
        query($page: Int, $perPage: Int, $sort: [MediaSort], $search: String, $genre_in: [String], $tag_in: [String], $format_in: [MediaFormat], $status_in: [MediaStatus], $onList: Boolean, $season: MediaSeason, $seasonYear: Int, $year_greater: FuzzyDateInt, $year_lesser: FuzzyDateInt, $source: MediaSource, $countryOfOrigin: CountryCode, $averageScore_greater: Int, $averageScore_lesser: Int, $popularity_greater: Int, $popularity_lesser: Int, $idMal_in: [Int], $id_in: [Int]) {
          Page(page: $page, perPage: $perPage) {
            pageInfo {
              total
              perPage
              currentPage
              lastPage
              hasNextPage
            }
            media(type: ANIME, sort: $sort, search: $search, genre_in: $genre_in, tag_in: $tag_in,
              format_in: $format_in, status_in: $status_in, onList: $onList, season: $season,
              seasonYear: $seasonYear, startDate_greater: $year_greater, startDate_lesser: $year_lesser,
              source: $source, countryOfOrigin: $countryOfOrigin, averageScore_greater: $averageScore_greater,
              averageScore_lesser: $averageScore_lesser, popularity_greater: $popularity_greater,
              popularity_lesser: $popularity_lesser, idMal_in: $idMal_in, id_in: $id_in
            ) {
              id
              title { romaji english native }
              coverImage { extraLarge large medium color }
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
              nextAiringEpisode { id episode timeUntilAiring airingAt }
              mediaListEntry { id status progress score }
            }
          }
        }
        """

    @_cached(ttl=120)
    def get_discover_anime(self, type_str: str = "trending", page: int = 1, per_page: int = 20) -> Dict[str, Any]:
        """Fetch paginated anime discovery feed (trending, popular, or top).

        TTL-cached: results are cached for 120 seconds to respect the degraded
        30 req/min rate limit.  ``per_page`` is capped at PAGE_PER_PAGE (50).
        """
        per_page = min(per_page, PAGE_PER_PAGE)
        sort_map = {
            "trending": ["TRENDING_DESC", "POPULARITY_DESC"],
            "popular": ["POPULARITY_DESC"],
            "top": ["SCORE_DESC"],
            "upcoming": ["DATE_DESC", "POPULARITY_DESC"],
            "seasonal": ["SEASON_DESC", "POPULARITY_DESC"],
        }
        sort = sort_map.get(type_str.lower(), ["TRENDING_DESC", "POPULARITY_DESC"])

        query = self._page_media_query()
        resp = self._query(query, {"page": page, "perPage": per_page, "sort": sort})
        if resp and "data" in resp and resp["data"] and "Page" in resp["data"]:
            return resp["data"]["Page"]
        return {"pageInfo": {"total": 0, "perPage": per_page, "currentPage": page, "lastPage": 1, "hasNextPage": False}, "media": []}

    @_cached(ttl=120)
    def get_media_trend(self, page: int = 1, per_page: int = 50, date: Optional[int] = None,
                        trending_greater: Optional[int] = None, averageScore_greater: Optional[int] = None,
                        popularity_greater: Optional[int] = None) -> Dict[str, Any]:
        """Query MediaTrend — daily trending/popularity/score per media."""
        per_page = min(per_page, PAGE_PER_PAGE)
        query = """
        query($page: Int, $perPage: Int, $date: Int, $trending_greater: Int, $averageScore_greater: Int, $popularity_greater: Int, $sort: [MediaTrendSort]) {
          Page(page: $page, perPage: $perPage) {
            pageInfo { total perPage currentPage lastPage hasNextPage }
            mediaTrend(date: $date, trending_greater: $trending_greater, averageScore_greater: $averageScore_greater, popularity_greater: $popularity_greater) {
              mediaId date trending averageScore popularity episode releasing
              media {
                id title { romaji english native } coverImage { large medium } format status episodes
              }
            }
          }
        }
        """
        variables: Dict[str, Any] = {"page": page, "perPage": per_page, "date": date,
                                      "trending_greater": trending_greater,
                                      "averageScore_greater": averageScore_greater,
                                      "popularity_greater": popularity_greater,
                                      "sort": ["DATE_DESC"]}
        resp = self._query(query, variables)
        if resp and "data" in resp and resp["data"] and "Page" in resp["data"]:
            return resp["data"]["Page"]
        return {"pageInfo": {"total": 0, "perPage": per_page, "currentPage": page, "lastPage": 1, "hasNextPage": False}, "media": []}

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

    @_cached(ttl=300)
    def get_airing_schedule_by_id(self, media_id: int, page: int = 1, per_page: int = 25) -> Optional[Dict[str, Any]]:
        """Retrieve airing schedule with full node data for a specific media."""
        query = """
        query($id: Int, $page: Int, $perPage: Int) {
          Media(id: $id) {
            title { romaji english native }
            airingSchedule(page: $page, perPage: $perPage) {
              nodes {
                id episode airingAt timeUntilAiring
              }
            }
          }
        }
        """
        resp = self._query(query, {"id": media_id, "page": page, "perPage": per_page})
        if resp and "data" in resp and resp["data"]:
            media = resp["data"].get("Media")
            if media:
                return media.get("airingSchedule")
        return None

    def get_character(self, char_id: int) -> Optional[Dict[str, Any]]:
        """Retrieve detailed character information by ID."""
        query = """
        query($id: Int) {
          Character(id: $id) {
            id name { first last native alternative }
            image { large medium }
            description
            isBirthday
            age
            bloodType
            zodiacSign
            birthday { year month day }
            media {
              nodes {
                id title { romaji english native }
                role
                dubbingLanguage
              }
            }
          }
        }
        """
        resp = self._query(query, {"id": char_id})
        if resp and "data" in resp and resp["data"]:
            return resp["data"].get("Character")
        return None

    @_cached(ttl=300)
    def search_characters(self, query_text: str, page: int = 1, per_page: int = 50) -> Dict[str, Any]:
        """Search characters with pagination (perPage capped at 50)."""
        per_page = min(per_page, PAGE_PER_PAGE)
        graphql_query = """
        query($search: String, $page: Int, $perPage: Int) {
          Page(page: $page, perPage: $perPage) {
            pageInfo { total perPage currentPage lastPage hasNextPage }
            characters(search: $search) {
              id name { first last native alternative }
              image { large medium }
              description
              isBirthday
              media {
                nodes { id title { romaji } role }
              }
            }
          }
        }
        """
        resp = self._query(graphql_query, {"search": query_text, "page": page, "perPage": per_page})
        if resp and "data" in resp and resp["data"] and "Page" in resp["data"]:
            return resp["data"]["Page"]
        return {"pageInfo": {"total": 0, "perPage": per_page, "currentPage": page, "lastPage": 1, "hasNextPage": False}, "characters": []}

    def get_staff(self, staff_id: int) -> Optional[Dict[str, Any]]:
        """Retrieve detailed staff information by ID."""
        query = """
        query($id: Int) {
          Staff(id: $id) {
            id name { first last native alternative }
            image { large medium }
            description
            isBirthday
            languageValse
            primaryLanguage
            dateOfBirth { year month day }
            dateOfDeath { year month day }
            age
            bloodType
            zodiacSign
            gender
            homeTown
            country
            birthplace { id name }
            staffMedia {
              nodes {
                id title { romaji english native }
                role
              }
            }
            charactersMedia {
              nodes {
                id title { romaji english native }
                role
                voiceElements { role media { id title { romaji } } }
              }
            }
          }
        }
        """
        resp = self._query(query, {"id": staff_id})
        if resp and "data" in resp and resp["data"]:
            return resp["data"].get("Staff")
        return None

    @_cached(ttl=300)
    def search_staff(self, query_text: str, page: int = 1, per_page: int = 50) -> Dict[str, Any]:
        """Search staff members with pagination."""
        per_page = min(per_page, PAGE_PER_PAGE)
        graphql_query = """
        query($search: String, $page: Int, $perPage: Int) {
          Page(page: $page, perPage: $perPage) {
            pageInfo { total perPage currentPage lastPage hasNextPage }
            staff(search: $search) {
              id name { first last native alternative }
              image { large medium }
              primaryLanguage
              languageValse
              birthplace { name }
              staffMedia {
                nodes { id title { romaji } role }
              }
            }
          }
        }
        """
        resp = self._query(graphql_query, {"search": query_text, "page": page, "perPage": per_page})
        if resp and "data" in resp and resp["data"] and "Page" in resp["data"]:
            return resp["data"]["Page"]
        return {"pageInfo": {"total": 0, "perPage": per_page, "currentPage": page, "lastPage": 1, "hasNextPage": False}, "staff": []}

    def get_studio(self, studio_id: int) -> Optional[Dict[str, Any]]:
        """Retrieve detailed studio information by ID."""
        query = """
        query($id: Int) {
          Studio(id: $id) {
            id name
            media {
              nodes {
                id title { romaji english native }
                coverImage { large medium }
                popularity
                averageScore
                format
                status
                startDate { year season }
              }
            }
          }
        }
        """
        resp = self._query(query, {"id": studio_id})
        if resp and "data" in resp and resp["data"]:
            return resp["data"].get("Studio")
        return None

    @_cached(ttl=300)
    def search_studios(self, query_text: str, page: int = 1, per_page: int = 50) -> Dict[str, Any]:
        """Search studios with pagination."""
        per_page = min(per_page, PAGE_PER_PAGE)
        graphql_query = """
        query($search: String, $page: Int, $perPage: Int) {
          Page(page: $page, perPage: $perPage) {
            pageInfo { total perPage currentPage lastPage hasNextPage }
            studios(search: $search) {
              id name
              media {
                nodes { id title { romaji } popularity averageScore format }
              }
            }
          }
        }
        """
        resp = self._query(graphql_query, {"search": query_text, "page": page, "perPage": per_page})
        if resp and "data" in resp and resp["data"] and "Page" in resp["data"]:
            return resp["data"]["Page"]
        return {"pageInfo": {"total": 0, "perPage": per_page, "currentPage": page, "lastPage": 1, "hasNextPage": False}, "studios": []}

    # === MediaListCollection (chunked) ===

    def _media_list_collection_query(self) -> str:
        """Shared query for MediaListCollection — fetches full media list for a user.

        The API supports ``chunk`` and ``perChunk`` (max 500) to paginate large
        lists.  This method fetches all chunks and merges them.
        """
        return """
        query($userName: String, $type: MediaType, $status_in: [MediaListStatus], $chunk: Int, $perChunk: Int, $forceSingleCompletedList: Boolean, $sort: [MediaListSort]) {
          MediaListCollection(
            userName: $userName, type: $type, status_in: $status_in,
            chunk: $chunk, perChunk: $perChunk,
            forceSingleCompletedList: $forceSingleCompletedList, sort: $sort
          ) {
            lists {
              name
              isCustomList
              status
              entries {
                id
                mediaId
                progress
                progressVolumes
                repeat
                score(format: POINT_100)
                priority
                private
                notes
                hiddenFromStatusLists
                customLists
                startedAt { year month day }
                completedAt { year month day }
                media {
                  id title { romaji english native }
                  coverImage { extraLarge large medium color }
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
                  tags { name }
                  description
                  nextAiringEpisode { id episode timeUntilAiring airingAt }
                }
              }
            }
            hasNextChunk
          }
        }
        """

    def get_media_list_collection(
        self,
        user_name: Optional[str] = None,
        media_type: str = "ANIME",
        status_in: Optional[List[str]] = None,
        per_chunk: int = 500,
        force_single_completed_list: bool = True,
        sort: Optional[List[str]] = None,
    ) -> Dict[str, Any]:
        """Fetch the full MediaListCollection for a user, handling chunked pagination.

        The AniList API paginates large lists via ``chunk``/``perChunk`` (max 500).
        This method iterates through all chunks, merging the ``lists`` arrays.
        """
        per_chunk = min(per_chunk, 500)
        config = get_config()
        if not user_name:
            user_name = config.ani_user_name

        if not user_name:
            return {"lists": [], "hasNextChunk": False}

        variables = {
            "userName": user_name,
            "type": media_type,
            "perChunk": per_chunk,
            "chunk": 0,
            "forceSingleCompletedList": force_single_completed_list,
        }
        if status_in is not None:
            variables["status_in"] = status_in
        if sort:
            variables["sort"] = sort

        all_lists: List[Dict[str, Any]] = []
        has_next_chunk = True
        max_chunks = 10  # Safety guard — prevents infinite loops
        chunk = 0

        while has_next_chunk and chunk < max_chunks:
            variables["chunk"] = chunk
            resp = self._query(self._media_list_collection_query(), variables)
            if not resp or "data" not in resp:
                break
            data = resp["data"]
            if not data or "MediaListCollection" not in data or not data["MediaListCollection"]:
                break

            collection = data["MediaListCollection"]
            lists = collection.get("lists", [])
            all_lists.extend(lists)
            has_next_chunk = collection.get("hasNextChunk", False)
            chunk += 1

        return {"lists": all_lists, "hasNextChunk": False}

    # === GenreCollection ===

    @_cached(ttl=600)
    def get_genre_collection(self) -> List[str]:
        """Fetch all available media genres from AniList."""
        query = """
        query {
          GenreCollection
        }
        """
        resp = self._query(query)
        if resp and "data" in resp and resp["data"]:
            return resp["data"].get("GenreCollection", []) or []
        return []

    # === MediaTagCollection ===

    @_cached(ttl=600)
    def get_media_tag_collection(self) -> List[Dict[str, Any]]:
        """Fetch all media tags (with rank/category info) from AniList."""
        query = """
        query {
          MediaTagCollection {
            id name description category rank isAdult
          }
        }
        """
        resp = self._query(query)
        if resp and "data" in resp and resp["data"]:
            return resp["data"].get("MediaTagCollection", []) or []
        return []

    # === User / Viewer ===

    def get_user(self, user_id: Optional[int] = None, user_name: Optional[str] = None) -> Optional[Dict[str, Any]]:
        """Retrieve a user by ID or name."""
        query = """
        query($id: Int, $name: String) {
          User(id: $id, name: $name) {
            id name about avatar { large medium } bannerImage
            isFollowing isFollower
            stats {
              count
              meanScore
              episodesWatched
              chaptersRead
              minutesWatched
              volumesRead
              genres { genre meanScore count }
              tags { tag meanScore count }
              advancedScores { amount }
              status { watching completed paused dropped planning }
            }
            favourites {
              anime { nodes { id title { romaji } } }
              manga { nodes { id title { romaji } } }
            }
            createdAt updatedAt
          }
        }
        """
        variables: Dict[str, Any] = {"id": user_id, "name": user_name}
        resp = self._query(query, variables)
        if resp and "data" in resp and resp["data"]:
            return resp["data"].get("User")
        return None

    def get_viewer(self) -> Optional[Dict[str, Any]]:
        """Retrieve the currently authenticated user (Viewer)."""
        query = """
        query {
          Viewer {
            id name about avatar { large medium } bannerImage
            isFollowing isFollower
            stats {
              count meanScore episodesWatched chaptersRead minutesWatched volumesRead
              genres { genre meanScore count }
              tags { tag meanScore count }
              advancedScores { amount }
              status { watching completed paused dropped planning }
            }
            favourites {
              anime { nodes { id title { romaji } } }
              manga { nodes { id title { romaji } } }
            }
            createdAt updatedAt
          }
        }
        """
        resp = self._query(query)
        if resp and "data" in resp and resp["data"]:
            return resp["data"].get("Viewer")
        return None

    # === Search users ===

    @_cached(ttl=300)
    def search_users(self, query_text: str, page: int = 1, per_page: int = 50) -> Dict[str, Any]:
        """Search users with pagination."""
        per_page = min(per_page, PAGE_PER_PAGE)
        graphql_query = """
        query($search: String, $page: Int, $perPage: Int) {
          Page(page: $page, perPage: $perPage) {
            pageInfo { total perPage currentPage lastPage hasNextPage }
            users(search: $search) {
              id name about avatar { large medium } stats { count meanScore }
            }
          }
        }
        """
        resp = self._query(graphql_query, {"search": query_text, "page": page, "perPage": per_page})
        if resp and "data" in resp and resp["data"] and "Page" in resp["data"]:
            return resp["data"]["Page"]
        return {"pageInfo": {"total": 0, "perPage": per_page, "currentPage": page, "lastPage": 1, "hasNextPage": False}, "users": []}

    # === Notification (all 20 types) ===

    # The 20 NotificationType enum values, per docs.anilist.co/reference/enum/notificationtype
    NOTIFICATION_TYPES = [
        "ACTIVITY_MESSAGE",
        "ACTIVITY_REPLY",
        "FOLLOWING",
        "ACTIVITY_MENTION",
        "THREAD_COMMENT_MENTION",
        "THREAD_SUBSCRIBED",
        "THREAD_COMMENT_REPLY",
        "AIRING",
        "ACTIVITY_LIKE",
        "ACTIVITY_REPLY_LIKE",
        "THREAD_LIKE",
        "THREAD_COMMENT_LIKE",
        "ACTIVITY_REPLY_SUBSCRIBED",
        "RELATED_MEDIA_ADDITION",
        "MEDIA_DATA_CHANGE",
        "MEDIA_MERGE",
        "MEDIA_DELETION",
        "MEDIA_SUBMISSION_UPDATE",
        "STAFF_SUBMISSION_UPDATE",
        "CHARACTER_SUBMISSION_UPDATE",
    ]

    # Maps NotificationType enum values to their GraphQL union member names
    # (e.g. ACTIVITY_MESSAGE -> ActivityMessageNotification)
    _NOTIFICATION_FRAGMENT_MAP = {
        "ACTIVITY_MESSAGE": "ActivityMessageNotification",
        "ACTIVITY_REPLY": "ActivityReplyNotification",
        "FOLLOWING": "FollowingNotification",
        "ACTIVITY_MENTION": "ActivityMentionNotification",
        "THREAD_COMMENT_MENTION": "ThreadCommentMentionNotification",
        "THREAD_SUBSCRIBED": "ThreadSubscribedNotification",
        "THREAD_COMMENT_REPLY": "ThreadCommentReplyNotification",
        "AIRING": "AiringNotification",
        "ACTIVITY_LIKE": "ActivityLikeNotification",
        "ACTIVITY_REPLY_LIKE": "ActivityReplyLikeNotification",
        "THREAD_LIKE": "ThreadLikeNotification",
        "THREAD_COMMENT_LIKE": "ThreadCommentLikeNotification",
        "ACTIVITY_REPLY_SUBSCRIBED": "ActivityReplySubscribedNotification",
        "RELATED_MEDIA_ADDITION": "RelatedMediaAdditionNotification",
        "MEDIA_DATA_CHANGE": "MediaDataChangeNotification",
        "MEDIA_MERGE": "MediaMergeNotification",
        "MEDIA_DELETION": "MediaDeletionNotification",
        "MEDIA_SUBMISSION_UPDATE": "MediaSubmissionUpdateNotification",
        "STAFF_SUBMISSION_UPDATE": "StaffSubmissionUpdateNotification",
        "CHARACTER_SUBMISSION_UPDATE": "CharacterSubmissionUpdateNotification",
    }

    @_cached(ttl=60)
    def get_notifications(
        self,
        page: int = 1,
        per_page: int = 50,
        notification_type: Optional[str] = None,
        reset_notification_count: bool = False,
    ) -> Dict[str, Any]:
        """Fetch the authenticated user's notifications.

        Supports filtering by type (any of the 20 NOTIFICATION_TYPES).
        TTL-cached for 60 seconds — notifications are polled, not pushed.
        """
        per_page = min(per_page, PAGE_PER_PAGE)
        query = """
        query($page: Int, $perPage: Int, $type: NotificationType, $resetNotificationCount: Boolean) {
          Page(page: $page, perPage: $perPage) {
            pageInfo { total perPage currentPage lastPage hasNextPage }
            notifications(type: $type, resetNotificationCount: $resetNotificationCount) {
              ... on AiringNotification { id type createdAt episode media { id title { romaji } } }
              ... on ActivityMessageNotification { id type createdAt message { id text user { name } } }
              ... on ActivityReplyNotification { id type createdAt reply { id text user { name } activity { id type } } }
              ... on FollowingNotification { id type createdAt follower { id name } }
              ... on ActivityMentionNotification { id type createdAt account { name } activity { id type } }
              ... on ThreadCommentMentionNotification { id type createdAt user { name } thread { id title } comment { id } }
              ... on ThreadSubscribedNotification { id type createdAt user { name } thread { id title } comment { id } }
              ... on ThreadCommentReplyNotification { id type createdAt user { name } thread { id title } comment { id text } }
              ... on ActivityLikeNotification { id type createdAt liker { name } activity { id type } }
              ... on ActivityReplyLikeNotification { id type createdAt liker { name } activity { id type } reply { id text } }
              ... on ThreadLikeNotification { id type createdAt liker { name } thread { id title } }
              ... on ThreadCommentLikeNotification { id type createdAt liker { name } thread { id title } comment { id text } }
              ... on ActivityReplySubscribedNotification { id type createdAt user { name } activity { id type } reply { id } }
              ... on RelatedMediaAdditionNotification { id type createdAt media { id title { romaji } } }
              ... on MediaDataChangeNotification { id type createdAt media { id title { romaji } } }
              ... on MediaMergeNotification { id type createdAt media { id title { romaji } } newMediaId }
              ... on MediaDeletionNotification { id type createdAt mediaId deletedMediaTitle }
              ... on MediaSubmissionUpdateNotification { id type createdAt status }
              ... on StaffSubmissionUpdateNotification { id type createdAt status }
              ... on CharacterSubmissionUpdateNotification { id type createdAt status }
            }
          }
        }
        """
        variables = {"page": page, "perPage": per_page, "type": notification_type,
                      "resetNotificationCount": reset_notification_count}
        resp = self._query(query, variables)
        if resp and "data" in resp and resp["data"] and "Page" in resp["data"]:
            return resp["data"]["Page"]
        return {"pageInfo": {"total": 0, "perPage": per_page, "currentPage": page, "lastPage": 1, "hasNextPage": False}, "notifications": []}

    # === Review ===

    @_cached(ttl=300)
    def get_reviews(self, media_id: Optional[int] = None, user_id: Optional[int] = None,
                    media_type: str = "ANIME", page: int = 1, per_page: int = 50,
                    sort: Optional[List[str]] = None) -> Dict[str, Any]:
        """Fetch reviews, optionally filtered by media or user."""
        per_page = min(per_page, PAGE_PER_PAGE)
        query = """
        query($id: Int, $mediaId: Int, $userId: Int, $mediaType: MediaType, $page: Int, $perPage: Int, $sort: [ReviewSort]) {
          Page(page: $page, perPage: $perPage) {
            pageInfo { total perPage currentPage lastPage hasNextPage }
            reviews(reviewId: $id, mediaId: $mediaId, userId: $userId, mediaType: $mediaType, sort: $sort) {
              id
              summary
              content
              score
              rating
              ratingAmount
              private
              created_at
              updated_at
              user { id name avatar { large medium } }
              media { id title { romaji english native } coverImage { large medium } }
              siteUrl
            }
          }
        }
        """
        variables = {"id": None, "mediaId": media_id, "userId": user_id,
                      "mediaType": media_type, "page": page, "perPage": per_page, "sort": sort}
        resp = self._query(query, variables)
        if resp and "data" in resp and resp["data"] and "Page" in resp["data"]:
            return resp["data"]["Page"]
        return {"pageInfo": {"total": 0, "perPage": per_page, "currentPage": page, "lastPage": 1, "hasNextPage": False}, "reviews": []}

    # === Activity / ActivityReply ===

    @_cached(ttl=60)
    def get_activity_feed(
        self,
        page: int = 1,
        per_page: int = 30,
        user_id: Optional[int] = None,
        messenger_id: Optional[int] = None,
        media_id: Optional[int] = None,
        activity_type: Optional[str] = None,
        is_following: bool = True,
        has_replies: bool = False,
    ) -> Dict[str, Any]:
        """Fetch the activity feed, optionally filtered."""
        per_page = min(per_page, PAGE_PER_PAGE)
        query = """
        query($page: Int, $perPage: Int, $userId: Int, $messengerId: Int, $mediaId: Int, $type: ActivityType, $isFollowing: Boolean, $hasReplies: Boolean, $hasRepliesOrTypeText: Boolean, $createdAtgreater: Int, $createdAtlesser: Int, $sort: [ActivitySort]) {
          Page(page: $page, perPage: $perPage) {
            pageInfo { total perPage currentPage lastPage hasNextPage }
            activities(userId: $userId, messengerId: $messengerId, mediaId: $mediaId, type: $type, isFollowing: $isFollowing, hasReplies: $hasReplies, hasRepliesOrTypeText: $hasRepliesOrTypeText, createdAt_greater: $createdAtgreater, createdAt_lesser: $createdAtlesser, sort: $sort) {
              ... on Activity {
                id type text locked pinned isFollowingLike isLikedByMe
                createdAt updatedAt
                user { id name avatar { large medium } stats { count } }
                media { id title { romaji english native } coverImage { large medium } }
              }
              ... on ListActivity {
                id type text locked pinned isFollowingLike isLikedByMe
                progress status
                createdAt updatedAt
                user { id name avatar { large medium } }
                media { id title { romaji english native } coverImage { large medium } }
              }
              ... on MessageActivity {
                id type text locked pinned isFollowingLike isLikedByMe
                message { id text }
                recipient { id name }
                sender { id name avatar { large medium } }
                createdAt updatedAt
                user { id name avatar { large medium } }
                media { id title { romaji english native } coverImage { large medium } }
              }
              ... on ActivityReply {
                id text locked isLikedByMe likeCount createdAt
                user { id name avatar { large medium } }
              }
            }
          }
        }
        """
        variables = {"page": page, "perPage": per_page, "userId": user_id,
                      "messengerId": messenger_id, "mediaId": media_id, "type": activity_type,
                      "isFollowing": is_following, "hasReplies": has_replies,
                      "hasRepliesOrTypeText": False, "createdAtgreater": None,
                      "createdAtlesser": None, "sort": ["CUT_OFF"]}
        resp = self._query(query, variables)
        if resp and "data" in resp and resp["data"] and "Page" in resp["data"]:
            return resp["data"]["Page"]
        return {"pageInfo": {"total": 0, "perPage": per_page, "currentPage": page, "lastPage": 1, "hasNextPage": False}, "activities": []}

    # === Following / Follower ===

    def get_following(self, user_id: int, page: int = 1, per_page: int = 50,
                      sort: Optional[List[str]] = None) -> Dict[str, Any]:
        """Retrieve users that a given user is following."""
        per_page = min(per_page, PAGE_PER_PAGE)
        query = """
        query($userId: Int!, $page: Int, $perPage: Int, $sort: [UserSort]) {
          Page(page: $page, perPage: $perPage) {
            pageInfo { total perPage currentPage lastPage hasNextPage }
            following(userId: $userId, sort: $sort) {
              id name about avatar { large medium } stats { count }
              isFollowing isFollower
            }
          }
        }
        """
        variables = {"userId": user_id, "page": page, "perPage": per_page, "sort": sort}
        resp = self._query(query, variables)
        if resp and "data" in resp and resp["data"] and "Page" in resp["data"]:
            return resp["data"]["Page"]
        return {"pageInfo": {"total": 0, "perPage": per_page, "currentPage": page, "lastPage": 1, "hasNextPage": False}, "following": []}

    def get_followers(self, user_id: int, page: int = 1, per_page: int = 50,
                      sort: Optional[List[str]] = None) -> Dict[str, Any]:
        """Retrieve users following a given user."""
        per_page = min(per_page, PAGE_PER_PAGE)
        query = """
        query($userId: Int!, $page: Int, $perPage: Int, $sort: [UserSort]) {
          Page(page: $page, perPage: $perPage) {
            pageInfo { total perPage currentPage lastPage hasNextPage }
            followers(userId: $userId, sort: $sort) {
              id name about avatar { large medium } stats { count }
              isFollowing isFollower
            }
          }
        }
        """
        variables = {"userId": user_id, "page": page, "perPage": per_page, "sort": sort}
        resp = self._query(query, variables)
        if resp and "data" in resp and resp["data"] and "Page" in resp["data"]:
            return resp["data"]["Page"]
        return {"pageInfo": {"total": 0, "perPage": per_page, "currentPage": page, "lastPage": 1, "hasNextPage": False}, "followers": []}

    # === Thread / ThreadComment ===

    def get_thread(self, thread_id: int) -> Optional[Dict[str, Any]]:
        """Retrieve a forum thread by ID."""
        query = """
        query($id: Int) {
          Thread(id: $id) {
            id title body commentCount viewCount likedCount scoreLocked
            pinned locked
            createdAt updatedAt
            user { id name about avatar { large medium } }
            media { id title { romaji english native } }
          }
        }
        """
        resp = self._query(query, {"id": thread_id})
        if resp and "data" in resp and resp["data"]:
            return resp["data"].get("Thread")
        return None

    @_cached(ttl=60)
    def get_threads(
        self,
        page: int = 1,
        per_page: int = 50,
        user_id: Optional[int] = None,
        reply_user_id: Optional[int] = None,
        category_id: Optional[int] = None,
        subscribed: bool = False,
        search: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Search forum threads with pagination."""
        per_page = min(per_page, PAGE_PER_PAGE)
        query = """
        query($page: Int, $perPage: Int, $userId: Int, $replyUserId: Int, $categoryId: Int, $subscribed: Boolean, $search: String, $sort: [ThreadSort]) {
          Page(page: $page, perPage: $perPage) {
            pageInfo { total perPage currentPage lastPage hasNextPage }
            threads(userId: $userId, replyUserId: $replyUserId, categoryId: $categoryId, subscribed: $subscribed, search: $search, sort: $sort) {
              id title commentCount viewCount likedCount
              pinned locked createdAt updatedAt
              user { id name }
              media { id title { romaji } }
            }
          }
        }
        """
        variables = {"page": page, "perPage": per_page, "userId": user_id,
                      "replyUserId": reply_user_id, "categoryId": category_id,
                      "subscribed": subscribed, "search": search,
                      "sort": ["CUT_OFF_DESC", "POPULARITY_DESC"]}
        resp = self._query(query, variables)
        if resp and "data" in resp and resp["data"] and "Page" in resp["data"]:
            return resp["data"]["Page"]
        return {"pageInfo": {"total": 0, "perPage": per_page, "currentPage": page, "lastPage": 1, "hasNextPage": False}, "threads": []}

    def get_thread_comments(self, thread_id: int, page: int = 1, per_page: int = 50) -> Dict[str, Any]:
        """Fetch comments for a thread."""
        per_page = min(per_page, PAGE_PER_PAGE)
        query = """
        query($threadId: Int!, $page: Int, $perPage: Int, $sort: [ThreadCommentSort]) {
          Page(page: $page, perPage: $perPage) {
            pageInfo { total perPage currentPage lastPage hasNextPage }
            threadComments(threadId: $threadId, sort: $sort) {
              id comment
              locked
              createdAt updatedAt
              user { id name avatar { large medium } }
              childComments {
                id comment createdAt
                user { id name }
              }
            }
          }
        }
        """
        resp = self._query(query, {"threadId": thread_id, "page": page, "perPage": per_page, "sort": ["CREATED_AT_DESC"]})
        if resp and "data" in resp and resp["data"] and "Page" in resp["data"]:
            return resp["data"]["Page"]
        return {"pageInfo": {"total": 0, "perPage": per_page, "currentPage": page, "lastPage": 1, "hasNextPage": False}, "threadComments": []}

    # === Recommendation ===

    @_cached(ttl=300)
    def get_recommendations(self, media_id: Optional[int] = None, user_id: Optional[int] = None,
                           page: int = 1, per_page: int = 50, sort: Optional[List[str]] = None) -> Dict[str, Any]:
        """Fetch recommendations, optionally filtered by media or user."""
        per_page = min(per_page, PAGE_PER_PAGE)
        query = """
        query($mediaId: Int, $userId: Int, $page: Int, $perPage: Int, $sort: [RecommendationSort], $onList: Boolean, $rating_greater: Int) {
          Page(page: $page, perPage: $perPage) {
            pageInfo { total perPage currentPage lastPage hasNextPage }
            recommendations(mediaId: $mediaId, userId: $userId, onList: $onList, rating_greater: $rating_greater, sort: $sort) {
              id rating amount
              media { id title { romaji english native } coverImage { large medium } }
              mediaRecommendation { id title { romaji english native } type }
              user { id name }
            }
          }
        }
        """
        variables = {"mediaId": media_id, "userId": user_id, "page": page,
                      "perPage": per_page, "sort": sort or ["RATING_DESC"],
                      "onList": None, "rating_greater": None}
        resp = self._query(query, variables)
        if resp and "data" in resp and resp["data"] and "Page" in resp["data"]:
            return resp["data"]["Page"]
        return {"pageInfo": {"total": 0, "perPage": per_page, "currentPage": page, "lastPage": 1, "hasNextPage": False}, "recommendations": []}

    # === Markdown ===

    def get_markdown_html(self, markdown_text: str) -> Optional[str]:
        """Convert AniList markdown to HTML (requires auth)."""
        query = """
        query($markdown: String!) {
          Markdown(markdown: $markdown) {
            html
          }
        }
        """
        resp = self._query(query, {"markdown": markdown_text}, require_auth=True)
        if resp and "data" in resp and resp["data"]:
            md = resp["data"].get("Markdown")
            if md:
                return md.get("html")
        return None

    # === SiteStatistics ===

    @_cached(ttl=600)
    def get_site_statistics(self) -> Optional[Dict[str, Any]]:
        """Fetch site-wide AniList statistics."""
        query = """
        query {
          SiteStatistics {
            documents
            anime {
              count
              meanScore
              genres { genre meanScore count }
              tags { tag meanScore count }
              advancedScores { amount }
              status { releasing complete paused hiatus abandoned }
              length {
                under15 15to30 30to60 60to90 90to120 over120
              }
              format { tv tvShort movie special ova ona ncop ncod }
              score {
                10 20 30 40 50 60 70 80 90 100
              }
            }
            manga {
              count
              meanScore
              genres { genre meanScore count }
              tags { tag meanScore count }
              advancedScores { amount }
              status { releasing complete frozen }
              length {
                under5 5to10 10to20 20to30 30to50 50to100 over100
              }
              format { novel manga oneShot }
              score {
                10 20 30 40 50 60 70 80 90 100
              }
            }
            users
            staff
            studios
            reviews
            forums
            animeUpdates
            mangaUpdates
            createdAt updatedAt
          }
        }
        """
        resp = self._query(query)
        if resp and "data" in resp and resp["data"]:
            return resp["data"].get("SiteStatistics")
        return None

    # === AniChartUser ===

    def get_anichart_user(self, user_id: int) -> Optional[Dict[str, Any]]:
        """Fetch AniChart settings/highlights for a user."""
        query = """
        query($id: Int) {
          AniChartUser(id: $id) {
            highlightIds
            sort titleLanguage outgoingLinkProvider theme
          }
        }
        """
        resp = self._query(query, {"id": user_id})
        if resp and "data" in resp and resp["data"]:
            return resp["data"].get("AniChartUser")
        return None

    @classmethod
    def clear_all_caches(cls) -> None:
        """Clear all TTL caches on cached methods.

        Useful in tests or when the auth state changes and cached reads
        may no longer be valid (e.g. token refreshed → previously cached
        anonymous reads should be invalidated).
        """
        for attr_name in dir(cls):
            attr = getattr(cls, attr_name, None)
            if callable(attr) and hasattr(attr, "_cache"):
                attr._cache.clear()


anilist = AnilistClient()

# Re-export the mutations module so callers importing from ``anilist`` get the
# complete AniList client surface (reads + mutations) in one place.  The module
# is imported lazily here to avoid a circular import at module load time
# (anilist_mutations imports execute_graphql from anilist_auth, not anilist).
from .anilist_mutations import AniListMutations, mutations as anilist_mutations  # noqa: E402

# Expose a singleton on the client class for convenience, mirroring the
# ``anilist = AnilistClient()`` pattern above.
AnilistClient.mutations = anilist_mutations  # type: ignore[attr-defined]
