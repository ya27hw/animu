"""Crash-safe JSON persistence helpers shared by the local state files.

Every writer used to truncate-and-rewrite its file in place with
``indent=2``: a crash mid-write corrupted ``offline_db.json`` (the fallback
used while PocketBase is down) and concurrent scheduler/web writers raced on
the unlocked history/ignored/prefs files.  ``atomic_write_json`` writes a
temporary sibling and ``os.replace``s it, so readers only ever see a complete
file, and ``path_lock`` gives each path one process-wide lock.
"""

import json
import os
import threading
from typing import Any, Dict

_locks: Dict[str, threading.RLock] = {}
_locks_guard = threading.Lock()


def path_lock(path: str) -> threading.RLock:
    """Return the process-wide re-entrant lock guarding writes to ``path``."""
    key = os.path.abspath(path)
    with _locks_guard:
        lock = _locks.get(key)
        if lock is None:
            lock = _locks[key] = threading.RLock()
        return lock


def atomic_write_json(path: str, obj: Any, *, indent: int | None = None) -> None:
    """Serialise ``obj`` to ``path`` atomically (temp file + ``os.replace``).

    Raises on failure so callers can decide whether to log or propagate; the
    temp file is always cleaned up.  Compact separators are used unless an
    ``indent`` is requested.
    """
    directory = os.path.dirname(os.path.abspath(path))
    os.makedirs(directory, exist_ok=True)
    tmp_path = f"{path}.tmp.{os.getpid()}.{threading.get_ident()}"
    try:
        with path_lock(path):
            with open(tmp_path, "w", encoding="utf-8") as handle:
                if indent is None:
                    json.dump(obj, handle, separators=(",", ":"))
                else:
                    json.dump(obj, handle, indent=indent)
            os.replace(tmp_path, path)
    finally:
        if os.path.exists(tmp_path):
            try:
                os.remove(tmp_path)
            except OSError:
                pass
