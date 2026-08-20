import json
import os
import re
from dataclasses import dataclass, field, fields, asdict
from typing import Optional, List, Dict, Any

PROFILE_PATH = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'profile.json'))

@dataclass
class ProfileConfig:
    torrent_url: Optional[str] = None
    qbit_url: str = "http://localhost:8080"
    username: str = "admin"
    password: str = "adminadmin"
    email: Optional[str] = None
    email_password: Optional[str] = None
    ani_user_name: Optional[str] = None
    bearer_token_anilist: Optional[str] = None
    # AniList OAuth2 settings (authorization-code flow + implicit/PIN fallback)
    anilist_client_id: Optional[str] = None
    anilist_client_secret: Optional[str] = None
    anilist_redirect_uri: Optional[str] = None
    # Token issuance timestamp (epoch seconds) for 1-year expiry tracking
    anilist_token_issued_at: Optional[int] = None
    id: Optional[int] = None
    resolution: str = "1080"
    root_dir: str = "/storage/media/anime"
    alt_root_dir: str = "/storage/media/homework"
    token: Optional[str] = None
    guild_id: Optional[str] = None
    client_id: Optional[str] = None
    use_proxy: bool = False
    proxy_address: Optional[str] = "10.0.0.90"
    proxy_port: int = 8888
    proxy_username: Optional[str] = None
    proxy_password: Optional[str] = None
    nyaa_url: str = "https://nyaa.si"
    alt_nyaa_url: str = "https://nyaa.si"
    trigger_genre: str = "Ecchi"
    webhook: Optional[str] = None
    interval: int = 30
    offpeak_interval: int = 25
    exclude_release_groups: List[str] = field(default_factory=list)
    set_completed_to_rewatching: bool = True
    air_date_threshold_hours: float = 48.0
    prefer_uncensored: bool = True
    
    # Discord options
    discord_enable_download: bool = True
    discord_enable_fail: bool = True
    discord_download_color: str = "#0997e3"
    discord_fail_color: str = "#ff0000"
    discord_download_title: Optional[str] = None
    discord_fail_title: Optional[str] = None
    discord_fail_description: Optional[str] = None
    discord_username: Optional[str] = None
    discord_avatar_url: Optional[str] = None

    # Storage for fields from JSON that are not explicitly modeled
    _extra_fields: Dict[str, Any] = field(default_factory=dict, init=False, repr=False, compare=False)

cached_config: Optional[ProfileConfig] = None

MAP_JSON_TO_ATTR = {
    "torrent_url": "torrent_url",
    "qbit_url": "qbit_url",
    "username": "username",
    "password": "password",
    "email": "email",
    "emailPassword": "email_password",
    "aniUserName": "ani_user_name",
    "bearerTokenAnilist": "bearer_token_anilist",
    "anilistClientId": "anilist_client_id",
    "anilistClientSecret": "anilist_client_secret",
    "anilistRedirectUri": "anilist_redirect_uri",
    "anilistTokenIssuedAt": "anilist_token_issued_at",
    "id": "id",
    "resolution": "resolution",
    "rootDir": "root_dir",
    "altRootDir": "alt_root_dir",
    "token": "token",
    "guildId": "guild_id",
    "clientId": "client_id",
    "useProxy": "use_proxy",
    "proxyAddress": "proxy_address",
    "proxyPort": "proxy_port",
    "proxyUsername": "proxy_username",
    "proxyPassword": "proxy_password",
    "nyaaUrl": "nyaa_url",
    "altNyaaUrl": "alt_nyaa_url",
    "triggerGenre": "trigger_genre",
    "webhook": "webhook",
    "interval": "interval",
    "offpeakInterval": "offpeak_interval",
    "excludeReleaseGroups": "exclude_release_groups",
    "setCompletedToRewatching": "set_completed_to_rewatching",
    "airDateThresholdHours": "air_date_threshold_hours",
    "preferUncensored": "prefer_uncensored",
    "discordEnableDownload": "discord_enable_download",
    "discordEnableFail": "discord_enable_fail",
    "discordDownloadColor": "discord_download_color",
    "discordFailColor": "discord_fail_color",
    "discordDownloadTitle": "discord_download_title",
    "discordFailTitle": "discord_fail_title",
    "discordFailDescription": "discord_fail_description",
    "discordUsername": "discord_username",
    "discordAvatarUrl": "discord_avatar_url",
}

MAP_ATTR_TO_JSON = {v: k for k, v in MAP_JSON_TO_ATTR.items()}

def get_config() -> ProfileConfig:
    global cached_config
    if cached_config is not None:
        return cached_config

    config_dict = {}
    extra_fields = {}

    if os.path.exists(PROFILE_PATH):
        try:
            with open(PROFILE_PATH, 'r', encoding='utf-8') as f:
                content = f.read().strip()
                # Remove trailing commas
                content = re.sub(r',\s*([\]}])', r'\1', content)
                raw_data = json.loads(content)

                for json_key, val in raw_data.items():
                    if json_key in MAP_JSON_TO_ATTR:
                        attr_key = MAP_JSON_TO_ATTR[json_key]
                        if attr_key in ("id", "proxy_port", "interval", "offpeak_interval") and val is not None:
                            try:
                                val = int(val)
                            except (ValueError, TypeError):
                                pass
                        config_dict[attr_key] = val
                    else:
                        extra_fields[json_key] = val
        except Exception as e:
            print(f"Failed to read profile.json: {e}")

    valid_field_names = {f.name for f in fields(ProfileConfig) if f.name != '_extra_fields'}
    init_args = {k: v for k, v in config_dict.items() if k in valid_field_names}

    cfg = ProfileConfig(**init_args)
    cfg._extra_fields = extra_fields
    cached_config = cfg
    return cached_config

def save_config(cfg: ProfileConfig) -> None:
    global cached_config
    try:
        cfg_dict = asdict(cfg)
        cfg_dict.pop('_extra_fields', None)

        json_data = {}

        # Merge back any extra fields
        if hasattr(cfg, '_extra_fields') and cfg._extra_fields:
            json_data.update(cfg._extra_fields)

        # Map back fields to JSON keys
        for attr_key, val in cfg_dict.items():
            json_key = MAP_ATTR_TO_JSON.get(attr_key, attr_key)
            json_data[json_key] = val

        temp_path = PROFILE_PATH + ".tmp"
        with open(temp_path, 'w', encoding='utf-8') as f:
            json.dump(json_data, f, indent=2)
        os.replace(temp_path, PROFILE_PATH)
        cached_config = cfg
        print("Config updated and saved to profile.json")
    except Exception as e:
        print(f"Failed to save config: {e}")

def reload_config() -> ProfileConfig:
    global cached_config
    cached_config = None
    return get_config()
