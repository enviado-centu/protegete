"""Unit tests for the page-behavior rules engine (Feature C, backend half)."""

from __future__ import annotations

from app.schemas import PageSignals
from app.services.page_rules import evaluate_page_rules


def _ids(signals: PageSignals) -> set[str]:
    matches, _ = evaluate_page_rules(signals)
    return {m.id for m in matches}


def test_no_signals_fire_nothing() -> None:
    matches, info = evaluate_page_rules(PageSignals())
    assert matches == []
    assert info == []


def test_cryptominer_fires_malicious_high_weight() -> None:
    matches, _ = evaluate_page_rules(PageSignals(cryptominer=True))
    assert len(matches) == 1
    assert matches[0].id == "cryptominer"
    assert matches[0].weight == 0.95
    assert matches[0].category == "malicious"
    assert matches[0].reason


def test_insecure_password_form_fires() -> None:
    matches, _ = evaluate_page_rules(PageSignals(insecure_password_form=True))
    assert matches[0].id == "insecure_password_form"
    assert matches[0].weight == 0.85
    assert matches[0].category == "insecure"


def test_malvertising_fires_when_list_non_empty() -> None:
    matches, _ = evaluate_page_rules(PageSignals(malvertising=["popads.net"]))
    assert matches[0].id == "malvertising"
    assert matches[0].weight == 0.6
    assert matches[0].category == "risky_site"

    matches_empty, _ = evaluate_page_rules(PageSignals(malvertising=[]))
    assert matches_empty == []


def test_obfuscated_js_fires_on_count_ge_1() -> None:
    assert "obfuscated_js" in _ids(PageSignals(obfuscated_js=1))
    assert "obfuscated_js" not in _ids(PageSignals(obfuscated_js=0))


def test_cross_site_password_form_fires() -> None:
    matches, _ = evaluate_page_rules(PageSignals(cross_site_password_form=True))
    assert matches[0].id == "cross_site_password_form"
    assert matches[0].weight == 0.55
    assert matches[0].category == "suspicious_domain"


def test_hidden_iframes_fires_on_count_ge_1() -> None:
    assert "hidden_iframes" in _ids(PageSignals(hidden_iframes=1))
    assert "hidden_iframes" not in _ids(PageSignals(hidden_iframes=0))


def test_popups_fires_on_count_ge_1() -> None:
    assert "popups" in _ids(PageSignals(popups=1))
    assert "popups" not in _ids(PageSignals(popups=0))


def test_offsite_meta_refresh_fires() -> None:
    matches, _ = evaluate_page_rules(PageSignals(offsite_meta_refresh=True))
    assert matches[0].id == "offsite_meta_refresh"
    assert matches[0].weight == 0.4
    assert matches[0].category == "suspicious_domain"


def test_notification_prompt_fires_low_weight() -> None:
    matches, _ = evaluate_page_rules(PageSignals(notification_prompt=True))
    assert matches[0].id == "notification_prompt"
    assert matches[0].weight == 0.3
    assert matches[0].category == "risky_site"


def test_third_party_domains_fires_only_past_threshold() -> None:
    assert "third_party_domains" in _ids(PageSignals(third_party_domains=30))
    assert "third_party_domains" not in _ids(PageSignals(third_party_domains=29))


def test_tracker_cookies_is_info_only_never_a_scoring_match() -> None:
    matches, info = evaluate_page_rules(PageSignals(tracker_cookies=5))
    assert matches == []
    assert len(info) == 1
    assert info[0].id == "tracker_cookies"
    assert info[0].reason

    matches_below, info_below = evaluate_page_rules(PageSignals(tracker_cookies=4))
    assert info_below == []
