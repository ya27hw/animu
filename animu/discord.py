import httpx
from datetime import datetime, timezone
from typing import List, Dict, Optional
from .config import get_config

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
        "title": title,
        "color": color,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
    if description:
        embed["description"] = description
    if image:
        embed["image"] = {"url": image}
    if fields:
        embed["fields"] = [{"name": f["name"], "value": f["value"], "inline": True} for f in fields]

    payload = {"embeds": [embed]}
    if config.discord_username:
        payload["username"] = config.discord_username
    if config.discord_avatar_url:
        payload["avatar_url"] = config.discord_avatar_url

    try:
        resp = httpx.post(config.webhook, json=payload, timeout=10)
        return resp.status_code in (200, 204)
    except Exception as e:
        print(f"Discord webhook error: {e}")
        return False

# In-memory history for alert deduplication keyed by media_id
alert_history: Dict[int, Dict[str, str]] = {}


def sanitize_alert_text(text: str) -> str:
    """Ensure no passwords, tokens, or credentials are leaked in alert messages."""
    import re
    if not text:
        return ""
    # Redact URLs containing user/pass or tokens
    text = re.sub(r'https?://[^:\s]+:[^@\s]+@', 'https://[REDACTED]@', text)
    text = re.sub(r'(token|password|secret|key|bearer)=[^&\s]+', r'\1=[REDACTED]', text, flags=re.IGNORECASE)
    return text


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
    desc = desc_template.format(anime=anime) if "{anime}" in desc_template else desc_template

    return send_embed(title=title, description=sanitize_alert_text(desc), color=color, image=image)


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

    current_condition = f"{reason}:{season_info or ''}"
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
