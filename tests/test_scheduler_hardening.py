"""Regression tests for the scheduler / data-layer hardening.

Each test pins one weakness found in the scheduler audit: data loss when
PocketBase misbehaves, lost updates between the scheduler and the web UI,
batch over-crediting, back-off that punished infrastructure failures, and a
loop that could skip runs.
"""
import json
import time
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest

from animu.database import Database, DatabaseUnavailable
from animu.models import OfflineAnime
from animu.nyaa import NyaaClient, SearchUnavailable
from animu.scheduler import Scheduler, CycleAborted, ServiceDown


# --------------------------------------------------------------------- helpers

def make_db(tmp_path):
    db = Database()
    db.local_db_path = str(tmp_path / "offline_db.json")
    db.local_cache = {}
    db.local_cache_valid = True
    db._cache_corrupt = False
    db._pb_schema_fields = {"media_id", "preferred_release_group", "release_group_misses", "next_attempt_at"}
    return db


def resp(status=200, payload=None):
    r = MagicMock()
    r.status_code = status
    r.json.return_value = payload if payload is not None else {}
    r.raise_for_status.side_effect = None if status < 400 else RuntimeError(f"HTTP {status}")
    return r


def make_anime(media_id=1, title="Show", progress=0, episodes=12, next_ep=None, **media):
    entry = {
        "mediaId": media_id,
        "progress": progress,
        "media": {
            "id": media_id,
            "title": {"romaji": title},
            "episodes": episodes,
            "coverImage": {"extraLarge": "http://img/x.jpg"},
            **media,
        },
    }
    if next_ep is not None:
        entry["media"]["nextAiringEpisode"] = next_ep
    return entry


# ------------------------------------------------------------- A1: data layer

class TestDatabaseSafety:
    def test_non_200_with_empty_cache_raises_instead_of_returning_nothing(self, tmp_path):
        d = make_db(tmp_path)
        d._request = lambda *a, **kw: resp(500)
        with pytest.raises(DatabaseUnavailable):
            d.get_all()

    def test_non_200_with_cache_falls_back_and_flags_degraded(self, tmp_path):
        d = make_db(tmp_path)
        d.local_cache = {"5": {"media_id": 5, "downloaded_episodes": [1, 2]}}
        d._request = lambda *a, **kw: resp(502)
        records = d.get_all()
        assert [r.media_id for r in records] == [5]
        assert records[0].downloaded_episodes == [1, 2]
        assert d.degraded is True

    def test_corrupt_cache_file_is_never_trusted(self, tmp_path):
        d = make_db(tmp_path)
        d._cache_corrupt = True
        d._request = MagicMock(side_effect=ConnectionError("down"))
        with pytest.raises(DatabaseUnavailable):
            d.get_all()

    def test_lookup_failure_never_creates_a_duplicate_record(self, tmp_path):
        d = make_db(tmp_path)
        calls = []

        def fake(method, path, **kw):
            calls.append(method)
            if path == "/api/collections/anime":
                return resp(200, {"schema": []})
            if method == "GET":
                return resp(500)
            return resp(200, {"id": "x"})

        d._request = fake
        d.upsert(7, OfflineAnime(media_id=7, downloaded_episodes=[1]))
        assert "POST" not in calls
        # progress is kept locally and flagged for the next sync
        assert d.local_cache["7"]["_unsynced"] is True
        assert d.local_cache["7"]["downloaded_episodes"] == [1]

    def test_field_scoped_upsert_does_not_clobber_user_edits(self, tmp_path):
        d = make_db(tmp_path)
        d._request = MagicMock(side_effect=ConnectionError("offline"))
        d.upsert(9, OfflineAnime(media_id=9, alternative_title="Old"))

        # The scheduler loaded the record earlier (alt title "Old") ...
        stale = d.get_local(9)
        # ... the user then edits the title through the web UI ...
        d.update(9, lambda rec: setattr(rec, "alternative_title", "User Title"))
        # ... and the scheduler finally writes only the fields it owns.
        stale.downloaded_episodes = [3]
        stale.set_timeout(30)
        d.upsert(9, stale, fields=("downloaded_episodes", "timeouts", "max_timeouts", "next_attempt_at"))

        final = d.get_local(9)
        assert final.alternative_title == "User Title"
        assert final.downloaded_episodes == [3]
        assert final.max_timeouts == 1

    def test_field_scoped_upsert_never_drops_downloaded_episodes(self, tmp_path):
        d = make_db(tmp_path)
        d._request = MagicMock(side_effect=ConnectionError("offline"))
        d.upsert(4, OfflineAnime(media_id=4, downloaded_episodes=[1, 2, 3]))
        late = OfflineAnime(media_id=4, downloaded_episodes=[4])
        d.upsert(4, late, fields=("downloaded_episodes",))
        assert d.get_local(4).downloaded_episodes == [1, 2, 3, 4]

    def test_local_cache_write_is_atomic_and_compact(self, tmp_path):
        d = make_db(tmp_path)
        d._request = MagicMock(side_effect=ConnectionError("offline"))
        d.upsert(1, OfflineAnime(media_id=1))
        text = (tmp_path / "offline_db.json").read_text()
        assert "\n" not in text  # compact, not indent=2
        assert json.loads(text)["1"]["media_id"] == 1
        assert not list(tmp_path.glob("*.tmp.*"))

    def test_sync_patches_by_cached_id_without_a_lookup(self, tmp_path):
        d = make_db(tmp_path)
        d.local_cache = {"3": {"media_id": 3, "id": "rec3", "_unsynced": True, "downloaded_episodes": [1]}}
        seen = []

        def fake(method, path, **kw):
            seen.append((method, path))
            return resp(200, {"id": "rec3", "media_id": 3, "downloaded_episodes": [1]})

        d._request = fake
        d._sync_record_to_pb(3)
        assert ("PATCH", "/api/collections/anime/records/rec3") in seen
        assert not any(m == "GET" and p.endswith("/records") for m, p in seen)
        assert "_unsynced" not in d.local_cache["3"]

    def test_write_during_sync_keeps_newer_local_data(self, tmp_path):
        d = make_db(tmp_path)
        d.local_cache = {"3": {"media_id": 3, "id": "rec3", "_unsynced": True, "downloaded_episodes": [1]}}

        def fake(method, path, **kw):
            # a second writer lands while the PATCH is in flight
            d.upsert_nosync = None
            with d._lock:
                d.local_cache["3"]["downloaded_episodes"] = [1, 2]
                d._bump_rev("3")
            return resp(200, {"id": "rec3", "media_id": 3, "downloaded_episodes": [1]})

        d._request = fake
        d._sync_record_to_pb(3)
        assert d.local_cache["3"]["downloaded_episodes"] == [1, 2]

    def test_circuit_breaker_stops_hammering_a_dead_server(self, tmp_path):
        d = make_db(tmp_path)
        d.token = "t"
        d.client = MagicMock()
        d.client.request.side_effect = ConnectionError("refused")
        for _ in range(3):
            with pytest.raises(ConnectionError):
                d._request("GET", "/x")
        before = d.client.request.call_count
        with pytest.raises(DatabaseUnavailable):
            d._request("GET", "/x")
        assert d.client.request.call_count == before


# --------------------------------------------------------- A2: back-off model

class TestBackoff:
    def test_back_off_doubles_and_caps(self):
        rec = OfflineAnime(media_id=1)
        waits = []
        for _ in range(12):
            rec.set_timeout(30, now=1000.0, jitter=0)
            waits.append(round((rec.next_attempt_at - 1000.0) / 60))
        assert waits[:4] == [30, 60, 120, 240]
        assert max(waits) == 480
        assert rec.max_timeouts == 10  # failure count caps

    def test_reset_clears_everything(self):
        rec = OfflineAnime(media_id=1)
        rec.set_timeout(30)
        rec.reset_timeout()
        assert (rec.timeouts, rec.max_timeouts, rec.next_attempt_at) == (0, 0, 0.0)
        assert rec.is_due()

    def test_not_due_until_window_elapses(self):
        rec = OfflineAnime(media_id=1)
        rec.set_timeout(30, now=1000.0, jitter=0)
        assert not rec.is_due(now=1000.0 + 29 * 60)
        assert rec.is_due(now=1000.0 + 30 * 60)


# -------------------------------------------------------- A3: download safety

class TestDownloads:
    def _anime(self):
        return make_anime(1, "Show", episodes=12)

    def test_progress_is_persisted_after_every_add(self):
        s = Scheduler()
        rec = OfflineAnime(media_id=1)
        persisted = []
        torrents = [
            {"title": "t1", "link": "l1", "episode": 1},
            {"title": "t2", "link": "l2", "episode": 2},
        ]
        calls = {"n": 0}

        def add(**kw):
            calls["n"] += 1
            if calls["n"] == 2:
                raise RuntimeError("boom")
            return True

        with patch("animu.scheduler.qbit") as q, \
             patch("animu.scheduler.nyaa") as ny, \
             patch("animu.scheduler.history_manager.add_entry"), \
             patch("animu.scheduler.send_anime_downloaded_hook"), \
             patch("animu.scheduler.db.upsert", side_effect=lambda mid, r, **kw: persisted.append(list(r.downloaded_episodes))):
            ny.should_use_proxy_download.return_value = False
            q.add_check_torrent.side_effect = add
            q.last_add_was_duplicate = False
            q.last_add_existing = None
            with pytest.raises(RuntimeError):
                s.download_torrents(self._anime(), rec, torrents)

        # Episode 1 was saved before episode 2 blew up.
        assert [1] in persisted
        assert rec.downloaded_episodes == [1]

    def test_existing_torrent_at_zero_progress_is_not_a_failure(self):
        s = Scheduler()
        rec = OfflineAnime(media_id=1)
        with patch("animu.scheduler.qbit") as q, \
             patch("animu.scheduler.nyaa") as ny, \
             patch("animu.scheduler.alert_user") as alert, \
             patch("animu.scheduler.history_manager.add_entry") as hist, \
             patch("animu.scheduler.db.upsert"):
            ny.should_use_proxy_download.return_value = False
            q.add_check_torrent.return_value = False
            q.last_add_was_duplicate = False
            q.last_add_existing = {"hash": "ab", "state": "queuedDL", "progress": 0.0}
            result = s.download_torrents(self._anime(), rec, [{"title": "t", "link": "l", "episode": 3}])
        assert result == [3]
        assert 3 in rec.downloaded_episodes
        alert.assert_not_called()
        hist.assert_not_called()
        assert rec.max_timeouts == 0

    def test_existing_torrent_with_missing_files_is_still_a_failure(self):
        s = Scheduler()
        rec = OfflineAnime(media_id=1)
        with patch("animu.scheduler.qbit") as q, \
             patch("animu.scheduler.nyaa") as ny, \
             patch("animu.scheduler.alert_user"), \
             patch("animu.scheduler.db.upsert"):
            ny.should_use_proxy_download.return_value = False
            q.add_check_torrent.return_value = False
            q.check_torrent_episode.return_value = False
            q.last_add_was_duplicate = False
            q.last_add_existing = {"hash": "ab", "state": "missingFiles", "progress": 0.0}
            result = s.download_torrents(self._anime(), rec, [{"title": "t", "link": "l", "episode": 3}])
        assert result is None
        assert rec.max_timeouts == 1

    def test_repeated_qbit_failures_abort_the_cycle(self):
        s = Scheduler()
        with patch("animu.scheduler.qbit") as q, \
             patch("animu.scheduler.nyaa") as ny, \
             patch("animu.scheduler.alert_user"), \
             patch("animu.scheduler.db.upsert"):
            ny.should_use_proxy_download.return_value = False
            q.add_check_torrent.return_value = False
            q.check_torrent_episode.return_value = False
            q.last_add_was_duplicate = False
            q.last_add_existing = None
            with pytest.raises(ServiceDown):
                for i in range(5):
                    s.download_torrents(self._anime(), OfflineAnime(media_id=1), [{"title": "t", "link": "l", "episode": 1}])

    def test_batch_credits_only_the_range_it_covers(self):
        s = Scheduler()
        rec = OfflineAnime(media_id=1)
        with patch("animu.scheduler.qbit") as q, \
             patch("animu.scheduler.nyaa") as ny, \
             patch("animu.scheduler.history_manager.add_entry"), \
             patch("animu.scheduler.send_anime_downloaded_hook"), \
             patch("animu.scheduler.db.upsert"):
            ny.should_use_proxy_download.return_value = False
            q.add_check_torrent.return_value = True
            q.last_add_was_duplicate = False
            q.last_add_existing = None
            s.download_torrents(self._anime(), rec, [{"title": "Show 01-06", "link": "l", "episode": None,
                                                      "batch_episodes": [1, 2, 3, 4, 5, 6]}])
        assert rec.downloaded_episodes == [1, 2, 3, 4, 5, 6]

    def test_batch_range_parsing(self):
        assert NyaaClient._batch_episodes("[Grp] Show (01-12) [BD]", 12) == list(range(1, 13))
        assert NyaaClient._batch_episodes("[Grp] Show - 05", 12) is None
        assert NyaaClient._batch_episodes("[Grp] Show (1080p)", 12) is None

    def test_single_episode_release_is_not_a_batch(self):
        from animu.utils import verify_query
        import anitopy
        parsed = anitopy.parse("[SubsPlease] Show - 05 (1080p) [ABCD1234].mkv")
        score, details = verify_query(
            "Show", parsed, "1080", "BATCH", "Sat, 18 May 2026 10:00:00 GMT",
            {"nodes": [{"episode": 1, "airingAt": 1747560000}]}, True, 0, 12, verbose=True,
        )
        assert details["is_batch"] is False

    def test_a_release_with_no_episode_number_still_counts_as_a_batch(self):
        from animu.utils import verify_query
        import anitopy
        parsed = anitopy.parse("[Grp] Show (BD 1080p HEVC) [Batch]")
        score, details = verify_query(
            "Show", parsed, "1080", "BATCH", "Sat, 18 May 2026 10:00:00 GMT",
            {"nodes": []}, True, 0, 12, verbose=True,
        )
        assert details["is_batch"] is True


# --------------------------------------------------- A2/A7: search vs not-found

def _handle(s, anime, rec, torrents=None, raises=None):
    with patch("animu.scheduler.nyaa.get_torrents", side_effect=raises, return_value=torrents) as gt, \
         patch("animu.scheduler.qbit") as q, \
         patch("animu.scheduler.db.upsert"), \
         patch("animu.scheduler.time.sleep"), \
         patch("animu.scheduler.alert_unresolved_anime"), \
         patch("animu.scheduler.count_past_relations", return_value={"episodeOffset": 0, "seasonCount": 1}), \
         patch("animu.nyaa.record_failed_trace"), \
         patch("animu.nyaa.remove_failed_trace"):
        q.check_episodes_in_batch.return_value = []
        q.check_torrent_episode.return_value = False
        s.handle_anime(anime, rec)
        return gt


class TestNotFoundVsError:
    def test_nyaa_outage_does_not_burn_backoff(self):
        s = Scheduler()
        rec = OfflineAnime(media_id=1, alternative_title="Show")
        _handle(s, make_anime(1, progress=0), rec, raises=SearchUnavailable("nyaa down"))
        assert rec.max_timeouts == 0
        assert rec.next_attempt_at == 0.0
        assert s.anime_state[1]["status"] == "search_error"

    def test_genuine_miss_backs_off(self):
        s = Scheduler()
        rec = OfflineAnime(media_id=1, alternative_title="Show")
        _handle(s, make_anime(1, progress=0), rec, torrents=None)
        assert rec.max_timeouts == 1
        assert rec.next_attempt_at > time.time()

    def test_freshly_aired_episode_is_retried_soon_without_escalating(self):
        s = Scheduler()
        rec = OfflineAnime(media_id=1, alternative_title="Show", downloaded_episodes=[1, 2])
        # episode 3 aired ~1h ago: the next one is due in 7d - 1h
        anime = make_anime(1, progress=2, episodes=12, status="RELEASING",
                           next_ep={"episode": 4, "timeUntilAiring": 7 * 86400 - 3600})
        _handle(s, anime, rec, torrents=None)
        assert rec.max_timeouts == 0, "a fresh release must not count as a failure"
        assert 0 < rec.next_attempt_at - time.time() <= 10 * 60 + 5
        assert s.anime_state[1]["status"] == "waiting_release"

    def test_partial_results_back_off_for_the_missing_episode(self):
        s = Scheduler()
        rec = OfflineAnime(media_id=1, alternative_title="Show")
        found = [{"title": "t", "link": "l", "episode": 1, "nyaa:seeders": "5"}]
        anime = make_anime(1, progress=0, episodes=3, status="RELEASING",
                           next_ep={"episode": 4, "timeUntilAiring": 3 * 86400})

        def fake_download(a, r, torrents):
            r.downloaded_episodes = [1]
            return [1]

        s.download_torrents = fake_download
        with patch("animu.scheduler.db.upsert"):
            _handle(s, anime, rec, torrents=found)
        assert rec.max_timeouts == 1, "episodes 2-3 were not found and must not be re-searched every cycle"

    def test_complete_pass_resets_failure_state(self):
        s = Scheduler()
        rec = OfflineAnime(media_id=1, alternative_title="Show")
        rec.set_timeout(30)
        rec.next_attempt_at = 0.0
        found = [{"title": "t", "link": "l", "episode": 1, "nyaa:seeders": "5"}]
        anime = make_anime(1, progress=0, episodes=1, status="RELEASING",
                           next_ep={"episode": 2, "timeUntilAiring": 3 * 86400})

        def fake_download(a, r, torrents):
            r.downloaded_episodes = [1]
            return [1]

        s.download_torrents = fake_download
        _handle(s, anime, rec, torrents=found)
        assert (rec.max_timeouts, rec.next_attempt_at) == (0, 0.0)

    def test_up_to_date_anime_forgets_old_failures(self):
        s = Scheduler()
        rec = OfflineAnime(media_id=1, alternative_title="Show", downloaded_episodes=[1])
        for _ in range(6):
            rec.set_timeout(30)
        anime = make_anime(1, progress=0, episodes=1, status="RELEASING",
                           next_ep={"episode": 2, "timeUntilAiring": 3 * 86400})
        _handle(s, anime, rec, torrents=None)
        assert rec.max_timeouts == 0


# ------------------------------------------------------------ A4: check() flow

class CheckHarness:
    def __init__(self, entries, records=None, degraded=False, user_list_none=False):
        self.entries = entries
        self.records = records or []
        self.degraded = degraded
        self.user_list_none = user_list_none

    def run(self, scheduler=None):
        s = scheduler or Scheduler()
        handled = []
        self.upserts = []
        fake_db = SimpleNamespace(
            sync_local_changes=lambda: None,
            get_all=lambda: self.records,
            upsert=lambda mid, rec, **kw: self.upserts.append(mid),
            degraded=self.degraded,
        )
        with patch("animu.scheduler.db", fake_db), \
             patch("animu.scheduler.anilist.get_anime_user_list",
                   return_value=None if self.user_list_none else self.entries), \
             patch("animu.scheduler.qbit"), \
             patch("animu.scheduler.time.sleep"), \
             patch.object(Scheduler, "handle_anime", lambda self_, a, r: handled.append(a["mediaId"])):
            result = s.check()
        self.handled = handled
        return result


class TestCheck:
    def test_malformed_entry_is_skipped_not_fatal(self):
        good = make_anime(2, "Good", progress=0, episodes=2)
        bad = {"mediaId": 1, "progress": 0, "media": None}
        h = CheckHarness([bad, good], records=[OfflineAnime(media_id=1), OfflineAnime(media_id=2)])
        result = h.run()
        assert h.handled == [2]
        assert len(result.failed) == 1

    def test_anilist_failure_aborts_the_cycle_instead_of_reporting_success(self):
        h = CheckHarness([], user_list_none=True)
        with pytest.raises(CycleAborted):
            h.run()

    def test_degraded_database_never_creates_blank_records(self):
        entry = make_anime(5, "New", progress=0, episodes=2)
        h = CheckHarness([entry], records=[], degraded=True)
        h.run()
        assert h.upserts == [], "a lookup failure must not be written back as an empty record"
        assert h.handled == []

    def test_healthy_database_creates_a_record_for_a_new_anime(self):
        entry = make_anime(5, "New", progress=0, episodes=2)
        h = CheckHarness([entry], records=[], degraded=False)
        h.run()
        assert h.upserts == [5]
        assert h.handled == [5]

    def test_backing_off_anime_costs_no_writes_and_is_skipped(self):
        rec = OfflineAnime(media_id=3)
        rec.set_timeout(30)
        h = CheckHarness([make_anime(3, progress=0, episodes=2)], records=[rec])
        result = h.run()
        assert h.handled == []
        assert h.upserts == []
        assert result.backing_off == 1

    def test_legacy_countdown_is_converted_once(self):
        rec = OfflineAnime(media_id=3, timeouts=2)  # old schema: skip N cycles
        h = CheckHarness([make_anime(3, progress=0, episodes=2)], records=[rec])
        result = h.run()
        assert rec.next_attempt_at > time.time()
        assert result.backing_off == 1

    def test_anime_with_everything_downloaded_is_up_to_date(self):
        rec = OfflineAnime(media_id=3, downloaded_episodes=[1, 2])
        h = CheckHarness([make_anime(3, progress=0, episodes=2)], records=[rec])
        result = h.run()
        assert h.handled == []
        assert result.up_to_date == 1

    def test_service_outage_cuts_the_cycle_short(self):
        s = Scheduler()
        entries = [make_anime(i, f"S{i}", progress=0, episodes=2) for i in (1, 2, 3)]
        recs = [OfflineAnime(media_id=i) for i in (1, 2, 3)]
        order = []

        def boom(self_, anime, record):
            order.append(anime["mediaId"])
            raise ServiceDown("qBittorrent")

        fake_db = SimpleNamespace(sync_local_changes=lambda: None, get_all=lambda: recs,
                                  upsert=lambda *a, **k: None, degraded=False)
        with patch("animu.scheduler.db", fake_db), \
             patch("animu.scheduler.anilist.get_anime_user_list", return_value=entries), \
             patch("animu.scheduler.qbit"), patch("animu.scheduler.time.sleep"), \
             patch.object(Scheduler, "handle_anime", boom):
            result = s.check()
        assert order == [1], "remaining anime must not be attempted against a dead service"
        assert result.aborted == "qBittorrent unavailable"


# ------------------------------------------------------------- A6: loop timing

class TestLoopTiming:
    def test_interval_of_an_hour_or_more_still_runs_every_interval(self):
        s = Scheduler()
        s._last_start = 1_000_000.0
        with patch.object(Scheduler, "get_cycle_interval_seconds", return_value=3600 * 2), \
             patch.object(Scheduler, "_next_airing_wake", return_value=None):
            assert s._compute_next_run(1_000_100.0) == 1_000_000.0 + 7200

    def test_pending_retry_pulls_the_next_run_earlier(self):
        s = Scheduler()
        s._last_start = 1_000_000.0
        s._earliest_retry = 1_000_000.0 + 900
        with patch.object(Scheduler, "get_cycle_interval_seconds", return_value=1800), \
             patch.object(Scheduler, "_next_airing_wake", return_value=None):
            assert s._compute_next_run(1_000_100.0) == 1_000_000.0 + 900

    def test_never_runs_more_often_than_the_minimum_gap(self):
        s = Scheduler()
        s._last_start = 1_000_000.0
        s._earliest_retry = 1_000_000.0 + 30
        with patch.object(Scheduler, "get_cycle_interval_seconds", return_value=1800), \
             patch.object(Scheduler, "_next_airing_wake", return_value=None):
            assert s._compute_next_run(1_000_010.0) >= 1_000_000.0 + 300

    def test_known_air_time_wakes_the_loop(self):
        s = Scheduler()
        s._last_start = 1_000_000.0
        with patch.object(Scheduler, "get_cycle_interval_seconds", return_value=1800), \
             patch.object(Scheduler, "_next_airing_wake", return_value=1_000_000.0 + 600):
            assert s._compute_next_run(1_000_100.0) == 1_000_000.0 + 600

    def test_overlapping_trigger_is_refused(self):
        s = Scheduler()
        assert s._cycle_lock.acquire(blocking=False)
        try:
            assert s.request_run() is False
        finally:
            s._cycle_lock.release()

    def test_stop_ends_the_loop(self):
        s = Scheduler()
        ran = []
        s._run_cycle = lambda: (ran.append(1), s.stop())
        with patch("animu.scheduler.readiness"), patch.object(Scheduler, "_install_signal_handlers"):
            s.run_loop()
        assert ran == [1], "the loop must run once immediately on boot, then stop"


# --------------------------------------------------------------- misc modules

class TestAirScheduleStatus:
    def test_not_yet_released_has_aired_nothing(self, tmp_path):
        from animu import airschedule
        anime = make_anime(1, status="NOT_YET_RELEASED", episodes=12)
        assert airschedule.aired_episodes(anime) == 0

    def test_releasing_without_next_airing_does_not_assume_everything_aired(self, tmp_path):
        from animu import airschedule
        anime = make_anime(1, status="RELEASING", episodes=12)
        with patch.object(airschedule, "STORE_PATH", str(tmp_path / "air.json")):
            assert airschedule.aired_episodes(anime) == 0

    def test_finished_show_uses_its_episode_count(self, tmp_path):
        from animu import airschedule
        anime = make_anime(1, status="FINISHED", episodes=12)
        with patch.object(airschedule, "STORE_PATH", str(tmp_path / "air.json")):
            assert airschedule.aired_episodes(anime) == 12


class TestIgnoredMatching:
    def test_short_title_does_not_ignore_unrelated_shows(self):
        from animu.ignored import IgnoredManager
        m = IgnoredManager.__new__(IgnoredManager)
        import threading
        m._lock = threading.RLock()
        m.items = [{"id": "1", "title": "Gin", "media_id": None}]
        assert m.is_ignored("Gintama") is False
        m.items = [{"id": "1", "title": "Bleach", "media_id": None}]
        assert m.is_ignored("Bleach: Thousand-Year Blood War") is True
        assert m.is_ignored("Bleachers") is False

    def test_partial_title_on_word_boundary_still_matches(self):
        from animu.ignored import IgnoredManager
        import threading
        m = IgnoredManager.__new__(IgnoredManager)
        m._lock = threading.RLock()
        m.items = [{"id": "1", "title": "Frieren", "media_id": None}]
        assert m.is_ignored("Sousou no Frieren") is True
        assert m.is_ignored("Frieren: Beyond Journey's End") is True


class TestRelations:
    def test_failure_is_none_not_season_zero(self):
        from animu import utils
        utils._relations_cache.clear()
        with patch("animu.anilist.anilist.get_previous_relations", return_value=None):
            assert utils.count_past_relations(111) is None

    def test_standalone_show_is_season_one(self):
        from animu import utils
        utils._relations_cache.clear()
        with patch("animu.anilist.anilist.get_previous_relations", return_value=[]):
            assert utils.count_past_relations(112) == {"episodeOffset": 0, "seasonCount": 1}

    def test_result_is_cached(self):
        from animu import utils
        utils._relations_cache.clear()
        with patch("animu.anilist.anilist.get_previous_relations", return_value=[]) as g:
            utils.count_past_relations(113)
            utils.count_past_relations(113)
        assert g.call_count == 1

    def test_prequel_chain_accumulates(self):
        from animu import utils
        utils._relations_cache.clear()
        chain = {
            30: [{"relationType": "PREQUEL", "node": {"id": 20, "episodes": 12}}],
            20: [{"relationType": "PREQUEL", "node": {"id": 10, "episodes": 13}}],
            10: [{"relationType": "SEQUEL", "node": {"id": 20, "episodes": 12}}],
        }
        with patch("animu.anilist.anilist.get_previous_relations", side_effect=lambda mid: chain[mid]):
            assert utils.count_past_relations(30) == {"episodeOffset": 25, "seasonCount": 3}


class TestStorage:
    def test_atomic_write_leaves_no_temp_file_and_survives_failure(self, tmp_path):
        from animu.storage import atomic_write_json
        target = tmp_path / "x.json"
        atomic_write_json(str(target), {"a": 1})
        assert json.loads(target.read_text()) == {"a": 1}

        class Boom:
            pass

        with pytest.raises(TypeError):
            atomic_write_json(str(target), {"a": Boom()})
        assert json.loads(target.read_text()) == {"a": 1}, "a failed write must not corrupt the old file"
        assert not list(tmp_path.glob("*.tmp.*"))


class TestHistoryManager:
    def test_history_is_capped_and_newest_first(self, tmp_path, monkeypatch):
        from animu import history
        monkeypatch.setattr(history, "HISTORY_FILE", str(tmp_path / "h.json"))
        monkeypatch.setattr(history, "ANIMU_LOG_FILE", str(tmp_path / "none.log"))
        monkeypatch.setattr(history, "MAX_HISTORY_ENTRIES", 5)
        mgr = history.HistoryManager()
        for i in range(8):
            mgr.add_entry(title=f"t{i}", link="l")
        titles = [x["title"] for x in mgr.get_all()]
        assert titles == ["t7", "t6", "t5", "t4", "t3"]
        assert [x["title"] for x in mgr.get_all(limit=2, offset=1)] == ["t6", "t5"]


class TestReadiness:
    def test_degraded_cycle_keeps_service_ready(self):
        from animu import readiness
        readiness.reset()
        readiness.mark_database(authenticated=True, offline_safe_mode=False)
        readiness.mark_scheduler_initialized()
        readiness.mark_scheduler_running(True)
        readiness.mark_cycle_started()
        readiness.mark_cycle_stats({"downloaded_episodes": 2})
        readiness.mark_cycle_completed(success=True, degraded=True)
        snap = readiness.health_snapshot()
        assert snap["ready"] is True
        assert snap["degraded"] is True
        assert snap["cycle"]["downloaded_episodes"] == 2
        readiness.reset()

    def test_event_feed_is_newest_first_and_bounded(self):
        from animu import readiness
        readiness.reset()
        for i in range(250):
            readiness.record_event("info", f"e{i}")
        events = readiness.get_events(5)
        assert [e["message"] for e in events] == ["e249", "e248", "e247", "e246", "e245"]
        assert len(readiness.get_events(1000)) == 200
        readiness.reset()


class TestHealthStartupGrace:
    def _boot(self):
        from animu import readiness
        readiness.reset()
        readiness.mark_database(authenticated=True, offline_safe_mode=False)
        readiness.mark_scheduler_initialized()
        readiness.mark_scheduler_running(True)
        return readiness

    def test_fresh_boot_is_ready_before_the_first_cycle_finishes(self):
        r = self._boot()
        r.mark_cycle_started()
        snap = r.health_snapshot()
        assert snap["ready"] is True and snap["starting"] is True
        r.reset()

    def test_failed_first_cycle_is_not_ready(self):
        r = self._boot()
        r.mark_cycle_started()
        r.mark_cycle_completed(success=False, error=RuntimeError("boom"))
        assert r.health_snapshot()["ready"] is False
        r.reset()

    def test_grace_expires_without_a_successful_cycle(self):
        from datetime import datetime, timedelta, timezone
        r = self._boot()
        later = datetime.now(timezone.utc) + timedelta(seconds=r.get_stale_threshold() + 5)
        assert r.health_snapshot(now=later)["ready"] is False
        r.reset()


class TestReviewFixes:
    def test_overrunning_cycle_still_waits_the_minimum_gap(self):
        s = Scheduler()
        s._last_start = 1_000_000.0
        with patch.object(Scheduler, "get_cycle_interval_seconds", return_value=1800), \
             patch.object(Scheduler, "_next_airing_wake", return_value=None):
            finished = 1_000_000.0 + 2400  # took 40 min on a 30 min interval
            assert s._compute_next_run(finished) >= finished + 300

    def test_air_time_wakes_only_for_watched_shows(self, tmp_path):
        from animu import airschedule
        from datetime import datetime, timedelta, timezone
        soon = (datetime.now(timezone.utc) + timedelta(minutes=20)).strftime("%Y-%m-%dT%H:%M:%SZ")
        store = tmp_path / "air.json"
        store.write_text(json.dumps({"1": {"air_at": soon}, "2": {"air_at": soon}}))
        s = Scheduler()
        s._watched_ids = {1}
        with patch.object(airschedule, "STORE_PATH", str(store)):
            assert s._next_airing_wake(time.time()) is not None
            s._watched_ids = {99}
            assert s._next_airing_wake(time.time()) is None

    def test_corrupt_flag_clears_once_a_good_file_is_written(self, tmp_path):
        d = make_db(tmp_path)
        d._cache_corrupt = True
        d.local_cache = {"1": {"media_id": 1}}
        d._save_local_cache()
        assert d._cache_corrupt is False

    def test_qbit_snapshot_is_invalidated_by_delete_and_recheck(self):
        from animu.qbittorrent import QbitClient
        q = QbitClient()
        with q.snapshot():
            for name in ("delete_torrent", "recheck_torrent", "resume_torrent", "delete_torrent_by_hash"):
                q._torrent_snapshot = {"animu": [{"name": "x"}]}
                with patch.object(q, "_ensure_auth", return_value=False):
                    getattr(q, name)("abc")
                assert q._torrent_snapshot == {}, name

    def test_rate_limiter_queues_concurrent_waiters(self):
        from animu.anilist_auth import _RateLimiter
        waits = []
        rl = _RateLimiter(burst=1, per_second=1.0)
        rl.enabled = True
        rl._tokens = 0.0
        with patch("animu.anilist_auth.threading.Event") as ev:
            ev.return_value.wait.side_effect = lambda t: waits.append(t)
            rl.acquire()
            rl.acquire()
        assert waits[1] > waits[0], "the second caller must wait longer than the first"
