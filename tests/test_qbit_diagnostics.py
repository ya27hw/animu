import http.client
import http.server
import json
import threading
import time
from unittest.mock import MagicMock
import httpx
import pytest

from animu.qbittorrent import QbitClient
from animu.web import AnimuHTTPHandler
import animu.web


class TestQbitDiagnostics:
    @classmethod
    def setup_class(cls):
        # Ephemeral server for web API testing
        cls.server = http.server.HTTPServer(("127.0.0.1", 0), AnimuHTTPHandler)
        cls.port = cls.server.server_address[1]
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        time.sleep(0.1)

    @classmethod
    def teardown_class(cls):
        cls.server.shutdown()
        cls.server.server_close()

    def test_403_authenticated_call_triggers_single_reauth_and_retry(self):
        """A 403 on an authenticated call triggers exactly one re-authentication
        and exactly one retry (count the calls), and the retry's result is what is returned."""
        client = QbitClient()
        client.sid = "expired_sid"
        client.expires = time.time() + 3000

        calls = []

        def mock_handler(request: httpx.Request) -> httpx.Response:
            calls.append(request)
            if request.url.path == "/api/v2/torrents/info":
                cookie = request.headers.get("cookie", "")
                if "SID=expired_sid" in cookie:
                    return httpx.Response(403, text="Forbidden")
                elif "SID=new_sid" in cookie:
                    return httpx.Response(
                        200,
                        json=[{"name": "Rezero S3 - 01", "hash": "a" * 40, "state": "downloading"}]
                    )
                return httpx.Response(403, text="Unauthorized")
            elif request.url.path == "/api/v2/auth/login":
                return httpx.Response(200, text="Ok.", headers={"set-cookie": "SID=new_sid; Path=/"})
            return httpx.Response(404)

        client.client = httpx.Client(transport=httpx.MockTransport(mock_handler))

        result = client.list_torrents()

        # Exactly 3 calls:
        # 1. Initial info GET with expired_sid -> 403
        # 2. Login POST for re-authentication -> 200
        # 3. Retry info GET with new_sid -> 200
        assert len(calls) == 3
        assert calls[0].url.path == "/api/v2/torrents/info"
        assert "SID=expired_sid" in calls[0].headers.get("cookie", "")

        assert calls[1].url.path == "/api/v2/auth/login"
        assert calls[1].method == "POST"

        assert calls[2].url.path == "/api/v2/torrents/info"
        assert "SID=new_sid" in calls[2].headers.get("cookie", "")

        # The retry's result is what is returned
        assert len(result) == 1
        assert result[0]["name"] == "Rezero S3 - 01"
        assert result[0]["hash"] == "a" * 40

    def test_rejected_add_records_last_add_error_and_handler_detail(self, monkeypatch):
        """A rejected add records last_add_error containing status and body,
        and the handlers' failure payload carries it in detail."""
        # 1. Direct client check with Fails body
        client = QbitClient()
        client.sid = "validsid"
        client.expires = time.time() + 3000
        client.download_torrent_file = lambda link, use_proxy: b"d8:announce3:foo10:created by13:test torrentse"

        def fail_handler(request: httpx.Request) -> httpx.Response:
            if request.url.path == "/api/v2/torrents/add":
                return httpx.Response(200, text="Fails.")
            return httpx.Response(404)

        client.client = httpx.Client(transport=httpx.MockTransport(fail_handler))
        added = client.add_torrent("http://example.com/test.torrent", "Test Show", 1)
        assert added is False
        assert client.last_add_error == "HTTP 200: Fails."

        # 2. Direct client check with 403 body
        def forbidden_handler(request: httpx.Request) -> httpx.Response:
            if request.url.path == "/api/v2/torrents/add":
                return httpx.Response(403, text="Forbidden")
            elif request.url.path == "/api/v2/auth/login":
                return httpx.Response(403, text="Invalid password")
            return httpx.Response(404)

        client.client = httpx.Client(transport=httpx.MockTransport(forbidden_handler))
        added = client.add_torrent("http://example.com/test.torrent", "Test Show", 1)
        assert added is False
        assert "HTTP 403: Forbidden" in client.last_add_error

        # 3. Web API /api/nyaa-download error payload includes detail
        monkeypatch.setattr(animu.web.qbit, "add_check_torrent", lambda *a, **kw: False)
        animu.web.qbit.last_add_error = "HTTP 403: Forbidden"

        conn = http.client.HTTPConnection("127.0.0.1", self.port)
        body = json.dumps({"link": "http://example.com/test.torrent", "title": "Test Show"})
        conn.request("POST", "/api/nyaa-download", body=body, headers={"Content-Type": "application/json"})
        res = conn.getresponse()
        assert res.status == 500
        data = json.loads(res.read().decode("utf-8"))
        assert data.get("error") == "qBittorrent rejected the torrent"
        assert data.get("detail") == "HTTP 403: Forbidden"

        # 4. Web API /api/anime/<id>/nyaa-download error payload includes detail
        monkeypatch.setattr(
            AnimuHTTPHandler,
            "get_anime_list",
            lambda self: [{"mediaId": 189565, "media": {"title": {"romaji": "Test Show"}, "alternativeTitle": None}}]
        )
        body_ep = json.dumps({"link": "http://example.com/test.torrent", "episode": 2})
        conn.request("POST", "/api/anime/189565/nyaa-download", body=body_ep, headers={"Content-Type": "application/json"})
        res_ep = conn.getresponse()
        assert res_ep.status == 500
        data_ep = json.loads(res_ep.read().decode("utf-8"))
        assert data_ep.get("error") == "qBittorrent rejected the download request"
        assert data_ep.get("detail") == "HTTP 403: Forbidden"

    def test_diagnose_payload_contains_documented_keys_and_no_credentials(self, monkeypatch):
        """The diagnose payload contains the documented keys and no credential material."""
        secret_password = "supersecret_password_12345"
        secret_cookie = "supersecret_session_cookie_abcdef"

        class DummyConfig:
            qbit_url = "http://localhost:8080"
            username = "admin"
            password = secret_password

        monkeypatch.setattr("animu.qbittorrent.get_config", lambda: DummyConfig())

        def mock_diag_handler(request: httpx.Request) -> httpx.Response:
            if request.url.path == "/api/v2/auth/login":
                return httpx.Response(
                    200,
                    text="Ok.",
                    headers={"set-cookie": f"SID={secret_cookie}; Path=/"}
                )
            elif request.url.path == "/api/v2/app/version":
                return httpx.Response(200, text="v4.6.5")
            elif request.url.path == "/api/v2/torrents/info":
                return httpx.Response(200, json=[{"name": "Torrent 1"}, {"name": "Torrent 2"}])
            return httpx.Response(404)

        animu.web.qbit.client = httpx.Client(transport=httpx.MockTransport(mock_diag_handler))
        animu.web.qbit.last_add_error = ""

        conn = http.client.HTTPConnection("127.0.0.1", self.port)
        conn.request("GET", "/api/qbit/diagnose")
        res = conn.getresponse()
        assert res.status == 200

        payload_raw = res.read().decode("utf-8")
        payload = json.loads(payload_raw)

        # Documented keys
        expected_keys = {"login", "auth_status", "version", "info_status", "torrent_count", "last_add_error"}
        assert set(payload.keys()) == expected_keys

        assert payload["login"] is True
        assert payload["auth_status"] == 200
        assert payload["version"] == "v4.6.5"
        assert payload["info_status"] == 200
        assert payload["torrent_count"] == 2
        assert payload["last_add_error"] == ""

        # No credential material in response payload
        assert secret_password not in payload_raw
        assert secret_cookie not in payload_raw
        assert "password" not in payload
        assert "username" not in payload
        assert "cookie" not in payload
