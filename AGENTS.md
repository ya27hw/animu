# Animu Python Rewrite — Architecture Reference

> Pure Python 3 rewrite of the animu anime auto-downloader.  
> **Version:** 1.1.0 (rewrite of Node.js v4.3.0)  
> **Branch:** `python-rewrite` on `ya27hw/animu` (default branch; `ani` is the old remote default — merge into `python-rewrite`)  
> **Instance:** CT 102 (`10.0.0.165`) on Proxmox host (`10.0.0.2`)  
> **Process:** `systemd animu.service` (`WorkingDirectory=/root/animu`, `ExecStart=venv/bin/python3 main.py --schedule`)  
> **Database:** PocketBase on CT 120 (`https://pb.atoona.com`, behind NPM @ 10.0.0.113)  
> **Lines:** ~4,524 Python (14 modules) + 2,840 frontend HTML/JS  
> **Production deploy:** git fast-forward of `python-rewrite` into `/root/animu` on CT 102 + `systemctl restart animu.service` **inside the container** (never from the Proxmox host — see Pitfall G in the animu skill)

---

## Why the Rewrite

The Node.js v4.3.0 app suffered from:
- **Firebase Auth dead** — `auth/user-not-found`, fallback to stale `offline-cache.json`
- **qBittorrent TLS 500** — self-signed cert rejected by Axios, needed `rejectUnauthorized: false` hacks
- **PM2 version mismatch** — daemon v7.0.1 vs CLI v6.0.11, log flushing broken
- **326MB disk** — 41MB alone for Firebase SDK
- **tsc build step** — every fix needed TypeScript compilation

The Python rewrite drops all of this: `verify=False` fixes TLS trivially, PocketBase replaces Firebase, systemd replaces PM2, no compilation step. The old TypeScript tree (`/home/hermes/animu`, `src/`) is **legacy** — do not raise TS-era bugs as new work.

---

## Module Map

```
main.py (99 lines) — CLI entrypoint, argparsing, dispatcher
│
├── animu/config.py (167 lines)
│   ProfileConfig dataclass, profile.json loader, save_config(), reload_config()
│   Key: snake_case Python attrs ←→ camelCase JSON keys via MAP_JSON_TO_ATTR
│
├── animu/models.py (40 lines)
│   OfflineAnime dataclass: episodes, timeouts, alternative_title, etc.
│
├── animu/database.py (309 lines)
│   Database class — PocketBase REST client
│   • Auth via admin@atoona.com superuser, token refresh on 401
│   • Local JSON cache mirror (logs/offline_db.json) — PocketBase offline fallback
│   • CRUD: get(media_id), upsert(media_id, data), delete(media_id), get_all()
│   • get_all() MERGES PB response with local cache (local unsynced/richer wins — re-download-loop fix)
│   • sync_local_changes() — pushes unsynced local → PocketBase on startup
│
├── animu/anilist.py (492 lines)
│   AnilistClient — GraphQL queries to https://graphql.anilist.co
│   • httpx.Client(verify=False) — no TLS pain
│   • get_watching_list() → returns current WATCHING anime
│   • _query() with retry (3 attempts, exponential backoff: 2s/4s/8s)
│   • Auth fallback: drops bearer token on 400/401, retries anonymously
│   • set_rewatching(media_id) → REPEATING status mutation
│   • ★ DISCOVER (2026-08-07): get_discover_anime() (trending/popular/upcoming/seasonal),
│     search_anime(), get_media_detail(), save_list_entry() mutation (write-safe — mutations
│     must NOT drop auth on 401 like read fallbacks do)
│
├── animu/nyaa.py (501 lines)
│   NyaaClient — RSS fetcher + torrent ranking
│   • fetch_rss_feed() — httpx + feedparser, 2 retries on 504/connection errors
│   • get_torrents() — searches episode-by-episode or batch
│   • search_episode_candidates() / search_title_candidates() / search_raw_title_candidates() — ranked for web UI + history re-download
│   • get_episode_air_dates() — paginates AniList airing schedule
│   • get_best_torrent() — verifyQuery scoring + seeders ranking
│   • should_use_proxy_download() — Gluetun proxy routing for Nyaa (blocked in Oman)
│   Singleton: `nyaa = NyaaClient()` at module bottom
│
├── animu/qbittorrent.py (402 lines)
│   QbitClient — qBittorrent Web API (https://qb.atoona.com)
│   • httpx.Client(verify=False) — THE KEY FIX for self-signed TLS
│   • _authenticate() → SID cookie via httpx session (auto-managed)
│   • add_torrent() → /api/v2/torrents/add (URL or file upload)
│   • add_check_torrent() → 2 retry wrapper, trusts 200 Ok on check failure
│   • check_torrent() → /api/v2/torrents/info, matches by name
│   • delete_torrent() → hash lookup + /api/v2/torrents/delete
│   • get_active_downloads() → /api/v2/torrents/info for WebUI Downloads panel
│   Singleton: `qbit = QbitClient()` at module bottom
│
├── animu/scheduler.py (526 lines)
│   Scheduler — core automation loop
│   • run_loop() — peak/off-peak minute-checking loop (2min/15min intervals)
│   • check() → fetch watching list → skip ignored (ignored_manager) → handle_anime() per anime
│   • handle_anime() — episode range calc, alt-title fallback, synonym search
│   • download_torrents() → qbit.add_check_torrent + DB.upsert + Discord webhook
│   • set_timeout / reset_timeout — exponential backoff (cap at 10)
│   • sync_anime_rewatching_status — marks FINISHED anime as REPEATING
│   • Per-cycle log: [SYNC_STATE] <title> (ID <n>) downloaded_episodes=<k>, timeouts=<t>
│   Singleton: `scheduler = Scheduler()` at module bottom
│
├── animu/ignored.py (123 lines) ★ NEW (2026-08-07)
│   IgnoredManager — persistent ignore list for auto-downloader
│   • Local JSON store (logs/ignored.json): {id, title, media_id, added_at}
│   • is_ignored(title, media_id, english_title, synonyms) — case-insensitive title/media match
│   • add_entry() / delete_entry() / get_all()
│   • Scheduler logs `[IGNORED] <title> skipped` and never auto-downloads ignored anime
│   Singleton: `ignored_manager = IgnoredManager()` at module bottom
│
├── animu/discord.py (140 lines)
│   alert_user() — fail notification embed to Discord webhook
│   send_anime_downloaded_hook() — download success embed
│   Pure HTTP POST to Discord webhook URL — no SDK
│
├── animu/history.py (169 lines)
│   HistoryManager — download history persistence & REST helper
│   • Local JSON cache mirror (logs/history.json)
│   • Auto-seed past downloads from animu.log if empty
│   • CRUD: add_entry(), get_all() (newest-first), delete_entry(), clear_all()
│   Singleton: `history_manager = HistoryManager()` at module bottom
│
├── animu/web.py (913 lines)
│   AnimuHTTPHandler — http.server REST API + static file server
│   • GET /api/anime — returns watching list with PocketBase state
│   • GET /api/history, DELETE /api/history, DELETE /api/history/<id>?action=delete|rerun|ignore-redownload
│     - rerun: deletes entry + resets downloaded_episodes=[] → next cron re-downloads
│     - ignore-redownload: deletes + adds to ignored.json + triggers immediate Nyaa search & download
│   • GET/POST/DELETE /api/ignored — ignore list management (UI in Settings panel)
│   • GET /api/anilist/discover?type=trending|popular|upcoming|seasonal&page=N — Discover feed
│   • GET /api/anilist/search?q=... — AniList catalog search
│   • GET /api/anilist/media/<id> — media detail (synopsis, genres, relations, airing)
│   • GET /api/anilist/list?status=... / POST /api/anilist/list — full user list + SaveMediaListEntry
│   • POST /api/anime/<id>/reset — clears downloaded_episodes (reused by history rerun)
│   • POST /api/anime/<id>/nyaa-search|nyaa-download|rewatching — manual controls
│   • GET /api/downloads, /api/logs, /api/config, /api/search-debug, /api/health, /api/test/*
│   • Static: serves webui/ from disk; ★ CACHE-BUSTING: index.html's app.js URL gets
│     `?v=<git-SHA>` injected at serve time (ASSET_VERSION) — NPM's assets.conf caches
│     .js/.css with a long max-age and strips backend Cache-Control, so without versioning
│     browsers keep stale JS after deploys (see Known Pitfalls #7)
│
├── animu/utils.py (411 lines)
│   fix_anime_season() — S2/Season II/7th Season detection
│   count_past_relations() — prequel chain walker
│   verify_query() — 4-factor torrent scoring (title, episode, resolution, air date)
│   find_best_match() — rapidfuzz string similarity
│
├── animu/logger.py (94 lines)
│   Python logging with RotatingFileHandler (5MB, 3 backups)
│
├── animu/readiness.py (137 lines)
│   Health/readiness state for /api/health (heartbeat ages, scheduler cycle tracking)
│
└── webui/ (2,840 lines)
    index.html (711 lines) — Tailwind v4 browser-engine SPA, tabs: Watching / Discover / History / Logs / Settings
    app.js (2,129 lines) — Vanilla JS: anime grid, Discover feed+search+detail, history with
    delete/re-run/ignore-redownload actions, ignored management, settings, dark theme toggle
    (class-based: @custom-variant dark in the tailwindcss style block), inline SVG favicon
```

---

## Data Flow — One Scheduler Cycle

```
1. AnilistClient.get_watching_list()
   → POST https://graphql.anilist.co (bearer token from profile.json)
   → Returns list of {mediaId, progress, media: {title, episodes, status, ...}}

2. For each anime:
   a. Skip if ignored_manager.is_ignored(title, mediaId, ...) → log [IGNORED]
   b. Database.get(mediaId) → PocketBase REST (or local cache fallback)
   c. Calculate episode window: [progress+1, nextAiringEpisode-1]
   d. NyaaClient.get_torrents() → RSS search per episode
      • Try primary title → verifyQuery scoring
      • If fail: try synonym/english/short-name combinations
   e. QbitClient.add_check_torrent() → POST /api/v2/torrents/add
      • If profile.json useProxy || triggerGenre match → download .torrent + upload
      • Else → direct URL add
      • 2 retries, trusts 200 Ok
   f. Database.upsert(mediaId, OfflineAnime(downloaded_episodes=...))
   g. Discord.send_anime_downloaded_hook() → webhook embed

3. Backoff: set_timeout() increments timeouts counter, skip N future cycles
   • Cap at 10, resets on successful download
```

---

## Database — PocketBase (Self-Hosted)

| Field | Value |
|---|---|
| Container | CT 120 (Debian 12 + Docker), 1 core, 512MB RAM, 4GB disk |
| URL | `https://pb.atoona.com` (NPM proxy id 56, SSL wildcard) |
| Admin | `admin@atoona.com` / `pocketbase2024` |
| Collection | `anime` (ID: `pbc_3628263337`) |
| Schema | `media_id` (number, PK, unique), `downloaded_episodes` (json), `starting_episode` (number), `alternative_title` (text), `timeouts` (number), `max_timeouts` (number), `pending_rewatching_update` (bool) |
| Python auth | `POST /api/collections/pbc_3142635823/auth-with-password` → token in `Authorization` header |

**Resilience:** Database.py maintains a local JSON mirror (`logs/offline_db.json`). If PocketBase is unreachable, reads fall back to cache. Writes mark records `_unsynced` and push on next successful connection. `get_all()` **merges** (local unsynced wins) — do not revert to wholesale replacement (re-download loop).

**Backup:** `cp /opt/pocketbase/pb_data/data.db backup.db` (SQLite-backed)

**Admin dashboard:** `https://pb.atoona.com/_/`

---

## AniList "Discover" Section (added 2026-08-07)

New **Discover tab** in the WebUI (between Watching and History), modeled on AL-chan + MyAniList:
- **Feeds:** Trending / Most Popular / Upcoming / Seasonal rails (chip-switchable, paginated)
- **Search:** debounced AniList catalog search
- **Media detail:** full-screen panel with hero, stats, synopsis, genres, relations, airing schedule
- **List management:** Add to Watching / status / progress / score via `SaveMediaListEntry` mutation
- **The differentiator:** "Add to Watching" → scheduler picks it up next cycle → auto-download from Nyaa

**Design doc:** `~/ObsidianVault/02-Projects/Animu/Animu-AniList-Discover-Design.md`
**Implementation:** cherry-picked from `antigravity/t_animuAniListDiscover-manual-1` (803d8f0) → commit 41df142.
**Auth caveat (fixed):** mutations must use a `require_auth` path — the read fallback that drops the bearer token on 400/401 must never apply to `SaveMediaListEntry`, or "Add to Watching" silently no-ops.

---

## Jellyfin → AniList Sync Plugin (in-repo, C#)

- **Location:** `plugins/jellyfin-ani-sync/` (fork of vosmiic/jellyfin-ani-sync, stripped to AniList-only)
- **Live install:** CT 101 `/var/lib/jellyfin/plugins/Ani-Sync (AniList)_1.0.0.0/`
- **Identity resolution:** Shokofin `ProviderIds["AniDB"]` (uppercase key!) → `https://arm.haglund.dev/api/v2/ids` → AniList ID
- **★ 2026-08-07 root cause found:** with direct-bearer-token auth (`AniListBearerToken` in plugin config, `enableUserPages=false`), the old `_userConfig == null` early-return in `UpdateProviderStatus.cs` silently skipped EVERY watch event. Fix (commit 8729a19): auth gate is now `hasAniListAuth || hasDirectToken`, null-safe `?.UserConfig?.FirstOrDefault(...)` everywhere, `PlanToWatchOnly`/`RewatchCompleted` default false. **Built (0 warnings/0 errors) but NOT yet deployed to CT 101** — deploy = stop jellyfin → push DLL → chown → start.
- **Verification after deploy:** watch one episode in Jellyfin UI → AniList progress bumps; logs show `Resolved AniList ID` + `Updated series progress`.

---

## Key Fixes from Node.js v4.3.0

| Issue | Node.js | Python |
|---|---|---|
| qBittorrent TLS 500 | Axios needs `rejectUnauthorized: false` agent | `httpx.Client(verify=False)` — one flag |
| Firebase auth dead | `auth/user-not-found` → offline cache | PocketBase — self-hosted |
| Firebase SDK bloat | 41MB in node_modules | 0MB — `httpx` REST calls |
| PM2 version mismatch | Daemon v7 vs CLI v6, log flushing broken | systemd `animu.service` |
| Build step | `tsc && tsc-alias` required every edit | No compilation — edit and run |
| check_torrent retry loop | 5 attempts, torrent already added | 2 attempts, trusts 200 Ok |
| Discord webhook | discord-webhook-node npm (2MB) | Pure `httpx.post()` — 10 lines |
| Re-download loop (2026-07-07) | — | `get_all()` merges local cache, doesn't clobber |
| Stale frontend after deploy (2026-08-07) | — | `app.js?v=<git-SHA>` cache-busting in web.py |

---

## Deploy Process (CANONICAL — 2026-08-07)

**The live service is a git checkout on CT 102.** Deploy = fast-forward `python-rewrite` + restart **inside the container**:

```bash
# 1. From the Hermes workspace: merge/push to python-rewrite first
cd /home/hermes/animu-python && git push origin python-rewrite

# 2. On CT 102: fetch + fast-forward + restart (INSIDE the container!)
ssh root@10.0.0.2 "pct exec 102 -- bash -c 'cd /root/animu && \
  git fetch origin python-rewrite --quiet && \
  git merge --ff-only origin/python-rewrite && \
  systemctl restart animu.service && sleep 6 && systemctl is-active animu.service'"

# 3. Verify
ssh root@10.0.0.2 "pct exec 102 -- curl -s http://127.0.0.1:3210/api/health"
# Check the served index.html carries the NEW app.js?v=<new-sha>:
ssh root@10.0.0.2 "pct exec 102 -- curl -s http://127.0.0.1:3210/ | grep -o 'app.js?v=[a-f0-9]*'"
```

**⚠️ NEVER `systemctl restart animu.service` from the Proxmox host** — a duplicate `animu.service` exists on the host itself (203/EXEC loop, disabled 2026-08-07) and a host-side restart spawns a second scheduler against the same `offline_db.json` + qBittorrent → re-download bug. Always `pct exec 102 -- systemctl restart animu.service`.

**Rollback:** `git reset --hard <previous-sha>` on CT 102 + restart (state lives in `logs/offline_db.json` + `logs/history.json`, which are untracked).

**Legacy tar deploy** (`deploy.sh`, tar-to-/root/animu): still present but superseded; the git path is authoritative.

**Monitor:** `ssh root@10.0.0.2 "pct exec 102 -- journalctl -u animu.service -f"` — logs also at `/root/animu/logs/animu.log` (RotatingFileHandler 5MB × 3).

---

## Known Pitfalls

1. **Python 3.12 scoping bug:** Using `time.sleep()` inside a method that has any local variable named `time` will throw `cannot access local variable 'time'`. Fix: add `import time` at the top of the method body.

2. **Nyaa.si 504:** Oman ISP blocks Nyaa via ddos-guard CDN. The retry logic handles most cases, but setting `useProxy: true` in profile.json routes through Gluetun (10.0.0.90:8888) for better reliability.

3. **check_torrent race:** qBittorrent needs a few seconds for metadata download after adding a torrent. `add_check_torrent` trusts the 200 Ok response (instead of retrying 5 times). If a torrent truly failed, the scheduler picks up the missing episode on the next cycle.

4. **Duplicate class definitions:** The original `nyaa.py` had two `class NyaaClient` definitions. The second (empty) one overwrote the singleton. Deleting the second class fixes `fetch_rss_feed` not found errors.

5. **profile.json camelCase:** Python uses `snake_case` internally (e.g., `qbit_url`, `ani_user_name`) but profile.json uses `camelCase`. `MAP_JSON_TO_ATTR` in `config.py` handles the translation.

6. **`verify=False` is load-bearing:** Every `httpx.Client()` in anilist.py, nyaa.py, qbittorrent.py, and database.py must use `verify=False`. Without it, self-signed certs (qb.atoona.com, pb.atoona.com via NPM) will fail.

7. **★ NPM asset cache causes stale frontend after deploys (2026-08-07):** NPM's global `/etc/nginx/conf.d/include/assets.conf` caches `.js/.css` (proxy_cache, `expires` long max-age ≈ 18h) and **strips the backend's Cache-Control** (`proxy_ignore_headers` + `proxy_hide_header`). Result: after deploying new app.js, browsers keep the old JS for ~18h → symptoms like "Discover tab exists but does nothing". **Fix already in place:** web.py injects `app.js?v=<git-SHA>` into index.html (ASSET_VERSION) — every deploy changes the URL so both NPM proxy cache and browser cache refresh. If you ever remove that, reintroduce stale-cache bugs. For users still stuck after a deploy: hard refresh (Ctrl+Shift+R).

8. **Tests gotcha:** `.gitignore` line 138 (`test*`) ignores test files — `tests/test_nyaa_episode_offsets.py` is an untracked leftover that FAILS 2 assertions against current code. It is not part of the repo; pytest shows "2 failed" because of it. Don't chase those failures; the tracked suite passes.

---

## Infrastructure Reference

| Service | Location | URL |
|---|---|---|
| Animu app | CT 102, 10.0.0.165:3210 | https://animu.atoona.com |
| PocketBase | CT 120, 10.0.0.106:8090 | https://pb.atoona.com |
| qBittorrent | CT 100, Docker, via qb.atoona.com | https://qb.atoona.com |
| Gluetun proxy | CT 100, 10.0.0.90:8888 | (SOCKS/HTTP proxy for Nyaa) |
| Jellyfin (plugin host) | CT 101, 10.0.0.229:8096 | http://10.0.0.229:8096 |
| AniList API | Cloud | https://graphql.anilist.co |
| Nyaa.si | Cloud | https://nyaa.si (blocked in Oman without proxy) |
