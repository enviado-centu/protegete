"""Unit tests for app.services.page_analyzer, using the fake ML model."""

from __future__ import annotations

from app.schemas import PageSignals
from app.services.page_analyzer import analyze_page


def test_no_signals_matches_plain_analyze(fake_model) -> None:
    from app.services.analyzer import analyze

    base = analyze("https://example.com", fake_model)
    result = analyze_page("https://example.com", PageSignals(), fake_model)

    assert result.level == base.level
    assert result.score == base.score
    assert result.category == base.category
    assert result.reasons == base.reasons
    assert result.tip == base.tip
    assert result.ml == base.ml
    assert result.rules == base.rules
    assert result.details == base.details
    assert result.page_signals == []
    assert result.lessons == []


def test_cryptominer_is_danger_malicious(fake_model) -> None:
    result = analyze_page("https://example.com", PageSignals(cryptominer=True), fake_model)
    assert result.level == "danger"
    assert result.category == "malicious"
    assert any(s.id == "cryptominer" for s in result.page_signals)
    assert result.lessons


def test_malvertising_plus_popups_is_danger(fake_model) -> None:
    signals = PageSignals(malvertising=["popads.net"], popups=2)
    result = analyze_page("https://example.com", signals, fake_model)
    assert result.level == "danger"
    assert result.score > 0.7


def test_notification_prompt_alone_never_danger(fake_model) -> None:
    result = analyze_page("https://example.com", PageSignals(notification_prompt=True), fake_model)
    assert result.level != "danger"


def test_tracker_cookies_alone_matches_plain_analyze(fake_model) -> None:
    from app.services.analyzer import analyze

    base = analyze("https://example.com", fake_model)
    result = analyze_page("https://example.com", PageSignals(tracker_cookies=10), fake_model)

    assert result.level == base.level
    assert result.score == base.score
    assert result.category == base.category
    assert result.reasons == base.reasons
    assert result.tip == base.tip
    assert result.rules == base.rules
    assert len(result.page_signals) == 1
    assert result.page_signals[0].id == "tracker_cookies"
    assert result.lessons == []


def test_whitelisted_domain_stays_safe_and_hides_page_signals(fake_model) -> None:
    signals = PageSignals(third_party_domains=40, tracker_cookies=8)
    result = analyze_page("https://www.bna.com.ar", signals, fake_model)
    assert result.level == "safe"
    assert result.page_signals == []
    assert result.lessons == []


def test_insecure_password_form_on_http_is_danger(fake_model) -> None:
    result = analyze_page("http://example.com", PageSignals(insecure_password_form=True), fake_model)
    assert result.level == "danger"
