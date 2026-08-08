# QA Report: Animu Backend Robustness

## IMPLEMENTATION SUMMARY

Finalizer task t_486ebe96 (branch `antigravity/animu-anilist-discover-base`).
All changes below were implemented by the sibling implementation tasks
(t_9166d018, t_8c6d563f, t_0cb779a4, t_015533f1, t_65a8157e, t_e74331cb,
t_c7571118) and verified end-to-end by this task before committing. File:line
references point at the committed state of this branch.

### 1. Unreachable torrent score threshold (MAJOR)
- `animu/utils.py:311` — EPISODE path: `if score < 3.88:` -> `if score < 3.70:`
- `animu/utils.py:358` — BATCH-with-range path: `if score < 3.88:` -> `if score < 3.70:`
- `animu/utils.py:378` — BATCH-without-range path: `if score < 3.88:` -> `if score < 3.70:`
  (The three verification components cap at 3.0, so the old 3.88 threshold
  required title similarity >= 0.88 — unreachable for valid 70-87% matches.
  3.70 lets an 80%-similarity torrent with episode+resolution+air-date matches
  pass (scores ~3.82) while any missing verification still caps at 3.0 < 3.70.)
- `animu/nyaa.py:235` — `get_best_torrent` early-break gate lowered to 3.70.
- `animu/nyaa.py:238` — `get_best_torrent` final acceptance gate lowered to 3.70.
- `webui/app.js:803` — score badge coloring threshold 3.88 -> 3.70.
- `webui/app.js:810` — "Score below verification threshold" text 3.88 -> 3.70.

### 2. Unsynchronized local cache (MAJOR)
- `animu/database.py:27` — `self._cache_lock = threading.RLock()` on Database.
- `animu/database.py:31-41` — `_load_local_cache()` wrapped in the lock.
- `animu/database.py:43-57` — `_save_local_cache()` wrapped in the lock.
- `animu/database.py:112-143` — `get()` cache reads/writes wrapped in the lock.
- `animu/database.py:144-155` — new `get_cached_record()` accessor returning a
  copy under the lock so external modules (web threads) never touch
  `local_cache` directly.
- `animu/database.py:157-186` — `upsert()` local cache mutation wrapped in lock.
- `animu/database.py:188-222` — `_sync_record_to_pb()` cache writes wrapped in lock.
- `animu/database.py:224-278` — `get_all()` merge + fallback cache reads wrapped in lock.
- `animu/database.py:280-314` — `delete()` cache mutation wrapped in lock.
- `animu/database.py:316-...` — `sync_local_changes()` cache iteration wrapped in lock.
- `animu/web.py:431` — PATCH `/api/anime/<id>` now reads cache via
  `db.get_cached_record(media_id)` instead of `db.local_cache` directly.
  (RLock chosen over plain Lock because `_save_local_cache`/`_load_local_cache`
  are re-entered from already-locked regions; network calls stay outside the lock.)

### 3. Thread-unsafe search trace state (MAJOR)
- `animu/nyaa.py:416` — `_trace_lock = threading.RLock()` guarding
  `active_traces` / `failed_traces`.
- `animu/nyaa.py:419-437` — `record_trace()` mutation wrapped in lock.
- `animu/nyaa.py:440-482` — `record_failed_trace()` read-modify-write wrapped in lock.
- `animu/nyaa.py:484-488` — `remove_failed_trace()` wrapped in lock.
- `animu/nyaa.py:490-532` — new locked helper API: `clear_active_traces()`,
  `clear_failed_traces()`, `has_failed_trace()`, `get_failed_trace()`,
  `get_failed_traces()`, `get_failed_trace_ids()`, `update_failed_trace_timeouts()`.
- `animu/scheduler.py:294-295` — `check()` clears traces via `clear_active_traces()`.
- `animu/scheduler.py:313` — stale-trace pruning uses `get_failed_trace_ids()`.
- `animu/scheduler.py:345` — backoff timeout write uses `update_failed_trace_timeouts()`.
- `animu/web.py:155-156` — `/api/search-debug` serves via `get_failed_traces()`.

### 4. In-place mutation of shared AniList title (MAJOR)
- `animu/scheduler.py:139` — `anime["media"]["title"] = dict(anime["media"]["title"])`
  copies the shared title dict before overriding `romaji` at line 140, so the
  caller's AniList object is never mutated.

### 5. Silent network failure masking (MINOR)
- `animu/anilist.py:78-118` — `get_watching_list()` returns `None` on
  network/GraphQL outage (log line at 109/112) vs `[]` for genuinely empty list.
- `animu/anilist.py:121-180` — `get_anime_user_list()` same treatment
  (log lines at 175/178).
- `animu/scheduler.py:304-307` — `check()` returns early when the list is `None`
  (outage) instead of treating it as "no anime" and pruning state.
- `animu/web.py:87-92` — `get_anime_list()` falls back to `[]` on outage to keep
  the WebUI endpoint contract (200 empty list) intact.

### 6. Config numeric casts (MINOR)
- `animu/config.py:130-140` — `proxy_port`, `interval`, `offpeak_interval` cast
  to int after loading; non-numeric values keep as-is with a warning.

### 7. qBittorrent cookie fallback (MINOR)
- `animu/qbittorrent.py:15-26` — `_extract_sid_from_set_cookie()` parses `SID`
  from the raw `Set-Cookie` header (handles comma-joined multi-cookie headers).
- `animu/qbittorrent.py:40-50` — `_authenticate()` falls back to the header
  parse when the httpx cookie jar misses SID, then stores SID explicitly.

### 8. Nyaa RSS non-numeric seeders (MINOR)
- `animu/nyaa.py:12-30` — `parse_seeders()` safe parser: None/empty/non-numeric
  -> 0; unexpected non-scalar types raise `TypeError` (no silent masking).
- `animu/nyaa.py:109` — RSS item sort by seeders uses `parse_seeders`.
- `animu/nyaa.py:194` — `get_best_torrent` seeder count uses `parse_seeders`.
- `animu/nyaa.py:371` — candidate sort uses `parse_seeders`.
- `animu/scheduler.py:9` — import of `parse_seeders`.
- `animu/scheduler.py:177,233` — seeder sums use `parse_seeders`.

### Regression tests
- `tests/score_threshold_test.py` — new 3-test suite (force-added to index; the
  `.gitignore` `test*` rule ignores new test files): 80%-similarity all-verification
  pass, low-confidence fail, missing-episode-with-good-title fail.
- `tests/test_search_diagnostics.py` — updated to the locked trace API
  (`clear_failed_traces`, `has_failed_trace`, `get_failed_trace`,
  `update_failed_trace_timeouts`).
- `tests/test_web_api.py` — updated imports to the locked trace API.

### Verification (run by this task)
- `python3 -m pytest -q --ignore=tests/test_nyaa_episode_offsets.py`: **11 passed**
  (test_nyaa_episode_offsets.py is a KNOWN gitignored leftover failing 2 — ignored per task).
- `python3 -m compileall animu`: **OK**.
- Scoring smoke: 80%-similarity torrent with episode + resolution + air-date
  matches scored 3.8235 >= 3.70 and was accepted (`verify_query` EPISODE mode).
