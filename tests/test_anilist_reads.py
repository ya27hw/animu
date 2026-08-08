"""Tests for the read-side AniList GraphQL client expansions.

All AniList API calls are mocked — no real network requests are made.
Tests cover every spec §4 read query, chunked MediaListCollection pagination,
TTL cache expiry, and 429/Retry-After handling.
"""

import json
import time
import unittest
from types import SimpleNamespace
from unittest.mock import patch, Mock

from animu.anilist import (
    AnilistClient as AC,
    TTLCache,
    PAGE_PER_PAGE,
    AnilistClient,
)
from animu.anilist_auth import execute_graphql
from animu.anilist_auth import TOKEN_LIFETIME_SECONDS


def make_config(token="test-token", ani_user_name="testuser"):
    return SimpleNamespace(
        bearer_token_anilist=token,
        ani_user_name=ani_user_name,
        use_proxy=False,
        proxy_address=None,
        proxy_port=None,
        proxy_username=None,
        proxy_password=None,
    )


def make_test_config(token="test-secret-token-xyz", client_id="test-client-id",
                     client_secret="test-secret", redirect_uri=None,
                     token_issued_at=None):
    """Config mock compatible with execute_graphql internals (all proxy attrs present)."""
    return SimpleNamespace(
        bearer_token_anilist=token,
        ani_user_name="testuser",
        anilist_client_id=client_id,
        anilist_client_secret=client_secret,
        anilist_redirect_uri=redirect_uri,
        anilist_token_issued_at=token_issued_at,
        use_proxy=False,
        proxy_address=None,
        proxy_port=None,
        proxy_username=None,
        proxy_password=None,
    )


class TestTTLCache(unittest.TestCase):
    """TTL cache unit tests."""

    def test_get_returns_none_for_missing_key(self):
        cache = TTLCache(ttl=60)
        self.assertIsNone(cache.get("missing"))

    def test_set_then_get_returns_value(self):
        cache = TTLCache(ttl=60)
        cache.set("key", {"data": 1})
        self.assertEqual(cache.get("key"), {"data": 1})

    def test_expired_entry_returns_none(self):
        cache = TTLCache(ttl=1)
        cache.set("key", "value")
        self.assertEqual(cache.get("key"), "value")
        time.sleep(1.1)
        self.assertIsNone(cache.get("key"))

    def test_clear_removes_all_entries(self):
        cache = TTLCache(ttl=60)
        cache.set("k1", "v1")
        cache.set("k2", "v2")
        cache.clear()
        self.assertIsNone(cache.get("k1"))
        self.assertIsNone(cache.get("k2"))

    def test_clear_key_removes_single_entry(self):
        cache = TTLCache(ttl=60)
        cache.set("k1", "v1")
        cache.set("k2", "v2")
        cache.clear_key("k1")
        self.assertIsNone(cache.get("k1"))
        self.assertEqual(cache.get("k2"), "v2")


class TestPageRails(unittest.TestCase):
    """Tests for Page-based discovery rails and MediaTrend."""

    def setUp(self):
        self.client = AC()
        AC.clear_all_caches()

    def _cfg(self):
        return make_config()

    def test_get_discover_anime_maps_vars_with_sort(self):
        page_data = {"pageInfo": {"currentPage": 1, "lastPage": 3, "hasNextPage": True}, "media": [{"id": 1}]}
        with patch("animu.anilist.get_config", return_value=self._cfg()), patch.object(
            self.client, "_query", return_value={"data": {"Page": page_data}}
        ) as q:
            result = self.client.get_discover_anime("top", page=1, per_page=50)

        self.assertEqual(result, page_data)
        variables = q.call_args.args[1]
        self.assertEqual(variables["sort"], ["SCORE_DESC"])
        self.assertEqual(variables["perPage"], 50)

    def test_get_discover_anime_caps_per_page_at_50(self):
        with patch("animu.anilist.get_config", return_value=self._cfg()), patch.object(
            self.client, "_query", return_value={"data": {"Page": {"media": []}}}
        ) as q:
            self.client.get_discover_anime("trending", page=1, per_page=200)
        self.assertEqual(q.call_args.args[1]["perPage"], 50)

    def test_get_discover_anime_unknown_type_uses_default_sort(self):
        with patch("animu.anilist.get_config", return_value=self._cfg()), patch.object(
            self.client, "_query", return_value={"data": {"Page": {"media": []}}}
        ) as q:
            self.client.get_discover_anime("unknown", page=1, per_page=20)
        self.assertEqual(q.call_args.args[1]["sort"], ["TRENDING_DESC", "POPULARITY_DESC"])

    def test_get_discover_anime_returns_empty_on_no_data(self):
        with patch("animu.anilist.get_config", return_value=self._cfg()), patch.object(
            self.client, "_query", return_value=None
        ):
            result = self.client.get_discover_anime("trending")
        self.assertIn("pageInfo", result)
        self.assertEqual(result["media"], [])

    def test_get_media_trend_returns_page_data(self):
        trend_data = {"pageInfo": {"hasNextPage": False}, "mediaTrend": [{"mediaId": 1, "trending": 5}]}
        with patch("animu.anilist.get_config", return_value=self._cfg()), patch.object(
            self.client, "_query", return_value={"data": {"Page": trend_data}}
        ) as q:
            result = self.client.get_media_trend(page=1, per_page=50)
        self.assertEqual(result, trend_data)
        self.assertIn("mediaTrend", q.call_args.args[0])

    def test_get_media_trend_caps_per_page(self):
        with patch("animu.anilist.get_config", return_value=self._cfg()), patch.object(
            self.client, "_query", return_value={"data": {"Page": {"mediaTrend": []}}}
        ) as q:
            self.client.get_media_trend(per_page=100)
        self.assertEqual(q.call_args.args[1]["perPage"], 50)


class TestAiringSchedule(unittest.TestCase):

    def setUp(self):
        self.client = AC()
        AC.clear_all_caches()

    def _cfg(self):
        return make_config()

    def test_get_airing_schedule_returns_schedule(self):
        schedule = {"nodes": [{"airingAt": 1000, "episode": 5}]}
        with patch("animu.anilist.get_config", return_value=self._cfg()), patch.object(
            self.client, "_query", return_value={"data": {"Media": {"airingSchedule": schedule}}}
        ):
            result = self.client.get_airing_schedule(page=1, media_id=123)
        self.assertEqual(result, schedule)

    def test_get_airing_schedule_returns_none_on_no_media(self):
        with patch("animu.anilist.get_config", return_value=self._cfg()), patch.object(
            self.client, "_query", return_value={"data": {"Media": None}}
        ):
            result = self.client.get_airing_schedule(page=1, media_id=123)
        self.assertIsNone(result)

    def test_get_airing_schedule_by_id_full_fields(self):
        schedule = {"nodes": [{"id": 1, "episode": 5, "airingAt": 1000, "timeUntilAiring": 500}]}
        with patch("animu.anilist.get_config", return_value=self._cfg()), patch.object(
            self.client, "_query", return_value={"data": {"Media": {"airingSchedule": schedule}}}
        ) as q:
            result = self.client.get_airing_schedule_by_id(123)
        self.assertEqual(result, schedule)
        self.assertIn("perPage", q.call_args.args[1])


class TestCharacterStaffStudio(unittest.TestCase):

    def setUp(self):
        self.client = AC()
        AC.clear_all_caches()

    def _cfg(self):
        return make_config()

    def test_get_character_returns_character_data(self):
        char_data = {"id": 1, "name": {"first": "Goku"}}
        with patch("animu.anilist.get_config", return_value=self._cfg()), patch.object(
            self.client, "_query", return_value={"data": {"Character": char_data}}
        ):
            result = self.client.get_character(1)
        self.assertEqual(result, char_data)

    def test_get_character_returns_none_on_no_data(self):
        with patch("animu.anilist.get_config", return_value=self._cfg()), patch.object(
            self.client, "_query", return_value=None
        ):
            self.assertIsNone(self.client.get_character(1))

    def test_search_characters_returns_page_data(self):
        page = {"pageInfo": {"hasNextPage": False}, "characters": [{"id": 1}]}
        with patch("animu.anilist.get_config", return_value=self._cfg()), patch.object(
            self.client, "_query", return_value={"data": {"Page": page}}
        ) as q:
            result = self.client.search_characters("Goku", page=1, per_page=50)
        self.assertEqual(result, page)
        self.assertIn("characters", q.call_args.args[0])

    def test_search_characters_caps_per_page(self):
        with patch("animu.anilist.get_config", return_value=self._cfg()), patch.object(
            self.client, "_query", return_value={"data": {"Page": {"characters": []}}}
        ) as q:
            self.client.search_characters("test", per_page=200)
        self.assertEqual(q.call_args.args[1]["perPage"], 50)

    def test_get_staff_returns_staff_data(self):
        staff_data = {"id": 1, "name": {"first": "Director"}}
        with patch("animu.anilist.get_config", return_value=self._cfg()), patch.object(
            self.client, "_query", return_value={"data": {"Staff": staff_data}}
        ):
            result = self.client.get_staff(1)
        self.assertEqual(result, staff_data)

    def test_search_staff_returns_page_data(self):
        page = {"pageInfo": {"hasNextPage": False}, "staff": [{"id": 1}]}
        with patch("animu.anilist.get_config", return_value=self._cfg()), patch.object(
            self.client, "_query", return_value={"data": {"Page": page}}
        ) as q:
            result = self.client.search_staff("Taro", page=1, per_page=50)
        self.assertEqual(result, page)

    def test_get_studio_returns_studio_data(self):
        studio_data = {"id": 1, "name": "Studio Ghibli"}
        with patch("animu.anilist.get_config", return_value=self._cfg()), patch.object(
            self.client, "_query", return_value={"data": {"Studio": studio_data}}
        ):
            result = self.client.get_studio(1)
        self.assertEqual(result, studio_data)

    def test_search_studios_returns_page_data(self):
        page = {"pageInfo": {"hasNextPage": False}, "studios": [{"id": 1, "name": "TestStudio"}]}
        with patch("animu.anilist.get_config", return_value=self._cfg()), patch.object(
            self.client, "_query", return_value={"data": {"Page": page}}
        ) as q:
            result = self.client.search_studios("Test", page=1, per_page=50)
        self.assertEqual(result, page)


class TestMediaListCollection(unittest.TestCase):
    """Tests for chunked MediaListCollection pagination."""

    def setUp(self):
        self.client = AC()
        # Clear the TTL cache so tests are isolated from each other
        if hasattr(AC.get_media_list_collection, '_cache'):
            AC.get_media_list_collection._cache.clear()

    def _cfg(self, user_name="testuser"):
        return make_config(ani_user_name=user_name)

    def test_get_media_list_collection_single_chunk(self):
        collection = {"lists": [{"name": "Current", "entries": [{"id": 1, "mediaId": 10}]}], "hasNextChunk": False}
        with patch("animu.anilist.get_config", return_value=self._cfg()), patch.object(
            self.client, "_query", return_value={"data": {"MediaListCollection": collection}}
        ) as q:
            result = self.client.get_media_list_collection(per_chunk=500)
        self.assertEqual(len(result["lists"]), 1)
        self.assertEqual(len(result["lists"][0]["entries"]), 1)
        self.assertFalse(result["hasNextChunk"])
        q.assert_called_once()

    def test_get_media_list_collection_multi_chunk(self):
        """Verify chunked MediaListCollection paginates correctly."""
        chunk0 = {"lists": [{"name": "Current", "entries": [{"id": 1}]}], "hasNextChunk": True}
        chunk1 = {"lists": [{"name": "Current", "entries": [{"id": 2}]}], "hasNextChunk": False}
        with patch("animu.anilist.get_config", return_value=self._cfg()), patch.object(
            self.client, "_query", side_effect=[
                {"data": {"MediaListCollection": chunk0}},
                {"data": {"MediaListCollection": chunk1}},
            ]
        ) as q:
            result = self.client.get_media_list_collection(per_chunk=1)

        self.assertEqual(len(result["lists"]), 1)
        self.assertEqual(len(result["lists"][0]["entries"]), 2)
        self.assertEqual(result["lists"][0]["entries"][0]["id"], 1)
        self.assertEqual(result["lists"][0]["entries"][1]["id"], 2)
        self.assertEqual(q.call_count, 2)
        # Note: variables dict is reused/mutated, so we verify call count + results
        # rather than per-call chunk values

    def test_get_media_list_collection_max_chunks_safety(self):
        """Verify max_chunks safety guard prevents infinite loops."""
        import copy
        chunk = {"lists": [{"name": "Current", "entries": [{"id": 1}]}], "hasNextChunk": True}
        with patch("animu.anilist.get_config", return_value=self._cfg()), patch.object(
            self.client, "_query", side_effect=lambda *args, **kwargs: copy.deepcopy({"data": {"MediaListCollection": chunk}})
        ) as q:
            result = self.client.get_media_list_collection(per_chunk=500)
        self.assertEqual(q.call_count, 10)
        self.assertEqual(len(result["lists"]), 1)
        self.assertEqual(len(result["lists"][0]["entries"]), 10)

    def test_get_media_list_collection_no_user_name(self):
        cfg = make_config(ani_user_name=None)
        with patch("animu.anilist.get_config", return_value=cfg), patch.object(
            self.client, "_query"
        ) as q:
            result = self.client.get_media_list_collection()
            self.assertEqual(result, {"lists": [], "hasNextChunk": False})
            q.assert_not_called()

    def test_get_media_list_collection_caps_per_chunk(self):
        collection = {"lists": [], "hasNextChunk": False}
        with patch("animu.anilist.get_config", return_value=self._cfg()), patch.object(
            self.client, "_query", return_value={"data": {"MediaListCollection": collection}}
        ) as q:
            self.client.get_media_list_collection(per_chunk=600)
        self.assertEqual(q.call_args.args[1]["perChunk"], 500)

    def test_get_media_list_collection_no_response(self):
        with patch("animu.anilist.get_config", return_value=self._cfg()), patch.object(
            self.client, "_query", return_value=None
        ):
            result = self.client.get_media_list_collection()
        self.assertEqual(result, {"lists": [], "hasNextChunk": False})


class TestGenreAndTagCollections(unittest.TestCase):

    def setUp(self):
        self.client = AC()
        AC.clear_all_caches()

    def _cfg(self):
        return make_config()

    def test_get_genre_collection_returns_genres(self):
        with patch("animu.anilist.get_config", return_value=self._cfg()), patch.object(
            self.client, "_query", return_value={"data": {"GenreCollection": ["Action", "Comedy"]}}
        ):
            self.assertEqual(self.client.get_genre_collection(), ["Action", "Comedy"])

    def test_get_genre_collection_returns_empty_on_no_data(self):
        with patch("animu.anilist.get_config", return_value=self._cfg()), patch.object(
            self.client, "_query", return_value=None
        ):
            self.assertEqual(self.client.get_genre_collection(), [])

    def test_get_media_tag_collection_returns_tags(self):
        tags = [{"id": 1, "name": "Action", "category": "Setting", "rank": 50}]
        with patch("animu.anilist.get_config", return_value=self._cfg()), patch.object(
            self.client, "_query", return_value={"data": {"MediaTagCollection": tags}}
        ):
            self.assertEqual(self.client.get_media_tag_collection(), tags)

    def test_get_media_tag_collection_returns_empty_on_no_data(self):
        with patch("animu.anilist.get_config", return_value=self._cfg()), patch.object(
            self.client, "_query", return_value=None
        ):
            self.assertEqual(self.client.get_media_tag_collection(), [])


class TestUserViewer(unittest.TestCase):

    def setUp(self):
        self.client = AC()
        AC.clear_all_caches()

    def _cfg(self):
        return make_config()

    def test_get_user_by_id(self):
        user_data = {"id": 123, "name": "testuser"}
        with patch("animu.anilist.get_config", return_value=self._cfg()), patch.object(
            self.client, "_query", return_value={"data": {"User": user_data}}
        ) as q:
            result = self.client.get_user(user_id=123)
        self.assertEqual(result, user_data)
        self.assertEqual(q.call_args.args[1]["id"], 123)

    def test_get_user_by_name(self):
        user_data = {"id": 123, "name": "testuser"}
        with patch("animu.anilist.get_config", return_value=self._cfg()), patch.object(
            self.client, "_query", return_value={"data": {"User": user_data}}
        ) as q:
            result = self.client.get_user(user_name="testuser")
        self.assertEqual(result, user_data)
        self.assertEqual(q.call_args.args[1]["name"], "testuser")

    def test_get_user_returns_none_on_no_data(self):
        with patch("animu.anilist.get_config", return_value=self._cfg()), patch.object(
            self.client, "_query", return_value=None
        ):
            self.assertIsNone(self.client.get_user(user_id=1))

    def test_get_viewer_returns_viewer_data(self):
        viewer_data = {"id": 456, "name": "viewer"}
        with patch("animu.anilist.get_config", return_value=self._cfg()), patch.object(
            self.client, "_query", return_value={"data": {"Viewer": viewer_data}}
        ):
            result = self.client.get_viewer()
        self.assertEqual(result, viewer_data)

    def test_get_viewer_returns_none_on_no_data(self):
        with patch("animu.anilist.get_config", return_value=self._cfg()), patch.object(
            self.client, "_query", return_value=None
        ):
            self.assertIsNone(self.client.get_viewer())


class TestNotifications(unittest.TestCase):

    def setUp(self):
        self.client = AC()
        AC.clear_all_caches()

    def _cfg(self):
        return make_config()

    def test_notifications_all_20_types_listed(self):
        """Verify all 20 notification types are in the constant."""
        expected = [
            "ACTIVITY_MESSAGE", "ACTIVITY_REPLY", "FOLLOWING",
            "ACTIVITY_MENTION", "THREAD_COMMENT_MENTION", "THREAD_SUBSCRIBED",
            "THREAD_COMMENT_REPLY", "AIRING", "ACTIVITY_LIKE", "ACTIVITY_REPLY_LIKE",
            "THREAD_LIKE", "THREAD_COMMENT_LIKE", "ACTIVITY_REPLY_SUBSCRIBED",
            "RELATED_MEDIA_ADDITION", "MEDIA_DATA_CHANGE", "MEDIA_MERGE",
            "MEDIA_DELETION", "MEDIA_SUBMISSION_UPDATE", "STAFF_SUBMISSION_UPDATE",
            "CHARACTER_SUBMISSION_UPDATE",
        ]
        self.assertEqual(self.client.NOTIFICATION_TYPES, expected)
        self.assertEqual(len(self.client.NOTIFICATION_TYPES), 20)

    def test_get_notifications_returns_page_data(self):
        page = {"pageInfo": {"hasNextPage": False}, "notifications": [{"id": 1, "type": "AIRING"}]}
        with patch("animu.anilist.get_config", return_value=self._cfg()), patch.object(
            self.client, "_query", return_value={"data": {"Page": page}}
        ) as q:
            result = self.client.get_notifications(page=1, per_page=50)
        self.assertEqual(result, page)
        self.assertIn("notifications", q.call_args.args[0])

    def test_get_notifications_caps_per_page(self):
        with patch("animu.anilist.get_config", return_value=self._cfg()), patch.object(
            self.client, "_query", return_value={"data": {"Page": {"notifications": []}}}
        ) as q:
            self.client.get_notifications(per_page=200)
        self.assertEqual(q.call_args.args[1]["perPage"], 50)

    def test_get_notifications_accepts_type_filter(self):
        page = {"pageInfo": {"hasNextPage": False}, "notifications": [{"id": 1, "type": "AIRING"}]}
        with patch("animu.anilist.get_config", return_value=self._cfg()), patch.object(
            self.client, "_query", return_value={"data": {"Page": page}}
        ) as q:
            self.client.get_notifications(notification_type="AIRING")
        self.assertEqual(q.call_args.args[1]["type"], "AIRING")

    def test_get_notifications_reset_count(self):
        page = {"pageInfo": {"hasNextPage": False}, "notifications": []}
        with patch("animu.anilist.get_config", return_value=self._cfg()), patch.object(
            self.client, "_query", return_value={"data": {"Page": page}}
        ) as q:
            self.client.get_notifications(reset_notification_count=True)
        self.assertTrue(q.call_args.args[1]["resetNotificationCount"])

    def test_get_notifications_all_20_type_fragments_in_query(self):
        """Verify the query string contains fragments for all 20 notification types."""
        with patch("animu.anilist.get_config", return_value=self._cfg()), patch.object(
            self.client, "_query", return_value={"data": {"Page": {"notifications": []}}}
        ) as q:
            self.client.get_notifications()
        query_str = q.call_args.args[0]
        for nt in AC.NOTIFICATION_TYPES:
            frag_name = AC._NOTIFICATION_FRAGMENT_MAP[nt]
            self.assertIn(f"on {frag_name}", query_str)


class TestReviews(unittest.TestCase):

    def setUp(self):
        self.client = AC()
        AC.clear_all_caches()

    def _cfg(self):
        return make_config()

    def test_get_reviews_returns_page_data(self):
        page = {"pageInfo": {"hasNextPage": False}, "reviews": [{"id": 1, "summary": "Great"}]}
        with patch("animu.anilist.get_config", return_value=self._cfg()), patch.object(
            self.client, "_query", return_value={"data": {"Page": page}}
        ) as q:
            result = self.client.get_reviews(media_id=5, page=1, per_page=50)
        self.assertEqual(result, page)
        self.assertEqual(q.call_args.args[1]["mediaId"], 5)

    def test_get_reviews_caps_per_page(self):
        with patch("animu.anilist.get_config", return_value=self._cfg()), patch.object(
            self.client, "_query", return_value={"data": {"Page": {"reviews": []}}}
        ) as q:
            self.client.get_reviews(per_page=100)
        self.assertEqual(q.call_args.args[1]["perPage"], 50)


class TestActivityFeed(unittest.TestCase):

    def setUp(self):
        self.client = AC()
        AC.clear_all_caches()

    def _cfg(self):
        return make_config()

    def test_get_activity_feed_returns_activities(self):
        page = {"pageInfo": {"hasNextPage": False}, "activities": [{"id": 1, "type": "TEXT"}]}
        with patch("animu.anilist.get_config", return_value=self._cfg()), patch.object(
            self.client, "_query", return_value={"data": {"Page": page}}
        ) as q:
            result = self.client.get_activity_feed(page=1, per_page=30)
        self.assertEqual(result, page)
        self.assertIn("activities", q.call_args.args[0])

    def test_get_activity_feed_caps_per_page(self):
        with patch("animu.anilist.get_config", return_value=self._cfg()), patch.object(
            self.client, "_query", return_value={"data": {"Page": {"activities": []}}}
        ) as q:
            self.client.get_activity_feed(per_page=100)
        self.assertEqual(q.call_args.args[1]["perPage"], 50)


class TestFollowingFollowers(unittest.TestCase):

    def setUp(self):
        self.client = AC()
        AC.clear_all_caches()

    def _cfg(self):
        return make_config()

    def test_get_following_returns_users(self):
        page = {"pageInfo": {"hasNextPage": False}, "following": [{"id": 1, "name": "followed"}]}
        with patch("animu.anilist.get_config", return_value=self._cfg()), patch.object(
            self.client, "_query", return_value={"data": {"Page": page}}
        ) as q:
            result = self.client.get_following(user_id=10, page=1, per_page=50)
        self.assertEqual(result, page)
        self.assertEqual(q.call_args.args[1]["userId"], 10)

    def test_get_followers_returns_users(self):
        page = {"pageInfo": {"hasNextPage": False}, "followers": [{"id": 2, "name": "follower"}]}
        with patch("animu.anilist.get_config", return_value=self._cfg()), patch.object(
            self.client, "_query", return_value={"data": {"Page": page}}
        ) as q:
            result = self.client.get_followers(user_id=10, page=1, per_page=50)
        self.assertEqual(result, page)
        self.assertEqual(q.call_args.args[1]["userId"], 10)


class TestThreadComments(unittest.TestCase):

    def setUp(self):
        self.client = AC()
        AC.clear_all_caches()

    def _cfg(self):
        return make_config()

    def test_get_thread_returns_thread(self):
        thread_data = {"id": 5, "title": "Discussion"}
        with patch("animu.anilist.get_config", return_value=self._cfg()), patch.object(
            self.client, "_query", return_value={"data": {"Thread": thread_data}}
        ):
            self.assertEqual(self.client.get_thread(5), thread_data)

    def test_get_threads_returns_page(self):
        page = {"pageInfo": {"hasNextPage": False}, "threads": [{"id": 1, "title": "T"}]}
        with patch("animu.anilist.get_config", return_value=self._cfg()), patch.object(
            self.client, "_query", return_value={"data": {"Page": page}}
        ) as q:
            result = self.client.get_threads(page=1, per_page=50)
        self.assertEqual(result, page)
        self.assertIn("threads", q.call_args.args[0])

    def test_get_thread_comments_returns_comments(self):
        page = {"pageInfo": {"hasNextPage": False}, "threadComments": [{"id": 1, "comment": "Hello"}]}
        with patch("animu.anilist.get_config", return_value=self._cfg(), ), patch.object(
            self.client, "_query", return_value={"data": {"Page": page}}
        ) as q:
            result = self.client.get_thread_comments(thread_id=5, page=1, per_page=50)
        self.assertEqual(result, page)
        self.assertEqual(q.call_args.args[1]["threadId"], 5)


class TestRecommendation(unittest.TestCase):

    def setUp(self):
        self.client = AC()
        AC.clear_all_caches()

    def _cfg(self):
        return make_config()

    def test_get_recommendations_returns_page(self):
        page = {"pageInfo": {"hasNextPage": False}, "recommendations": [{"id": 1}]}
        with patch("animu.anilist.get_config", return_value=self._cfg()), patch.object(
            self.client, "_query", return_value={"data": {"Page": page}}
        ) as q:
            result = self.client.get_recommendations(media_id=5, page=1, per_page=50)
        self.assertEqual(result, page)
        self.assertEqual(q.call_args.args[1]["mediaId"], 5)


class TestMarkdownAndSiteStats(unittest.TestCase):

    def setUp(self):
        self.client = AC()
        AC.clear_all_caches()

    def _cfg(self):
        return make_config()

    def test_get_markdown_html_returns_html(self):
        with patch("animu.anilist.get_config", return_value=self._cfg()), patch.object(
            self.client, "_query", return_value={"data": {"Markdown": {"html": "<p>Hello</p>"}}}
        ) as q:
            result = self.client.get_markdown_html("Hello")
        self.assertEqual(result, "<p>Hello</p>")
        self.assertTrue(q.call_args.kwargs["require_auth"])

    def test_get_site_statistics_returns_stats(self):
        stats = {"anime": {"count": 1000}, "users": 500000}
        with patch("animu.anilist.get_config", return_value=self._cfg()), patch.object(
            self.client, "_query", return_value={"data": {"SiteStatistics": stats}}
        ):
            self.assertEqual(self.client.get_site_statistics(), stats)

    def test_get_user_query_uses_statistics_not_stats(self):
        with patch("animu.anilist.get_config", return_value=self._cfg()), patch.object(
            self.client, "_query", return_value={"data": {"User": {"id": 1}}}
        ) as q:
            self.client.get_user(user_name="Aymr")
        query_str = q.call_args.args[0]
        self.assertIn("statistics", query_str)
        self.assertNotIn("stats {", query_str)

    def test_get_viewer_query_uses_statistics_not_stats(self):
        with patch("animu.anilist.get_config", return_value=self._cfg()), patch.object(
            self.client, "_query", return_value={"data": {"Viewer": {"id": 1}}}
        ) as q:
            self.client.get_viewer()
        query_str = q.call_args.args[0]
        self.assertIn("statistics", query_str)
        self.assertNotIn("stats {", query_str)

    def test_get_site_statistics_query_schema(self):
        with patch("animu.anilist.get_config", return_value=self._cfg()), patch.object(
            self.client, "_query", return_value={"data": {"SiteStatistics": {"anime": {"count": 10}}}}
        ) as q:
            self.client.get_site_statistics()
        query_str = q.call_args.args[0]
        self.assertNotIn("documents", query_str)
        self.assertIn("SiteStatistics", query_str)

    def test_get_anichart_user_returns_data(self):
        chart_data = {"highlightIds": [1, 2], "theme": "dark"}
        with patch("animu.anilist.get_config", return_value=self._cfg()), patch.object(
            self.client, "_query", return_value={"data": {"AniChartUser": chart_data}}
        ):
            self.assertEqual(self.client.get_anichart_user(user_id=5), chart_data)


class TestTTLCacheIntegration(unittest.TestCase):
    """Integration tests verifying TTL cache behavior across repeated calls."""

    def setUp(self):
        self.client = AC()
        AC.clear_all_caches()

    def _cfg(self):
        return make_config()

    def test_cached_method_calls_query_once_then_serves_cache(self):
        page = {"pageInfo": {"hasNextPage": False}, "media": [{"id": 1}]}
        with patch("animu.anilist.get_config", return_value=self._cfg()), patch.object(
            self.client, "_query", return_value={"data": {"Page": page}}
        ) as q:
            r1 = self.client.get_genre_collection()
            r2 = self.client.get_genre_collection()
        self.assertEqual(r1, r2)
        self.assertEqual(q.call_count, 1)

    def test_cache_expires_after_ttl(self):
        """Verify TTL cache expires after the TTL window."""
        page = {"pageInfo": {"hasNextPage": False}, "media": [{"id": 1}]}
        with patch("animu.anilist.get_config", return_value=self._cfg()), patch.object(
            self.client, "_query", return_value={"data": {"Page": page}}
        ) as q:
            self.client.get_site_statistics()
            self.assertEqual(q.call_count, 1)

            # Force expiry by backdating the cache entry
            for method_name in dir(self.client):
                attr = getattr(self.client, method_name, None)
                if callable(attr) and hasattr(attr, "_cache"):
                    cache = attr._cache
                    for k, (v, exp) in list(cache._store.items()):
                        cache._store[k] = (v, time.time() - 1)
                    break

            self.client.get_site_statistics()
            self.assertEqual(q.call_count, 2)


class TestRetryAfter429(unittest.TestCase):
    """Verify 429/Retry-After handling flows through execute_graphql."""

    def setUp(self):
        self.client = AC()
        AC.clear_all_caches()

    def _cfg(self):
        return make_config()

    @patch("animu.anilist_auth.time.sleep")
    def test_429_handling_in_read_query(self, mock_sleep):
        """Verify that 429 errors are handled within execute_graphql for reads."""
        from animu.anilist_auth import execute_graphql

        resp_429 = Mock(status_code=429)
        resp_429.headers = {"Retry-After": "1", "X-RateLimit-Reset": "9999999999"}
        resp_429.json.return_value = {"errors": [{"message": "Too Many Requests.", "status": 429}]}
        resp_200 = Mock(status_code=200)
        resp_200.json.return_value = {"data": {"Page": {"media": [{"id": 1}]}}}

        client_mock = Mock()
        client_mock.__enter__ = Mock(return_value=client_mock)
        client_mock.__exit__ = Mock(return_value=False)
        client_mock.post.side_effect = [resp_429, resp_200]

        with patch("animu.anilist_auth.get_config", return_value=self._cfg()), \
             patch("animu.anilist_auth.httpx.Client", return_value=client_mock):
            result = execute_graphql("query { Page { media { id } } }", {}, require_auth=False)

        self.assertEqual(result, {"data": {"Page": {"media": [{"id": 1}]}}})
        self.assertEqual(client_mock.post.call_count, 2)
        self.assertEqual(mock_sleep.call_count, 1)

    @patch("animu.anilist_auth.time.sleep")
    def test_429_exhausted_returns_error(self, mock_sleep):
        """If 429 persists through max retries, return the error payload."""
        from animu.anilist_auth import execute_graphql

        resp_429 = Mock(status_code=429)
        resp_429.headers = {"Retry-After": "1"}
        resp_429.json.return_value = {"errors": [{"message": "Too Many Requests.", "status": 429}]}

        client_mock = Mock()
        client_mock.__enter__ = Mock(return_value=client_mock)
        client_mock.__exit__ = Mock(return_value=False)
        client_mock.post.return_value = resp_429

        with patch("animu.anilist_auth.get_config", return_value=self._cfg()), \
             patch("animu.anilist_auth.httpx.Client", return_value=client_mock):
            result = execute_graphql("query { x }", {}, require_auth=False)

        self.assertIn("errors", result)
        self.assertIn("429", str(result["errors"]))


class TestWatchingListAndRelations(unittest.TestCase):
    """Tests for get_watching_list, get_anime_user_list, and get_previous_relations."""

    def setUp(self):
        self.client = AC()
        AC.clear_all_caches()

    def _cfg(self):
        return make_config(ani_user_name="testuser")

    @patch("animu.anilist.get_config")
    def test_get_watching_list_returns_entries(self, mock_cfg):
        mock_cfg.return_value = self._cfg()
        lists = [{"name": "Current", "entries": [{"progress": 5, "mediaId": 10, "media": {"title": {"romaji": "Test"}}}]}]
        with patch.object(self.client, "_query", return_value={"data": {"MediaListCollection": {"lists": lists}}}) as q:
            result = self.client.get_watching_list()
        self.assertEqual(result, lists[0]["entries"])
        self.assertEqual(q.call_args.args[1], {"userName": "testuser"})

    @patch("animu.anilist.get_config")
    def test_get_watching_list_no_user_name_returns_empty(self, mock_cfg):
        mock_cfg.return_value = make_config(ani_user_name=None)
        with patch.object(self.client, "_query") as q:
            result = self.client.get_watching_list()
        self.assertEqual(result, [])
        q.assert_not_called()

    @patch("animu.anilist.get_config")
    def test_get_anime_user_list_returns_entries(self, mock_cfg):
        mock_cfg.return_value = self._cfg()
        lists = [{"name": "Current", "entries": [{"progress": 3, "mediaId": 42, "media": {"title": {"romaji": "Anime"}}}]}]
        with patch.object(self.client, "_query", return_value={"data": {"MediaListCollection": {"lists": lists}}}):
            result = self.client.get_anime_user_list()
        self.assertEqual(result, lists[0]["entries"])

    @patch("animu.anilist.get_config")
    def test_get_previous_relations_returns_edges(self, mock_cfg):
        mock_cfg.return_value = self._cfg()
        edges = [{"id": 1, "relationType": "PREQUEL", "node": {"id": 10}}]
        with patch.object(self.client, "_query", return_value={"data": {"Media": {"relations": {"edges": edges}}}}) as q:
            result = self.client.get_previous_relations(media_id=99)
        self.assertEqual(result, edges)
        self.assertEqual(q.call_args.args[1], {"id": 99})

    @patch("animu.anilist.get_config")
    def test_get_previous_relations_returns_none_on_no_data(self, mock_cfg):
        mock_cfg.return_value = self._cfg()
        with patch.object(self.client, "_query", return_value={"data": {"Media": None}}):
            self.assertIsNone(self.client.get_previous_relations(media_id=99))


class TestSearchUsers(unittest.TestCase):
    """Tests for search_users read query."""

    def setUp(self):
        self.client = AC()
        AC.clear_all_caches()

    def _cfg(self):
        return make_config()

    @patch("animu.anilist.get_config")
    def test_search_users_returns_page_data(self, mock_cfg):
        mock_cfg.return_value = self._cfg()
        page = {"pageInfo": {"hasNextPage": False}, "users": [{"id": 1, "name": "user1"}]}
        with patch.object(self.client, "_query", return_value={"data": {"Page": page}}) as q:
            result = self.client.search_users("user1", page=1, per_page=50)
        self.assertEqual(result, page)
        self.assertIn("users", q.call_args.args[0])

    @patch("animu.anilist.get_config")
    def test_search_users_caps_per_page(self, mock_cfg):
        mock_cfg.return_value = self._cfg()
        with patch.object(self.client, "_query", return_value={"data": {"Page": {"users": []}}}) as q:
            self.client.search_users("test", per_page=200)
        self.assertEqual(q.call_args.args[1]["perPage"], 50)


class TestTTLCacheExpiry(unittest.TestCase):
    """More thorough TTL cache expiry tests across multiple cached methods."""

    def setUp(self):
        self.client = AC()
        AC.clear_all_caches()

    def _cfg(self):
        return make_config()

    @patch("animu.anilist.get_config")
    def test_cached_method_serves_cache_within_ttl(self, mock_cfg):
        """Second call within TTL should not re-query."""
        mock_cfg.return_value = self._cfg()
        with patch.object(self.client, "_query", return_value={"data": {"GenreCollection": ["Action"]}}) as q:
            r1 = self.client.get_genre_collection()
            r2 = self.client.get_genre_collection()
        self.assertEqual(r1, r2)
        self.assertEqual(q.call_count, 1)

    @patch("animu.anilist.get_config")
    def test_cache_expires_after_ttl_media_trend(self, mock_cfg):
        """Verify TTL cache expires after the TTL window for get_media_trend."""
        mock_cfg.return_value = self._cfg()
        with patch.object(self.client, "_query", return_value={"data": {"Page": {"mediaTrend": []}}}) as q:
            self.client.get_media_trend(page=1)
            self.assertEqual(q.call_count, 1)

            # Force expiry by backdating
            for method_name in dir(self.client):
                attr = getattr(self.client, method_name, None)
                if callable(attr) and hasattr(attr, "_cache"):
                    cache = attr._cache
                    for k, (v, exp) in list(cache._store.items()):
                        cache._store[k] = (v, time.time() - 1)

            self.client.get_media_trend(page=1)
            self.assertEqual(q.call_count, 2)

    @patch("animu.anilist.get_config")
    def test_cache_expires_after_ttl_search_characters(self, mock_cfg):
        """Verify TTL cache expires after the TTL window for search_characters."""
        mock_cfg.return_value = self._cfg()
        with patch.object(self.client, "_query", return_value={"data": {"Page": {"characters": []}}}) as q:
            self.client.search_characters("test")
            self.assertEqual(q.call_count, 1)

            # Force expiry
            for method_name in dir(self.client):
                attr = getattr(self.client, method_name, None)
                if callable(attr) and hasattr(attr, "_cache"):
                    cache = attr._cache
                    for k, (v, exp) in list(cache._store.items()):
                        cache._store[k] = (v, time.time() - 1)

            self.client.search_characters("test")
            self.assertEqual(q.call_count, 2)

    @patch("animu.anilist.get_config")
    def test_clear_all_caches_invalidates_all(self, mock_cfg):
        """clear_all_caches should force refetch on next call."""
        mock_cfg.return_value = self._cfg()
        with patch.object(self.client, "_query", return_value={"data": {"GenreCollection": ["Action"]}}) as q:
            self.client.get_genre_collection()
            AC.clear_all_caches()
            self.client.get_genre_collection()
        self.assertEqual(q.call_count, 2)

    def test_ttl_cache_clear_key(self):
        """clear_key should remove only the specified entry."""
        cache = TTLCache(ttl=60)
        cache.set("k1", "v1")
        cache.set("k2", "v2")
        cache.clear_key("k1")
        self.assertIsNone(cache.get("k1"))
        self.assertEqual(cache.get("k2"), "v2")

    def test_ttl_cache_clear_key_missing_no_error(self):
        """clear_key on a missing key should not raise."""
        cache = TTLCache(ttl=60)
        cache.clear_key("nonexistent")  # should not raise


class TestRetryAfter429Ext(unittest.TestCase):
    """Extension tests for 429/Retry-After handling: X-RateLimit-Reset fallback
    and HTTP-date Retry-After parsing."""

    def setUp(self):
        self.client = AC()
        AC.clear_all_caches()

    def _cfg(self):
        return make_config()

    @patch("animu.anilist_auth.time.sleep")
    def test_429_x_ratelimit_reset_fallback(self, mock_sleep):
        """When Retry-After is absent, X-RateLimit-Reset should be used."""
        from animu.anilist_auth import execute_graphql
        resp_429 = Mock(status_code=429)
        resp_429.headers = {"X-RateLimit-Reset": str(int(time.time()) + 1)}
        resp_429.json.return_value = {"errors": [{"message": "Too Many Requests.", "status": 429}]}
        resp_200 = Mock(status_code=200)
        resp_200.json.return_value = {"data": {"Media": {"id": 1}}}

        client_mock = Mock()
        client_mock.__enter__ = Mock(return_value=client_mock)
        client_mock.__exit__ = Mock(return_value=False)
        client_mock.post.side_effect = [resp_429, resp_200]

        with patch("animu.anilist_auth.get_config", return_value=self._cfg()), \
             patch("animu.anilist_auth.httpx.Client", return_value=client_mock):
            result = execute_graphql("query { Media { id } }", {}, require_auth=False)

        self.assertEqual(result, {"data": {"Media": {"id": 1}}})
        self.assertEqual(client_mock.post.call_count, 2)
        self.assertEqual(mock_sleep.call_count, 1)

    @patch("animu.anilist_auth.time.sleep")
    @patch("animu.anilist_auth.time.time")
    def test_429_http_date_retry_after(self, mock_time, mock_sleep):
        """Retry-After can be an HTTP-date; it should be parsed and respected."""
        from animu.anilist_auth import execute_graphql
        import email.utils as _eu
        mock_time.return_value = 1000.0
        reset_time = 1001  # 1 second after "now"
        http_date = _eu.formatdate(reset_time, usegmt=True)

        resp_429 = Mock(status_code=429)
        resp_429.headers = {"Retry-After": http_date}
        resp_429.json.return_value = {"errors": [{"message": "Rate limited", "status": 429}]}
        resp_200 = Mock(status_code=200)
        resp_200.json.return_value = {"data": {"Media": {"id": 1}}}

        client_mock = Mock()
        client_mock.__enter__ = Mock(return_value=client_mock)
        client_mock.__exit__ = Mock(return_value=False)
        client_mock.post.side_effect = [resp_429, resp_200]

        cfg = make_config(token="tok")
        with patch("animu.anilist_auth.get_config", return_value=cfg), \
             patch("animu.anilist_auth.httpx.Client", return_value=client_mock):
            result = execute_graphql("query { Media { id } }", {}, require_auth=False)

        self.assertEqual(result, {"data": {"Media": {"id": 1}}})
        self.assertEqual(client_mock.post.call_count, 2)
        self.assertEqual(mock_sleep.call_count, 1)

    @patch("animu.anilist_auth.time.sleep")
    def test_429_does_not_retry_when_no_retry_after_header(self, mock_sleep):
        """If Retry-After and X-RateLimit-Reset are absent, 429 is returned immediately."""
        from animu.anilist_auth import execute_graphql
        resp_429 = Mock(status_code=429)
        resp_429.headers = {}
        resp_429.json.return_value = {"errors": [{"message": "Too Many Requests.", "status": 429}]}

        client_mock = Mock()
        client_mock.__enter__ = Mock(return_value=client_mock)
        client_mock.__exit__ = Mock(return_value=False)
        client_mock.post.return_value = resp_429

        with patch("animu.anilist_auth.get_config", return_value=self._cfg()), \
             patch("animu.anilist_auth.httpx.Client", return_value=client_mock):
            result = execute_graphql("query { x }", {}, require_auth=False)

        self.assertIn("errors", result)
        # Only one call — no retry because no Retry-After value
        self.assertEqual(client_mock.post.call_count, 1)

    @patch("animu.anilist_auth.time.sleep")
    def test_429_retried_for_mutation_does_not_drop_bearer(self, mock_sleep):
        """429 on a mutation should retry WITH the bearer token intact (no auth fallback)."""
        from animu.anilist_auth import execute_graphql
        token = "secret-mutation-token"
        cfg = make_config(token=token)
        resp_429 = Mock(status_code=429)
        resp_429.headers = {"Retry-After": "1"}
        resp_429.json.return_value = {"errors": [{"message": "Too Many Requests.", "status": 429}]}
        resp_200 = Mock(status_code=200)
        resp_200.json.return_value = {"data": {"SaveMediaListEntry": {"id": 1}}}

        client_mock = Mock()
        client_mock.__enter__ = Mock(return_value=client_mock)
        client_mock.__exit__ = Mock(return_value=False)
        client_mock.post.side_effect = [resp_429, resp_200]

        with patch("animu.anilist_auth.get_config", return_value=cfg), \
             patch("animu.anilist_auth.httpx.Client", return_value=client_mock):
            result = execute_graphql("mutation { x }", {}, require_auth=True)

        self.assertEqual(result, {"data": {"SaveMediaListEntry": {"id": 1}}})
        self.assertEqual(client_mock.post.call_count, 2)
        # Both calls must have the Authorization header
        first_headers = client_mock.post.call_args_list[0].kwargs["headers"]
        second_headers = client_mock.post.call_args_list[1].kwargs["headers"]
        self.assertEqual(first_headers["Authorization"], f"Bearer {token}")
        self.assertEqual(second_headers["Authorization"], f"Bearer {token}")


class TestAuthStateAndTokenPersistence(unittest.TestCase):
    """Tests for token persistence (store/clear) and auth state reporting."""

    def setUp(self):
        from animu.anilist_auth import AniListAuth
        self.auth_mgr = AniListAuth()

    @patch("animu.anilist_auth.get_config")
    @patch("animu.anilist_auth.save_config")
    @patch("animu.anilist_auth.reload_config")
    def test_store_token_persists_issuance_timestamp(self, mock_reload, mock_save, mock_cfg):
        """store_token must save the token and set an issuance timestamp."""
        cfg = make_test_config(token="old-token", token_issued_at=12345)
        mock_cfg.return_value = cfg
        now_before = int(time.time())
        self.auth_mgr.store_token("fresh-jwt-token")
        mock_save.assert_called_once()
        saved_cfg = mock_save.call_args[0][0]
        self.assertEqual(saved_cfg.bearer_token_anilist, "fresh-jwt-token")
        self.assertIsNotNone(saved_cfg.anilist_token_issued_at)
        self.assertGreaterEqual(saved_cfg.anilist_token_issued_at, now_before)

    @patch("animu.anilist_auth.get_config")
    @patch("animu.anilist_auth.save_config")
    @patch("animu.anilist_auth.reload_config")
    def test_clear_token_removes_token_and_timestamp(self, mock_reload, mock_save, mock_cfg):
        """clear_token must null out both the token and issuance timestamp."""
        cfg = make_test_config(token="some-token", token_issued_at=99999)
        mock_cfg.return_value = cfg
        self.auth_mgr.clear_token()
        saved_cfg = mock_save.call_args[0][0]
        self.assertIsNone(saved_cfg.bearer_token_anilist)
        self.assertIsNone(saved_cfg.anilist_token_issued_at)

    @patch("animu.anilist_auth.get_config")
    @patch("animu.anilist_auth.save_config")
    @patch("animu.anilist_auth.reload_config")
    def test_store_then_clear_roundtrip(self, mock_reload, mock_save, mock_cfg):
        """After clear, the config should reflect no token."""
        cfg = make_test_config(token=None, token_issued_at=None)
        mock_cfg.return_value = cfg
        self.auth_mgr.store_token("roundtrip-token")
        self.auth_mgr.clear_token()
        saved_cfg = mock_save.call_args[0][0]
        self.assertIsNone(saved_cfg.bearer_token_anilist)
        self.assertIsNone(saved_cfg.anilist_token_issued_at)

    @patch("animu.anilist_auth.get_config")
    def test_get_token_returns_stored_value(self, mock_cfg):
        mock_cfg.return_value = make_test_config(token="my-bearer-token")
        self.assertEqual(self.auth_mgr.get_token(), "my-bearer-token")

    @patch("animu.anilist_auth.get_config")
    def test_get_token_none_when_not_set(self, mock_cfg):
        mock_cfg.return_value = make_test_config(token=None)
        self.assertIsNone(self.auth_mgr.get_token())

    @patch("animu.anilist_auth.get_config")
    def test_is_token_present_true(self, mock_cfg):
        mock_cfg.return_value = make_test_config(token="token-value")
        self.assertTrue(self.auth_mgr.is_token_present())

    @patch("animu.anilist_auth.get_config")
    def test_is_token_present_false_when_empty(self, mock_cfg):
        mock_cfg.return_value = make_test_config(token=None)
        self.assertFalse(self.auth_mgr.is_token_present())

    @patch("animu.anilist_auth.get_config")
    def test_get_expiry_info_no_token_returns_not_present(self, mock_cfg):
        mock_cfg.return_value = make_test_config(token=None)
        info = self.auth_mgr.get_expiry_info()
        self.assertFalse(info["present"])
        self.assertTrue(info["expired"])
        self.assertEqual(info["daysRemaining"], 0)

    @patch("animu.anilist_auth.get_config")
    def test_get_expiry_info_token_present_no_jwt_or_timestamp(self, mock_cfg):
        """Token present but no JWT payload and no issuance timestamp."""
        mock_cfg.return_value = make_test_config(token="opaque-token", token_issued_at=None)
        info = self.auth_mgr.get_expiry_info()
        self.assertTrue(info["present"])
        self.assertFalse(info["expired"])
        self.assertEqual(info["daysRemaining"], -1)


class TestMutationFailClosedEndToEnd(unittest.TestCase):
    """End-to-end tests through the real execute_graphql proving mutations fail
    closed on 400/401 — they never drop the bearer and never retry anonymously."""

    def _make_client(self, token="mutation-test-token"):
        """Create a mock httpx.Client with configurable responses."""
        client_mock = Mock()
        client_mock.__enter__ = Mock(return_value=client_mock)
        client_mock.__exit__ = Mock(return_value=False)
        return client_mock

    @patch("animu.anilist_auth.get_config")
    @patch("animu.anilist_auth.httpx.Client")
    def test_mutation_401_returns_error_one_call(self, mock_httpx_cls, mock_cfg):
        """A 401 on a mutation must NOT trigger an auth-fallback retry."""
        token = "my-auth-token"
        mock_cfg.return_value = make_test_config(token=token)
        resp_401 = Mock(status_code=401)
        resp_401.json.return_value = {"errors": [{"message": "Unauthorized"}]}
        client = self._make_client()
        client.post.return_value = resp_401
        mock_httpx_cls.return_value = client

        result = execute_graphql("mutation { SaveX { id } }", {"var": 1}, require_auth=True)

        self.assertEqual(result, {"errors": [{"message": "Unauthorized"}]})
        self.assertEqual(client.post.call_count, 1)
        headers = client.post.call_args.kwargs["headers"]
        self.assertEqual(headers["Authorization"], f"Bearer {token}")

    @patch("animu.anilist_auth.get_config")
    @patch("animu.anilist_auth.httpx.Client")
    def test_mutation_400_returns_error_no_anon_retry(self, mock_httpx_cls, mock_cfg):
        """A 400 on a mutation must NOT drop the bearer and retry anonymously."""
        token = "my-auth-token"
        mock_cfg.return_value = make_test_config(token=token)
        resp_400 = Mock(status_code=400)
        resp_400.json.return_value = {"errors": [{"message": "Bad request"}]}
        client = self._make_client()
        client.post.return_value = resp_400
        mock_httpx_cls.return_value = client

        result = execute_graphql("mutation { SaveX { id } }", {}, require_auth=True)

        self.assertIn("errors", result)
        self.assertEqual(client.post.call_count, 1)
        headers = client.post.call_args.kwargs["headers"]
        self.assertEqual(headers["Authorization"], f"Bearer {token}")

    @patch("animu.anilist_auth.get_config")
    @patch("animu.anilist_auth.httpx.Client")
    @patch("animu.anilist_auth.time.sleep")
    def test_mutation_429_retries_with_bearer_intact(self, mock_sleep, mock_httpx_cls, mock_cfg):
        """A 429 on a mutation should retry WITH the bearer (not drop it)."""
        token = "my-auth-token"
        mock_cfg.return_value = make_test_config(token=token)
        resp_429 = Mock(status_code=429)
        resp_429.headers = {"Retry-After": "1"}
        resp_429.json.return_value = {"errors": [{"message": "Rate limited", "status": 429}]}
        resp_200 = Mock(status_code=200)
        resp_200.json.return_value = {"data": {"SaveX": {"id": 1}}}
        client = self._make_client()
        client.post.side_effect = [resp_429, resp_200]
        mock_httpx_cls.return_value = client

        result = execute_graphql("mutation { SaveX { id } }", {}, require_auth=True)

        self.assertEqual(result, {"data": {"SaveX": {"id": 1}}})
        self.assertEqual(client.post.call_count, 2)
        # Both calls must carry the bearer token
        for call in client.post.call_args_list:
            self.assertEqual(call.kwargs["headers"]["Authorization"], f"Bearer {token}")

    @patch("animu.anilist_auth.get_config")
    @patch("animu.anilist_auth.httpx.Client")
    def test_read_401_drops_bearer_and_retries_anon(self, mock_httpx_cls, mock_cfg):
        """For contrast: a 401 on a READ drops the bearer and retries anonymous."""
        token = "read-auth-token"
        mock_cfg.return_value = make_test_config(token=token)
        resp_401 = Mock(status_code=401)
        resp_401.json.return_value = {"errors": [{"message": "Unauthorized"}]}
        resp_200 = Mock(status_code=200)
        resp_200.json.return_value = {"data": {"Media": {"id": 1}}}
        client = self._make_client()
        client.post.side_effect = [resp_401, resp_200]
        mock_httpx_cls.return_value = client

        result = execute_graphql("query { Media { id } }", {}, require_auth=False)

        self.assertEqual(result, {"data": {"Media": {"id": 1}}})
        self.assertEqual(client.post.call_count, 2)
        first_headers = client.post.call_args_list[0].kwargs["headers"]
        second_headers = client.post.call_args_list[1].kwargs["headers"]
        self.assertEqual(first_headers["Authorization"], f"Bearer {token}")
        self.assertNotIn("Authorization", second_headers)

    @patch("animu.anilist_auth.get_config")
    @patch("animu.anilist_auth.httpx.Client")
    def test_mutation_no_token_fails_closed_without_network(self, mock_httpx_cls, mock_cfg):
        """Mutation with no token must fail before any HTTP call."""
        mock_cfg.return_value = make_test_config(token=None)
        client = self._make_client()
        mock_httpx_cls.return_value = client

        result = execute_graphql("mutation { SaveX { id } }", {}, require_auth=True)

        self.assertIn("errors", result)
        self.assertIn("not configured", result["errors"][0]["message"].lower())
        client.post.assert_not_called()

    @patch("animu.anilist_auth.get_config")
    @patch("animu.anilist_auth.httpx.Client")
    def test_mutation_5xx_fails_closed_no_retry(self, mock_httpx_cls, mock_cfg):
        """5xx on a mutation must fail immediately (no retry) — fail closed.
        Only reads retry on 5xx; mutations return the error payload immediately."""
        token = "my-auth-token"
        mock_cfg.return_value = make_test_config(token=token)
        resp_502 = Mock(status_code=502)
        resp_502.json.return_value = {"errors": [{"message": "Bad gateway"}]}
        client = self._make_client()
        client.post.return_value = resp_502
        mock_httpx_cls.return_value = client

        result = execute_graphql("mutation { SaveX { id } }", {}, require_auth=True)

        self.assertIn("errors", result)
        # Only one call — no retry for mutations on 5xx
        self.assertEqual(client.post.call_count, 1)
        # The bearer token was still sent
        headers = client.post.call_args.kwargs["headers"]
        self.assertEqual(headers["Authorization"], f"Bearer {token}")


class TestExecuteGraphqlTokenNeverInResponse(unittest.TestCase):
    """The bearer token must never appear in any returned payload, even on errors."""

    @patch("animu.anilist_auth.get_config")
    @patch("animu.anilist_auth.httpx.Client")
    def test_token_not_in_success_response(self, mock_httpx_cls, mock_cfg):
        token = "NEVER-GUESS-ME-99999"
        mock_cfg.return_value = make_test_config(token=token)
        resp_200 = Mock(status_code=200)
        resp_200.json.return_value = {"data": {"Viewer": {"id": "123"}}}
        client = Mock()
        client.__enter__ = Mock(return_value=client)
        client.__exit__ = Mock(return_value=False)
        client.post.return_value = resp_200
        mock_httpx_cls.return_value = client

        result = execute_graphql("query { Viewer { id } }", {}, require_auth=False)
        serialized = json.dumps(result)
        self.assertNotIn(token, serialized)

    @patch("animu.anilist_auth.get_config")
    @patch("animu.anilist_auth.httpx.Client")
    def test_token_not_in_error_response_mutation(self, mock_httpx_cls, mock_cfg):
        token = "NEVER-GUESS-ME-99999"
        mock_cfg.return_value = make_test_config(token=token)
        resp_401 = Mock(status_code=401)
        resp_401.json.return_value = {"errors": [{"message": "Unauthorized: token invalid"}]}
        client = Mock()
        client.__enter__ = Mock(return_value=client)
        client.__exit__ = Mock(return_value=False)
        client.post.return_value = resp_401
        mock_httpx_cls.return_value = client

        result = execute_graphql("mutation { x }", {}, require_auth=True)
        serialized = json.dumps(result)
        self.assertNotIn(token, serialized)

    @patch("animu.anilist_auth.get_config")
    @patch("animu.anilist_auth.httpx.Client")
    def test_token_not_in_429_error_response(self, mock_httpx_cls, mock_cfg):
        token = "NEVER-GUESS-ME-99999"
        mock_cfg.return_value = make_test_config(token=token)
        resp_429 = Mock(status_code=429)
        resp_429.headers = {"Retry-After": "1"}
        resp_429.json.return_value = {"errors": [{"message": "Rate limited", "status": 429}]}
        client = Mock()
        client.__enter__ = Mock(return_value=client)
        client.__exit__ = Mock(return_value=False)
        client.post.return_value = resp_429
        mock_httpx_cls.return_value = client

        result = execute_graphql("query { x }", {}, require_auth=False)
        serialized = json.dumps(result)
        self.assertNotIn(token, serialized)


if __name__ == "__main__":
    unittest.main()
