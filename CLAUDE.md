# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

`AGENTS.md` is the long-form architecture/ops reference (module map, scheduler data flow, deployment, known pitfalls) — read it before non-trivial changes. It contains infrastructure details and credentials that should not be copied elsewhere. This file is the short version.

## What this is

Animu is a Python 3 anime auto-downloader. It reads a user's AniList WATCHING list, works out which aired episodes are missing, finds them on Nyaa (RSS), sends them to qBittorrent, and records state in PocketBase (with a local JSON fallback). A vanilla-JS web UI is served by the same process. `main` is the Python rewrite; the old Node/TypeScript tree in `src/`, `package.json`, `tsconfig.json`, `ecosystem.config.json`, `yarn.lock` is **legacy** (Firebase/PM2 era) — don't extend it or file TS-era bugs. `plugins/jellyfin-ani-sync/` is a separate C# Jellyfin plugin (AniList progress sync).

## Commands

- `pip install -r requirements.txt` (httpx, feedparser, rapidfuzz, schedule, colorama, anitopy)
- `python3 main.py --schedule` — production mode: initialises the DB, starts the web server, runs the scheduler loop
- `python3 main.py --once` — one scheduler cycle then exit; `--web` — web UI only; no flag shows a menu (`main.py 1|2|3` picks an entry directly)
- Web server port: `ANIMU_PORT` env var, default 3210. Health check: `GET /api/health`.
- Tests: `PYTHONPATH=. pytest -q`; single test: `PYTHONPATH=. pytest tests/test_web_api.py::TestWebAPI::test_search_debug_endpoint_returns_persistent_traces`. `tests/frontend_queue_test.mjs` is a separate puppeteer-based script (`node tests/frontend_queue_test.mjs`, needs `puppeteer-core` on `NODE_PATH`). There is no linter; `python3 -m compileall animu tests` is the compile check used in `QA_REPORT.md`.
- Nothing needs compiling — the web UI loads Tailwind in-browser and `app.js` directly.

## Configuration and state

- `profile.json` at the repo root (git-ignored) is the config. JSON keys are camelCase; `animu/config.py` maps them to snake_case dataclass attributes via `MAP_JSON_TO_ATTR`, so adding a setting means updating that map (and `MAP_ATTR_TO_JSON` is derived from it).
- Runtime state lives untracked under `logs/`: `offline_db.json` (local mirror of PocketBase), `history.json`, `ignored.json`, `release_prefs.json`, plus rotating `animu.log`. Production deploys and rollbacks never touch these.
- `.gitignore` contains `test*`, which is why `tests/` files can appear untracked — `git add -f` new test files.

## Architecture

Everything in `animu/` is a module-level singleton (`scheduler`, `nyaa`, `qbit`, `db`, `ignored_manager`, `history_manager`, …) created at import time. `main.py` wires them: `run_schedule` → `initialize_runtime()` (PocketBase auth, or record the offline fallback in `readiness`) → `web.start()` → `scheduler.run_loop()`.

One scheduler cycle (`animu/scheduler.py`): `anilist.get_watching_list()` → skip anything in `ignored_manager` → per anime, load its record from `database.py` → compute the missing-episode window (`progress+1` … `nextAiringEpisode-1`, plus `starting_episode` offset for sequels that continue numbering) → `nyaa.get_torrents()` (RSS search, scoring and ranking via `utils.verify_query` / `release_groups` / `release_tracks`) → `qbit.add_check_torrent()` → upsert the record, add history, send the Discord hook. Failures increment a per-anime `timeouts` counter (exponential back-off, capped at 10) that makes later cycles skip it.

Non-obvious cross-file behaviour:
- **Persistence is dual**: `database.py` talks to PocketBase but mirrors to `logs/offline_db.json`; unsynced local writes are pushed on the next successful connection, and `get_all()` *merges* rather than replaces (replacing causes a re-download loop).
- **Release preferences** are layered: global profile flags, per-anime overrides in `prefs.py`, and audio/subtitle classification in `release_tracks.py` feeding the group scoring in `release_groups.py`. All of it affects Nyaa ranking.
- **`airschedule.py`** caches `nextAiringEpisode` data and extrapolates air times when AniList is unreachable.
- **AniList auth** (`anilist_auth.py`) owns OAuth/PIN token handling and the shared `execute_graphql`; reads may fall back to anonymous on 400/401, but mutations (`anilist_mutations.py`) must never drop auth, or "Add to Watching" silently no-ops. The browser never holds the bearer token — the web UI calls backend routes.
- **`verify=False` on every `httpx.Client`** (anilist, nyaa, qbittorrent, database) is deliberate: the qBittorrent and PocketBase hosts use self-signed certs.
- **Proxy**: `useProxy`/`triggerGenre` route Nyaa and `.torrent` downloads through a proxy; with a proxy the `.torrent` is downloaded and uploaded to qBittorrent instead of passing the URL.
- **Web server** (`animu/web.py`) is a hand-rolled `http.server` handler (`do_GET`/`do_POST`/`do_PATCH`/`do_DELETE` dispatch on path) serving both `/api/*` and `webui/`. It injects `?v=<git SHA>` into the `app.js` URL in `index.html`; keep that — the production reverse proxy caches JS aggressively.
- **Frontend**: `webui/app.js` is the single source of truth and `index.html` loads only it. The modules in `webui/js/features-unused/` are archived dead code; do not re-add `<script src="/js/...">` tags or `window.Animu` hooks (rationale in `AGENTS.md`).

## Deployment

Production is a git checkout on a container, updated by `scripts/animu-update.sh` (systemd timer, fast-forward only with health-check rollback; see `DEPLOYMENT.md`). That script tracks `main` by default (`ANIMU_BRANCH`). Never restart `animu.service` from the Proxmox host — only inside the container (see `AGENTS.md`).
