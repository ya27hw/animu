import httpx
import time
import re
import posixpath
import hashlib
from typing import Optional, Any
from .config import get_config

def _format_body_snippet(resp: Any) -> str:
    text = getattr(resp, "text", "")
    if callable(text):
        try:
            text = text()
        except Exception:
            text = ""
    if not isinstance(text, str):
        text = str(text)
    return text[:200].replace("\r", "").replace("\n", " ")


def _bencode_decode(data: bytes) -> Any:
    """Decode bencoded bytes into python objects (bytes, int, list, dict)."""
    if not isinstance(data, (bytes, bytearray)):
        raise TypeError("Bencoded data must be bytes")
    idx = 0
    length = len(data)

    def decode() -> Any:
        nonlocal idx
        if idx >= length:
            raise ValueError("Unexpected EOF while decoding bencode")
        b = data[idx:idx + 1]
        if b == b"i":
            idx += 1
            end = data.find(b"e", idx)
            if end == -1:
                raise ValueError("Unterminated integer in bencode")
            num_str = data[idx:end]
            if not num_str:
                raise ValueError("Empty integer in bencode")
            if num_str == b"-0":
                raise ValueError("Negative zero is invalid in bencode")
            if len(num_str) > 1 and num_str.startswith(b"0"):
                raise ValueError("Leading zeros invalid in bencode")
            if len(num_str) > 2 and num_str.startswith(b"-0"):
                raise ValueError("Leading zeros in negative integer invalid in bencode")
            val = int(num_str)
            idx = end + 1
            return val
        elif b == b"l":
            idx += 1
            items = []
            while idx < length and data[idx:idx + 1] != b"e":
                items.append(decode())
            if idx >= length:
                raise ValueError("Unterminated list in bencode")
            idx += 1
            return items
        elif b == b"d":
            idx += 1
            d = {}
            while idx < length and data[idx:idx + 1] != b"e":
                k = decode()
                if not isinstance(k, bytes):
                    raise ValueError("Dictionary key must be bytes")
                v = decode()
                d[k] = v
            if idx >= length:
                raise ValueError("Unterminated dict in bencode")
            idx += 1
            return d
        elif b.isdigit():
            colon = data.find(b":", idx)
            if colon == -1:
                raise ValueError("Unterminated string length in bencode")
            slen_str = data[idx:colon]
            if len(slen_str) > 1 and slen_str.startswith(b"0"):
                raise ValueError("Leading zeros in string length invalid")
            slen = int(slen_str)
            idx = colon + 1
            if idx + slen > length:
                raise ValueError("String data out of bounds in bencode")
            val = data[idx:idx + slen]
            idx += slen
            return val
        else:
            raise ValueError(f"Invalid bencode prefix: {b!r}")

    return decode()


def _bencode_encode(obj: Any) -> bytes:
    """Encode python objects canonically into bencoded bytes."""
    if isinstance(obj, int) and not isinstance(obj, bool):
        return b"i" + str(obj).encode("ascii") + b"e"
    elif isinstance(obj, bytes):
        return str(len(obj)).encode("ascii") + b":" + obj
    elif isinstance(obj, str):
        b = obj.encode("utf-8")
        return str(len(b)).encode("ascii") + b":" + b
    elif isinstance(obj, (list, tuple)):
        return b"l" + b"".join(_bencode_encode(x) for x in obj) + b"e"
    elif isinstance(obj, dict):
        def _get_bytes_key(k: Any) -> bytes:
            if isinstance(k, bytes):
                return k
            if isinstance(k, str):
                return k.encode("utf-8")
            raise TypeError(f"Dictionary key must be bytes or str, got {type(k)}")

        sorted_items = sorted(obj.items(), key=lambda it: _get_bytes_key(it[0]))
        parts = [b"d"]
        for k, v in sorted_items:
            k_bytes = _get_bytes_key(k)
            parts.append(str(len(k_bytes)).encode("ascii") + b":" + k_bytes)
            parts.append(_bencode_encode(v))
        parts.append(b"e")
        return b"".join(parts)
    else:
        raise TypeError(f"Unsupported type for bencode: {type(obj)}")


def compute_info_hash(data: bytes) -> str:
    """Compute the SHA-1 info hash of a .torrent file's bytes.

    Bencode-decodes the payload, canonically re-encodes the info dictionary,
    and returns hashlib.sha1 hex digest in lowercase.
    """
    if not isinstance(data, (bytes, bytearray)):
        raise TypeError("Torrent data must be bytes")
    if not data or not data.startswith(b"d"):
        raise ValueError("Invalid torrent bytes: payload must be a bencoded dictionary starting with b'd'")

    try:
        decoded = _bencode_decode(data)
    except Exception as exc:
        raise ValueError(f"Failed to decode bencoded torrent: {exc}") from exc

    if not isinstance(decoded, dict):
        raise ValueError("Torrent payload root is not a dictionary")

    info = decoded.get(b"info")
    if info is None:
        info = decoded.get("info")
    if info is None or not isinstance(info, dict):
        raise ValueError("Torrent payload missing 'info' dictionary")

    canonical_info = _bencode_encode(info)
    return hashlib.sha1(canonical_info).hexdigest().lower()


calculate_info_hash = compute_info_hash
torrent_info_hash = compute_info_hash


class QbitClient:
    compute_info_hash = staticmethod(compute_info_hash)
    calculate_info_hash = staticmethod(compute_info_hash)

    def __init__(self):
        self.sid: Optional[str] = None
        self.expires: float = 0.0
        self.last_auth_status: int = 0
        self.last_add_error: str = ""
        self.last_add_was_duplicate: bool = False
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
            status = getattr(resp, "status_code", 0)
            text = getattr(resp, "text", "")
            self.last_auth_status = status
            if status == 200 and str(text).strip().startswith("Ok"):
                # httpx manages cookies automatically, but we also save the SID explicitly
                sid = getattr(self.client, "cookies", {}).get("SID") if hasattr(self.client, "cookies") else None
                if not sid:
                    headers = getattr(resp, "headers", {})
                    set_cookie = headers.get("set-cookie", "") if hasattr(headers, "get") else ""
                    match = re.search(r'SID=([^;]+)', set_cookie)
                    if match:
                        sid = match.group(1)
                        if hasattr(self.client, "cookies") and hasattr(self.client.cookies, "set"):
                            self.client.cookies.set("SID", sid)
                if sid:
                    self.sid = sid
                    self.expires = time.time() + 3000
                    return True
                else:
                    body_snippet = _format_body_snippet(resp)
                    print(f'[QBIT] login HTTP {status} body="{body_snippet}"')
                    print("Authentication successful but SID cookie not found in response.")
            else:
                body_snippet = _format_body_snippet(resp)
                print(f'[QBIT] login HTTP {status} body="{body_snippet}"')
                print(f"Authentication failed: HTTP {status} - {text}")
        except Exception as e:
            self.last_auth_status = 0
            print(f"Error during qBittorrent authentication: {e}")
        return False

    def _authenticated_request(
        self,
        op: str,
        method: str,
        url: str,
        is_accepted=None,
        headers: Optional[dict] = None,
        **kwargs
    ) -> Any:
        """Perform an authenticated request with 401/403 session-recovery retry and non-accepted response logging."""
        req_headers = dict(headers or {})
        if self.sid:
            req_headers["Cookie"] = f"SID={self.sid}"

        def _do_call(h):
            m = method.upper()
            if m == "GET" and hasattr(self.client, "get"):
                return self.client.get(url, headers=h, **kwargs)
            elif m == "POST" and hasattr(self.client, "post"):
                return self.client.post(url, headers=h, **kwargs)
            else:
                return self.client.request(method, url, headers=h, **kwargs)

        resp = _do_call(req_headers)
        status = getattr(resp, "status_code", 0)

        if status in (401, 403):
            body_snippet = _format_body_snippet(resp)
            print(f'[QBIT] {op} HTTP {status} body="{body_snippet}"')

            self.sid = None
            self.expires = 0.0
            try:
                if hasattr(self.client, "cookies") and hasattr(self.client.cookies, "delete"):
                    self.client.cookies.delete("SID")
            except Exception:
                pass

            reauth_success = self._authenticate()
            if reauth_success:
                if self.sid:
                    req_headers["Cookie"] = f"SID={self.sid}"
                elif "Cookie" in req_headers:
                    del req_headers["Cookie"]

                retry_resp = _do_call(req_headers)
                retry_status = getattr(retry_resp, "status_code", 0)
                retry_snippet = _format_body_snippet(retry_resp)
                print(f'[QBIT] {op} retry HTTP {retry_status} body="{retry_snippet}"')
                return retry_resp
            else:
                print(f'[QBIT] {op} retry failed: re-authentication failed')
                return resp

        if is_accepted is not None and not is_accepted(resp):
            body_snippet = _format_body_snippet(resp)
            print(f'[QBIT] {op} HTTP {status} body="{body_snippet}"')

        return resp

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

    def check_hash_exists(self, torrent_hash: str) -> Optional[dict]:
        """Check if a torrent with the given info hash exists in qBittorrent exactly.

        Queries POST /api/v2/torrents/info with form data {"hashes": torrent_hash}.
        Returns the matching torrent dict if found, else None.
        """
        if not self._ensure_auth():
            return None
        config = get_config()
        base_url = (config.qbit_url or "http://localhost:8080").rstrip("/")
        info_url = f"{base_url}/api/v2/torrents/info"
        th = (torrent_hash or "").strip().lower()
        if not th:
            return None

        try:
            resp = self._authenticated_request(
                "check_hash_exists",
                "POST",
                info_url,
                data={"hashes": th},
                headers={"Content-Type": "application/x-www-form-urlencoded"},
                is_accepted=lambda r: getattr(r, "status_code", 0) == 200,
            )
            if resp is not None and getattr(resp, "status_code", 0) == 200:
                torrents = resp.json() if callable(getattr(resp, "json", None)) else []
                if isinstance(torrents, list) and torrents:
                    for t in torrents:
                        if (t.get("hash") or "").lower() == th:
                            return t
                    if len(torrents) == 1 and not torrents[0].get("hash"):
                        return torrents[0]
        except Exception as e:
            print(f"Error checking hash existence: {e}")
        return None

    def get_all_torrents(self, category: str = "animu") -> list:
        """Return the full torrent list for a category by paginating POST /api/v2/torrents/info.

        Uses limit and offset with page size 1000. Stops when a page returns fewer rows than 1000,
        with a hard cap of 20 pages. Detects infinite loops if qBittorrent ignores offset
        (page identical to the previous one) and stops.
        """
        if not self._ensure_auth():
            return []

        config = get_config()
        base_url = (config.qbit_url or "http://localhost:8080").rstrip("/")
        info_url = f"{base_url}/api/v2/torrents/info"
        page_size = 1000
        max_pages = 20
        all_torrents = []
        prev_page = None

        for page_idx in range(max_pages):
            offset = page_idx * page_size
            payload = {
                "category": category,
                "sort": "added_on",
                "reverse": "true",
                "limit": page_size,
                "offset": offset,
            }
            headers = {"Content-Type": "application/x-www-form-urlencoded"}
            try:
                resp = self._authenticated_request(
                    "info",
                    "POST",
                    info_url,
                    data=payload,
                    headers=headers,
                    is_accepted=lambda r: getattr(r, "status_code", 0) == 200,
                )
                if resp is None or getattr(resp, "status_code", 0) != 200:
                    break
                page = resp.json() if callable(getattr(resp, "json", None)) else []
                if not isinstance(page, list):
                    break
            except Exception as exc:
                print(f"Failed to fetch paginated torrents (page {page_idx}): {exc}")
                break

            if not page:
                break

            if prev_page is not None and page == prev_page:
                print(f"[QBIT] pagination detected duplicate page at offset {offset}, stopping")
                break

            all_torrents.extend(page)
            prev_page = page

            if len(page) < page_size:
                break

        return all_torrents

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

            if self.last_add_was_duplicate:
                print(f"Torrent {display_title} verified as duplicate in qBittorrent.")
                return True

            print(f"Sent Add Request to qBittorrent: {display_title}. Verifying...")
            
            # Check with retries to give qBittorrent time to register/fetch metadata
            for check_attempt in range(3):
                time.sleep(2.0)
                if self.check_torrent(display_title):
                    print(f"Torrent {display_title} successfully verified in qBittorrent.")
                    return True
                    
            print(f"Attempt {attempt}: Torrent {display_title} was not verified in qBittorrent torrent list.")
            if not self.last_add_error:
                self.last_add_error = f"Torrent {display_title} was not verified in qBittorrent torrent list"

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
        self.last_add_was_duplicate = False
        try:
            torrent_bytes = self.download_torrent_file(link, use_proxy)
            size = len(torrent_bytes)
            looks_like_torrent = torrent_bytes.startswith(b"d") and b"announce" in torrent_bytes
            print(f'[QBIT] fetched payload size={size} looks_like_torrent={looks_like_torrent}')
            if not looks_like_torrent:
                self.last_add_error = f"Fetched payload does not look like a torrent (size={size})"
                return False

            try:
                info_hash = compute_info_hash(torrent_bytes)
            except Exception as exc:
                info_hash = None
                print(f"[QBIT] could not compute info hash from torrent payload: {exc}")

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

            resp = self._authenticated_request(
                "add",
                "POST",
                auth_url,
                data=data,
                files=files,
                is_accepted=lambda r: getattr(r, "status_code", 0) == 200 and getattr(r, "text", "") == "Ok.",
            )
            status = getattr(resp, "status_code", 0) if resp is not None else 0
            text = getattr(resp, "text", "") if resp is not None else ""
            if resp is not None and status == 200 and text == "Ok.":
                self.last_add_error = ""
                self.last_add_was_duplicate = False
                return True

            # If the POST came back with a non-accepted response (e.g. Fails.),
            # query qBittorrent for it: if the hash exists, verify payload is present.
            if info_hash:
                existing = self.check_hash_exists(info_hash)
                if existing is not None:
                    progress = existing.get("progress")
                    try:
                        progress_val = float(progress) if progress is not None else 0.0
                    except (ValueError, TypeError):
                        progress_val = 0.0

                    if progress_val > 0:
                        t_name = existing.get("name") or rename
                        print(f'[QBIT] add duplicate hash={info_hash} name="{t_name}"')
                        self.last_add_was_duplicate = True
                        self.last_add_error = ""
                        return True
                    else:
                        self.last_add_was_duplicate = False
                        try:
                            self.recheck_torrent(info_hash)
                            self.resume_torrent(info_hash)
                        except Exception as exc:
                            print(f"[QBIT] error requesting recheck/resume for {info_hash}: {exc}")
                        self.last_add_error = (
                            f"Existing torrent has no data (progress={progress_val:g}), recheck requested"
                            if progress_val != 0
                            else "Existing torrent has no data (progress=0), recheck requested"
                        )
                        return False

            if resp is not None:
                body_snippet = _format_body_snippet(resp).strip()
                self.last_add_error = f"HTTP {status}: {body_snippet}"
            elif not self.last_add_error:
                self.last_add_error = "Failed to communicate with qBittorrent"
            return False
        except Exception as e:
            self.last_add_error = str(e)
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
        self.last_add_was_duplicate = False
        config = get_config()
        base_url = config.qbit_url or "http://localhost:8080"
        add_url = f"{base_url.rstrip('/')}/api/v2/torrents/add"

        if not self._ensure_auth():
            print("Failed to authenticate with qBittorrent.")
            self.last_add_error = "Failed to authenticate with qBittorrent"
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
        if not self._ensure_auth():
            return False

        try:
            # Distinctive title tokens with season markers removed
            title_norm = re.sub(r"\bs\d+\b", "", title.lower())
            title_norm = re.sub(r"[\W_]+", " ", title_norm).strip()
            tokens = [w for w in title_norm.split() if len(w) > 3]
            if not tokens:
                return False

            ep_pattern = re.compile(r"(?:^|[^\w])(?:e(?:p)?\s*)?0*%d(?:$|[^\w])" % episode, re.IGNORECASE)
            torrents = self.get_all_torrents()
            for t in torrents:
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
        if not self._ensure_auth():
            return []

        try:
            title_norm = re.sub(r"\bs\d+\b", "", title.lower())
            title_norm = re.sub(r"[\W_]+", " ", title_norm).strip()
            tokens = [w for w in title_norm.split() if len(w) > 3]
            if not tokens:
                return []

            target = set(episodes)
            found: set = set()
            config = get_config()
            base_url = config.qbit_url or "http://localhost:8080"
            files_url = f"{base_url.rstrip('/')}/api/v2/torrents/files"

            torrents = self.get_all_torrents()
            for t in torrents:
                if t.get("progress", 0) < 1:
                    continue
                t_name = (t.get("name") or "").lower()
                save_path = (t.get("save_path") or "").lower()
                if not (all(tok in t_name for tok in tokens) or all(tok in save_path for tok in tokens)):
                    continue
                fr = self._authenticated_request(
                    "info",
                    "POST",
                    files_url,
                    data={"hash": t.get("hash")},
                    headers={"Content-Type": "application/x-www-form-urlencoded"},
                    is_accepted=lambda r: getattr(r, "status_code", 0) == 200,
                )
                if fr is None or getattr(fr, "status_code", 0) != 200:
                    continue
                files_list = (fr.json() if callable(getattr(fr, "json", None)) else []) or []
                for f in files_list:
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
        if not self._ensure_auth():
            return False

        try:
            torrents = self.get_all_torrents()
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
        if not self._ensure_auth():
            return False

        config = get_config()
        base_url = config.qbit_url or "http://localhost:8080"
        delete_url = f"{base_url.rstrip('/')}/api/v2/torrents/delete"

        try:
            # Query torrent list to find hash
            torrents = self.get_all_torrents()
            target_torrent = None
            for torrent in torrents:
                if torrent.get("name") == name:
                    target_torrent = torrent
                    break

            if not target_torrent:
                print(f"Torrent with name '{name}' not found.")
                return False

            torrent_hash = target_torrent["hash"]
            del_resp = self._authenticated_request(
                "delete",
                "POST",
                delete_url,
                data={"hashes": torrent_hash},
                headers={"Content-Type": "application/x-www-form-urlencoded"},
                is_accepted=lambda r: getattr(r, "status_code", 0) == 200 and getattr(r, "text", "") == "Ok.",
            )
            return del_resp is not None and getattr(del_resp, "status_code", 0) == 200 and getattr(del_resp, "text", "") == "Ok."
        except Exception as e:
            print(f"Error deleting torrent: {e}")
            return False

    def get_active_downloads(self) -> list:
        """Fetch the torrent queue from qBittorrent (any state), enriched with
        a normalized ``statusKind``/``statusLabel`` classification.

        qBittorrent's ``state`` strings are verbose and internal-looking
        (``stoppedDL``, ``forcedUP``, ``metaDL`` …). The UI needs to show the
        *true* state of each torrent — stopped, errored, complete, seeding,
        downloading, etc. — so we fetch the full queue and classify each entry.

        Completed/seeding torrents (``complete``/``seeding`` kinds) are
        excluded from the returned list — the Watching-tab queue only shows
        work still in progress or needing attention (downloading, stalled,
        queued, stopped, paused, checking, error). Returns at most 50 items so
        the UI payload stays small.
        """
        if not self._ensure_auth():
            return []
        try:
            torrents = self.get_all_torrents()
            enriched = []
            for t in torrents:
                item = dict(t)
                kind, label = self.classify_state(item.get("state", ""))
                # Skip finished torrents — they're not "active downloads".
                if kind in ("complete", "seeding"):
                    continue
                item["statusKind"] = kind
                item["statusLabel"] = label
                enriched.append(item)
                if len(enriched) >= 50:
                    break
            return enriched
        except Exception as e:
            print(f"Failed to fetch qBittorrent active downloads: {e}")
            return []

    def list_torrents(self, category: str = "animu", limit: int = 1000) -> list:
        """Return the raw qBittorrent queue for a category (any state).

        Unlike ``get_active_downloads`` this keeps completed/seeding torrents, and
        it returns every entry rather than the first ten: the re-download
        remediation needs the release name and hash of torrents that finished
        long ago.
        """
        if not self._ensure_auth():
            return []
        config = get_config()
        base_url = config.qbit_url or "http://localhost:8080"
        info_url = f"{base_url.rstrip('/')}/api/v2/torrents/info"
        try:
            resp = self._authenticated_request(
                "info",
                "GET",
                info_url,
                params={"filter": "all", "category": category, "sort": "added_on",
                        "reverse": "true", "limit": limit},
                is_accepted=lambda r: getattr(r, "status_code", 0) == 200,
            )
            if resp is not None and getattr(resp, "status_code", 0) == 200:
                return (resp.json() if callable(getattr(resp, "json", None)) else []) or []
            if resp is not None:
                print(f"qBittorrent torrent list returned HTTP {getattr(resp, 'status_code', 0)}")
        except Exception as exc:
            print(f"Failed to fetch qBittorrent torrent list: {exc}")
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
            resp = self._authenticated_request(
                "resume",
                "POST",
                resume_url,
                data={"hashes": torrent_hash},
                headers={"Content-Type": "application/x-www-form-urlencoded"},
                is_accepted=lambda r: getattr(r, "status_code", 0) == 200 and getattr(r, "text", "") == "Ok.",
            )
            return resp is not None and getattr(resp, "status_code", 0) == 200 and getattr(resp, "text", "") == "Ok."
        except Exception as e:
            print(f"Failed to resume torrent {torrent_hash}: {e}")
            return False

    def recheck_torrent(self, torrent_hash: str) -> bool:
        """Force qBittorrent to re-check a torrent's files on disk.

        Required for ``missingFiles`` torrents — qBittorrent refuses to resume
        them; a recheck makes it re-scan the save path and recover the data
        (e.g. files moved back into place, stale temp pointer).
        """
        config = get_config()
        base_url = config.qbit_url or "http://localhost:8080"
        recheck_url = f"{base_url.rstrip('/')}/api/v2/torrents/recheck"
        if not self._ensure_auth():
            return False
        try:
            resp = self._authenticated_request(
                "recheck",
                "POST",
                recheck_url,
                data={"hashes": torrent_hash},
                headers={"Content-Type": "application/x-www-form-urlencoded"},
                is_accepted=lambda r: getattr(r, "status_code", 0) == 200,
            )
            return resp is not None and getattr(resp, "status_code", 0) == 200
        except Exception as e:
            print(f"Failed to recheck torrent {torrent_hash}: {e}")
            return False

    def get_torrent_state(self, torrent_hash: str) -> Optional[str]:
        """Fetch current qBittorrent state string for a torrent by hash."""
        if not self._ensure_auth():
            return None
        th = (torrent_hash or "").strip().lower()
        if not th:
            return None
        try:
            for t in self.get_all_torrents():
                if (t.get("hash") or "").lower() == th:
                    return t.get("state")

            # Fallback to direct hash query if not found in paginated category list
            config = get_config()
            base_url = config.qbit_url or "http://localhost:8080"
            info_url = f"{base_url.rstrip('/')}/api/v2/torrents/info"
            resp = self._authenticated_request(
                "get_torrent_state",
                "GET",
                info_url,
                params={"hashes": torrent_hash},
                is_accepted=lambda r: getattr(r, "status_code", 0) == 200,
            )
            if resp is not None and getattr(resp, "status_code", 0) == 200:
                data = resp.json() if callable(getattr(resp, "json", None)) else None
                if isinstance(data, list) and len(data) > 0:
                    return data[0].get("state")
        except Exception as e:
            print(f"Failed to get torrent state for {torrent_hash}: {e}")
        return None

    def delete_torrent_by_hash(self, torrent_hash: str, delete_files: bool = False) -> bool:
        """Delete a torrent by hash. ``delete_files=False`` keeps the data on
        disk (safe default for a mistaken remove)."""
        config = get_config()
        base_url = config.qbit_url or "http://localhost:8080"
        delete_url = f"{base_url.rstrip('/')}/api/v2/torrents/delete"
        if not self._ensure_auth():
            return False
        try:
            resp = self._authenticated_request(
                "delete",
                "POST",
                delete_url,
                data={"hashes": torrent_hash, "deleteFiles": "true" if delete_files else "false"},
                headers={"Content-Type": "application/x-www-form-urlencoded"},
                is_accepted=lambda r: getattr(r, "status_code", 0) == 200 and getattr(r, "text", "") == "Ok.",
            )
            return resp is not None and getattr(resp, "status_code", 0) == 200 and getattr(resp, "text", "") == "Ok."
        except Exception as e:
            print(f"Failed to delete torrent {torrent_hash}: {e}")
            return False

    def diagnose(self, torrent_hash: Optional[str] = None) -> dict:
        """Run a read-only diagnostic check against qBittorrent."""
        config = get_config()
        base_url = (config.qbit_url or "http://localhost:8080").rstrip("/")
        version_url = f"{base_url}/api/v2/app/version"
        info_url = f"{base_url}/api/v2/torrents/info"

        login = False
        auth_status = 0
        try:
            login = self._authenticate()
            auth_status = getattr(self, "last_auth_status", 200 if login else 0)
        except Exception:
            login = False
            auth_status = 0

        version = ""
        info_status = 0
        torrent_count = 0

        headers = {}
        if self.sid:
            headers["Cookie"] = f"SID={self.sid}"

        try:
            resp_v = self.client.get(version_url, headers=headers)
            if getattr(resp_v, "status_code", 0) == 200:
                version = getattr(resp_v, "text", "").strip()
        except Exception:
            version = ""

        try:
            resp_i = self.client.get(info_url, params={"category": "animu"}, headers=headers)
            info_status = getattr(resp_i, "status_code", 0)
            if info_status == 200:
                torrents = resp_i.json() if callable(getattr(resp_i, "json", None)) else []
                torrent_count = len(torrents or [])
        except Exception:
            info_status = 0
            torrent_count = 0

        result = {
            "login": bool(login),
            "auth_status": int(auth_status),
            "version": str(version),
            "info_status": int(info_status),
            "torrent_count": int(torrent_count),
            "last_add_error": str(self.last_add_error or ""),
        }

        if torrent_hash is not None and str(torrent_hash).strip():
            th = str(torrent_hash).strip()
            exists = False
            state = ""
            name = ""
            progress = 0.0

            if re.fullmatch(r"[0-9a-fA-F]{40}", th):
                th_lower = th.lower()
                try:
                    h_headers = dict(headers)
                    h_headers["Content-Type"] = "application/x-www-form-urlencoded"
                    resp_h = self.client.post(info_url, data={"hashes": th_lower}, headers=h_headers)
                    if getattr(resp_h, "status_code", 0) in (404, 405):
                        resp_h = self.client.get(info_url, params={"hashes": th_lower}, headers=headers)
                    if getattr(resp_h, "status_code", 0) == 200:
                        matching = resp_h.json() if callable(getattr(resp_h, "json", None)) else []
                        if isinstance(matching, list) and matching:
                            for m in matching:
                                if (m.get("hash") or "").lower() == th_lower:
                                    exists = True
                                    state = str(m.get("state") or "")
                                    name = str(m.get("name") or "")
                                    progress = float(m.get("progress", 0.0))
                                    break
                            if not exists and len(matching) == 1 and not matching[0].get("hash"):
                                exists = True
                                state = str(matching[0].get("state") or "")
                                name = str(matching[0].get("name") or "")
                                progress = float(matching[0].get("progress", 0.0))
                except Exception as e:
                    print(f"Error querying hash in diagnose: {e}")

            result["exists"] = bool(exists)
            result["state"] = str(state)
            result["name"] = str(name)
            result["progress"] = progress

        return result

qbit = QbitClient()
