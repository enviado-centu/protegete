"""Tests for app.services.reputation (optional Google Safe Browsing v4 Lookup).

Enabled only when GOOGLE_SAFE_BROWSING_API_KEY is set. Any error/timeout/
missing key degrades to "unavailable" and must never raise -- reputation
lookups are additive, never load-bearing for /api/analyze.
"""

from __future__ import annotations

import httpx
import pytest

from app.services import reputation


@pytest.fixture(autouse=True)
def _clear_cache():
    reputation.clear_cache()
    yield
    reputation.clear_cache()


def _client(handler):
    return httpx.Client(transport=httpx.MockTransport(handler))


def test_no_api_key_returns_unavailable_and_makes_no_network_call(monkeypatch) -> None:
    monkeypatch.delenv("GOOGLE_SAFE_BROWSING_API_KEY", raising=False)
    calls: list[object] = []

    def handler(request):
        calls.append(request)
        return httpx.Response(200, json={})

    result = reputation.lookup("https://example.com", client=_client(handler))
    assert result == "unavailable"
    assert calls == []


def test_match_returns_flagged(monkeypatch) -> None:
    monkeypatch.setenv("GOOGLE_SAFE_BROWSING_API_KEY", "test-key")
    client = _client(lambda req: httpx.Response(200, json={"matches": [{"threatType": "SOCIAL_ENGINEERING"}]}))
    assert reputation.lookup("https://evil.example", client=client) == "flagged"


def test_no_match_returns_clean(monkeypatch) -> None:
    monkeypatch.setenv("GOOGLE_SAFE_BROWSING_API_KEY", "test-key")
    client = _client(lambda req: httpx.Response(200, json={}))
    assert reputation.lookup("https://example.com", client=client) == "clean"


def test_server_error_returns_unavailable(monkeypatch) -> None:
    monkeypatch.setenv("GOOGLE_SAFE_BROWSING_API_KEY", "test-key")
    client = _client(lambda req: httpx.Response(500))
    assert reputation.lookup("https://example.com", client=client) == "unavailable"


def test_timeout_returns_unavailable(monkeypatch) -> None:
    monkeypatch.setenv("GOOGLE_SAFE_BROWSING_API_KEY", "test-key")

    def handler(request):
        raise httpx.ReadTimeout("slow")

    client = _client(handler)
    assert reputation.lookup("https://example.com", client=client) == "unavailable"


def test_malformed_json_returns_unavailable(monkeypatch) -> None:
    monkeypatch.setenv("GOOGLE_SAFE_BROWSING_API_KEY", "test-key")
    client = _client(lambda req: httpx.Response(200, text="not json"))
    assert reputation.lookup("https://example.com", client=client) == "unavailable"


def test_cache_hit_avoids_a_second_network_call(monkeypatch) -> None:
    monkeypatch.setenv("GOOGLE_SAFE_BROWSING_API_KEY", "test-key")
    calls: list[object] = []

    def handler(request):
        calls.append(request)
        return httpx.Response(200, json={"matches": [{"threatType": "MALWARE"}]})

    url = "https://evil.example/cached"
    first = reputation.lookup(url, client=_client(handler))
    second = reputation.lookup(url, client=_client(handler))
    assert first == "flagged"
    assert second == "flagged"
    assert len(calls) == 1
