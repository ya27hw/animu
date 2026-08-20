import anitopy
from animu.config import get_config, ProfileConfig
from animu.utils import verify_query, detect_censorship_status, SCORE_THRESHOLD
from animu.nyaa import NyaaClient

def test_censorship_detection_signals():
    # Explicit Uncensored
    p1 = anitopy.parse("[Ironclad] Ushiro no Shoumen Kamui-san - S01E07 [WEB.1080p.AV1] | KAMUI: He's Behind You (Hardsubs, UNCENSORED) (Weekly)") or {}
    uncen1, cen1 = detect_censorship_status(p1)
    assert uncen1 is True
    assert cen1 is False

    p2 = anitopy.parse("[Erai-raws] Ushiro no Shoumen Kamui-san - 07 [1080p] (Uncensored)") or {}
    uncen2, cen2 = detect_censorship_status(p2)
    assert uncen2 is True
    assert cen2 is False

    p3 = anitopy.parse("[Golumpa] Ushiro no Shoumen Kamui-san - 07 [1080p] [AT-X]") or {}
    uncen3, cen3 = detect_censorship_status(p3)
    assert uncen3 is True
    assert cen3 is False

    p4 = anitopy.parse("[Group] Show Name - 01 [1080p] (UN-CENSORED)") or {}
    uncen4, cen4 = detect_censorship_status(p4)
    assert uncen4 is True
    assert cen4 is False

    p5 = anitopy.parse("[Group] Show Name - 01 [1080p] (Decensored)") or {}
    uncen5, cen5 = detect_censorship_status(p5)
    assert uncen5 is True
    assert cen5 is False

    # Explicit Censored / TV Cut
    p6 = anitopy.parse("[SubsPlease] Ushiro no Shoumen Kamui-san - 07 (1080p) [TV].mkv") or {}
    uncen6, cen6 = detect_censorship_status(p6)
    assert uncen6 is False
    assert cen6 is True

    p7 = anitopy.parse("[Erai-raws] Ushiro no Shoumen Kamui-san - 07 [1080p] (Censored)") or {}
    uncen7, cen7 = detect_censorship_status(p7)
    assert uncen7 is False
    assert cen7 is True


def test_uncensored_beats_censored_for_same_episode():
    config = get_config()
    config.prefer_uncensored = True

    censored_item = {
        "title": "[SubsPlease] Ushiro no Shoumen Kamui-san - 07 (1080p) [12345678].mkv",
        "pubDate": "Tue, 28 Jul 2026 00:00:00 GMT",
        "nyaa:seeders": "100",
        "link": "http://nyaa.si/download/1.torrent"
    }

    uncensored_item = {
        "title": "[Ironclad] Ushiro no Shoumen Kamui-san - S01E07 [WEB.1080p.AV1] | KAMUI: He's Behind You (Hardsubs, UNCENSORED) (Weekly)",
        "pubDate": "Tue, 28 Jul 2026 00:00:00 GMT",
        "nyaa:seeders": "50",
        "link": "http://nyaa.si/download/2.torrent"
    }

    nyaa_client = NyaaClient()
    # List has censored item first (higher seeders)
    items = [censored_item, uncensored_item]

    best = nyaa_client.get_best_torrent(
        items,
        'Ushiro no Shoumen Kamui-san "07"',
        "EPISODE",
        False,
        {"nodes": []},
        True,
        0,
        7
    )

    assert best is not None
    assert best["title"] == uncensored_item["title"]


def test_censored_only_accepted_when_no_uncensored_exists():
    config = get_config()
    config.prefer_uncensored = True

    censored_item = {
        "title": "[SubsPlease] Ushiro no Shoumen Kamui-san - 07 (1080p) [12345678].mkv",
        "pubDate": "Tue, 28 Jul 2026 00:00:00 GMT",
        "nyaa:seeders": "100",
        "link": "http://nyaa.si/download/1.torrent"
    }

    nyaa_client = NyaaClient()
    items = [censored_item]

    best = nyaa_client.get_best_torrent(
        items,
        'Ushiro no Shoumen Kamui-san "07"',
        "EPISODE",
        False,
        {"nodes": []},
        True,
        0,
        7
    )

    assert best is not None
    assert best["title"] == censored_item["title"]


def test_prefer_uncensored_config_toggle():
    config = get_config()
    assert config.prefer_uncensored is True

    parsed_cen = anitopy.parse("[SubsPlease] Ushiro no Shoumen Kamui-san - 07 (1080p) [TV].mkv") or {}
    parsed_uncen = anitopy.parse("[Ironclad] Ushiro no Shoumen Kamui-san - S01E07 [WEB.1080p.AV1] | KAMUI: He's Behind You (Hardsubs, UNCENSORED) (Weekly)") or {}

    # When prefer_uncensored is True
    config.prefer_uncensored = True
    score_uncen, d_uncen = verify_query('Ushiro no Shoumen Kamui-san "07"', parsed_uncen, "1080p", "EPISODE", "Tue, 28 Jul 2026 00:00:00 GMT", {"nodes": []}, True, 0, 7, verbose=True)
    score_cen, d_cen = verify_query('Ushiro no Shoumen Kamui-san "07"', parsed_cen, "1080p", "EPISODE", "Tue, 28 Jul 2026 00:00:00 GMT", {"nodes": []}, True, 0, 7, verbose=True)

    assert score_uncen > score_cen
    assert d_uncen["uncensored_bonus"] == 0.5
    assert d_cen["uncensored_bonus"] == -0.2

    # When prefer_uncensored is False
    config.prefer_uncensored = False
    score_uncen_off, d_uncen_off = verify_query('Ushiro no Shoumen Kamui-san "07"', parsed_uncen, "1080p", "EPISODE", "Tue, 28 Jul 2026 00:00:00 GMT", {"nodes": []}, True, 0, 7, verbose=True)
    score_cen_off, d_cen_off = verify_query('Ushiro no Shoumen Kamui-san "07"', parsed_cen, "1080p", "EPISODE", "Tue, 28 Jul 2026 00:00:00 GMT", {"nodes": []}, True, 0, 7, verbose=True)

    assert d_uncen_off["uncensored_bonus"] == 0.0
    assert d_cen_off["uncensored_bonus"] == 0.0

    # Reset config
    config.prefer_uncensored = True


def test_uncensored_with_resolution_or_episode_mismatch_is_rejected():
    config = get_config()
    config.prefer_uncensored = True

    # Uncensored release but wrong episode (episode 08 when episode 07 wanted)
    parsed_wrong_ep = anitopy.parse("[Ironclad] Ushiro no Shoumen Kamui-san - S01E08 [WEB.1080p.AV1] (UNCENSORED)") or {}
    score_wrong_ep, _ = verify_query('Ushiro no Shoumen Kamui-san "07"', parsed_wrong_ep, "1080p", "EPISODE", "Tue, 28 Jul 2026 00:00:00 GMT", {"nodes": []}, True, 0, 7, verbose=True)
    assert score_wrong_ep < SCORE_THRESHOLD

    # Uncensored release but wrong resolution (720p when 1080p wanted)
    parsed_wrong_res = anitopy.parse("[Ironclad] Ushiro no Shoumen Kamui-san - S01E07 [WEB.720p.AV1] (UNCENSORED)") or {}
    score_wrong_res, _ = verify_query('Ushiro no Shoumen Kamui-san "07"', parsed_wrong_res, "1080p", "EPISODE", "Tue, 28 Jul 2026 00:00:00 GMT", {"nodes": []}, True, 0, 7, verbose=True)
    assert score_wrong_res < SCORE_THRESHOLD


def test_batch_mode_uncensored_priority():
    config = get_config()
    config.prefer_uncensored = True

    censored_batch = {
        "title": "[SubsPlease] Hakata Tonkotsu Ramens - 01-12 (1080p) [TV] [ABCD1234].mkv",
        "pubDate": "Tue, 28 Jul 2026 00:00:00 GMT",
        "nyaa:seeders": "100",
        "link": "http://nyaa.si/download/batch1.torrent"
    }

    uncensored_batch = {
        "title": "[Ironclad] Hakata Tonkotsu Ramens - 01-12 (1080p) (UNCENSORED) [ABCD1234].mkv",
        "pubDate": "Tue, 28 Jul 2026 00:00:00 GMT",
        "nyaa:seeders": "50",
        "link": "http://nyaa.si/download/batch2.torrent"
    }

    nyaa_client = NyaaClient()
    items = [censored_batch, uncensored_batch]

    best = nyaa_client.get_best_torrent(
        items,
        "Hakata Tonkotsu Ramens",
        "BATCH",
        False,
        {"nodes": []},
        True,
        0,
        1, 12
    )

    assert best is not None
    assert best["title"] == uncensored_batch["title"]
