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

