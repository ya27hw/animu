import http.client as http_client
import json
import threading
import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch

from animu.anilist import AnilistClient
from animu.web import AnimuHTTPHandler, http


class TestAniListDiscoverClient(unittest.TestCase):
    def setUp(self):
        self.client = AnilistClient()
        self.config = SimpleNamespace(
            bearer_token_anilist="test-token",
            use_proxy=False,
            proxy_address=None,
            proxy_port=None,
        )

    def test_discover_maps_page_and_top_sort(self):
        page = {
            "pageInfo": {"currentPage": 2, "lastPage": 4, "hasNextPage": True},
            "media": [{"id": 1}],
        }
        with patch("animu.anilist.get_config", return_value=self.config), patch.object(
            self.client, "_query", return_value={"data": {"Page": page}}
        ) as query:
            result = self.client.get_discover_anime("top", page=2, per_page=12)

        self.assertEqual(result, page)
        variables = query.call_args.args[1]
        self.assertEqual(variables, {"page": 2, "perPage": 12, "sort": ["SCORE_DESC"]})
        self.assertIn("media(type: ANIME, sort: $sort", query.call_args.args[0])

    def test_search_and_detail_map_graphql_payloads(self):
        search_page = {"pageInfo": {}, "media": [{"id": 7}]}
        detail = {"id": 7, "title": {"romaji": "Example"}, "relations": {"edges": []}}
        with patch.object(
            self.client,
            "_query",
            side_effect=[{"data": {"Page": search_page}}, {"data": {"Media": detail}}],
        ) as query:
            self.assertEqual(self.client.search_anime("Example", page=3, per_page=5), search_page)
            self.assertEqual(self.client.get_media_detail(7), detail)

        self.assertEqual(query.call_args_list[0].args[1], {"search": "Example", "page": 3, "perPage": 5})
        self.assertEqual(query.call_args_list[1].args[1], {"id": 7})
        self.assertIn("airingSchedule", query.call_args_list[1].args[0])
        self.assertIn("relations", query.call_args_list[1].args[0])

    def test_authenticated_mutation_keeps_authorization_and_does_not_fallback(self):
        response = Mock(status_code=401)
        response.json.return_value = {"errors": [{"message": "Unauthorized"}]}
        http_client = Mock()
        http_client.__enter__ = Mock(return_value=http_client)
        http_client.__exit__ = Mock(return_value=False)
        http_client.post.return_value = response

        with patch("animu.anilist_auth.get_config", return_value=self.config), patch(
            "animu.anilist_auth.httpx.Client", return_value=http_client
        ):
            result = self.client._query("mutation { test }", {}, require_auth=True)

        self.assertEqual(result, {"errors": [{"message": "Unauthorized"}]})
        http_client.post.assert_called_once()
        self.assertEqual(http_client.post.call_args.kwargs["headers"]["Authorization"], "Bearer test-token")

    def test_mutation_error_is_returned_to_caller(self):
        with patch.object(
            self.client,
            "_query",
            return_value={"errors": [{"message": "Token expired"}]},
        ) as query:
            result = self.client.save_media_list_entry(42, status="CURRENT", progress=3, score=8.5)

        self.assertEqual(result, {"success": False, "error": "Token expired"})
        self.assertTrue(query.call_args.kwargs["require_auth"])
        self.assertEqual(
            query.call_args.args[1],
            {"mediaId": 42, "status": "CURRENT", "progress": 3, "score": 8.5},
        )


class TestAniListDiscoverRoutes(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.port = 3220
        cls.server = http.server.HTTPServer(("127.0.0.1", cls.port), AnimuHTTPHandler)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

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

    @patch("animu.web.db.get", return_value=None)
    @patch("animu.web.anilist.get_discover_anime")
    def test_discover_route_enriches_media(self, discover, _db_get):
        discover.return_value = {
            "pageInfo": {"currentPage": 1, "lastPage": 1, "hasNextPage": False},
            "media": [{"id": 7, "title": {"romaji": "Example"}}],
        }
        status, data = self.request("GET", "/api/anilist/discover?type=top&page=1")

        self.assertEqual(status, 200)
        self.assertEqual(data["type"], "top")
        self.assertFalse(data["media"][0]["localState"]["tracked"])
        discover.assert_called_once_with("top", 1, 20)

    def test_search_route_requires_query(self):
        status, data = self.request("GET", "/api/anilist/search")
        self.assertEqual(status, 400)
        self.assertEqual(data["error"], "Query parameter 'q' is required")

    @patch("animu.web.anilist.save_media_list_entry")
    def test_list_route_propagates_mutation_error(self, save_entry):
        save_entry.return_value = {"success": False, "error": "AniList Bearer Token is not configured in Settings."}
        status, data = self.request("POST", "/api/anilist/list", {"mediaId": 7, "status": "CURRENT"})

        self.assertEqual(status, 401)
        self.assertFalse(data["ok"])
        self.assertIn("Token", data["error"])
        save_entry.assert_called_once_with(media_id=7, status="CURRENT", progress=None, score=None)


if __name__ == "__main__":
    unittest.main()
