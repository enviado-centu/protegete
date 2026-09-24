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


def test_weak_signals_alone_never_reach_danger(fake_model) -> None:
    # suspicious_tld + scam_keywords + insecure_http all fire here, but with
    # a low ML probability the combined weak signal must stay out of "danger".
    fake_model._probability = 0.05
    result = analyze("http://example.xyz/login", fake_model)
    assert result.level != "danger"
    assert result.score < 0.7


def test_weak_signals_reinforce_a_strong_rule(fake_model) -> None:
    # Combined with brand impersonation, the weak signals should still be
    # allowed to reinforce (not get suppressed by the weak-only cap).
    fake_model._probability = 0.05
    result = analyze("http://bna-homebanking-verificar.xyz/login", fake_model)
    assert result.level == "danger"
    assert result.category == "impersonation"
    rule_ids = {r.id for r in result.rules}
    assert {"brand_embedded", "suspicious_tld", "scam_keywords", "insecure_http"} <= rule_ids


def test_weak_rule_cap_prevents_bonus_from_tipping_near_threshold_ml_into_danger(fake_model) -> None:
    # Without the weak-rules cap: rescaled ml_score = 0.88/0.9*0.7 = 0.6844,
    # base_score = max(0.25, 0.6844), + combo bonus 0.05*(2-1) = 0.05 ->
    # 0.7344, which would round up into "danger". The cap must hold this at
    # "caution" since the ML score itself hasn't independently crossed 0.7.
    fake_model._probability = 0.88
    result = analyze("http://sitecheck.top", fake_model)
    assert result.level != "danger"
    assert result.score == 0.6


def test_independent_high_ml_score_not_suppressed_by_weak_rule_cap(fake_model) -> None:
    # A weak rule firing (suspicious_tld) must not cap a genuinely high,
    # independently-confident ML score.
    fake_model._probability = 0.99
    result = analyze("http://some-random-domain.xyz", fake_model)
    assert result.level == "danger"


class TestMlFlaggedReason:
    def test_reason_present_when_probability_at_or_above_threshold(self, fake_model) -> None:
        fake_model._probability = 0.95  # fake model threshold is fixed at 0.9
        result = analyze("https://some-random-domain.example", fake_model)
        assert (
            "El análisis automático del dominio lo considera muy similar a sitios fraudulentos conocidos."
            in result.reasons
        )

    def test_reason_absent_when_probability_below_threshold(self, fake_model) -> None:
        fake_model._probability = 0.6
        result = analyze("https://some-random-domain.example", fake_model)
        assert (
            "El análisis automático del dominio lo considera muy similar a sitios fraudulentos conocidos."
            not in result.reasons
        )

    def test_reason_absent_on_whitelisted_safe_domain_even_if_flagged(self, fake_model) -> None:
        fake_model._probability = 0.95
        result = analyze("https://docs.google.com/document", fake_model)
        assert result.level == "safe"
        assert (
            "El análisis automático del dominio lo considera muy similar a sitios fraudulentos conocidos."
            not in result.reasons
        )
