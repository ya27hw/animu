# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Animu reads a user's AniList "WATCHING" list, works out which aired episodes are missing, finds them on Nyaa (RSS), and hands the torrents to a local qBittorrent instance via its Web UI API. A small built-in web UI manages the library, logs, config and manual searches. This branch is the TypeScript/Node implementation (a separate `python-rewrite` branch exists upstream).

## Commands

- `npm install`
- `npm run build` — `tsc && tsc-alias` into `build/` (tsc-alias is required to rewrite the `@ani/*`-style path aliases in emitted JS)
- `node build/main.js [choice]` — run directly; the optional arg skips the interactive menu: `1` = scheduler once, `2` = scheduler loop + web UI, `3` = web UI only
- `npm start` / `stop` / `restart` / `logs` / `status` / `monitor` — PM2 wrappers around `ecosystem.config.json` (runs `build/main.js 2`, restarts at 250M memory, logs to `logs/`)
- `npm run memory` — `analyze-memory.js`; `pm2-memory-commands.md` lists PM2 memory-inspection commands

There is no test suite (`npm test` is a stub) and no linter configured. Type-checking is `npx tsc --noEmit`. `.gitignore` ignores `test*`, so ad-hoc test files won't be committed.

## Configuration

Runtime config is a `profile.json` (git-ignored), read by `getConfig()` in `src/utils/config.ts`. It looks in `src/profile.json` first, then the repo root. It is re-read on every `getConfig()` call, so most settings take effect without a restart; `saveConfig()` (used by the web UI) writes both locations. Trailing commas are tolerated. The `ProfileConfig` interface is the authoritative list of keys (qBittorrent, AniList token, proxy, Nyaa URLs, Discord webhook, intervals, etc.).

Persistent state outside the code:
- Firebase Firestore (credentials in `src/database/creds.json`, login via `email`/`emailPassword` from the profile) stores per-anime entries (user-set `startingEpisode`, `alternativeTitle`, `pendingRewatchingUpdate`, …). The README notes the original Firebase project is private, so a fresh setup needs its own.
- `logs/offline-cache.json` — the scheduler's cache of already-downloaded episodes.

## Architecture

TypeScript, strict, CommonJS, `target: es5`. Modules are imported through path aliases defined in `tsconfig.json` (`@ani`, `@db`, `@nyaa`, `@qbit`, `@scheduler`, `@ui`, `@utils`). Each integration is a singleton class exported as default (`export default new X()`). Shared types, enums, and helpers are re-exported from `src/utils/index.ts`.

Entry flow: `main.ts` → `ui/ui.ts` (menu/arg selection) → `scheduler/schedule.ts` and/or `web/web.ts`.

The core pipeline lives in `Scheduler` (`src/scheduler/schedule.ts`):
1. A cron job fires every minute but `shouldRunAt()` gates it to `interval` (peak, 12:00–04:59) or `offpeakInterval` (05:00–11:59) minutes; an `isRunning` flag prevents overlapping runs. `RUNTIMES` in `utils/constants.ts` has matching cron strings.
2. `check()` pulls the AniList watching list (`anilist/anilist.ts`, GraphQL) and all Firestore entries (`database/db.ts`) in one call each.
3. An in-memory/on-disk "offline DB" (`OfflineAnime`: downloaded episodes, `starting_episode` offset, `timeouts` back-off counter) decides which anime have missing episodes. Anime in back-off are skipped and the counter decremented. The offline DB is cleared daily.
4. Anime needing work go through `handleAnime`, throttled by `p-limit(3)` via `handleWithDelay`. It applies per-anime overrides from Firestore (alternate title, `startingEpisode` for sequels that continue numbering from the previous season), asks `nyaa/nyaa.ts` for ranked torrents (RSS via `rss-parser`, titles parsed with `anitomy-js` and matched with `string-similarity`; modes in `SearchMode`: episode/batch/OVA/…; release groups in `excludeReleaseGroups` are filtered), and sends the best one to `qbit_torrent/qbit.ts`. Downloads/failures trigger Discord webhook notices (`scheduler/utils.ts`).

Cross-cutting details that span files:
- **Proxy**: `getProxyAgent()` in `utils/models.ts` (HTTPS-over-HTTP via `https-proxy-agent`, `proxyAuthType` of `none`/`credentials`) is used by the AniList, Nyaa and qBittorrent clients. `nyaa.ts` `getSearchContext` can switch to `altNyaaUrl` with the proxy forced on for specific anime.
- **qBittorrent**: cookie-session auth against `qbit_url`; torrents are written to a temp dir (`os.tmpdir()/animu-torrents`) and uploaded; `rootDir`/`altRootDir` choose the save path.
- **Web UI** (`src/web/web.ts`): a hand-rolled `http.createServer` (no framework) serving the static SPA in `src/web/public/` (`index.html` + `app.js`) plus `/api/*` JSON endpoints (library, logs, config, Nyaa title search/download). Defaults to `0.0.0.0:3210`; override with `ANIMU_WEB_HOST` / `ANIMU_WEB_PORT`. It reads the PM2 log files from `logs/` or `~/.pm2/logs`. The static files are not compiled by `tsc`, so `public/` is read from `src/` at runtime.
- **Season/relation handling**: `scheduler/utils.ts` (`fixAnimeSeason`, `countPastRelations`) uses AniList `MediaRelation` data to compute season/episode offsets used when building Nyaa queries.
