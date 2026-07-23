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


if __name__ == "__main__":
    unittest.main()
