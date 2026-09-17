"""Tests for cached air schedule fallback (animu/airschedule.py, animu/anilist.py, animu/scheduler.py).

Verifies acceptance criteria 1-6:
1. Fresh AniList data -> aired_episodes() returns exactly today's value.
2. Cached payload whose air time has passed -> extrapolated +1 at air time, +2 after 7 days, +3 after 14 days.
3. Extrapolation never exceeds media.episodes when positive int.
4. Finished shows and unanchored media fall back to payload value.
5. Missing/corrupt store file -> no crash, payload value returned, recording works afterwards.
6. Scheduler end-to-end selection path treats stale-payload episode as due when air time passed.
"""
import io
import json
import os
import sys
import tempfile
import unittest
from datetime import datetime, timezone, timedelta
from unittest.mock import MagicMock, patch

import animu.airschedule as airschedule
from animu.airschedule import (
    aired_episodes,
    estimate_aired,
    record_from_media_list,
    EPISODE_INTERVAL_DAYS,
    RETENTION_DAYS,
)
from animu.models import OfflineAnime


class TestAirSchedule(unittest.TestCase):
    def setUp(self):
        self.tmp_dir = tempfile.TemporaryDirectory()
        self.store_path = os.path.join(self.tmp_dir.name, "air_schedule.json")
        self.orig_store_path = airschedule.STORE_PATH
        airschedule.STORE_PATH = self.store_path
        airschedule._corrupt_logged_paths.clear()

    def tearDown(self):
        airschedule.STORE_PATH = self.orig_store_path
        airschedule._corrupt_logged_paths.clear()
        self.tmp_dir.cleanup()

    # -------------------------------------------------------------------------
    # Criterion 1: Fresh AniList data -> aired_episodes() returns exactly today's value
    # -------------------------------------------------------------------------
    def test_fresh_anilist_data_returns_exact_payload_value(self):
        """When AniList data is fresh (air time is in the future), aired_episodes returns

        payload value (next_ep.episode - 1) and does NOT print an offline extrapolation message.
        """
        now = datetime(2026, 9, 15, 12, 0, 0, tzinfo=timezone.utc)
        anime = {
            "mediaId": 101,
            "progress": 2,
            "media": {
                "id": 101,
                "title": {"romaji": "Dungeon Meshi"},
                "episodes": 24,
                "nextAiringEpisode": {
                    "episode": 4,
                    "timeUntilAiring": 7200,  # 2 hours in the future
                },
            },
        }

        # Record fresh anchor
        record_from_media_list([anime], now=now)

        # Call aired_episodes before air time
        stdout_capture = io.StringIO()
        with patch("sys.stdout", stdout_capture):
            aired = aired_episodes(anime, now=now)

        # Expected today's value: nextAiringEpisode.episode - 1 = 3
        self.assertEqual(aired, 3)
        self.assertNotIn("[OFFLINE]", stdout_capture.getvalue())

    # -------------------------------------------------------------------------
    # Criterion 2: Cached payload whose air time has passed -> +1, +2, +3
    # -------------------------------------------------------------------------
    def test_extrapolated_episodes_plus_one_two_three(self):
        """Cached payload with air time in the past extrapolates:

        +1 at/after air time, +2 after 7 days, +3 after 14 days.
        Also verifies the [OFFLINE] log message format.
        """
        record_time = datetime(2026, 9, 1, 12, 0, 0, tzinfo=timezone.utc)
        air_at = record_time + timedelta(hours=2)  # 2026-09-01 14:00:00 UTC

        anime = {
            "mediaId": 202,
            "media": {
                "title": {"romaji": "Oshi no Ko"},
                "episodes": 24,
                "nextAiringEpisode": {
                    "episode": 5,
                    "timeUntilAiring": 7200,
                },
            },
        }
        record_from_media_list([anime], now=record_time)
        payload_value = 4  # nextAiringEpisode.episode - 1

        # Before air time -> payload value (4)
        t_before = air_at - timedelta(minutes=5)
        self.assertEqual(aired_episodes(anime, now=t_before), payload_value)

        # At / slightly after air time -> +1 (episode 5)
        t_at_air = air_at
        stdout_capture = io.StringIO()
        with patch("sys.stdout", stdout_capture):
            aired_at = aired_episodes(anime, now=t_at_air)
        self.assertEqual(aired_at, 5)
        self.assertIn(
            "[OFFLINE] Oshi no Ko: cached air schedule says episode 5 has aired "
            "(AniList data last confirmed 2026-09-01T12:00:00Z)",
            stdout_capture.getvalue(),
        )

        # 6 days after air time -> still episode 5
        t_plus_6d = air_at + timedelta(days=6, hours=23)
        self.assertEqual(aired_episodes(anime, now=t_plus_6d), 5)

        # 7 days after air time -> +2 (episode 6)
        t_plus_7d = air_at + timedelta(days=7)
        self.assertEqual(aired_episodes(anime, now=t_plus_7d), 6)

        # 14 days after air time -> +3 (episode 7)
        t_plus_14d = air_at + timedelta(days=14)
        self.assertEqual(aired_episodes(anime, now=t_plus_14d), 7)

    # -------------------------------------------------------------------------
    # Criterion 3: Extrapolation never exceeds media.episodes when positive int
    # -------------------------------------------------------------------------
    def test_extrapolation_capped_by_total_episodes(self):
        """Extrapolation never exceeds total_episodes when positive int."""
        record_time = datetime(2026, 8, 1, 0, 0, 0, tzinfo=timezone.utc)
        anime = {
            "mediaId": 303,
            "media": {
                "title": {"romaji": "Short Anime"},
                "episodes": 6,  # total episodes capped at 6
                "nextAiringEpisode": {
                    "episode": 5,
                    "timeUntilAiring": 0,
                },
            },
        }
        record_from_media_list([anime], now=record_time)

        # 10 weeks later -> 5 + 10 = 15, but must be capped at 6
        t_later = record_time + timedelta(weeks=10)
        self.assertEqual(aired_episodes(anime, now=t_later), 6)
        self.assertEqual(estimate_aired(303, now=t_later, total_episodes=6), 6)

        # If total_episodes is None / 0, it should not be capped
        anime_uncapped = {
            "mediaId": 304,
            "media": {
                "title": {"romaji": "Ongoing Long Anime"},
                "episodes": None,
                "nextAiringEpisode": {
                    "episode": 100,
                    "timeUntilAiring": 0,
                },
            },
        }
        record_from_media_list([anime_uncapped], now=record_time)
        self.assertEqual(aired_episodes(anime_uncapped, now=t_later), 110)

    # -------------------------------------------------------------------------
    # Criterion 4: Finished shows and unanchored media fall back to payload value
    # -------------------------------------------------------------------------
    def test_finished_and_unanchored_shows_unchanged(self):
        """Finished shows (no nextAiringEpisode) and media without an anchor fall

        back to the payload value unchanged.
        """
        now = datetime(2026, 9, 15, 12, 0, 0, tzinfo=timezone.utc)

        # Finished show (no nextAiringEpisode)
        finished_anime = {
            "mediaId": 401,
            "media": {
                "title": {"romaji": "Finished Classic"},
                "episodes": 26,
                "nextAiringEpisode": None,
            },
        }
        self.assertEqual(aired_episodes(finished_anime, now=now), 26)

        # Finished show with no episodes count
        finished_zero = {
            "mediaId": 402,
            "media": {
                "title": {"romaji": "Unknown Count Classic"},
                "episodes": None,
                "nextAiringEpisode": None,
            },
        }
        self.assertEqual(aired_episodes(finished_zero, now=now), 0)

        # Unanchored releasing show
        unanchored_anime = {
            "mediaId": 403,
            "media": {
                "title": {"romaji": "Never Recorded"},
                "episodes": 12,
                "nextAiringEpisode": {
                    "episode": 3,
                    "timeUntilAiring": 100,
                },
            },
        }
        # No anchor in store
        self.assertIsNone(estimate_aired(403, now=now))
        self.assertEqual(aired_episodes(unanchored_anime, now=now), 2)

    # -------------------------------------------------------------------------
    # Criterion 5: Missing / corrupt store file -> no crash, recording works
    # -------------------------------------------------------------------------
    def test_missing_and_corrupt_store_tolerated(self):
        """Missing or corrupt store file causes no crash, returns payload value,

        and recording works afterwards.
        """
        now = datetime(2026, 9, 15, 12, 0, 0, tzinfo=timezone.utc)
        anime = {
            "mediaId": 501,
            "media": {
                "title": {"romaji": "Resilient Anime"},
                "episodes": 12,
                "nextAiringEpisode": {
                    "episode": 2,
                    "timeUntilAiring": 3600,
                },
            },
        }

        # Case A: Missing file
        if os.path.exists(self.store_path):
            os.remove(self.store_path)
        self.assertEqual(aired_episodes(anime, now=now), 1)

        # Case B: Corrupt JSON file
        with open(self.store_path, "w", encoding="utf-8") as f:
            f.write("{this is not valid json! Corrupted data...##")

        stdout_capture = io.StringIO()
        with patch("sys.stdout", stdout_capture):
            # First read with corrupt file -> logs once, returns payload value
            aired1 = aired_episodes(anime, now=now)
            # Second read -> still works, does not re-log corrupt warning
            aired2 = aired_episodes(anime, now=now)

        self.assertEqual(aired1, 1)
        self.assertEqual(aired2, 1)
        output = stdout_capture.getvalue()
        self.assertEqual(output.count("[WARNING] Corrupt air schedule store"), 1)

        # Case C: Recording works afterwards and overwrites corrupt store atomically
        recorded = record_from_media_list([anime], now=now)
        self.assertEqual(recorded, 1)

        # Verify file is now valid JSON
        with open(self.store_path, "r", encoding="utf-8") as f:
            data = json.load(f)
        self.assertIn("501", data)
        self.assertEqual(data["501"]["next_episode"], 2)

        # Extrapolation works now
        t_after = now + timedelta(hours=2)
        self.assertEqual(aired_episodes(anime, now=t_after), 2)

    # -------------------------------------------------------------------------
    # Pruning & Anchor Updates
    # -------------------------------------------------------------------------
    def test_pruning_entries_older_than_60_days(self):
        """Entries not updated for 60 days are pruned; newer entries are kept."""
        t_old = datetime(2026, 6, 1, 0, 0, 0, tzinfo=timezone.utc)
        t_new = datetime(2026, 9, 1, 0, 0, 0, tzinfo=timezone.utc)
        now = datetime(2026, 9, 15, 0, 0, 0, tzinfo=timezone.utc)

        # Pre-populate store with an old entry and a recent entry
        initial_store = {
            "901": {
                "next_episode": 3,
                "air_at": "2026-06-01T01:00:00Z",
                "total_episodes": 12,
                "recorded_at": t_old.strftime("%Y-%m-%dT%H:%M:%SZ"),  # > 100 days old
                "title": "Old Anime",
            },
            "902": {
                "next_episode": 6,
                "air_at": "2026-09-01T01:00:00Z",
                "total_episodes": 12,
                "recorded_at": t_new.strftime("%Y-%m-%dT%H:%M:%SZ"),  # 14 days old
                "title": "Active Anime",
            },
        }
        with open(self.store_path, "w", encoding="utf-8") as f:
            json.dump(initial_store, f)

        # New payload containing media 903
        payload = [{
            "mediaId": 903,
            "media": {
                "title": {"romaji": "Brand New Anime"},
                "episodes": 12,
                "nextAiringEpisode": {"episode": 2, "timeUntilAiring": 3600},
            },
        }]

        record_from_media_list(payload, now=now)

        with open(self.store_path, "r", encoding="utf-8") as f:
            data = json.load(f)

        # 901 (> 60 days old) pruned
        self.assertNotIn("901", data)
        # 902 (< 60 days old) preserved
        self.assertIn("902", data)
        # 903 added
        self.assertIn("903", data)

    # -------------------------------------------------------------------------
    # AniList decorator: _record_air_schedule
    # -------------------------------------------------------------------------
    def test_anilist_decorator_records_on_cold_fetch_and_skips_on_cache_hit(self):
        """_record_air_schedule triggers record_from_media_list on genuine fetches

        and skips on cache hits and network failures.
        """
        from animu.anilist import AnilistClient

        client = AnilistClient()
        test_entries = [{
            "mediaId": 777,
            "media": {
                "title": {"romaji": "Decorated Anime"},
                "episodes": 12,
                "nextAiringEpisode": {"episode": 2, "timeUntilAiring": 1800},
            },
        }]

        # Clear existing persistent cache for get_anime_user_list
        if hasattr(client.get_anime_user_list, "_cache"):
            client.get_anime_user_list._cache.clear()

        with patch.object(client, "_query") as mock_query, \
             patch("animu.anilist.get_config") as mock_cfg, \
             patch("animu.anilist.record_from_media_list") as mock_record:

            mock_cfg.return_value.ani_user_name = "testuser"
            mock_query.return_value = {
                "data": {
                    "MediaListCollection": {
                        "lists": [{"name": "Watching", "entries": test_entries}]
                    }
                }
            }

            # 1. Cold fetch -> genuine network query -> record_from_media_list called
            res1 = client.get_anime_user_list()
            self.assertEqual(res1, test_entries)
            mock_record.assert_called_once_with(test_entries)

            # 2. Warm cache hit -> no network query -> record_from_media_list NOT called again
            mock_record.reset_mock()
            res2 = client.get_anime_user_list()
            self.assertEqual(res2, test_entries)
            mock_record.assert_not_called()

            # 3. Network error returns None -> record_from_media_list NOT called
            if hasattr(client.get_anime_user_list, "_cache"):
                client.get_anime_user_list._cache.clear()
            mock_query.return_value = None
            res3 = client.get_anime_user_list()
            self.assertIsNone(res3)
            mock_record.assert_not_called()

    # -------------------------------------------------------------------------
    # Criterion 6: Scheduler end-to-end selection path treats stale episode as due
    # -------------------------------------------------------------------------
    def test_scheduler_end_to_end_stale_payload_triggers_due_episode(self):
        """Proves end-to-end effect in the scheduler:

        With AniList returning a stale payload (nextAiringEpisode: 2 in future)
        AND a recorded anchor whose air time has passed, the scheduler treats
        episode 2 as due and attempts to search/download it.
        """
        from animu.scheduler import Scheduler

        scheduler = Scheduler()
        media_id = 888

        # AniList stale payload: frozen at episode 2 airing in future
        # In the payload without extrapolation, payload_aired = 2 - 1 = 1.
        stale_anime_payload = {
            "mediaId": media_id,
            "progress": 1,  # user has watched episode 1
            "media": {
                "id": media_id,
                "title": {"romaji": "Outage Hero"},
                "episodes": 12,
                "coverImage": {"extraLarge": "https://example.com/cover.jpg"},
                "nextAiringEpisode": {
                    "episode": 2,
                    "timeUntilAiring": 3600,
                },
            },
        }

        # Offline DB record: episode 1 already downloaded
        record = OfflineAnime(
            media_id=media_id,
            downloaded_episodes=[1],
            timeouts=0,
        )

        # Anchor recorded 3 hours ago with air_at = 2 hours ago (air time has passed!)
        now = datetime(2026, 9, 15, 15, 0, 0, tzinfo=timezone.utc)
        record_time = now - timedelta(hours=3)
        # Store anchor directly into air schedule
        store = {
            str(media_id): {
                "next_episode": 2,
                "air_at": (record_time + timedelta(hours=1)).strftime("%Y-%m-%dT%H:%M:%SZ"),
                "total_episodes": 12,
                "recorded_at": record_time.strftime("%Y-%m-%dT%H:%M:%SZ"),
                "title": "Outage Hero",
            }
        }
        with open(self.store_path, "w", encoding="utf-8") as f:
            json.dump(store, f)

        # Verify that aired_episodes now returns 2 (extrapolated) instead of payload's 1
        self.assertEqual(aired_episodes(stale_anime_payload, now=now), 2)

        # Mock scheduler dependencies and assert handle_anime / search is called for episode 2
        mock_torrents = [{
            "title": "[SubsPlease] Outage Hero - 02 (1080p).mkv",
            "link": "http://nyaa.si/download/222.torrent",
            "pubDate": "Tue, 15 Sep 2026 14:00:00 GMT",
            "nyaa:seeders": "100",
            "nyaa:size": "1.4 GiB",
            "episode": 2,
        }]

        with patch("animu.scheduler.db.sync_local_changes"), \
             patch("animu.scheduler.anilist.get_anime_user_list", return_value=[stale_anime_payload]), \
             patch("animu.scheduler.db.get_all", return_value=[record]), \
             patch("animu.scheduler.db.upsert"), \
             patch("animu.scheduler.time.sleep"), \
             patch("animu.scheduler.nyaa.get_torrents", return_value=mock_torrents) as mock_get_torrents, \
             patch("animu.scheduler.qbit.add_check_torrent", return_value=True) as mock_qbit, \
             patch("animu.scheduler.send_anime_downloaded_hook"), \
             patch("animu.airschedule._now_utc", return_value=now):

            # Run scheduler cycle
            scheduler.check()

            # Episode 2 was identified as due and attempted
            self.assertTrue(mock_get_torrents.called)
            # The download was dispatched via qBittorrent
            self.assertTrue(mock_qbit.called)
            self.assertIn(2, record.downloaded_episodes)


if __name__ == "__main__":
    unittest.main()
