# features-unused/ — Archived T3 module layer (NOT loaded by index.html)

These files are the **T3 modular frontend layer** (merged 2026-08-07 via
`fd387a7`) — **archived, not deleted**. They are deliberately **never loaded**:
`webui/index.html` serves only `/app.js`, and app.js is the single source of
truth for all 9 tabs (Discover / Watching / Lists / Search / Social / Stats /
History / Logs / Settings).

## Why archived (decision record — see AGENTS.md §"Frontend Architecture")

Architecture decision: **Option B — clean up the dead layer** (kanban task
`t_42504c23`). Wiring these modules in (Option A) was rejected because:

- `lists-social.js` mutations are **sandbox-only** (local `Animu.list`
  updates; no backend `/api/anilist/list/update` call) — wiring it in would
  have regressed the backend-routed quick +1 progress, list-editor save/delete
  and post-activity flows (server-side AniList token; the browser never holds
  `bearerTokenAnilist`).
- `lists-social.js` would **double-bind** `btn-editor-save`, `btn-post-activity`,
  `btn-editor-delete`, media-type toggles, sort/search inputs that app.js also
  binds → duplicate POSTs and duplicate fetches.
- `settings-behavior.js` targets DOM ids that do not exist in index.html
  (`btn-theme-light/dark/system`, `title-language-select`; the real ids are
  `theme-toggle` and `pref-title-lang`) — it was written against a different
  DOM contract and would have silently no-opped.
- `home.js`, `engagement.js`, `media-detail.js`, `search.js` are no-op stubs.
- `list.js`'s `updateListEntry` is explicitly a sandbox stub.

The `window.Animu` delegation guards were removed from app.js in commit
`60ae2e0`; `window.Animu` is now deliberately absent.

## Files

```
core.js               — pub/sub bus, settings, ui primitives, feature registry
api.js                — fetch wrapper around /api/* (kept in sync w/ animu/web.py)
list.js               — list fetch + SANDBOX-ONLY updateListEntry stub
downloads.js          — local scheduler integration (downloaded_episodes, addToWatching)
settings-behavior.js  — settings panel behavior (wrong DOM ids — see above)
features/home.js      — no-op stub
features/engagement.js — no-op stub
features/lists-social.js — full-scope Lists+Social impl, sandbox mutations (see above)
features/media-detail.js — no-op stub
features/search.js    — no-op stub
```

## Revival path (if T3 is ever resurrected)

1. Fix `settings-behavior.js` selectors to the real index.html ids.
2. Make `lists-social.js` mutations backend-routed (call
   `A.api.updateListEntry` / `POST /api/anilist/list/update` with `scoreRaw`
   conversion and list-entry `id` for delete) instead of sandbox stubs.
3. Remove the app.js bindings for the controls lists-social.js binds
   (btn-editor-save, btn-post-activity, list status/view/media-type/sort/search)
   to avoid double-binding.
4. Add `<script>` tags in order: core.js -> api.js -> list.js -> downloads.js
   -> features/*.js -> app.js, and cache-bust each in `animu/web.py`
   `serve_static` like `/app.js`.
