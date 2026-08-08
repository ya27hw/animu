import http.server
import json
import os
import subprocess
import httpx
import re
import posixpath
import urllib.parse
import threading
from typing import Any, Dict, List, Optional

from .config import get_config, save_config, reload_config, MAP_ATTR_TO_JSON, MAP_JSON_TO_ATTR
from .anilist import anilist
from .anilist_mutations import mutations as anilist_mutations
from .anilist_auth import auth as anilist_auth, execute_graphql, SENSITIVE_CONFIG_FIELDS
from .nyaa import nyaa
from .qbittorrent import qbit
from .database import db
from .models import OfflineAnime
from .history import history_manager
from .ignored import ignored_manager
from . import readiness

# Cache-busting version for the SPA assets. NPM's global assets.conf caches
# .js/.css with a long max-age and strips the backend Cache-Control header, so
# without a versioned URL a deploy leaves browsers on stale JS. Derive from git
# HEAD when available, else fall back to app.js mtime.
def _asset_version() -> str:
    try:
        root = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
        out = subprocess.check_output(
            ["git", "-C", root, "rev-parse", "--short", "HEAD"],
            timeout=2, stderr=subprocess.DEVNULL,
        ).decode().strip()
        if out:
            return out
    except Exception:
        pass
    try:
        root = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
        return str(int(os.path.getmtime(os.path.join(root, 'webui', 'app.js'))))
    except Exception:
        return "dev"

ASSET_VERSION = _asset_version()

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

def sanitize_config_for_api(cfg_dict: dict) -> dict:
    """Strip sensitive fields (tokens, secrets) from config dicts sent to the UI.

    The bearer token and any credential-bearing fields must never appear in
    API responses, exceptions, or git diffs (profile.json is gitignored, but
    the /api/config endpoint must also be safe).
    """
    safe = dict(cfg_dict)
    for field_name in SENSITIVE_CONFIG_FIELDS:
        json_key = MAP_ATTR_TO_JSON.get(field_name, field_name)
        safe.pop(json_key, None)
        safe.pop(field_name, None)
    return safe

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

def enrich_media_with_local_state(media_item: dict) -> dict:
    """Merges local PocketBase record info into an AniList media item dictionary."""
    if not isinstance(media_item, dict):
        return media_item
    media_id = media_item.get("id") or media_item.get("mediaId")
    if not media_id:
        return media_item

    record = db.get(int(media_id))
    enriched = dict(media_item)
    if record:
        enriched["localState"] = {
            "tracked": True,
            "alternativeTitle": record.alternative_title or None,
            "startingEpisode": record.starting_episode,
            "downloadedEpisodes": record.downloaded_episodes or [],
            "timeouts": record.timeouts
        }
    else:
        enriched["localState"] = {
            "tracked": False,
            "alternativeTitle": None,
            "startingEpisode": 0,
            "downloadedEpisodes": [],
            "timeouts": 0
        }
    return enriched

def enrich_media_list_with_local_state(media_list: list) -> list:
    """Applies local state enrichment across a list of media dicts."""
    return [enrich_media_with_local_state(m) for m in media_list]

def handle_history_delete_action(entry_id: str, action: str) -> tuple:
    items = history_manager.get_all()
    item = next((x for x in items if x.get("id") == entry_id), None)
    if not item:
        return 404, {"error": "History entry not found"}

    history_title = item.get("anime_title") or item.get("title") or ""
    history_ep = item.get("episode")

    deleted = history_manager.delete_entry(entry_id)
    if not deleted:
        return 500, {"error": "Failed to delete history entry"}

    if action == "delete" or not action:
        return 200, {"ok": True, "action": "delete"}

    # Try matching to anime record
    matched_media_id = None
    matched_anime = None
    
    try:
        anime_list = anilist.get_anime_user_list()
    except Exception:
        anime_list = []

    pb_records = db.get_all()
    target_clean = re.sub(r'[\(\[\{].*?[\)\]\}]', '', history_title).strip().lower()

    for a in anime_list:
        mid = a["mediaId"]
        media_titles = [
            a["media"]["title"].get("romaji", ""),
            a["media"]["title"].get("english", ""),
            a["media"].get("alternativeTitle", "")
        ] + (a["media"].get("synonyms") or [])
        
        rec = next((r for r in pb_records if r.media_id == mid), None)
        if rec and rec.alternative_title:
            media_titles.append(rec.alternative_title)

        for t in media_titles:
            if not t:
                continue
            t_clean = t.strip().lower()
            if t_clean and (t_clean == target_clean or t_clean in target_clean or target_clean in t_clean):
                matched_media_id = mid
                matched_anime = a
                break
        if matched_media_id:
            break

    if action == "rerun":
        if matched_media_id:
            record = db.get(matched_media_id) or OfflineAnime(media_id=matched_media_id)
            record.downloaded_episodes = []
            record.reset_timeout()
            db.upsert(matched_media_id, record)
            return 200, {
                "ok": True,
                "action": "rerun",
                "mediaId": matched_media_id,
                "message": f"History entry deleted and re-run scheduled for '{history_title}'."
            }
        else:
            return 200, {
                "ok": True,
                "action": "rerun",
                "mediaId": None,
                "message": "History entry deleted, but no matching anime record found to reset."
            }

    elif action == "ignore-redownload":
        ignored_manager.add_entry(history_title, matched_media_id)
        redownloaded = False
        if matched_anime and matched_media_id:
            try:
                rec = db.get(matched_media_id)
                starting_ep = rec.starting_episode if rec else 0
                alt_title = rec.alternative_title if rec else None
                
                if history_ep is not None:
                    try:
                        ep_val = int(history_ep)
                        cands = nyaa.search_episode_candidates(matched_anime, ep_val, starting_ep, alt_title)
                    except Exception:
                        cands = nyaa.search_title_candidates(matched_anime, starting_ep, alt_title)
                else:
                    cands = nyaa.search_title_candidates(matched_anime, starting_ep, alt_title)
                    
                if cands:
                    best = cands[0]
                    use_alt = nyaa.should_use_proxy_download(matched_anime)
                    save_title = matched_anime["media"].get("alternativeTitle") or matched_anime["media"]["title"]["romaji"]
                    qbit.add_check_torrent(best["link"], save_title, history_ep, use_alt)
                    cover_img = matched_anime["media"].get("coverImage", {}).get("extraLarge") or matched_anime["media"].get("coverImage", {}).get("medium")
                    history_manager.add_entry(
                        title=best["title"],
                        link=best["link"],
                        anime_title=save_title,
                        episode=history_ep,
                        size=best.get("nyaa:size") or best.get("size") or "Unknown",
                        seeders=best.get("nyaa:seeders") or best.get("seeders") or "N/A",
                        cover_image=cover_img,
                        source="manual"
                    )
                    redownloaded = True
            except Exception as e:
                print(f"Error re-downloading via matched anime: {e}")

        if not redownloaded:
            try:
                search_query = history_title or item.get("title") or ""
                cands = nyaa.search_raw_title_candidates(search_query, False)
                if cands:
                    best = cands[0]
                    qbit.add_check_torrent(best["link"], best["title"], history_ep, False)
                    history_manager.add_entry(
                        title=best["title"],
                        link=best["link"],
                        anime_title=history_title,
                        episode=history_ep,
                        size=best.get("nyaa:size") or best.get("size") or "Unknown",
                        seeders=best.get("nyaa:seeders") or best.get("seeders") or "N/A",
                        source="manual"
                    )
                    redownloaded = True
            except Exception as e:
                print(f"Error re-downloading via raw title: {e}")

        return 200, {
            "ok": True,
            "action": "ignore-redownload",
            "ignored": True,
            "redownloaded": redownloaded,
            "message": "Deleted history entry, added anime to ignore list, and triggered re-download."
        }

    return 400, {"error": "Invalid action"}

# ---------------------------------------------------------------------------
# AniList route helpers
# ---------------------------------------------------------------------------

def _int_param(value, default=None, required=False, name="param"):
    """Parse an integer parameter from a query/body value.

    Returns ``None`` for falsy values.  Raises ``ValueError`` on invalid
    integers so callers can translate to a 400 response.
    """
    if value in (None, "", []):
        if required:
            raise ValueError(f"{name} is required")
        return default
    return int(value)


def _parse_int_list(value, name="param"):
    """Parse a list of ints from a comma-separated or JSON list value."""
    if value is None or value == "":
        return None
    if isinstance(value, list):
        return [int(v) for v in value]
    if isinstance(value, str):
        return [int(v) for v in value.split(",") if v.strip() != ""]
    raise ValueError(f"{name} must be a list or comma-separated string")


def _bool_param(value, default=False):
    """Parse a boolean from a query/body value (strings like 'true'/'false')."""
    if value is None or value == "":
        return default
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        return value.strip().lower() in ("1", "true", "yes")
    return bool(value)


def _resolve_anilist_user_id(token: Optional[str]) -> Optional[int]:
    """Resolve a path token (numeric id or username) to an AniList user id.

    Numeric tokens pass through directly; username tokens are looked up via
    ``anilist.get_user`` so ``/following`` and ``/followers`` (which require
    a numeric ``userId``) work with either contract.  Returns ``None`` when
    the user cannot be resolved.
    """
    if not token:
        return None
    if token.isdigit():
        return int(token)
    try:
        user = anilist.get_user(user_name=token)
    except Exception:
        return None
    if user and user.get("id"):
        return int(user["id"])
    return None


def _safe_error_response(result, fallback="Operation failed"):
    """Translate an AniList GraphQL response dict into a safe (status, body) pair.

    ``result`` may contain ``data`` (success), ``errors`` (GraphQL errors),
    or be ``None`` / empty (network failure).  The bearer token is never
    present in ``execute_graphql`` payloads, and this helper never injects
    internal state, so error bodies cannot leak credentials or stack traces.
    """
    if not result:
        return 502, {"error": "No response from AniList API"}
    if "errors" in result:
        messages = ", ".join(
            e.get("message", "Unknown error") for e in result["errors"]
        )
        lowered = messages.lower()
        if any(w in lowered for w in ("unauthorized", "token", "not configured", "401", "forbidden")):
            return 401, {"error": messages}
        return 400, {"error": messages}
    return 200, {"data": result.get("data", result)}


def _handle_graphql_read(callable_fn, *args, **kwargs):
    """Run a read-side AniList client method and return a safe HTTP (status, body).

    Wraps the client call so GraphQL errors / network failures translate to
    safe 4xx/5xx responses without leaking tokens or stack traces.
    """
    try:
        result = callable_fn(*args, **kwargs)
        if result is None:
            return 502, {"error": "No response from AniList API"}
        return 200, {"data": result}
    except Exception as e:
        # Never leak stack traces; surface a concise, safe message.
        msg = str(e)
        if any(w in msg.lower() for w in SENSITIVE_CONFIG_FIELDS):
            return 401, {"error": "AniList authentication is required."}
        return 500, {"error": "AniList query failed" if "token" not in msg.lower() else msg}


def _handle_graphql_mutation(mutation_name: str, **kwargs):
    """Dispatch an AniList mutation (requires auth) and return a safe HTTP response.

    ``mutation_name`` selects a method on the ``anilist_mutations`` singleton.
    All mutations run through ``_run_mutation`` → ``execute_graphql`` which
    enforces ``require_auth=True`` (fail-closed).  GraphQL/network errors are
    translated into safe HTTP responses via ``_safe_error_response``; the
    bearer token never appears in the response (it only lives on the
    ``Authorization`` header, which ``execute_graphql`` manages internally).
    """
    method = getattr(anilist_mutations, mutation_name, None)
    if method is None:
        return 404, {"error": f"Mutation '{mutation_name}' is not available"}
    result = method(**kwargs)
    if not result:
        return 502, {"error": "No response from AniList API"}
    if "errors" in result:
        return _safe_error_response(result)
    # Success — return the mutation's data payload (keyed by the mutation field).
    data = result.get("data", result)
    return 200, data


class AnimuHTTPHandler(http.server.BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        # Override to suppress standard HTTP request printing in console logs (matches Node.js clean log)
        pass

    def send_json(self, status: int, data: Any):
        content = json.dumps(data).encode("utf-8")
        try:
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(content)))
            self.end_headers()
            self.wfile.write(content)
        except (BrokenPipeError, ConnectionError, OSError):
            # Client disconnected (common behind NPM reverse proxy) — suppress
            # the traceback that otherwise floods logs on every stale connection.
            pass

    def _safe_write(self, content: bytes):
        """Write a static response body without noisy disconnect tracebacks."""
        try:
            self.wfile.write(content)
        except (BrokenPipeError, ConnectionError, OSError):
            pass

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
        # None (network/GraphQL outage) degrades to an empty list so the API
        # stays up; empty list means "no anime in watching list".
        anime_list = anilist.get_anime_user_list() or []
        pb_records = db.get_all()
        pb_map = {r.media_id: r for r in pb_records}
        
        merged = []
        for anime in anime_list:
            media_id = anime.get("mediaId") or anime.get("id")
            if media_id is None:
                continue
            record = pb_map.get(media_id)

            alt_title = record.alternative_title if record else ""
            start_ep = record.starting_episode if record else 0
            downloaded = record.downloaded_episodes if record else []

            # Incomplete AniList records can carry a null ``media`` node
            # (e.g. an entry whose title was deleted upstream). Null-safe here
            # so one broken record never 500s the whole /api/anime response.
            media = dict(anime["media"]) if anime.get("media") else {}
            media["alternativeTitle"] = alt_title or None
            media["startingEpisode"] = start_ep

            merged.append({
                "mediaId": media_id,
                "progress": anime.get("progress", 0),
                "downloadedEpisodes": downloaded,
                "media": media
            })

        # Sort Romaji titles (A-Z first, then others)
        def get_sort_key(item):
            title = (item.get("media") or {}).get("title") or {}
            romaji = title.get("romaji") or ""
            trimmed = romaji.strip()
            bucket = 0 if re.match(r'^[A-Za-z]', trimmed) else 1
            return (bucket, trimmed.lower(), item.get("mediaId") or 0)
            
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

        elif path == "/api/anilist/discover":
            try:
                params = urllib.parse.parse_qs(url.query)
                disc_type = params.get("type", ["trending"])[0]
                try:
                    page = int(params.get("page", [1])[0])
                except ValueError:
                    page = 1
                try:
                    per_page = int(params.get("perPage", [20])[0])
                except ValueError:
                    per_page = 20

                result = anilist.get_discover_anime(disc_type, page, per_page)
                media = result.get("media", [])
                result["media"] = enrich_media_list_with_local_state(media)
                result["type"] = disc_type
                self.send_json(200, result)
            except Exception as e:
                self.send_json(500, {"error": str(e)})

        elif path == "/api/anilist/search":
            try:
                params = urllib.parse.parse_qs(url.query)
                q = params.get("q", [""])[0]
                try:
                    page = int(params.get("page", [1])[0])
                except ValueError:
                    page = 1
                try:
                    per_page = int(params.get("perPage", [20])[0])
                except ValueError:
                    per_page = 20

                if not q:
                    self.send_json(400, {"error": "Query parameter 'q' is required"})
                    return

                result = anilist.search_anime(q, page, per_page)
                media = result.get("media", [])
                result["media"] = enrich_media_list_with_local_state(media)
                result["query"] = q
                self.send_json(200, result)
            except Exception as e:
                self.send_json(500, {"error": str(e)})

        elif re.match(r'^/api/anilist/media/(\d+)$', path):
            try:
                media_id = int(re.match(r'^/api/anilist/media/(\d+)$', path).group(1))
                media = anilist.get_media_detail(media_id)
                if not media:
                    self.send_json(404, {"error": "Anime not found on AniList"})
                    return
                enriched = enrich_media_with_local_state(media)
                self.send_json(200, {"media": enriched})
            except Exception as e:
                self.send_json(500, {"error": str(e)})

        elif path == "/api/anilist/auth/url":
            self.handle_auth_url()

        elif path == "/api/anilist/auth/pin":
            self.handle_auth_pin()

        elif path == "/api/anilist/auth/state":
            self.handle_auth_state()

        elif re.match(r'^/api/anilist/media/(\d+)/airing$', path):
            try:
                media_id = int(re.match(r'^/api/anilist/media/(\d+)/airing$', path).group(1))
                params = urllib.parse.parse_qs(url.query)
                page = 1
                try:
                    page = int(params.get("page", [1])[0])
                except ValueError:
                    pass
                status, body = _handle_graphql_read(
                    anilist.get_airing_schedule_by_id, media_id, page=page
                )
                self.send_json(status, body)
            except Exception as e:
                self.send_json(500, {"error": str(e)})

        elif re.match(r'^/api/anilist/media/(\d+)/relations$', path):
            try:
                media_id = int(re.match(r'^/api/anilist/media/(\d+)/relations$', path).group(1))
                status, body = _handle_graphql_read(anilist.get_previous_relations, media_id)
                self.send_json(status, body)
            except Exception as e:
                self.send_json(500, {"error": str(e)})

        elif path == "/api/anilist/media-trend":
            params = urllib.parse.parse_qs(url.query)
            try:
                page = int(params.get("page", [1])[0])
            except ValueError:
                page = 1
            try:
                per_page = int(params.get("perPage", [50])[0])
            except ValueError:
                per_page = 50
            date = _int_param(params.get("date", [None])[0])
            trending_greater = _int_param(params.get("trendingGreater", [None])[0])
            average_score_greater = _int_param(params.get("averageScoreGreater", [None])[0])
            popularity_greater = _int_param(params.get("popularityGreater", [None])[0])
            try:
                result = anilist.get_media_trend(
                    page=page, per_page=per_page, date=date,
                    trending_greater=trending_greater,
                    averageScore_greater=average_score_greater,
                    popularity_greater=popularity_greater,
                )
                self.send_json(200, result)
            except Exception as e:
                self.send_json(500, {"error": str(e)})

        elif path == "/api/anilist/user-list":
            params = urllib.parse.parse_qs(url.query)
            user_name = params.get("userName", [None])[0]
            media_type = params.get("type", ["ANIME"])[0]
            try:
                per_chunk = int(params.get("perChunk", [500])[0])
            except ValueError:
                per_chunk = 500
            status_in = params.get("statusIn", None)
            if status_in:
                try:
                    status_in = [s for s in status_in]
                except Exception:
                    status_in = None
            force_single = _bool_param(params.get("forceSingleCompletedList", [True])[0], default=True)
            sort_raw = params.get("sort", None)
            if sort_raw:
                if isinstance(sort_raw, list):
                    sort = sort_raw
                else:
                    sort = [sort_raw]
            else:
                sort = None
            try:
                result = anilist.get_media_list_collection(
                    user_name=user_name or None,
                    media_type=media_type,
                    status_in=status_in,
                    per_chunk=per_chunk,
                    force_single_completed_list=force_single,
                    sort=sort,
                )
                self.send_json(200, result)
            except Exception as e:
                self.send_json(500, {"error": str(e)})

        elif path == "/api/anilist/genres":
            try:
                result = anilist.get_genre_collection()
                self.send_json(200, {"genres": result})
            except Exception as e:
                self.send_json(500, {"error": str(e)})

        elif path == "/api/anilist/tags":
            try:
                result = anilist.get_media_tag_collection()
                self.send_json(200, {"tags": result})
            except Exception as e:
                self.send_json(500, {"error": str(e)})

        elif re.match(r'^/api/anilist/user$', path) or re.match(r'^/api/anilist/user/[^/]+$', path):
            params = urllib.parse.parse_qs(url.query)
            user_id = _int_param(params.get("id", [None])[0])
            user_name = params.get("name", [None])[0]
            # Path-token contract (mirrors api.js getUser/getUserFollowing):
            # /api/anilist/user/<id>  or  /api/anilist/user/<name>
            m = re.match(r'^/api/anilist/user/([^/]+)$', path)
            if m:
                token = m.group(1)
                if token.isdigit():
                    user_id = int(token)
                else:
                    user_name = token
            if not user_id and not user_name:
                # /api/anilist/viewer — convenience alias for the authenticated user
                try:
                    result = anilist.get_viewer()
                    if not result:
                        self.send_json(404, {"error": "Viewer not found"})
                        return
                    self.send_json(200, {"viewer": result})
                except Exception as e:
                    self.send_json(500, {"error": str(e)})
            else:
                try:
                    result = anilist.get_user(user_id=user_id, user_name=user_name)
                    if not result:
                        self.send_json(404, {"error": "User not found"})
                        return
                    self.send_json(200, {"user": result})
                except Exception as e:
                    self.send_json(500, {"error": str(e)})

        elif path == "/api/anilist/viewer":
            try:
                result = anilist.get_viewer()
                if not result:
                    self.send_json(404, {"error": "Viewer not found"})
                    return
                self.send_json(200, {"viewer": result})
            except Exception as e:
                self.send_json(500, {"error": str(e)})

        elif re.match(r'^/api/anilist/user/[^/]+/following$', path):
            try:
                token = re.match(r'^/api/anilist/user/([^/]+)/following$', path).group(1)
                user_id = _resolve_anilist_user_id(token)
                if user_id is None:
                    self.send_json(404, {"error": "User not found"})
                    return
                params = urllib.parse.parse_qs(url.query)
                page = _int_param(params.get("page", [1])[0], default=1)
                per_page = _int_param(params.get("perPage", [50])[0], default=50)
                sort = params.get("sort", None)
                result = anilist.get_following(user_id, page=page, per_page=per_page, sort=sort)
                self.send_json(200, result)
            except Exception as e:
                self.send_json(500, {"error": str(e)})

        elif re.match(r'^/api/anilist/user/[^/]+/followers$', path):
            try:
                token = re.match(r'^/api/anilist/user/([^/]+)/followers$', path).group(1)
                user_id = _resolve_anilist_user_id(token)
                if user_id is None:
                    self.send_json(404, {"error": "User not found"})
                    return
                params = urllib.parse.parse_qs(url.query)
                page = _int_param(params.get("page", [1])[0], default=1)
                per_page = _int_param(params.get("perPage", [50])[0], default=50)
                sort = params.get("sort", None)
                result = anilist.get_followers(user_id, page=page, per_page=per_page, sort=sort)
                self.send_json(200, result)
            except Exception as e:
                self.send_json(500, {"error": str(e)})

        elif path == "/api/anilist/notifications":
            params = urllib.parse.parse_qs(url.query)
            page = _int_param(params.get("page", [1])[0], default=1)
            per_page = _int_param(params.get("perPage", [50])[0], default=50)
            notification_type = params.get("type", [None])[0]
            reset = _bool_param(params.get("resetNotificationCount", [False])[0])
            try:
                result = anilist.get_notifications(
                    page=page, per_page=per_page,
                    notification_type=notification_type or None,
                    reset_notification_count=reset,
                )
                self.send_json(200, result)
            except Exception as e:
                self.send_json(500, {"error": str(e)})

        elif path == "/api/anilist/reviews":
            params = urllib.parse.parse_qs(url.query)
            page = _int_param(params.get("page", [1])[0], default=1)
            per_page = _int_param(params.get("perPage", [50])[0], default=50)
            media_id = _int_param(params.get("mediaId", [None])[0])
            user_id = _int_param(params.get("userId", [None])[0])
            media_type = params.get("type", ["ANIME"])[0]
            sort = params.get("sort", None)
            if isinstance(sort, list):
                sort = sort
            try:
                result = anilist.get_reviews(
                    media_id=media_id, user_id=user_id, media_type=media_type,
                    page=page, per_page=per_page, sort=sort,
                )
                self.send_json(200, result)
            except Exception as e:
                self.send_json(500, {"error": str(e)})

        elif path == "/api/anilist/activity":
            params = urllib.parse.parse_qs(url.query)
            page = _int_param(params.get("page", [1])[0], default=1)
            per_page = _int_param(params.get("perPage", [30])[0], default=30)
            user_id = _int_param(params.get("userId", [None])[0])
            messenger_id = _int_param(params.get("messengerId", [None])[0])
            media_id = _int_param(params.get("mediaId", [None])[0])
            activity_type = params.get("type", [None])[0]
            is_following = _bool_param(params.get("isFollowing", [True])[0], default=True)
            has_replies = _bool_param(params.get("hasReplies", [False])[0])
            try:
                result = anilist.get_activity_feed(
                    page=page, per_page=per_page, user_id=user_id,
                    messenger_id=messenger_id, media_id=media_id,
                    activity_type=activity_type or None, is_following=is_following,
                    has_replies=has_replies,
                )
                self.send_json(200, result)
            except Exception as e:
                self.send_json(500, {"error": str(e)})

        elif re.match(r'^/api/anilist/character/(\d+)$', path):
            try:
                char_id = int(re.match(r'^/api/anilist/character/(\d+)$', path).group(1))
                result = anilist.get_character(char_id)
                if not result:
                    self.send_json(404, {"error": "Character not found on AniList"})
                    return
                self.send_json(200, {"character": result})
            except Exception as e:
                self.send_json(500, {"error": str(e)})

        elif path == "/api/anilist/characters/search":
            params = urllib.parse.parse_qs(url.query)
            q = params.get("q", [""])[0]
            page = _int_param(params.get("page", [1])[0], default=1)
            per_page = _int_param(params.get("perPage", [50])[0], default=50)
            try:
                result = anilist.search_characters(q, page=page, per_page=per_page)
                self.send_json(200, result)
            except Exception as e:
                self.send_json(500, {"error": str(e)})

        elif re.match(r'^/api/anilist/staff/(\d+)$', path):
            try:
                staff_id = int(re.match(r'^/api/anilist/staff/(\d+)$', path).group(1))
                result = anilist.get_staff(staff_id)
                if not result:
                    self.send_json(404, {"error": "Staff not found on AniList"})
                    return
                self.send_json(200, {"staff": result})
            except Exception as e:
                self.send_json(500, {"error": str(e)})

        elif path == "/api/anilist/staff/search":
            params = urllib.parse.parse_qs(url.query)
            q = params.get("q", [""])[0]
            page = _int_param(params.get("page", [1])[0], default=1)
            per_page = _int_param(params.get("perPage", [50])[0], default=50)
            try:
                result = anilist.search_staff(q, page=page, per_page=per_page)
                self.send_json(200, result)
            except Exception as e:
                self.send_json(500, {"error": str(e)})

        elif re.match(r'^/api/anilist/studio/(\d+)$', path):
            try:
                studio_id = int(re.match(r'^/api/anilist/studio/(\d+)$', path).group(1))
                result = anilist.get_studio(studio_id)
                if not result:
                    self.send_json(404, {"error": "Studio not found on AniList"})
                    return
                self.send_json(200, {"studio": result})
            except Exception as e:
                self.send_json(500, {"error": str(e)})

        elif path == "/api/anilist/studios/search":
            params = urllib.parse.parse_qs(url.query)
            q = params.get("q", [""])[0]
            page = _int_param(params.get("page", [1])[0], default=1)
            per_page = _int_param(params.get("perPage", [50])[0], default=50)
            try:
                result = anilist.search_studios(q, page=page, per_page=per_page)
                self.send_json(200, result)
            except Exception as e:
                self.send_json(500, {"error": str(e)})

        elif path == "/api/anilist/recommendations":
            params = urllib.parse.parse_qs(url.query)
            page = _int_param(params.get("page", [1])[0], default=1)
            per_page = _int_param(params.get("perPage", [50])[0], default=50)
            media_id = _int_param(params.get("mediaId", [None])[0])
            user_id = _int_param(params.get("userId", [None])[0])
            sort = params.get("sort", None)
            try:
                result = anilist.get_recommendations(
                    media_id=media_id, user_id=user_id, page=page, per_page=per_page, sort=sort,
                )
                self.send_json(200, result)
            except Exception as e:
                self.send_json(500, {"error": str(e)})

        elif path == "/api/anilist/site-statistics":
            try:
                result = anilist.get_site_statistics()
                if not result:
                    self.send_json(404, {"error": "Site statistics not found"})
                    return
                self.send_json(200, {"statistics": result})
            except Exception as e:
                self.send_json(500, {"error": str(e)})

        elif re.match(r'^/api/anilist/anichart/(\d+)$', path):
            try:
                user_id = int(re.match(r'^/api/anilist/anichart/(\d+)$', path).group(1))
                result = anilist.get_anichart_user(user_id)
                if not result:
                    self.send_json(404, {"error": "AniChart user not found"})
                    return
                self.send_json(200, {"anichart": result})
            except Exception as e:
                self.send_json(500, {"error": str(e)})

        elif path == "/api/anilist/markdown":
            body_params = url.query  # markdown is a GET query param
            params = urllib.parse.parse_qs(url.query)
            markdown_text = params.get("text", [""])[0]
            if not markdown_text:
                self.send_json(400, {"error": "Query parameter 'text' is required"})
                return
            try:
                result = anilist.get_markdown_html(markdown_text)
                if result is None:
                    self.send_json(502, {"error": "No response from AniList API"})
                    return
                self.send_json(200, {"html": result})
            except Exception as e:
                self.send_json(500, {"error": str(e)})

        elif re.match(r'^/api/anilist/thread/(\d+)$', path):
            try:
                thread_id = int(re.match(r'^/api/anilist/thread/(\d+)$', path).group(1))
                result = anilist.get_thread(thread_id)
                if not result:
                    self.send_json(404, {"error": "Thread not found on AniList"})
                    return
                self.send_json(200, {"thread": result})
            except Exception as e:
                self.send_json(500, {"error": str(e)})

        elif path == "/api/anilist/threads":
            params = urllib.parse.parse_qs(url.query)
            page = _int_param(params.get("page", [1])[0], default=1)
            per_page = _int_param(params.get("perPage", [50])[0], default=50)
            user_id = _int_param(params.get("userId", [None])[0])
            reply_user_id = _int_param(params.get("replyUserId", [None])[0])
            category_id = _int_param(params.get("categoryId", [None])[0])
            subscribed = _bool_param(params.get("subscribed", [False])[0])
            search = params.get("search", [None])[0]
            try:
                result = anilist.get_threads(
                    page=page, per_page=per_page, user_id=user_id,
                    reply_user_id=reply_user_id, category_id=category_id,
                    subscribed=subscribed, search=search,
                )
                self.send_json(200, result)
            except Exception as e:
                self.send_json(500, {"error": str(e)})

        elif re.match(r'^/api/anilist/thread/(\d+)/comments$', path):
            try:
                thread_id = int(re.match(r'^/api/anilist/thread/(\d+)/comments$', path).group(1))
                params = urllib.parse.parse_qs(url.query)
                page = _int_param(params.get("page", [1])[0], default=1)
                per_page = _int_param(params.get("perPage", [50])[0], default=50)
                result = anilist.get_thread_comments(thread_id, page=page, per_page=per_page)
                self.send_json(200, result)
            except Exception as e:
                self.send_json(500, {"error": str(e)})

        elif path == "/api/config":
            self.send_json(200, sanitize_config_for_api(get_config_dict(get_config())))
            
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
                from .nyaa import get_failed_traces_snapshot
                self.send_json(200, get_failed_traces_snapshot())
            except Exception as e:
                self.send_json(500, {"error": str(e)})
            
        elif path == "/api/health":
            status, payload = health_response()
            self.send_json(status, payload)
            
        elif path == "/api/history":
            try:
                items = history_manager.get_all()
                self.send_json(200, {
                    "count": len(items),
                    "history": items
                })
            except Exception as e:
                self.send_json(500, {"error": str(e)})

        elif path == "/api/ignored":
            try:
                items = ignored_manager.get_all()
                self.send_json(200, {
                    "count": len(items),
                    "ignored": items
                })
            except Exception as e:
                self.send_json(500, {"error": str(e)})
            
        else:
            self.serve_static(path)

    def do_POST(self):
        url = urllib.parse.urlparse(self.path)
        path = url.path

        if path == "/api/anilist/list":
            body = self.read_json_body()
            media_id = body.get("mediaId")
            status = body.get("status")
            progress = body.get("progress")
            score = body.get("score")

            if not media_id:
                self.send_json(400, {"ok": False, "error": "mediaId is required"})
                return

            try:
                media_id = int(media_id)
            except ValueError:
                self.send_json(400, {"ok": False, "error": "Invalid mediaId"})
                return

            prog_val = None
            if progress is not None:
                try:
                    prog_val = int(progress)
                except ValueError:
                    self.send_json(400, {"ok": False, "error": "Invalid progress value"})
                    return

            score_val = None
            if score is not None:
                try:
                    score_val = float(score)
                except ValueError:
                    self.send_json(400, {"ok": False, "error": "Invalid score value"})
                    return

            result = anilist.save_media_list_entry(
                media_id=media_id,
                status=str(status) if status else None,
                progress=prog_val,
                score=score_val
            )

            if result.get("success"):
                self.send_json(200, {"ok": True, "entry": result.get("entry")})
            else:
                err_msg = result.get("error", "Mutation failed")
                status_code = 401 if ("Token" in err_msg or "401" in err_msg or "Unauthorized" in err_msg) else 400
                self.send_json(status_code, {"ok": False, "error": err_msg})
            return

        # ------------------------------------------------------------------
        # Section 4 mutation routes — all require auth (require_auth=True path).
        # Each delegates to the AniListMutations singleton, which enforces
        # fail-closed behaviour and never leaks the bearer token.
        # ------------------------------------------------------------------

        elif path == "/api/anilist/list/update":
            body = self.read_json_body()
            media_id = body.get("mediaId")
            if not media_id:
                self.send_json(400, {"ok": False, "error": "mediaId is required"})
                return
            try:
                status, resp = _handle_graphql_mutation(
                    "save_media_list_entry",
                    media_id=int(media_id),
                    status=body.get("status", body.get("state")),
                    score=body.get("score"),
                    score_raw=body.get("scoreRaw"),
                    progress=body.get("progress"),
                    progress_volumes=body.get("progressVolumes"),
                    repeat=body.get("repeat"),
                    priority=body.get("priority"),
                    notes=body.get("notes"),
                    private=body.get("private"),
                    hidden_from_status_lists=body.get("hiddenFromStatusLists"),
                    custom_lists=body.get("customLists"),
                    advanced_scores=body.get("advancedScores"),
                    started_at=body.get("startedAt"),
                    completed_at=body.get("completedAt"),
                    entry_id=body.get("id"),
                )
            except (ValueError, TypeError) as e:
                status, resp = 400, {"error": str(e)}
            except Exception:
                status, resp = 500, {"error": "AniList update failed"}
            self.send_json(status, resp)
            return

        elif path == "/api/anilist/list/update-many":
            body = self.read_json_body()
            ids = body.get("ids")
            if not ids:
                self.send_json(400, {"error": "ids is required"})
                return
            try:
                ids = _parse_int_list(ids, "ids")
            except ValueError:
                self.send_json(400, {"error": "ids must be a list of integers"})
                return
            status, resp = _handle_graphql_mutation(
                "update_media_list_entries",
                ids=ids,
                status=body.get("status"),
                score=body.get("score"),
                score_raw=body.get("scoreRaw"),
                progress=body.get("progress"),
                progress_volumes=body.get("progressVolumes"),
                repeat=body.get("repeat"),
                priority=body.get("priority"),
                notes=body.get("notes"),
                private=body.get("private"),
                hidden_from_status_lists=body.get("hiddenFromStatusLists"),
                custom_lists=body.get("customLists"),
                advanced_scores=body.get("advancedScores"),
                started_at=body.get("startedAt"),
                completed_at=body.get("completedAt"),
            )
            self.send_json(status, resp)
            return

        elif path == "/api/anilist/activity/text":
            body = self.read_json_body()
            text = body.get("text")
            if not text:
                self.send_json(400, {"error": "text is required"})
                return
            status, resp = _handle_graphql_mutation("save_text_activity", text=text, activity_id=body.get("id"), locked=body.get("locked"))
            self.send_json(status, resp)
            return

        elif path == "/api/anilist/activity/message":
            body = self.read_json_body()
            message = body.get("message")
            recipient_id = body.get("recipientId")
            if not message or not recipient_id:
                self.send_json(400, {"error": "message and recipientId are required"})
                return
            try:
                status, resp = _handle_graphql_mutation(
                    "save_message_activity",
                    message=message, recipient_id=int(recipient_id),
                    activity_id=body.get("id"), private=body.get("private"),
                    locked=body.get("locked"), as_mod=body.get("asMod"),
                )
            except (ValueError, TypeError) as e:
                status, resp = 400, {"error": str(e)}
            self.send_json(status, resp)
            return

        elif path == "/api/anilist/activity/reply":
            body = self.read_json_body()
            activity_id = body.get("activityId")
            text = body.get("text")
            if not activity_id or not text:
                self.send_json(400, {"error": "activityId and text are required"})
                return
            try:
                status, resp = _handle_graphql_mutation(
                    "save_activity_reply",
                    activity_id=int(activity_id), text=text,
                    reply_id=body.get("id"), as_mod=body.get("asMod"),
                )
            except (ValueError, TypeError) as e:
                status, resp = 400, {"error": str(e)}
            self.send_json(status, resp)
            return

        elif path == "/api/anilist/like":
            body = self.read_json_body()
            likeable_id = body.get("id")
            likeable_type = body.get("type", "ACTIVITY")
            if not likeable_id:
                self.send_json(400, {"error": "id is required"})
                return
            try:
                status, resp = _handle_graphql_mutation(
                    "toggle_like", likeable_id=int(likeable_id), likeable_type=likeable_type,
                )
            except (ValueError, TypeError) as e:
                status, resp = 400, {"error": str(e)}
            self.send_json(status, resp)
            return

        elif path == "/api/anilist/follow":
            body = self.read_json_body()
            user_id = body.get("userId")
            if not user_id:
                self.send_json(400, {"error": "userId is required"})
                return
            try:
                status, resp = _handle_graphql_mutation("toggle_follow", user_id=int(user_id))
            except (ValueError, TypeError) as e:
                status, resp = 400, {"error": str(e)}
            self.send_json(status, resp)
            return

        elif path == "/api/anilist/favourite":
            body = self.read_json_body()
            try:
                status, resp = _handle_graphql_mutation(
                    "toggle_favourite",
                    anime_id=body.get("animeId"),
                    manga_id=body.get("mangaId"),
                    character_id=body.get("characterId"),
                    staff_id=body.get("staffId"),
                    studio_id=body.get("studioId"),
                )
            except Exception:
                status, resp = 500, {"error": "AniList favourite update failed"}
            self.send_json(status, resp)
            return

        elif path == "/api/anilist/favourite/order":
            body = self.read_json_body()
            try:
                status, resp = _handle_graphql_mutation(
                    "update_favourite_order",
                    anime_ids=_parse_int_list(body.get("animeIds"), "animeIds"),
                    manga_ids=_parse_int_list(body.get("mangaIds"), "mangaIds"),
                    character_ids=_parse_int_list(body.get("characterIds"), "characterIds"),
                    staff_ids=_parse_int_list(body.get("staffIds"), "staffIds"),
                    studio_ids=_parse_int_list(body.get("studioIds"), "studioIds"),
                )
            except ValueError as e:
                status, resp = 400, {"error": str(e)}
            except Exception:
                status, resp = 500, {"error": "AniList favourites order update failed"}
            self.send_json(status, resp)
            return

        elif path == "/api/anilist/review":
            body = self.read_json_body()
            media_id = body.get("mediaId")
            body_text = body.get("body")
            if not media_id or not body_text:
                self.send_json(400, {"error": "mediaId and body are required"})
                return
            try:
                status, resp = _handle_graphql_mutation(
                    "save_review",
                    media_id=int(media_id), body=body_text,
                    summary=body.get("summary"), score=body.get("score"),
                    private=body.get("private"), review_id=body.get("id"),
                )
            except (ValueError, TypeError) as e:
                status, resp = 400, {"error": str(e)}
            self.send_json(status, resp)
            return

        elif path == "/api/anilist/review/rate":
            body = self.read_json_body()
            review_id = body.get("reviewId")
            if not review_id:
                self.send_json(400, {"error": "reviewId is required"})
                return
            try:
                status, resp = _handle_graphql_mutation(
                    "rate_review", review_id=int(review_id), rating=body.get("rating", "UPVOTE"),
                )
            except (ValueError, TypeError) as e:
                status, resp = 400, {"error": str(e)}
            self.send_json(status, resp)
            return

        elif path == "/api/anilist/recommendation":
            body = self.read_json_body()
            media_id = body.get("mediaId")
            media_recommendation_id = body.get("mediaRecommendationId")
            if not media_id or not media_recommendation_id:
                self.send_json(400, {"error": "mediaId and mediaRecommendationId are required"})
                return
            try:
                status, resp = _handle_graphql_mutation(
                    "save_recommendation",
                    media_id=int(media_id), media_recommendation_id=int(media_recommendation_id),
                    rating=body.get("rating"),
                )
            except (ValueError, TypeError) as e:
                status, resp = 400, {"error": str(e)}
            self.send_json(status, resp)
            return

        elif path == "/api/anilist/user":
            body = self.read_json_body()
            try:
                status, resp = _handle_graphql_mutation("update_user", **body)
            except Exception:
                status, resp = 500, {"error": "AniList user update failed"}
            self.send_json(status, resp)
            return

        elif path == "/api/test/qbittorrent":
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

        elif re.match(r'^/api/downloads/([0-9a-fA-F]{40})/retry$', path):
            # Retry/resume a stopped, paused, or errored torrent from the queue.
            torrent_hash = re.match(r'^/api/downloads/([0-9a-fA-F]{40})/retry$', path).group(1)
            if qbit.resume_torrent(torrent_hash):
                self.send_json(200, {"ok": True, "message": "Torrent resumed."})
            else:
                self.send_json(500, {"ok": False, "error": "Failed to resume torrent."})
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
                "score": round(c["score"], 3) if c["score"] is not None else None,
                "details": c.get("details")
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

        elif path == "/api/ignored":
            body = self.read_json_body()
            title = body.get("title", "").strip()
            media_id = body.get("mediaId")
            if not title and media_id is None:
                self.send_json(400, {"error": "Title or mediaId required"})
                return
            entry = ignored_manager.add_entry(title, media_id)
            self.send_json(200, {"ok": True, "entry": entry})
            return

        elif re.match(r'^/api/history/([a-zA-Z0-9-]+)/(rerun|ignore-redownload)$', path):
            m = re.match(r'^/api/history/([a-zA-Z0-9-]+)/(rerun|ignore-redownload)$', path)
            entry_id, action = m.group(1), m.group(2)
            status_code, resp = handle_history_delete_action(entry_id, action)
            self.send_json(status_code, resp)
            return
            
        elif path == "/api/anilist/auth/callback":
            self.handle_auth_callback()
            return

        elif path == "/api/anilist/auth/clear":
            anilist_auth.clear_token()
            self.send_json(200, {"ok": True, "authenticated": False})
            return

        else:
            self.send_json(404, {"error": "Not found"})

    # ------------------------------------------------------------------
    # AniList OAuth2 auth route handlers
    # ------------------------------------------------------------------

    def handle_auth_url(self):
        """GET /api/anilist/auth/url — generate an authorization URL.

        Query params:
          - ``grant``: ``"code"`` (Authorization Code, default) or ``"token"`` (Implicit)
          - ``redirect_uri``: optional override
        """
        params = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
        grant = params.get("grant", ["code"])[0].lower()
        redirect_override = params.get("redirect_uri", [None])[0]

        if grant not in ("code", "token"):
            self.send_json(400, {"error": "grant must be 'code' or 'token'"})
            return

        try:
            url = anilist_auth.build_authorization_url(
                response_type=grant,
                redirect_uri=redirect_override,
            )
        except ValueError as e:
            self.send_json(500, {"error": str(e)})
            return

        self.send_json(200, {"authUrl": url, "grantType": grant})

    def handle_auth_pin(self):
        """GET /api/anilist/auth/pin — generate a PIN-flow authorization URL."""
        try:
            url = anilist_auth.build_pin_url()
        except ValueError as e:
            self.send_json(500, {"error": str(e)})
            return

        self.send_json(200, {"authUrl": url, "grantType": "code", "pinRedirect": True})

    def handle_auth_callback(self):
        """POST /api/anilist/auth/callback — exchange an auth code for a token.

        Body:
          - ``code``: the authorization code from the OAuth2 redirect
          - ``redirect_uri``: optional override (must match the one used in the auth URL)
        """
        body = self.read_json_body()
        code = body.get("code", "").strip()
        redirect_override = body.get("redirect_uri")

        if not code:
            self.send_json(400, {"ok": False, "error": "Authorization code is required"})
            return

        token, error = anilist_auth.exchange_code_for_token(
            code,
            redirect_uri=redirect_override or None,
        )

        if error:
            # Safe: error message never includes the token
            self.send_json(401, {"ok": False, "error": error})
            return

        if not token:
            self.send_json(401, {"ok": False, "error": "No token returned from AniList"})
            return

        # Persist token + issuance timestamp (1-year expiry tracking)
        anilist_auth.store_token(token)

        self.send_json(200, {
            "ok": True,
            "authenticated": True,
            "userName": anilist_auth.get_user_name() or "",
            "tokenExpiry": anilist_auth.get_expiry_info(),
        })

    def handle_auth_state(self):
        """GET /api/anilist/auth/state — report auth status without exposing the token.

        Returns whether a token is present, whether re-auth is needed, and
        non-sensitive expiry info.  The token value itself is never included.
        """
        self.send_json(200, {
            "authenticated": anilist_auth.is_token_present(),
            "needsReauth": anilist_auth.needs_reauth(),
            "userName": anilist_auth.get_user_name() or "",
            "tokenExpiry": anilist_auth.get_expiry_info(),
        })

    def do_PATCH(self):
        url = urllib.parse.urlparse(self.path)
        path = url.path

        if path == "/api/config":
            body = self.read_json_body()
            current = get_config()
            for k, v in body.items():
                attr = MAP_JSON_TO_ATTR.get(k, k)
                if not hasattr(current, attr):
                    continue
                # Credential fields are masked in the UI (never populated from
                # the API), so their inputs arrive blank on every save. Never
                # let an empty value wipe the stored secret — the field is only
                # updated when the user types a replacement.
                if attr in SENSITIVE_CONFIG_FIELDS and (v is None or v == ""):
                    continue
                setattr(current, attr, v)
            save_config(current)
            reload_config()
            self.send_json(200, {"ok": True, "config": sanitize_config_for_api(get_config_dict(get_config()))})
            
        elif re.match(r'^/api/anime/(\d+)$', path):
            media_id = int(re.match(r'^/api/anime/(\d+)$', path).group(1))
            watching = self.get_anime_list()
            if not any(x.get("mediaId") == media_id or x.get("id") == media_id for x in watching):
                self.send_json(404, {"error": "Anime not in watching list"})
                return

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
                "warning": "Saved locally but PocketBase sync failed. Will retry." if not synced else None})
            
        else:
            self.send_json(404, {"error": "Not found"})

    def do_DELETE(self):
        url = urllib.parse.urlparse(self.path)
        path = url.path

        if re.match(r'^/api/downloads/([0-9a-fA-F]{40})$', path):
            # Remove a torrent from the queue (keeps files on disk unless
            # ?deleteFiles=true is passed explicitly).
            torrent_hash = re.match(r'^/api/downloads/([0-9a-fA-F]{40})$', path).group(1)
            params = urllib.parse.parse_qs(url.query)
            delete_files = params.get("deleteFiles", ["false"])[0].lower() == "true"
            if qbit.delete_torrent_by_hash(torrent_hash, delete_files=delete_files):
                self.send_json(200, {"ok": True, "message": "Torrent removed."})
            else:
                self.send_json(500, {"ok": False, "error": "Failed to remove torrent."})
            return

        if path == "/api/history":
            history_manager.clear_all()
            self.send_json(200, {"ok": True})
        elif re.match(r'^/api/history/([a-zA-Z0-9-]+)$', path):
            entry_id = re.match(r'^/api/history/([a-zA-Z0-9-]+)$', path).group(1)
            params = urllib.parse.parse_qs(url.query)
            action = params.get("action", ["delete"])[0]
            status_code, resp = handle_history_delete_action(entry_id, action)
            self.send_json(status_code, resp)
        elif path.startswith("/api/ignored/"):
            target = path.replace("/api/ignored/", "", 1)
            target = urllib.parse.unquote(target)
            deleted = ignored_manager.delete_entry(target)
            self.send_json(200, {"ok": deleted})

        # ------------------------------------------------------------------
        # Section 4 mutation routes (DELETE) — require auth, fail-closed.
        # ------------------------------------------------------------------
        elif re.match(r'^/api/anilist/list/(\d+)$', path):
            entry_id = int(re.match(r'^/api/anilist/list/(\d+)$', path).group(1))
            status, resp = _handle_graphql_mutation("delete_media_list_entry", entry_id=entry_id)
            self.send_json(status, resp)
            return

        elif path == "/api/anilist/list/custom":
            params = urllib.parse.parse_qs(url.query)
            body = self.read_json_body()
            custom_list = body.get("customList", params.get("customList", [None])[0])
            if not custom_list:
                self.send_json(400, {"error": "customList is required"})
                return
            media_type = body.get("type", params.get("type", ["ANIME"])[0])
            status, resp = _handle_graphql_mutation("delete_custom_list", custom_list=custom_list, media_type=media_type)
            self.send_json(status, resp)
            return
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
        if not filename or filename in ('index.html', 'settings', 'discover') or re.match(r'^(anime|media|discover)(/\d+)?$', filename):
            filename = 'index.html'
            
        full_path = os.path.abspath(os.path.join(public_dir, filename))
        
        # Verify subdirectory traversal prevention
        if not full_path.startswith(os.path.abspath(public_dir)):
            self.send_response(403)
            self.end_headers()
            self._safe_write(b"Forbidden")
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
                # Cache-bust SPA assets: NPM caches .js/.css with a long
                # max-age and strips our Cache-Control, so version the URL.
                if filename == 'index.html':
                    content = content.replace(
                        b'src="/app.js"',
                        ('src="/app.js?v=' + ASSET_VERSION + '"').encode(),
                    )
                self.send_response(200)
                self.send_header("Content-Type", content_type)
                self.send_header("Cache-Control", "public, max-age=0, must-revalidate")
                self.send_header("Content-Length", str(len(content)))
                self.end_headers()
                self._safe_write(content)
                return
            except Exception as e:
                self.send_response(500)
                self.end_headers()
                self._safe_write(str(e).encode('utf-8'))
                return

        self.send_response(404)
        self.end_headers()
        self._safe_write(b"Not found")

def start_server():
    """Starts the http server synchronously."""
    port = 3210
    host = "0.0.0.0"
    
    # Ensure logs folder exists
    root_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
    os.makedirs(os.path.join(root_dir, 'logs'), exist_ok=True)
    
    server = http.server.ThreadingHTTPServer((host, port), AnimuHTTPHandler)
    print(f"Animu Web UI running at http://localhost:{port} (bind {host})")
    # Warm the heavy AniList reads in the background so the cache is already
    # populated when the first user opens the site (see _prewarm_heavy_reads).
    try:
        _prewarm_heavy_reads()
    except Exception:
        pass
    server.serve_forever()


def _prewarm_heavy_reads() -> None:
    """Pre-fetch the heavy AniList reads so the persistent cache is warm
    before a user opens the WebUI.

    ``get_anime_user_list`` (Watching tab, /api/anime) and
    ``get_media_list_collection`` (Lists/Stats/search filter) are the two
    expensive calls — the collection alone takes ~12s cold.  They are cached
    persistently (see ``_cached_persistent``), so fetching them once at boot
    means the first user request is served from cache instantly, and the
    stale-while-revalidate layer refreshes them in the background on entry.
    This runs in a daemon thread: any AniList/PocketBase hiccup at boot must
    never block or crash the server.
    """
    from .config import get_config
    from .anilist import anilist

    cfg = get_config()
    user_name = cfg.ani_user_name

    def _load():
        try:
            if user_name:
                # Mirror the exact kwargs the /api/anilist/user-list handler
                # passes, so the pre-warmed cache slot is the one the web UI
                # actually reads (the persistent cache key includes kwargs).
                anilist.get_media_list_collection(
                    user_name=user_name,
                    media_type="ANIME",
                    status_in=None,
                    per_chunk=500,
                    force_single_completed_list=True,
                    sort=None,
                )
            anilist.get_anime_user_list()
            print("[PREWARM] Heavy AniList reads cached.")
        except Exception as e:
            print(f"[PREWARM] Warm-up failed (will refresh on first request): {e}")

    threading.Thread(target=_load, daemon=True).start()


def health_response() -> tuple[int, dict[str, Any]]:
    """Return liveness/readiness JSON and HTTP semantics for the health endpoint."""
    payload = readiness.health_snapshot()
    return (200 if payload["ready"] else 503), payload

def start():
    """Starts the Web UI server in a background daemon thread."""
    t = threading.Thread(target=start_server, daemon=True)
    t.start()
