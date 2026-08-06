"""Thread-safe, safe-to-expose runtime readiness state for the Animu service."""
from __future__ import annotations

import threading
from datetime import datetime, timezone
from typing import Any

SCHEDULER_HEARTBEAT_STALE_SECONDS = 300

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


def _utc(at: datetime | None = None) -> datetime:
    value = at or datetime.now(timezone.utc)
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def _iso(value: datetime | None) -> str | None:
    return value.isoformat() if value else None


def reset() -> None:
    global _initialized, _scheduler_initialized, _scheduler_running
    global _database_authenticated, _offline_safe_mode, _database_status
    global _last_cycle_started_at, _last_cycle_completed_at, _last_success_at
    global _last_heartbeat_at, _last_error_type
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
    with _lock:
        heartbeat_age = None
        if _last_heartbeat_at:
            heartbeat_age = max(0.0, round((current - _last_heartbeat_at).total_seconds(), 1))
        success_age = None
        if _last_success_at:
            success_age = max(0.0, round((current - _last_success_at).total_seconds(), 1))
        heartbeat_fresh = success_age is not None and success_age <= SCHEDULER_HEARTBEAT_STALE_SECONDS
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
            "heartbeat_stale_threshold_seconds": SCHEDULER_HEARTBEAT_STALE_SECONDS,
            "last_error_type": _last_error_type,
            "dependency": {
                "pocketbase": {
                    "authenticated": _database_authenticated,
                    "offline_safe_mode": _offline_safe_mode,
                    "status": _database_status,
                }
            },
        }
