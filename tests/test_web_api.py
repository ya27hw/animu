import unittest
import threading
import time
import http.client
import json
from animu.web import AnimuHTTPHandler, http
from animu.nyaa import failed_traces, record_failed_trace

class TestWebAPI(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.port = 3219
        cls.server = http.server.HTTPServer(("127.0.0.1", cls.port), AnimuHTTPHandler)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        time.sleep(0.2)

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()

    def test_search_debug_endpoint_returns_persistent_traces(self):
        """Verify GET /api/search-debug returns persistent failed traces."""
        media_id = 999
        record_failed_trace(media_id, anime={"mediaId": media_id, "media": {"title": {"romaji": "Debug Anime"}}}, status="NO_RESULTS")

        conn = http.client.HTTPConnection("127.0.0.1", self.port)
        conn.request("GET", "/api/search-debug")
        res = conn.getresponse()
        self.assertEqual(res.status, 200)

        data = json.loads(res.read().decode("utf-8"))
        self.assertTrue(isinstance(data, list))
        match = [t for t in data if t.get("media_id") == media_id]
        self.assertEqual(len(match), 1)
        self.assertEqual(match[0]["anime_title"], "Debug Anime")
        self.assertTrue(match[0]["unresolved"])

    def test_static_webui_files_served(self):
        """Verify webui index.html and app.js are served cleanly."""
        conn = http.client.HTTPConnection("127.0.0.1", self.port)
        conn.request("GET", "/")
        res = conn.getresponse()
        self.assertEqual(res.status, 200)
        body = res.read().decode("utf-8")
        self.assertIn("Animu Control Panel", body)
        self.assertIn("mobile-nav-tab", body)

        conn.request("GET", "/app.js")
        res_js = conn.getresponse()
        self.assertEqual(res_js.status, 200)
        js_body = res_js.read().decode("utf-8")
        self.assertIn("switchTab", js_body)

    def test_ignored_api_endpoints(self):
        """Verify GET, POST, DELETE for /api/ignored."""
        conn = http.client.HTTPConnection("127.0.0.1", self.port)
        
        # Add ignored title
        payload = json.dumps({"title": "Test Ignored Show", "mediaId": 12345})
        conn.request("POST", "/api/ignored", body=payload, headers={"Content-Type": "application/json"})
        res = conn.getresponse()
        self.assertEqual(res.status, 200)
        data = json.loads(res.read().decode("utf-8"))
        self.assertTrue(data.get("ok"))
        self.assertEqual(data["entry"]["title"], "Test Ignored Show")

        # Get ignored list
        conn.request("GET", "/api/ignored")
        res = conn.getresponse()
        self.assertEqual(res.status, 200)
        data = json.loads(res.read().decode("utf-8"))
        self.assertGreaterEqual(data["count"], 1)

        # Delete ignored title
        conn.request("DELETE", "/api/ignored/12345")
        res = conn.getresponse()
        self.assertEqual(res.status, 200)

    def test_history_delete_action_endpoints(self):
        """Verify DELETE /api/history/<id> with action parameter."""
        from animu.history import history_manager
        entry = history_manager.add_entry(title="Sample History Item", link="http://example.com/test", anime_title="Sample Show")
        entry_id = entry["id"]

        conn = http.client.HTTPConnection("127.0.0.1", self.port)
        conn.request("DELETE", f"/api/history/{entry_id}?action=rerun")
        res = conn.getresponse()
        self.assertEqual(res.status, 200)
        data = json.loads(res.read().decode("utf-8"))
        self.assertTrue(data.get("ok"))
        self.assertEqual(data.get("action"), "rerun")

    def test_api_config_sanitizes_secrets(self):
        """BUG 3: GET /api/config should strip password, emailPassword, token, proxyPassword."""
        conn = http.client.HTTPConnection("127.0.0.1", self.port)
        conn.request("GET", "/api/config")
        res = conn.getresponse()
        self.assertEqual(res.status, 200)
        data = json.loads(res.read().decode("utf-8"))
        for secret_key in ["password", "emailPassword", "token", "proxyPassword", "bearerTokenAnilist", "anilistClientSecret"]:
            self.assertNotIn(secret_key, data)

    def test_api_config_patch_empty_value_preserves_secret(self):
        """BUG 3: PATCH /api/config with empty password does NOT clear stored password."""
        from animu.config import get_config, save_config, reload_config
        cfg = get_config()
        original_pass = cfg.password
        try:
            cfg.password = "secret_pass_123"
            save_config(cfg)
            reload_config()
            conn = http.client.HTTPConnection("127.0.0.1", self.port)
            payload = json.dumps({"password": ""})
            conn.request("PATCH", "/api/config", body=payload, headers={"Content-Type": "application/json"})
            res = conn.getresponse()
            self.assertEqual(res.status, 200)
            self.assertEqual(get_config().password, "secret_pass_123")

            # Non-empty password updates
            payload_new = json.dumps({"password": "new_secret_pass"})
            conn.request("PATCH", "/api/config", body=payload_new, headers={"Content-Type": "application/json"})
            res_new = conn.getresponse()
            self.assertEqual(res_new.status, 200)
            self.assertEqual(get_config().password, "new_secret_pass")
        finally:
            cfg.password = original_pass
            save_config(cfg)
            reload_config()

    def test_api_config_exposes_and_patches_discord_fail_threshold(self):
        """Verify GET /api/config exposes discordFailThreshold and PATCH updates/clamps it."""
        from animu.config import get_config, save_config, reload_config
        cfg = get_config()
        original_thresh = cfg.discord_fail_threshold
        try:
            conn = http.client.HTTPConnection("127.0.0.1", self.port)
            conn.request("GET", "/api/config")
            res = conn.getresponse()
            self.assertEqual(res.status, 200)
            data = json.loads(res.read().decode("utf-8"))
            self.assertIn("discordFailThreshold", data)

            # PATCH valid threshold
            payload = json.dumps({"discordFailThreshold": 5})
            conn.request("PATCH", "/api/config", body=payload, headers={"Content-Type": "application/json"})
            res_patch = conn.getresponse()
            self.assertEqual(res_patch.status, 200)
            self.assertEqual(get_config().discord_fail_threshold, 5)

            # PATCH out-of-range (high) clamped to 10
            payload_high = json.dumps({"discordFailThreshold": 20})
            conn.request("PATCH", "/api/config", body=payload_high, headers={"Content-Type": "application/json"})
            res_high = conn.getresponse()
            self.assertEqual(res_high.status, 200)
            self.assertEqual(get_config().discord_fail_threshold, 10)

            # PATCH out-of-range (low) clamped to 1
            payload_low = json.dumps({"discordFailThreshold": 0})
            conn.request("PATCH", "/api/config", body=payload_low, headers={"Content-Type": "application/json"})
            res_low = conn.getresponse()
            self.assertEqual(res_low.status, 200)
            self.assertEqual(get_config().discord_fail_threshold, 1)
        finally:
            cfg.discord_fail_threshold = original_thresh
            save_config(cfg)
            reload_config()

    def test_scheduler_does_not_mutate_shared_title(self):
        """BUG 4: scheduler handle_anime should not mutate cached title object in place."""
        from animu.scheduler import Scheduler
        from animu.models import OfflineAnime
        from unittest.mock import patch

        scheduler = Scheduler()
        original_title_dict = {"romaji": "Original Romaji Title", "english": "Original English Title"}
        cached_anime = {
            "mediaId": 12345,
            "progress": 0,
            "media": {
                "id": 12345,
                "title": original_title_dict,
                "nextAiringEpisode": {"episode": 2},
                "episodes": 12
            }
        }
        record = OfflineAnime(media_id=12345, alternative_title="Alt Title S2")

        with patch("animu.scheduler.nyaa.search_episode_candidates", return_value=[]), \
             patch("animu.scheduler.db.upsert"):
            scheduler.handle_anime(cached_anime, record)

        self.assertEqual(original_title_dict["romaji"], "Original Romaji Title")

    def test_patch_anime_non_watching_returns_404(self):
        """BUG 6: PATCH /api/anime/<id> creates no record and returns 404 for non-watching ID."""
        from animu.database import db
        phantom_id = 99999999
        conn = http.client.HTTPConnection("127.0.0.1", self.port)
        payload = json.dumps({"alternativeTitle": "Phantom"})
        conn.request("PATCH", f"/api/anime/{phantom_id}", body=payload, headers={"Content-Type": "application/json"})
        res = conn.getresponse()
        self.assertEqual(res.status, 404)
        self.assertIsNone(db.get(phantom_id))

    def test_patch_anime_watching_id_returns_200(self):
        """BUG 6: PATCH /api/anime/<id> succeeds for watching list ID."""
        from unittest.mock import patch
        from animu.database import db
        watching_id = 111222
        mock_watching = [{"mediaId": watching_id, "media": {"title": {"romaji": "Watching Anime"}}}]
        with patch("animu.web.AnimuHTTPHandler.get_anime_list", return_value=mock_watching):
            conn = http.client.HTTPConnection("127.0.0.1", self.port)
            payload = json.dumps({"alternativeTitle": "New Alt Title"})
            conn.request("PATCH", f"/api/anime/{watching_id}", body=payload, headers={"Content-Type": "application/json"})
            res = conn.getresponse()
            self.assertEqual(res.status, 200)
            rec = db.get(watching_id)
            self.assertIsNotNone(rec)
            self.assertEqual(rec.alternative_title, "New Alt Title")

    def test_patch_anime_fallback_allows_known_local_during_outage(self):
        """BUG 6 (review fix): with an empty/stale AniList watch list (outage),
        a media_id already known to the local DB must still PATCH (not 404)."""
        from unittest.mock import patch
        from animu.database import db
        from animu.models import OfflineAnime
        known_id = 222333
        # Seed a local record so the fallback presence check finds it
        db.upsert(known_id, OfflineAnime(media_id=known_id))
        try:
            with patch("animu.web.AnimuHTTPHandler.get_anime_list", return_value=[]):
                conn = http.client.HTTPConnection("127.0.0.1", self.port)
                payload = json.dumps({"alternativeTitle": "Outage Alt"})
                conn.request("PATCH", f"/api/anime/{known_id}", body=payload, headers={"Content-Type": "application/json"})
                res = conn.getresponse()
                self.assertEqual(res.status, 200)
                rec = db.get(known_id)
                self.assertIsNotNone(rec)
                self.assertEqual(rec.alternative_title, "Outage Alt")
        finally:
            db.delete(known_id)

    def test_patch_anime_fallback_still_rejects_unknown_during_outage(self):
        """BUG 6 (review fix): during an outage, an ID unknown locally AND not in
        the watch list must still 404 and create no record."""
        from unittest.mock import patch
        from animu.database import db
        unknown_id = 333444
        with patch("animu.web.AnimuHTTPHandler.get_anime_list", return_value=[]):
            conn = http.client.HTTPConnection("127.0.0.1", self.port)
            payload = json.dumps({"alternativeTitle": "Nope"})
            conn.request("PATCH", f"/api/anime/{unknown_id}", body=payload, headers={"Content-Type": "application/json"})
            res = conn.getresponse()
            self.assertEqual(res.status, 404)
            self.assertIsNone(db.get(unknown_id))

    def test_airing_today_filters_to_user_list_within_window(self):
        """Verify GET /api/anilist/airing-today filters user list to airing within window."""
        from unittest.mock import patch
        fixture = [
            {
                "mediaId": 111,
                "progress": 5,
                "media": {
                    "title": {"romaji": "Airing Show"},
                    "coverImage": {"medium": "http://cover/a.jpg"},
                    "nextAiringEpisode": {"episode": 6, "timeUntilAiring": 3600},
                },
            },
            {
                "mediaId": 222,
                "media": {
                    "title": {"romaji": "Far Future Show"},
                    "nextAiringEpisode": {"episode": 2, "timeUntilAiring": 10 * 24 * 3600},
                },
            },
            {
                "mediaId": 333,
                "media": {
                    "title": {"romaji": "No Schedule"},
                },
            },
        ]
        with patch("animu.web.anilist.get_anime_user_list", return_value=fixture):
            conn = http.client.HTTPConnection("127.0.0.1", self.port)
            conn.request("GET", "/api/anilist/airing-today")
            res = conn.getresponse()
            self.assertEqual(res.status, 200)
            data = json.loads(res.read().decode("utf-8"))
            entries = data.get("entries", [])
            self.assertEqual(len(entries), 1)
            item = entries[0]
            self.assertEqual(item["mediaId"], 111)
            self.assertEqual(item["title"], "Airing Show")
            self.assertEqual(item["episode"], 6)
            self.assertEqual(item["progress"], 5)
            self.assertEqual(item["timeUntilAiring"], 3600)
            self.assertEqual(item["coverImage"], "http://cover/a.jpg")
            self.assertIn("airingAt", item)
            self.assertGreater(item["airingAt"], 0)

    def test_airing_today_hours_param_and_empty(self):
        """Verify GET /api/anilist/airing-today handles hours parameter and empty responses."""
        from unittest.mock import patch
        fixture = [
            {
                "mediaId": 999,
                "progress": 1,
                "media": {
                    "title": {"romaji": "In Two Hours"},
                    "coverImage": {"medium": "http://cover/two.jpg"},
                    "nextAiringEpisode": {"episode": 3, "timeUntilAiring": 7200},
                },
            },
        ]
        with patch("animu.web.anilist.get_anime_user_list", return_value=fixture):
            conn = http.client.HTTPConnection("127.0.0.1", self.port)

            # hours=1 -> 0 entries
            conn.request("GET", "/api/anilist/airing-today?hours=1")
            res = conn.getresponse()
            self.assertEqual(res.status, 200)
            data = json.loads(res.read().decode("utf-8"))
            self.assertEqual(len(data.get("entries", [])), 0)

            # hours=3 -> 1 entry
            conn.request("GET", "/api/anilist/airing-today?hours=3")
            res = conn.getresponse()
            self.assertEqual(res.status, 200)
            data = json.loads(res.read().decode("utf-8"))
            self.assertEqual(len(data.get("entries", [])), 1)
            self.assertEqual(data["entries"][0]["mediaId"], 999)

            # hours=abc -> default 24
            conn.request("GET", "/api/anilist/airing-today?hours=abc")
            res = conn.getresponse()
            self.assertEqual(res.status, 200)
            data = json.loads(res.read().decode("utf-8"))
            self.assertEqual(len(data.get("entries", [])), 1)

        # empty user list
        with patch("animu.web.anilist.get_anime_user_list", return_value=[]):
            conn = http.client.HTTPConnection("127.0.0.1", self.port)
            conn.request("GET", "/api/anilist/airing-today")
            res = conn.getresponse()
            self.assertEqual(res.status, 200)
            data = json.loads(res.read().decode("utf-8"))
            self.assertEqual(data.get("entries"), [])
            self.assertIn("windowHours", data)

    def test_retry_missingfiles_calls_recheck(self):
        """Verify retry endpoint calls recheck_torrent when state is missingFiles."""
        from unittest.mock import patch
        torrent_hash = "1234567890abcdef1234567890abcdef12345678"
        with patch("animu.web.qbit.get_torrent_state", return_value="missingFiles") as mock_get_state, \
             patch("animu.web.qbit.recheck_torrent", return_value=True) as mock_recheck, \
             patch("animu.web.qbit.resume_torrent") as mock_resume:
            conn = http.client.HTTPConnection("127.0.0.1", self.port)
            conn.request("POST", f"/api/downloads/{torrent_hash}/retry")
            res = conn.getresponse()
            self.assertEqual(res.status, 200)
            data = json.loads(res.read().decode("utf-8"))
            self.assertTrue(data.get("ok"))
            self.assertEqual(data.get("message"), "Torrent recheck started.")
            mock_get_state.assert_called_once_with(torrent_hash)
            mock_recheck.assert_called_once_with(torrent_hash)
            mock_resume.assert_not_called()

    def test_retry_resume_normal_state(self):
        """Verify retry endpoint calls resume_torrent when state is stoppedDL."""
        from unittest.mock import patch
        torrent_hash = "1234567890abcdef1234567890abcdef12345678"
        with patch("animu.web.qbit.get_torrent_state", return_value="stoppedDL") as mock_get_state, \
             patch("animu.web.qbit.recheck_torrent") as mock_recheck, \
             patch("animu.web.qbit.resume_torrent", return_value=True) as mock_resume:
            conn = http.client.HTTPConnection("127.0.0.1", self.port)
            conn.request("POST", f"/api/downloads/{torrent_hash}/retry")
            res = conn.getresponse()
            self.assertEqual(res.status, 200)
            data = json.loads(res.read().decode("utf-8"))
            self.assertTrue(data.get("ok"))
            self.assertEqual(data.get("message"), "Torrent resumed.")
            mock_get_state.assert_called_once_with(torrent_hash)
            mock_resume.assert_called_once_with(torrent_hash)
            mock_recheck.assert_not_called()

    def test_retry_recheck_failure(self):
        """Verify retry endpoint returns 500 when recheck_torrent fails for missingFiles."""
        from unittest.mock import patch
        torrent_hash = "1234567890abcdef1234567890abcdef12345678"
        with patch("animu.web.qbit.get_torrent_state", return_value="missingFiles") as mock_get_state, \
             patch("animu.web.qbit.recheck_torrent", return_value=False) as mock_recheck, \
             patch("animu.web.qbit.resume_torrent") as mock_resume:
            conn = http.client.HTTPConnection("127.0.0.1", self.port)
            conn.request("POST", f"/api/downloads/{torrent_hash}/retry")
            res = conn.getresponse()
            self.assertEqual(res.status, 500)
            data = json.loads(res.read().decode("utf-8"))
            self.assertFalse(data.get("ok"))
            self.assertEqual(data.get("error"), "Failed to start torrent recheck.")
            mock_get_state.assert_called_once_with(torrent_hash)
            mock_recheck.assert_called_once_with(torrent_hash)
            mock_resume.assert_not_called()


if __name__ == "__main__":
    unittest.main()
