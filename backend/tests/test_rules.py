"""Tests for the deterministic rules engine."""

from __future__ import annotations

from app.services.rules import (
    evaluate_rules,
    is_whitelisted,
    levenshtein,
    normalize_homoglyphs,
)
from app.services.urlinfo import parse_url


def _ids(url: str) -> set[str]:
    return {hit.id for hit in evaluate_rules(url)}


class TestHomoglyphNormalization:
    def test_digit_substitutions(self) -> None:
        assert normalize_homoglyphs("mercad0pago") == "mercadopago"
        assert normalize_homoglyphs("g00gle") == "google"

    def test_multi_char_substitutions(self) -> None:
        assert normalize_homoglyphs("paypa1") == "paypal"
        assert normalize_homoglyphs("vvhatsapp") == "whatsapp"

    def test_cyrillic_confusables(self) -> None:
        assert normalize_homoglyphs("аpple") == "apple"  # Cyrillic "а"

    def test_no_change_for_plain_text(self) -> None:
        assert normalize_homoglyphs("mercadopago") == "mercadopago"


class TestLevenshtein:
    def test_identical_strings(self) -> None:
        assert levenshtein("mercadopago", "mercadopago") == 0

    def test_one_substitution(self) -> None:
        assert levenshtein("mercadopago", "mercadopaga") == 1

    def test_one_insertion(self) -> None:
        assert levenshtein("mercadopago", "mercadopagoo") == 1

    def test_empty_strings(self) -> None:
        assert levenshtein("", "") == 0
        assert levenshtein("abc", "") == 3


class TestWhitelist:
    def test_official_domain_is_whitelisted(self) -> None:
        assert is_whitelisted(parse_url("https://mercadopago.com.ar"))

    def test_subdomain_of_official_domain_is_whitelisted(self) -> None:
        assert is_whitelisted(parse_url("https://www.mercadopago.com.ar"))
        assert is_whitelisted(parse_url("https://docs.google.com/document"))

    def test_lookalike_domain_is_not_whitelisted(self) -> None:
        assert not is_whitelisted(parse_url("https://mercad0pago.com.ar"))


class TestBrandLookalike:
    def test_homoglyph_lookalike_fires(self) -> None:
        hits = evaluate_rules("http://mercad0pago.com.ar")
        assert "brand_lookalike" in _ids("http://mercad0pago.com.ar")
        lookalike = next(h for h in hits if h.id == "brand_lookalike")
        assert lookalike.weight == 0.9
        assert lookalike.category == "impersonation"

    def test_official_domain_does_not_fire(self) -> None:
        assert "brand_lookalike" not in _ids("https://www.mercadopago.com.ar")
        assert "brand_embedded" not in _ids("https://www.mercadopago.com.ar")

    def test_wrong_tld_exact_label_fires(self) -> None:
        assert "brand_lookalike" in _ids("http://mercadopago.xyz")


class TestBrandEmbedded:
    def test_brand_appended_to_registrable_domain_fires(self) -> None:
        hits = evaluate_rules("http://mercadopagoseguro.com")
        assert "brand_embedded" in {h.id for h in hits}
        embedded = next(h for h in hits if h.id == "brand_embedded")
        assert embedded.weight == 0.85
        assert embedded.category == "impersonation"

    def test_brand_in_subdomain_fires(self) -> None:
        assert "brand_embedded" in _ids("http://mercadopago.login-seguro.xyz")

    def test_short_brand_requires_exact_token_not_substring(self) -> None:
        # "bna" must not match as a substring of an unrelated word.
        assert "brand_embedded" not in _ids("http://urbanas.com")

    def test_short_brand_matches_as_exact_token(self) -> None:
        assert "brand_embedded" in _ids("http://bna-verificacion.com")


class TestOtherRules:
    def test_shortener(self) -> None:
        hits = {h.id: h for h in evaluate_rules("https://bit.ly/x")}
        assert "shortener" in hits
        assert hits["shortener"].weight == 0.5
        assert hits["shortener"].category == "hidden_destination"

    def test_ip_host(self) -> None:
        hits = {h.id: h for h in evaluate_rules("http://192.168.1.1/login")}
        assert "ip_host" in hits
        assert hits["ip_host"].category == "suspicious_domain"

    def test_punycode(self) -> None:
        hits = {h.id: h for h in evaluate_rules("http://xn--pypal-4ve.com")}
        assert "punycode" in hits

    def test_insecure_http_only_when_scheme_explicit(self) -> None:
        assert "insecure_http" in _ids("http://example.com")
        assert "insecure_http" not in _ids("https://example.com")
        assert "insecure_http" not in _ids("example.com")

    def test_no_rules_fire_for_a_plain_safe_domain(self) -> None:
        assert evaluate_rules("https://example.com") == []
