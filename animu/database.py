import httpx
import os
import json
import threading
from typing import Optional, List, Dict, Any
from .config import get_config
from .models import OfflineAnime

PB_URL = "https://pb.atoona.com"
PB_AUTH = {"identity": "admin@atoona.com", "password": "pocketbase2024"}
SUPERUSERS_COLLECTION = "pbc_3142635823"
ANIME_COLLECTION = "anime"

class Database:
    def __init__(self):
        # verify=False prevents SSL certificate validation errors with self-signed certificates
        self.client = httpx.Client(verify=False, timeout=10)
        self.token: Optional[str] = None
        self._lock = threading.RLock()

        # Local JSON cache configuration for resilience
        root_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
        self.local_db_path = os.path.join(root_dir, "logs", "offline_db.json")
        self.local_cache: Dict[str, Dict[str, Any]] = {}
        self.local_cache_valid = False
        self._pb_schema_fields: Optional[set] = None
        self._load_local_cache()

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
                except Exception as e:
                    print(f"Failed to load local DB cache: {e}")
            else:
                self.local_cache = {}

    def _save_local_cache(self):
        """Saves the current mirrored database state to a local JSON cache file."""
        with self._lock:
            try:
                os.makedirs(os.path.dirname(self.local_db_path), exist_ok=True)
                with open(self.local_db_path, "w", encoding="utf-8") as f:
                    json.dump(self.local_cache, f, indent=2)
            except Exception as e:
                print(f"Failed to save local DB cache: {e}")

    def auth(self) -> str:
        """Authenticate with PocketBase and store the auth token."""
        identity = PB_AUTH["identity"]
        password = PB_AUTH["password"]

        resp = self.client.post(
            f"{PB_URL}/api/collections/{SUPERUSERS_COLLECTION}/auth-with-password",
            json={"identity": identity, "password": password}
        )
        resp.raise_for_status()
        self.token = resp.json()["token"]
        return self.token

    def offline_safe_mode_available(self) -> bool:
        """Return whether the local cache is available for the documented fallback path."""
        return self.local_cache_valid and os.path.isfile(self.local_db_path)

    def _request(self, method: str, path: str, **kwargs) -> httpx.Response:
        """Send requests to PocketBase, handling authentication and automatic 401 token refresh."""
        if not self.token:
            self.auth()

        headers = kwargs.pop("headers", {})
        headers["Authorization"] = self.token

        try:
            resp = self.client.request(method, f"{PB_URL}{path}", headers=headers, **kwargs)
            if resp.status_code == 401:
                self.auth()
                headers["Authorization"] = self.token
                resp = self.client.request(method, f"{PB_URL}{path}", headers=headers, **kwargs)
            return resp
        except Exception as e:
            print(f"PocketBase HTTP request error: {e}")
            raise

    def probe_pb_schema(self, force: bool = False) -> set:
        """Queries PocketBase for the anime collection schema and caches supported field names."""
        with self._lock:
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

    def _to_offline_anime(self, rec: Dict[str, Any]) -> OfflineAnime:
        """Convert a raw DB/cache dict into an OfflineAnime model."""
        return OfflineAnime(
            media_id=rec["media_id"],
            downloaded_episodes=rec.get("downloaded_episodes", []),
            starting_episode=rec.get("starting_episode", 0),
            alternative_title=rec.get("alternative_title", ""),
            timeouts=rec.get("timeouts", 0),
            max_timeouts=rec.get("max_timeouts", 0),
            pending_rewatching_update=rec.get("pending_rewatching_update", False),
            preferred_release_group=rec.get("preferred_release_group", ""),
            release_group_misses=rec.get("release_group_misses", 0)
        )

    def get(self, media_id: int) -> Optional[OfflineAnime]:
        """Fetch an anime record by its AniList media ID.

        The local cache is treated as authoritative: a locally-stored,
        unsynced entry is never overwritten by a (possibly stale/empty)
        PocketBase response. This prevents downloaded-episode progress from
        being silently lost when PocketBase writes fail.
        """
        with self._lock:
            media_id_str = str(media_id)
            try:
                resp = self._request("GET", f"/api/collections/{ANIME_COLLECTION}/records", params={"filter": f"media_id={media_id}"})
                if resp.status_code == 200:
                    items = resp.json().get("items", [])
                    if items:
                        record = items[0]
                        cached = self.local_cache.get(media_id_str)
                        # Local unsynced data is newer than PocketBase: keep it.
                        if cached and cached.get("_unsynced"):
                            return self._to_offline_anime(cached)
                        if cached:
                            # Retain local group memory if PB does not store them
                            if "preferred_release_group" not in record and "preferred_release_group" in cached:
                                record["preferred_release_group"] = cached["preferred_release_group"]
                            if "release_group_misses" not in record and "release_group_misses" in cached:
                                record["release_group_misses"] = cached["release_group_misses"]
                            # Keep local progress if it is richer; adopt PB id.
                            if len(cached.get("downloaded_episodes", [])) > len(record.get("downloaded_episodes", [])):
                                if "id" in record:
                                    cached["id"] = record["id"]
                                self.local_cache[media_id_str] = cached
                            else:
                                self.local_cache[media_id_str] = record
                            self._save_local_cache()
                            return self._to_offline_anime(self.local_cache[media_id_str])
                        self.local_cache[media_id_str] = record
                        self._save_local_cache()
                        return self._to_offline_anime(record)
                    # PocketBase has no record. Keep any local entry (it is unsynced).
                    if media_id_str in self.local_cache:
                        return self._to_offline_anime(self.local_cache[media_id_str])
                    return None
                return None
            except Exception as e:
                print(f"PocketBase get failed, falling back to local cache: {e}")
                cached = self.local_cache.get(media_id_str)
                if cached and not cached.get("_pending_delete"):
                    return self._to_offline_anime(cached)
                return None

    def upsert(self, media_id: int, anime_data: OfflineAnime):
        """Insert or update an anime record in the database."""
        with self._lock:
            media_id_str = str(media_id)

            # 1. Update in local cache immediately
            cached_record = self.local_cache.get(media_id_str) or {}
            payload = {
                "media_id": anime_data.media_id,
                "downloaded_episodes": anime_data.downloaded_episodes,
                "starting_episode": anime_data.starting_episode,
                "alternative_title": anime_data.alternative_title,
                "timeouts": anime_data.timeouts,
                "max_timeouts": anime_data.max_timeouts,
                "pending_rewatching_update": anime_data.pending_rewatching_update,
                "preferred_release_group": anime_data.preferred_release_group,
                "release_group_misses": anime_data.release_group_misses,
            }
            # Retain PocketBase internal ID if it exists locally
            if "id" in cached_record:
                payload["id"] = cached_record["id"]

            self.local_cache[media_id_str] = payload
            self.local_cache[media_id_str]["_unsynced"] = True
            self._save_local_cache()

            # 2. Try to sync with PocketBase
            try:
                self._sync_record_to_pb(media_id)
            except Exception as e:
                print(f"[PB_SYNC_WARNING] PocketBase sync failed for media_id {media_id}; "
                      f"progress kept in local cache (offline_db.json) and will retry next cycle: {e}")

    def _sync_record_to_pb(self, media_id: int):
        """Internal helper to push a cached record to PocketBase."""
        with self._lock:
            media_id_str = str(media_id)
            cached = self.local_cache.get(media_id_str)
            if not cached:
                return

            payload = {k: v for k, v in cached.items() if k not in ("_unsynced", "_pending_delete", "collectionId", "collectionName", "id", "created", "updated")}

            # PocketBase schema-probe: only include group-memory fields if supported
            supported_fields = self.probe_pb_schema()
            if "preferred_release_group" not in supported_fields:
                payload.pop("preferred_release_group", None)
            if "release_group_misses" not in supported_fields:
                payload.pop("release_group_misses", None)

            # Check if record already exists on PB
            resp = self._request("GET", f"/api/collections/{ANIME_COLLECTION}/records", params={"filter": f"media_id={media_id}"})
            existing_record = None
            if resp.status_code == 200:
                items = resp.json().get("items", [])
                if items:
                    existing_record = items[0]

            if existing_record:
                rec_id = existing_record["id"]
                patch_resp = self._request("PATCH", f"/api/collections/{ANIME_COLLECTION}/records/{rec_id}", json=payload)
                patch_resp.raise_for_status()
                res_data = patch_resp.json()
                if "preferred_release_group" not in supported_fields:
                    res_data["preferred_release_group"] = cached.get("preferred_release_group", "")
                    res_data["release_group_misses"] = cached.get("release_group_misses", 0)
                self.local_cache[media_id_str] = res_data
            else:
                post_resp = self._request("POST", f"/api/collections/{ANIME_COLLECTION}/records", json=payload)
                post_resp.raise_for_status()
                res_data = post_resp.json()
                if "preferred_release_group" not in supported_fields:
                    res_data["preferred_release_group"] = cached.get("preferred_release_group", "")
                    res_data["release_group_misses"] = cached.get("release_group_misses", 0)
                self.local_cache[media_id_str] = res_data

            # Clear unsynced flag
            self.local_cache[media_id_str].pop("_unsynced", None)
            self._save_local_cache()

    def get_all(self) -> List[OfflineAnime]:
        """Retrieve all anime records (up to 500).

        CRITICAL FIX (re-download loop): the local cache is the source of
        truth for in-progress downloads. We MERGE PocketBase records with the
        local cache instead of clobbering it. A locally-stored, unsynced
        entry (with downloaded_episodes) must survive even if PocketBase
        returns an empty/stale record — otherwise every cycle re-fetches the
        same episodes.
        """
        with self._lock:
            try:
                resp = self._request("GET", f"/api/collections/{ANIME_COLLECTION}/records", params={"perPage": 500})
                if resp.status_code == 200:
                    items = resp.json().get("items", [])

                    pb_map = {str(rec["media_id"]): rec for rec in items}

                    # Merge: start from local cache, adopt richer PocketBase data
                    # (e.g. the authoritative record id) without overwriting local
                    # progress that PocketBase may have lost.
                    merged: Dict[str, Dict[str, Any]] = dict(self.local_cache)
                    for mid_str, rec in pb_map.items():
                        cached = merged.get(mid_str)
                        if not cached:
                            merged[mid_str] = rec
                        elif cached.get("_unsynced"):
                            # Local data is newer; just adopt PB id if present.
                            if "id" in rec:
                                cached["id"] = rec["id"]
                            merged[mid_str] = cached
                        else:
                            # Take whichever has more downloaded episodes (progress
                            # is never silently downgraded), and keep the PB id.
                            if len(rec.get("downloaded_episodes", [])) >= len(cached.get("downloaded_episodes", [])):
                                if "preferred_release_group" not in rec and "preferred_release_group" in cached:
                                    rec["preferred_release_group"] = cached["preferred_release_group"]
                                if "release_group_misses" not in rec and "release_group_misses" in cached:
                                    rec["release_group_misses"] = cached["release_group_misses"]
                                merged[mid_str] = rec
                            else:
                                if "id" in rec:
                                    cached["id"] = rec["id"]
                                merged[mid_str] = cached

                    self.local_cache = merged
                    self._save_local_cache()
                    return [self._to_offline_anime(r) for r in merged.values()
                            if not r.get("_pending_delete")]
                return []
            except Exception as e:
                print(f"[PB_SYNC_WARNING] PocketBase get_all failed, returning from local DB cache: {e}")
                records = []
                for mid_str, cached in self.local_cache.items():
                    if cached.get("_pending_delete"):
                        continue
                    records.append(self._to_offline_anime(cached))
                return records

    def delete(self, media_id: int):
        """Delete an anime record from the database."""
        with self._lock:
            media_id_str = str(media_id)

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
        with self._lock:
            media_id_str = str(media_id)
            resp = self._request("GET", f"/api/collections/{ANIME_COLLECTION}/records", params={"filter": f"media_id={media_id}"})
            if resp.status_code == 200:
                items = resp.json().get("items", [])
                if items:
                    rec_id = items[0]["id"]
                    del_resp = self._request("DELETE", f"/api/collections/{ANIME_COLLECTION}/records/{rec_id}")
                    del_resp.raise_for_status()

            # Clean local cache completely
            self.local_cache.pop(media_id_str, None)
            self._save_local_cache()

    def sync_local_changes(self):
        """Synchronizes any pending local updates or deletions to PocketBase."""
        with self._lock:
            print("Checking for pending local database syncs...")
            media_ids = list(self.local_cache.keys())
            for mid_str in media_ids:
                cached = self.local_cache.get(mid_str)
                if not cached:
                    continue

                try:
                    media_id = int(mid_str)
                    if cached.get("_pending_delete"):
                        self._sync_delete_to_pb(media_id)
                    elif cached.get("_unsynced"):
                        self._sync_record_to_pb(media_id)
                except Exception as e:
                    print(f"Failed to sync record {mid_str} to PocketBase: {e}")

db = Database()
