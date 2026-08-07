"""Tests for AniList mutations (animu/anilist_mutations.py).

Every AniList API call is mocked via the shared ``execute_graphql``
primitive — no real network requests are ever made and no real AniList
mutations fire.
"""

import json
import unittest
from unittest.mock import patch, call

from animu.anilist_mutations import AniListMutations, mutations
import animu.anilist_mutations as mut_module


def make_test_config(token="test-secret-token-xyz"):
    """Return a minimal config-like object with the attributes accessed by
    AniListMutations / execute_graphql internals during token checks."""
    from types import SimpleNamespace
    return SimpleNamespace(
        bearer_token_anilist=token,  # type: ignore[arg-type]
        ani_user_name="testuser",
        anilist_client_id="cid",
        anilist_client_secret="csec",
        anilist_redirect_uri="http://localhost/callback",
        anilist_token_issued_at=0,
        use_proxy=False,
        proxy_address=None,
        proxy_port=None,
        proxy_username=None,
        proxy_password=None,
    )


class TestMutationAuthWiring(unittest.TestCase):
    """Every mutation must call execute_graphql with require_auth=True."""

    def setUp(self):
        self.m = AniListMutations()
        self.cfg_patcher = patch.object(mut_module, "get_config")
        self.mock_cfg = self.cfg_patcher.start()
        self.mock_cfg.return_value = make_test_config()
        # _require_token() checks auth.is_token_present() which reads config via
        # the anilist_auth module namespace — patch it directly so the
        # no-token path is exercised separately.
        self.auth_patch = patch.object(
            mut_module.auth, "is_token_present", return_value=True
        )
        self.auth_patch.start()

    def tearDown(self):
        self.cfg_patcher.stop()
        self.auth_patch.stop()

    @patch.object(mut_module, "execute_graphql")
    def test_every_mutation_uses_require_auth_true(self, mock_exec):
        mock_exec.return_value = {"data": {"x": {"id": 1}}}
        secret = "test-secret-token-xyz"
        cfg = make_test_config(token=secret)
        self.mock_cfg.return_value = cfg

        # Invoke each mutation path that exists on the class.
        self.m.save_media_list_entry(media_id=1)
        self.m.update_media_list_entries(ids=[1])
        self.m.delete_media_list_entry(entry_id=1)
        self.m.delete_custom_list(custom_list="X")
        self.m.save_text_activity(text="hi")
        self.m.save_message_activity(message="hi", recipient_id=2)
        self.m.save_activity_reply(activity_id=3, text="hi")
        self.m.toggle_like(likeable_id=4)
        self.m.toggle_follow(user_id=5)
        self.m.toggle_favourite(anime_id=6)
        self.m.update_favourite_order(anime_ids=[6])
        self.m.save_review(media_id=7, body="body")
        self.m.rate_review(review_id=8)
        self.m.save_recommendation(media_id=9, media_recommendation_id=10)
        self.m.update_user(about="hello")

        # Every call must have require_auth=True and must carry the bearer.
        # The spec lists 15 required mutations.
        self.assertGreaterEqual(mock_exec.call_count, 15)
        for c in mock_exec.call_args_list:
            args, kwargs = c
            # First two positional args are query and variables.
            query = args[0] if len(args) > 0 else kwargs.get("query", "")
            variables = args[1] if len(args) > 1 else kwargs.get("variables", {})
            # require_auth kwarg
            self.assertTrue(
                kwargs.get("require_auth") is True,
                f"mutation {c} did not pass require_auth=True",
            )
            # No token leakage: token string is not present in the query text
            # or in the variables dict.
            self.assertNotIn(secret, query)
            self.assertNotIn(secret, json.dumps(variables, default=str))

    @patch.object(mut_module, "execute_graphql")
    def test_save_media_list_entry_includes_advanced_fields(self, mock_exec):
        mock_exec.return_value = {"data": {"SaveMediaListEntry": {"id": 1}}}
        self.m.save_media_list_entry(
            media_id=5,
            custom_lists=["Watching", "On Hold"],
            advanced_scores=[1.0, 2.5],
            score_raw=87,
        )
        kwargs = mock_exec.call_args.kwargs
        args = mock_exec.call_args.args
        vars_ = args[1] if len(args) > 1 else kwargs["variables"]
        self.assertEqual(vars_["mediaId"], 5)
        self.assertEqual(vars_["customLists"], ["Watching", "On Hold"])
        self.assertEqual(vars_["advancedScores"], [1.0, 2.5])
        self.assertEqual(vars_["scoreRaw"], 87)
        self.assertTrue(kwargs["require_auth"])


class TestMutationFailClosed(unittest.TestCase):
    """Mutations must fail closed on 400/401 without dropping the bearer
    and without retrying anonymously."""

    def setUp(self):
        self.m = AniListMutations()
        self.cfg_patcher = patch.object(mut_module, "get_config")
        self.mock_cfg = self.cfg_patcher.start()
        self.mock_cfg.return_value = make_test_config(token="legit-token-123")
        self.auth_patch = patch.object(
            mut_module.auth, "is_token_present", return_value=True
        )
        self.auth_patch.start()

    def tearDown(self):
        self.cfg_patcher.stop()
        self.auth_patch.stop()

    @patch.object(mut_module, "execute_graphql")
    def test_401_returns_error_payload_no_anon_retry(self, mock_exec):
        mock_exec.return_value = {
            "errors": [{"message": "Unauthorized", "status": 401}]
        }
        result = self.m.save_media_list_entry(media_id=1)
        self.assertNotIn("data", result)
        self.assertIn("errors", result)
        # execute_graphql was called exactly once (no anonymous retry).
        self.assertEqual(mock_exec.call_count, 1)
        self.assertTrue(mock_exec.call_args.kwargs["require_auth"] is True)

    @patch.object(mut_module, "execute_graphql")
    def test_400_returns_error_payload_no_anon_retry(self, mock_exec):
        mock_exec.return_value = {
            "errors": [{"message": "Bad request", "status": 400}]
        }
        result = self.m.toggle_follow(user_id=9)
        self.assertIn("errors", result)
        self.assertEqual(mock_exec.call_count, 1)

    @patch.object(mut_module, "execute_graphql")
    def test_no_token_raises_clear_error(self, mock_exec):
        self.mock_cfg.return_value = make_test_config(token=None)
        # Force the no-token path so _require_token raises.
        self.auth_patch.stop()
        patch.object(mut_module.auth, "is_token_present", return_value=False).start()
        with self.assertRaises(RuntimeError) as ctx:
            self.m.save_text_activity(text="hi")
        self.assertIn("not configured", str(ctx.exception).lower())
        # execute_graphql must not be called when no token present.
        mock_exec.assert_not_called()


class TestNoTokenLeakage(unittest.TestCase):
    """The bearer token must never appear in returned payloads."""

    def setUp(self):
        self.m = AniListMutations()
        self.cfg_patcher = patch.object(mut_module, "get_config")
        self.mock_cfg = self.cfg_patcher.start()
        self.auth_patch = patch.object(
            mut_module.auth, "is_token_present", return_value=True
        )
        self.auth_patch.start()

    def tearDown(self):
        self.cfg_patcher.stop()
        self.auth_patch.stop()

    @patch.object(mut_module, "execute_graphql")
    def test_token_not_in_result(self, mock_exec):
        secret = "SUPER-SECRET-TOKEN-777"
        self.mock_cfg.return_value = make_test_config(token=secret)
        mock_exec.return_value = {"data": {"ToggleFollow": {"id": "abc"}}}
        result = self.m.toggle_follow(user_id=1)
        serialized = json.dumps(result, default=str)
        self.assertNotIn(secret, serialized)


class TestMutationDispatch(unittest.TestCase):
    """Smoke-test that all 16 mutations dispatch through require_auth path
    with correct variable wiring (mocked execute_graphql)."""

    def setUp(self):
        self.m = AniListMutations()
        self.cfg_patcher = patch.object(mut_module, "get_config")
        self.mock_cfg = self.cfg_patcher.start()
        self.mock_cfg.return_value = make_test_config(token="tok")
        self.auth_patch = patch.object(
            mut_module.auth, "is_token_present", return_value=True
        )
        self.auth_patch.start()

    def tearDown(self):
        self.cfg_patcher.stop()
        self.auth_patch.stop()

    @patch.object(mut_module, "execute_graphql")
    def test_all_mutations_dispatched(self, mock_exec):
        mock_exec.return_value = {"data": {"r": {"id": 1}}}
        cases = [
            ("save_media_list_entry", {"media_id": 1}),
            ("update_media_list_entries", {"ids": [1, 2]}),
            ("delete_media_list_entry", {"entry_id": 1}),
            ("delete_custom_list", {"custom_list": "X"}),
            ("save_text_activity", {"text": "t"}),
            ("save_message_activity", {"message": "m", "recipient_id": 2}),
            ("save_activity_reply", {"activity_id": 3, "text": "t"}),
            ("toggle_like", {"likeable_id": 4}),
            ("toggle_follow", {"user_id": 5}),
            ("toggle_favourite", {"anime_id": 6}),
            ("update_favourite_order", {"anime_ids": [6]}),
            ("save_review", {"media_id": 7, "body": "b"}),
            ("rate_review", {"review_id": 8}),
            ("save_recommendation", {"media_id": 9, "media_recommendation_id": 10}),
            ("update_user", {"about": "bio"}),
        ]
        for name, kwargs in cases:
            getattr(self.m, name)(**kwargs)

        self.assertEqual(mock_exec.call_count, len(cases))
        for c in mock_exec.call_args_list:
            self.assertTrue(c.kwargs["require_auth"] is True)


if __name__ == "__main__":
    unittest.main()
