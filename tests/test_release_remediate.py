"""Re-download remediation: inventory, fail-closed matching, correct replacement."""
from unittest.mock import MagicMock

import pytest

from animu.qbittorrent import QbitClient


def _client_with_torrents(torrents):
    client = QbitClient()
    client.sid = "testsid"

    def fake_get(url, params=None, headers=None):
        resp = MagicMock()
        resp.status_code = 200
        resp.json.return_value = torrents
        return resp

    client.client = MagicMock()
    client.client.get.side_effect = fake_get
    client._ensure_auth = lambda: True
    return client


def test_list_torrents_returns_full_queue():
    torrents = [
        {"name": "[ToonsHub] Show S01E01 1080p (Japanese Dub)", "hash": "a" * 40,
         "save_path": "/storage/media/anime/Show", "state": "uploading", "size": 123,
         "category": "animu"},
        {"name": "[ToonsHub] Show S01E02 1080p (Multi-Subs)", "hash": "b" * 40,
         "save_path": "/storage/media/anime/Show", "state": "stoppedUP", "size": 456,
         "category": "animu"},
    ]
    client = _client_with_torrents(torrents)
    result = client.list_torrents()
    assert [t["hash"] for t in result] == ["a" * 40, "b" * 40]
    assert result[0]["name"].endswith("(Japanese Dub)")


def test_list_torrents_handles_failure():
    client = QbitClient()
    client._ensure_auth = lambda: False
    assert client.list_torrents() == []
