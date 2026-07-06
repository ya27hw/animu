import json
import os
import sys

from animu.database import db
from animu.models import OfflineAnime

def migrate():
    """Migrates existing offline-cache.json file content to PocketBase database."""
    root_dir = os.path.dirname(os.path.abspath(__file__))
    cache_path = os.path.join(root_dir, "logs", "offline-cache.json")
    
    if not os.path.exists(cache_path):
        # Also check old root logs folder relative path
        cache_path = "/root/animu/logs/offline-cache.json"
        
    if not os.path.exists(cache_path):
        print(f"No offline-cache.json found at {cache_path}. Skipping cache migration.")
        return

    try:
        with open(cache_path, "r", encoding="utf-8") as f:
            data = json.load(f)
    except Exception as e:
        print(f"Error reading offline-cache.json: {e}")
        return

    print(f"Found {len(data)} cache entries to migrate into PocketBase.")
    
    success_count = 0
    for media_id_str, entry in data.items():
        try:
            media_id = int(media_id_str)
            # Create OfflineAnime model
            offline = OfflineAnime(
                media_id=media_id,
                downloaded_episodes=entry.get("episodes") or [],
                starting_episode=entry.get("starting_episode") or 0,
                timeouts=entry.get("timeouts") or 0,
                alternative_title=entry.get("alternativeTitle") or ""
            )
            # Check if record already exists in PocketBase
            existing = db.get(media_id)
            if existing:
                print(f"Record for {media_id} already exists in PocketBase. Skipping.")
                continue

            db.upsert(media_id, offline)
            print(f"Migrated mediaId {media_id} to PocketBase successfully.")
            success_count += 1
        except Exception as e:
            print(f"Failed to migrate mediaId {media_id_str}: {e}")

    print(f"Migration complete: {success_count} entries migrated.")

if __name__ == "__main__":
    migrate()
