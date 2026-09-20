import pytest
from unittest.mock import MagicMock
from animu.scheduler import Scheduler
from animu.models import OfflineAnime


def test_handle_anime_combo_alternative_title(monkeypatch):
    """Test that alternative title combo branch sets alternative_title and proceeds to download."""
    # Monkeypatch time.sleep to avoid delays
    monkeypatch.setattr("time.sleep", lambda *a, **kw: None)

    # Monkeypatch side effects
    mock_upsert = MagicMock()
    monkeypatch.setattr("animu.scheduler.db.upsert", mock_upsert)

    mock_qbit = MagicMock()
    mock_qbit.check_episodes_in_batch.return_value = []
    mock_qbit.check_torrent_episode.return_value = False
    monkeypatch.setattr("animu.scheduler.qbit", mock_qbit)

    monkeypatch.setattr("animu.scheduler.history_manager.add_entry", MagicMock())
    monkeypatch.setattr("animu.scheduler.send_anime_downloaded_hook", MagicMock())
    monkeypatch.setattr("animu.scheduler.alert_user", MagicMock())
    monkeypatch.setattr("animu.scheduler.alert_unresolved_anime", MagicMock())

    import animu.nyaa
    monkeypatch.setattr("animu.nyaa.record_failed_trace", MagicMock())
    monkeypatch.setattr("animu.nyaa.remove_failed_trace", MagicMock())

    # Build anime dict and record
    media_id = 189565
    romaji_title = "Osananajimi to wa Love Kome ni Naranai"
    synonym_title = "Osananajimi to wa Love Comedy ni Naranai"

    anime = {
        "mediaId": media_id,
        "progress": 1,
        "media": {
            "title": {
                "romaji": romaji_title,
                "english": "My Childhood Friend Can't Be This Cute",
            },
            "synonyms": [synonym_title],
            "status": "FINISHED",
            "episodes": 12,
            "genres": ["Comedy", "Romance"],
            "coverImage": {"extraLarge": "http://example.com/cover.jpg"},
        },
    }

    record = OfflineAnime(
        media_id=media_id,
        alternative_title=None,
        downloaded_episodes=[],
        timeouts=0,
    )

    # Mock nyaa.get_torrents
    synonym_torrent = [{"title": f"{synonym_title} - 02", "nyaa:seeders": "15"}]

    def fake_get_torrents(**kwargs):
        if kwargs.get("alt_anime_title") == synonym_title:
            return synonym_torrent
        return None

    monkeypatch.setattr("animu.scheduler.nyaa.get_torrents", fake_get_torrents)

    # Stub Scheduler.download_torrents
    download_calls = []
    def fake_download_torrents(anime_arg, record_arg, torrent_arg):
        download_calls.append((anime_arg, record_arg, torrent_arg))
        return [2]

    scheduler = Scheduler()
    scheduler.download_torrents = fake_download_torrents

    # Run handle_anime
    scheduler.handle_anime(anime, record)

    # Assertions:
    # (1) No exception raised (checked by execution reaching here)
    # (2) Combo branch ran: record.alternative_title set to synonym and db.upsert called
    assert record.alternative_title == synonym_title
    assert mock_upsert.called
    assert any(call[0][0] == media_id for call in mock_upsert.call_args_list)

    # (3) download stub was called with synonym torrent list
    assert len(download_calls) == 1
    assert download_calls[0][2] == synonym_torrent
