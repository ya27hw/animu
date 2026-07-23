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

    def test_sanitize_alert_text_redaction(self):
        """Verify sensitive credentials, tokens, and passwords are redacted from alert text."""
        raw_text = "Failed connect to http://user:secretpass123@10.0.0.106:8090 with token=abc123secret&key=xyz"
        clean_text = sanitize_alert_text(raw_text)

        self.assertNotIn("secretpass123", clean_text)
        self.assertNotIn("token=abc123secret", clean_text)
        self.assertIn("[REDACTED]", clean_text)


if __name__ == "__main__":
    unittest.main()
