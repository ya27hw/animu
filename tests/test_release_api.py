"""Search API payloads must carry audio + subtitle labels and per-anime prefs."""
from unittest.mock import patch

from animu.web import AnimuHTTPHandler, enrich_media_with_local_state


def _handler():
    return AnimuHTTPHandler.__new__(AnimuHTTPHandler)


def test_raw_search_payload_carries_track_labels():
    handler = _handler()
    raw = [{"title": "Show S01E01 (Multi-Subs, Japanese Dub)", "link": "l",
            "nyaa:seeders": "5", "nyaa:size": "1G", "pubDate": "d",
            "audio_rank": 2, "audio_label": "Japanese Dub",
            "subtitle_rank": 2, "subtitle_label": "English Subs"}]
    with patch("animu.web.nyaa.search_raw_title_candidates", return_value=raw):
        payload = handler.build_raw_search_payload("Show", False)
    assert payload["results"][0]["audioRank"] == 2
    assert payload["results"][0]["audioLabel"] == "Japanese Dub"
    assert payload["results"][0]["subtitleLabel"] == "English Subs"


def test_episode_search_payload_carries_track_labels():
    handler = _handler()
    cands = [{"title": "Show S01E01", "link": "l", "nyaa:seeders": "5", "nyaa:size": "1G",
              "pubDate": "d", "score": 4.0, "details": {},
              "audio_rank": 1, "audio_label": "Multi/Dual Audio (incl. Japanese)",
              "subtitle_rank": 0, "subtitle_label": "Non-English Subs"}]
    with patch("animu.web.nyaa.search_episode_candidates", return_value=cands):
        payload = handler.build_episode_search_payload(
            {"mediaId": 1, "media": {"title": {"romaji": "Show"}}}, 1, 0, None, 1
        )
    assert payload["results"][0]["audioRank"] == 1
    assert payload["results"][0]["audioLabel"] == "Multi/Dual Audio (incl. Japanese)"
    assert payload["results"][0]["subtitleRank"] == 0


def test_enrich_exposes_per_anime_requirements():
    from animu.database import db
    from animu.models import OfflineAnime
    from animu.prefs import release_prefs

    media_id = 987654
    db.upsert(media_id, OfflineAnime(media_id=media_id))
    release_prefs.set(media_id, require_japanese_audio=True, require_english_subs=True)
    try:
        enriched = enrich_media_with_local_state({"id": media_id, "title": {"romaji": "Web Test"}})
        assert enriched["localState"]["requireJapaneseAudio"] is True
        assert enriched["localState"]["requireEnglishSubs"] is True
    finally:
        release_prefs.delete(media_id)
        db.delete(media_id)
