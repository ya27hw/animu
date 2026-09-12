import pytest
from unittest.mock import MagicMock, patch
from animu.config import get_config, ProfileConfig
from animu.release_groups import (
    RELEASE_GROUP_TABLE,
    DEAD_GROUPS,
    UNKNOWN_GROUP_SCORE,
    detect_release_group,
    get_group_score,
    get_group_tier,
    normalize_group_name,
    is_attribute_token,
    select_best_candidate,
)
from animu.nyaa import NyaaClient
from animu.models import OfflineAnime
from animu.database import Database
from animu.scheduler import Scheduler


# ---------------------------------------------------------------------------
# 1. Detection on real title formats (including 3 that plain anitopy misses)
# ---------------------------------------------------------------------------

def test_detection_plain_anitopy_missed_formats():
    # 1. Scene suffix with dots and MULTi
    t1 = "Frieren.Beyond.Journeys.End.S02E01...1080p.CR.WEB-DL.MULTi.AAC2.0.H.264-VARYG.mkv"
    assert detect_release_group(t1) == "VARYG"

    # 2. Scene suffix with spaces and web-dl
    t2 = "Show Name S01E03 1080p AMZN WEB-DL DDP2.0 H.264-ASW.mkv"
    assert detect_release_group(t2) == "ASW"

    # 3. Leading [Hi10] where anitopy treats Hi10 as a video term
    t3 = "[Hi10] Show Name [BD 1080p][x264][10bit].mkv"
    assert detect_release_group(t3) == "Hi10"


# ---------------------------------------------------------------------------
# 2. Attribute-bracket rejection
# ---------------------------------------------------------------------------

def test_detection_attribute_bracket_rejection():
    assert detect_release_group("[1080p] Show Name - 01.mkv") is None
    assert detect_release_group("[Batch] Show Name (01-12).mkv") is None
    assert detect_release_group("[Multi-Subs] Show Name - 01.mkv") is None
    assert detect_release_group("[BD 1080p] Show Name - 01.mkv") is None
    assert detect_release_group("[12345678] Show Name - 01.mkv") is None
    assert detect_release_group("[2026] Show Name - 01.mkv") is None


def test_is_attribute_token():
    assert is_attribute_token("1080p") is True
    assert is_attribute_token("Batch") is True
    assert is_attribute_token("Multi-Subs") is True
    assert is_attribute_token("BD") is True
    assert is_attribute_token("HEVC") is True
    assert is_attribute_token("12345678") is True
    # Known groups are never attributes
    assert is_attribute_token("SubsPlease") is False
    assert is_attribute_token("Hi10") is False
    assert is_attribute_token("CRUCiBLE") is False


# ---------------------------------------------------------------------------
# 3. Aliases and case normalization
# ---------------------------------------------------------------------------

def test_alias_normalization():
    assert detect_release_group("[Varyg] Show Name - 01 (1080p).mkv") == "VARYG"
    assert detect_release_group("[Ember] Show Name - 01 (1080p).mkv") == "EMBER"
    assert detect_release_group("[Hi10Anime] Show Name - 01 (1080p).mkv") == "Hi10"
    assert detect_release_group("[AnimeTime] Show Name - 01 (1080p).mkv") == "Anime Time"
    assert detect_release_group("[Beatrice] Show Name - 01 (1080p).mkv") == "Beatrice-Raws"
    assert detect_release_group("[miniMTBB] Show Name - 01 (1080p).mkv") == "MiniMTBB"
    assert normalize_group_name("subsplease") == "SubsPlease"
    assert normalize_group_name("ERAI-RAWS") == "Erai-raws"


# ---------------------------------------------------------------------------
# 4. Tier table integrity
# ---------------------------------------------------------------------------

def test_tier_table_integrity():
    assert len(RELEASE_GROUP_TABLE) == 49
    assert DEAD_GROUPS == ["HorribleSubs"]
    assert UNKNOWN_GROUP_SCORE == 45.0

    # Verify score strictly above UNKNOWN_GROUP_SCORE
    for name, score, scope, conf in RELEASE_GROUP_TABLE:
        assert score > UNKNOWN_GROUP_SCORE, f"{name} score {score} <= {UNKNOWN_GROUP_SCORE}"
        assert scope in ("weekly", "catalog", "both")
        assert conf in ("verified", "reported", "unsourced")

    # HorribleSubs is dead -> 0.0
    assert get_group_score("HorribleSubs") == 0.0
    assert get_group_tier("HorribleSubs") == "Dead"

    # Unknown group gets UNKNOWN_GROUP_SCORE
    assert get_group_score("CompletelyUnknownGroupXYZ") == UNKNOWN_GROUP_SCORE
    assert get_group_tier("CompletelyUnknownGroupXYZ") == "C"

    # Overrides work
    assert get_group_score("ToonsHub", {"ToonsHub": "S"}) == 95.0
    assert get_group_score("Judas", {"Judas": 99.0}) == 99.0


# ---------------------------------------------------------------------------
# 5. Exact 4-step reference story (sticky -> upgrade -> ignore -> fallback)
# ---------------------------------------------------------------------------

def test_four_step_reference_story_end_to_end():
    client = NyaaClient()
    cfg = get_config()
    cfg.prefer_release_group = True
    cfg.release_group_upgrade_margin = 0.0

    # Step 1: Ep 1 - only ToonsHub available
    toons_ep1 = {
        "title": "[ToonsHub] My Hero Academia - 01 (1080p) CR WEB-DL MULTi",
        "pubDate": "Sat, 04 May 2026 10:00:00 GMT",
        "nyaa:seeders": "150",
        "link": "http://nyaa.si/download/toons_01.torrent"
    }
    res1 = client.get_best_torrent(
        [toons_ep1],
        'My Hero Academia "01"',
        "EPISODE",
        False,
        {"nodes": []},
        True,
        0,
        1,
        preferred_release_group=None
    )
    assert res1 is not None
    assert res1["release_group"] == "ToonsHub"
    assert res1["preferred_release_group"] == "ToonsHub"
    assert res1["release_group_misses"] == 0
    stored_pref = res1["preferred_release_group"]

    # Step 2: Ep 2 - SubsPlease (higher tier, 95 > 82) appears alongside ToonsHub
    toons_ep2 = {
        "title": "[ToonsHub] My Hero Academia - 02 (1080p) CR WEB-DL MULTi",
        "pubDate": "Sat, 11 May 2026 10:00:00 GMT",
        "nyaa:seeders": "200",
        "link": "http://nyaa.si/download/toons_02.torrent"
    }
    subs_ep2 = {
        "title": "[SubsPlease] My Hero Academia - 02 (1080p) [ABCD1234].mkv",
        "pubDate": "Sat, 11 May 2026 10:05:00 GMT",
        "nyaa:seeders": "180",
        "link": "http://nyaa.si/download/subs_02.torrent"
    }
    res2 = client.get_best_torrent(
        [toons_ep2, subs_ep2],
        'My Hero Academia "02"',
        "EPISODE",
        False,
        {"nodes": []},
        True,
        0,
        2,
        preferred_release_group=stored_pref,
        release_group_misses=0
    )
    assert res2 is not None
    assert res2["release_group"] == "SubsPlease"
    assert res2["preferred_release_group"] == "SubsPlease"
    assert res2["preference_switched"] is True
    assert res2["release_group_misses"] == 0
    stored_pref = res2["preferred_release_group"]

    # Step 3: Later ep (Ep 3) - ToonsHub is ignored while SubsPlease keeps releasing
    toons_ep3 = {
        "title": "[ToonsHub] My Hero Academia - 03 (1080p) CR WEB-DL MULTi",
        "pubDate": "Sat, 18 May 2026 10:00:00 GMT",
        "nyaa:seeders": "300",  # higher seeders than SubsPlease!
        "link": "http://nyaa.si/download/toons_03.torrent"
    }
    subs_ep3 = {
        "title": "[SubsPlease] My Hero Academia - 03 (1080p) [ABCD1234].mkv",
        "pubDate": "Sat, 18 May 2026 10:05:00 GMT",
        "nyaa:seeders": "120",
        "link": "http://nyaa.si/download/subs_03.torrent"
    }
    res3 = client.get_best_torrent(
        [toons_ep3, subs_ep3],
        'My Hero Academia "03"',
        "EPISODE",
        False,
        {"nodes": []},
        True,
        0,
        3,
        preferred_release_group=stored_pref,
        release_group_misses=0
    )
    assert res3 is not None
    assert res3["release_group"] == "SubsPlease"
    assert res3["preferred_release_group"] == "SubsPlease"
    assert res3["preference_switched"] is False
    assert res3["release_group_misses"] == 0

    # Step 4: Ep 4 - SubsPlease skips; only ToonsHub available -> fallback without forgetting
    toons_ep4 = {
        "title": "[ToonsHub] My Hero Academia - 04 (1080p) CR WEB-DL MULTi",
        "pubDate": "Sat, 25 May 2026 10:00:00 GMT",
        "nyaa:seeders": "150",
        "link": "http://nyaa.si/download/toons_04.torrent"
    }
    res4 = client.get_best_torrent(
        [toons_ep4],
        'My Hero Academia "04"',
        "EPISODE",
        False,
        {"nodes": []},
        True,
        0,
        4,
        preferred_release_group=stored_pref,
        release_group_misses=0
    )
    assert res4 is not None
    # Downloaded ToonsHub
    assert res4["release_group"] == "ToonsHub"
    # Preference still SubsPlease (never forgotten!)
    assert res4["preferred_release_group"] == "SubsPlease"
    assert res4["release_group_misses"] == 1
    assert res4["preference_switched"] is False

    # Ep 5: SubsPlease returns on Ep 5 -> picked, misses reset to 0
    toons_ep5 = {
        "title": "[ToonsHub] My Hero Academia - 05 (1080p) CR WEB-DL MULTi",
        "pubDate": "Sat, 01 Jun 2026 10:00:00 GMT",
        "nyaa:seeders": "500",
        "link": "http://nyaa.si/download/toons_05.torrent"
    }
    subs_ep5 = {
        "title": "[SubsPlease] My Hero Academia - 05 (1080p) [ABCD1234].mkv",
        "pubDate": "Sat, 01 Jun 2026 10:05:00 GMT",
        "nyaa:seeders": "150",
        "link": "http://nyaa.si/download/subs_05.torrent"
    }
    res5 = client.get_best_torrent(
        [toons_ep5, subs_ep5],
        'My Hero Academia "05"',
        "EPISODE",
        False,
        {"nodes": []},
        True,
        0,
        5,
        preferred_release_group=stored_pref,
        release_group_misses=1
    )
    assert res5 is not None
    assert res5["release_group"] == "SubsPlease"
    assert res5["preferred_release_group"] == "SubsPlease"
    assert res5["release_group_misses"] == 0


# ---------------------------------------------------------------------------
# 6. Monotonic no-downgrade by default & downgrade after N misses option
# ---------------------------------------------------------------------------

def test_monotonic_no_downgrade_and_opt_in():
    cfg = get_config()
    cfg.prefer_release_group = True

    # Default: downgrade_after_misses == 0 -> never downgrades
    cfg.release_group_downgrade_after_misses = 0
    cand_toons = {
        "title": "[ToonsHub] Show - 01 (1080p).mkv",
        "rating": 4.0,
        "seeders": 10,
        "release_group": "ToonsHub",
        "group_score": 82.0,
        "censorship_class": 1,
        "item": {"title": "item1"},
        "details": {}
    }
    res = select_best_candidate(
        [cand_toons],
        preferred_release_group="SubsPlease",
        release_group_misses=5,
        downgrade_after_misses=0
    )
    assert res["release_group"] == "ToonsHub"
    assert res["preferred_release_group"] == "SubsPlease"
    assert res["release_group_misses"] == 6

    # Opt-in downgrade: downgrade_after_misses == 2
    res_downgrade = select_best_candidate(
        [cand_toons],
        preferred_release_group="SubsPlease",
        release_group_misses=1,  # becomes 2 >= 2 -> downgrades!
        downgrade_after_misses=2
    )
    assert res_downgrade["release_group"] == "ToonsHub"
    assert res_downgrade["preferred_release_group"] == "ToonsHub"
    assert res_downgrade["release_group_misses"] == 0
    assert res_downgrade["preference_switched"] is True


# ---------------------------------------------------------------------------
# 7. Excluded groups cannot be chosen or stored
# ---------------------------------------------------------------------------

def test_excluded_groups_never_chosen_or_stored():
    cand_subs = {
        "title": "[SubsPlease] Show - 01 (1080p).mkv",
        "rating": 4.5,
        "seeders": 100,
        "release_group": "SubsPlease",
        "group_score": 95.0,
        "censorship_class": 1,
        "item": {"title": "subs_item"},
        "details": {}
    }
    cand_toons = {
        "title": "[ToonsHub] Show - 01 (1080p).mkv",
        "rating": 4.0,
        "seeders": 50,
        "release_group": "ToonsHub",
        "group_score": 82.0,
        "censorship_class": 1,
        "item": {"title": "toons_item"},
        "details": {}
    }

    # SubsPlease is in exclude_groups
    res = select_best_candidate(
        [cand_subs, cand_toons],
        preferred_release_group=None,
        exclude_groups=["SubsPlease"]
    )
    assert res is not None
    assert res["release_group"] == "ToonsHub"
    assert res["preferred_release_group"] == "ToonsHub"

    # Both excluded -> returns None
    res_none = select_best_candidate(
        [cand_subs, cand_toons],
        preferred_release_group=None,
        exclude_groups=["SubsPlease", "ToonsHub"]
    )
    assert res_none is None


# ---------------------------------------------------------------------------
# 8. Non-qualifying preferred group release is never chosen
# ---------------------------------------------------------------------------

def test_non_qualifying_preferred_group_never_chosen():
    client = NyaaClient()
    # Preferred is SubsPlease, but only wrong-episode or wrong-resolution exist for SubsPlease
    wrong_ep_subs = {
        "title": "[SubsPlease] Show Name - 08 (1080p) [12345678].mkv",  # ep 08 instead of 07
        "pubDate": "Sat, 18 May 2026 10:05:00 GMT",
        "nyaa:seeders": "100",
        "link": "http://nyaa.si/download/subs_wrong.torrent"
    }
    good_toons = {
        "title": "[ToonsHub] Show Name S01E07 1080p CR WEB-DL MULTi",  # correct ep 07
        "pubDate": "Sat, 18 May 2026 10:00:00 GMT",
        "nyaa:seeders": "50",
        "link": "http://nyaa.si/download/toons_good.torrent"
    }

    res = client.get_best_torrent(
        [wrong_ep_subs, good_toons],
        'Show Name "07"',
        "EPISODE",
        False,
        {"nodes": []},
        True,
        0,
        7,
        preferred_release_group="SubsPlease"
    )

    assert res is not None
    assert res["title"] == good_toons["title"]
    assert res["release_group"] == "ToonsHub"
    # Preference remains SubsPlease
    assert res["preferred_release_group"] == "SubsPlease"


# ---------------------------------------------------------------------------
# 9. Batch mode honours preference
# ---------------------------------------------------------------------------

def test_batch_mode_honours_preference():
    client = NyaaClient()
    cfg = get_config()
    cfg.prefer_release_group = True

    toons_batch = {
        "title": "[ToonsHub] Show Name S01 (01-12) 1080p CR WEB-DL MULTi",
        "pubDate": "Sat, 18 May 2026 10:00:00 GMT",
        "nyaa:seeders": "200",
        "link": "http://nyaa.si/download/toons_batch.torrent"
    }
    subs_batch = {
        "title": "[SubsPlease] Show Name (01-12) (1080p) [Batch]",
        "pubDate": "Sat, 18 May 2026 10:00:00 GMT",
        "nyaa:seeders": "100",
        "link": "http://nyaa.si/download/subs_batch.torrent"
    }

    # When SubsPlease is preferred
    res_subs = client.get_best_torrent(
        [toons_batch, subs_batch],
        "Show Name",
        "BATCH",
        False,
        {"nodes": []},
        True,
        0,
        12,
        preferred_release_group="SubsPlease"
    )
    assert res_subs is not None
    assert res_subs["title"] == subs_batch["title"]
    assert res_subs["release_group"] == "SubsPlease"

    # When ToonsHub is preferred
    res_toons = client.get_best_torrent(
        [toons_batch, subs_batch],
        "Show Name",
        "BATCH",
        False,
        {"nodes": []},
        True,
        0,
        12,
        preferred_release_group="ToonsHub"
    )
    assert res_toons is not None
    # Note: SubsPlease has higher tier score (95 > 82) so with upgrade_margin 0 it upgrades!
    assert res_toons["release_group"] == "SubsPlease"


# ---------------------------------------------------------------------------
# 10. Censorship precedence over group tier
# ---------------------------------------------------------------------------

def test_censorship_precedence_over_group_tier():
    # SubsPlease (score 95, censored) vs Ironclad (score 65, uncensored)
    cand_censored_subs = {
        "title": "[SubsPlease] Kamui-san - 01 (1080p) [TV].mkv",
        "rating": 4.0,
        "seeders": 200,
        "release_group": "SubsPlease",
        "group_score": 95.0,
        "censorship_class": 0,  # censored
        "item": {"title": "subs_censored"},
        "details": {}
    }
    cand_uncensored_iron = {
        "title": "[Ironclad] Kamui-san - S01E01 1080p (UNCENSORED)",
        "rating": 4.0,
        "seeders": 50,
        "release_group": "Ironclad",
        "group_score": 65.0,
        "censorship_class": 2,  # uncensored
        "item": {"title": "iron_uncensored"},
        "details": {}
    }

    res = select_best_candidate(
        [cand_censored_subs, cand_uncensored_iron],
        preferred_release_group=None,
        prefer_uncensored=True
    )
    assert res is not None
    assert res["release_group"] == "Ironclad"


# ---------------------------------------------------------------------------
# 11. Unknown group scores below every listed group
# ---------------------------------------------------------------------------

def test_unknown_group_scores_below_every_listed():
    for name, score, _, _ in RELEASE_GROUP_TABLE:
        assert UNKNOWN_GROUP_SCORE < score

    cand_unknown = {
        "title": "[RandomNewGroup] Show - 01 (1080p).mkv",
        "rating": 4.0,
        "seeders": 100,
        "release_group": "RandomNewGroup",
        "group_score": UNKNOWN_GROUP_SCORE,
        "censorship_class": 1,
        "item": {"title": "item_unknown"},
        "details": {}
    }
    cand_known = {
        "title": "[Cleo] Show - 01 (1080p).mkv",  # lowest listed group: 52
        "rating": 4.0,
        "seeders": 100,
        "release_group": "Cleo",
        "group_score": 52.0,
        "censorship_class": 1,
        "item": {"title": "item_cleo"},
        "details": {}
    }

    res = select_best_candidate([cand_unknown, cand_known], preferred_release_group=None)
    assert res["release_group"] == "Cleo"


# ---------------------------------------------------------------------------
# 12. PocketBase schema probe and group memory persistence
# ---------------------------------------------------------------------------

def test_pb_schema_probe_safeguard(tmp_path):
    db = Database()
    db.local_db_path = str(tmp_path / "test_offline_db.json")

    # Mock _request for schema probe returning standard schema (no preferred_release_group)
    standard_schema_resp = MagicMock()
    standard_schema_resp.status_code = 200
    standard_schema_resp.json.return_value = {
        "schema": [
            {"name": "media_id"},
            {"name": "downloaded_episodes"},
            {"name": "starting_episode"},
            {"name": "alternative_title"},
            {"name": "timeouts"},
            {"name": "max_timeouts"},
            {"name": "pending_rewatching_update"},
        ]
    }

    # Mock records search returning empty (new record)
    empty_records_resp = MagicMock()
    empty_records_resp.status_code = 200
    empty_records_resp.json.return_value = {"items": []}

    # Mock POST record creation
    post_resp = MagicMock()
    post_resp.status_code = 200
    post_resp.json.return_value = {"id": "rec123", "media_id": 999}

    def mock_request(method, path, **kwargs):
        if path == "/api/collections/anime":
            return standard_schema_resp
        if path == "/api/collections/anime/records" and method == "GET":
            return empty_records_resp
        if path == "/api/collections/anime/records" and method == "POST":
            # Assert payload does NOT contain preferred_release_group because PB schema does not have it!
            sent_payload = kwargs.get("json", {})
            assert "preferred_release_group" not in sent_payload
            assert "release_group_misses" not in sent_payload
            return post_resp
        raise NotImplementedError(f"{method} {path}")

    db._request = mock_request

    anime_data = OfflineAnime(
        media_id=999,
        preferred_release_group="SubsPlease",
        release_group_misses=0
    )
    db.upsert(999, anime_data)

    # Local cache MUST have it!
    cached = db.local_cache.get("999")
    assert cached["preferred_release_group"] == "SubsPlease"


def test_pb_schema_probe_sends_when_supported(tmp_path):
    db = Database()
    db.local_db_path = str(tmp_path / "test_offline_db2.json")

    # Schema probe returning enriched schema
    enriched_schema_resp = MagicMock()
    enriched_schema_resp.status_code = 200
    enriched_schema_resp.json.return_value = {
        "schema": [
            {"name": "media_id"},
            {"name": "preferred_release_group"},
            {"name": "release_group_misses"},
        ]
    }

    empty_records_resp = MagicMock()
    empty_records_resp.status_code = 200
    empty_records_resp.json.return_value = {"items": []}

    post_resp = MagicMock()
    post_resp.status_code = 200
    post_resp.json.return_value = {
        "id": "rec456",
        "media_id": 888,
        "preferred_release_group": "SubsPlease",
        "release_group_misses": 0
    }

    def mock_request(method, path, **kwargs):
        if path == "/api/collections/anime":
            return enriched_schema_resp
        if path == "/api/collections/anime/records" and method == "GET":
            return empty_records_resp
        if path == "/api/collections/anime/records" and method == "POST":
            # Assert payload DOES contain preferred_release_group!
            sent_payload = kwargs.get("json", {})
            assert sent_payload.get("preferred_release_group") == "SubsPlease"
            return post_resp
        raise NotImplementedError(f"{method} {path}")

    db._request = mock_request

    anime_data = OfflineAnime(
        media_id=888,
        preferred_release_group="SubsPlease",
        release_group_misses=0
    )
    db.upsert(888, anime_data)


# ---------------------------------------------------------------------------
# 13. Monkeypatched scheduler pass asserting persisted preferred group
# ---------------------------------------------------------------------------

def test_scheduler_persists_preferred_release_group(tmp_path):
    scheduler = Scheduler()
    anime_entry = {
        "mediaId": 12345,
        "progress": 0,
        "media": {
            "title": {"romaji": "Test Anime"},
            "status": "RELEASING",
            "nextAiringEpisode": {"episode": 2},
            "coverImage": {"extraLarge": "http://example.com/img.jpg"},
            "episodes": 12
        }
    }
    record = OfflineAnime(media_id=12345, preferred_release_group="")

    mock_torrents = [{
        "title": "[ToonsHub] Test Anime - 01 (1080p).mkv",
        "link": "http://nyaa.si/download/123.torrent",
        "pubDate": "Sat, 18 May 2026 10:00:00 GMT",
        "nyaa:seeders": "100",
        "nyaa:size": "1.2 GiB",
        "episode": 1,
        "release_group": "ToonsHub",
        "group_score": 82.0,
        "preferred_release_group": "ToonsHub",
        "release_group_misses": 0,
        "preference_switched": True
    }]

    with patch("animu.scheduler.nyaa.get_torrents", return_value=mock_torrents), \
         patch("animu.scheduler.qbit.add_check_torrent", return_value=True), \
         patch("animu.scheduler.send_anime_downloaded_hook"), \
         patch("animu.scheduler.db.upsert") as mock_upsert:

        scheduler.handle_anime(anime_entry, record)

        assert record.preferred_release_group == "ToonsHub"
        assert record.release_group_misses == 0
        assert 1 in record.downloaded_episodes
        assert mock_upsert.called


# ---------------------------------------------------------------------------
# 14. Positional backward compatibility of get_best_torrent
# ---------------------------------------------------------------------------

def test_positional_backward_compatibility():
    client = NyaaClient()
    item = {
        "title": "[SubsPlease] Show Name - 07 (1080p) [12345678].mkv",
        "pubDate": "Sat, 18 May 2026 10:05:00 GMT",
        "nyaa:seeders": "100",
        "link": "http://nyaa.si/download/subs.torrent"
    }
    # Call positionally with 8 positional args (last is *episodes)
    best = client.get_best_torrent(
        [item],
        'Show Name "07"',
        "EPISODE",
        False,
        {"nodes": []},
        True,
        0,
        7
    )
    assert best is not None
    assert best["title"] == item["title"]
    assert best["release_group"] == "SubsPlease"
    assert best["group_score"] == 95.0


# ---------------------------------------------------------------------------
# 15. Web API /api/anime exposes preferred release group & enrich local state
# ---------------------------------------------------------------------------

def test_web_api_exposes_preferred_release_group():
    from animu.web import AnimuHTTPHandler, enrich_media_with_local_state
    from animu.database import db

    test_mid = 777888
    rec = OfflineAnime(media_id=test_mid, preferred_release_group="SubsPlease", release_group_misses=2)
    db.upsert(test_mid, rec)

    try:
        # Test enrich_media_with_local_state
        media_item = {"id": test_mid, "title": {"romaji": "Web Test Show"}}
        enriched = enrich_media_with_local_state(media_item)
        assert enriched["localState"]["preferredReleaseGroup"] == "SubsPlease"
        assert enriched["localState"]["releaseGroupMisses"] == 2

        # Test get_anime_list
        handler = AnimuHTTPHandler.__new__(AnimuHTTPHandler)
        with patch("animu.web.anilist.get_anime_user_list", return_value=[{"mediaId": test_mid, "media": {"title": {"romaji": "Web Test Show"}}}]):
            anime_list = handler.get_anime_list()
            assert len(anime_list) == 1
            entry = anime_list[0]
            assert entry["preferredReleaseGroup"] == "SubsPlease"
            assert entry["releaseGroupMisses"] == 2
            assert entry["media"]["preferredReleaseGroup"] == "SubsPlease"
    finally:
        db.delete(test_mid)
