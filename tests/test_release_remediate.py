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


import json
from unittest.mock import patch

from animu import prefs as prefs_module
from animu.release_tracks import (
    AUDIO_JPN_EXPLICIT,
    AUDIO_OTHER,
    LABEL_JPN,
    LABEL_UNKNOWN,
    LABEL_SUB_ENG,
    SUB_ENG_DECLARED,
    SUB_UNKNOWN,
)
from animu.models import OfflineAnime

JPN = "[ToonsHub] Tomb Raider King S01E05 1080p CR WEB-DL AAC2.0 H.264 (Dogulwang, Multi-Subs, Japanese Dub)"
OLD = "[ToonsHub] Tomb Raider King S01E05 1080p BILI WEB-DL AAC2.0 H.265 (Dogulwang, Multi-Subs)"
OK_EP3 = "[ToonsHub] Tomb Raider King S01E03 1080p BILI WEB-DL AAC2.0 H.265 (Dogul Wang, Multi-Subs, Japanese Dub)"


def _history(entries):
    return [
        {"id": str(i), "title": t, "anime_title": "Tomb Raider King", "episode": ep,
         "link": f"https://nyaa.si/download/{i}.torrent", "size": "1G", "seeders": "10",
         "added_at": f"2026-09-17T0{i}:00:00+00:00"}
        for i, (t, ep) in enumerate(entries)
    ]


def _import_script():
    import importlib.util
    import pathlib

    path = pathlib.Path("scripts/jp_dub_redownload.py")
    spec = importlib.util.spec_from_file_location("jp_dub_redownload", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_dry_run_makes_no_mutations(tmp_path):
    script = _import_script()
    from animu.prefs import release_prefs
    # qBittorrent holds the RENAMED display name ("<title> - <episode>"), not the Nyaa
    # release name; the release name survives only in history.json.
    torrents = [
        {"name": "Tomb Raider King - 5", "hash": "b" * 40,
         "save_path": "/storage/media/anime/Tomb Raider King",
         "state": "uploading", "size": 1, "category": "animu"},
        {"name": "Tomb Raider King - 3", "hash": "c" * 40,
         "save_path": "/storage/media/anime/Tomb Raider King",
         "state": "uploading", "size": 1, "category": "animu"},
    ]
    release_prefs.set(184356, require_japanese_audio=True, require_english_subs=True)
    try:
        with patch.object(script.qbit, "list_torrents", return_value=torrents), \
             patch.object(script.qbit, "delete_torrent_by_hash") as mock_delete, \
             patch.object(script.qbit, "add_check_torrent") as mock_add, \
             patch.object(script.history_manager, "get_all",
                          return_value=_history([(OLD, 5), (OK_EP3, 3)])), \
             patch.object(script.db, "get", return_value=OfflineAnime(media_id=184356,
                                                                     alternative_title="Tomb Raider King")), \
             patch.object(script.nyaa, "search_raw_title_candidates", return_value=[{
                 "title": JPN, "link": "https://nyaa.si/download/99.torrent",
                 "nyaa:seeders": "89", "nyaa:size": "1.3 GiB", "pubDate": "d",
                 "audio_rank": AUDIO_JPN_EXPLICIT, "audio_label": LABEL_JPN,
                 "subtitle_rank": SUB_ENG_DECLARED, "subtitle_label": LABEL_SUB_ENG}]):
            report = script.build_report(184356, apply=False)
    finally:
        release_prefs.delete(184356)

    mock_delete.assert_not_called()
    mock_add.assert_not_called()
    assert report["entries"][1]["episode"] == 5
    assert report["entries"][1]["action"] == "replace"
    assert report["entries"][1]["replacement"]["title"] == JPN
    assert report["entries"][0]["action"] == "keep"
    assert report["entries"][1]["torrent"] == "Tomb Raider King - 5"


def test_apply_adds_before_deleting_and_reports(tmp_path):
    script = _import_script()
    from animu.prefs import release_prefs
    torrents = [{"name": "Tomb Raider King - 5", "hash": "b" * 40,
                 "save_path": "/storage/media/anime/Tomb Raider King", "state": "uploading",
                 "size": 1, "category": "animu"}]
    order = []
    release_prefs.set(184356, require_japanese_audio=True, require_english_subs=True)
    try:
        with patch.object(script.qbit, "list_torrents", return_value=torrents), \
             patch.object(script.qbit, "add_check_torrent",
                          side_effect=lambda *a, **k: order.append("add") or True), \
             patch.object(script.qbit, "delete_torrent_by_hash",
                          side_effect=lambda *a, **k: order.append("delete") or True), \
             patch.object(script.history_manager, "get_all", return_value=_history([(OLD, 5)])), \
             patch.object(script.history_manager, "add_entry"), \
             patch.object(script.db, "get", return_value=OfflineAnime(media_id=184356,
                                                                     alternative_title="Tomb Raider King")), \
             patch.object(script.nyaa, "search_raw_title_candidates", return_value=[{
                 "title": JPN, "link": "https://nyaa.si/download/99.torrent",
                 "nyaa:seeders": "89", "nyaa:size": "1.3 GiB", "pubDate": "d",
                 "audio_rank": AUDIO_JPN_EXPLICIT, "audio_label": LABEL_JPN,
                 "subtitle_rank": SUB_ENG_DECLARED, "subtitle_label": LABEL_SUB_ENG}]):
            report = script.build_report(184356, apply=True)
    finally:
        release_prefs.delete(184356)

    # The replacement must be added before the wrong release is deleted, so a failed
    # add never leaves the episode with no file at all.
    assert order == ["add", "delete"]
    assert report["applied"] == [5]


def test_ambiguous_torrent_match_is_reported_not_deleted():
    script = _import_script()
    from animu.prefs import release_prefs
    # A duplicated add: two torrents carry the same display name, so the match is
    # ambiguous and nothing may be deleted.
    torrents = [
        {"name": "Tomb Raider King - 5", "hash": "b" * 40,
         "save_path": "/storage/media/anime/Tomb Raider King", "state": "uploading",
         "size": 1, "category": "animu"},
        {"name": "Tomb Raider King - 5", "hash": "d" * 40,
         "save_path": "/storage/media/anime/Tomb Raider King", "state": "uploading",
         "size": 1, "category": "animu"},
    ]
    release_prefs.set(184356, require_japanese_audio=True, require_english_subs=True)
    try:
        with patch.object(script.qbit, "list_torrents", return_value=torrents), \
             patch.object(script.qbit, "delete_torrent_by_hash") as mock_delete, \
             patch.object(script.qbit, "add_check_torrent") as mock_add, \
             patch.object(script.history_manager, "get_all", return_value=_history([(OLD, 5)])), \
             patch.object(script.db, "get", return_value=OfflineAnime(media_id=184356,
                                                                     alternative_title="Tomb Raider King")), \
             patch.object(script.nyaa, "search_raw_title_candidates", return_value=[{
                 "title": JPN, "link": "l", "nyaa:seeders": "89", "nyaa:size": "1.3 GiB",
                 "pubDate": "d", "audio_rank": AUDIO_JPN_EXPLICIT, "audio_label": LABEL_JPN,
                 "subtitle_rank": SUB_ENG_DECLARED, "subtitle_label": LABEL_SUB_ENG}]):
            report = script.build_report(184356, apply=True)
    finally:
        release_prefs.delete(184356)

    mock_delete.assert_not_called()
    mock_add.assert_not_called()
    assert report["entries"][0]["action"] == "ambiguous"
    assert "2 torrents" in report["entries"][0]["reason"]


def test_no_replacement_found_keeps_current_release():
    script = _import_script()
    from animu.prefs import release_prefs
    torrents = [{"name": "Tomb Raider King - 5", "hash": "b" * 40,
                 "save_path": "/storage/media/anime/Tomb Raider King", "state": "uploading",
                 "size": 1, "category": "animu"}]
    release_prefs.set(184356, require_japanese_audio=True, require_english_subs=True)
    try:
        with patch.object(script.qbit, "list_torrents", return_value=torrents), \
             patch.object(script.qbit, "delete_torrent_by_hash") as mock_delete, \
             patch.object(script.qbit, "add_check_torrent") as mock_add, \
             patch.object(script.history_manager, "get_all", return_value=_history([(OLD, 5)])), \
             patch.object(script.db, "get", return_value=OfflineAnime(media_id=184356,
                                                                     alternative_title="Tomb Raider King")), \
             patch.object(script.nyaa, "search_raw_title_candidates", return_value=[]):
            report = script.build_report(184356, apply=True)
    finally:
        release_prefs.delete(184356)

    mock_delete.assert_not_called()
    mock_add.assert_not_called()
    assert report["entries"][0]["action"] == "no_replacement"


def test_enroll_sets_both_requirements(tmp_path, monkeypatch):
    script = _import_script()
    monkeypatch.setattr(prefs_module.release_prefs, "path", str(tmp_path / "prefs.json"))
    monkeypatch.setattr(script, "release_prefs", prefs_module.release_prefs, raising=False)
    prefs_module.release_prefs.items = {}
    prefs_module.release_prefs.set(184356, require_japanese_audio=True, require_english_subs=True)
    assert prefs_module.release_prefs.get(184356) == {
        "require_japanese_audio": True, "require_english_subs": True}
    prefs_module.release_prefs.delete(184356)


def test_anime_without_enrolment_is_never_touched():
    """No requirements stored -> every episode is kept, nothing is added or deleted."""
    script = _import_script()
    from animu.models import OfflineAnime
    from animu.prefs import release_prefs

    release_prefs.delete(184356)
    torrents = [{"name": "Tomb Raider King - 5", "hash": "b" * 40,
                 "save_path": "/storage/media/anime/Tomb Raider King", "state": "uploading",
                 "size": 1, "category": "animu"}]

    with patch.object(script.qbit, "list_torrents", return_value=torrents), \
         patch.object(script.qbit, "delete_torrent_by_hash") as mock_delete, \
         patch.object(script.qbit, "add_check_torrent") as mock_add, \
         patch.object(script.history_manager, "get_all", return_value=_history([(OLD, 5)])), \
         patch.object(script.db, "get", return_value=OfflineAnime(media_id=184356,
                                                                 alternative_title="Tomb Raider King")), \
         patch.object(script.nyaa, "search_raw_title_candidates", return_value=[]):
        report = script.build_report(184356, apply=True)

    mock_delete.assert_not_called()
    mock_add.assert_not_called()
    assert report["requireJapaneseAudio"] is False
    assert [row["action"] for row in report["entries"]] == ["keep"]


def test_enroll_applies_in_the_same_run():
    script = _import_script()
    from animu.models import OfflineAnime
    from animu.prefs import release_prefs

    release_prefs.delete(184356)
    torrents = [{"name": "Tomb Raider King - 5", "hash": "b" * 40,
                 "save_path": "/storage/media/anime/Tomb Raider King", "state": "uploading",
                 "size": 1, "category": "animu"}]
    try:
        with patch.object(script.qbit, "list_torrents", return_value=torrents), \
             patch.object(script.qbit, "delete_torrent_by_hash"), \
             patch.object(script.qbit, "add_check_torrent", return_value=True), \
             patch.object(script.history_manager, "get_all", return_value=_history([(OLD, 5)])), \
             patch.object(script.history_manager, "add_entry"), \
             patch.object(script.db, "get", return_value=OfflineAnime(media_id=184356,
                                                                     alternative_title="Tomb Raider King")), \
             patch.object(script.nyaa, "search_raw_title_candidates", return_value=[{
                 "title": JPN, "link": "https://nyaa.si/download/99.torrent",
                 "nyaa:seeders": "89", "nyaa:size": "1.3 GiB", "pubDate": "d",
                 "audio_rank": AUDIO_JPN_EXPLICIT, "audio_label": LABEL_JPN,
                 "subtitle_rank": SUB_ENG_DECLARED, "subtitle_label": LABEL_SUB_ENG}]):
            report = script.build_report(184356, apply=True, enroll=True)
    finally:
        release_prefs.delete(184356)

    assert report["enrolled"] is True
    assert report["requireJapaneseAudio"] is True
    assert report["applied"] == [5]


def test_replacement_ignores_a_higher_seeded_release_of_another_episode():
    """The ep-11 release must never be chosen when the request is for episode 8."""
    script = _import_script()
    from animu.models import OfflineAnime
    from animu.prefs import release_prefs

    ep8 = "[ToonsHub] Tomb Raider King S01E08 1080p CR WEB-DL AAC2.0 H.264 (Dogulwang, Multi-Subs, Japanese Dub)"
    ep11_higher_seed = ("[ToonsHub] Tomb Raider King S01E11 1080p CR WEB-DL AAC2.0 H.264 "
                        "(Dogulwang, Multi-Subs, Japanese Dub)")
    pool = [
        {"title": ep11_higher_seed, "link": "http://x/11.torrent", "nyaa:seeders": "9000",
         "nyaa:size": "1G", "pubDate": "d"},
        {"title": ep8, "link": "http://x/08.torrent", "nyaa:seeders": "5",
         "nyaa:size": "1G", "pubDate": "d"},
    ]
    release_prefs.set(184356, require_japanese_audio=True, require_english_subs=True)
    try:
        with patch.object(script.nyaa, "search_raw_title_candidates", return_value=pool):
            found = script._find_replacement(["Tomb Raider King"], 8, True, True)
    finally:
        release_prefs.delete(184356)

    assert found is not None
    assert found["title"] == ep8


def test_candidate_episode_matching():
    script = _import_script()
    ep8 = "[ToonsHub] Tomb Raider King S01E08 1080p CR WEB-DL (Dogulwang, Multi-Subs, Japanese Dub)"
    ep11 = "[ToonsHub] Tomb Raider King S01E11 1080p CR WEB-DL (Dogulwang, Multi-Subs, Japanese Dub)"
    dash8 = "Tomb Raider King (Dogulwang) - 08 (MultiSub) x265 10bit 1080p.mkv"
    assert script._candidate_episode_matches(ep8, 8) is True
    assert script._candidate_episode_matches(ep11, 8) is False
    assert script._candidate_episode_matches(dash8, 8) is True
    assert script._candidate_episode_matches(dash8, 10) is False


def test_format_report_renders_a_replacement_without_crashing():
    script = _import_script()
    report = {
        "mediaId": 184356,
        "titles": ["Tomb Raider King"],
        "requireJapaneseAudio": True,
        "requireEnglishSubs": True,
        "apply": False,
        "enrolled": False,
        "applied": [],
        "entries": [{
            "episode": 5,
            "current": OLD,
            "audioRank": 0,
            "audioLabel": LABEL_UNKNOWN,
            "subtitleRank": SUB_ENG_DECLARED,
            "subtitleLabel": LABEL_SUB_ENG,
            "action": "replace",
            "torrent": "Tomb Raider King - 5",
            "replacement": {
                "title": JPN, "link": "l", "seeders": 89, "size": "1G",
                "audio_rank": AUDIO_JPN_EXPLICIT, "audio_label": LABEL_JPN,
                "subtitle_rank": SUB_ENG_DECLARED, "subtitle_label": LABEL_SUB_ENG,
            },
        }],
    }
    text = script.format_report(report)
    assert "[DRY RUN]" in text
    assert "Japanese Dub" in text and "English Subs" in text
    assert "ep   5" in text



