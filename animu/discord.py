import time
from datetime import datetime, timezone
from typing import List, Dict, Optional
from .config import get_config
from .http import client_scope

# Discord embed limits; over-long fields make the whole webhook call fail (HTTP 400).
_MAX_FIELD_VALUE = 1024
_MAX_FIELD_NAME = 256
_MAX_DESCRIPTION = 4096
_MAX_TITLE = 256


def _clip(text: object, limit: int) -> str:
    value = str(text)
    return value if len(value) <= limit else value[: limit - 1] + "…"

def send_embed(
    title: str,
    description: Optional[str] = None,
    color: int = 0x0997e3,
    image: Optional[str] = None,
    fields: Optional[List[Dict[str, str]]] = None
) -> bool:
    """Send a Discord embed via webhook."""
    config = get_config()
    if not config.webhook:
        return False

    embed = {
        "title": _clip(title, _MAX_TITLE),
        "color": color,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
    if description:
        embed["description"] = _clip(description, _MAX_DESCRIPTION)
    if image:
        embed["image"] = {"url": image}
    if fields:
        embed["fields"] = [{"name": _clip(f["name"], _MAX_FIELD_NAME),
                            "value": _clip(f["value"], _MAX_FIELD_VALUE) or "-",
                            "inline": True} for f in fields]

    payload = {"embeds": [embed]}
    if config.discord_username:
        payload["username"] = config.discord_username
    if config.discord_avatar_url:
        payload["avatar_url"] = config.discord_avatar_url

    try:
        with client_scope(None, 10.0) as client:
            resp = client.post(config.webhook, json=payload)
            if resp.status_code == 429:
                # Discord rate limit: wait the requested time once, then retry.
                try:
                    delay = float(resp.json().get("retry_after", 1.0))
                except Exception:
                    delay = 1.0
                time.sleep(min(max(delay, 0.1), 10.0))
                resp = client.post(config.webhook, json=payload)
        return resp.status_code in (200, 204)
    except Exception as e:
        print(f"Discord webhook error: {e}")
        return False

def alert_user(anime: str, image: str) -> bool:
    """Send warning notification for anime that failed to download."""
    config = get_config()
    if not config.discord_enable_fail:
        return False
    
    color_str = config.discord_fail_color or "#ff0000"
    try:
        color = int(color_str.replace("#", "0x"), 16)
    except ValueError:
        color = 0xff0000

    title = config.discord_fail_title or "Anime Not Added"

    desc_template = config.discord_fail_description or "Animu could not add {anime} to qBittorrent."
    # str.replace, not format(): a user template with stray braces must not raise.
    desc = desc_template.replace("{anime}", anime)
    
    return send_embed(title=title, description=desc, color=color, image=image)


import re


# In-memory history for alert deduplication keyed by media_id
alert_history: Dict[int, Dict[str, str]] = {}


def _normalize_dedup_condition(reason: str, season_info: Optional[str] = None) -> str:
    """Normalize reason and season_info into a stable deduplication key, stripping volatile retry counters."""
    if not reason:
        norm_reason = ""
    else:
        # Strip parenthesized retry/backoff/timeout counters e.g. (Backoff timeout 1/10), (timeout 1/10), (retry 2)
        norm_reason = re.sub(
            r'\s*\(\s*(?:backoff\s+)?(?:timeout|retry|attempt)\s+\d+(?:\s*/\s*\d+)?\s*\)',
            '',
            reason,
            flags=re.IGNORECASE
        )
        # Strip trailing or unparenthesized backoff timeout / retry counters
        norm_reason = re.sub(
            r'[\s\-:]*\b(?:backoff\s+)?(?:timeout|retry|attempt)\s+\d+(?:\s*/\s*\d+)?\b',
            '',
            norm_reason,
            flags=re.IGNORECASE
        ).strip()
    return f"{norm_reason}:{season_info or ''}"


def sanitize_alert_text(text: str) -> str:
    """Ensure no passwords, tokens, or credentials are leaked in alert messages."""
    if not text:
        return ""
    # Redact URLs containing user/pass or tokens
    text = re.sub(r'https?://[^:\s]+:[^@\s]+@', 'https://***@', text)
    text = re.sub(r'(token|password|secret|key|bearer)=[^&\s]+', r'\1=[REDACTED]', text, flags=re.IGNORECASE)
    return text


def alert_unresolved_anime(
    media_id: int,
    anime_title: str,
    image: Optional[str] = None,
    reason: str = "Unresolved search",
    season_info: Optional[str] = None
) -> bool:
    """Send alert for an unresolved anime, deduplicating repeated alerts for the same media_id and condition."""
    config = get_config()
    if not config.discord_enable_fail:
        return False

    current_condition = _normalize_dedup_condition(reason, season_info)
    last_alert = alert_history.get(media_id)
    if last_alert and last_alert.get("condition") == current_condition:
        # Skip duplicate alert for unchanged condition
        return False

    clean_title = sanitize_alert_text(anime_title)
    clean_reason = sanitize_alert_text(reason)
    clean_season = sanitize_alert_text(season_info) if season_info else None

    color_str = config.discord_fail_color or "#ff0000"
    try:
        color = int(color_str.replace("#", "0x"), 16)
    except ValueError:
        color = 0xff0000

    title = f"Search Unresolved: {clean_title}"
    description = f"Animu could not find torrents for **{clean_title}** (Media ID: `{media_id}`). Reason: {clean_reason}"

    fields = [{"name": "Media ID", "value": str(media_id)}]
    if clean_season:
        fields.append({"name": "Season/Format", "value": clean_season})

    sent = send_embed(title=title, description=description, color=color, image=image, fields=fields)
    if sent:
        alert_history[media_id] = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "condition": current_condition
        }
    return sent


def clear_alert_history(media_id: int) -> None:
    """Clear alert history for a media_id when resolved or downloaded."""
    alert_history.pop(media_id, None)



def send_anime_downloaded_hook(title: str, color: int, image: str, *fields: Dict[str, str]) -> bool:
    """Send success notification for anime successfully added to qBittorrent."""
    config = get_config()
    if not config.discord_enable_download:
        return False
    
    # Map color from config if available, otherwise use parsed cover image color
    final_color = color
    if config.discord_download_color:
        try:
            final_color = int(config.discord_download_color.replace("#", "0x"), 16)
        except ValueError:
            pass

    display_title = config.discord_download_title or title
    return send_embed(title=display_title, color=final_color, image=image, fields=list(fields))
