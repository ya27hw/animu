# animu
<img width="1920" height="980" alt="Screenshot_20260301_174741" src="https://github.com/user-attachments/assets/f5ffa62b-a5f9-4a35-9637-46be21d5604a" />

Special thanks to Uncle Sam 💙 for the webUI

## What is this project about?

Conveniently downloads you the latest anime releases locally, without having to access a third-party site.

## Why did I make this?

Simply put, I got bored of continuously accessing websites filled with intrusive ads. The optimal solution would have been to install adblock (duh), but why not take the hard, long path?

## How does this work? (in simple terms)

You give the program your AniList profile. It looks at your current "*WATCHING*" list, determines what episodes you are missing, and proceeds to download them for you! You are then free to do whatever you want with the downloaded files, whether it be hosting them locally on a media server, or just downloading them for a road trip!

## Features

- **Auto-downloader** — polls your AniList WATCHING list, searches Nyaa for missing episodes, downloads via qBittorrent, tracks progress in PocketBase (with offline JSON fallback)
- **Discover tab** — browse AniList (Trending / Popular / Upcoming / Seasonal), search the catalog, view rich media detail, and one-tap add to your list — which feeds the auto-downloader
- **History with actions** — delete entries, re-run on next schedule, or ignore & re-download; persistent ignore list so the scheduler skips shows you don't want
- **WebUI** — Today dashboard, Library, Discover, Queue, History, Activity and Settings; dark/light themes, command palette (⌘K), phone-friendly tab bar
- **Discord notifications** — download success + failure alerts via webhook
- **Jellyfin sync plugin** (in `plugins/`) — Jellyfin → AniList progress sync

## Stack

**Python 3** rewrite (no compilation step, no Firebase):
- `animu/` — core modules: scheduler, AniList GraphQL client, Nyaa RSS + scoring, qBittorrent client, PocketBase persistence, history & ignore stores, `http.server` REST/static web server
- `webui-src/` — the web UI (Vite + Svelte 5); `webui/` is its committed build output
- `plugins/jellyfin-ani-sync/` — C# Jellyfin plugin fork (AniList-only)

## How do I set this up?

> NOTE: This is the Python rewrite (default branch `main`). The old Node.js v4.3.0 tree with Firebase is legacy.

1. `pip install -r requirements.txt` (httpx, colorama, anitopy)
2. Download qBittorrent, enable its Web UI
3. Create `profile.json` (see `AGENTS.md` / `animu/config.py` for the camelCase↔snake_case mapping) with:
   - `qbit_url`, `username`, `password` — your qBittorrent Web UI
   - `aniUserName` — your AniList username
   - `bearerTokenAnilist` — AniList personal access token (needed for list mutations; scheduler reads work without it)
   - `resolution` — "480", "720" or "1080" (1080 recommended)
   - `root_dir` — where downloads should be stored
   - `useProxy` / proxy settings — recommended `true` if Nyaa is blocked on your ISP (routes via a proxy like Gluetun)
4. Run: `python3 main.py --schedule`

For deployment to the live CT 102 instance and full architecture details, see **`AGENTS.md`**.

## Migrating from the previous version

This release rewrites the web UI, hardens the scheduler and speeds up the backend. **Your data and config carry over unchanged**: there is no import step, no schema change and no new required setting.

### What stays the same

- `profile.json` — same keys, same meaning.
- `logs/offline_db.json`, `history.json`, `ignored.json`, `release_prefs.json` and `logs/cache/` — read as-is. The new code writes `offline_db.json` in compact (not indented) JSON; the old code can still read it.
- The PocketBase `anime` collection — **no schema change**. The one new per-show field (`next_attempt_at`) is kept in `offline_db.json` only, and is only sent to PocketBase if you add that field yourself.
- Port (`ANIMU_PORT`, default 3210), `/api/health` and every existing API route and response key.

### What changes

| Area | Before | Now |
|---|---|---|
| Web UI | Tailwind-in-browser SPA (`webui/app.js`) | Svelte app: edit `webui-src/`, build to `webui/` |
| Python deps | `feedparser`, `rapidfuzz`, `schedule` | removed (unused or replaced); only `httpx`, `colorama`, `anitopy` |
| Retry back-off | skip N cycles, one DB write per skipped show per cycle | time-based exponential back-off, no writes while waiting |
| First cycle | waited for a clock-aligned minute | runs immediately at start-up |
| `/api/health` | 503 until a cycle had *finished* | ready as soon as the scheduler starts (`"starting": true`), 503 only if a cycle fails or none succeeds within the stale threshold |
| History | unbounded | capped at the newest 1000 entries |
| AniList access | browser called AniList directly for Discover/search | everything goes through the backend; the token never reaches the browser |
| `GET /api/anime` | included each show's description | no description (the detail view loads it); adds `airedEpisodes`, `nextAirAt`, `state`, `nextAttemptAt` |

Removed from the UI: the Social feed and Messages stub, most of the Stats tab, character/staff/studio search, and the AniList notification bell (it never displayed anything). Everything else has a home: Watching → **Library**, Lists → **Library** (list tabs), Logs → **Activity**, plus new **Today** and **Queue** screens.

Browser-side preferences are not carried over (they use new `localStorage` keys), so the theme and title language reset to their defaults once. Set them again under Settings → Interface.

### Upgrade steps

Production is a git checkout updated by `scripts/animu-update.sh` (see `DEPLOYMENT.md`). You do **not** need Node on the server: the built UI in `webui/` is committed.

1. **Back up state** (optional but cheap):
   ```bash
   cd /root/animu && tar czf ~/animu-state-$(date +%F).tgz profile.json logs/*.json
   ```
2. **Get the change onto `main`.** The update timer tracks `main` and only fast-forwards, so merge or fast-forward this branch into `main` and push. Wait up to 15 minutes for the timer, or run it now:
   ```bash
   sudo systemctl start animu-update.service
   ```
   The updater installs the (smaller) `requirements.txt`, restarts the service **from inside the container**, and rolls back automatically if `/api/health` is not HTTP 200 within 30 s.
3. **Check it came up:**
   ```bash
   curl -s http://127.0.0.1:3210/api/health      # "ok": true; "starting": true until the first cycle ends
   curl -s http://127.0.0.1:3210/api/status      # scheduler, next_run_at, service state
   ```
   Then open the UI and hard-refresh once (Ctrl/Cmd+Shift+R). Asset filenames are content-hashed, so this is only needed to drop the old page that is already open.
4. **Reconnect AniList if you want to update your list from the UI.** Settings → AniList → *Get sign-in code*, approve on AniList, paste the code. This needs `anilistClientId` in `profile.json`. If `bearerTokenAnilist` is already set it keeps working, and reads and downloads never need the sign-in.

Manual (non-updater) install: `git pull && pip install -r requirements.txt`, then restart the service. Never restart `animu.service` from the Proxmox host (see `AGENTS.md`).

### Things you may notice

- **Shows in back-off** from the old version are converted automatically on the first cycle: their remaining "skip N cycles" becomes a time-based wait. Nothing needs resetting.
- **The first cycle after the upgrade searches every show that is missing an episode**, as before. Shows that were previously wrongly credited as fully downloaded (for example from a mismatched batch torrent) are not re-checked; use *Overrides → Reset downloaded episodes* on a show to redo it.
- **Cycles now also run when a show is due to air** and when a retry comes due, not only on the fixed interval. Scheduled cycles never start closer together than 5 minutes (the manual *Run cycle now* button is exempt).
- **A single failing show no longer marks the whole service unhealthy.** The Today screen shows it under *Needs attention* and the cycle summary reports it as failed.
- A second process can't run a cycle at the same time: `main.py --once` while the service is mid-cycle exits with a message (lock file `logs/animu-cycle.lock`).

### Rolling back

```bash
cd /root/animu && git reset --hard <previous-sha> && pip install -r requirements.txt
# then restart the service inside the container
```
Your state files are readable by the old version too (verified in both directions), so no restore is needed. The updater does this automatically if the health check fails.

### Optional: PocketBase credentials

The PocketBase URL and login are still built in as a fallback. You can now override them without editing code via the environment variables `ANIMU_PB_URL`, `ANIMU_PB_IDENTITY` and `ANIMU_PB_PASSWORD` (set them in the systemd unit). Since the old values have been in git history, rotating that password is recommended.

### Working on the UI

```bash
cd webui-src && npm install
npm run dev:mock     # UI against fixture data, no PocketBase/qBittorrent/AniList needed
npm run dev          # UI against a running backend on :3210
npm run build        # writes the hashed bundle to ../webui — commit it
```
Never hand-edit files in `webui/`; they are generated.
