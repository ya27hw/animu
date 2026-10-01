import random
import time
from dataclasses import dataclass, field
from typing import List, Optional, Dict, Any

# Consecutive failures counted (and back-off doublings applied) before capping.
MAX_FAILURES = 10
# Longest wait between attempts for an anime that keeps failing.
MAX_BACKOFF_MINUTES = 8 * 60

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
    # Epoch seconds before which the scheduler skips this anime (0 = due now).
    # Replaces the per-cycle ``timeouts`` countdown, which cost one database
    # write per skipped anime per cycle and conflated cycles with time.
    next_attempt_at: float = 0.0

    def set_timeout_until(self, time_seconds: float, now: Optional[float] = None) -> None:
        """Defer the next attempt by ``time_seconds`` (e.g. until the next episode airs)."""
        self.next_attempt_at = (time.time() if now is None else now) + max(0.0, time_seconds)

    def set_timeout(self, interval_minutes: int = 30, now: Optional[float] = None, jitter: float = 0.1) -> bool:
        """Record a failed search: bump the failure count and schedule a retry.

        The wait doubles with each consecutive failure (one cycle, two, four…)
        up to ``MAX_BACKOFF_MINUTES``, with a little jitter so shows that
        failed together don't all retry in the same minute. ``timeouts`` keeps
        mirroring the failure count for diagnostics. Returns True once the
        failure cap is reached.
        """
        if self.max_timeouts < MAX_FAILURES:
            self.max_timeouts += 1
        self.timeouts = self.max_timeouts
        minutes = min((interval_minutes or 30) * (2 ** (self.max_timeouts - 1)), MAX_BACKOFF_MINUTES)
        if jitter:
            minutes *= 1.0 + random.uniform(-jitter, jitter)
        self.next_attempt_at = (time.time() if now is None else now) + minutes * 60.0
        return self.max_timeouts >= MAX_FAILURES

    def is_due(self, now: Optional[float] = None) -> bool:
        """True when the back-off window (if any) has elapsed."""
        return (time.time() if now is None else now) >= self.next_attempt_at

    def reset_timeout(self) -> None:
        """Clear the failure count and any pending back-off."""
        self.timeouts = 0
        self.max_timeouts = 0
        self.next_attempt_at = 0.0

@dataclass
class NyaaTorrent:
    title: str
    link: str
    pub_date: str
    seeders: int
    size: str
    episode: Optional[float] = None
