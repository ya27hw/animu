import unittest
import time
from animu.nyaa import failed_traces, active_traces, record_trace, record_failed_trace, remove_failed_trace
from animu.discord import alert_history, alert_unresolved_anime, clear_alert_history, sanitize_alert_text, get_config
from animu.models import OfflineAnime


class TestSearchDiagnostics(unittest.TestCase):
    def setUp(self):
        failed_traces.clear()
        active_traces.clear()
        alert_history.clear()

    def tearDown(self):
        failed_traces.clear()
        active_traces.clear()
        alert_history.clear()

    def test_persistent_failed_trace_retention(self):
        """Verify that an unresolved search trace is retained across backoff cycles."""
        media_id = 101
        anime = {
            "mediaId": media_id,
            "season_count": 1,
            "media": {
                "title": {"romaji": "Test Anime S1", "english": "Test Anime Season 1"},
                "format": "TV",
                "episodes": 12,
                "status": "RELEASING"
            }
        }
        record = OfflineAnime(media_id=media_id, timeouts=1)

        # Record initial failure trace
        record_failed_trace(media_id, anime=anime, record=record, status="NO_RESULTS")
        self.assertIn(media_id, failed_traces)
        self.assertTrue(failed_traces[media_id]["unresolved"])
        self.assertEqual(failed_traces[media_id]["timeouts"], 1)

        # Simulate backoff cycle where search is skipped but trace is preserved
        record.timeouts = 2
        failed_traces[media_id]["timeouts"] = record.timeouts
        self.assertIn(media_id, failed_traces)
        self.assertEqual(failed_traces[media_id]["timeouts"], 2)

        # Evict on successful resolution
        remove_failed_trace(media_id)
        self.assertNotIn(media_id, failed_traces)

    def test_season_and_media_id_separation(self):
        """Verify distinct media IDs for different seasons maintain separate diagnostic traces."""
        media_id_s1 = 201
        media_id_s2 = 202

        anime_s1 = {
            "mediaId": media_id_s1,
            "media": {"title": {"romaji": "Mob Psycho 100"}, "format": "TV", "episodes": 12}
        }
        anime_s2 = {
            "mediaId": media_id_s2,
            "media": {"title": {"romaji": "Mob Psycho 100 II"}, "format": "TV", "episodes": 13}
        }

        record_failed_trace(media_id_s1, anime=anime_s1)
        record_failed_trace(media_id_s2, anime=anime_s2)

        self.assertIn(media_id_s1, failed_traces)
        self.assertIn(media_id_s2, failed_traces)
        self.assertEqual(failed_traces[media_id_s1]["anime_title"], "Mob Psycho 100")
        self.assertEqual(failed_traces[media_id_s2]["anime_title"], "Mob Psycho 100 II")

    def test_alert_deduplication(self):
        """Verify that repeated unresolved alerts for the same media_id and condition are deduplicated."""
        media_id = 301

        from unittest.mock import patch
        with patch("animu.discord.send_embed", return_value=True):
            # First alert should record history
            sent1 = alert_unresolved_anime(media_id, "Frieren", reason="No torrents found", season_info="Media ID 301")
            self.assertTrue(sent1)
            self.assertIn(media_id, alert_history)

            # Repeated call with same reason should be deduplicated
            sent2 = alert_unresolved_anime(media_id, "Frieren", reason="No torrents found", season_info="Media ID 301")
            self.assertFalse(sent2)

            # Clearing history on resolution allows future alerts
            clear_alert_history(media_id)
            self.assertNotIn(media_id, alert_history)

    def test_alert_deduplication_varying_timeouts(self):
        """Verify that repeated unresolved alerts with changing retry/timeout counters are deduplicated."""
        media_id = 128757
        title = "Tai-Ari deshita."
        season_info = f"Media ID {media_id}"

        from unittest.mock import patch
        with patch("animu.discord.send_embed", return_value=True) as mock_send:
            # First failure cycle with timeout 1/10
            sent1 = alert_unresolved_anime(
                media_id,
                title,
                reason="No matching torrents found on Nyaa.si (Backoff timeout 1/10)",
                season_info=season_info
            )
            self.assertTrue(sent1)
            self.assertEqual(mock_send.call_count, 1)

            # Consecutive cycle with incremented timeout 2/10 must be deduplicated
            sent2 = alert_unresolved_anime(
                media_id,
                title,
                reason="No matching torrents found on Nyaa.si (Backoff timeout 2/10)",
                season_info=season_info
            )
            self.assertFalse(sent2)
            self.assertEqual(mock_send.call_count, 1)

            # Subsequent cycle with timeout 10/10 must also be deduplicated
            sent3 = alert_unresolved_anime(
                media_id,
                title,
                reason="No matching torrents found on Nyaa.si (Backoff timeout 10/10)",
                season_info=season_info
            )
            self.assertFalse(sent3)
            self.assertEqual(mock_send.call_count, 1)

            # A genuinely different failure reason should trigger a new alert
            sent4 = alert_unresolved_anime(
                media_id,
                title,
                reason="Nyaa API error 500",
                season_info=season_info
            )
            self.assertTrue(sent4)
            self.assertEqual(mock_send.call_count, 2)

            # After resolution and clearing history, alert should fire again on next failure
            clear_alert_history(media_id)
            sent5 = alert_unresolved_anime(
                media_id,
                title,
                reason="No matching torrents found on Nyaa.si (Backoff timeout 1/10)",
                season_info=season_info
            )
            self.assertTrue(sent5)
            self.assertEqual(mock_send.call_count, 3)

    def test_scheduler_threshold_gating_unresolved_alerts(self):
        """Verify scheduler only sends unresolved alerts when consecutive failure count reaches threshold."""
        from animu.scheduler import Scheduler
        from unittest.mock import patch

        scheduler = Scheduler()
        media_id = 555
        anime = {
            "mediaId": media_id,
            "progress": 0,
            "media": {
                "id": media_id,
                "title": {"romaji": "Gated Show"},
                "coverImage": {"extraLarge": "https://img/test.jpg"},
                "episodes": 12,
            }
        }
        record = OfflineAnime(media_id=media_id)

        cfg = get_config()
        original_threshold = cfg.discord_fail_threshold
        original_enable = cfg.discord_enable_fail
        try:
            cfg.discord_fail_threshold = 3
            cfg.discord_enable_fail = True

            with patch("animu.scheduler.nyaa.get_torrents", return_value=[]), \
                 patch("animu.scheduler.db.upsert"), \
                 patch("animu.scheduler.alert_unresolved_anime", wraps=alert_unresolved_anime) as mock_alert, \
                 patch("animu.discord.send_embed", return_value=True) as mock_send_embed:

                # Failure 1 (timeouts=1 < 3) -> No alert
                scheduler.handle_anime(anime, record)
                self.assertEqual(record.max_timeouts, 1)
                mock_alert.assert_not_called()
                self.assertEqual(mock_send_embed.call_count, 0)

                # Failure 2 (timeouts=2 < 3) -> No alert
                scheduler.handle_anime(anime, record)
                self.assertEqual(record.max_timeouts, 2)
                mock_alert.assert_not_called()
                self.assertEqual(mock_send_embed.call_count, 0)

                # Failure 3 (timeouts=3 == 3) -> Alert sent!
                scheduler.handle_anime(anime, record)
                self.assertEqual(record.max_timeouts, 3)
                self.assertEqual(mock_alert.call_count, 1)
                self.assertEqual(mock_send_embed.call_count, 1)

                # Failure 4 (timeouts=4 > 3) -> Handled but deduplicated by condition
                scheduler.handle_anime(anime, record)
                self.assertEqual(record.max_timeouts, 4)
                self.assertEqual(mock_alert.call_count, 2)
                self.assertEqual(mock_send_embed.call_count, 1)
        finally:
            cfg.discord_fail_threshold = original_threshold
            cfg.discord_enable_fail = original_enable

    def test_config_threshold_clamping(self):
        """Verify discordFailThreshold defaults to 7 and is clamped to 1..10."""
        from animu.config import ProfileConfig

        cfg_default = ProfileConfig()
        self.assertEqual(cfg_default.discord_fail_threshold, 7)

        cfg_low = ProfileConfig(discord_fail_threshold=0)
        self.assertEqual(cfg_low.discord_fail_threshold, 1)

        cfg_high = ProfileConfig(discord_fail_threshold=99)
        self.assertEqual(cfg_high.discord_fail_threshold, 10)

        cfg_neg = ProfileConfig(discord_fail_threshold=-5)
        self.assertEqual(cfg_neg.discord_fail_threshold, 1)

        cfg_valid = ProfileConfig(discord_fail_threshold=4)
        self.assertEqual(cfg_valid.discord_fail_threshold, 4)

    def test_sanitize_alert_text_redaction(self):
        """Verify sensitive credentials, tokens, and passwords are redacted from alert text."""
        raw_text = "Failed connect to http://user:secretpass123@10.0.0.106:8090 with token=abc123secret&key=xyz"
        clean_text = sanitize_alert_text(raw_text)

        self.assertNotIn("secretpass123", clean_text)
        self.assertNotIn("token=abc123secret", clean_text)
        self.assertIn("[REDACTED]", clean_text)


if __name__ == "__main__":
    unittest.main()
