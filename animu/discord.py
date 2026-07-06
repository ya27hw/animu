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

def alert_user(anime: str, image: str) -> bool:
    """Send warning notification for anime that failed to download."""
    config = get_config()
    if not config.discord_enable_fail:
        return False
    
    color_str = config.discord_fail_color or "#ff0000"
    color = int(color_str.replace("#", "0x"), 16)
    
    title = config.discord_fail_title or "Anime Not Added"
    
    desc_template = config.discord_fail_description or "Animu could not add {anime} to qBittorrent."
    desc = desc_template.format(anime=anime) if "{anime}" in desc_template else desc_template
    
    return send_embed(title=title, description=desc, color=color, image=image)

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
