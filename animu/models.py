from dataclasses import dataclass, field
from typing import List, Optional, Dict, Any

@dataclass
class OfflineAnime:
    media_id: int
    downloaded_episodes: List[int] = field(default_factory=list)
    starting_episode: int = 0
    alternative_title: str = ""
    timeouts: int = 0
    max_timeouts: int = 0
    pending_rewatching_update: bool = False
    preferred_release_group: str = ""
    release_group_misses: int = 0

    def set_timeout_until(self, time_seconds: float, interval_minutes: int = 30) -> None:
        """Sets a timeout until the next episode is aired."""
        time_minutes = time_seconds / 60
        self.timeouts = round(time_minutes / (interval_minutes or 30))

    def set_timeout(self) -> bool:
        """Increment timeout counter, cap at 10. Returns True if max timeouts reached."""
        if self.max_timeouts >= 10:
            self.timeouts = self.max_timeouts
            return True
        self.max_timeouts += 1
        self.timeouts = self.max_timeouts
        return self.max_timeouts >= 10

    def reset_timeout(self) -> None:
        """Reset the timeout and max timeout counters."""
        self.timeouts = 0
        self.max_timeouts = 0

@dataclass
class NyaaTorrent:
    title: str
    link: str
    pub_date: str
    seeders: int
    size: str
    episode: Optional[float] = None
