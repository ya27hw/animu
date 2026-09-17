import anitopy
from unittest.mock import MagicMock, patch

from animu.utils import verify_query, SCORE_THRESHOLD
from animu.nyaa import NyaaClient


def test_published_episode_is_accepted_when_anilist_schedule_is_missing():
    parsed = anitopy.parse("[SubsPlease] Hyakkano - 25 (1080p) [17F5B72C].mkv") or {}

    score, details = verify_query(
        'Hyakkano "25"',
        parsed,
        "1080p",
        "EPISODE",
        "Tue, 28 Jul 2026 00:00:00 GMT",
        {"nodes": []},
        False,
        25,
        verbose=True,
    )

    assert score == 4.0
    assert details["episode_match"] is True
    assert details["resolution_match"] is True
    assert details["air_date_match"] is True


def test_batch_candidate_does_not_crash_on_score_threshold():
    parsed = anitopy.parse(
        "[SubsPlease] Hakata Tonkotsu Ramens - 01-12 (1080p) [ABCD1234].mkv"
    ) or {}

    score, details = verify_query(
        "Hakata Tonkotsu Ramens",
        parsed,
        "1080p",
        "BATCH",
        "Tue, 28 Jul 2026 00:00:00 GMT",
        {"nodes": []},
        False,
        12,
        verbose=True,
    )

    assert isinstance(score, float)
    # The BATCH branch must return batch verification details, not crash.
    assert "batch_range_match" in details or "is_batch" in details


def test_nyaa_ep01_query_generation_season1_vs_multi_season():
    """Verify episode 1 of season-1 shows uses S01E01 query format, while ep > 1 and multi-season keep quoted format."""
    client = NyaaClient()

    # Case 1: Season 1 show (Tomb Raider King / Dogul Wang)
    s1_anime = {
        "mediaId": 184356,
        "media": {
            "title": {"romaji": "Dogul Wang", "english": "Tomb Raider King"},
            "status": "RELEASING"
        }
    }
    captured_queries = []

    def mock_fetch(query, search_url, enable_proxy):
        captured_queries.append(query)
        return {"status": 200, "data": []}

    with patch.object(client, "fetch_rss_feed", side_effect=mock_fetch), \
         patch.object(client, "get_episode_air_dates", return_value={"nodes": []}):

        client.get_torrents(
            anime=s1_anime,
            start_episode=0,
            end_episode=2,
            starting_episode=0,
            downloaded_episodes=[],
            alt_anime_title="Tomb Raider King"
        )

    assert captured_queries == ['Tomb Raider King S01E01', 'Tomb Raider King "02"']

    # Case 2: Multi-season show (Mob Psycho 100 II) must not be misdirected to S01E01
    s2_anime = {
        "mediaId": 202,
        "media": {
            "title": {"romaji": "Mob Psycho 100 II"},
            "status": "RELEASING"
        }
    }
    captured_queries.clear()

    with patch.object(client, "fetch_rss_feed", side_effect=mock_fetch), \
         patch.object(client, "get_episode_air_dates", return_value={"nodes": []}):

        client.get_torrents(
            anime=s2_anime,
            start_episode=0,
            end_episode=2,
            starting_episode=0,
            downloaded_episodes=[]
        )

    assert captured_queries == ['Mob Psycho 100 II "01"', 'Mob Psycho 100 II "02"']

    # Case 3: Show with starting_episode offset (e.g., episode 1 is release episode 13)
    captured_queries.clear()

    with patch.object(client, "fetch_rss_feed", side_effect=mock_fetch), \
         patch.object(client, "get_episode_air_dates", return_value={"nodes": []}):

        client.get_torrents(
            anime=s1_anime,
            start_episode=0,
            end_episode=2,
            starting_episode=12,
            downloaded_episodes=[],
            alt_anime_title="Tomb Raider King"
        )

    assert captured_queries == ['Tomb Raider King "13"', 'Tomb Raider King "14"']


def test_nyaa_ep01_real_world_titles_match_score_threshold():
    """Verify real-world Tomb Raider King S01E01 titles score >= SCORE_THRESHOLD and are selected by get_best_torrent."""
    client = NyaaClient()

    real_items = [
        {
            "title": "[Feibanyama] Tomb Raider King S01E01 [IQIYI WebRip 2160p HEVC AAC Multi-Subs] (Dogul Wang)",
            "pubDate": "Tue, 28 Jul 2026 00:00:00 GMT",
            "nyaa:seeders": "9",
            "link": "https://nyaa.si/download/18435601.torrent"
        },
        {
            "title": "Tomb Raider King S01E01 Once Again from the End 1080p CR WEB-DL MULTi AAC2.0 H.264-VARYG (Dogul Wang, Multi-Audio, Multi-Subs)",
            "pubDate": "Tue, 28 Jul 2026 00:00:00 GMT",
            "nyaa:seeders": "12",
            "link": "https://nyaa.si/download/18435602.torrent"
        }
    ]

    trace = []
    best = client.get_best_torrent(
        real_items,
        "Tomb Raider King S01E01",
        "EPISODE",
        False,
        {"nodes": []},
        True,
        0,
        1,
        verbose_trace=trace
    )

    assert best is not None
    assert "Tomb Raider King S01E01" in best["title"]
    # The selected candidate and qualifying items in trace meet SCORE_THRESHOLD
    matching_trace = [t for t in trace if t["title"] == best["title"]]
    assert len(matching_trace) == 1
    assert matching_trace[0]["rating"] >= SCORE_THRESHOLD

    # Verify both real-world candidates individually satisfy verify_query >= SCORE_THRESHOLD
    for item in real_items:
        parsed = anitopy.parse(item["title"])
        res = parsed.get("video_resolution", "1080p")
        score, details = verify_query(
            "Tomb Raider King S01E01",
            parsed,
            res,
            "EPISODE",
            item["pubDate"],
            {"nodes": []},
            True,
            0,
            1,
            verbose=True
        )
        assert score >= SCORE_THRESHOLD, f"{item['title']} scored {score} < {SCORE_THRESHOLD}"
        assert details["episode_match"] is True


def test_is_season_1_classification():
    """Verify NyaaClient._is_season_1 distinguishes season 1 from multi-season anime."""
    client = NyaaClient()

    # Season 1 shows
    assert client._is_season_1(
        {"mediaId": 184356, "media": {"title": {"romaji": "Dogul Wang", "english": "Tomb Raider King"}}},
        "Tomb Raider King"
    ) is True
    assert client._is_season_1(
        {"mediaId": 1, "media": {"title": {"romaji": "Frieren: Beyond Journey's End"}}},
        "Frieren: Beyond Journey's End"
    ) is True

    # Multi-season shows via explicit season, roman numerals, or seasonCount
    assert client._is_season_1(
        {"mediaId": 2, "media": {"title": {"romaji": "Mob Psycho 100 II"}}},
        "Mob Psycho 100 II"
    ) is False
    assert client._is_season_1(
        {"mediaId": 3, "media": {"title": {"romaji": "Jujutsu Kaisen", "english": "Jujutsu Kaisen Season 2"}}},
        "Jujutsu Kaisen"
    ) is False
    assert client._is_season_1(
        {"mediaId": 4, "media": {"title": {"romaji": "Kingdom 3"}}},
        "Kingdom 3"
    ) is False
    assert client._is_season_1(
        {"mediaId": 5, "media": {"title": {"romaji": "Show"}, "season_count": 2}},
        "Show"
    ) is False
    assert client._is_season_1(
        {"mediaId": 6, "media": {"title": {"romaji": "Show"}, "relations": {"edges": [{"relationType": "PREQUEL"}]}}},
        "Show"
    ) is False


