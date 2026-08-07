# QA Review & Visual Audit Report: Animu Python Rewrite

**Repository:** `animu`  
**Base Commit:** `059272bc10581f6b0904b70fb0976488c8408443`  
**Target Branch:** `antigravity/t_07b510a9-run-1`  
**Date:** 2026-08-07  

---

## Executive Summary

This report documents an independent code review and visual QA inspection of the **Animu Python Rewrite**. The review evaluated backend python modules (`animu/*.py`), frontend single-page web UI (`webui/`), security and authentication hygiene, user experience, and test suite coverage.

---

## PART A: Code Review & System Audit

### 1. Backend Bugs (`animu/*.py`)

1. **[CRITICAL] Hardcoded Admin Credentials in PocketBase & Config Defaults**
   - **Evidence:** [`animu/database.py:9`](file:///var/lib/antigravity-worker/worktrees/task-t_07b510a9-run-1/animu/database.py#L9), [`animu/config.py:13-14`](file:///var/lib/antigravity-worker/worktrees/task-t_07b510a9-run-1/animu/config.py#L13-L14)
   - **Description:** Admin credentials (`PB_AUTH = {"identity": "admin@atoona.com", "password": "pocketbase2024"}`) and default qBittorrent login credentials (`admin`/`adminadmin`) are hardcoded directly into Python source files.
   - **Fix Direction:** Move default secrets out of source code and require environment variables or secure credential files.

2. **[MAJOR] Thread-Unsafe Shared State & Race Conditions**
   - **Evidence:** [`animu/config.py:99-134`](file:///var/lib/antigravity-worker/worktrees/task-t_07b510a9-run-1/animu/config.py#L99-L134) (`cached_config`), [`animu/nyaa.py:391-460`](file:///var/lib/antigravity-worker/worktrees/task-t_07b510a9-run-1/animu/nyaa.py#L391-L460) (`active_traces`, `failed_traces`), [`animu/database.py:22-43`](file:///var/lib/antigravity-worker/worktrees/task-t_07b510a9-run-1/animu/database.py#L22-L43) (`self.local_cache`)
   - **Description:** The `http.server` handles incoming web API requests in multi-threaded contexts while the background scheduler loop executes concurrently. Shared data structures (`cached_config`, `active_traces`, `failed_traces`, `local_cache`) are read and mutated without locks (`threading.Lock`), causing race conditions and JSON cache write corruption.
   - **Fix Direction:** Implement mutex locking (`threading.Lock()`) around shared cache reads and file writes.

3. **[MAJOR] Unhandled AniList GraphQL Auth Fallback & Token Leakage in Retry Loop**
   - **Evidence:** [`animu/anilist.py:47-50`](file:///var/lib/antigravity-worker/worktrees/task-t_07b510a9-run-1/animu/anilist.py#L47-L50)
   - **Description:** When an invalid or expired AniList Bearer token receives HTTP 400/401, `AnilistClient._query` removes `Authorization` header in-place during the loop, but never updates or clears the stored `config.bearer_token_anilist`. On every subsequent query, the client attempts the bad token first, triggering unnecessary 401s and fallback delays.
   - **Fix Direction:** Invalidate `cached_config.bearer_token_anilist` upon detecting HTTP 401 authentication failures.

4. **[MINOR] Dead Code — Unused `get_watching_list()` Function in AniList Client**
   - **Evidence:** [`animu/anilist.py:78-111`](file:///var/lib/antigravity-worker/worktrees/task-t_07b510a9-run-1/animu/anilist.py#L78-L111)
   - **Description:** `get_watching_list()` defines a minimal GraphQL watchlist query, but is never invoked anywhere in the application (`web.py` and `scheduler.py` both call `get_anime_user_list()`).
   - **Fix Direction:** Remove `get_watching_list()` to clean up dead code.

5. **[MINOR] Inconsistent History Metadata in Manual Nyaa Downloads**
   - **Evidence:** [`animu/web.py:259-280`](file:///var/lib/antigravity-worker/worktrees/task-t_07b510a9-run-1/animu/web.py#L259-L280) vs [`animu/web.py:325-373`](file:///var/lib/antigravity-worker/worktrees/task-t_07b510a9-run-1/animu/web.py#L325-L373)
   - **Description:** The `/api/nyaa-download` endpoint records history entries without `episode` or `cover_image` attributes, whereas `/api/anime/:id/nyaa-download` populates these details.
   - **Fix Direction:** Standardize `/api/nyaa-download` to capture complete history metadata.

6. **[MAJOR] Potential Unbound Recursion in Prequel Chain Traversal**
   - **Evidence:** [`animu/utils.py:106-131`](file:///var/lib/antigravity-worker/worktrees/task-t_07b510a9-run-1/animu/utils.py#L106-L131)
   - **Description:** `count_past_relations()` walks prequel chains recursively. If an AniList media entry contains cyclic relation references or an arbitrarily long chain, it will trigger an unhandled `RecursionError`.
   - **Fix Direction:** Pass a `visited: set` to `count_past_relations` to halt cyclic relations.

---

### 2. Frontend Bugs (`webui/`)

7. **[MAJOR] Unhandled Error State & Infinite Loading Spinner in Watchlist Grid**
   - **Evidence:** [`webui/app.js:180-186`](file:///var/lib/antigravity-worker/worktrees/task-t_07b510a9-run-1/webui/app.js#L180-L186), [`webui/app.js:1263-1280`](file:///var/lib/antigravity-worker/worktrees/task-t_07b510a9-run-1/webui/app.js#L1263-L1280)
   - **Description:** When `/api/anime` fails or times out, `loadDashboard()` displays a toast notification but leaves `#anime-grid` showing an infinite loading spinner (`Fetching watchlist entries...`). No error banner or retry control is shown.
   - **Fix Direction:** Catch fetch failures and render an inline error state with a "Retry" button.

8. **[MINOR] Theme Switcher Icon State Desynchronization**
   - **Evidence:** [`webui/index.html:103-113`](file:///var/lib/antigravity-worker/worktrees/task-t_07b510a9-run-1/webui/index.html#L103-L113), [`webui/app.js:208-221`](file:///var/lib/antigravity-worker/worktrees/task-t_07b510a9-run-1/webui/app.js#L208-L221)
   - **Description:** `app.js` only binds the click listener to `DOM.themeToggle` (mobile). The desktop theme toggle `#theme-toggle-desktop` is not bound, so clicking it on desktop does nothing.
   - **Fix Direction:** Bind theme toggle listeners to both mobile and desktop elements.

9. **[MINOR] Unescaped HTML Interpolation in Torrent Title Search Modal**
   - **Evidence:** [`webui/app.js:609`](file:///var/lib/antigravity-worker/worktrees/task-t_07b510a9-run-1/webui/app.js#L609), [`webui/app.js:1113`](file:///var/lib/antigravity-worker/worktrees/task-t_07b510a9-run-1/webui/app.js#L1113)
   - **Description:** Torrent titles returned from RSS feed search are inserted directly into `innerHTML` strings (`${item.title}`) without HTML escaping.
   - **Fix Direction:** Use `textContent` or HTML entity escaping for user/feed strings before DOM insertion.

---

### 3. Security Review

10. **[CRITICAL] Unauthenticated REST API Endpoints (`/api/*`)**
    - **Evidence:** [`animu/web.py:120-446`](file:///var/lib/antigravity-worker/worktrees/task-t_07b510a9-run-1/animu/web.py#L120-L446)
    - **Description:** All REST routes (`/api/config`, `/api/anime`, `/api/history`, `/api/nyaa-download`, etc.) have zero authentication checks. Anyone who can reach the web server port can modify system settings, wipe download history, and trigger torrent downloads.
    - **Fix Direction:** Add cookie/token authentication middleware to `AnimuHTTPHandler`.

11. **[CRITICAL] Plaintext Credentials Exposure via `/api/config` GET Endpoint**
    - **Evidence:** [`animu/web.py:135-136`](file:///var/lib/antigravity-worker/worktrees/task-t_07b510a9-run-1/animu/web.py#L135-L136), [`animu/config.py:56-94`](file:///var/lib/antigravity-worker/worktrees/task-t_07b510a9-run-1/animu/config.py#L56-L94)
    - **Description:** Calling `GET /api/config` returns raw plaintext passwords (`password`, `emailPassword`, `proxyPassword`) and AniList access tokens (`bearerTokenAnilist`) in JSON.
    - **Fix Direction:** Redact/mask password fields before returning configuration JSON to the UI.

12. **[HIGH] Server-Side Request Forgery (SSRF) in Connection Test Endpoints**
    - **Evidence:** [`animu/web.py:187-204`](file:///var/lib/antigravity-worker/worktrees/task-t_07b510a9-run-1/animu/web.py#L187-L204) (`/api/test/proxy`), [`animu/web.py:206-231`](file:///var/lib/antigravity-worker/worktrees/task-t_07b510a9-run-1/animu/web.py#L206-L231) (`/api/test/discord`)
    - **Description:** The proxy and webhook test endpoints accept user-controlled URLs/IPs and issue HTTP requests using `httpx` without validating hostnames or blocking internal/private IP ranges (e.g. 127.0.0.1, AWS IMDS 169.254.169.254).
    - **Fix Direction:** Validate and restrict target URLs to public hosts or strictly allowed endpoints.

---

## PART B: Visual QA Inspection (With Vision)

### Screenshots Analyzed
- **Desktop (1440x1000):** [`t_07b510a9-run-1-desktop.png`](file:///home/antigravity-worker/worker/evidence/t_07b510a9-run-1/screenshots/t_07b510a9-run-1-desktop.png)
- **Mobile (390x844):** [`t_07b510a9-run-1-mobile.png`](file:///home/antigravity-worker/worker/evidence/t_07b510a9-run-1/screenshots/t_07b510a9-run-1-mobile.png)

### Visual Findings

13. **[COSMETIC] Accent Line Overflow Glitch on Welcome Card**
    - **Evidence:** Welcome Banner Card in `t_07b510a9-run-1-desktop.png` and `t_07b510a9-run-1-mobile.png` ([`webui/index.html:143-162`](file:///var/lib/antigravity-worker/worktrees/task-t_07b510a9-run-1/webui/index.html#L143-L162))
    - **Description:** The bottom gradient accent line (`h-1 bg-gradient-to-r...`) on the welcome card clips straight across the bottom, protruding past the rounded 3xl corner borders of the parent container.
    - **Fix Direction:** Add `overflow-hidden` to the parent card container.

14. **[COSMETIC] Low Contrast Text on Loading State Indicator**
    - **Evidence:** Watchlist loading spinner in `t_07b510a9-run-1-desktop.png` and `t_07b510a9-run-1-mobile.png` ([`webui/index.html:184`](file:///var/lib/antigravity-worker/worktrees/task-t_07b510a9-run-1/webui/index.html#L184))
    - **Description:** "Fetching watchlist entries..." loading text rendered below the spinner uses `text-slate-400` (#94a3b8) on off-white background (#f8fafc), failing WCAG AA contrast standards for light mode readability.
    - **Fix Direction:** Increase font weight and adjust text color to `text-slate-600` or `text-slate-700` in light theme.

15. **[COSMETIC] Mobile Spacing & Vertical Alignment of Status Indicator**
    - **Evidence:** Welcome Card in `t_07b510a9-run-1-mobile.png` ([`webui/index.html:153-158`](file:///var/lib/antigravity-worker/worktrees/task-t_07b510a9-run-1/webui/index.html#L153-L158))
    - **Description:** On mobile viewports (390px), the "Scheduler Active" dot and label wrap under the paragraph text with cramped spacing and left-alignment that looks disconnected from the main heading.
    - **Fix Direction:** Adjust mobile layout padding to provide clean vertical rhythm between header items.

---

## Test Suite & Compilation Audit

- **Tracked Test Suite (`pytest`):** `8 passed in 0.89s` (ran via `PYTHONPATH=. pytest -q`).
- **Python Compilation (`compileall`):** `python3 -m compileall animu` passed cleanly with 0 errors.
- **Known Ignored Leftover:** `tests/test_nyaa_episode_offsets.py` is a gitignored leftover that fails 2 tests (ignored per task instructions).

### Test Coverage Gaps

16. **[MAJOR] Missing Unit Tests for PocketBase Sync & Local Offline Cache**
    - **Evidence:** [`tests/`](file:///var/lib/antigravity-worker/worktrees/task-t_07b510a9-run-1/tests)
    - **Description:** `database.py` contains critical local cache fallback and sync reconciliation logic, but there are zero unit tests verifying offline cache operations when PocketBase is down.
    - **Fix Direction:** Add unit tests using mocked HTTP responses to verify `sync_local_changes()` and `get_all()` fallback behavior.

17. **[MAJOR] Missing Web API Endpoint Tests**
    - **Evidence:** [`tests/test_web_api.py`](file:///var/lib/antigravity-worker/worktrees/task-t_07b510a9-run-1/tests/test_web_api.py)
    - **Description:** `test_web_api.py` only tests basic route instantiation. Key endpoints like `/api/config` PATCH, `/api/history` DELETE, `/api/nyaa-download` POST have no unit test assertions.
    - **Fix Direction:** Expand `test_web_api.py` with mock HTTP handler requests testing error codes and payload validation.

---

## Summary Findings Count

| Severity | Count |
|---|---|
| **CRITICAL** | 3 |
| **MAJOR** | 6 |
| **MINOR** | 5 |
| **COSMETIC** | 3 |
| **TOTAL** | **17** |
