"""Per-anime release requirements (audio language / subtitles).

Stored as a local JSON map keyed by AniList media id, following the same
pattern as ``animu/ignored.py``: the file lives under ``logs/`` next to the
other app state, survives restarts, and needs no PocketBase schema change
(which would also require an app restart to be visible).

Shape::

    {
      "184356": {"require_japanese_audio": true, "require_english_subs": true}
    }

An absent entry means "no per-anime requirement" — the global profile flags
still apply.
"""

import json
import os
from typing import Any, Dict, Optional

ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
LOGS_DIR = os.path.join(ROOT_DIR, "logs")
PREFS_FILE = os.path.join(LOGS_DIR, "release_prefs.json")

KNOWN_FLAGS = ("require_japanese_audio", "require_english_subs")


class ReleasePrefsManager:
    def __init__(self, path: Optional[str] = None):
        self.path = path or PREFS_FILE
        self.items: Dict[str, Dict[str, Any]] = {}
        self._load()

    def _load(self) -> None:
        os.makedirs(os.path.dirname(self.path), exist_ok=True)
        if not os.path.exists(self.path):
            return
        try:
            with open(self.path, "r", encoding="utf-8") as handle:
                data = json.load(handle)
            if isinstance(data, dict):
                self.items = {
                    str(k): {f: bool(v.get(f)) for f in KNOWN_FLAGS}
                    for k, v in data.items() if isinstance(v, dict)
                }
        except Exception as exc:
            print(f"Error reading release_prefs.json: {exc}")
            self.items = {}

    def _save(self) -> None:
        os.makedirs(os.path.dirname(self.path), exist_ok=True)
        try:
            with open(self.path, "w", encoding="utf-8") as handle:
                json.dump(self.items, handle, indent=2)
        except Exception as exc:
            print(f"Failed to save release_prefs.json: {exc}")

    def get(self, media_id: Any) -> Dict[str, Any]:
        """Return the stored requirements for a media id (empty dict when none)."""
        if media_id is None:
            return {}
        return dict(self.items.get(str(media_id), {}))

    def is_enrolled(self, media_id: Any) -> bool:
        return bool(self.items.get(str(media_id)))

    def set(
        self,
        media_id: Any,
        require_japanese_audio: Optional[bool] = None,
        require_english_subs: Optional[bool] = None
    ) -> Dict[str, Any]:
        """Set one or both flags for a media id. Unknown/None args are ignored."""
        if media_id is None:
            return {}
        key = str(media_id)
        entry = dict(self.items.get(key, {f: False for f in KNOWN_FLAGS}))
        if require_japanese_audio is not None:
            entry["require_japanese_audio"] = bool(require_japanese_audio)
        if require_english_subs is not None:
            entry["require_english_subs"] = bool(require_english_subs)
        self.items[key] = entry
        self._save()
        return dict(entry)

    def delete(self, media_id: Any) -> bool:
        """Drop an entry entirely. Returns True when something was removed."""
        if self.items.pop(str(media_id), None) is not None:
            self._save()
            return True
        return False

    def get_all(self) -> Dict[str, Dict[str, Any]]:
        return {k: dict(v) for k, v in self.items.items()}


release_prefs = ReleasePrefsManager()


def get_requirements(media_id: Any) -> Dict[str, bool]:
    """Resolve the effective hard requirements for one anime.

    Per-anime flags are OR-ed with the global profile flags, so the owner can
    switch a requirement on for every show from Settings or for a single show
    from its overrides dialog.
    """
    from .config import get_config

    config = get_config()
    prefs = release_prefs.get(media_id)
    return {
        "require_japanese_audio": bool(prefs.get("require_japanese_audio")),
        "require_english_subs": bool(prefs.get("require_english_subs"))
        or bool(getattr(config, "require_english_subs", False)),
    }


def prefers_japanese_dub(media_id: Any) -> bool:
    """True when the soft Japanese-dub preference applies to this anime."""
    from .config import get_config

    config = get_config()
    if bool(getattr(config, "prefer_japanese_dub", False)):
        return True
    return bool(release_prefs.get(media_id).get("require_japanese_audio"))
