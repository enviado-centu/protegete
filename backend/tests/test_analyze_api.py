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
    assert set(body.keys()) == {"url", "level", "score", "category", "reasons", "tip", "ml", "rules", "details"}
    assert set(body["ml"].keys()) == {"probability", "threshold", "flagged", "top_features"}
    assert set(body["details"].keys()) == {"blacklist", "whitelist", "ml_probability", "reputation"}
    for rule in body["rules"]:
        assert set(rule.keys()) == {"id", "weight"}


def test_url_without_scheme_is_accepted(client) -> None:
    response = client.post("/api/analyze", json={"url": "mercad0pago.com.ar"})
    assert response.status_code == 200
    assert response.json()["level"] == "danger"


def test_blacklisted_domain_is_danger(client) -> None:
    # T8 behavior change: "bna-homebanking-verificar.xyz" is a real entry in
    # MODULO-PY/motor/datos/lista_negra_propia.txt, so it's now a direct
    # blacklist hit (level "danger", category "blacklisted", a single rule)
    # instead of the brand_embedded + suspicious_tld + scam_keywords +
    # insecure_http combination it used to produce pre-T8. Still "danger",
    # per this task's required acceptance case.
    response = client.post("/api/analyze", json={"url": "http://bna-homebanking-verificar.xyz/login"})
    assert response.status_code == 200
    body = response.json()
    assert body["level"] == "danger"
    assert body["category"] == "blacklisted"
    assert [r["id"] for r in body["rules"]] == ["blacklisted"]
    assert body["details"]["blacklist"] is True


def test_brand_impersonation_plus_weak_signals_is_danger_with_all_reasons(client) -> None:
    # Same scenario as the pre-T8 test above, on a domain that is NOT a
    # motor blacklist entry, so the brand/tld/keyword/http combination still
    # runs end-to-end through the real model.
    response = client.post("/api/analyze", json={"url": "http://mercadopago-clave.xyz/login"})
    assert response.status_code == 200
    body = response.json()
    assert body["level"] == "danger"
    assert body["category"] == "impersonation"
    reasons_text = " ".join(body["reasons"])
    assert "Mercado Pago" in reasons_text
    assert ".xyz" in reasons_text
    assert "clave" in reasons_text or "login" in reasons_text
    assert "HTTP sin cifrado" in reasons_text


def test_weak_signals_only_is_not_danger(client) -> None:
    # suspicious_tld + insecure_http fire here, and (checked separately with
    # the real model) the ML probability alone is *not* independently past
    # the danger boundary -- without the weak-rules cap, the combo bonus
    # would tip 0.25 (tld) + 0.2 (http) + 0.05 (bonus) + ~0.68 (ml, rescaled)
    # over 0.7. `http://example.xyz/login` is NOT used here: the real model
    # independently flags plain ".xyz" domains at ~0.98 probability, which is
    # legitimate ML-driven danger, not something the weak-rule cap should (or
    # does) suppress.
    response = client.post("/api/analyze", json={"url": "http://sitecheck.top"})
    assert response.status_code == 200
    body = response.json()
    assert body["level"] != "danger"
    rule_ids = {r["id"] for r in body["rules"]}
    assert rule_ids <= {"suspicious_tld", "scam_keywords", "insecure_http"}
    assert rule_ids


def test_bna_whitelisted_path_is_safe_with_no_weak_rules(client) -> None:
    response = client.post("/api/analyze", json={"url": "https://www.bna.com.ar/verificar-identidad"})
    assert response.status_code == 200
    body = response.json()
    assert body["level"] == "safe"
    assert body["rules"] == []


def test_sala_com_ar_still_not_danger_with_weak_rules_added(client) -> None:
    # Regression guard for T4's fix: sala.com.ar must still not be flagged
    # danger/impersonation now that suspicious_tld/scam_keywords also run.
    response = client.post("/api/analyze", json={"url": "sala.com.ar"})
    assert response.status_code == 200
    body = response.json()
    assert body["level"] != "danger"
    assert body["category"] != "impersonation"


def test_details_block_matches_whitelist_and_blacklist_flags(client) -> None:
    whitelisted = client.post("/api/analyze", json={"url": "https://www.bna.com.ar"}).json()
    assert whitelisted["details"] == {
        "blacklist": False,
        "whitelist": True,
        "ml_probability": whitelisted["ml"]["probability"],
        "reputation": "unavailable",
    }

    blacklisted = client.post(
        "/api/analyze", json={"url": "http://bna-homebanking-verificar.xyz/login"}
    ).json()
    assert blacklisted["details"]["blacklist"] is True
    assert blacklisted["details"]["whitelist"] is False


@pytest.mark.parametrize(
    "url",
    [
        "https://futbollibrefullhd.org/",
        "http://futbol-libre.net",
        "https://rojadirecta.me",
        "https://pelotalibre.tv/partido",
    ],
)
def test_pirate_streaming_family_domains_are_danger(client, url) -> None:
    response = client.post("/api/analyze", json={"url": url})
    assert response.status_code == 200
    body = response.json()
    assert body["level"] == "danger"
    assert body["category"] == "risky_site"
    assert body["reasons"]


def test_official_broadcaster_envivo_is_safe(client) -> None:
    response = client.post("/api/analyze", json={"url": "https://www.tycsports.com/envivo"})
    assert response.status_code == 200
    body = response.json()
    assert body["level"] == "safe"


def test_weak_streaming_keywords_are_at_least_caution(client) -> None:
    response = client.post("/api/analyze", json={"url": "https://futbolgratisenvivo.xyz"})
    assert response.status_code == 200
    body = response.json()
    assert body["level"] in ("caution", "danger")


def test_news_site_with_sports_word_is_not_danger(client) -> None:
    response = client.post(
        "/api/analyze", json={"url": "https://www.lanacion.com.ar/deportes/futbol"}
    )
    assert response.status_code == 200
    assert response.json()["level"] != "danger"


def test_single_weak_streaming_keyword_does_not_fire_pirate_rule(client) -> None:
    response = client.post("/api/analyze", json={"url": "https://streaming.example.com"})
    assert response.status_code == 200
    body = response.json()
    assert "pirate_streaming" not in {r["id"] for r in body["rules"]}


def test_no_duplicated_reasons_for_a_brand_and_weak_signals(client) -> None:
    response = client.post("/api/analyze", json={"url": "http://mercadopago-clave.xyz/login"})
    body = response.json()
    assert len(body["reasons"]) == len(set(body["reasons"]))
