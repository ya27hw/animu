"""
AniList OAuth2 authentication and shared GraphQL execution.

Handles:
  - Authorization Code Grant (server-side), Implicit Grant (SPA), and PIN fallback.
  - Token persistence in profile.json (gitignored — never committed).
  - 1-year token expiry tracking via JWT ``exp`` claim + issuance timestamp.
  - Re-authentication UX helpers.
  - Shared ``execute_graphql`` primitive used by all AniList operations.

Security:
  - The bearer token is NEVER logged or included in error messages.
  - Token fields are stripped from any response that leaves the server
    (``execute_graphql`` returns only AniList API payloads, never internal
    state).
  - ``execute_graphql`` fails closed when ``require_auth=True`` — it never
    retries an authenticated request without the bearer token.

References:
  - Auth flows: https://docs.anilist.co/guide/auth
  - Rate limiting: https://docs.anilist.co/guide/rate-limiting
"""

import base64
import httpx
import json
import time
import urllib.parse
from typing import Any, Dict, Optional, Tuple

from .config import get_config, save_config, reload_config

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

ANILIST_API = "https://graphql.anilist.co"
ANILIST_AUTH_URL = "https://anilist.co/api/v2/oauth/authorize"
ANILIST_TOKEN_URL = "https://anilist.co/api/v2/oauth/token"
ANILIST_PIN_REDIRECT = "https://anilist.co/api/v2/oauth/pin"

# AniList tokens are valid for exactly 1 year. We add a safety margin so the
# re-auth UX can trigger before hard expiry.
TOKEN_LIFETIME_SECONDS = 365 * 24 * 3600  # 1 year
TOKEN_SAFETY_MARGIN = 7 * 24 * 3600       # 7 days

# Fields that must NEVER appear in API responses or logs.
# ``webhook`` (Discord webhook URL) is a credential — it must not be sent
# back to the UI; the Settings page shows it masked and the /api/config
# endpoint strips it like the other secrets.
SENSITIVE_CONFIG_FIELDS = {
    "bearer_token_anilist",
    "anilist_client_secret",
    "anilist_token_issued_at",
    "webhook",
    "password",
    "email_password",
    "token",
    "proxy_password",
}

# ---------------------------------------------------------------------------
# JWT helpers (stdlib — no PyJWT dependency needed for read-only decode)
# ---------------------------------------------------------------------------


def _decode_jwt_payload(token: str) -> Optional[dict]:
    """Decode a JWT payload without verification (we only need ``exp``).

    JWTs are ``header.payload.signature`` base64url-encoded.  We only extract
    the payload claims; we never expose the token itself via this function.
    """
    if not token or not isinstance(token, str):
        return None
    parts = token.split(".")
    if len(parts) < 2:
        return None
    try:
        # Add padding for base64url decode
        payload_b64 = parts[1]
        padded = payload_b64 + "=" * (-len(payload_b64) % 4)
        raw = base64.urlsafe_b64decode(padded)
        return json.loads(raw)
    except Exception:
        return None


# ---------------------------------------------------------------------------
# Auth manager
# ---------------------------------------------------------------------------


class AniListAuth:
    """Manages the AniList OAuth2 lifecycle.

    The token (JWT) is stored in ``profile.json`` under ``bearerTokenAnilist``
    which is already gitignored.  This class never logs the token value.
    """

    def __init__(self):
        self.client = httpx.Client(verify=False, timeout=15)

    # -- Public introspection ------------------------------------------------

    def get_token(self) -> Optional[str]:
        """Return the stored bearer token, or ``None`` if not configured."""
        return get_config().bearer_token_anilist

    def get_user_name(self) -> Optional[str]:
        """Return the AniList user name from config."""
        return get_config().ani_user_name

    def is_token_present(self) -> bool:
        """True if any token is stored (regardless of expiry)."""
        return bool(self.get_token())

    def needs_reauth(self) -> bool:
        """True if the user must re-authenticate.

        Checks both the JWT ``exp`` claim and the stored issuance timestamp.
        Re-auth is required when:
          - No token is stored
          - The JWT has expired (or is within the safety margin)
          - The issuance timestamp is older than (1 year - margin)
        """
        token = self.get_token()
        if not token:
            return True

        cfg = get_config()

        # 1. Check JWT exp claim (most accurate)
        payload = _decode_jwt_payload(token)
        if payload and "exp" in payload:
            exp = int(payload["exp"])
            if time.time() >= exp - TOKEN_SAFETY_MARGIN:
                return True

        # 2. Fallback: check stored issuance timestamp
        if cfg.anilist_token_issued_at:
            issued_at = cfg.anilist_token_issued_at
            if time.time() >= issued_at + TOKEN_LIFETIME_SECONDS - TOKEN_SAFETY_MARGIN:
                return True

        return False

    def get_expiry_info(self) -> dict:
        """Return non-sensitive expiry metadata for the UI.

        Returns a dict like ``{"present": True, "expired": False, "expiresAt": ...,
        "daysRemaining": 342}``.  **No token value is ever included.**
        """
        token = self.get_token()
        if not token:
            return {"present": False, "expired": True, "daysRemaining": 0}

        now = time.time()

        # Prefer JWT exp
        payload = _decode_jwt_payload(token)
        if payload and "exp" in payload:
            exp = int(payload["exp"])
            days_remaining = max(0, int((exp - now) / 86400))
            return {
                "present": True,
                "expired": now >= exp,
                "expiresAt": exp,
                "daysRemaining": days_remaining,
            }

        # Fallback to issuance timestamp
        cfg = get_config()
        if cfg.anilist_token_issued_at:
            issued_at = cfg.anilist_token_issued_at
            expiry = issued_at + TOKEN_LIFETIME_SECONDS
            days_remaining = max(0, int((expiry - now) / 86400))
            return {
                "present": True,
                "expired": now >= expiry,
                "expiresAt": expiry,
                "daysRemaining": days_remaining,
            }

        # Token present but no expiry info available
        return {"present": True, "expired": False, "daysRemaining": -1}

    # -- OAuth2 URL generation ------------------------------------------------

    def build_authorization_url(
        self,
        response_type: str = "code",
        redirect_uri: Optional[str] = None,
        state: Optional[str] = None,
    ) -> str:
        """Build the AniList OAuth2 authorization URL.

        ``response_type``:
          - ``"code"``   → Authorization Code Grant (server-side exchange)
          - ``"token"``  → Implicit Grant (SPA receives token in fragment)
        """
        cfg = get_config()
        client_id = cfg.anilist_client_id
        if not client_id:
            raise ValueError("AniList client ID is not configured")

        params = {
            "client_id": client_id,
            "response_type": response_type,
        }

        uri = redirect_uri or cfg.anilist_redirect_uri
        if uri:
            params["redirect_uri"] = uri

        if state:
            params["state"] = state

        return f"{ANILIST_AUTH_URL}?{urllib.parse.urlencode(params)}"

    def build_pin_url(self, state: Optional[str] = None) -> str:
        """Build the AniList authorization URL using the PIN redirect fallback.

        The PIN flow uses the special redirect ``https://anilist.co/api/v2/oauth/pin``
        so the user can copy a token/PIN manually.  This works with both the
        Authorization Code and Implicit grants.
        """
        cfg = get_config()
        client_id = cfg.anilist_client_id
        if not client_id:
            raise ValueError("AniList client ID is not configured")

        params = {
            "client_id": client_id,
            "redirect_uri": ANILIST_PIN_REDIRECT,
            "response_type": "code",
            "state": state or "",
        }
        return f"{ANILIST_AUTH_URL}?{urllib.parse.urlencode(params)}"

    # -- Token exchange -------------------------------------------------------

    def exchange_code_for_token(
        self,
        code: str,
        redirect_uri: Optional[str] = None,
    ) -> Tuple[Optional[str], Optional[str]]:
        """Exchange an authorization code for a bearer token.

        Returns ``(token, error)``.  On success, ``error`` is ``None``.
        On failure, ``token`` is ``None`` and ``error`` holds a safe message
        (never the token or internal credentials).
        """
        cfg = get_config()
        client_id = cfg.anilist_client_id
        client_secret = cfg.anilist_client_secret
        if not client_id or not client_secret:
            return None, "AniList OAuth credentials are not configured"

        uri = redirect_uri or cfg.anilist_redirect_uri or ANILIST_PIN_REDIRECT
        post_data = {
            "client_id": client_id,
            "client_secret": client_secret,
            "redirect_uri": uri,
            "code": code,
            "grant_type": "authorization_code",
        }

        try:
            resp = self.client.post(ANILIST_TOKEN_URL, data=post_data)
        except Exception as e:
            return None, f"Token request failed: connection error"

        if resp.status_code != 200:
            return None, f"Token request failed with HTTP {resp.status_code}"

        try:
            data = resp.json()
        except Exception:
            return None, "Token request returned invalid JSON"

        token = data.get("access_token")
        if not token:
            return None, "Token response did not contain access_token"

        return token, None

    # -- Token persistence ----------------------------------------------------

    def store_token(self, token: str) -> None:
        """Persist the bearer token and its issuance timestamp to config.

        The token is stored under ``bearer_token_anilist`` (the field that
        ``execute_graphql`` and ``anilist.py`` already read).  The issuance
        timestamp enables 1-year expiry tracking even without JWT decoding.
        """
        cfg = get_config()
        cfg.bearer_token_anilist = token
        cfg.anilist_token_issued_at = int(time.time())
        save_config(cfg)
        reload_config()

    def clear_token(self) -> None:
        """Remove the stored token — forces the next request to re-auth."""
        cfg = get_config()
        cfg.bearer_token_anilist = None
        cfg.anilist_token_issued_at = None
        save_config(cfg)
        reload_config()

    # -- Proxy helper ---------------------------------------------------------

    def _proxy_url(self) -> Optional[str]:
        cfg = get_config()
        if cfg.use_proxy and cfg.proxy_address and cfg.proxy_port:
            proxy_url = f"http://{cfg.proxy_address}:{cfg.proxy_port}"
            if cfg.proxy_username and cfg.proxy_password:
                proxy_url = (
                    f"http://{cfg.proxy_username}:{cfg.proxy_password}"
                    f"@{cfg.proxy_address}:{cfg.proxy_port}"
                )
            return proxy_url
        return None


# Module-level singleton (mirrors the pattern in other animu modules)
auth = AniListAuth()


# ---------------------------------------------------------------------------
# Shared GraphQL execution primitive
# ---------------------------------------------------------------------------


def execute_graphql(
    query: str,
    variables: Optional[Dict[str, Any]] = None,
    require_auth: bool = False,
) -> Optional[Dict[str, Any]]:
    """Execute a GraphQL query/mutation against AniList.

    This is the **single shared primitive** used by all AniList operations
    across the codebase (anilist.py, web.py routes, future modules).

    Behaviour:
      - When ``require_auth=False`` (read queries): if the server returns
        400/401 (expired/invalid token), the bearer header is dropped and
        the request retries once as an anonymous read.  This preserves the
        existing "read fallback" UX from the Discover MVP.
      - When ``require_auth=True`` (mutations): the function **fails closed**.
        It never drops the bearer and never retries without auth.  A missing
        or invalid token produces an ``{"errors": [...]}`` payload.
      - 429 (rate-limited): honours ``Retry-After`` and ``X-RateLimit-Reset``
        headers, sleeps, and retries with bounded attempts.
      - 5xx / 502 / 404: retried with exponential backoff (2s/4s/8s).

    Returns the parsed JSON dict (with ``data`` and/or ``errors`` keys), or
    ``None`` on unrecoverable failure.  The bearer token is never present in
    the returned payload.
    """
    cfg = get_config()
    token = cfg.bearer_token_anilist

    headers = {
        "Accept": "application/json",
        "Content-Type": "application/json",
    }

    if token:
        headers["Authorization"] = f"Bearer {token}"
    elif require_auth:
        # Fail closed — do not proceed without auth for mutations.
        return {
            "errors": [
                {
                    "message": (
                        "AniList access token is not configured. "
                        "Please authenticate via /api/anilist/auth/url."
                    )
                }
            ]
        }

    proxy_url = None
    if cfg.use_proxy and cfg.proxy_address and cfg.proxy_port:
        proxy_url = f"http://{cfg.proxy_address}:{cfg.proxy_port}"
        if cfg.proxy_username and cfg.proxy_password:
            proxy_url = (
                f"http://{cfg.proxy_username}:{cfg.proxy_password}"
                f"@{cfg.proxy_address}:{cfg.proxy_port}"
            )

    max_retries = 3
    retry_delays = [2, 4, 8]
    auth_fallback_tried = False
    max_429_retries = 3

    for attempt in range(max_retries + 1):
        try:
            client_kwargs = {"verify": False, "timeout": 15}
            if proxy_url:
                client_kwargs["proxy"] = proxy_url

            with httpx.Client(**client_kwargs) as client:
                resp = client.post(
                    ANILIST_API,
                    json={"query": query, "variables": variables},
                    headers=dict(headers),
                )

            status = resp.status_code

            # -- 429: rate-limiting with Retry-After / X-RateLimit-Reset ------
            if status == 429:
                retry_after = _parse_retry_after(resp)
                if retry_after > 0 and attempt < max_429_retries:
                    # Sleep for the server-requested window (bounded)
                    sleep_time = min(retry_after, 60)
                    time.sleep(sleep_time)
                    continue
                # Exhausted 429 retries — return the error payload
                try:
                    data = resp.json()
                    if isinstance(data, dict):
                        return data
                except Exception:
                    pass
                return {
                    "errors": [
                        {
                            "message": "AniList rate limit exceeded (429).",
                            "status": 429,
                        }
                    ]
                }

            # -- 400/401: auth fallback (reads only, not mutations) ----------
            if not require_auth and not auth_fallback_tried and token and status in (400, 401):
                # Expired/invalid token for a read query: drop bearer and
                # retry once as an anonymous read.  Mutations (require_auth)
                # never enter this branch — they fail closed.
                headers.pop("Authorization", None)
                auth_fallback_tried = True
                continue

            if status == 200:
                return resp.json()

            # For mutations: any non-200 is a hard failure (fail closed)
            if require_auth:
                try:
                    data = resp.json()
                    if isinstance(data, dict) and "errors" in data:
                        return data
                except Exception:
                    pass
                return {
                    "errors": [
                        {
                            "message": f"AniList API error (status {status}).",
                        }
                    ]
                }

            # -- 5xx / 502 / 404 retry with backoff (reads) ------------------
            is_retryable = status == 502 or status == 404 or status >= 500
            if is_retryable and attempt < max_retries:
                delay = retry_delays[attempt]
                time.sleep(delay)
                continue

            # Non-retryable or exhausted
            try:
                data = resp.json()
                if isinstance(data, dict):
                    return data
            except Exception:
                pass

            if attempt >= max_retries:
                # Safe message — never includes response body or token
                return None

        except Exception:
            # Network/connection error
            if attempt < max_retries:
                delay = retry_delays[attempt]
                time.sleep(delay)
                continue

            if require_auth:
                return {
                    "errors": [
                        {
                            "message": "Connection error while contacting AniList.",
                        }
                    ]
                }
            return None

    return None


def _parse_retry_after(resp: httpx.Response) -> int:
    """Parse ``Retry-After`` header (seconds or HTTP-date) or fall back to
    ``X-RateLimit-Reset``.  Returns seconds to wait, or 0.
    """
    # Retry-After: seconds
    retry_after = resp.headers.get("Retry-After")
    if retry_after:
        try:
            return int(retry_after)
        except (ValueError, TypeError):
            # Could be an HTTP-date — parse it
            try:
                import email.utils as _email_utils
                ts = _email_utils.parsedate_to_datetime(retry_after)
                return max(0, int(ts.timestamp() - time.time()))
            except Exception:
                pass

    # X-RateLimit-Reset: absolute Unix timestamp
    reset = resp.headers.get("X-RateLimit-Reset")
    if reset:
        try:
            reset_ts = int(reset)
            return max(0, reset_ts - int(time.time()))
        except (ValueError, TypeError):
            pass

    return 0
