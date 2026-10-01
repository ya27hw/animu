"""Shared, pooled ``httpx`` clients.

Every outbound call used to build (and tear down) its own ``httpx.Client``:
a new ``SSLContext`` plus a fresh TCP/TLS handshake per AniList query, Nyaa
feed or ``.torrent`` download. A cycle makes dozens of such calls. The helpers
here keep one long-lived client per ``(proxy, timeout)`` so keep-alive
connections are reused. ``httpx.Client`` is thread-safe.

``verify=False`` is deliberate (see CLAUDE.md): the qBittorrent and PocketBase
hosts use self-signed certificates.
"""

import threading
from contextlib import contextmanager
from typing import Dict, Iterator, Optional, Tuple

import httpx

_clients: Dict[Tuple[Optional[str], float], httpx.Client] = {}
_lock = threading.Lock()


def get_client(proxy_url: Optional[str] = None, timeout: float = 20.0) -> httpx.Client:
    """Return the shared client for ``proxy_url`` (``None`` = direct)."""
    key = (proxy_url, float(timeout))
    client = _clients.get(key)
    if client is not None:
        return client
    with _lock:
        client = _clients.get(key)
        if client is None:
            kwargs = {"verify": False, "timeout": httpx.Timeout(timeout, connect=min(timeout, 8.0))}
            if proxy_url:
                kwargs["proxy"] = proxy_url
            client = _clients[key] = httpx.Client(**kwargs)
        return client


@contextmanager
def client_scope(proxy_url: Optional[str] = None, timeout: float = 20.0) -> Iterator[httpx.Client]:
    """``with``-compatible access to a client; shared clients are never closed.

    If ``httpx.Client`` has been replaced by a factory (instrumentation,
    transports), a throwaway client is built from it and closed on exit, as
    the previous ``with httpx.Client(...)`` call sites behaved.
    """
    factory = httpx.Client
    if isinstance(factory, type):
        yield get_client(proxy_url, timeout)
        return
    kwargs = {"verify": False, "timeout": timeout}
    if proxy_url:
        kwargs["proxy"] = proxy_url
    with factory(**kwargs) as client:
        yield client


def close_all() -> None:
    """Close every pooled client (process shutdown / tests)."""
    with _lock:
        clients = list(_clients.values())
        _clients.clear()
    for client in clients:
        try:
            client.close()
        except Exception:
            pass
