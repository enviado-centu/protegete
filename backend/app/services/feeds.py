"""Lazy loader for the URLhaus malware-URL feed (Feature B).

Mirrors the lazy, module-level-cache idiom used by `motor_adapter._ensure_loaded()`:
the feed file is read at most once, on first use, and cached as two
frozensets (exact URLs and hosts). A missing file is not an error here --
this is on the request path (`rules.py`) and must never crash the app; the
feed is refreshed out-of-band by `app.scripts.update_feeds`.
"""

from __future__ import annotations

from pathlib import Path
from urllib.parse import urlsplit

from app.config import get_urlhaus_feed_path

_urls: frozenset[str] | None = None
_hosts: frozenset[str] | None = None


def _feed_path() -> Path:
    return get_urlhaus_feed_path()


def _strip_port(host: str) -> str:
    return host.rsplit(":", 1)[0] if host.count(":") == 1 else host


def _normalize_url(raw: str) -> str:
    return raw.strip()


def _host_of(raw: str) -> str | None:
    hostname = urlsplit(raw).hostname
    return hostname.lower() if hostname else None


def _ensure_loaded() -> None:
    global _urls, _hosts
    if _urls is not None and _hosts is not None:
        return

    urls: set[str] = set()
    hosts: set[str] = set()
    path = _feed_path()
    if path.exists():
        for line in path.read_text(encoding="utf-8").splitlines():
            stripped = line.strip()
            if not stripped or stripped.startswith("#"):
                continue
            normalized = _normalize_url(stripped)
            urls.add(normalized)
            host = _host_of(normalized)
            if host:
                hosts.add(_strip_port(host))

    _urls = frozenset(urls)
    _hosts = frozenset(hosts)


def is_urlhaus_match(url: str) -> bool:
    """True if `url` (exact match) or its host is present in the URLhaus feed."""
    _ensure_loaded()
    assert _urls is not None
    assert _hosts is not None

    normalized = _normalize_url(url)
    if normalized in _urls:
        return True
    host = _host_of(normalized)
    if host and _strip_port(host) in _hosts:
        return True
    return False


def reload() -> None:
    """Clears the cache, forcing a fresh read of the feed file on next use."""
    global _urls, _hosts
    _urls = None
    _hosts = None


def feed_stats() -> tuple[int, int]:
    """Returns (n_urls, n_hosts) currently loaded (loads first, if needed)."""
    _ensure_loaded()
    assert _urls is not None
    assert _hosts is not None
    return len(_urls), len(_hosts)
