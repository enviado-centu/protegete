"""Integration tests for POST /api/analyze against the real trained model.

These are the acceptance-criteria checks from odd/tasks/backend-analyze-api.md.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.main import app


@pytest.fixture
def client():
    with TestClient(app) as c:
        yield c


@pytest.mark.parametrize("url", ["http://mercad0pago.com.ar", "http://mercadopagoseguro.com"])
def test_impersonation_domains_are_danger(client, url) -> None:
    response = client.post("/api/analyze", json={"url": url})
    assert response.status_code == 200
    body = response.json()
    assert body["level"] == "danger"
    assert body["category"] == "impersonation"
    assert body["reasons"]


@pytest.mark.parametrize(
    "url",
    [
        "https://www.mercadopago.com.ar",
        "https://www.bna.com.ar",
        "https://docs.google.com/document",
    ],
)
def test_official_domains_are_safe(client, url) -> None:
    response = client.post("/api/analyze", json={"url": url})
    assert response.status_code == 200
    body = response.json()
    assert body["level"] == "safe"


def test_short_brand_fuzzy_false_positive_is_fixed(client) -> None:
    # Regression: "sala.com.ar" is Levenshtein-1 from "uala" but is not a
    # lookalike; short brands require an exact (post-homoglyph) match.
    response = client.post("/api/analyze", json={"url": "sala.com.ar"})
    assert response.status_code == 200
    body = response.json()
    assert body["level"] != "danger"
    assert body["category"] != "impersonation"


def test_homoglyph_of_short_brand_is_still_danger(client) -> None:
    response = client.post("/api/analyze", json={"url": "ua1a.com.ar"})
    assert response.status_code == 200
    body = response.json()
    assert body["level"] == "danger"
    assert body["category"] == "impersonation"


def test_shortener_is_caution_not_danger(client) -> None:
    response = client.post("/api/analyze", json={"url": "https://bit.ly/x"})
    assert response.status_code == 200
    body = response.json()
    assert body["level"] == "caution"
    assert body["category"] == "hidden_destination"


@pytest.mark.parametrize("payload", [{"url": ""}, {"url": "   "}, {"url": "not a url"}])
def test_invalid_url_is_422(client, payload) -> None:
    response = client.post("/api/analyze", json=payload)
    assert response.status_code == 422


def test_missing_url_field_is_422(client) -> None:
    response = client.post("/api/analyze", json={})
    assert response.status_code == 422


def test_response_shape_matches_contract(client) -> None:
    response = client.post("/api/analyze", json={"url": "http://mercad0pago.com.ar"})
    body = response.json()
    assert set(body.keys()) == {"url", "level", "score", "category", "reasons", "tip", "ml", "rules"}
    assert set(body["ml"].keys()) == {"probability", "threshold", "flagged", "top_features"}
    for rule in body["rules"]:
        assert set(rule.keys()) == {"id", "weight"}


def test_url_without_scheme_is_accepted(client) -> None:
    response = client.post("/api/analyze", json={"url": "mercad0pago.com.ar"})
    assert response.status_code == 200
    assert response.json()["level"] == "danger"
