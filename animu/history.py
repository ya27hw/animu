import os
import json
import uuid
import re
from datetime import datetime, timezone
from dataclasses import dataclass, asdict
from typing import List, Dict, Any, Optional

ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
LOGS_DIR = os.path.join(ROOT_DIR, "logs")
HISTORY_FILE = os.path.join(LOGS_DIR, "history.json")
ANIMU_LOG_FILE = os.path.join(LOGS_DIR, "animu.log")

@dataclass
class HistoryItem:
    id: str
    title: str
    link: str
    added_at: str
    anime_title: Optional[str] = None
    episode: Optional[Any] = None
    size: Optional[str] = None
    seeders: Optional[Any] = None
    cover_image: Optional[str] = None
    source: str = "auto"

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

class HistoryManager:
    def __init__(self):
        self.items: List[Dict[str, Any]] = []
        self._load_history()

    def _load_history(self):
        os.makedirs(LOGS_DIR, exist_ok=True)
        if os.path.exists(HISTORY_FILE):
            try:
                with open(HISTORY_FILE, "r", encoding="utf-8") as f:
                    self.items = json.load(f)
                    return
            except Exception as e:
                print(f"Error reading history.json: {e}")
                self.items = []
        
        # If history.json does not exist or is empty, try seeding from animu.log
        self._seed_from_logs()

    def _seed_from_logs(self):
        """Seed history items from animu.log if available."""
        if not os.path.exists(ANIMU_LOG_FILE):
            return

        seeded = []
        try:
            with open(ANIMU_LOG_FILE, "r", encoding="utf-8", errors="ignore") as f:
                for line in f:
                    line_str = line.strip()
                    if not line_str:
                        continue
                    try:
                        data = json.loads(line_str)
                        msg = data.get("message", "")
                        ts = data.get("timestamp", datetime.now(timezone.utc).isoformat())
                        
                        clean_msg = re.sub(r'\x1b\[[0-9;]*m', '', msg).strip()
                        match = re.search(r'Downloading\s+(.+?)(?:\s+(?:Episode:\s*(\d+|\w+)|(\d+)))?\s+at\s+(https?://\S+)', clean_msg)
                        if match:
                            raw_title, ep1, ep2, link = match.groups()
                            ep = ep1 or ep2
                            seeded.append({
                                "id": str(uuid.uuid4()),
                                "title": raw_title.strip(),
                                "link": link.strip(),
                                "added_at": ts,
                                "anime_title": None,
                                "episode": int(ep) if ep and ep.isdigit() else ep,
                                "size": "Unknown",
                                "seeders": "N/A",
                                "cover_image": None,
                                "source": "auto"
                            })
                        elif "Added Torrent:" in clean_msg:
                            torrent_name = clean_msg.replace("Added Torrent:", "").strip()
                            if torrent_name:
                                seeded.append({
                                    "id": str(uuid.uuid4()),
                                    "title": torrent_name,
                                    "link": "#",
                                    "added_at": ts,
                                    "anime_title": None,
                                    "episode": None,
                                    "size": "Unknown",
                                    "seeders": "N/A",
                                    "cover_image": None,
                                    "source": "auto"
                                })
                    except Exception:
                        continue
        except Exception as e:
            print(f"Error seeding history from log: {e}")

        if seeded:
            self.items = seeded
            self._save_history()

    def _save_history(self):
        os.makedirs(LOGS_DIR, exist_ok=True)
        try:
            with open(HISTORY_FILE, "w", encoding="utf-8") as f:
                json.dump(self.items, f, indent=2)
        except Exception as e:
            print(f"Failed to save history: {e}")

    def add_entry(
        self,
        title: str,
        link: str,
        anime_title: Optional[str] = None,
        episode: Optional[Any] = None,
        size: Optional[str] = None,
        seeders: Optional[Any] = None,
        cover_image: Optional[str] = None,
        source: str = "auto"
    ) -> Dict[str, Any]:
        item = HistoryItem(
            id=str(uuid.uuid4()),
            title=title,
            link=link,
            added_at=datetime.now(timezone.utc).isoformat(),
            anime_title=anime_title,
            episode=episode,
            size=size or "Unknown",
            seeders=seeders if seeders is not None else "N/A",
            cover_image=cover_image,
            source=source
        ).to_dict()

        self.items.insert(0, item)
        self._save_history()
        return item

    def get_all(self) -> List[Dict[str, Any]]:
        def parse_ts(item):
            ts = item.get("added_at")
            if not ts:
                return 0.0
            try:
                # Handle space in timestamp format e.g. "2025-09-17 19:24:03 +04:00"
                cleaned = ts.replace(" ", "T", 1) if " " in ts[:11] else ts
                return datetime.fromisoformat(cleaned).timestamp()
            except Exception:
                return 0.0

        return sorted(self.items, key=parse_ts, reverse=True)

    def clear_all(self):
        self.items = []
        self._save_history()

    def delete_entry(self, entry_id: str) -> bool:
        initial_len = len(self.items)
        self.items = [item for item in self.items if item.get("id") != entry_id]
        if len(self.items) < initial_len:
            self._save_history()
            return True
        return False

history_manager = HistoryManager()
