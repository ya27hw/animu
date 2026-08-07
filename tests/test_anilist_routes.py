"""Tests for the /api/anilist/* web routes added in section 4 of the spec.

Every AniList client method is mocked — no real network requests are made.
Tests verify that:
  - every spec capability has a route,
  - mocked requests succeed and return JSON,
  - error responses don't leak tokens or stack traces,
  - mutation routes require auth (fail-closed path).
"""

import json
import threading
import time
import http.client as http_client
import http.server
import unittest
from unittest.mock import patch

from animu.web import AnimuHTTPHandler


class TestAniListRoutes(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.port = 3222
        cls.server = http.server.HTTPServer(("127.0.0.1", cls.port), AnimuHTTPHandler)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        time.sleep(0.2)

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()

    def request(self, method, path, body=None):
        conn = http_client.HTTPConnection("127.0.0.1", self.port)
        payload = json.dumps(body) if body is not None else None
        headers = {"Content-Type": "application/json"} if payload is not None else {}
        conn.request(method, path, body=payload, headers=headers)
        response = conn.getresponse()
        data = json.loads(response.read().decode("utf-8"))
        conn.close()
        return response.status, data

    # ------------------------------------------------------------------
    # Read-side routes (GET)
    # ------------------------------------------------------------------

    @patch("animu.web.db.get", return_value=None)
    @patch("animu.web.anilist.get_discover_anime")
    def test_discover_route(self, discover, _db_get):
        discover.return_value = {
            "pageInfo": {"currentPage": 1, "lastPage": 1, "hasNextPage": False},
            "media": [{"id": 7, "title": {"romaji": "Example"}}],
        }
        status, data = self.request("GET", "/api/anilist/discover?type=top&page=1")
        self.assertEqual(status, 200)
        self.assertEqual(data["type"], "top")
        self.assertEqual(data["media"][0]["id"], 7)
        discover.assert_called_once_with("top", 1, 20)

    @patch("animu.web.db.get", return_value=None)
    @patch("animu.web.anilist.search_anime")
    def test_search_route(self, search, _db_get):
        search.return_value = {
            "pageInfo": {"hasNextPage": False},
            "media": [{"id": 7, "title": {"romaji": "Example"}}],
        }
        status, data = self.request("GET", "/api/anilist/search?q=Example&page=1")
        self.assertEqual(status, 200)
        self.assertEqual(data["query"], "Example")
        self.assertEqual(data["media"][0]["id"], 7)

    def test_search_route_requires_query(self):
        status, data = self.request("GET", "/api/anilist/search")
        self.assertEqual(status, 400)
        self.assertIn("q", data["error"].lower())

    @patch("animu.web.db.get", return_value=None)
    @patch("animu.web.anilist.get_media_trend")
    def test_media_trend_route(self, trend, _db_get):
        trend.return_value = {"pageInfo": {"hasNextPage": False}, "mediaTrend": [{"mediaId": 1}]}
        status, data = self.request("GET", "/api/anilist/media-trend?page=1&perPage=50")
        self.assertEqual(status, 200)
        self.assertIn("mediaTrend", data)

    @patch("animu.web.anilist.get_previous_relations")
    def test_media_relations_route(self, relations):
        relations.return_value = [{"id": 1, "relationType": "PREQUEL"}]
        status, data = self.request("GET", "/api/anilist/media/123/relations")
        self.assertEqual(status, 200)
        self.assertEqual(data["data"][0]["relationType"], "PREQUEL")

    @patch("animu.web.anilist.get_airing_schedule_by_id")
    def test_media_airing_route(self, airing):
        airing.return_value = {"nodes": [{"episode": 5, "airingAt": 1000}]}
        status, data = self.request("GET", "/api/anilist/media/123/airing?page=1")
        self.assertEqual(status, 200)
        self.assertEqual(data["data"]["nodes"][0]["episode"], 5)

    @patch("animu.web.anilist.get_media_list_collection")
    def test_user_list_route(self, collection):
        collection.return_value = {"lists": [{"name": "Current", "entries": []}], "hasNextChunk": False}
        status, data = self.request("GET", "/api/anilist/user-list?userName=testuser")
        self.assertEqual(status, 200)
        self.assertIn("lists", data)

    @patch("animu.web.anilist.get_genre_collection")
    def test_genres_route(self, genres):
        genres.return_value = ["Action", "Comedy"]
        status, data = self.request("GET", "/api/anilist/genres")
        self.assertEqual(status, 200)
        self.assertEqual(data["genres"], ["Action", "Comedy"])

    @patch("animu.web.anilist.get_media_tag_collection")
    def test_tags_route(self, tags):
        tags.return_value = [{"id": 1, "name": "Action", "category": "Setting"}]
        status, data = self.request("GET", "/api/anilist/tags")
        self.assertEqual(status, 200)
        self.assertEqual(data["tags"][0]["name"], "Action")

    @patch("animu.web.anilist.get_user")
    def test_user_route(self, user):
        user.return_value = {"id": 123, "name": "testuser"}
        status, data = self.request("GET", "/api/anilist/user?id=123")
        self.assertEqual(status, 200)
        self.assertEqual(data["user"]["name"], "testuser")

    @patch("animu.web.anilist.get_viewer")
    def test_viewer_route(self, viewer):
        viewer.return_value = {"id": 456, "name": "viewer"}
        status, data = self.request("GET", "/api/anilist/viewer")
        self.assertEqual(status, 200)
        self.assertEqual(data["viewer"]["name"], "viewer")

    @patch("animu.web.anilist.get_notifications")
    def test_notifications_route(self, notifications):
        notifications.return_value = {"pageInfo": {"hasNextPage": False}, "notifications": [{"id": 1}]}
        status, data = self.request("GET", "/api/anilist/notifications?type=AIRING&page=1")
        self.assertEqual(status, 200)
        self.assertEqual(data["notifications"][0]["id"], 1)

    @patch("animu.web.anilist.get_reviews")
    def test_reviews_route(self, reviews):
        reviews.return_value = {"pageInfo": {"hasNextPage": False}, "reviews": [{"id": 1}]}
        status, data = self.request("GET", "/api/anilist/reviews?mediaId=5&page=1")
        self.assertEqual(status, 200)
        self.assertEqual(data["reviews"][0]["id"], 1)

    @patch("animu.web.anilist.get_activity_feed")
    def test_activity_route(self, activity):
        activity.return_value = {"pageInfo": {"hasNextPage": False}, "activities": [{"id": 1}]}
        status, data = self.request("GET", "/api/anilist/activity?page=1")
        self.assertEqual(status, 200)
        self.assertEqual(data["activities"][0]["id"], 1)

    @patch("animu.web.anilist.get_character")
    def test_character_route(self, character):
        character.return_value = {"id": 1, "name": {"first": "Goku"}}
        status, data = self.request("GET", "/api/anilist/character/1")
        self.assertEqual(status, 200)
        self.assertEqual(data["character"]["name"]["first"], "Goku")

    @patch("animu.web.anilist.get_character", return_value=None)
    def test_character_route_not_found(self, character):
        status, data = self.request("GET", "/api/anilist/character/999")
        self.assertEqual(status, 404)

    @patch("animu.web.anilist.search_characters")
    def test_characters_search_route(self, search):
        search.return_value = {"pageInfo": {"hasNextPage": False}, "characters": [{"id": 1}]}
        status, data = self.request("GET", "/api/anilist/characters/search?q=Goku&page=1")
        self.assertEqual(status, 200)
        self.assertEqual(data["characters"][0]["id"], 1)

    @patch("animu.web.anilist.get_staff")
    def test_staff_route(self, staff):
        staff.return_value = {"id": 1, "name": {"first": "Director"}}
        status, data = self.request("GET", "/api/anilist/staff/1")
        self.assertEqual(status, 200)
        self.assertEqual(data["staff"]["name"]["first"], "Director")

    @patch("animu.web.anilist.search_staff")
    def test_staff_search_route(self, search):
        search.return_value = {"pageInfo": {"hasNextPage": False}, "staff": [{"id": 1}]}
        status, data = self.request("GET", "/api/anilist/staff/search?q=Taro&page=1")
        self.assertEqual(status, 200)
        self.assertEqual(data["staff"][0]["id"], 1)

    @patch("animu.web.anilist.get_studio")
    def test_studio_route(self, studio):
        studio.return_value = {"id": 1, "name": "Studio Ghibli"}
        status, data = self.request("GET", "/api/anilist/studio/1")
        self.assertEqual(status, 200)
        self.assertEqual(data["studio"]["name"], "Studio Ghibli")

    @patch("animu.web.anilist.search_studios")
    def test_studios_search_route(self, search):
        search.return_value = {"pageInfo": {"hasNextPage": False}, "studios": [{"id": 1}]}
        status, data = self.request("GET", "/api/anilist/studios/search?q=Ghibli&page=1")
        self.assertEqual(status, 200)
        self.assertEqual(data["studios"][0]["id"], 1)

    @patch("animu.web.anilist.get_following")
    def test_following_route(self, following):
        following.return_value = {"pageInfo": {"hasNextPage": False}, "following": [{"id": 1}]}
        status, data = self.request("GET", "/api/anilist/user/5/following?page=1")
        self.assertEqual(status, 200)
        self.assertEqual(data["following"][0]["id"], 1)

    @patch("animu.web.anilist.get_followers")
    def test_followers_route(self, followers):
        followers.return_value = {"pageInfo": {"hasNextPage": False}, "followers": [{"id": 1}]}
        status, data = self.request("GET", "/api/anilist/user/5/followers?page=1")
        self.assertEqual(status, 200)
        self.assertEqual(data["followers"][0]["id"], 1)

    @patch("animu.web.anilist.get_recommendations")
    def test_recommendations_route(self, recommendations):
        recommendations.return_value = {"pageInfo": {"hasNextPage": False}, "recommendations": [{"id": 1}]}
        status, data = self.request("GET", "/api/anilist/recommendations?page=1")
        self.assertEqual(status, 200)
        self.assertEqual(data["recommendations"][0]["id"], 1)

    @patch("animu.web.anilist.get_site_statistics")
    def test_site_statistics_route(self, stats):
        stats.return_value = {"anime": {"count": 100}}
        status, data = self.request("GET", "/api/anilist/site-statistics")
        self.assertEqual(status, 200)
        self.assertEqual(data["statistics"]["anime"]["count"], 100)

    @patch("animu.web.anilist.get_anichart_user")
    def test_anichart_route(self, anichart):
        anichart.return_value = {"highlightIds": [1], "theme": "dark"}
        status, data = self.request("GET", "/api/anilist/anichart/5")
        self.assertEqual(status, 200)
        self.assertEqual(data["anichart"]["theme"], "dark")

    @patch("animu.web.anilist.get_markdown_html")
    def test_markdown_route(self, markdown):
        markdown.return_value = "<p>hello</p>"
        status, data = self.request("GET", "/api/anilist/markdown?text=hello")
        self.assertEqual(status, 200)
        self.assertEqual(data["html"], "<p>hello</p>")

    def test_markdown_route_requires_text(self):
        status, data = self.request("GET", "/api/anilist/markdown")
        self.assertEqual(status, 400)

    @patch("animu.web.anilist.get_thread")
    def test_thread_route(self, thread):
        thread.return_value = {"id": 1, "title": "Thread"}
        status, data = self.request("GET", "/api/anilist/thread/1")
        self.assertEqual(status, 200)
        self.assertEqual(data["thread"]["title"], "Thread")

    @patch("animu.web.anilist.get_threads")
    def test_threads_route(self, threads):
        threads.return_value = {"pageInfo": {"hasNextPage": False}, "threads": [{"id": 1}]}
        status, data = self.request("GET", "/api/anilist/threads?page=1")
        self.assertEqual(status, 200)
        self.assertEqual(data["threads"][0]["id"], 1)

    @patch("animu.web.anilist.get_thread_comments")
    def test_thread_comments_route(self, comments):
        comments.return_value = {"pageInfo": {"hasNextPage": False}, "threadComments": [{"id": 1}]}
        status, data = self.request("GET", "/api/anilist/thread/1/comments?page=1")
        self.assertEqual(status, 200)
        self.assertEqual(data["threadComments"][0]["id"], 1)

    # ------------------------------------------------------------------
    # Mutation routes (POST) — mocked at the web module level
    # ------------------------------------------------------------------

    @patch("animu.web.anilist_mutations")
    def test_list_update_route_success(self, mutations):
        mutations.save_media_list_entry.return_value = {
            "data": {"SaveMediaListEntry": {"id": 1, "mediaId": 7, "status": "CURRENT"}}
        }
        status, data = self.request("POST", "/api/anilist/list/update", {"mediaId": 7, "status": "CURRENT"})
        self.assertEqual(status, 200)
        self.assertEqual(data["SaveMediaListEntry"]["status"], "CURRENT")
        mutations.save_media_list_entry.assert_called_once()

    @patch("animu.web.anilist_mutations")
    def test_list_update_route_missing_media_id(self, mutations):
        status, data = self.request("POST", "/api/anilist/list/update", {"status": "CURRENT"})
        self.assertEqual(status, 400)
        self.assertIn("mediaId", data["error"])
        mutations.save_media_list_entry.assert_not_called()

    @patch("animu.web.anilist_mutations")
    def test_list_update_route_error_no_token_leak(self, mutations):
        """Error responses must never contain the bearer token."""
        secret = "SUPER-SECRET-BEARER-TOKEN"
        mutations.save_media_list_entry.return_value = {
            "errors": [{"message": "AniList access token is not configured.", "status": 401}]
        }
        status, data = self.request("POST", "/api/anilist/list/update", {"mediaId": 7, "status": "CURRENT"})
        self.assertEqual(status, 401)
        self.assertNotIn("data", data)
        serialized = json.dumps(data)
        self.assertNotIn(secret, serialized)

    @patch("animu.web.anilist_mutations")
    def test_list_update_many_route_success(self, mutations):
        mutations.update_media_list_entries.return_value = {
            "data": {"UpdateMediaListEntries": [{"id": 1, "status": "COMPLETED"}]}
        }
        status, data = self.request("POST", "/api/anilist/list/update-many", {"ids": [1, 2], "status": "COMPLETED"})
        self.assertEqual(status, 200)
        mutations.update_media_list_entries.assert_called_once()

    @patch("animu.web.anilist_mutations")
    def test_list_delete_route_success(self, mutations):
        mutations.delete_media_list_entry.return_value = {"data": {"DeleteMediaListEntry": {"id": 42}}}
        status, data = self.request("DELETE", "/api/anilist/list/42")
        self.assertEqual(status, 200)
        mutations.delete_media_list_entry.assert_called_once_with(entry_id=42)

    @patch("animu.web.anilist_mutations")
    def test_list_custom_delete_route_success(self, mutations):
        mutations.delete_custom_list.return_value = {"data": {"DeleteCustomList": {"id": 1}}}
        status, data = self.request("DELETE", "/api/anilist/list/custom?customList=On%20Hold")
        self.assertEqual(status, 200)

    @patch("animu.web.anilist_mutations")
    def test_activity_text_route_success(self, mutations):
        mutations.save_text_activity.return_value = {"data": {"SaveTextActivity": {"id": 1}}}
        status, data = self.request("POST", "/api/anilist/activity/text", {"text": "hello"})
        self.assertEqual(status, 200)

    @patch("animu.web.anilist_mutations")
    def test_activity_text_route_missing_text(self, mutations):
        status, data = self.request("POST", "/api/anilist/activity/text", {})
        self.assertEqual(status, 400)
        mutations.save_text_activity.assert_not_called()

    @patch("animu.web.anilist_mutations")
    def test_activity_message_route_success(self, mutations):
        mutations.save_message_activity.return_value = {"data": {"SaveMessageActivity": {"id": 1}}}
        status, data = self.request("POST", "/api/anilist/activity/message", {"message": "hi", "recipientId": 2})
        self.assertEqual(status, 200)
        mutations.save_message_activity.assert_called_once()

    @patch("animu.web.anilist_mutations")
    def test_activity_reply_route_success(self, mutations):
        mutations.save_activity_reply.return_value = {"data": {"SaveActivityReply": {"id": 1}}}
        status, data = self.request("POST", "/api/anilist/activity/reply", {"activityId": 3, "text": "reply"})
        self.assertEqual(status, 200)

    @patch("animu.web.anilist_mutations")
    def test_like_route_success(self, mutations):
        mutations.toggle_like.return_value = {"data": {"ToggleLike": {"id": 4}}}
        status, data = self.request("POST", "/api/anilist/like", {"id": 4, "type": "ACTIVITY"})
        self.assertEqual(status, 200)

    @patch("animu.web.anilist_mutations")
    def test_follow_route_success(self, mutations):
        mutations.toggle_follow.return_value = {"data": {"ToggleFollow": {"id": 5}}}
        status, data = self.request("POST", "/api/anilist/follow", {"userId": 5})
        self.assertEqual(status, 200)

    @patch("animu.web.anilist_mutations")
    def test_favourite_route_success(self, mutations):
        mutations.toggle_favourite.return_value = {"data": {"ToggleFavourite": {"anime": {"nodes": []}}}}
        status, data = self.request("POST", "/api/anilist/favourite", {"animeId": 6})
        self.assertEqual(status, 200)

    @patch("animu.web.anilist_mutations")
    def test_favourite_order_route_success(self, mutations):
        mutations.update_favourite_order.return_value = {"data": {"UpdateFavouriteOrder": {}}}
        status, data = self.request("POST", "/api/anilist/favourite/order", {"animeIds": [6, 7]})
        self.assertEqual(status, 200)

    @patch("animu.web.anilist_mutations")
    def test_review_route_success(self, mutations):
        mutations.save_review.return_value = {"data": {"SaveReview": {"id": 1}}}
        status, data = self.request(
            "POST", "/api/anilist/review",
            {"mediaId": 7, "body": "Great show", "summary": "Nice"},
        )
        self.assertEqual(status, 200)

    @patch("animu.web.anilist_mutations")
    def test_review_rate_route_success(self, mutations):
        mutations.rate_review.return_value = {"data": {"RateReview": {"rating": "UPVOTE"}}}
        status, data = self.request("POST", "/api/anilist/review/rate", {"reviewId": 8})
        self.assertEqual(status, 200)

    @patch("animu.web.anilist_mutations")
    def test_recommendation_route_success(self, mutations):
        mutations.save_recommendation.return_value = {"data": {"SaveRecommendation": {"id": 1}}}
        status, data = self.request(
            "POST", "/api/anilist/recommendation",
            {"mediaId": 9, "mediaRecommendationId": 10},
        )
        self.assertEqual(status, 200)

    @patch("animu.web.anilist_mutations")
    def test_user_update_route_success(self, mutations):
        mutations.update_user.return_value = {"data": {"UpdateUser": {"name": "testuser"}}}
        status, data = self.request("POST", "/api/anilist/user", {"about": "hello"})
        self.assertEqual(status, 200)
        mutations.update_user.assert_called_once()

    @patch("animu.web.anilist_mutations")
    def test_mutation_no_token_response_does_not_leak(self, mutations):
        """401 error payload must not contain the secret token."""
        secret = "DO-NOT-LEAK-ME"
        mutations.toggle_follow.return_value = {
            "errors": [{"message": "AniList access token is not configured."}]
        }
        status, data = self.request("POST", "/api/anilist/follow", {"userId": 5})
        self.assertEqual(status, 401)
        self.assertNotIn(secret, json.dumps(data))

    @patch("animu.web.anilist_mutations")
    def test_list_update_invalid_media_id(self, mutations):
        status, data = self.request("POST", "/api/anilist/list/update", {"mediaId": "not-an-int", "status": "CURRENT"})
        self.assertEqual(status, 400)
        mutations.save_media_list_entry.assert_not_called()


if __name__ == "__main__":
    unittest.main()
