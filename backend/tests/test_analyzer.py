"""Unit tests for the ensemble analyzer, using a fake ML model."""

from __future__ import annotations

from app.services.analyzer import analyze


def test_pure_rule_hit_overrides_a_low_ml_score(fake_model) -> None:
    # Simulates the ML model missing a lookalike (probability well below the
    # danger boundary) while the rules engine still catches it.
    fake_model._probability = 0.1
    result = analyze("http://mercad0pago.com.ar", fake_model)
    assert result.level == "danger"
    assert result.category == "impersonation"
    assert any(rule.id == "brand_lookalike" for rule in result.rules)


def test_high_ml_probability_alone_yields_danger(fake_model) -> None:
    fake_model._probability = 0.99
    fake_model._top_features = ["entropia_dominio"]
    result = analyze("https://some-random-domain.example", fake_model)
    assert result.level == "danger"
    assert result.rules == []
    assert "El nombre del dominio parece aleatorio" in result.reasons


def test_low_ml_probability_and_no_rules_is_safe(fake_model) -> None:
    fake_model._probability = 0.05
    result = analyze("https://example.com", fake_model)
    assert result.level == "safe"
    assert result.category == "none"
    assert result.reasons == []


def test_shortener_caps_at_caution_even_with_high_ml_probability(fake_model) -> None:
    fake_model._probability = 0.99
    result = analyze("https://bit.ly/x", fake_model)
    assert result.level == "caution"
    assert result.category == "hidden_destination"
    assert result.score <= 0.7


def test_whitelisted_domain_is_safe_despite_high_ml_probability(fake_model) -> None:
    fake_model._probability = 0.741
    result = analyze("https://docs.google.com/document", fake_model)
    assert result.level == "safe"
    assert result.category == "none"


def test_reasons_are_deduplicated_and_capped(fake_model) -> None:
    fake_model._probability = 0.95
    fake_model._top_features = ["cant_guiones", "cant_guiones", "tld_sospechoso", "cant_digitos", "entropia_dominio"]
    result = analyze("http://x-y-z--123.xyz", fake_model)
    assert len(result.reasons) <= 4
    assert len(result.reasons) == len(set(result.reasons))


def test_ml_reasons_only_included_when_probability_high_enough(fake_model) -> None:
    fake_model._probability = 0.3
    fake_model._top_features = ["entropia_dominio"]
    result = analyze("https://example.com", fake_model)
    assert result.reasons == []


def test_score_is_rounded_to_three_decimals(fake_model) -> None:
    fake_model._probability = 0.123456
    result = analyze("https://example.com", fake_model)
    assert result.score == round(result.score, 3)
