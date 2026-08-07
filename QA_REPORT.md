# QA Findings Report — Animu Python Rewrite

**Repository:** `animu` (`/var/lib/antigravity-worker/worktrees/task-t_814aae39-run-1`)  
**Base Commit:** `059272bc10581f6b0904b70fb0976488c8408443`  
**Target Branch:** `antigravity/t_814aae39-run-1`  
**Review Type:** Code Review & Visual QA with Vision (Part A & Part B)  

---

## Part A: Code Review Findings

### 1. Backend Bugs (`animu/*.py`)

1. **[MAJOR] Unreachable Score Threshold for Valid Torrents with Title Similarity < 88%**
   - **File & Lines:** [`animu/utils.py:308-311`](file:///var/lib/antigravity-worker/worktrees/task-t_814aae39-run-1/animu/utils.py#L308-L311)
   - **Description:** The torrent scoring threshold is hardcoded to `3.88` out of `4.0`. The three discrete verification components (episode match, video resolution match, air date buffer match) contribute at most `1.0 + 1.0 + 1.0 = 3.0`. Therefore, `best_rating` (string title similarity) must be at least `0.88` (88%). Any legitimate torrent candidate with title similarity between `70%` and `87%` will achieve a total score of `< 3.88` and be rejected despite matching the episode, resolution, and air date perfectly.
   - **Suggested Fix:** Lower the minimum score threshold (e.g., to `3.70`) or adjust the title similarity weight scaling so valid releases are not discarded.

2. **[MAJOR] Unsynchronized Thread Access to Local JSON Cache Mirror**
   - **File & Lines:** [`animu/database.py:22,133-154`](file:///var/lib/antigravity-worker/worktrees/task-t_814aae39-run-1/animu/database.py#L22)
   - **Description:** `Database.local_cache` and `logs/offline_db.json` are read and written concurrently by both the main scheduler loop thread (`scheduler.py`) and Web UI HTTP handler threads (`web.py`). Because dictionary mutations and disk writes are not guarded by a mutex/lock, concurrent updates can cause `RuntimeError: dictionary changed size during iteration` or file corruption.
   - **Suggested Fix:** Add a `threading.Lock()` in `Database` to synchronize all reads and writes to `local_cache` and `offline_db.json`.

3. **[MAJOR] Thread-Unsafe Global Search Trace State**
   - **File & Lines:** [`animu/nyaa.py:391-392`](file:///var/lib/antigravity-worker/worktrees/task-t_814aae39-run-1/animu/nyaa.py#L391-L392)
   - **Description:** Global dictionaries `active_traces` and `failed_traces` are mutated by `scheduler.py` / `nyaa.py` during search execution and concurrently read by `web.py` at `/api/search-debug` without any synchronization.
   - **Suggested Fix:** Protect reads and mutations of `active_traces` and `failed_traces` with a `threading.Lock()`.

4. **[MAJOR] In-Place Mutation of Shared AniList Title Data Structure**
   - **File & Lines:** [`animu/scheduler.py:139-140`](file:///var/lib/antigravity-worker/worktrees/task-t_814aae39-run-1/animu/scheduler.py#L139-L140)
   - **Description:** `handle_anime()` directly overwrites `anime["media"]["title"]["romaji"] = alternative_title` on the in-memory object returned by `anilist.get_anime_user_list()`. Mutating shared data structures in-place causes subsequent routines or retries to lose the original AniList romaji title.
   - **Suggested Fix:** Assign title overrides to a local variable or a shallow copy of the anime dictionary rather than mutating `anime["media"]["title"]`.

5. **[MINOR] Silent Masking of Network Failures in AniList Client**
   - **File & Lines:** [`animu/anilist.py:109-110,166-167`](file:///var/lib/antigravity-worker/worktrees/task-t_814aae39-run-1/animu/anilist.py#L109-L110)
   - **Description:** `get_watching_list()` and `get_anime_user_list()` return an empty list `[]` when GraphQL queries fail or encounter network timeouts. Callers (e.g. `scheduler.py`) treat an API outage as an empty user watchlist instead of logging a network error and skipping the cycle.
   - **Suggested Fix:** Raise an exception or return `None` on network failure so callers can distinguish between an empty watchlist and an API connection error.

6. **[MINOR] Missing Numeric Type Casting in Profile Configuration Parser**
   - **File & Lines:** [`animu/config.py:115-124`](file:///var/lib/antigravity-worker/worktrees/task-t_814aae39-run-1/animu/config.py#L115-L124)
   - **Description:** `get_config()` explicitly converts `id` to `int`, but does not cast other numeric fields (`proxy_port`, `interval`, `offpeak_interval`). If string values are provided in `profile.json`, they remain `str` in memory, causing type errors during arithmetic or network operations.
   - **Suggested Fix:** Explicitly cast `proxy_port`, `interval`, and `offpeak_interval` to `int` in `get_config()`.

7. **[MINOR] Cookie Fallback Issue in qBittorrent Authentication**
   - **File & Lines:** [`animu/qbittorrent.py:28-35`](file:///var/lib/antigravity-worker/worktrees/task-t_814aae39-run-1/animu/qbittorrent.py#L28-L35)
   - **Description:** `self.client.cookies.get("SID")` retrieves the cookie from the httpx cookie jar, but if qBittorrent sets `Set-Cookie` with specific domain/path attributes that `httpx` stores under a non-default domain key, `cookies.get("SID")` returns `None` even after an HTTP 200 "Ok." login.
   - **Suggested Fix:** Parse the raw `Set-Cookie` response header directly if `cookies.get("SID")` returns `None`.

8. **[MINOR] Unhandled Non-Numeric Seeders in Nyaa RSS Parser**
   - **File & Lines:** [`animu/nyaa.py:84-86`](file:///var/lib/antigravity-worker/worktrees/task-t_814aae39-run-1/animu/nyaa.py#L84-L86)
   - **Description:** Line 85 sorts RSS items with `key=lambda x: int(x["nyaa:seeders"])`. If an RSS entry has missing or non-integer seeders data, `int(...)` raises an unhandled `ValueError`, causing the entire RSS feed fetch to fail.
   - **Suggested Fix:** Use a safe parsing helper (e.g. `int(x.get("nyaa:seeders", 0) or 0)`) with fallback exception handling.

---

### 2. Frontend Bugs (`webui/`)

9. **[CRITICAL] Desktop Dark Mode Toggle Button Unresponsive**
   - **File & Lines:** [`webui/app.js:184,217-220`](file:///var/lib/antigravity-worker/worktrees/task-t_814aae39-run-1/webui/app.js#L184) & [`webui/index.html:110`](file:///var/lib/antigravity-worker/worktrees/task-t_814aae39-run-1/webui/index.html#L110)
   - **Description:** `app.js` defines `DOM.themeToggleDesktop` for `#theme-toggle-desktop`, but only binds a click listener to `DOM.themeToggle` (mobile header button). Clicking the desktop theme toggle button in the header produces zero visual response.
   - **Suggested Fix:** Add an event listener to `DOM.themeToggleDesktop` (or bind both elements together) to toggle theme state.

10. **[MAJOR] Permanent Stuck Loading Spinner on API Outage**
    - **File & Lines:** [`webui/app.js:345-353,1276-1280`](file:///var/lib/antigravity-worker/worktrees/task-t_814aae39-run-1/webui/app.js#L1276)
    - **Description:** In `loadDashboard()`, if `API.getAnime()` fails (backend offline or network error), an error toast is displayed but `DOM.animeGrid` is never updated. The page remains permanently stuck showing `"Fetching watchlist entries..."` with a spinner.
    - **Suggested Fix:** Render an error card state with a retry button inside `DOM.animeGrid` when `loadDashboard()` catches an error.

11. **[MAJOR] Continuous Background Polling When Auto-Refresh Disabled**
    - **File & Lines:** [`webui/app.js:665-669`](file:///var/lib/antigravity-worker/worktrees/task-t_814aae39-run-1/webui/app.js#L665-L669)
    - **Description:** A global `setInterval` checks `DOM.logAutoRefresh.checked` every 2 seconds. When unchecked, logs do not auto-refresh, but the timer continues running indefinitely in the background even when navigating away from the Logs tab.
    - **Suggested Fix:** Start the log refresh timer only when the Logs tab is active and auto-refresh is enabled; clear the timer on tab exit.

12. **[MINOR] Missing Negative Bounds Check on Starting Episode Override**
    - **File & Lines:** [`webui/app.js:486-491`](file:///var/lib/antigravity-worker/worktrees/task-t_814aae39-run-1/webui/app.js#L486-L491) & [`webui/index.html:486`](file:///var/lib/antigravity-worker/worktrees/task-t_814aae39-run-1/webui/index.html#L486)
    - **Description:** The starting episode override input in the anime configuration modal allows negative integers to be submitted to the backend.
    - **Suggested Fix:** Add `min="0"` to the input element in `index.html` and sanitize with `Math.max(0, ...)` in `app.js`.

13. **[COSMETIC] Unformatted Text String in Manual Nyaa Search Modal**
    - **File & Lines:** [`webui/app.js:605-613`](file:///var/lib/antigravity-worker/worktrees/task-t_814aae39-run-1/webui/app.js#L605-L613)
    - **Description:** In the Nyaa search modal results, raw manual searches display `"Manual Index Query"` in the score badge field, appearing like internal placeholder text.
    - **Suggested Fix:** Replace `"Manual Index Query"` with a styled `"Raw Search"` tag or omit score badges when no score calculation is performed.

---

### 3. Security Review

14. **[CRITICAL] Hardcoded Admin Superuser Credentials in Source Code**
    - **File & Lines:** [`animu/database.py:9`](file:///var/lib/antigravity-worker/worktrees/task-t_814aae39-run-1/animu/database.py#L9)
    - **Description:** Plaintext admin superuser identity and password (`PB_AUTH = {"identity": "admin@atoona.com", "password": "pocketbase2024"}`) are committed directly in the source repository.
    - **Suggested Fix:** Store PocketBase superuser credentials in environment variables or external configuration files excluded from source control.

15. **[MAJOR] Unauthenticated REST API Web Endpoints**
    - **File & Lines:** [`animu/web.py:120-447`](file:///var/lib/antigravity-worker/worktrees/task-t_814aae39-run-1/animu/web.py#L120)
    - **Description:** All REST endpoints (`/api/config`, `/api/anime`, `/api/history`, `/api/nyaa-download`) served on port `3210` operate without authentication or session validation. Any user on the local network can view/modify secrets, trigger downloads, or clear history.
    - **Suggested Fix:** Implement session token or API key authentication middleware for `/api/*` endpoints.

16. **[MAJOR] Server-Side Request Forgery (SSRF) via `/api/test/proxy`**
    - **File & Lines:** [`animu/web.py:187-204`](file:///var/lib/antigravity-worker/worktrees/task-t_814aae39-run-1/animu/web.py#L187-L204)
    - **Description:** `/api/test/proxy` accepts user-supplied `proxyAddress` and `proxyPort` in JSON body and initiates an outbound HTTP request to `https://google.com`. An unauthenticated attacker can probe internal network endpoints or pivot through internal proxies.
    - **Suggested Fix:** Enforce strict host/port validation or restrict proxy test execution.

17. **[MAJOR] Arbitrary HTTP POST Target via `/api/test/qbittorrent`**
    - **File & Lines:** [`animu/web.py:175-185`](file:///var/lib/antigravity-worker/worktrees/task-t_814aae39-run-1/animu/web.py#L175-L185)
    - **Description:** An unauthenticated caller can pass an arbitrary URL as `qbitUrl`, causing the server to send HTTP POST requests with login payloads to arbitrary internal or external targets.
    - **Suggested Fix:** Validate `qbitUrl` against configured profile parameters before issuing HTTP requests.

18. **[MAJOR] Arbitrary Outbound Webhook Target via `/api/test/discord`**
    - **File & Lines:** [`animu/web.py:206-230`](file:///var/lib/antigravity-worker/worktrees/task-t_814aae39-run-1/animu/web.py#L206-L230)
    - **Description:** Any caller can supply an arbitrary URL as `webhook`, causing the server to execute outbound HTTP POST requests with Discord embed JSON payloads to arbitrary endpoints.
    - **Suggested Fix:** Validate that the target webhook URL matches the configured system webhook URL.

---

### 4. UX/Design Issues

19. **[MAJOR] Mobile Navigation Drawer Does Not Close on Tab Selection**
    - **File & Lines:** [`webui/index.html:117-133`](file:///var/lib/antigravity-worker/worktrees/task-t_814aae39-run-1/webui/index.html#L117) & [`webui/app.js:278-284,295-302`](file:///var/lib/antigravity-worker/worktrees/task-t_814aae39-run-1/webui/app.js#L295-L302)
    - **Description:** Opening the hamburger drawer on mobile and selecting a tab changes the active view panel, but the mobile menu drawer remains open covering the screen until manually toggled closed.
    - **Suggested Fix:** Ensure `switchTab()` collapses `#mobile-menu` and resets the hamburger icon icon class.

20. **[MINOR] High-Contrast Terminal Box Boundary in Light Mode**
    - **File & Lines:** [`webui/index.html:271-280`](file:///var/lib/antigravity-worker/worktrees/task-t_814aae39-run-1/webui/index.html#L271-L280)
    - **Description:** In light theme mode, the log terminal console retains a dark black background (`#050914`), creating a sharp visual contrast boundary against the light theme background and header.
    - **Suggested Fix:** Soften terminal container borders and header styling for harmonious appearance in light mode.

---

### 5. Test Coverage Gaps (`tests/`)

21. **[MAJOR] Minimal Test Suite Coverage across Core Modules**
    - **File & Lines:** [`tests/`](file:///var/lib/antigravity-worker/worktrees/task-t_814aae39-run-1/tests/)
    - **Description:** The existing test suite contains only 2 active test files (`test_search_diagnostics.py` and `test_web_api.py`) with 8 total test cases. Core logic in `database.py` (PocketBase CRUD & local cache fallback), `config.py` (JSON mapping), `anilist.py` (GraphQL queries), `qbittorrent.py` (torrent adding), `discord.py` (embed alerts), and `scheduler.py` (airing window calculation) lacks test coverage.
    - **Suggested Fix:** Expand the unit test suite under `tests/` to cover database sync, config serialization, qBittorrent client, and scheduler execution logic.

---

## Part B: Visual QA Findings (Vision Inspection)

**Evidence Files:**
- Desktop Screenshot: [`/home/antigravity-worker/worker/evidence/t_814aae39-run-1/screenshots/t_814aae39-run-1-desktop.png`](file:///home/antigravity-worker/worker/evidence/t_814aae39-run-1/screenshots/t_814aae39-run-1-desktop.png)
- Mobile Screenshot: [`/home/antigravity-worker/worker/evidence/t_814aae39-run-1/screenshots/t_814aae39-run-1-mobile.png`](file:///home/antigravity-worker/worker/evidence/t_814aae39-run-1/screenshots/t_814aae39-run-1-mobile.png)

22. **[MAJOR] Permanent Stuck Loading State When API Stream Fails (Desktop & Mobile)**
    - **File & Lines:** [`webui/index.html:180-186`](file:///var/lib/antigravity-worker/worktrees/task-t_814aae39-run-1/webui/index.html#L180-L186) & [`webui/app.js:345-353`](file:///var/lib/antigravity-worker/worktrees/task-t_814aae39-run-1/webui/app.js#L345-L353)
    - **Visual Evidence:** In both desktop (`t_814aae39-run-1-desktop.png`) and mobile (`t_814aae39-run-1-mobile.png`) screenshots, the main watchlist container shows a centered purple spinner and `"Fetching watchlist entries..."` indefinitely. When previewed without an active API backend or when an API error occurs, the UI never transitions to an offline/error view.
    - **Suggested Fix:** Add a timeout or error state to `renderAnimeGrid()` in `app.js` that renders an offline/error banner with a retry button.

23. **[MAJOR] Desktop Header Dark Mode Toggle Button Unclickable (Desktop)**
    - **File & Lines:** [`webui/index.html:110`](file:///var/lib/antigravity-worker/worktrees/task-t_814aae39-run-1/webui/index.html#L110) & [`webui/app.js:217-220`](file:///var/lib/antigravity-worker/worktrees/task-t_814aae39-run-1/webui/app.js#L217-L220)
    - **Visual Evidence:** Inspection of `t_814aae39-run-1-desktop.png` shows the dark mode toggle button (`#theme-toggle-desktop`) present in the top-right header navigation bar. However, visual interaction testing confirms it produces no effect because JavaScript click handlers are attached only to `#theme-toggle` (mobile).
    - **Suggested Fix:** Attach the theme toggle click listener to `#theme-toggle-desktop` in `app.js`.

24. **[COSMETIC] Low Border Contrast & Asymmetric Spacing on Mobile Banner (Mobile & Desktop)**
    - **File & Lines:** [`webui/index.html:143-162`](file:///var/lib/antigravity-worker/worktrees/task-t_814aae39-run-1/webui/index.html#L143-L162)
    - **Visual Evidence:** In light mode theme (`t_814aae39-run-1-desktop.png` and `t_814aae39-run-1-mobile.png`), the "Welcome Back, Otaku!" card has a very faint white-on-slate background with low border contrast. On mobile view, the "Scheduler Active" status dot wraps below the paragraph with tighter bottom padding relative to the top text margins.
    - **Suggested Fix:** Increase card border contrast in light mode (`border-slate-300`) and adjust mobile vertical padding for balanced layout symmetry.

---

## Summary Findings Count

| Severity | Part A (Code Review) | Part B (Visual QA) | Total |
| :--- | :---: | :---: | :---: |
| **CRITICAL** | 2 | 0 | **2** |
| **MAJOR** | 10 | 2 | **12** |
| **MINOR** | 7 | 0 | **7** |
| **COSMETIC** | 2 | 1 | **3** |
| **TOTAL** | **21** | **3** | **24** |
