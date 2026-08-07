import http.server
import json
import os
import httpx
import re
import posixpath
import urllib.parse
import threading
from typing import Any, Dict, List, Optional

from .config import get_config, save_config, reload_config, MAP_ATTR_TO_JSON, MAP_JSON_TO_ATTR
from .anilist import anilist
from .nyaa import nyaa
from .qbittorrent import qbit
from .database import db
from .models import OfflineAnime
from .history import history_manager

def get_config_dict(cfg) -> dict:
    """Serializes ProfileConfig back to the camelCase JSON format for the UI."""
    from dataclasses import asdict
    cfg_dict = asdict(cfg)
    cfg_dict.pop('_extra_fields', None)

    json_data = {}
    if hasattr(cfg, '_extra_fields') and cfg._extra_fields:
        json_data.update(cfg._extra_fields)

    for k, v in cfg_dict.items():
        json_data[MAP_ATTR_TO_JSON.get(k, k)] = v
    return json_data

def read_log_tail(file_path: str, max_lines: int = 50) -> str:
    """Reads the last N lines of a log file efficiently."""
    if not os.path.exists(file_path):
        return f"Log file not found: {file_path}"
    try:
        with open(file_path, 'rb') as f:
            f.seek(0, os.SEEK_END)
            file_size = f.tell()

            chunk_size = 1024 * 64
            buffer = b""
            position = file_size
            newline_count = 0

            while position > 0 and newline_count <= max_lines + 1:
                read_size = min(chunk_size, position)
                position -= read_size
                f.seek(position)
                chunk = f.read(read_size)
                buffer = chunk + buffer
                newline_count = buffer.count(b"\n")

            lines = buffer.decode("utf-8", errors="ignore").splitlines()
            return "\n".join(lines[-max_lines:])
    except Exception as e:
        return f"Error reading log tail: {e}"

class AnimuHTTPHandler(http.server.BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        # Override to suppress standard HTTP request printing in console logs (matches Node.js clean log)
        pass

    def send_json(self, status: int, data: Any):
        content = json.dumps(data).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(content)))
        self.end_headers()
        self.wfile.write(content)

    def read_json_body(self) -> dict:
        try:
            content_length = int(self.headers.get('Content-Length', 0))
            if content_length == 0:
                return {}
            body = self.rfile.read(content_length)
            return json.loads(body.decode('utf-8'))
        except Exception:
            return {}

    def get_anime_list(self) -> List[Dict[str, Any]]:
        """Fetch AniList watch list and merge local PocketBase configurations."""
        anime_list = anilist.get_anime_user_list()
        pb_records = db.get_all()
        pb_map = {r.media_id: r for r in pb_records}

        merged = []
        for anime in anime_list:
            media_id = anime["mediaId"]
            record = pb_map.get(media_id)

            alt_title = record.alternative_title if record else ""
            start_ep = record.starting_episode if record else 0
            downloaded = record.downloaded_episodes if record else []

            media = dict(anime["media"])
            media["alternativeTitle"] = alt_title or None
            media["startingEpisode"] = start_ep

            merged.append({
                "mediaId": media_id,
                "progress": anime["progress"],
                "downloadedEpisodes": downloaded,
                "media": media
            })

        # Sort Romaji titles (A-Z first, then others)
        def get_sort_key(item):
            title = item.get("media", {}).get("title", {}).get("romaji") or ""
            trimmed = title.strip()
            bucket = 0 if re.match(r'^[A-Za-z]', trimmed) else 1
            return (bucket, trimmed.lower(), item["mediaId"])

        merged.sort(key=get_sort_key)
        return merged

    def do_GET(self):
        url = urllib.parse.urlparse(self.path)
        path = url.path

        if path == "/api/anime":
            try:
                anime = self.get_anime_list()
                self.send_json(200, {
                    "userName": get_config().ani_user_name or "",
                    "count": len(anime),
                    "anime": anime
                })
            except Exception as e:
                self.send_json(500, {"error": str(e)})

        elif path == "/api/config":
            self.send_json(200, get_config_dict(get_config()))

        elif path == "/api/logs":
            self.handle_get_logs(url)

        elif path == "/api/downloads":
            try:
                downloads = qbit.get_active_downloads()
                self.send_json(200, downloads)
            except Exception as e:
                self.send_json(500, {"error": str(e)})

        elif path == "/api/search-debug":
            try:
                from .nyaa import failed_traces
                self.send_json(200, list(failed_traces.values()))
            except Exception as e:
                self.send_json(500, {"error": str(e)})

        elif path == "/api/health":
            self.send_json(200, {"ok": True})

        elif path == "/api/history":
            try:
                items = history_manager.get_all()
                self.send_json(200, {
                    "count": len(items),
                    "history": items
                })
            except Exception as e:
                self.send_json(500, {"error": str(e)})

        elif path == "/api/anilist/notifications":
            try:
                watching = self.get_anime_list()
                notifs = []
                import time
                now = time.time()
                for item in watching:
                    media = item.get("media", {})
                    next_ep = media.get("nextAiringEpisode")
                    title = media.get("title", {}).get("romaji") or media.get("title", {}).get("english") or "Anime"
                    if next_ep and isinstance(next_ep, dict):
                        airing_at = next_ep.get("airingAt", 0)
                        ep = next_ep.get("episode", 1)
                        if airing_at < now + 86400: # Airing today or recently aired
                            notifs.append({
                                "id": f"airing-{media.get('id')}-{ep}",
                                "type": "AIRING",
                                "mediaId": media.get("id"),
                                "title": title,
                                "message": f"Episode {ep} of {title} airs soon / recently aired!",
                                "timestamp": airing_at,
                                "unread": True,
                                "coverImage": media.get("coverImage", {}).get("medium")
                            })
                self.send_json(200, {
                    "count": len(notifs),
                    "notifications": notifs
                })
            except Exception as e:
                self.send_json(200, {"count": 0, "notifications": []})

        else:
            self.serve_static(path)

    def do_POST(self):
        url = urllib.parse.urlparse(self.path)
        path = url.path

        if path == "/api/test/qbittorrent":
            body = self.read_json_body()
            qbit_url = body.get("qbitUrl", body.get("qbit_url", "")).strip()
            user = body.get("username", "").strip()
            passwd = body.get("password", "").strip()
            if not qbit_url:
                self.send_json(400, {"ok": False, "error": "qBittorrent URL is required"})
                return
            ok, msg = qbit.test_connection(qbit_url, user, passwd)
            self.send_json(200, {"ok": ok, "message": msg})
            return

        elif path == "/api/test/proxy":
            body = self.read_json_body()
            addr = body.get("proxyAddress", "").strip()
            port = body.get("proxyPort")
            if not addr or not port:
                self.send_json(400, {"ok": False, "error": "Proxy Address and Port are required"})
                return
            try:
                proxy_url = f"http://{addr}:{port}"
                with httpx.Client(verify=False, proxy=proxy_url, timeout=6) as client:
                    resp = client.get("https://google.com")
                    if resp.status_code >= 200 and resp.status_code < 400:
                        self.send_json(200, {"ok": True, "message": "Proxy connection successful."})
                    else:
                        self.send_json(200, {"ok": False, "error": f"Failed with status: {resp.status_code}"})
            except Exception as e:
                self.send_json(200, {"ok": False, "error": str(e)})
            return

        elif path == "/api/test/discord":
            body = self.read_json_body()
            webhook_url = body.get("webhook", "").strip()
            if not webhook_url:
                self.send_json(400, {"ok": False, "error": "Webhook URL is required"})
                return
            from .discord import send_anime_downloaded_hook
            original_webhook = get_config().webhook
            get_config().webhook = webhook_url
            try:
                success = send_anime_downloaded_hook(
                    "**Animu Connection Test**",
                    0x00FF00,
                    "https://anilist.co/img/logo_al.png",
                    {"name": "Status", "value": "Successful Test Notification"}
                )
                if success:
                    self.send_json(200, {"ok": True, "message": "Test webhook notification sent successfully!"})
                else:
                    self.send_json(200, {"ok": False, "error": "Failed to send embed. Check the URL or Discord channel permissions."})
            except Exception as e:
                self.send_json(200, {"ok": False, "error": str(e)})
            finally:
                get_config().webhook = original_webhook
            return

        elif path == "/api/nyaa-search":
            body = self.read_json_body()
            query = body.get("query", "").strip()
            use_alt_url = bool(body.get("useAltUrl"))

            if not query:
                self.send_json(400, {"error": "Query is required"})
                return

            candidates = nyaa.search_raw_title_candidates(query, use_alt_url)
            results = [{
                "title": c["title"],
                "link": c["link"],
                "seeders": c["nyaa:seeders"],
                "size": c["nyaa:size"],
                "pubDate": c["pubDate"],
                "score": None
            } for c in candidates[:25]]

            self.send_json(200, {
                "title": query,
                "episode": None,
                "useAltUrl": use_alt_url,
                "count": len(candidates),
                "results": results
            })

        elif path == "/api/nyaa-download":
            body = self.read_json_body()
            link = body.get("link", "").strip()
            title = body.get("title", "").strip()
            use_alt_url = bool(body.get("useAltUrl"))

            if not link or not title:
                self.send_json(400, {"error": "Link and title are required"})
                return

            success = qbit.add_check_torrent(link, title, None, use_alt_url)
            if not success:
                self.send_json(500, {"error": "qBittorrent rejected the torrent"})
                return

            history_manager.add_entry(
                title=title,
                link=link,
                source="manual"
            )
            self.send_json(200, {"ok": True, "title": title, "episode": None})

        # Pattern matches below
        elif re.match(r'^/api/anime/(\d+)/nyaa-search$', path):
            media_id = int(re.match(r'^/api/anime/(\d+)/nyaa-search$', path).group(1))
            body = self.read_json_body()
            episode = body.get("episode")

            # Fetch anime details
            watching = self.get_anime_list()
            anime = next((x for x in watching if x["mediaId"] == media_id), None)
            if not anime:
                self.send_json(404, {"error": "Anime not found"})
                return

            record = db.get(media_id)
            starting_episode = record.starting_episode if record else 0
            alt_title = record.alternative_title if record else None

            if episode is not None:
                try:
                    episode_val = int(episode)
                    candidates = nyaa.search_episode_candidates(anime, episode_val, starting_episode, alt_title)
                except ValueError:
                    self.send_json(400, {"error": "Invalid episode value"})
                    return
            else:
                candidates = nyaa.search_title_candidates(anime, starting_episode, alt_title)

            results = [{
                "title": c["title"],
                "link": c["link"],
                "seeders": c["nyaa:seeders"],
                "size": c["nyaa:size"],
                "pubDate": c["pubDate"],
                "score": round(c["score"], 3) if c["score"] is not None else None
            } for c in candidates[:25]]

            self.send_json(200, {
                "mediaId": media_id,
                "episode": episode,
                "title": anime["media"]["alternativeTitle"] or anime["media"]["title"]["romaji"],
                "count": len(candidates),
                "results": results
            })

        elif re.match(r'^/api/anime/(\d+)/nyaa-download$', path):
            media_id = int(re.match(r'^/api/anime/(\d+)/nyaa-download$', path).group(1))
            body = self.read_json_body()
            link = body.get("link", "").strip()
            episode = body.get("episode")

            watching = self.get_anime_list()
            anime = next((x for x in watching if x["mediaId"] == media_id), None)
            if not anime:
                self.send_json(404, {"error": "Anime not found"})
                return

            if not link:
                self.send_json(400, {"error": "Link is required"})
                return

            save_title = anime["media"]["alternativeTitle"] or anime["media"]["title"]["romaji"]
            use_proxy_download = nyaa.should_use_proxy_download(anime)

            success = qbit.add_check_torrent(link, save_title, episode, use_proxy_download)
            if not success:
                self.send_json(500, {"error": "qBittorrent rejected the download request"})
                return

            cover_img = anime["media"].get("coverImage", {}).get("extraLarge") or anime["media"].get("coverImage", {}).get("medium")
            history_manager.add_entry(
                title=save_title,
                link=link,
                anime_title=save_title,
                episode=episode,
                cover_image=cover_img,
                source="manual"
            )

            # If successful and episode specified, save progress
            if episode is not None:
                record = db.get(media_id) or OfflineAnime(media_id=media_id)
                if episode not in record.downloaded_episodes:
                    record.downloaded_episodes.append(episode)
                    record.downloaded_episodes.sort()
                record.reset_timeout()
                db.upsert(media_id, record)

            self.send_json(200, {
                "ok": True,
                "mediaId": media_id,
                "episode": episode,
                "title": save_title
            })

        elif re.match(r'^/api/anime/(\d+)/rewatching$', path):
            media_id = int(re.match(r'^/api/anime/(\d+)/rewatching$', path).group(1))
            success = anilist.set_anime_to_rewatching(media_id)
            if not success:
                self.send_json(500, {"error": "AniList update failed"})
                return
            self.send_json(200, {"ok": True})

        elif re.match(r'^/api/anime/(\d+)/reset$', path):
            media_id = int(re.match(r'^/api/anime/(\d+)/reset$', path).group(1))
            record = db.get(media_id)
            if record:
                record.downloaded_episodes = []
                db.upsert(media_id, record)
            self.send_json(200, {"ok": True})

        else:
            self.send_json(404, {"error": "Not found"})

    def do_PATCH(self):
        url = urllib.parse.urlparse(self.path)
        path = url.path

        if path == "/api/config":
            body = self.read_json_body()
            current = get_config()
            for k, v in body.items():
                attr = MAP_JSON_TO_ATTR.get(k, k)
                if hasattr(current, attr):
                    setattr(current, attr, v)
            save_config(current)
            reload_config()
            self.send_json(200, {"ok": True, "config": get_config_dict(get_config())})

        elif re.match(r'^/api/anime/(\d+)$', path):
            media_id = int(re.match(r'^/api/anime/(\d+)$', path).group(1))
            body = self.read_json_body()

            record = db.get(media_id) or OfflineAnime(media_id=media_id)

            if "alternativeTitle" in body:
                record.alternative_title = str(body["alternativeTitle"] or "").strip()
            if "startingEpisode" in body:
                try:
                    record.starting_episode = max(0, int(body["startingEpisode"]))
                except ValueError:
                    pass
            if body.get("resetDownloadedEpisodes"):
                record.downloaded_episodes = []

            db.upsert(media_id, record)
            cached = db.local_cache.get(str(media_id), {})
            synced = not cached.get("_unsynced", False)
            self.send_json(200, {"ok": True, "synced": synced,
                "warning": "Saved locally but PocketBase sync failed." if not synced else None})

        else:
            self.send_json(404, {"error": "Not found"})

    def do_DELETE(self):
        url = urllib.parse.urlparse(self.path)
        path = url.path

        if path == "/api/history":
            history_manager.clear_all()
            self.send_json(200, {"ok": True})
        elif re.match(r'^/api/history/([a-zA-Z0-9-]+)$', path):
            entry_id = re.match(r'^/api/history/([a-zA-Z0-9-]+)$', path).group(1)
            deleted = history_manager.delete_entry(entry_id)
            self.send_json(200, {"ok": deleted})
        else:
            self.send_json(404, {"error": "Not found"})

    def handle_get_logs(self, url):
        """Builds log lines payload for tailing/viewing logs."""
        params = urllib.parse.parse_qs(url.query)
        requested_key = params.get("name", ["combined"])[0]
        max_lines = 50
        try:
            max_lines = int(params.get("lines", [50])[0])
            max_lines = min(1000, max_lines)
        except ValueError:
            pass

        root_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
        logs_dir = os.path.join(root_dir, 'logs')

        log_files = {
            "combined": {"label": "Combined", "path": os.path.join(logs_dir, "animu.log")},
            "out": {"label": "Stdout", "path": os.path.join(logs_dir, "animu-out.log")},
            "error": {"label": "Stderr", "path": os.path.join(logs_dir, "animu-error.log")}
        }

        selected = requested_key if requested_key in log_files else "combined"
        file_info = log_files[selected]

        content = read_log_tail(file_info["path"], max_lines)

        available = [{"key": k, "label": v["label"]} for k, v in log_files.items()]

        self.send_json(200, {
            "selected": selected,
            "available": available,
            "path": file_info["path"],
            "lines": max_lines,
            "content": content
        })

    def serve_static(self, path: str):
        root_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
        public_dir = os.path.join(root_dir, 'webui')

        # Clean pathname
        filename = path.lstrip('/')
        if not filename or filename in ('index.html', 'settings') or re.match(r'^anime/\d+$', filename):
            filename = 'index.html'

        full_path = os.path.abspath(os.path.join(public_dir, filename))

        # Verify subdirectory traversal prevention
        if not full_path.startswith(os.path.abspath(public_dir)):
            self.send_response(403)
            self.end_headers()
            self.wfile.write(b"Forbidden")
            return

        if os.path.exists(full_path) and os.path.isfile(full_path):
            ext = os.path.splitext(full_path)[1].lower()
            mime_types = {
                ".html": "text/html; charset=utf-8",
                ".js": "application/javascript; charset=utf-8",
                ".css": "text/css; charset=utf-8",
                ".ico": "image/x-icon",
                ".png": "image/png",
                ".jpg": "image/jpeg",
            }
            content_type = mime_types.get(ext, "application/octet-stream")
            try:
                with open(full_path, 'rb') as f:
                    content = f.read()
                self.send_response(200)
                self.send_header("Content-Type", content_type)
                self.send_header("Cache-Control", "public, max-age=0, must-revalidate")
                self.send_header("Content-Length", str(len(content)))
                self.end_headers()
                self.wfile.write(content)
                return
            except Exception as e:
                self.send_response(500)
                self.end_headers()
                self.wfile.write(str(e).encode('utf-8'))
                return

        self.send_response(404)
        self.end_headers()
        self.wfile.write(b"Not found")

def start_server():
    """Starts the http server synchronously."""
    import sys
    port = 3210
    host = "0.0.0.0"

    for i, arg in enumerate(sys.argv):
        if arg == "--port" and i + 1 < len(sys.argv):
            try:
                port = int(sys.argv[i + 1])
            except ValueError:
                pass
        elif arg == "--host" and i + 1 < len(sys.argv):
            host = sys.argv[i + 1]

    # Ensure logs folder exists
    root_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
    os.makedirs(os.path.join(root_dir, 'logs'), exist_ok=True)

    server = http.server.HTTPServer((host, port), AnimuHTTPHandler)
    print(f"Animu Web UI running at http://localhost:{port} (bind {host})")
    server.serve_forever()

def start():
    """Starts the Web UI server in a background daemon thread."""
    t = threading.Thread(target=start_server, daemon=True)
    t.start()

if __name__ == "__main__":
    start_server()
