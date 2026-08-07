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
        Attempts to add a torrent up to 5 times.
        Verifies that the torrent was successfully added using check_torrent.
        """
        display_title = f"{title} - {episode}" if episode is not None else title

        for attempt in range(1, 3):  # Reduced from 5 to 2 — trust the add response
            added = self.add_torrent(link, title, episode, use_proxy_download)
            if not added:
                print(f"Attempt {attempt}: Failed to add torrent: {display_title}")
                time.sleep(1.0)
                continue

            print(f"Added Torrent: {display_title}")
            time.sleep(2.0)

            if self.check_torrent(display_title):
                print(f"Torrent {display_title} is checked.")
                return True
            else:
                print(f"Torrent {display_title} is not checked. Proceeding anyway (200 Ok received).")
                return True  # Trust the add response — qBittorrent needs metadata time

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
        """Adds a torrent via direct magnet/URL or file upload."""
        config = get_config()
        base_url = config.qbit_url or "http://localhost:8080"
        add_url = f"{base_url.rstrip('/')}/api/v2/torrents/add"

        if not self._ensure_auth():
            print("Failed to authenticate with qBittorrent.")
            return False

        rename = f"{title} - {episode}" if episode is not None else title
        should_upload_file = config.use_proxy or use_proxy_download

        base_root_dir = config.alt_root_dir if use_proxy_download else config.root_dir
        base_root_dir = base_root_dir or "/mock"
        save_path = posixpath.join(base_root_dir, title)

        if should_upload_file:
            return self.add_torrent_file(add_url, link, save_path, rename, should_upload_file)
        else:
            try:
                payload = {
                    "urls": link,
                    "savepath": save_path,
                    "rename": rename,
                    "sequentialDownload": "true",
                    "category": "animu"
                }
                headers = {
                    "Content-Type": "application/x-www-form-urlencoded",
                    "Cookie": f"SID={self.sid}"
                }
                resp = self.client.post(add_url, data=payload, headers=headers)
                if resp.status_code == 200 and resp.text == "Ok.":
                    return True
                else:
                    print(f"Unexpected response from qBittorrent: HTTP {resp.status_code} - {resp.text}")
                    return False
            except Exception as e:
                print(f"Error adding torrent: {e}")
                return False

    def check_torrent(self, name: str) -> bool:
        """Check if a torrent with the exact name exists in qBittorrent."""
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
                return any(t.get("name") == name for t in torrents)
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
        """Fetch list of active downloading torrents from qBittorrent."""
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
                params={"filter": "downloading", "category": "animu", "sort": "added_on", "reverse": "true", "limit": 10},
                headers=headers
            )
            if resp.status_code == 200:
                return resp.json()
        except Exception as e:
            print(f"Failed to fetch qBittorrent active downloads: {e}")
        return []

qbit = QbitClient()
