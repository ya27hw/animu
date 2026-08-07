# Implementation Summary: Backend Robustness Fixes

All 8 backend robustness findings have been implemented and verified with tests.

## Summary of Changes by File and Line

1. **Unreachable torrent score threshold**:
   - `animu/utils.py:L310-L378`: Set `SCORE_THRESHOLD = 3.70` (lowered from 3.88) so valid 70-87% title similarity matches pass when episode, resolution, and air-date checks match.
   - `animu/nyaa.py:L214,L217`: Lowered threshold to 3.70 in `get_best_torrent`.
   - `webui/app.js:L803,L810` / `src/web/public/app.js:L727,L734` / `src/nyaa/nyaa.ts:L497,L503`: Updated threshold check and UI text to 3.70.

2. **Unsynchronized local cache**:
   - `animu/database.py:L17,L25-L310`: Added `self._lock = threading.RLock()` to `Database` class and wrapped all `local_cache` reads/writes and `_save_local_cache()` operations.

3. **Thread-unsafe search trace state**:
   - `animu/nyaa.py:L12,L407-L469`: Created `trace_lock = threading.Lock()` and wrapped `record_trace`, `record_failed_trace`, and `remove_failed_trace` access.

4. **In-place mutation of shared AniList title**:
   - `animu/scheduler.py:L134`: Added `anime = copy.deepcopy(anime)` in `handle_anime` before overriding title dynamically, preserving caller's shared dictionary.

5. **Silent network failure masking**:
   - `animu/anilist.py:L78-L167`: Updated `get_watching_list` and `get_anime_user_list` to return `None` (and log error) on GraphQL/network errors, distinguishing network outages from an empty watching list.
   - `animu/scheduler.py:L305`: Handled `anime_list is None` in `check()` loop to skip check cycle without clearing/pruning state.
   - `animu/web.py:L86`: Added fallback `anime_list = anilist.get_anime_user_list() or []`.

6. **Config numeric casts**:
   - `animu/config.py:L117`: Cast `proxy_port`, `interval`, `offpeak_interval`, and `id` to `int` during config loading.

7. **qBittorrent cookie fallback**:
   - `animu/qbittorrent.py:L27-L64`: Added regex fallback `re.search(r'SID=([^;]+)', set_cookie)` on `Set-Cookie` header if `client.cookies.get("SID")` is `None` after HTTP 200 login.

8. **Nyaa RSS non-numeric seeders**:
   - `animu/nyaa.py:L14-L19,L83,L170,L361`: Added `safe_int` helper function and replaced direct `int(...)` calls on `nyaa:seeders`.
   - `animu/scheduler.py:L5,L174,L232`: Imported `safe_int` and used it when calculating seeders sums.

## Verification
- `PYTHONPATH=. /home/antigravity-worker/worker/venv/bin/pytest -q`: All 13 unit tests passed cleanly.
- `python3 -m compileall animu tests`: Clean compilation with zero errors.
