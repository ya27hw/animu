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
- **WebUI** — Watching / Discover / History / Logs / Settings tabs, dark theme, mobile nav
- **Discord notifications** — download success + failure alerts via webhook
- **Jellyfin sync plugin** (in `plugins/`) — Jellyfin → AniList progress sync

## Stack

**Python 3** rewrite (no compilation step, no Firebase):
- `animu/` — core modules: scheduler, AniList GraphQL client, Nyaa RSS + scoring, qBittorrent client, PocketBase persistence, history & ignore stores, `http.server` REST/static web server
- `webui/` — vanilla JS + Tailwind CSS v4 (in-browser engine), FontAwesome
- `plugins/jellyfin-ani-sync/` — C# Jellyfin plugin fork (AniList-only)

## How do I set this up?

> NOTE: This is the Python rewrite (default branch `python-rewrite`). The old Node.js v4.3.0 tree with Firebase is legacy.

1. `pip install -r requirements.txt` (httpx, feedparser, rapidfuzz, schedule, colorama, anitopy)
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
