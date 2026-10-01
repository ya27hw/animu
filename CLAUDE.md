# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

`AGENTS.md` is the long-form architecture/ops reference (module map, scheduler data flow, deployment, known pitfalls) — read it before non-trivial changes. It contains infrastructure details and credentials that should not be copied elsewhere. This file is the short version.

## What this is

Animu is a Python 3 anime auto-downloader. It reads a user's AniList WATCHING list, works out which aired episodes are missing, finds them on Nyaa (RSS), sends them to qBittorrent, and records state in PocketBase (with a local JSON fallback). A vanilla-JS web UI is served by the same process. `main` is the Python rewrite; the old Node/TypeScript (Firebase/PM2) tree has been removed — don't file TS-era bugs. `plugins/jellyfin-ani-sync/` is a separate C# Jellyfin plugin (AniList progress sync).

## Commands

- `pip install -r requirements.txt` (httpx, colorama, anitopy)
- `python3 main.py --schedule` — production mode: initialises the DB, starts the web server, runs the scheduler loop
- `python3 main.py --once` — one scheduler cycle then exit; `--web` — web UI only; no flag shows a menu (`main.py 1|2|3` picks an entry directly)
- Web server port: `ANIMU_PORT` env var, default 3210. Health check: `GET /api/health`.
- Tests: `PYTHONPATH=. pytest -q`; single test: `PYTHONPATH=. pytest tests/test_web_api.py::TestWebAPI::test_search_debug_endpoint_returns_persistent_traces`. `tests/test_mobile_navigation.py` drives the real UI with Playwright (uses installed Chrome or Chromium; skipped if neither can launch). There is no linter; `python3 -m compileall animu tests` is the compile check.
- The UI is a Vite + Svelte 5 app: edit `webui-src/`, then `cd webui-src && npm install && npm run build` (writes the content-hashed bundle to `webui/`, which **is committed** so production needs no Node). `npm run dev:mock` runs it against fixtures. Python needs no build.

## Configuration and state

- `profile.json` at the repo root (git-ignored) is the config. JSON keys are camelCase; `animu/config.py` maps them to snake_case dataclass attributes via `MAP_JSON_TO_ATTR`, so adding a setting means updating that map (and `MAP_ATTR_TO_JSON` is derived from it).
- Runtime state lives untracked under `logs/`: `offline_db.json` (local mirror of PocketBase), `history.json`, `ignored.json`, `release_prefs.json`, plus rotating `animu.log`. Production deploys and rollbacks never touch these.
- `.gitignore` contains `test*`, which is why `tests/` files can appear untracked — `git add -f` new test files.

## Architecture

Everything in `animu/` is a module-level singleton (`scheduler`, `nyaa`, `qbit`, `db`, `ignored_manager`, `history_manager`, …) created at import time. `main.py` wires them: `run_schedule` → `initialize_runtime()` (PocketBase auth, or record the offline fallback in `readiness`) → `web.start()` → `scheduler.run_loop()`.

One scheduler cycle (`animu/scheduler.py`): `anilist.get_anime_user_list(force_refresh=True)` → skip anything in `ignored_manager` → per anime, read its record from `db.get_all()` → compute the missing-episode window (`progress+1` … `nextAiringEpisode-1`, plus `starting_episode` offset for sequels that continue numbering) → `nyaa.get_torrents()` (RSS search, scoring and ranking via `utils.verify_query` / `release_groups` / `release_tracks`) → `qbit.add_check_torrent()` → upsert the record, add history, send the Discord hook. A genuine miss sets a per-anime `next_attempt_at` (exponential back-off, 8 h cap, failure count capped at 10); a freshly aired episode is retried every ~10 min without escalating; Nyaa/AniList/qBittorrent outages raise `SearchUnavailable`/`ServiceDown` and never count as misses. The loop (`run_loop`) wakes on a monotonic schedule, earlier when a retry or an air time is due; `POST /api/scheduler/run` triggers a cycle through the same lock. Writers use `db.upsert(..., fields=...)` / `db.update(...)` so the scheduler never overwrites a concurrent web edit.

Non-obvious cross-file behaviour:
- **Persistence is dual**: `database.py` talks to PocketBase but mirrors to `logs/offline_db.json`; unsynced local writes are pushed on the next successful connection, and `get_all()` *merges* rather than replaces (replacing causes a re-download loop).
- **Release preferences** are layered: global profile flags, per-anime overrides in `prefs.py`, and audio/subtitle classification in `release_tracks.py` feeding the group scoring in `release_groups.py`. All of it affects Nyaa ranking.
- **`airschedule.py`** caches `nextAiringEpisode` data and extrapolates air times when AniList is unreachable.
- **AniList auth** (`anilist_auth.py`) owns OAuth/PIN token handling and the shared `execute_graphql`; reads may fall back to anonymous on 400/401, but mutations (`anilist_mutations.py`) must never drop auth, or "Add to Watching" silently no-ops. The browser never holds the bearer token — the web UI calls backend routes.
- **`verify=False` on every `httpx.Client`** (anilist, nyaa, qbittorrent, database) is deliberate: the qBittorrent and PocketBase hosts use self-signed certs.
- **Proxy**: `useProxy`/`triggerGenre` route Nyaa and `.torrent` downloads through a proxy; with a proxy the `.torrent` is downloaded and uploaded to qBittorrent instead of passing the URL.
- **Web server** (`animu/web.py`) is a hand-rolled `http.server` handler (`do_GET`/`do_POST`/`do_PATCH`/`do_DELETE` dispatch on path) serving both `/api/*` and `webui/`. Static files are cached by mtime with ETag/304 and gzip; `/assets/*` is content-hashed and `immutable` (this is what defeats the production reverse proxy's aggressive JS caching), `index.html` is `no-cache`, and unknown extensionless paths fall back to `index.html` for client-side routes.
- **Frontend**: source is `webui-src/` (Vite + Svelte 5); `webui/` is generated and committed — never hand-edit it. The browser only talks to backend routes (never AniList directly). See `AGENTS.md` for the decision record.

## Deployment

Production is a git checkout on a container, updated by `scripts/animu-update.sh` (systemd timer, fast-forward only with health-check rollback; see `DEPLOYMENT.md`). That script tracks `main` by default (`ANIMU_BRANCH`). Never restart `animu.service` from the Proxmox host — only inside the container (see `AGENTS.md`).
