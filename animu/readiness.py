"""Thread-safe, safe-to-expose runtime readiness state for the Animu service."""
from __future__ import annotations

import threading
from datetime import datetime, timezone
from typing import Any

# Sensible bounds and defaults for scheduler heartbeat stale threshold
MIN_STALE_THRESHOLD_SECONDS: float = 60.0
MAX_STALE_THRESHOLD_SECONDS: float = 86400.0
DEFAULT_STALE_MULTIPLIER: float = 2.0
DEFAULT_CYCLE_INTERVAL_MINUTES: int = 30

_lock = threading.Lock()
_initialized = False
_scheduler_initialized = False
_scheduler_running = False
_database_authenticated = False
_offline_safe_mode = False
_database_status = "not_checked"
_last_cycle_started_at: datetime | None = None
_last_cycle_completed_at: datetime | None = None
_last_success_at: datetime | None = None
_last_heartbeat_at: datetime | None = None
_last_error_type: str | None = None
_stale_threshold: float | None = None


def derive_cycle_interval_seconds(now: datetime | None = None) -> float:
    """Derive the scheduler cycle interval in seconds from configuration and time of day."""
    try:
        from .config import get_config
        config = get_config()
        current_dt = now or datetime.now().astimezone()
        hour = current_dt.hour
        is_peak = (hour >= 12 or hour <= 4)
        interval = config.interval if is_peak else config.offpeak_interval
        interval = interval or DEFAULT_CYCLE_INTERVAL_MINUTES
    except Exception:
        interval = DEFAULT_CYCLE_INTERVAL_MINUTES

    if not isinstance(interval, (int, float)) or interval <= 0:
        interval = DEFAULT_CYCLE_INTERVAL_MINUTES

    return float(interval) * 60.0


def compute_stale_threshold(
    cycle_interval_seconds: float | None = None,
    *,
    multiplier: float = DEFAULT_STALE_MULTIPLIER,
    min_bounds: float = MIN_STALE_THRESHOLD_SECONDS,
    max_bounds: float = MAX_STALE_THRESHOLD_SECONDS,
) -> float:
    """Compute a sensible staleness threshold based on cycle interval with bounds."""
    if cycle_interval_seconds is None:
        cycle_interval_seconds = derive_cycle_interval_seconds()

    interval = max(1.0, float(cycle_interval_seconds))
    mult = max(1.0, float(multiplier))
    calculated = interval * mult
    return max(min_bounds, min(max_bounds, round(calculated, 1)))


def get_stale_threshold(now: datetime | None = None) -> float:
    """Return the active staleness threshold, deriving from cycle interval if not explicitly set."""
    with _lock:
        if _stale_threshold is not None:
            return _stale_threshold
    return compute_stale_threshold(derive_cycle_interval_seconds(now=now))


def set_stale_threshold(seconds: float | None) -> None:
    """Explicitly set a custom staleness threshold in seconds, or None to revert to derived."""
    global _stale_threshold, SCHEDULER_HEARTBEAT_STALE_SECONDS
    with _lock:
        _stale_threshold = float(seconds) if seconds is not None else None
        SCHEDULER_HEARTBEAT_STALE_SECONDS = _stale_threshold if _stale_threshold is not None else compute_stale_threshold()


def reconcile_threshold(cycle_interval_seconds: float | None = None) -> float:
    """Explicitly reconcile and update the staleness threshold with the scheduler cycle interval."""
    global _stale_threshold, SCHEDULER_HEARTBEAT_STALE_SECONDS
    threshold = compute_stale_threshold(cycle_interval_seconds)
    with _lock:
        _stale_threshold = threshold
        SCHEDULER_HEARTBEAT_STALE_SECONDS = threshold
    return threshold


SCHEDULER_HEARTBEAT_STALE_SECONDS: float = compute_stale_threshold()


def _utc(at: datetime | None = None) -> datetime:
    value = at or datetime.now(timezone.utc)
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def _iso(value: datetime | None) -> str | None:
    return value.isoformat() if value else None


def reset() -> None:
    global _initialized, _scheduler_initialized, _scheduler_running
    global _database_authenticated, _offline_safe_mode, _database_status
    global _last_cycle_started_at, _last_cycle_completed_at, _last_success_at
    global _last_heartbeat_at, _last_error_type, _stale_threshold
    global SCHEDULER_HEARTBEAT_STALE_SECONDS
    with _lock:
        _initialized = False
        _scheduler_initialized = False
        _scheduler_running = False
        _database_authenticated = False
        _offline_safe_mode = False
        _database_status = "not_checked"
        _last_cycle_started_at = None
        _last_cycle_completed_at = None
        _last_success_at = None
        _last_heartbeat_at = None
        _last_error_type = None
        _stale_threshold = None
        SCHEDULER_HEARTBEAT_STALE_SECONDS = compute_stale_threshold()


def mark_database(*, authenticated: bool, offline_safe_mode: bool, status: str | None = None) -> None:
    global _initialized, _database_authenticated, _offline_safe_mode, _database_status
    with _lock:
        _database_authenticated = bool(authenticated)
        _offline_safe_mode = bool(offline_safe_mode)
        _database_status = status or ("authenticated" if authenticated else "offline_safe_mode" if offline_safe_mode else "unavailable")
        _initialized = _database_authenticated or _offline_safe_mode


def mark_scheduler_initialized() -> None:
    global _scheduler_initialized, _initialized, _last_heartbeat_at
    with _lock:
        _scheduler_initialized = True
        _last_heartbeat_at = _utc()
        _initialized = _initialized and _scheduler_initialized


def mark_scheduler_running(running: bool = True) -> None:
    global _scheduler_running
    with _lock:
        _scheduler_running = bool(running)


def mark_cycle_started(at: datetime | None = None) -> datetime:
    global _last_cycle_started_at, _last_heartbeat_at
    value = _utc(at)
    with _lock:
        _last_cycle_started_at = value
        _last_heartbeat_at = value
    return value


def mark_cycle_completed(*, success: bool, error: BaseException | None = None, at: datetime | None = None) -> datetime:
    global _last_cycle_completed_at, _last_success_at, _last_heartbeat_at, _last_error_type
    value = _utc(at)
    with _lock:
        _last_cycle_completed_at = value
        _last_heartbeat_at = value
        if success:
            _last_success_at = value
            _last_error_type = None
        else:
            _last_error_type = type(error).__name__ if error else "RuntimeError"
    return value


def health_snapshot(*, now: datetime | None = None) -> dict[str, Any]:
    current = _utc(now)
    threshold = get_stale_threshold(now=current)
    with _lock:
        heartbeat_age = None
        if _last_heartbeat_at:
            heartbeat_age = max(0.0, round((current - _last_heartbeat_at).total_seconds(), 1))
        success_age = None
        if _last_success_at:
            success_age = max(0.0, round((current - _last_success_at).total_seconds(), 1))
        heartbeat_fresh = success_age is not None and success_age <= threshold
        ready = bool(
            _initialized
            and _scheduler_initialized
            and _scheduler_running
            and (_database_authenticated or _offline_safe_mode)
            and heartbeat_fresh
            and _last_error_type is None
        )
        return {
            "ok": ready,
            "live": True,
            "ready": ready,
            "initialized": _initialized,
            "scheduler_initialized": _scheduler_initialized,
            "scheduler_running": _scheduler_running,
            "last_cycle_started_at": _iso(_last_cycle_started_at),
            "last_cycle_completed_at": _iso(_last_cycle_completed_at),
            "last_success_at": _iso(_last_success_at),
            "heartbeat_age_seconds": heartbeat_age,
            "last_success_age_seconds": success_age,
            "heartbeat_stale_threshold_seconds": threshold,
            "last_error_type": _last_error_type,
            "dependency": {
                "pocketbase": {
                    "authenticated": _database_authenticated,
                    "offline_safe_mode": _offline_safe_mode,
                    "status": _database_status,
                }
            },
        }


def __getattr__(name: str) -> Any:
    if name == "SCHEDULER_HEARTBEAT_STALE_SECONDS":
        return get_stale_threshold()
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
