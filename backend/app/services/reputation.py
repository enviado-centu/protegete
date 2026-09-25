"""Optional reputation source: Google Safe Browsing v4 Lookup API.

Same source Chrome/Edge (Google Safe Browsing) and, indirectly, Microsoft
SmartScreen use to flag known-malicious sites -- this gives our own engine a
comparable external signal, additive to the deterministic rules engine
(`app.services.rules`).

Disabled entirely (no network call, ever) unless the `GOOGLE_SAFE_BROWSING_API_KEY`
env var is set (see backend/README.md for how to get a key). Any failure --
missing key, network error, timeout, malformed response -- degrades to
"unavailable" and never raises: a reputation lookup must never break
/api/analyze.

Privacy: the looked-up URL is sent to Google (that's the nature of a Safe
Browsing lookup) but is never logged locally, and lookup errors never
include the URL in any exception message we surface.
"""

from __future__ import annotations

import time
from dataclasses import dataclass

import httpx

from app.config import get_google_safe_browsing_api_key, get_safe_browsing_timeout_s

SAFE_BROWSING_URL = "https://safebrowsing.googleapis.com/v4/threatMatches:find"

THREAT_TYPES: tuple[str, ...] = (
    "MALWARE",
    "SOCIAL_ENGINEERING",
    "UNWANTED_SOFTWARE",
    "POTENTIALLY_HARMFUL_APPLICATION",
)
PLATFORM_TYPES: tuple[str, ...] = ("ANY_PLATFORM",)
THREAT_ENTRY_TYPES: tuple[str, ...] = ("URL",)

FLAGGED = "flagged"
CLEAN = "clean"
UNAVAILABLE = "unavailable"

CACHE_TTL_S = 600
CACHE_MAX_ENTRIES = 1000


@dataclass(frozen=True)
class _CacheEntry:
    flagged: bool
    expires_at: float


_cache: dict[str, _CacheEntry] = {}


def clear_cache() -> None:
    """Test helper: clears the in-memory reputation cache."""
    _cache.clear()


def _cache_get(url: str) -> bool | None:
    entry = _cache.get(url)
    if entry is None:
        return None
    if entry.expires_at < time.monotonic():
        del _cache[url]
        return None
    return entry.flagged


def _cache_set(url: str, flagged: bool) -> None:
    if url not in _cache and len(_cache) >= CACHE_MAX_ENTRIES:
        # Bound memory: evict one arbitrary entry rather than grow unbounded.
        oldest_key = next(iter(_cache))
        del _cache[oldest_key]
    _cache[url] = _CacheEntry(flagged=flagged, expires_at=time.monotonic() + CACHE_TTL_S)


def lookup(url: str, *, client: httpx.Client | None = None) -> str:
    """Returns "flagged", "clean", or "unavailable" for `url`.

    Makes NO network call at all when `GOOGLE_SAFE_BROWSING_API_KEY` isn't
    set. A `client` can be injected for tests (`httpx.MockTransport`);
    otherwise a short-lived `httpx.Client` is created per call, timing out
    after `get_safe_browsing_timeout_s()` seconds (default 2s).
    """
    api_key = get_google_safe_browsing_api_key()
    if not api_key:
        return UNAVAILABLE

    cached = _cache_get(url)
    if cached is not None:
        return FLAGGED if cached else CLEAN

    payload = {
        "client": {"clientId": "antiscam-chat", "clientVersion": "1.0.0"},
        "threatInfo": {
            "threatTypes": list(THREAT_TYPES),
            "platformTypes": list(PLATFORM_TYPES),
            "threatEntryTypes": list(THREAT_ENTRY_TYPES),
            "threatEntries": [{"url": url}],
        },
    }

    owns_client = client is None
    http_client = client or httpx.Client(timeout=get_safe_browsing_timeout_s())
    try:
        response = http_client.post(SAFE_BROWSING_URL, params={"key": api_key}, json=payload)
        response.raise_for_status()
        data = response.json()
        flagged = bool(data.get("matches"))
        _cache_set(url, flagged)
        return FLAGGED if flagged else CLEAN
    except (httpx.HTTPError, ValueError, TypeError, KeyError):
        return UNAVAILABLE
    finally:
        if owns_client:
            http_client.close()
