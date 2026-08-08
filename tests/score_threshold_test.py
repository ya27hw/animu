import unittest
import time
import email.utils

from animu.utils import verify_query


def _rfc2822(epoch: float) -> str:
    """Format an epoch as an RFC 2822 date string (what verify_query expects)."""
    return email.utils.formatdate(epoch, usegmt=True)


class TestScoreThreshold(unittest.TestCase):
    """Verify the torrent verification score threshold is reachable with
    realistic verification matches while still rejecting low-confidence
    matches (regression test for the 3.88/4.0 unreachable threshold)."""

    def _episode_case(self, search_query, parsed_title):
        """Build a parsed-data dict for EPISODE mode with an 80%-similarity title."""
        now = time.time()
        # airingAt slightly in the past relative to pub date so the buffer check passes
        airing_at = now - 3600
        parsed = {
            "file_name": f"[Group] {parsed_title} - 12 [1080p].mkv",
            "anime_title": parsed_title,
            "video_resolution": "1080",
            "episode_number": 12,
            "release_group": "Group",
            "subtitles": "",
        }
        air_dates = {"nodes": [{"episode": 12, "airingAt": airing_at}]}
        pub_date = _rfc2822(now)
        return search_query, parsed, "1080", "EPISODE", pub_date, air_dates

    def test_80_percent_similarity_with_all_verifications_passes(self):
        """An 80%-similarity torrent with episode, resolution, and air-date
        matches must score at or above the new threshold (3.70)."""
        query, parsed, res, mode, pub_date, air_dates = self._episode_case(
            "Steins;Gate", "Steins Gate"
        )
        score, details = verify_query(
            query, parsed, res, mode, pub_date, air_dates,
            False, 12, verbose=True
        )
        self.assertGreaterEqual(score, 3.70,
                                f"expected score >= 3.70, got {score}")
        self.assertEqual(details.get("rejection_reason", ""), "")
        self.assertTrue(details["episode_match"])
        self.assertTrue(details["resolution_match"])
        self.assertTrue(details["air_date_match"])

    def test_low_confidence_match_still_fails(self):
        """A torrent with a weak title match and no verification matches must
        still be rejected (false-positive protection preserved)."""
        query, parsed, res, mode, pub_date, air_dates = self._episode_case(
            "Steins;Gate", "Random Unrelated Show"
        )
        # Episode mismatch: candidate is episode 12 but we want episode 5.
        parsed["episode_number"] = 12
        air_dates = {"nodes": [{"episode": 5, "airingAt": time.time() - 3600}]}

        score, details = verify_query(
            query, parsed, res, mode, pub_date, air_dates,
            False, 5, verbose=True
        )
        self.assertLess(score, 3.70, f"expected score < 3.70, got {score}")
        self.assertNotEqual(details.get("rejection_reason", ""), "")

    def test_missing_episode_match_still_fails_despite_good_title(self):
        """Even with a near-perfect title, a missing verification component
        must keep the score below the threshold."""
        query, parsed, res, mode, pub_date, air_dates = self._episode_case(
            "Steins;Gate", "Steins Gate"
        )
        # Want episode 5 but candidate is episode 12 -> episode mismatch.
        # Keep the airing node for the *wanted* episode so the air-date check
        # passes and the failure comes from the score threshold, not from the
        # earlier "not aired yet" short-circuit.
        air_dates = {"nodes": [{"episode": 5, "airingAt": time.time() - 3600}]}
        score, details = verify_query(
            query, parsed, res, mode, pub_date, air_dates,
            False, 5, verbose=True
        )
        self.assertLess(score, 3.70, f"expected score < 3.70, got {score}")
        self.assertIn("episode mismatch", details.get("rejection_reason", ""))


if __name__ == "__main__":
    unittest.main()
