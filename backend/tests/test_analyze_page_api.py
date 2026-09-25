"""Integration tests for POST /api/analyze-page against the real trained model.

Acceptance-criteria checks (Feature C, backend half): see the task brief for
the exact required scenarios.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.main import app


@pytest.fixture
def client():
    with TestClient(app) as c:
        yield c


def test_cryptominer_is_danger_malicious(client) -> None:
    response = client.post(
        "/api/analyze-page",
        json={"url": "https://example.com", "signals": {"cryptominer": True}},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["level"] == "danger"
    assert body["category"] == "malicious"


def test_malvertising_plus_popups_is_danger(client) -> None:
    response = client.post(
        "/api/analyze-page",
        json={
            "url": "https://example.com",
            "signals": {"malvertising": ["popads.net"], "popups": 2},
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert body["level"] == "danger"
    assert body["score"] > 0.7


def test_notification_prompt_only_is_never_danger(client) -> None:
    response = client.post(
        "/api/analyze-page",
        json={"url": "https://example.com", "signals": {"notification_prompt": True}},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["level"] in ("safe", "caution")


def test_tracker_cookies_only_matches_plain_analyze(client) -> None:
    url = "https://example.com"
    plain = client.post("/api/analyze", json={"url": url}).json()
    page = client.post(
        "/api/analyze-page",
        json={"url": url, "signals": {"tracker_cookies": 10}},
    ).json()

    for key in ("url", "level", "score", "category", "reasons", "tip", "ml", "rules", "details"):
        assert page[key] == plain[key], key
    assert any(s["id"] == "tracker_cookies" for s in page["page_signals"])
    assert page["lessons"] == []


def test_whitelisted_domain_stays_safe(client) -> None:
    response = client.post(
        "/api/analyze-page",
        json={
            "url": "https://www.bna.com.ar",
            "signals": {"third_party_domains": 40, "tracker_cookies": 8},
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert body["level"] == "safe"


def test_insecure_password_form_on_http_is_danger(client) -> None:
    response = client.post(
        "/api/analyze-page",
        json={"url": "http://example.com", "signals": {"insecure_password_form": True}},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["level"] == "danger"


def test_empty_signals_matches_plain_analyze(client) -> None:
    url = "https://example.com"
    plain = client.post("/api/analyze", json={"url": url}).json()
    page = client.post("/api/analyze-page", json={"url": url, "signals": {}}).json()

    for key in ("url", "level", "score", "category", "reasons", "tip", "ml", "rules", "details"):
        assert page[key] == plain[key], key
    assert page["page_signals"] == []
    assert page["lessons"] == []


def test_omitted_signals_defaults_and_matches_plain_analyze(client) -> None:
    url = "https://example.com"
    plain = client.post("/api/analyze", json={"url": url}).json()
    page = client.post("/api/analyze-page", json={"url": url}).json()

    assert page["level"] == plain["level"]
    assert page["score"] == plain["score"]
    assert page["page_signals"] == []
    assert page["lessons"] == []


def test_response_shape_matches_contract(client) -> None:
    response = client.post(
        "/api/analyze-page",
        json={"url": "https://example.com", "signals": {"cryptominer": True}},
    )
    body = response.json()
    assert set(body.keys()) == {
        "url",
        "level",
        "score",
        "category",
        "reasons",
        "tip",
        "ml",
        "rules",
        "details",
        "page_signals",
        "lessons",
    }
    for signal in body["page_signals"]:
        assert set(signal.keys()) == {"id", "reason"}


@pytest.mark.parametrize("payload", [{"url": ""}, {"url": "   "}, {"url": "not a url"}])
def test_invalid_url_is_422(client, payload) -> None:
    response = client.post("/api/analyze-page", json=payload)
    assert response.status_code == 422


def test_missing_url_field_is_422(client) -> None:
    response = client.post("/api/analyze-page", json={"signals": {}})
    assert response.status_code == 422
