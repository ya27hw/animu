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


if __name__ == "__main__":
    unittest.main()
