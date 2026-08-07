import anitopy

from animu.utils import verify_query


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
