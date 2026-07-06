# Animu Python Rewrite — Architecture Reference

> Pure Python 3 rewrite of the animu anime auto-downloader.  
> **Version:** 1.0.0 (rewrite of Node.js v4.3.0)  
> **Branch:** `python-rewrite` on `ya27hw/animu`  
> **Instance:** CT 102 (`10.0.0.165`) on Proxmox host (`10.0.0.2`)  
> **Process:** `systemd animu.service`  
> **Database:** PocketBase on CT 120 (`10.0.0.106:8090`, `https://pb.atoona.com`)  
> **Lines:** ~2,991 Python (12 modules) + 1,462 frontend HTML/JS

---

## Why the Rewrite

The Node.js v4.3.0 app suffered from:
- **Firebase Auth dead** — `auth/user-not-found`, fallback to stale `offline-cache.json`
- **qBittorrent TLS 500** — self-signed cert rejected by Axios, needed `rejectUnauthorized: false` hacks
- **PM2 version mismatch** — daemon v7.0.1 vs CLI v6.0.11, log flushing broken
- **326MB disk** — 41MB alone for Firebase SDK
- **tsc build step** — every fix needed TypeScript compilation

The Python rewrite drops all of this: `verify=False` fixes TLS trivially, PocketBase replaces Firebase, systemd replaces PM2, no compilation step.

---

## Module Map

```
main.py (84 lines) — CLI entrypoint, argparsing, dispatcher
│
├── animu/config.py (165 lines)
│   ProfileConfig dataclass, profile.json loader, save_config(), reload_config()
│   Key: snake_case Python attrs ←→ camelCase JSON keys via MAP_JSON_TO_ATTR
│
├── animu/models.py (40 lines)
│   OfflineAnime dataclass: episodes, timeouts, alternative_title, etc.
│
├── animu/database.py (277 lines)
│   Database class — PocketBase REST client
│   • Auth via admin@atoona.com superuser, token refresh on 401
│   • Local JSON cache mirror (logs/offline_db.json) — PocketBase offline fallback
│   • CRUD: get(media_id), upsert(media_id, data), delete(media_id), get_all()
│   • sync_local_changes() — pushes unsynced local → PocketBase on startup
│
├── animu/anilist.py (238 lines)
│   AnilistClient — GraphQL queries to https://graphql.anilist.co
│   • httpx.Client(verify=False) — no TLS pain
│   • get_watching_list() → returns current WATCHING anime
│   • _query() with retry (3 attempts, exponential backoff: 2s/4s/8s)
│   • Auth fallback: drops bearer token on 400/401, retries anonymously
│   • set_rewatching(media_id) → REPEATING status mutation
│
├── animu/nyaa.py (409 lines)
│   NyaaClient — RSS fetcher + torrent ranking
│   • fetch_rss_feed() — httpx + feedparser, 2 retries on 504/connection errors
│   • get_torrents() — searches episode-by-episode or batch
│   • search_episode_candidates() — ranked list for web UI
│   • get_episode_air_dates() — paginates AniList airing schedule
│   • get_best_torrent() — verifyQuery scoring + seeders ranking
│   Singleton: `nyaa = NyaaClient()` at module bottom
│
├── animu/qbittorrent.py (275 lines)
│   QbitClient — qBittorrent Web API (https://qb.atoona.com)
│   • httpx.Client(verify=False) — THE KEY FIX for self-signed TLS
│   • _authenticate() → SID cookie via httpx session (auto-managed)
│   • add_torrent() → /api/v2/torrents/add (URL or file upload)
│   • add_check_torrent() → 2 retry wrapper, trusts 200 Ok on check failure
│   • check_torrent() → /api/v2/torrents/info, matches by name
│   • delete_torrent() → hash lookup + /api/v2/torrents/delete
│   Singleton: `qbit = QbitClient()` at module bottom
│
├── animu/scheduler.py (382 lines)
│   Scheduler — core automation loop
│   • run_loop() — peak/off-peak minute-checking loop (2min/15min intervals)
│   • check() → fetch watching list → handle_anime() per anime
│   • handle_anime() — episode range calc, alt-title fallback, synonym search
│   • download_torrents() → qbit.add_check_torrent + DB.upsert + Discord webhook
│   • set_timeout / reset_timeout — exponential backoff (cap at 10)
│   • sync_anime_rewatching_status — marks FINISHED anime as REPEATING
│   Singleton: `scheduler = Scheduler()` at module bottom
│
├── animu/discord.py (74 lines)
│   alert_user() — fail notification embed to Discord webhook
│   send_anime_downloaded_hook() — download success embed
│   Pure HTTP POST to Discord webhook URL — no SDK
│
├── animu/web.py (505 lines)
│   AnimuHTTPHandler — http.server REST API + static file server
│   • GET /api/anime — returns watching list with PocketBase state
│   • GET /api/logs — tail of animu.log with combined/out/error filters
│   • POST /api/nyaa-search — episode candidates for download dialog
│   • POST /api/nyaa-download — force-download a specific torrent
│   • POST /api/config — update profile.json through web UI
│   • PATCH /api/anime/:id — alternative title, starting episode, reset
│   • Static: serves webui/index.html + webui/app.js from disk
│
├── animu/utils.py (391 lines)
│   fix_anime_season() — S2/Season II/7th Season detection
│   count_past_relations() — prequel chain walker
│   verify_query() — 4-factor torrent scoring (title, episode, resolution, air date)
│   find_best_match() — rapidfuzz string similarity
│
├── animu/logger.py (94 lines)
│   Python logging with RotatingFileHandler (5MB, 3 backups)
│
└── webui/ (1,462 lines)
    index.html (542 lines) — Tailwind v4 dark-themed SPA, hamburger menu on mobile
    app.js (952 lines) — Vanilla JS: anime grid, search, details modal, settings
```

---

## Data Flow — One Scheduler Cycle

```
1. AnilistClient.get_watching_list()
   → POST https://graphql.anilist.co (bearer token from profile.json)
   → Returns list of {mediaId, progress, media: {title, episodes, status, ...}}

2. For each anime:
   a. Database.get(mediaId) → PocketBase REST (or local cache fallback)
   b. Calculate episode window: [progress+1, nextAiringEpisode-1]
   c. NyaaClient.get_torrents() → RSS search per episode
      • Try primary title → verifyQuery scoring
      • If fail: try synonym/english/short-name combinations
   d. QbitClient.add_check_torrent() → POST /api/v2/torrents/add
      • If profile.json useProxy || triggerGenre match → download .torrent + upload
      • Else → direct URL add
      • 2 retries, trusts 200 Ok
   e. Database.upsert(mediaId, OfflineAnime(downloaded_episodes=...))
   f. Discord.send_anime_downloaded_hook() → webhook embed

3. Backoff: set_timeout() increments timeouts counter, skip N future cycles
   • Cap at 10, resets on successful download
```

---

## Database — PocketBase (Self-Hosted)

| Field | Value |
|---|---|
| Container | CT 120 (Debian 12 + Docker), 1 core, 512MB RAM, 4GB disk |
| URL | `https://pb.atoona.com` (NPM proxy, SSL wildcard) |
| Admin | `admin@atoona.com` / `pocketbase2024` |
| Collection | `anime` (ID: `pbc_3628263337`) |
| Schema | `media_id` (number, PK, unique), `downloaded_episodes` (json), `starting_episode` (number), `alternative_title` (text), `timeouts` (number), `max_timeouts` (number), `pending_rewatching_update` (bool) |
| Python auth | `POST /api/collections/pbc_3142635823/auth-with-password` → token in `Authorization` header |

**Resilience:** Database.py maintains a local JSON mirror (`logs/offline_db.json`). If PocketBase is unreachable, reads fall back to cache. Writes mark records `_unsynced` and push on next successful connection.

**Backup:** `cp /opt/pocketbase/pb_data/data.db backup.db` (SQLite-backed)

**Admin dashboard:** `https://pb.atoona.com/_/`

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

---

## Deploy Process

**Quick single-file patch:**
```bash
scp animu/qbittorrent.py root@10.0.0.2:/tmp/
ssh root@10.0.0.2 "pct push 102 /tmp/qbittorrent.py /root/animu/animu/"
ssh root@10.0.0.2 "pct exec 102 -- systemctl restart animu.service"
```

**Full deploy:**
```bash
# Pack and push
cd /home/hermes/animu-python && tar -czf /tmp/animu-deploy.tar.gz .
scp /tmp/animu-deploy.tar.gz root@10.0.0.2:/tmp/
ssh root@10.0.0.2 "pct push 102 /tmp/animu-deploy.tar.gz /tmp/ && pct exec 102 -- tar -xzf /tmp/animu-deploy.tar.gz -C /root/animu/"

# Install deps
ssh root@10.0.0.2 "pct exec 102 -- pip3 install httpx feedparser rapidfuzz schedule colorama anitopy"

# Restart
ssh root@10.0.0.2 "pct exec 102 -- systemctl restart animu.service"
```

**Monitor:**
```bash
ssh root@10.0.0.2 "pct exec 102 -- journalctl -u animu.service -f"
```

---

## Known Pitfalls

1. **Python 3.12 scoping bug:** Using `time.sleep()` inside a method that has any local variable named `time` will throw `cannot access local variable 'time'`. Fix: add `import time` at the top of the method body.

2. **Nyaa.si 504:** Oman ISP blocks Nyaa via ddos-guard CDN. The retry logic handles most cases, but setting `useProxy: true` in profile.json routes through Gluetun (10.0.0.90:8888) for better reliability.

3. **check_torrent race:** qBittorrent needs a few seconds for metadata download after adding a torrent. The `add_check_torrent` method now trusts the 200 Ok response (instead of retrying 5 times). If a torrent truly failed, the scheduler will pick up the missing episode on the next cycle.

4. **Duplicate class definitions:** The original `nyaa.py` had two `class NyaaClient` definitions. The second (empty) one overwrote the singleton at the bottom. Deleting the second class fixes `fetch_rss_feed` not found errors.

5. **profile.json camelCase:** Python uses `snake_case` internally (e.g., `qbit_url`, `ani_user_name`) but profile.json uses `camelCase` (`qbit_url`, `aniUserName`). The `MAP_JSON_TO_ATTR` dict in `config.py` handles the translation.

6. **`verify=False` is load-bearing:** Every `httpx.Client()` in anilist.py, nyaa.py, qbittorrent.py, and database.py must use `verify=False`. Without it, self-signed certs (qb.atoona.com, pb.atoona.com via NPM) will fail.

---

## Infrastructure Reference

| Service | Location | URL |
|---|---|---|
| Animu app | CT 102, 10.0.0.165:3210 | https://animu.atoona.com |
| PocketBase | CT 120, 10.0.0.106:8090 | https://pb.atoona.com |
| qBittorrent | CT 100, Docker, via qb.atoona.com | https://qb.atoona.com |
| Gluetun proxy | CT 100, 10.0.0.90:8888 | (SOCKS/HTTP proxy for Nyaa) |
| AniList API | Cloud | https://graphql.anilist.co |
| Nyaa.si | Cloud | https://nyaa.si (blocked in Oman without proxy) |
