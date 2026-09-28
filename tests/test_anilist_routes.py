"""Tests for the /api/anilist/* web routes added in section 4 of the spec.

Every AniList client method is mocked — no real network requests are made.
Tests verify that:
  - every spec capability has a route,
  - mocked requests succeed and return JSON,
  - error responses don't leak tokens or stack traces,
  - mutation routes require auth (fail-closed path).
"""

import os
import sys
import json
import threading
import time
import http.client as http_client
import http.server
import unittest
from unittest.mock import patch

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

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

    @patch("animu.web.anilist.get_completed_sequels")
    def test_completed_sequels_route(self, mock_sequels):
        mock_sequels.return_value = {
            "sequels": [{"id": 202, "title": {"romaji": "Sequel Show"}, "status": "FINISHED"}],
            "groups": {
                "finished": [{"id": 202, "title": {"romaji": "Sequel Show"}, "status": "FINISHED"}],
                "airing": [],
                "upcoming": []
            },
            "counts": {"total": 1, "finished": 1, "airing": 0, "upcoming": 0}
        }
        status, data = self.request("GET", "/api/anilist/completed-sequels?userName=testuser")
        self.assertEqual(status, 200)
        self.assertEqual(data["counts"]["total"], 1)
        self.assertEqual(len(data["groups"]["finished"]), 1)
        self.assertEqual(data["groups"]["finished"][0]["id"], 202)

    def test_get_completed_sequels_logic(self):
        from animu.anilist import anilist
        mock_collection = {
            "lists": [
                {
                    "name": "Completed",
                    "status": "COMPLETED",
                    "entries": [
                        {
                            "mediaId": 101,
                            "status": "COMPLETED",
                            "media": {
                                "id": 101,
                                "title": {"romaji": "Show A Season 1"},
                                "relations": {
                                    "edges": [
                                        {
                                            "relationType": "SEQUEL",
                                            "node": {
                                                "id": 102,
                                                "title": {"romaji": "Show A Season 2"},
                                                "status": "FINISHED",
                                                "format": "TV"
                                            }
                                        },
                                        {
                                            "relationType": "PREQUEL",
                                            "node": {
                                                "id": 99,
                                                "title": {"romaji": "Show A Prequel"},
                                                "status": "FINISHED"
                                            }
                                        }
                                    ]
                                }
                            }
                        },
                        {
                            "mediaId": 103,
                            "status": "COMPLETED",
                            "media": {
                                "id": 103,
                                "title": {"romaji": "Show B Season 1"},
                                "relations": {
                                    "edges": [
                                        {
                                            "relationType": "SEQUEL",
                                            "node": {
                                                "id": 104,
                                                "title": {"romaji": "Show B Season 2"},
                                                "status": "RELEASING",
                                                "format": "TV"
                                            }
                                        }
                                    ]
                                }
                            }
                        },
                        {
                            "mediaId": 105,
                            "status": "COMPLETED",
                            "media": {
                                "id": 105,
                                "title": {"romaji": "Show C Season 1"},
                                "relations": {
                                    "edges": [
                                        {
                                            "relationType": "SEQUEL",
                                            "node": {
                                                "id": 106,
                                                "title": {"romaji": "Show C Season 2"},
                                                "status": "NOT_YET_RELEASED",
                                                "format": "TV"
                                            }
                                        }
                                    ]
                                }
                            }
                        },
                        {
                            # Duplicate sequel test: another entry pointing to sequel 102
                            "mediaId": 107,
                            "status": "COMPLETED",
                            "media": {
                                "id": 107,
                                "title": {"romaji": "Show A OVA"},
                                "relations": {
                                    "edges": [
                                        {
                                            "relationType": "SEQUEL",
                                            "node": {
                                                "id": 102,
                                                "title": {"romaji": "Show A Season 2"},
                                                "status": "FINISHED",
                                                "format": "TV"
                                            }
                                        }
                                    ]
                                }
                            }
                        },
                        {
                            # Sequel already on user list test: Show D Season 2 is on Watching list (id 200)
                            "mediaId": 108,
                            "status": "COMPLETED",
                            "media": {
                                "id": 108,
                                "title": {"romaji": "Show D Season 1"},
                                "relations": {
                                    "edges": [
                                        {
                                            "relationType": "SEQUEL",
                                            "node": {
                                                "id": 200,
                                                "title": {"romaji": "Show D Season 2"},
                                                "status": "FINISHED",
                                                "format": "TV"
                                            }
                                        }
                                    ]
                                }
                            }
                        },
                        {
                            # Cancelled sequel test: should NOT be grouped into upcoming or any group
                            "mediaId": 109,
                            "status": "COMPLETED",
                            "media": {
                                "id": 109,
                                "title": {"romaji": "Show E Season 1"},
                                "relations": {
                                    "edges": [
                                        {
                                            "relationType": "SEQUEL",
                                            "node": {
                                                "id": 205,
                                                "title": {"romaji": "Show E Season 2 (Cancelled)"},
                                                "status": "CANCELLED",
                                                "format": "TV"
                                            }
                                        }
                                    ]
                                }
                            }
                        }
                    ]
                },
                {
                    "name": "Watching",
                    "status": "CURRENT",
                    "entries": [
                        {"mediaId": 200, "status": "CURRENT", "media": {"id": 200, "title": {"romaji": "Show D Season 2"}}}
                    ]
                }
            ]
        }
        with patch.object(anilist, "get_media_list_collection", return_value=mock_collection):
            res = anilist.get_completed_sequels(user_name="testuser")
        self.assertIsNotNone(res)
        # Verify deduplication and exclusion:
        # Expected sequels: 102 (Show A Season 2, finished), 104 (Show B Season 2, airing), 106 (Show C Season 2, upcoming)
        # Excluded: 200 (already on watching list), 99 (prequel, not sequel), 102 (deduped from 2 completed entries to 1), 205 (cancelled)
        self.assertEqual(res["counts"]["total"], 3)
        self.assertEqual(res["counts"]["finished"], 1)
        self.assertEqual(res["counts"]["airing"], 1)
        self.assertEqual(res["counts"]["upcoming"], 1)
        self.assertEqual(res["groups"]["finished"][0]["id"], 102)
        self.assertEqual(res["groups"]["airing"][0]["id"], 104)
        self.assertEqual(res["groups"]["upcoming"][0]["id"], 106)
        # Check parentMedia annotation
        self.assertEqual(res["groups"]["finished"][0]["parentMedia"]["id"], 101)

    def test_query_design_relations_separation(self):
        """Ensure relations are removed from standard list query and kept in dedicated query."""
        from animu.anilist import anilist
        standard_query = anilist._media_list_collection_query()
        self.assertNotIn("relations", standard_query, "Standard list query should not inflate payloads with relations")

        relations_query = anilist._completed_anime_relations_query()
        self.assertIn("relations", relations_query, "Dedicated query must fetch relations for completed anime")
        self.assertIn("relationType", relations_query)

    def test_completed_sequels_invokes_dedicated_relations_query(self):
        """When collection has no relations (normal case), dedicated query is called."""
        from animu.anilist import anilist

        cache = getattr(anilist.get_completed_sequels, "_cache", None)
        if cache:
            cache.clear()
            self.addCleanup(cache.clear)

        try:
            mock_collection = {
                "lists": [
                    {
                        "name": "Completed",
                        "status": "COMPLETED",
                        "entries": [
                            {"mediaId": 301, "status": "COMPLETED", "media": {"id": 301, "title": {"romaji": "Parent"}}}
                        ]
                    },
                    {
                        "name": "Planning",
                        "status": "PLANNING",
                        "entries": [
                            {"mediaId": 302, "status": "PLANNING", "media": {"id": 302, "title": {"romaji": "Already Planned"}}}
                        ]
                    }
                ]
            }
            mock_completed_with_relations = [
                {
                    "mediaId": 301,
                    "status": "COMPLETED",
                    "media": {
                        "id": 301,
                        "title": {"romaji": "Parent"},
                        "relations": {
                            "edges": [
                                {
                                    "relationType": "SEQUEL",
                                    "node": {
                                        "id": 302,
                                        "title": {"romaji": "Already Planned"},
                                        "status": "NOT_YET_RELEASED",
                                        "format": "TV"
                                    }
                                },
                                {
                                    "relationType": "SEQUEL",
                                    "node": {
                                        "id": 303,
                                        "title": {"romaji": "New Unwatched Sequel"},
                                        "status": "RELEASING",
                                        "format": "TV"
                                    }
                                }
                            ]
                        }
                    }
                }
            ]
            with patch.object(anilist, "get_media_list_collection", return_value=mock_collection):
                with patch.object(anilist, "get_completed_anime_with_relations", return_value=mock_completed_with_relations) as mock_rel:
                    res = anilist.get_completed_sequels(user_name="dedicated_test_user")
                    mock_rel.assert_called_once_with(user_name="dedicated_test_user")
            self.assertIsNotNone(res)
            self.assertEqual(res["counts"]["total"], 1)
            self.assertEqual(res["counts"]["airing"], 1)
            self.assertEqual(res["groups"]["airing"][0]["id"], 303)
        finally:
            if cache:
                cache.clear()


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

    @patch("animu.web.anilist.get_user")
    def test_user_route_path_id(self, user):
        """Path-id contract: /api/anilist/user/<id> must look up by id, not viewer."""
        user.return_value = {"id": 123, "name": "testuser"}
        status, data = self.request("GET", "/api/anilist/user/123")
        self.assertEqual(status, 200)
        self.assertEqual(data["user"]["id"], 123)
        user.assert_called_once_with(user_id=123, user_name=None)

    @patch("animu.web.anilist.get_user")
    def test_user_route_path_name(self, user):
        """Path-name contract: /api/anilist/user/<name> must look up by name."""
        user.return_value = {"id": 123, "name": "Aymr"}
        status, data = self.request("GET", "/api/anilist/user/Aymr")
        self.assertEqual(status, 200)
        self.assertEqual(data["user"]["name"], "Aymr")
        user.assert_called_once_with(user_id=None, user_name="Aymr")

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

    @patch("animu.web.anilist.get_following")
    @patch("animu.web.anilist.get_user", return_value={"id": 42, "name": "Aymr"})
    def test_following_route_path_name(self, get_user, following):
        """Username path token resolves to an id before calling get_following."""
        following.return_value = {"pageInfo": {"hasNextPage": False}, "following": [{"id": 1}]}
        status, data = self.request("GET", "/api/anilist/user/Aymr/following?page=1")
        self.assertEqual(status, 200)
        self.assertEqual(data["following"][0]["id"], 1)
        following.assert_called_once_with(42, page=1, per_page=50, sort=None)

    @patch("animu.web.anilist.get_following")
    @patch("animu.web.anilist.get_user", return_value=None)
    def test_following_route_path_name_not_found(self, get_user, following):
        """Unresolvable username yields 404 and never calls get_following."""
        status, data = self.request("GET", "/api/anilist/user/ghost/following?page=1")
        self.assertEqual(status, 404)
        following.assert_not_called()

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
