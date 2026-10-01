import httpx
import os
import json
import time
import threading
from typing import Optional, List, Dict, Any, Callable, Iterable
from .config import get_config
from .models import OfflineAnime
from .storage import atomic_write_json

# PocketBase endpoint and superuser login. Override with ANIMU_PB_URL /
# ANIMU_PB_IDENTITY / ANIMU_PB_PASSWORD; the literals below are only a
# transitional fallback for existing deployments and should be rotated.
PB_URL = os.environ.get("ANIMU_PB_URL", "https://pb.atoona.com")
PB_AUTH = {
    "identity": os.environ.get("ANIMU_PB_IDENTITY", "admin@atoona.com"),
    "password": os.environ.get("ANIMU_PB_PASSWORD", "pocketbase2024"),
}
SUPERUSERS_COLLECTION = "pbc_3142635823"
ANIME_COLLECTION = "anime"

# Fields PocketBase may not have in its schema. They are kept in the local
# cache regardless and only sent upstream when the schema probe lists them.
LOCAL_ONLY_FIELDS = ("preferred_release_group", "release_group_misses", "next_attempt_at")
_NON_PAYLOAD_KEYS = ("_unsynced", "_pending_delete", "collectionId", "collectionName", "id", "created", "updated")

# After this many consecutive transport failures PocketBase is treated as down
# for BREAKER_COOLDOWN seconds, so a dead server costs one timeout rather than
# one per record per cycle (the old behaviour also held the global lock).
BREAKER_THRESHOLD = 3
BREAKER_COOLDOWN = 60.0


class DatabaseUnavailable(Exception):
    """PocketBase cannot be trusted right now and no safe local fallback exists."""


class Database:
    def __init__(self):
        # verify=False prevents SSL certificate validation errors with self-signed certificates
        self.client = httpx.Client(verify=False, timeout=httpx.Timeout(10.0, connect=5.0))
        self.token: Optional[str] = None
        # Guards the in-memory cache and its file only. Never held across HTTP:
        # a slow PocketBase used to freeze every web request behind this lock.
        self._lock = threading.RLock()
        self._auth_lock = threading.Lock()
        self._record_locks: Dict[str, threading.RLock] = {}
        self._revs: Dict[str, int] = {}
        self._failures = 0
        self._breaker_until = 0.0
        # True when the last read had to fall back to the local cache.
        self.degraded = False

        # Local JSON cache configuration for resilience
        root_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
        self.local_db_path = os.path.join(root_dir, "logs", "offline_db.json")
        self.local_cache: Dict[str, Dict[str, Any]] = {}
        self.local_cache_valid = False
        self._cache_corrupt = False
        self._pb_schema_fields: Optional[set] = None
        self._load_local_cache()

    # ------------------------------------------------------------------ cache

    def _load_local_cache(self):
        """Loads database records mirrored in a local JSON cache file."""
        with self._lock:
            if os.path.exists(self.local_db_path):
                try:
                    with open(self.local_db_path, "r", encoding="utf-8") as f:
                        value = json.load(f)
                        if isinstance(value, dict):
                            self.local_cache = value
                            self.local_cache_valid = True
                            self._cache_corrupt = False
                except Exception as e:
                    self._cache_corrupt = True
                    print(f"Failed to load local DB cache: {e}")
            else:
                self.local_cache = {}

    def _save_local_cache(self):
        """Atomically persists the mirrored database state (compact JSON)."""
        with self._lock:
            try:
                atomic_write_json(self.local_db_path, self.local_cache)
                # A good file is on disk again; stop distrusting the cache.
                self._cache_corrupt = False
                self.local_cache_valid = True
            except Exception as e:
                print(f"Failed to save local DB cache: {e}")

    def _record_lock(self, key: str) -> threading.RLock:
        with self._lock:
            lock = self._record_locks.get(key)
            if lock is None:
                lock = self._record_locks[key] = threading.RLock()
            return lock

    def _bump_rev(self, key: str) -> int:
        rev = self._revs.get(key, 0) + 1
        self._revs[key] = rev
        return rev

    @staticmethod
    def _retain_local_fields(record: Dict[str, Any], cached: Dict[str, Any]) -> None:
        """Copy local-only fields PocketBase does not store back onto ``record``."""
        for field in LOCAL_ONLY_FIELDS:
            if field not in record and field in cached:
                record[field] = cached[field]

    # --------------------------------------------------------------- transport

    def auth(self) -> str:
        """Authenticate with PocketBase and store the auth token."""
        identity = PB_AUTH["identity"]
        password = PB_AUTH["password"]

        with self._auth_lock:
            resp = self.client.post(
                f"{PB_URL}/api/collections/{SUPERUSERS_COLLECTION}/auth-with-password",
                json={"identity": identity, "password": password}
            )
            resp.raise_for_status()
            self.token = resp.json()["token"]
            return self.token

    def _note_success(self) -> None:
        self._failures = 0
        self._breaker_until = 0.0

    def _note_failure(self) -> None:
        self._failures += 1
        if self._failures >= BREAKER_THRESHOLD:
            self._breaker_until = time.monotonic() + BREAKER_COOLDOWN

    def offline_safe_mode_available(self) -> bool:
        """Return whether the local cache is available for the documented fallback path."""
        return self.local_cache_valid and os.path.isfile(self.local_db_path)

    def _request(self, method: str, path: str, **kwargs) -> httpx.Response:
        """Send requests to PocketBase, handling authentication and automatic 401 token refresh."""
        if time.monotonic() < self._breaker_until:
            raise DatabaseUnavailable("PocketBase circuit breaker is open")

        try:
            if not self.token:
                self.auth()

            headers = kwargs.pop("headers", {})
            headers["Authorization"] = self.token

            resp = self.client.request(method, f"{PB_URL}{path}", headers=headers, **kwargs)
            if resp.status_code == 401:
                self.auth()
                headers["Authorization"] = self.token
                resp = self.client.request(method, f"{PB_URL}{path}", headers=headers, **kwargs)
            if resp.status_code >= 500:
                self._note_failure()
            else:
                self._note_success()
            return resp
        except Exception as e:
            self._note_failure()
            print(f"PocketBase HTTP request error: {e}")
            raise

    def probe_pb_schema(self, force: bool = False) -> set:
        """Queries PocketBase for the anime collection schema and caches supported field names."""
        if self._pb_schema_fields is not None and not force:
            return self._pb_schema_fields

        try:
            resp = self._request("GET", f"/api/collections/{ANIME_COLLECTION}")
            if resp.status_code == 200:
                data = resp.json()
                fields = set()
                schema_list = data.get("schema") or data.get("fields") or []
                if isinstance(schema_list, list):
                    for item in schema_list:
                        if isinstance(item, dict) and "name" in item:
                            fields.add(item["name"])
                self._pb_schema_fields = fields
                return self._pb_schema_fields
        except Exception as e:
            print(f"[PB_SCHEMA_WARNING] Schema probe failed, defaulting to basic fields: {e}")

        return self._pb_schema_fields if self._pb_schema_fields is not None else set()

    def _find_pb_record(self, media_id: int) -> Optional[Dict[str, Any]]:
        """Look a record up by media id. Raises unless PocketBase answered 200.

        A non-200 answer is *not* "no such record": treating it as one made
        callers POST a duplicate or silently skip a delete.
        """
        resp = self._request("GET", f"/api/collections/{ANIME_COLLECTION}/records",
                             params={"filter": f"media_id={media_id}"})
        if resp.status_code != 200:
            raise DatabaseUnavailable(f"PocketBase lookup returned HTTP {resp.status_code}")
        items = resp.json().get("items", [])
        return items[0] if items else None

    # ------------------------------------------------------------------ models

    def _to_offline_anime(self, rec: Dict[str, Any]) -> OfflineAnime:
        """Convert a raw DB/cache dict into an OfflineAnime model."""
        return OfflineAnime(
            media_id=rec["media_id"],
            downloaded_episodes=list(rec.get("downloaded_episodes", [])),
            starting_episode=rec.get("starting_episode", 0),
            alternative_title=rec.get("alternative_title", ""),
            timeouts=rec.get("timeouts", 0),
            max_timeouts=rec.get("max_timeouts", 0),
            pending_rewatching_update=rec.get("pending_rewatching_update", False),
            preferred_release_group=rec.get("preferred_release_group", ""),
            release_group_misses=rec.get("release_group_misses", 0),
            next_attempt_at=float(rec.get("next_attempt_at", 0.0) or 0.0),
        )

    @staticmethod
    def _payload_from_model(anime_data: OfflineAnime) -> Dict[str, Any]:
        return {
            "media_id": anime_data.media_id,
            "downloaded_episodes": anime_data.downloaded_episodes,
            "starting_episode": anime_data.starting_episode,
            "alternative_title": anime_data.alternative_title,
            "timeouts": anime_data.timeouts,
            "max_timeouts": anime_data.max_timeouts,
            "pending_rewatching_update": anime_data.pending_rewatching_update,
            "preferred_release_group": anime_data.preferred_release_group,
            "release_group_misses": anime_data.release_group_misses,
            "next_attempt_at": anime_data.next_attempt_at,
        }

    # ------------------------------------------------------------------- reads

    def get_local(self, media_id: int) -> Optional[OfflineAnime]:
        """Read a record from the local mirror only: no network, no file write."""
        with self._lock:
            cached = self.local_cache.get(str(media_id))
            if cached and not cached.get("_pending_delete"):
                return self._to_offline_anime(cached)
        return None

    def get(self, media_id: int) -> Optional[OfflineAnime]:
        """Fetch an anime record by its AniList media ID.

        The local cache is treated as authoritative: a locally-stored,
        unsynced entry is never overwritten by a (possibly stale/empty)
        PocketBase response. This prevents downloaded-episode progress from
        being silently lost when PocketBase writes fail.
        """
        media_id_str = str(media_id)
        try:
            resp = self._request("GET", f"/api/collections/{ANIME_COLLECTION}/records", params={"filter": f"media_id={media_id}"})
            if resp.status_code != 200:
                raise DatabaseUnavailable(f"HTTP {resp.status_code}")
            items = resp.json().get("items", [])
        except Exception as e:
            print(f"PocketBase get failed, falling back to local cache: {e}")
            return self.get_local(media_id)

        with self._lock:
            cached = self.local_cache.get(media_id_str)
            if items:
                record = items[0]
                # Local unsynced data is newer than PocketBase: keep it.
                if cached and cached.get("_unsynced"):
                    return self._to_offline_anime(cached)
                if cached:
                    self._retain_local_fields(record, cached)
                    # Keep local progress if it is richer; adopt PB id.
                    if len(cached.get("downloaded_episodes", [])) > len(record.get("downloaded_episodes", [])):
                        changed = cached.get("id") != record.get("id") and "id" in record
                        if "id" in record:
                            cached["id"] = record["id"]
                        chosen = cached
                    else:
                        changed = record != cached
                        chosen = record
                    self.local_cache[media_id_str] = chosen
                    if changed:
                        self._save_local_cache()
                    return self._to_offline_anime(chosen)
                self.local_cache[media_id_str] = record
                self._save_local_cache()
                return self._to_offline_anime(record)
            # PocketBase has no record. Keep any local entry (it is unsynced).
            if cached:
                return self._to_offline_anime(cached)
            return None

    def _fetch_all_pb(self) -> List[Dict[str, Any]]:
        """Fetch every PocketBase record, following pagination. Raises on non-200."""
        items: List[Dict[str, Any]] = []
        page = 1
        while True:
            resp = self._request("GET", f"/api/collections/{ANIME_COLLECTION}/records",
                                 params={"perPage": 500, "page": page})
            if resp.status_code != 200:
                raise DatabaseUnavailable(f"PocketBase list returned HTTP {resp.status_code}")
            data = resp.json()
            items.extend(data.get("items", []))
            total_pages = data.get("totalPages")
            if not isinstance(total_pages, int) or page >= total_pages:
                return items
            page += 1

    def _cache_records(self) -> List[OfflineAnime]:
        with self._lock:
            return [self._to_offline_anime(c) for c in self.local_cache.values()
                    if not c.get("_pending_delete")]

    def all_local(self) -> List[OfflineAnime]:
        """Every record from the local mirror: no network, no file write."""
        return self._cache_records()

    def get_all(self) -> List[OfflineAnime]:
        """Retrieve all anime records.

        CRITICAL FIX (re-download loop): the local cache is the source of
        truth for in-progress downloads. We MERGE PocketBase records with the
        local cache instead of clobbering it. A locally-stored, unsynced
        entry (with downloaded_episodes) must survive even if PocketBase
        returns an empty/stale record — otherwise every cycle re-fetches the
        same episodes.

        When PocketBase is unreachable or answers with an error status the
        local cache is returned and ``self.degraded`` is set, so callers never
        mistake a failed lookup for "no records" (which used to make the
        scheduler create blank records and overwrite real progress). If there
        is no trustworthy cache to fall back to, ``DatabaseUnavailable`` is
        raised instead.
        """
        try:
            items = self._fetch_all_pb()
        except Exception as e:
            with self._lock:
                untrusted = self._cache_corrupt or (isinstance(e, DatabaseUnavailable)
                                                    and not self.local_cache
                                                    and "HTTP" in str(e))
            if untrusted:
                raise DatabaseUnavailable(f"PocketBase unavailable and no trustworthy local cache: {e}") from e
            print(f"[PB_SYNC_WARNING] PocketBase get_all failed, returning from local DB cache: {e}")
            self.degraded = True
            return self._cache_records()

        self.degraded = False
        with self._lock:
            changed = False
            merged: Dict[str, Dict[str, Any]] = dict(self.local_cache)
            # Merge: start from local cache, adopt richer PocketBase data
            # (e.g. the authoritative record id) without overwriting local
            # progress that PocketBase may have lost.
            for rec in items:
                mid_str = str(rec["media_id"])
                cached = merged.get(mid_str)
                if not cached:
                    merged[mid_str] = rec
                    changed = True
                elif cached.get("_unsynced"):
                    # Local data is newer; just adopt PB id if present.
                    if "id" in rec and cached.get("id") != rec["id"]:
                        cached["id"] = rec["id"]
                        changed = True
                else:
                    # Take whichever has more downloaded episodes (progress
                    # is never silently downgraded), and keep the PB id.
                    if len(rec.get("downloaded_episodes", [])) >= len(cached.get("downloaded_episodes", [])):
                        self._retain_local_fields(rec, cached)
                        if rec != cached:
                            merged[mid_str] = rec
                            changed = True
                    elif "id" in rec and cached.get("id") != rec["id"]:
                        cached["id"] = rec["id"]
                        changed = True

            self.local_cache = merged
            if changed:
                self._save_local_cache()
            return [self._to_offline_anime(r) for r in merged.values()
                    if not r.get("_pending_delete")]

    # ------------------------------------------------------------------ writes

    def upsert(self, media_id: int, anime_data: OfflineAnime, fields: Optional[Iterable[str]] = None):
        """Insert or update an anime record in the database.

        ``fields`` limits the write to the named model fields and merges them
        into the record already stored, so a long-running writer (the
        scheduler holds records for minutes) cannot overwrite fields the user
        edited meanwhile. ``downloaded_episodes`` is merged as a union so
        progress is never lost.
        """
        media_id_str = str(media_id)
        with self._lock:
            cached_record = self.local_cache.get(media_id_str) or {}
            payload = self._payload_from_model(anime_data)
            if fields is not None and cached_record:
                merged = {k: v for k, v in cached_record.items() if k != "_unsynced"}
                for name in fields:
                    if name not in payload:
                        continue
                    if name == "downloaded_episodes":
                        merged[name] = sorted(set(merged.get(name, [])) | set(payload[name]))
                    else:
                        merged[name] = payload[name]
                payload = merged
            # Retain PocketBase internal ID if it exists locally
            if "id" in cached_record:
                payload["id"] = cached_record["id"]

            payload["_unsynced"] = True
            self.local_cache[media_id_str] = payload
            self._bump_rev(media_id_str)
            self._save_local_cache()

        # Sync outside the cache lock (network).
        try:
            self._sync_record_to_pb(media_id)
        except Exception as e:
            print(f"[PB_SYNC_WARNING] PocketBase sync failed for media_id {media_id}; "
                  f"progress kept in local cache (offline_db.json) and will retry next cycle: {e}")

    def update(self, media_id: int, mutator: Callable[[OfflineAnime], Optional[OfflineAnime]],
               fields: Optional[Iterable[str]] = None) -> OfflineAnime:
        """Atomic read-modify-write of one record.

        ``mutator`` receives the freshest record (local mirror first, then
        PocketBase, then a blank one) and mutates it in place or returns a
        replacement. Concurrent updaters of the same record are serialised, so
        web edits and scheduler writes cannot clobber each other.
        """
        key = str(media_id)
        with self._record_lock(key):
            record = self.get_local(media_id) or self.get(media_id) or OfflineAnime(media_id=int(media_id))
            replacement = mutator(record)
            if replacement is not None:
                record = replacement
            self.upsert(media_id, record, fields=fields)
            return record

    def _sync_record_to_pb(self, media_id: int):
        """Internal helper to push a cached record to PocketBase."""
        key = str(media_id)
        with self._record_lock(key):
            with self._lock:
                cached = self.local_cache.get(key)
                if not cached:
                    return
                snapshot = dict(cached)
                rev = self._revs.get(key, 0)

            payload = {k: v for k, v in snapshot.items() if k not in _NON_PAYLOAD_KEYS}

            # PocketBase schema-probe: only send local-only fields the schema has
            supported_fields = self.probe_pb_schema()
            for field in LOCAL_ONLY_FIELDS:
                if field not in supported_fields:
                    payload.pop(field, None)

            res_data = None
            rec_id = snapshot.get("id")
            if rec_id:
                # Fast path: we already know the PocketBase id, skip the lookup.
                patch_resp = self._request("PATCH", f"/api/collections/{ANIME_COLLECTION}/records/{rec_id}", json=payload)
                if patch_resp.status_code != 404:
                    patch_resp.raise_for_status()
                    res_data = patch_resp.json()

            if res_data is None:
                existing_record = self._find_pb_record(media_id)
                if existing_record:
                    patch_resp = self._request("PATCH", f"/api/collections/{ANIME_COLLECTION}/records/{existing_record['id']}", json=payload)
                    patch_resp.raise_for_status()
                    res_data = patch_resp.json()
                else:
                    post_resp = self._request("POST", f"/api/collections/{ANIME_COLLECTION}/records", json=payload)
                    post_resp.raise_for_status()
                    res_data = post_resp.json()

            self._retain_local_fields(res_data, snapshot)

            with self._lock:
                if self._revs.get(key, 0) == rev:
                    res_data.pop("_unsynced", None)
                    self.local_cache[key] = res_data
                else:
                    # Written to again while we were talking to PocketBase:
                    # keep the newer local data (still unsynced), adopt the id.
                    current = self.local_cache.get(key)
                    if current is not None and "id" in res_data:
                        current["id"] = res_data["id"]
                self._save_local_cache()

    def delete(self, media_id: int):
        """Delete an anime record from the database."""
        media_id_str = str(media_id)
        with self._lock:
            # 1. Delete from local cache or mark as pending delete
            if media_id_str in self.local_cache:
                if "id" not in self.local_cache[media_id_str]:
                    # If it was never synced to PB, just remove it locally
                    self.local_cache.pop(media_id_str)
                else:
                    self.local_cache[media_id_str]["_pending_delete"] = True
                self._save_local_cache()

        # 2. Try to sync delete with PocketBase
        try:
            self._sync_delete_to_pb(media_id)
        except Exception as e:
            print(f"PocketBase offline. Deletion marked to sync later for media_id {media_id}: {e}")

    def _sync_delete_to_pb(self, media_id: int):
        """Internal helper to sync a deletion request to PocketBase."""
        media_id_str = str(media_id)
        with self._record_lock(media_id_str):
            existing = self._find_pb_record(media_id)
            if existing:
                del_resp = self._request("DELETE", f"/api/collections/{ANIME_COLLECTION}/records/{existing['id']}")
                del_resp.raise_for_status()

            # Clean local cache completely
            with self._lock:
                self.local_cache.pop(media_id_str, None)
                self._save_local_cache()

    def sync_local_changes(self):
        """Synchronizes any pending local updates or deletions to PocketBase."""
        with self._lock:
            pending = [(k, bool(c.get("_pending_delete")), bool(c.get("_unsynced")))
                       for k, c in self.local_cache.items()
                       if c and (c.get("_pending_delete") or c.get("_unsynced"))]
        if not pending:
            return
        print("Checking for pending local database syncs...")
        for mid_str, pending_delete, unsynced in pending:
            if time.monotonic() < self._breaker_until:
                print("PocketBase circuit breaker open; deferring remaining local syncs.")
                return
            try:
                media_id = int(mid_str)
                if pending_delete:
                    self._sync_delete_to_pb(media_id)
                elif unsynced:
                    self._sync_record_to_pb(media_id)
            except Exception as e:
                print(f"Failed to sync record {mid_str} to PocketBase: {e}")

db = Database()
