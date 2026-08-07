"""Tests for AniList OAuth2 auth flow, token storage, and shared execute_graphql.

All AniList API calls are mocked — no real network requests are made.
"""

import urllib.parse
import base64
import json
import time
import http.client as http_client
import threading
import http.server
import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch

from animu.anilist_auth import (
    AniListAuth,
    AniListAuth as _AuthAlias,  # verify class is importable
    execute_graphql,
    _decode_jwt_payload,
    SENSITIVE_CONFIG_FIELDS,
    ANILIST_AUTH_URL,
    ANILIST_TOKEN_URL,
    ANILIST_PIN_REDIRECT,
    TOKEN_LIFETIME_SECONDS,
)
from animu.web import AnimuHTTPHandler
from animu.config import ProfileConfig


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def make_jwt(exp_delta_seconds: int = TOKEN_LIFETIME_SECONDS) -> str:
    """Create a fake JWT with a given expiry offset from now."""
    header = base64.urlsafe_b64encode(b'{"alg":"HS256"}').rstrip(b"=").decode()
    payload = base64.urlsafe_b64encode(
        json.dumps({"sub": 12345, "exp": int(time.time()) + exp_delta_seconds}).encode()
    ).rstrip(b"=").decode()
    signature = "fake-signature"
    return f"{header}.{payload}.{signature}"


def make_test_config(token=None, client_id="test-client-id", client_secret="test-secret",
                     redirect_uri="http://localhost:3210/api/anilist/auth/callback",
                     token_issued_at=None):
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


# ---------------------------------------------------------------------------
# JWT decode tests
# ---------------------------------------------------------------------------


class TestJWTDecode(unittest.TestCase):
    def test_decode_valid_jwt_payload(self):
        token = make_jwt(exp_delta_seconds=3600)
        payload = _decode_jwt_payload(token)
        self.assertIsNotNone(payload)
        self.assertEqual(payload["sub"], 12345)
        self.assertIn("exp", payload)

    def test_decode_invalid_token_returns_none(self):
        self.assertIsNone(_decode_jwt_payload(None))
        self.assertIsNone(_decode_jwt_payload(""))
        self.assertIsNone(_decode_jwt_payload("not.a.jwt"))
        self.assertIsNone(_decode_jwt_payload("onlyonepart"))
        self.assertIsNone(_decode_jwt_payload("a.b"))

    def test_decode_does_not_return_signature(self):
        """The decode helper must only return the payload, never the token."""
        token = make_jwt()
        payload = _decode_jwt_payload(token)
        self.assertNotIn("signature", payload)
        self.assertNotIn(token, str(payload))


# ---------------------------------------------------------------------------
# AniListAuth tests
# ---------------------------------------------------------------------------


class TestAniListAuth(unittest.TestCase):
    def setUp(self):
        self.auth_mgr = AniListAuth()

    @patch("animu.anilist_auth.get_config")
    def test_auth_url_uses_client_id_and_implicit_grant(self, mock_cfg):
        mock_cfg.return_value = make_test_config()
        url = self.auth_mgr.build_authorization_url(response_type="token")
        self.assertIn(ANILIST_AUTH_URL, url)
        self.assertIn("client_id=test-client-id", url)
        self.assertIn("response_type=token", url)
        self.assertIn("redirect_uri=http", url)

    @patch("animu.anilist_auth.get_config")
    def test_auth_url_uses_code_grant_by_default(self, mock_cfg):
        mock_cfg.return_value = make_test_config()
        url = self.auth_mgr.build_authorization_url()
        self.assertIn("response_type=code", url)

    @patch("animu.anilist_auth.get_config")
    def test_auth_url_raises_without_client_id(self, mock_cfg):
        mock_cfg.return_value = make_test_config(client_id=None)
        with self.assertRaises(ValueError):
            self.auth_mgr.build_authorization_url()

    @patch("animu.anilist_auth.get_config")
    def test_pin_url_uses_pin_redirect(self, mock_cfg):
        mock_cfg.return_value = make_test_config()
        url = self.auth_mgr.build_pin_url()
        self.assertIn("redirect_uri=" + urllib.parse.quote(ANILIST_PIN_REDIRECT, safe=""), url)
        self.assertIn("response_type=code", url)
        self.assertIn("client_id=test-client-id", url)

    @patch("animu.anilist_auth.get_config")
    def test_pin_url_raises_without_client_id(self, mock_cfg):
        mock_cfg.return_value = make_test_config(client_id=None)
        with self.assertRaises(ValueError):
            self.auth_mgr.build_pin_url()

    @patch("animu.anilist_auth.get_config")
    def test_needs_reauth_true_when_no_token(self, mock_cfg):
        mock_cfg.return_value = make_test_config(token=None)
        self.assertTrue(self.auth_mgr.needs_reauth())

    @patch("animu.anilist_auth.get_config")
    def test_needs_reauth_false_with_valid_jwt(self, mock_cfg):
        token = make_jwt(exp_delta_seconds=TOKEN_LIFETIME_SECONDS - 86400)
        mock_cfg.return_value = make_test_config(token=token)
        self.assertFalse(self.auth_mgr.needs_reauth())

    @patch("animu.anilist_auth.get_config")
    def test_needs_reauth_true_when_jwt_near_expiry(self, mock_cfg):
        # Token expires in 1 day — within the 7-day safety margin
        token = make_jwt(exp_delta_seconds=86400)
        mock_cfg.return_value = make_test_config(token=token)
        self.assertTrue(self.auth_mgr.needs_reauth())

    @patch("animu.anilist_auth.get_config")
    def test_needs_reauth_true_when_jwt_expired(self, mock_cfg):
        token = make_jwt(exp_delta_seconds=-100)
        mock_cfg.return_value = make_test_config(token=token)
        self.assertTrue(self.auth_mgr.needs_reauth())

    @patch("animu.anilist_auth.get_config")
    def test_needs_reauth_falls_back_to_issuance_timestamp(self, mock_cfg):
        """When JWT can't be decoded, issuance timestamp should be used."""
        issued_at = int(time.time()) - (TOKEN_LIFETIME_SECONDS - 86400)
        mock_cfg.return_value = make_test_config(
            token="not.a.valid.jwt",
            token_issued_at=issued_at,
        )
        self.assertTrue(self.auth_mgr.needs_reauth())

    @patch("animu.anilist_auth.get_config")
    def test_needs_reauth_false_with_issuance_timestamp_and_valid_token(self, mock_cfg):
        issued_at = int(time.time()) - (TOKEN_LIFETIME_SECONDS - TOKEN_LIFETIME_SECONDS + 30 * 86400)
        mock_cfg.return_value = make_test_config(
            token="not.a.valid.jwt",
            token_issued_at=issued_at,
        )
        self.assertFalse(self.auth_mgr.needs_reauth())

    @patch("animu.anilist_auth.get_config")
    def test_get_expiry_info_no_token(self, mock_cfg):
        mock_cfg.return_value = make_test_config(token=None)
        info = self.auth_mgr.get_expiry_info()
        self.assertFalse(info["present"])
        self.assertTrue(info["expired"])
        self.assertEqual(info["daysRemaining"], 0)

    @patch("animu.anilist_auth.get_config")
    def test_get_expiry_info_with_valid_jwt(self, mock_cfg):
        token = make_jwt(exp_delta_seconds=300 * 86400)  # ~10 months
        mock_cfg.return_value = make_test_config(token=token)
        info = self.auth_mgr.get_expiry_info()
        self.assertTrue(info["present"])
        self.assertFalse(info["expired"])
        self.assertGreater(info["daysRemaining"], 290)

    @patch("animu.anilist_auth.get_config")
    def test_get_expiry_info_never_includes_token(self, mock_cfg):
        token = make_jwt()
        mock_cfg.return_value = make_test_config(token=token)
        info = self.auth_mgr.get_expiry_info()
        self.assertNotIn(token, json.dumps(info))

    @patch("animu.anilist_auth.get_config")
    def test_is_token_present(self, mock_cfg):
        mock_cfg.return_value = make_test_config(token="valid-token")
        self.assertTrue(self.auth_mgr.is_token_present())

    @patch("animu.anilist_auth.get_config")
    def test_is_token_present_false_when_none(self, mock_cfg):
        mock_cfg.return_value = make_test_config(token=None)
        self.assertFalse(self.auth_mgr.is_token_present())

    @patch("animu.anilist_auth.get_config")
    def test_store_token_sets_issuance_timestamp(self, mock_cfg):
        cfg = make_test_config()
        mock_cfg.return_value = cfg
        now_before = int(time.time())
        with patch("animu.anilist_auth.save_config") as mock_save:
            self.auth_mgr.store_token("new-jwt-token")
            mock_save.assert_called_once()
            saved_cfg = mock_save.call_args[0][0]
            self.assertEqual(saved_cfg.bearer_token_anilist, "new-jwt-token")
            self.assertIsNotNone(saved_cfg.anilist_token_issued_at)
            self.assertGreaterEqual(saved_cfg.anilist_token_issued_at, now_before)

    @patch("animu.anilist_auth.get_config")
    def test_clear_token_nukes_token_and_timestamp(self, mock_cfg):
        cfg = make_test_config(token="some-token", token_issued_at=12345)
        mock_cfg.return_value = cfg
        with patch("animu.anilist_auth.save_config") as mock_save, \
             patch("animu.anilist_auth.reload_config"):
            self.auth_mgr.clear_token()
            saved_cfg = mock_save.call_args[0][0]
            self.assertIsNone(saved_cfg.bearer_token_anilist)
            self.assertIsNone(saved_cfg.anilist_token_issued_at)

    @patch("animu.anilist_auth.get_config")
    def test_exchange_code_success(self, mock_cfg):
        mock_cfg.return_value = make_test_config()
        fake_token = make_jwt()

        fake_resp = Mock()
        fake_resp.status_code = 200
        fake_resp.json.return_value = {"access_token": fake_token, "token_type": "Bearer"}

        with patch.object(self.auth_mgr.client, "post", return_value=fake_resp) as mock_post:
            token, error = self.auth_mgr.exchange_code_for_token("auth-code-123")

        self.assertIsNone(error)
        self.assertEqual(token, fake_token)
        called_data = mock_post.call_args.kwargs.get("data") or mock_post.call_args[0]
        # Verify the token endpoint was used and grant_type is authorization_code
        self.assertEqual(mock_post.call_args[0][0], ANILIST_TOKEN_URL)
        self.assertEqual(called_data["code"], "auth-code-123")
        self.assertEqual(called_data["grant_type"], "authorization_code")

    @patch("animu.anilist_auth.get_config")
    def test_exchange_code_failure_no_credentials(self, mock_cfg):
        mock_cfg.return_value = make_test_config(client_id=None, client_secret=None)
        token, error = self.auth_mgr.exchange_code_for_token("code")
        self.assertIsNone(token)
        self.assertIn("not configured", error)

    @patch("animu.anilist_auth.get_config")
    def test_exchange_code_http_error(self, mock_cfg):
        mock_cfg.return_value = make_test_config()
        fake_resp = Mock()
        fake_resp.status_code = 400
        fake_resp.json.return_value = {"error": "bad_request"}

        with patch.object(self.auth_mgr.client, "post", return_value=fake_resp):
            token, error = self.auth_mgr.exchange_code_for_token("bad-code")

        self.assertIsNone(token)
        self.assertIn("400", error)

    @patch("animu.anilist_auth.get_config")
    def test_exchange_code_connection_error(self, mock_cfg):
        mock_cfg.return_value = make_test_config()
        with patch.object(self.auth_mgr.client, "post", side_effect=Exception("network")):
            token, error = self.auth_mgr.exchange_code_for_token("code")
        self.assertIsNone(token)
        self.assertIn("failed", error.lower())

    @patch("animu.anilist_auth.get_config")
    def test_token_never_in_error_message(self, mock_cfg):
        mock_cfg.return_value = make_test_config()
        fake_resp = Mock()
        fake_resp.status_code = 400
        fake_resp.json.return_value = {"error": "invalid_grant"}

        with patch.object(self.auth_mgr.client, "post", return_value=fake_resp):
            token, error = self.auth_mgr.exchange_code_for_token("bad-code")
        self.assertIsNone(token)
        # Error message must not contain the token
        fake_err_token = make_jwt()
        self.assertNotIn(fake_err_token, str(error))


# ---------------------------------------------------------------------------
# execute_graphql tests
# ---------------------------------------------------------------------------


class TestExecuteGraphql(unittest.TestCase):
    @patch("animu.anilist_auth.get_config")
    @patch("animu.anilist_auth.httpx.Client")
    def test_no_token_and_require_auth_fails_closed(self, mock_httpx_cls, mock_cfg):
        mock_cfg.return_value = make_test_config(token=None)
        client = Mock()
        client.__enter__ = Mock(return_value=client)
        client.__exit__ = Mock(return_value=False)
        mock_httpx_cls.return_value = client

        result = execute_graphql("mutation { x }", {}, require_auth=True)

        self.assertIn("errors", result)
        self.assertIn("not configured", result["errors"][0]["message"].lower())
        # Must NOT have made any HTTP call
        client.post.assert_not_called()

    @patch("animu.anilist_auth.get_config")
    @patch("animu.anilist_auth.httpx.Client")
    def test_read_fallback_drops_bearer_on_401(self, mock_httpx_cls, mock_cfg):
        token = "secret-token-abc123"
        mock_cfg.return_value = make_test_config(token=token)

        # First call: 401 (token expired). Second call: 200 (anonymous read)
        resp_401 = Mock(status_code=401)
        resp_401.json.return_value = {"errors": [{"message": "Unauthorized"}]}
        resp_200 = Mock(status_code=200)
        resp_200.json.return_value = {"data": {"Media": {"id": 1}}}

        client = Mock()
        client.__enter__ = Mock(return_value=client)
        client.__exit__ = Mock(return_value=False)
        client.post.side_effect = [resp_401, resp_200]
        mock_httpx_cls.return_value = client

        result = execute_graphql("query Media { id }", {}, require_auth=False)

        self.assertEqual(result, {"data": {"Media": {"id": 1}}})
        self.assertEqual(client.post.call_count, 2)

        # First call had Authorization header
        first_headers = client.post.call_args_list[0].kwargs["headers"]
        self.assertEqual(first_headers["Authorization"], f"Bearer {token}")

        # Second call (after fallback) did NOT have Authorization header
        second_headers = client.post.call_args_list[1].kwargs["headers"]
        self.assertNotIn("Authorization", second_headers)

    @patch("animu.anilist_auth.get_config")
    @patch("animu.anilist_auth.httpx.Client")
    def test_mutation_never_drops_bearer_on_401(self, mock_httpx_cls, mock_cfg):
        """require_auth=True must NOT retry without the bearer token."""
        token = "secret-token-abc123"
        mock_cfg.return_value = make_test_config(token=token)

        resp_401 = Mock(status_code=401)
        resp_401.json.return_value = {"errors": [{"message": "Unauthorized"}]}

        client = Mock()
        client.__enter__ = Mock(return_value=client)
        client.__exit__ = Mock(return_value=False)
        client.post.return_value = resp_401
        mock_httpx_cls.return_value = client

        result = execute_graphql("mutation { x }", {}, require_auth=True)

        self.assertEqual(result, {"errors": [{"message": "Unauthorized"}]})
        # Only one call — no auth fallback retry
        self.assertEqual(client.post.call_count, 1)
        # Bearer header was present on the only call
        headers = client.post.call_args.kwargs["headers"]
        self.assertEqual(headers["Authorization"], f"Bearer {token}")

    @patch("animu.anilist_auth.get_config")
    @patch("animu.anilist_auth.httpx.Client")
    @patch("animu.anilist_auth.time.sleep")
    def test_429_retry_after_handling(self, mock_sleep, mock_httpx_cls, mock_cfg):
        """429 responses should honor Retry-After and retry."""
        mock_cfg.return_value = make_test_config(token="tok")

        resp_429 = Mock(status_code=429)
        resp_429.headers = {"Retry-After": "1", "X-RateLimit-Reset": "9999999999"}
        resp_429.json.return_value = {
            "errors": [{"message": "Too Many Requests.", "status": 429}]
        }
        resp_200 = Mock(status_code=200)
        resp_200.json.return_value = {"data": {"Media": {"id": 1}}}

        client = Mock()
        client.__enter__ = Mock(return_value=client)
        client.__exit__ = Mock(return_value=False)
        client.post.side_effect = [resp_429, resp_200]
        mock_httpx_cls.return_value = client

        result = execute_graphql("query { Media { id } }", {}, require_auth=False)

        self.assertEqual(result, {"data": {"Media": {"id": 1}}})
        self.assertEqual(client.post.call_count, 2)
        self.assertEqual(mock_sleep.call_count, 1)

    @patch("animu.anilist_auth.get_config")
    @patch("animu.anilist_auth.httpx.Client")
    @patch("animu.anilist_auth.time.sleep")
    def test_429_exhausted_returns_error(self, mock_sleep, mock_httpx_cls, mock_cfg):
        """If 429 persists through max retries, return the error payload."""
        mock_cfg.return_value = make_test_config(token="tok")

        resp_429 = Mock(status_code=429)
        resp_429.headers = {"Retry-After": "1"}
        resp_429.json.return_value = {
            "errors": [{"message": "Too Many Requests.", "status": 429}]
        }

        client = Mock()
        client.__enter__ = Mock(return_value=client)
        client.__exit__ = Mock(return_value=False)
        client.post.return_value = resp_429
        mock_httpx_cls.return_value = client

        result = execute_graphql("query { x }", {}, require_auth=False)

        self.assertIn("errors", result)
        self.assertIn("429", str(result["errors"]))

    @patch("animu.anilist_auth.get_config")
    @patch("animu.anilist_auth.httpx.Client")
    @patch("animu.anilist_auth.time.sleep")
    def test_5xx_retry_with_backoff(self, mock_sleep, mock_httpx_cls, mock_cfg):
        """5xx responses should be retried with exponential backoff."""
        mock_cfg.return_value = make_test_config(token=None)  # no token, read query

        resp_502 = Mock(status_code=502)
        resp_502.json.return_value = {}
        resp_200 = Mock(status_code=200)
        resp_200.json.return_value = {"data": {"Page": {"media": []}}}

        client = Mock()
        client.__enter__ = Mock(return_value=client)
        client.__exit__ = Mock(return_value=False)
        client.post.side_effect = [resp_502, resp_502, resp_200]
        mock_httpx_cls.return_value = client

        result = execute_graphql("query { x }", None, require_auth=False)

        self.assertEqual(result, {"data": {"Page": {"media": []}}})
        self.assertEqual(client.post.call_count, 3)
        self.assertEqual(mock_sleep.call_count, 2)

    @patch("animu.anilist_auth.get_config")
    @patch("animu.anilist_auth.httpx.Client")
    def test_response_never_contains_token(self, mock_httpx_cls, mock_cfg):
        """The bearer token must never appear in the returned payload."""
        token = "SUPER-SECRET-TOKEN-XYZ"
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
    def test_response_error_never_contains_token(self, mock_httpx_cls, mock_cfg):
        """Even on error responses, the token must not leak."""
        token = "SUPER-SECRET-TOKEN-XYZ"
        mock_cfg.return_value = make_test_config(token=token)

        resp_401 = Mock(status_code=401)
        resp_401.json.return_value = {"errors": [{"message": "Unauthorized"}]}

        client = Mock()
        client.__enter__ = Mock(return_value=client)
        client.__exit__ = Mock(return_value=False)
        client.post.return_value = resp_401
        mock_httpx_cls.return_value = client

        # require_auth=True — fail closed, no retry
        result = execute_graphql("mutation { x }", {}, require_auth=True)

        serialized = json.dumps(result)
        self.assertNotIn(token, serialized)


# ---------------------------------------------------------------------------
# Config sanitization tests
# ---------------------------------------------------------------------------


class TestConfigSanitization(unittest.TestCase):
    def test_sanitize_strips_token(self):
        from animu.web import sanitize_config_for_api, get_config_dict, MAP_ATTR_TO_JSON
        from animu.config import ProfileConfig

        cfg = ProfileConfig(
            bearer_token_anilist="secret-token",
            anilist_token_issued_at=1234567890,
            anilist_client_id="client-id",
            anilist_client_secret="client-secret",
            ani_user_name="testuser",
        )
        raw = get_config_dict(cfg)
        sanitized = sanitize_config_for_api(raw)

        # Token must be absent
        self.assertNotIn("bearerTokenAnilist", sanitized)
        self.assertNotIn("bearer_token_anilist", sanitized)
        self.assertNotIn("anilistTokenIssuedAt", sanitized)
        self.assertNotIn("anilist_token_issued_at", sanitized)
        # Client ID should still be present (not sensitive for the SPA)
        self.assertIn("anilistClientId", sanitized)

    def test_sanitize_strips_client_secret(self):
        from animu.web import sanitize_config_for_api, get_config_dict
        from animu.config import ProfileConfig

        cfg = ProfileConfig(
            anilist_client_secret="super-secret",
        )
        raw = get_config_dict(cfg)
        sanitized = sanitize_config_for_api(raw)

        # Client secret must also be stripped
        self.assertNotIn("anilistClientSecret", sanitized)
        self.assertNotIn("anilist_client_secret", sanitized)

    def test_sensitive_fields_constant_includes_token(self):
        self.assertIn("bearer_token_anilist", SENSITIVE_CONFIG_FIELDS)
        self.assertIn("anilist_client_secret", SENSITIVE_CONFIG_FIELDS)


# ---------------------------------------------------------------------------
# Route tests (HTTP integration with mocked AniListAuth)
# ---------------------------------------------------------------------------


class TestAuthRoutes(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.port = 3221
        cls.server = http.server.HTTPServer(("127.0.0.1", cls.port), AnimuHTTPHandler)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()

    def _request(self, method, path, body=None):
        conn = http_client.HTTPConnection("127.0.0.1", self.port)
        payload = json.dumps(body) if body is not None else None
        headers = {"Content-Type": "application/json"} if payload is not None else {}
        conn.request(method, path, body=payload, headers=headers)
        response = conn.getresponse()
        data = json.loads(response.read().decode("utf-8"))
        conn.close()
        return response.status, data

    def test_auth_url_route(self):
        with patch("animu.web.anilist_auth") as mock_auth:
            mock_auth.build_authorization_url.return_value = "https://anilist.co/api/v2/oauth/authorize?client_id=test"
            mock_auth.get_config.return_value = make_test_config()
            status, data = self._request("GET", "/api/anilist/auth/url")

        self.assertEqual(status, 200)
        self.assertIn("authUrl", data)
        self.assertIn("client_id=test", data["authUrl"])

    def test_auth_url_route_missing_client_id(self):
        with patch("animu.web.anilist_auth") as mock_auth:
            mock_auth.build_authorization_url.side_effect = ValueError("AniList client ID is not configured")
            status, data = self._request("GET", "/api/anilist/auth/url")

        self.assertEqual(status, 500)
        self.assertIn("error", data)

    def test_auth_pin_route(self):
        with patch("animu.web.anilist_auth") as mock_auth:
            mock_auth.build_pin_url.return_value = "https://anilist.co/api/v2/oauth/authorize?client_id=test&redirect_uri=https://anilist.co/api/v2/oauth/pin"
            mock_auth.get_config.return_value = make_test_config()
            status, data = self._request("GET", "/api/anilist/auth/pin")

        self.assertEqual(status, 200)
        self.assertIn("authUrl", data)
        self.assertIn("pinRedirect", data)
        self.assertTrue(data["pinRedirect"])

    def test_auth_state_route_no_token(self):
        with patch("animu.web.anilist_auth") as mock_auth_mod:
            mock_auth_mod.is_token_present.return_value = False
            mock_auth_mod.needs_reauth.return_value = True
            mock_auth_mod.get_user_name.return_value = "testuser"
            mock_auth_mod.get_expiry_info.return_value = {"present": False, "expired": True, "daysRemaining": 0}
            status, data = self._request("GET", "/api/anilist/auth/state")

        self.assertEqual(status, 200)
        self.assertFalse(data["authenticated"])
        self.assertTrue(data["needsReauth"])
        # Token must never appear in response
        serialized = json.dumps(data)
        self.assertNotIn("test-token", serialized)

    def test_auth_state_route_with_valid_token(self):
        expiry_info = {"present": True, "expired": False, "daysRemaining": 364}
        with patch("animu.web.anilist_auth") as mock_auth_mod:
            mock_auth_mod.is_token_present.return_value = True
            mock_auth_mod.needs_reauth.return_value = False
            mock_auth_mod.get_user_name.return_value = "testuser"
            mock_auth_mod.get_expiry_info.return_value = expiry_info
            status, data = self._request("GET", "/api/anilist/auth/state")

        self.assertEqual(status, 200)
        self.assertTrue(data["authenticated"])
        self.assertFalse(data["needsReauth"])
        self.assertEqual(data["tokenExpiry"]["daysRemaining"], 364)

    def test_auth_callback_route_success(self):
        fake_jwt = make_jwt()
        expiry_info = {"present": True, "expired": False, "daysRemaining": 364}
        with patch("animu.web.anilist_auth") as mock_auth_mod:
            mock_auth_mod.exchange_code_for_token.return_value = (fake_jwt, None)
            mock_auth_mod.get_user_name.return_value = "testuser"
            mock_auth_mod.get_expiry_info.return_value = expiry_info
            status, data = self._request("POST", "/api/anilist/auth/callback",
                                        body={"code": "auth-code-123"})

        self.assertEqual(status, 200)
        self.assertTrue(data["ok"])
        self.assertTrue(data["authenticated"])
        # Token value must NOT be in the response
        serialized = json.dumps(data)
        self.assertNotIn(fake_jwt, serialized)

    def test_auth_url_route_with_grant_param(self):
        """The grant query param should be passed through to build_authorization_url."""
        with patch("animu.web.anilist_auth") as mock_auth:
            mock_auth.build_authorization_url.return_value = "https://anilist.co/authorize?response_type=token"
            status, data = self._request("GET", "/api/anilist/auth/url?grant=token")
        self.assertEqual(status, 200)
        self.assertIn("grantType", data)
        self.assertEqual(data["grantType"], "token")
        mock_auth.build_authorization_url.assert_called_once()
        self.assertEqual(mock_auth.build_authorization_url.call_args.kwargs["response_type"], "token")

    def test_auth_url_route_invalid_grant(self):
        """An invalid grant param should return 400."""
        status, data = self._request("GET", "/api/anilist/auth/url?grant=invalid")
        self.assertEqual(status, 400)
        self.assertIn("grant", data["error"].lower())

    def test_auth_url_route_with_redirect_override(self):
        """A redirect_uri param should be forwarded to build_authorization_url."""
        with patch("animu.web.anilist_auth") as mock_auth:
            mock_auth.build_authorization_url.return_value = "https://anilist.co/authorize"
            status, data = self._request("GET", "/api/anilist/auth/url?redirect_uri=http%3A//example.com")
        self.assertEqual(status, 200)
        self.assertEqual(mock_auth.build_authorization_url.call_args.kwargs["redirect_uri"], "http://example.com")

    def test_auth_callback_route_no_token_returned(self):
        """If exchange succeeds but returns empty token, should get 401."""
        with patch("animu.web.anilist_auth") as mock_auth_mod:
            mock_auth_mod.exchange_code_for_token.return_value = (None, None)
            status, data = self._request("POST", "/api/anilist/auth/callback",
                                        body={"code": "some-code"})
        self.assertEqual(status, 401)
        self.assertFalse(data["ok"])
        self.assertIn("error", data)

    def test_auth_callback_route_token_persisted(self):
        """On successful callback, store_token must be called."""
        fake_jwt = make_jwt()
        with patch("animu.web.anilist_auth") as mock_auth_mod:
            mock_auth_mod.exchange_code_for_token.return_value = (fake_jwt, None)
            mock_auth_mod.get_user_name.return_value = "testuser"
            mock_auth_mod.get_expiry_info.return_value = {"present": True, "expired": False, "daysRemaining": 364}
            status, data = self._request("POST", "/api/anilist/auth/callback",
                                        body={"code": "auth-code-123"})
        self.assertEqual(status, 200)
        mock_auth_mod.store_token.assert_called_once_with(fake_jwt)

    def test_auth_clear_route_calls_clear_token(self):
        """The clear route must call clear_token on the auth module."""
        with patch("animu.web.anilist_auth") as mock_auth_mod:
            status, data = self._request("POST", "/api/anilist/auth/clear")
        self.assertEqual(status, 200)
        mock_auth_mod.clear_token.assert_called_once()
        self.assertFalse(data["authenticated"])

    def test_auth_callback_route_exchange_failure(self):
        with patch("animu.web.anilist_auth") as mock_auth_mod:
            mock_auth_mod.exchange_code_for_token.return_value = (None, "AniList OAuth credentials are not configured")
            status, data = self._request("POST", "/api/anilist/auth/callback",
                                        body={"code": "bad-code"})

        self.assertEqual(status, 401)
        self.assertFalse(data["ok"])
        # Error message should not contain token
        self.assertNotIn("access_token", data["error"])

    def test_auth_clear_route(self):
        with patch("animu.web.anilist_auth") as mock_auth_mod:
            status, data = self._request("POST", "/api/anilist/auth/clear")

        self.assertEqual(status, 200)
        self.assertTrue(data["ok"])
        self.assertFalse(data["authenticated"])
        mock_auth_mod.clear_token.assert_called_once()

    def test_config_route_never_exposes_token(self):
        """The /api/config response must never contain the bearer token."""
        from animu.config import ProfileConfig, MAP_ATTR_TO_JSON

        fake_token = "SUPER-SECRET-TOKEN-12345"
        cfg = ProfileConfig(
            bearer_token_anilist=fake_token,
            anilist_token_issued_at=1234567890,
            anilist_client_id="client-id",
            anilist_client_secret="secret-val",
            ani_user_name="testuser",
        )

        with patch("animu.web.get_config", return_value=cfg):
            status, data = self._request("GET", "/api/config")

        self.assertEqual(status, 200)
        serialized = json.dumps(data)
        self.assertNotIn(fake_token, serialized)
        # Token-level sensitive fields must be absent
        self.assertNotIn("bearerTokenAnilist", serialized)
        self.assertNotIn("anilistTokenIssuedAt", serialized)
        self.assertNotIn("anilistClientSecret", serialized)
        self.assertNotIn(str(1234567890), serialized)


# ---------------------------------------------------------------------------
# Auth flow URL composition tests
# ---------------------------------------------------------------------------


class TestAuthFlowUrls(unittest.TestCase):
    """Verify the generated auth URLs match AniList's documented format."""

    @patch("animu.anilist_auth.get_config")
    def test_auth_url_format(self, mock_cfg):
        mock_cfg.return_value = make_test_config(
            client_id="my-animu-app",
            redirect_uri="http://localhost:3210/api/anilist/auth/callback",
        )
        mgr = AniListAuth()
        url = mgr.build_authorization_url(response_type="code")
        parsed = urllib.parse.urlparse(url)
        q = urllib.parse.parse_qs(parsed.query)

        self.assertEqual(parsed.scheme, "https")
        self.assertEqual(parsed.netloc, "anilist.co")
        self.assertEqual(parsed.path, "/api/v2/oauth/authorize")
        self.assertEqual(q["client_id"][0], "my-animu-app")
        self.assertEqual(q["response_type"][0], "code")
        self.assertEqual(q["redirect_uri"][0], "http://localhost:3210/api/anilist/auth/callback")

    @patch("animu.anilist_auth.get_config")
    def test_pin_url_format(self, mock_cfg):
        mock_cfg.return_value = make_test_config(client_id="my-animu-app")
        mgr = AniListAuth()
        url = mgr.build_pin_url()
        parsed = urllib.parse.urlparse(url)
        q = urllib.parse.parse_qs(parsed.query)

        self.assertEqual(q["redirect_uri"][0], ANILIST_PIN_REDIRECT)
        self.assertEqual(q["response_type"][0], "code")
        self.assertEqual(q["client_id"][0], "my-animu-app")


if __name__ == "__main__":
    unittest.main()
