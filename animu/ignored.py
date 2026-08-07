import os
import json
import uuid
from datetime import datetime, timezone
from dataclasses import dataclass, asdict
from typing import List, Dict, Any, Optional

ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
LOGS_DIR = os.path.join(ROOT_DIR, "logs")
IGNORED_FILE = os.path.join(LOGS_DIR, "ignored.json")

@dataclass
class IgnoredItem:
    id: str
    title: str
    media_id: Optional[int] = None
    added_at: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

class IgnoredManager:
    def __init__(self):
        self.items: List[Dict[str, Any]] = []
        self._load_ignored()

    def _load_ignored(self):
        os.makedirs(LOGS_DIR, exist_ok=True)
        if os.path.exists(IGNORED_FILE):
            try:
                with open(IGNORED_FILE, "r", encoding="utf-8") as f:
                    self.items = json.load(f)
            except Exception as e:
                print(f"Error reading ignored.json: {e}")
                self.items = []

    def _save_ignored(self):
        os.makedirs(LOGS_DIR, exist_ok=True)
        try:
            with open(IGNORED_FILE, "w", encoding="utf-8") as f:
                json.dump(self.items, f, indent=2)
        except Exception as e:
            print(f"Failed to save ignored.json: {e}")

    def add_entry(self, title: str, media_id: Optional[int] = None) -> Dict[str, Any]:
        clean_title = (title or "").strip()
        parsed_media_id = None
        if media_id is not None:
            try:
                parsed_media_id = int(media_id)
            except (ValueError, TypeError):
                parsed_media_id = None

        # Check if already present
        for item in self.items:
            same_id = parsed_media_id is not None and item.get("media_id") == parsed_media_id
            same_title = clean_title and item.get("title", "").strip().lower() == clean_title.lower()
            if same_id or same_title:
                if parsed_media_id is not None and not item.get("media_id"):
                    item["media_id"] = parsed_media_id
                    self._save_ignored()
                return item

        entry = IgnoredItem(
            id=str(uuid.uuid4()),
            title=clean_title,
            media_id=parsed_media_id,
            added_at=datetime.now(timezone.utc).isoformat()
        ).to_dict()

        self.items.insert(0, entry)
        self._save_ignored()
        return entry

    def get_all(self) -> List[Dict[str, Any]]:
        return list(self.items)

    def delete_entry(self, id_or_title: str) -> bool:
        target = str(id_or_title).strip().lower()
        initial_len = len(self.items)
        
        new_items = []
        for item in self.items:
            item_id = str(item.get("id", "")).lower()
            item_mid = str(item.get("media_id", "")) if item.get("media_id") is not None else ""
            item_title = str(item.get("title", "")).lower()
            
            if target == item_id or (item_mid and target == item_mid) or target == item_title:
                continue
            new_items.append(item)
            
        if len(new_items) < initial_len:
            self.items = new_items
            self._save_ignored()
            return True
        return False

    def is_ignored(self, title: str, media_id: Optional[int] = None, english_title: Optional[str] = None, synonyms: Optional[List[str]] = None) -> bool:
        titles_to_check = [title]
        if english_title:
            titles_to_check.append(english_title)
        if synonyms:
            titles_to_check.extend(synonyms)
            
        clean_titles = [t.strip().lower() for t in titles_to_check if t]

        for item in self.items:
            # Check media_id match
            if media_id is not None and item.get("media_id") is not None:
                if int(item["media_id"]) == int(media_id):
                    return True
                    
            # Check title match
            item_title = (item.get("title") or "").strip().lower()
            if not item_title:
                continue
                
            for ct in clean_titles:
                if item_title == ct or item_title in ct or ct in item_title:
                    return True
        return False

ignored_manager = IgnoredManager()
