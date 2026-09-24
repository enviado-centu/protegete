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

    def test_short_typo_of_short_brand_does_not_fire(self) -> None:
        # Regression: Levenshtein-1 fuzzy matching against short brand labels
        # (e.g. "uala", "bna") false-positives on unrelated short words.
        assert "brand_lookalike" not in _ids("http://sala.com.ar")
        assert "brand_lookalike" not in _ids("http://macra.com.ar")
        assert "brand_lookalike" not in _ids("http://bma.com.ar")

    def test_homoglyph_exact_match_of_short_brand_still_fires(self) -> None:
        # Exact match after homoglyph normalization is still allowed for
        # short brands, only fuzzy (non-zero-distance) matching is gated.
        hits = {h.id: h for h in evaluate_rules("http://ua1a.com.ar")}
        assert "brand_lookalike" in hits
        assert hits["brand_lookalike"].weight == 0.9

    def test_near_typo_of_long_brand_still_fires(self) -> None:
        assert "brand_lookalike" in _ids("http://mercadopag.com.ar")


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


class TestSuspiciousTld:
    def test_suspicious_tld_fires(self) -> None:
        hits = {h.id: h for h in evaluate_rules("http://example.xyz/login")}
        assert "suspicious_tld" in hits
        assert hits["suspicious_tld"].category == "suspicious_domain"
        assert ".xyz" in hits["suspicious_tld"].reason

    def test_common_tld_does_not_fire(self) -> None:
        assert "suspicious_tld" not in _ids("https://example.com")

    def test_skipped_for_whitelisted_domain(self) -> None:
        # bna.com.ar itself isn't a suspicious TLD, but this also verifies
        # the whitelist short-circuit runs before this rule is evaluated.
        assert "suspicious_tld" not in _ids("https://www.bna.com.ar/verificar-identidad")


class TestScamKeywords:
    def test_keyword_in_path_fires(self) -> None:
        # The ML model never looks at the path, so this rule must.
        hits = {h.id: h for h in evaluate_rules("https://example.com/login")}
        assert "scam_keywords" in hits
        assert hits["scam_keywords"].category == "suspicious_domain"
        assert "login" in hits["scam_keywords"].reason

    def test_hyphen_joined_compound_matches_multiple_words(self) -> None:
        hits = {h.id: h for h in evaluate_rules("http://bna-homebanking-verificar.xyz/login")}
        assert "scam_keywords" in hits
        reason = hits["scam_keywords"].reason
        assert "homebanking" in reason
        assert "verificar" in reason
        assert "login" in reason

    def test_reason_caps_at_three_words(self) -> None:
        hits = {
            h.id: h
            for h in evaluate_rules("https://example.com/login-verificar-clave-banco-confirmar")
        }
        matched_words = hits["scam_keywords"].reason.split(": ", 1)[1].split(", ")
        assert len(matched_words) <= 3

    def test_short_keyword_does_not_match_as_substring(self) -> None:
        # "bank" (4 chars) must not match inside unrelated words like "embankment".
        assert "scam_keywords" not in _ids("https://embankment-tours.com")

    def test_long_keyword_matches_as_substring_without_separator(self) -> None:
        assert "scam_keywords" in _ids("https://example.com/verificaridentidad")

    def test_no_keywords_does_not_fire(self) -> None:
        assert "scam_keywords" not in _ids("https://example.com/about")

    def test_skipped_for_whitelisted_domain(self) -> None:
        # "verificar" is a scam keyword, but the whitelist short-circuits first.
        assert "scam_keywords" not in _ids("https://www.bna.com.ar/verificar-identidad")


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
