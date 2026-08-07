import httpx
import time
import re
import posixpath
from typing import Optional
from .config import get_config

class QbitClient:
    def __init__(self):
        self.sid: Optional[str] = None
        self.expires: float = 0.0
        # verify=False is critical to bypass self-signed SSL errors (a major Node.js issue)
        self.client = httpx.Client(verify=False, timeout=15)

    def _authenticate(self) -> bool:
        """Log in to qBittorrent and retrieve the session ID (SID)."""
        config = get_config()
        base_url = config.qbit_url or "http://localhost:8080"
        login_url = f"{base_url.rstrip('/')}/api/v2/auth/login"

        try:
            resp = self.client.post(
                login_url,
                data={"username": config.username, "password": config.password},
                headers={"Content-Type": "application/x-www-form-urlencoded"}
            )
            if resp.status_code == 200 and resp.text.strip().startswith("Ok"):
                # httpx manages cookies automatically, but we also save the SID explicitly
                sid = self.client.cookies.get("SID")
                if not sid:
                    set_cookie = resp.headers.get("set-cookie", "")
                    match = re.search(r'SID=([^;]+)', set_cookie)
                    if match:
                        sid = match.group(1)
                        self.client.cookies.set("SID", sid)
                if sid:
                    self.sid = sid
                    self.expires = time.time() + 3000
                    return True
                else:
                    print("Authentication successful but SID cookie not found in response.")
            else:
                print(f"Authentication failed: HTTP {resp.status_code} - {resp.text}")
        except Exception as e:
            print(f"Error during qBittorrent authentication: {e}")
        return False

    def _ensure_auth(self) -> bool:
        """Ensure the client has a valid, unexpired session ID."""
        if not self.sid or time.time() >= self.expires:
            return self._authenticate()
        return True

    def test_connection(self, url: str, user: str, passwd: str) -> tuple[bool, str]:
        """Test authentication with custom credentials without modifying state."""
        login_url = f"{url.rstrip('/')}/api/v2/auth/login"
        try:
            with httpx.Client(verify=False, timeout=10) as client:
                resp = client.post(
                    login_url,
                    data={"username": user, "password": passwd},
                    headers={"Content-Type": "application/x-www-form-urlencoded"}
                )
                if resp.status_code == 200 and resp.text.strip().startswith("Ok"):
                    sid = client.cookies.get("SID")
                    if not sid:
                        set_cookie = resp.headers.get("set-cookie", "")
                        match = re.search(r'SID=([^;]+)', set_cookie)
                        if match:
                            sid = match.group(1)
                    if sid:
                        return True, "Connection successful."
                    return True, "Connection successful (no SID cookie parsed)."
                else:
                    return False, f"HTTP {resp.status_code}: {resp.text}"
        except Exception as e:
            return False, str(e)

    def add_check_torrent(
        self,
        link: str,
        title: str,
        episode: Optional[int] = None,
        use_proxy_download: bool = False
    ) -> bool:
        """
        Attempts to add a torrent up to 3 times.
        Verifies that the torrent was successfully added using check_torrent.
        """
        display_title = f"{title} - {episode}" if episode is not None else title

        for attempt in range(1, 4):
            added = self.add_torrent(link, title, episode, use_proxy_download)
            if not added:
                print(f"Attempt {attempt}: Failed to send add command to qBittorrent for: {display_title}")
                time.sleep(1.5)
                continue

            print(f"Sent Add Request to qBittorrent: {display_title}. Verifying...")
            
            # Check with retries to give qBittorrent time to register/fetch metadata
            for check_attempt in range(3):
                time.sleep(2.0)
                if self.check_torrent(display_title):
                    print(f"Torrent {display_title} successfully verified in qBittorrent.")
                    return True
                    
            print(f"Attempt {attempt}: Torrent {display_title} was not verified in qBittorrent torrent list.")

        return False

    def safe_torrent_filename(self, name: str) -> str:
        """Sanitizes filename for local storage."""
        return re.sub(r'[<>:"/\\|?*\u0000-\u001F]', '_', name) or "download"

    def download_torrent_file(self, link: str, use_proxy: bool) -> bytes:
        """Download torrent file content, optionally utilizing the configured proxy."""
        config = get_config()
        proxy_url = None
        if use_proxy and config.proxy_address and config.proxy_port:
            proxy_url = f"http://{config.proxy_address}:{config.proxy_port}"

        with httpx.Client(verify=False, proxy=proxy_url, timeout=20) as client:
            resp = client.get(link)
            resp.raise_for_status()
            return resp.content

    def add_torrent_file(self, auth_url: str, link: str, save_path: str, rename: str, use_proxy: bool) -> bool:
        """Download the .torrent file and upload it to qBittorrent (used when proxy is active)."""
        try:
            torrent_bytes = self.download_torrent_file(link, use_proxy)
            torrent_filename = f"{self.safe_torrent_filename(rename)}.torrent"

            files = {
                "torrents": (torrent_filename, torrent_bytes, "application/x-bittorrent")
            }
            data = {
                "savepath": save_path,
                "rename": rename,
                "sequentialDownload": "true",
                "category": "animu"
            }

            headers = {"Cookie": f"SID={self.sid}"}
            resp = self.client.post(auth_url, data=data, files=files, headers=headers)
            return resp.status_code == 200 and resp.text == "Ok."
        except Exception as e:
            print(f"Failed to add torrent file: {e}")
            return False

    def add_torrent(
        self,
        link: str,
        title: str,
        episode: Optional[int] = None,
        use_proxy_download: bool = False
    ) -> bool:
        """Adds a torrent by downloading the .torrent file and uploading it via multipart.

        We always download the .torrent file in Python rather than passing the raw URL
        to qBittorrent. qBittorrent returns 'Ok.' even when it cannot reach Nyaa.si
        (e.g. Oman ISP block via ddos-guard CDN), so the torrent would silently never
        appear. By fetching in Python we control the download and can use the proxy.
        """
        config = get_config()
        base_url = config.qbit_url or "http://localhost:8080"
        add_url = f"{base_url.rstrip('/')}/api/v2/torrents/add"

        if not self._ensure_auth():
            print("Failed to authenticate with qBittorrent.")
            return False

        rename = f"{title} - {episode}" if episode is not None else title
        # Use alt_root_dir when proxy download is requested (different storage location)
        base_root_dir = config.alt_root_dir if use_proxy_download else config.root_dir
        base_root_dir = base_root_dir or "/mock"
        save_path = posixpath.join(base_root_dir, title)

        # Always use proxy if configured globally, or if this specific download needs it
        use_proxy = config.use_proxy or use_proxy_download
        return self.add_torrent_file(add_url, link, save_path, rename, use_proxy)

    def check_torrent_episode(self, title: str, episode: int) -> bool:
        """Check if an episode already exists in qBittorrent.

        Tolerant of season-token naming variants (e.g. 'Iruma-kun S4 - 4'
        vs the stored 'Iruma-kun 4 - 4'). Only counts torrents with
        progress > 0 so stale missingFiles entries are ignored.
        """
        config = get_config()
        base_url = config.qbit_url or "http://localhost:8080"
        info_url = f"{base_url.rstrip('/')}/api/v2/torrents/info"

        if not self._ensure_auth():
            return False

        try:
            payload = {"sort": "added_on", "limit": 250, "reverse": "true", "category": "animu"}
            headers = {
                "Content-Type": "application/x-www-form-urlencoded",
                "Cookie": f"SID={self.sid}"
            }
            resp = self.client.post(info_url, data=payload, headers=headers)
            if resp.status_code != 200:
                return False

            # Distinctive title tokens with season markers removed
            title_norm = re.sub(r"\bs\d+\b", "", title.lower())
            title_norm = re.sub(r"[\W_]+", " ", title_norm).strip()
            tokens = [w for w in title_norm.split() if len(w) > 3]
            if not tokens:
                return False

            ep_pattern = re.compile(r"(?:^|[^\w])(?:e(?:p)?\s*)?0*%d(?:$|[^\w])" % episode, re.IGNORECASE)
            for t in resp.json() or []:
                if t.get("progress", 0) <= 0:
                    continue
                t_name = (t.get("name") or "").lower()
                if all(tok in t_name for tok in tokens) and ep_pattern.search(t_name):
                    return True
        except Exception as e:
            print(f"Error checking torrent episode: {e}")
        return False

    def check_episodes_in_batch(self, title: str, episodes: list, season: int = 1) -> list:
        """Return which of `episodes` are already present inside COMPLETED qBittorrent
        batch torrents matching `title` (inspected by file list, not torrent name).

        Handles the common case where a full-season batch (e.g. 'Season 01-02')
        was already downloaded: the individual episodes live inside the batch's
        files (e.g. 'S02E05.mkv') even though no per-episode torrent exists and
        the batch's display name carries no episode number. Only fully-seeded
        (progress >= 1) torrents are considered, and only episodes actually found
        in the file list are returned, so partially- or wrongly-matched batches
        are never falsely credited.
        """
        config = get_config()
        base_url = config.qbit_url or "http://localhost:8080"
        info_url = f"{base_url.rstrip('/')}/api/v2/torrents/info"
        if not self._ensure_auth():
            return []

        try:
            payload = {"sort": "added_on", "limit": 250, "reverse": "true", "category": "animu"}
            headers = {
                "Content-Type": "application/x-www-form-urlencoded",
                "Cookie": f"SID={self.sid}"
            }
            resp = self.client.post(info_url, data=payload, headers=headers)
            if resp.status_code != 200:
                return []

            title_norm = re.sub(r"\bs\d+\b", "", title.lower())
            title_norm = re.sub(r"[\W_]+", " ", title_norm).strip()
            tokens = [w for w in title_norm.split() if len(w) > 3]
            if not tokens:
                return []

            target = set(episodes)
            found: set = set()
            files_url = f"{base_url.rstrip('/')}/api/v2/torrents/files"

            for t in resp.json() or []:
                if t.get("progress", 0) < 1:
                    continue
                t_name = (t.get("name") or "").lower()
                save_path = (t.get("save_path") or "").lower()
                if not (all(tok in t_name for tok in tokens) or all(tok in save_path for tok in tokens)):
                    continue
                fr = self.client.post(files_url, data={"hash": t.get("hash")}, headers=headers)
                if fr.status_code != 200:
                    continue
                for f in fr.json() or []:
                    parsed = self._parse_episode_from_filename(f.get("name") or "", season)
                    if parsed is not None and parsed in target:
                        found.add(parsed)
            return sorted(found)
        except Exception as e:
            print(f"Error checking episodes in batch: {e}")
            return []

    def _parse_episode_from_filename(self, filename: str, season: int = 1) -> Optional[int]:
        """Extract a season-relative episode number from a torrent file name.

        Prefers season-tagged forms (S01E05, s01e05) and only accepts the given
        season, so a multi-season batch (Season 01-02) is never credited with the
        wrong season's episodes. Falls back to bare episode numbers when the file
        carries no season tag at all.
        """
        fn = filename.lower()
        # Season-tagged: S02E05 / s2e5 / s02e05
        if season and season > 0:
            m = re.search(rf"s0?{season}\s*e\s*(\d{{1,3}})", fn)
            if m:
                return int(m.group(1))
            # Prefer explicit season match; if a different season tag is present, skip
            if re.search(r"s\d{1,2}\s*e\s*\d{1,3}", fn):
                return None
        # Bare episode number (no season context in the name). Use explicit
        # separator boundaries (including '_', which is a \w char in Python)
        # so names like '..._-_07_' or ' - 13 - ' parse, while resolution
        # tags like '1080p' or 'x265' are rejected. Only trust a bare number
        # when the requested season (1) is unambiguous — for a later-season
        # query a file without an S{season}E tag cannot be proven to belong to
        # that season, so it is ignored to avoid crediting the wrong season.
        if season > 1:
            return None
        m = re.search(r"(?:^|[-\[\(\s_.])(?:e(?:p)?\s*)?0*(\d{1,3})(?:[-\]\)\s_.]|$)", fn)
        if m:
            return int(m.group(1))
        return None

    def check_torrent(self, name: str) -> bool:
        """Check if a torrent matching the given name or title exists in qBittorrent."""
        config = get_config()
        base_url = config.qbit_url or "http://localhost:8080"
        info_url = f"{base_url.rstrip('/')}/api/v2/torrents/info"

        if not self._ensure_auth():
            return False

        try:
            payload = {"sort": "added_on", "limit": 250, "reverse": "true", "category": "animu"}
            headers = {
                "Content-Type": "application/x-www-form-urlencoded",
                "Cookie": f"SID={self.sid}"
            }
            resp = self.client.post(info_url, data=payload, headers=headers)
            if resp.status_code == 200:
                torrents = resp.json()
                if not torrents:
                    return False
                target_clean = name.lower().strip()
                for t in torrents:
                    t_name = (t.get("name") or "").lower().strip()
                    # Exact match, or our expected name is contained in the torrent name
                    # (e.g. rename "Mushoku Tensei S3 - 4" found inside qBittorrent name)
                    if t_name == target_clean or target_clean in t_name:
                        return True
                    # save_path fallback: the title folder should be in the save path
                    save_path = (t.get("save_path") or "").lower()
                    if target_clean in save_path:
                        return True
        except Exception as e:
            print(f"Error checking torrent: {e}")
        return False

    def delete_torrent(self, name: str) -> bool:
        """Deletes a torrent matching the given name."""
        config = get_config()
        base_url = config.qbit_url or "http://localhost:8080"
        info_url = f"{base_url.rstrip('/')}/api/v2/torrents/info"
        delete_url = f"{base_url.rstrip('/')}/api/v2/torrents/delete"

        if not self._ensure_auth():
            return False

        try:
            # Query torrent list to find hash
            payload = {"sort": "added_on", "limit": 250, "reverse": "true", "category": "animu"}
            headers = {
                "Content-Type": "application/x-www-form-urlencoded",
                "Cookie": f"SID={self.sid}"
            }
            resp = self.client.post(info_url, data=payload, headers=headers)
            if resp.status_code != 200:
                return False

            torrents = resp.json()
            target_torrent = None
            for torrent in torrents:
                if torrent.get("name") == name:
                    target_torrent = torrent
                    break

            if not target_torrent:
                print(f"Torrent with name '{name}' not found.")
                return False

            torrent_hash = target_torrent["hash"]
            del_resp = self.client.post(
                delete_url,
                data={"hashes": torrent_hash},
                headers={
                    "Content-Type": "application/x-www-form-urlencoded",
                    "Cookie": f"SID={self.sid}"
                }
            )
            return del_resp.status_code == 200 and del_resp.text == "Ok."
        except Exception as e:
            print(f"Error deleting torrent: {e}")
            return False

    def get_active_downloads(self) -> list:
        """Fetch the torrent queue from qBittorrent (any state), enriched with
        a normalized ``statusKind``/``statusLabel`` classification.

        qBittorrent's ``state`` strings are verbose and internal-looking
        (``stoppedDL``, ``forcedUP``, ``metaDL`` …). The UI needs to show the
        *true* state of each torrent — stopped, errored, complete, seeding,
        downloading, etc. — so we fetch the full queue (``filter=all``,
        newest first, capped at 10) and classify each entry.
        """
        if not self._ensure_auth():
            return []
        config = get_config()
        base_url = config.qbit_url or "http://localhost:8080"
        info_url = f"{base_url.rstrip('/')}/api/v2/torrents/info"
        try:
            headers = {
                "Cookie": f"SID={self.sid}"
            }
            resp = self.client.get(
                info_url,
                params={"filter": "all", "category": "animu", "sort": "added_on", "reverse": "true", "limit": 10},
                headers=headers
            )
            if resp.status_code == 200:
                torrents = resp.json() or []
                enriched = []
                for t in torrents:
                    item = dict(t)
                    kind, label = self.classify_state(item.get("state", ""))
                    item["statusKind"] = kind
                    item["statusLabel"] = label
                    enriched.append(item)
                return enriched
        except Exception as e:
            print(f"Failed to fetch qBittorrent active downloads: {e}")
        return []

    @staticmethod
    def classify_state(state: str) -> tuple:
        """Normalize a qBittorrent ``state`` string into (kind, label).

        Kinds: downloading | seeding | complete | stopped | paused | queued |
        checking | stalled | error | unknown. ``label`` is a human-friendly
        display string for badges.
        """
        s = (state or "").lower()
        mapping = [
            ("downloading", ("downloading", "Downloading")),
            ("forceddl", ("downloading", "Downloading")),
            ("metadl", ("downloading", "Fetching metadata")),
            ("forcedmetadl", ("downloading", "Fetching metadata")),
            ("stalleddl", ("stalled", "Stalled")),
            ("checkingdl", ("checking", "Checking")),
            ("checkingup", ("checking", "Checking")),
            ("checkingresumedata", ("checking", "Checking")),
            ("queueddl", ("queued", "Queued")),
            ("queuedup", ("queued", "Queued")),
            ("stoppeddl", ("stopped", "Stopped")),
            ("stoppedup", ("complete", "Complete")),
            ("pauseddl", ("paused", "Paused")),
            ("pausedup", ("paused", "Paused")),
            ("uploading", ("seeding", "Seeding")),
            ("forcedup", ("seeding", "Seeding")),
            ("stalledup", ("seeding", "Seeding")),
            ("error", ("error", "Error")),
            ("missingfiles", ("error", "Missing files")),
            ("unknown", ("unknown", "Unknown")),
        ]
        for key, result in mapping:
            if key in s:
                return result
        return ("unknown", state or "Unknown")

    def resume_torrent(self, torrent_hash: str) -> bool:
        """Resume/retry a torrent by hash (works for stopped, paused, and
        errored torrents — qBittorrent re-checks errored ones on resume)."""
        config = get_config()
        base_url = config.qbit_url or "http://localhost:8080"
        resume_url = f"{base_url.rstrip('/')}/api/v2/torrents/resume"
        if not self._ensure_auth():
            return False
        try:
            resp = self.client.post(
                resume_url,
                data={"hashes": torrent_hash},
                headers={"Content-Type": "application/x-www-form-urlencoded", "Cookie": f"SID={self.sid}"}
            )
            return resp.status_code == 200 and resp.text == "Ok."
        except Exception as e:
            print(f"Failed to resume torrent {torrent_hash}: {e}")
            return False

    def delete_torrent_by_hash(self, torrent_hash: str, delete_files: bool = False) -> bool:
        """Delete a torrent by hash. ``delete_files=False`` keeps the data on
        disk (safe default for a mistaken remove)."""
        config = get_config()
        base_url = config.qbit_url or "http://localhost:8080"
        delete_url = f"{base_url.rstrip('/')}/api/v2/torrents/delete"
        if not self._ensure_auth():
            return False
        try:
            resp = self.client.post(
                delete_url,
                data={"hashes": torrent_hash, "deleteFiles": "true" if delete_files else "false"},
                headers={"Content-Type": "application/x-www-form-urlencoded", "Cookie": f"SID={self.sid}"}
            )
            return resp.status_code == 200 and resp.text == "Ok."
        except Exception as e:
            print(f"Failed to delete torrent {torrent_hash}: {e}")
            return False

qbit = QbitClient()
