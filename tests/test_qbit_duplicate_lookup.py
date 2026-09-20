import hashlib
import http.client
import http.server
import json
import threading
import time
import urllib.parse
from unittest.mock import MagicMock
import httpx
import pytest

from animu.qbittorrent import (
    QbitClient,
    compute_info_hash,
    _bencode_decode,
    _bencode_encode,
)
from animu.web import AnimuHTTPHandler
import animu.web
from animu.scheduler import Scheduler
from animu.models import OfflineAnime


def _make_torrent_bytes(name: str, files: list = None, length: int = 1048576) -> tuple[bytes, str]:
    """Helper to construct valid single-file or multi-file bencoded torrent bytes and expected hash."""
    piece_length = 262144
    pieces = b"\x12\x34\x56\x78\x9a\xbc\xde\xf0\x12\x34\x56\x78\x9a\xbc\xde\xf0\x12\x34\x56\x78"
    if files is not None:
        info_dict = {
            b"files": [
                {b"length": f["length"], b"path": [p.encode("utf-8") for p in f["path"]]}
                for f in files
            ],
            b"name": name.encode("utf-8"),
            b"piece length": piece_length,
            b"pieces": pieces * len(files),
        }
    else:
        info_dict = {
            b"length": length,
            b"name": name.encode("utf-8"),
            b"piece length": piece_length,
            b"pieces": pieces,
        }

    raw_info = _bencode_encode(info_dict)
    expected_hash = hashlib.sha1(raw_info).hexdigest().lower()

    torrent_dict = {
        b"announce": b"http://tracker.example.com/announce",
        b"info": info_dict,
    }
    torrent_bytes = _bencode_encode(torrent_dict)
    return torrent_bytes, expected_hash


class TestQbitDuplicateLookup:
    @classmethod
    def setup_class(cls):
        cls.server = http.server.HTTPServer(("127.0.0.1", 0), AnimuHTTPHandler)
        cls.port = cls.server.server_address[1]
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        time.sleep(0.1)

    @classmethod
    def teardown_class(cls):
        cls.server.shutdown()
        cls.server.server_close()

    def test_1_info_hash_helper_single_and_multi_file(self):
        """1. The info-hash helper on a real, constructed bencoded single-file torrent
        and on a multi-file torrent — assert it matches the SHA-1 computed independently
        in the test from the same bytes."""
        # Single-file torrent
        single_bytes, expected_single_hash = _make_torrent_bytes(
            name="Osananajimi to wa Love Comedy ni Naranai - 02.mkv",
            length=850000000
        )
        computed_single = compute_info_hash(single_bytes)
        assert computed_single == expected_single_hash
        assert QbitClient.compute_info_hash(single_bytes) == expected_single_hash

        # Multi-file torrent
        multi_bytes, expected_multi_hash = _make_torrent_bytes(
            name="Osananajimi to wa Love Comedy ni Naranai S01 Batch",
            files=[
                {"length": 400000000, "path": ["Osananajimi - 01.mkv"]},
                {"length": 420000000, "path": ["Osananajimi - 02.mkv"]},
                {"length": 5000, "path": ["Subs", "ep01.ass"]},
            ]
        )
        computed_multi = compute_info_hash(multi_bytes)
        assert computed_multi == expected_multi_hash
        assert QbitClient.compute_info_hash(multi_bytes) == expected_multi_hash

        # Error handling on bytes that are not a bencoded torrent
        with pytest.raises(ValueError, match="Invalid torrent bytes|payload must be a bencoded"):
            compute_info_hash(b"<html><head><title>403 Forbidden</title></head></html>")

        with pytest.raises(ValueError, match="missing 'info' dictionary"):
            compute_info_hash(b"d8:announce3:foo10:created by13:test torrentse")

        with pytest.raises(TypeError):
            compute_info_hash("not bytes string")  # type: ignore

    def test_2_add_path_fails_response_with_hash_present_is_success(self):
        """2. Add path: the torrents/add POST answers 200 'Fails.' while torrents/info
        answers with that hash present => the add is reported as success,
        last_add_was_duplicate is True, last_add_error is empty."""
        client = QbitClient()
        client.sid = "validsid"
        client.expires = time.time() + 3000

        torrent_bytes, expected_hash = _make_torrent_bytes(
            name="Osananajimi to wa Love Comedy ni Naranai - 2.mkv",
            length=500000000
        )
        client.download_torrent_file = lambda link, use_proxy: torrent_bytes

        calls = []

        def mock_handler(request: httpx.Request) -> httpx.Response:
            calls.append(request)
            if request.url.path == "/api/v2/torrents/add":
                return httpx.Response(200, text="Fails.")
            elif request.url.path == "/api/v2/torrents/info":
                body = request.read().decode("utf-8", errors="replace")
                assert expected_hash in body
                return httpx.Response(
                    200,
                    json=[{
                        "hash": expected_hash,
                        "name": "Osananajimi to wa Love Comedy ni Naranai - 2",
                        "state": "pausedUP",
                        "progress": 1.0,
                    }]
                )
            return httpx.Response(404)

        client.client = httpx.Client(transport=httpx.MockTransport(mock_handler))

        added = client.add_torrent(
            "http://example.com/osananajimi_02.torrent",
            "Osananajimi to wa Love Comedy ni Naranai",
            2
        )

        assert added is True
        assert client.last_add_was_duplicate is True
        assert client.last_add_error == ""

        # Verify calls occurred: torrents/add was called and torrents/info was queried
        paths = [r.url.path for r in calls]
        assert "/api/v2/torrents/add" in paths
        assert "/api/v2/torrents/info" in paths

    def test_2b_add_path_fails_response_with_hash_present_zero_progress_requests_recheck(self):
        """Hash present with progress: 0.0 => False, last_add_was_duplicate False,
        last_add_error mentions no data, and recheck request was actually issued."""
        client = QbitClient()
        client.sid = "validsid"
        client.expires = time.time() + 3000

        torrent_bytes, expected_hash = _make_torrent_bytes(
            name="Osananajimi to wa Love Comedy ni Naranai - 2.mkv",
            length=500000000
        )
        client.download_torrent_file = lambda link, use_proxy: torrent_bytes

        calls = []

        def mock_handler(request: httpx.Request) -> httpx.Response:
            calls.append(request)
            if request.url.path == "/api/v2/torrents/add":
                return httpx.Response(200, text="Fails.")
            elif request.url.path == "/api/v2/torrents/info":
                body = request.read().decode("utf-8", errors="replace")
                assert expected_hash in body
                return httpx.Response(
                    200,
                    json=[{
                        "hash": expected_hash,
                        "name": "Osananajimi to wa Love Comedy ni Naranai - 2",
                        "state": "pausedDL",
                        "progress": 0.0,
                    }]
                )
            elif request.url.path == "/api/v2/torrents/recheck":
                body = request.read().decode("utf-8", errors="replace")
                assert expected_hash in body
                return httpx.Response(200, text="Fails.")
            elif request.url.path == "/api/v2/torrents/resume":
                body = request.read().decode("utf-8", errors="replace")
                assert expected_hash in body
                return httpx.Response(200, text="Fails.")
            return httpx.Response(404)

        client.client = httpx.Client(transport=httpx.MockTransport(mock_handler))

        added = client.add_torrent(
            "http://example.com/osananajimi_02.torrent",
            "Osananajimi to wa Love Comedy ni Naranai",
            2
        )

        assert added is False
        assert client.last_add_was_duplicate is False
        assert "no data" in client.last_add_error.lower()

        # Verify calls occurred: torrents/add, torrents/info, torrents/recheck, torrents/resume
        paths = [r.url.path for r in calls]
        assert "/api/v2/torrents/add" in paths
        assert "/api/v2/torrents/info" in paths
        assert "/api/v2/torrents/recheck" in paths
        assert "/api/v2/torrents/resume" in paths

    def test_2c_add_path_fails_response_with_hash_present_missing_progress_requests_recheck(self):
        """Hash present with missing progress field => False, last_add_was_duplicate False,
        last_add_error mentions no data, and recheck request was issued."""
        client = QbitClient()
        client.sid = "validsid"
        client.expires = time.time() + 3000

        torrent_bytes, expected_hash = _make_torrent_bytes(
            name="Osananajimi to wa Love Comedy ni Naranai - 2.mkv",
            length=500000000
        )
        client.download_torrent_file = lambda link, use_proxy: torrent_bytes

        calls = []

        def mock_handler(request: httpx.Request) -> httpx.Response:
            calls.append(request)
            if request.url.path == "/api/v2/torrents/add":
                return httpx.Response(200, text="Fails.")
            elif request.url.path == "/api/v2/torrents/info":
                body = request.read().decode("utf-8", errors="replace")
                assert expected_hash in body
                return httpx.Response(
                    200,
                    json=[{
                        "hash": expected_hash,
                        "name": "Osananajimi to wa Love Comedy ni Naranai - 2",
                        "state": "missingFiles",
                    }]
                )
            elif request.url.path == "/api/v2/torrents/recheck":
                body = request.read().decode("utf-8", errors="replace")
                assert expected_hash in body
                return httpx.Response(200, text="Ok.")
            elif request.url.path == "/api/v2/torrents/resume":
                body = request.read().decode("utf-8", errors="replace")
                assert expected_hash in body
                return httpx.Response(200, text="Ok.")
            return httpx.Response(404)

        client.client = httpx.Client(transport=httpx.MockTransport(mock_handler))

        added = client.add_torrent(
            "http://example.com/osananajimi_02.torrent",
            "Osananajimi to wa Love Comedy ni Naranai",
            2
        )

        assert added is False
        assert client.last_add_was_duplicate is False
        assert "no data" in client.last_add_error.lower()

        paths = [r.url.path for r in calls]
        assert "/api/v2/torrents/recheck" in paths
        assert "/api/v2/torrents/resume" in paths

    def test_3_add_path_fails_response_with_hash_absent_fails(self):
        """3. Add path: 'Fails.' and the hash absent => still fails,
        last_add_error contains the status and body."""
        client = QbitClient()
        client.sid = "validsid"
        client.expires = time.time() + 3000

        torrent_bytes, expected_hash = _make_torrent_bytes(
            name="Brand New Anime - 01.mkv",
            length=600000000
        )
        client.download_torrent_file = lambda link, use_proxy: torrent_bytes

        calls = []

        def mock_handler(request: httpx.Request) -> httpx.Response:
            calls.append(request)
            if request.url.path == "/api/v2/torrents/add":
                return httpx.Response(200, text="Fails.")
            elif request.url.path == "/api/v2/torrents/info":
                # Hash is absent in qBittorrent
                return httpx.Response(200, json=[])
            return httpx.Response(404)

        client.client = httpx.Client(transport=httpx.MockTransport(mock_handler))

        added = client.add_torrent(
            "http://example.com/brand_new_01.torrent",
            "Brand New Anime",
            1
        )

        assert added is False
        assert client.last_add_was_duplicate is False
        assert "HTTP 200: Fails." in client.last_add_error

    def test_4_check_torrent_episode_paginated_third_page_and_short_stop(self):
        """4. check_torrent_episode finds the episode when its torrent appears on the third
        page of the paginated list (assert the pagination actually walked past the first page),
        and the pagination helper stops when a page comes back short."""
        client = QbitClient()
        client.sid = "validsid"
        client.expires = time.time() + 3000

        recorded_offsets = []

        # Construct 3 pages
        page_0 = [{"hash": f"{i:040x}", "name": f"Filler Show Alpha - {i}", "progress": 1.0} for i in range(1000)]
        page_1 = [{"hash": f"1{i:039x}", "name": f"Filler Show Beta - {i}", "progress": 1.0} for i in range(1000)]
        # Page 2 has the target episode and only 5 items (< 1000 page size)
        page_2 = [
            {"hash": "2" * 40, "name": "Osananajimi to wa Love Comedy ni Naranai - 2", "progress": 1.0},
            {"hash": "3" * 40, "name": "Filler Show Gamma - 1", "progress": 1.0},
            {"hash": "4" * 40, "name": "Filler Show Gamma - 2", "progress": 1.0},
            {"hash": "5" * 40, "name": "Filler Show Gamma - 3", "progress": 1.0},
            {"hash": "6" * 40, "name": "Filler Show Gamma - 4", "progress": 1.0},
        ]

        def mock_handler(request: httpx.Request) -> httpx.Response:
            if request.url.path == "/api/v2/torrents/info":
                body = request.read().decode("utf-8", errors="replace")
                params = urllib.parse.parse_qs(body)
                offset = int(params.get("offset", [0])[0])
                recorded_offsets.append(offset)
                if offset == 0:
                    return httpx.Response(200, json=page_0)
                elif offset == 1000:
                    return httpx.Response(200, json=page_1)
                elif offset == 2000:
                    return httpx.Response(200, json=page_2)
                else:
                    return httpx.Response(200, json=[])
            return httpx.Response(404)

        client.client = httpx.Client(transport=httpx.MockTransport(mock_handler))

        found = client.check_torrent_episode("Osananajimi to wa Love Comedy ni Naranai", 2)
        assert found is True

        # Assert pagination walked past the first page and through offset 0, 1000, 2000
        assert recorded_offsets == [0, 1000, 2000]
        # Assert helper stopped when page came back short (no request for offset 3000)
        assert 3000 not in recorded_offsets

        # Verify loop protection: identical page detection stops infinite loop
        identical_offsets = []

        def mock_loop_handler(request: httpx.Request) -> httpx.Response:
            if request.url.path == "/api/v2/torrents/info":
                body = request.read().decode("utf-8", errors="replace")
                params = urllib.parse.parse_qs(body)
                offset = int(params.get("offset", [0])[0])
                identical_offsets.append(offset)
                # Ignore offset and return same page_0 (length 1000)
                return httpx.Response(200, json=page_0)
            return httpx.Response(404)

        client.client = httpx.Client(transport=httpx.MockTransport(mock_loop_handler))
        results = client.get_all_torrents()
        # Should stop after detecting identical page on second request (offset 1000)
        assert len(identical_offsets) == 2
        assert len(results) == 1000

    def test_5_diagnose_with_hash_query_parameter(self, monkeypatch):
        """5. GET /api/qbit/diagnose?hash=<hex> reports exists True for a present hash
        and False for an absent one."""
        secret_password = "supersecret_password_12345"
        secret_cookie = "supersecret_session_cookie_abcdef"

        class DummyConfig:
            qbit_url = "http://localhost:8080"
            username = "admin"
            password = secret_password

        monkeypatch.setattr("animu.qbittorrent.get_config", lambda: DummyConfig())

        present_hash = "a" * 40
        absent_hash = "b" * 40

        def mock_diag_handler(request: httpx.Request) -> httpx.Response:
            if request.url.path == "/api/v2/auth/login":
                return httpx.Response(
                    200,
                    text="Ok.",
                    headers={"set-cookie": f"SID={secret_cookie}; Path=/"}
                )
            elif request.url.path == "/api/v2/app/version":
                return httpx.Response(200, text="v5.1.0")
            elif request.url.path == "/api/v2/torrents/info":
                # Check for hashes param in body or query
                body = request.read().decode("utf-8", errors="replace")
                hashes_param = None
                if "hashes=" in body:
                    hashes_param = urllib.parse.parse_qs(body).get("hashes", [None])[0]
                elif "hashes" in request.url.params:
                    hashes_param = request.url.params.get("hashes")

                if hashes_param == present_hash:
                    return httpx.Response(
                        200,
                        json=[{
                            "hash": present_hash,
                            "name": "Osananajimi to wa Love Comedy ni Naranai - 2",
                            "state": "pausedUP",
                            "progress": 0.85,
                        }]
                    )
                elif hashes_param == absent_hash:
                    return httpx.Response(200, json=[])
                else:
                    return httpx.Response(200, json=[{"name": "General Torrent 1"}])
            return httpx.Response(404)

        animu.web.qbit.client = httpx.Client(transport=httpx.MockTransport(mock_diag_handler))
        animu.web.qbit.last_add_error = ""

        # Case A: Present hash
        conn = http.client.HTTPConnection("127.0.0.1", self.port)
        conn.request("GET", f"/api/qbit/diagnose?hash={present_hash}")
        res = conn.getresponse()
        assert res.status == 200
        raw_text_present = res.read().decode("utf-8")
        data_present = json.loads(raw_text_present)

        assert data_present["exists"] is True
        assert data_present["name"] == "Osananajimi to wa Love Comedy ni Naranai - 2"
        assert data_present["state"] == "pausedUP"
        assert data_present["progress"] == 0.85
        assert data_present["login"] is True
        assert data_present["version"] == "v5.1.0"
        assert secret_password not in raw_text_present
        assert secret_cookie not in raw_text_present

        # Case B: Absent hash
        conn = http.client.HTTPConnection("127.0.0.1", self.port)
        conn.request("GET", f"/api/qbit/diagnose?hash={absent_hash}")
        res = conn.getresponse()
        assert res.status == 200
        raw_text_absent = res.read().decode("utf-8")
        data_absent = json.loads(raw_text_absent)

        assert data_absent["exists"] is False
        assert data_absent["name"] == ""
        assert data_absent["state"] == ""
        assert data_absent["progress"] == 0.0
        assert data_absent["login"] is True
        assert data_absent["version"] == "v5.1.0"
        assert secret_password not in raw_text_absent
        assert secret_cookie not in raw_text_absent

        # Case C: No hash param -> payload unchanged from documented 6 keys
        conn = http.client.HTTPConnection("127.0.0.1", self.port)
        conn.request("GET", "/api/qbit/diagnose")
        res = conn.getresponse()
        assert res.status == 200
        data_plain = json.loads(res.read().decode("utf-8"))
        expected_keys = {"login", "auth_status", "version", "info_status", "torrent_count", "last_add_error"}
        assert set(data_plain.keys()) == expected_keys

    def test_scheduler_download_torrents_duplicate_behavior(self, monkeypatch, capsys):
        """In animu/scheduler.py (download_torrents): when the add reports duplicate,
        credit the episode, do NOT write a new history entry, do NOT send the webhook,
        and print 'Already present in qBittorrent: <title> - <episode>'."""
        scheduler = Scheduler()

        history_calls = []
        webhook_calls = []

        monkeypatch.setattr("animu.scheduler.history_manager.add_entry", lambda **kw: history_calls.append(kw))
        monkeypatch.setattr("animu.scheduler.send_anime_downloaded_hook", lambda *a, **kw: webhook_calls.append(a))
        monkeypatch.setattr("animu.scheduler.db.upsert", lambda *a, **kw: None)

        def mock_add_check(link, title, episode=None, use_proxy_download=False):
            animu.scheduler.qbit.last_add_was_duplicate = True
            return True

        monkeypatch.setattr(animu.scheduler.qbit, "add_check_torrent", mock_add_check)

        anime = {
            "mediaId": 12345,
            "media": {
                "title": {"romaji": "Osananajimi to wa Love Comedy ni Naranai"},
                "coverImage": {"extraLarge": "http://img.example.com/cover.jpg", "color": "#00ff00"},
                "episodes": 12,
            }
        }
        record = OfflineAnime(media_id=12345)
        record.downloaded_episodes = [1]

        torrents = [{
            "title": "Osananajimi to wa Love Comedy ni Naranai - 02 [1080p]",
            "link": "http://example.com/02.torrent",
            "episode": 2,
            "size": "1.2 GiB",
            "seeders": "15",
        }]

        result = scheduler.download_torrents(anime, record, torrents)

        # Episode credited
        assert result == [2]
        assert 2 in record.downloaded_episodes

        # History entry NOT written
        assert len(history_calls) == 0

        # Webhook NOT sent
        assert len(webhook_calls) == 0

        # Printed message
        captured = capsys.readouterr()
        assert "Already present in qBittorrent: Osananajimi to wa Love Comedy ni Naranai - 02 [1080p] - 2" in captured.out
