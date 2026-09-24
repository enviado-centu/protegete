"""Deterministic phishing-detection rules: brand impersonation, shorteners, IPs, etc.

Complements the ML model, which has weak recall and no notion of Argentine
brands (see odd/tasks/backend-analyze-api.md, "Problem / Why").
"""

from __future__ import annotations

import re
from dataclasses import dataclass

import tldextract

from app.services.urlinfo import UrlInfo, parse_url

# Brand labels at or below this length require an exact token match for
# brand_embedded (instead of a plain substring match) to avoid false
# positives like "bna" or "uala" matching inside unrelated words.
SHORT_BRAND_THRESHOLD = 5

_extractor = tldextract.TLDExtract(suffix_list_urls=())


@dataclass(frozen=True)
class Brand:
    """An official brand: its display name and its official registrable domains.

    `domains[0]` is the canonical domain shown in user-facing reasons.
    """

    display_name: str
    domains: tuple[str, ...]


# Argentine brands (banks, government, fintech) plus a handful of global
# brands frequently impersonated in phishing aimed at Argentine users.
OFFICIAL_BRANDS: dict[str, Brand] = {
    "mercadopago": Brand("Mercado Pago", ("mercadopago.com.ar", "mercadopago.com")),
    "mercadolibre": Brand("Mercado Libre", ("mercadolibre.com.ar", "mercadolibre.com", "mercadolivre.com.br")),
    "afip": Brand("AFIP", ("afip.gob.ar",)),
    "arca": Brand("ARCA", ("arca.gob.ar",)),
    "anses": Brand("ANSES", ("anses.gob.ar",)),
    "argentina": Brand("Argentina.gob.ar", ("argentina.gob.ar",)),
    "bna": Brand("Banco Nación", ("bna.com.ar",)),
    "galicia": Brand("Banco Galicia", ("bancogalicia.com", "galicia.ar")),
    "santander": Brand("Santander", ("santander.com.ar",)),
    "bbva": Brand("BBVA", ("bbva.com.ar",)),
    "macro": Brand("Banco Macro", ("macro.com.ar",)),
    "brubank": Brand("Brubank", ("brubank.com",)),
    "uala": Brand("Ualá", ("uala.com.ar",)),
    "naranjax": Brand("NaranjaX", ("naranjax.com",)),
    "google": Brand("Google", ("google.com",)),
    "paypal": Brand("PayPal", ("paypal.com",)),
    "microsoft": Brand("Microsoft", ("microsoft.com",)),
    "apple": Brand("Apple", ("apple.com",)),
    "netflix": Brand("Netflix", ("netflix.com",)),
    "whatsapp": Brand("WhatsApp", ("whatsapp.com",)),
    "instagram": Brand("Instagram", ("instagram.com",)),
    "facebook": Brand("Facebook", ("facebook.com",)),
}

ALL_OFFICIAL_DOMAINS: frozenset[str] = frozenset(
    domain for brand in OFFICIAL_BRANDS.values() for domain in brand.domains
)

# Precomputed (official_domain, domain_label) pairs per brand, e.g.
# "bancogalicia.com" -> "bancogalicia". Computed once at import time.
_BRAND_LABELS: dict[str, list[tuple[str, str]]] = {
    brand_id: [(domain, _extractor(domain).domain) for domain in brand.domains]
    for brand_id, brand in OFFICIAL_BRANDS.items()
}

SHORTENERS: frozenset[str] = frozenset({
    "bit.ly", "tinyurl.com", "goo.gl", "t.co", "ow.ly", "is.gd", "buff.ly",
    "cutt.ly", "rebrand.ly", "shorturl.at", "rb.gy", "tiny.cc",
})

# Homoglyph normalization: visually similar characters mapped to the Latin
# letter they impersonate, so a spoofed domain normalizes to the real word.
_MULTI_CHAR_SUBS: tuple[tuple[str, str], ...] = (("rn", "m"), ("vv", "w"))
_HOMOGLYPH_MAP: dict[str, str] = {
    "0": "o", "1": "l", "3": "e", "4": "a", "5": "s", "7": "t",
    # Common Cyrillic confusables (visually identical to Latin letters).
    "а": "a", "е": "e", "о": "o", "р": "p", "с": "c", "х": "x", "у": "y",
    "і": "i", "ѕ": "s", "һ": "h", "ј": "j", "ԁ": "d",
}


@dataclass(frozen=True)
class RuleMatch:
    """One rule that fired against a URL."""

    id: str
    weight: float
    category: str
    reason: str


def normalize_homoglyphs(label: str) -> str:
    """Replaces visually-confusable characters with the Latin letter they mimic."""
    result = label
    for pair, replacement in _MULTI_CHAR_SUBS:
        result = result.replace(pair, replacement)
    return "".join(_HOMOGLYPH_MAP.get(char, char) for char in result)


def levenshtein(a: str, b: str) -> int:
    """Classic edit-distance DP, O(len(a) * len(b))."""
    if a == b:
        return 0
    if not a:
        return len(b)
    if not b:
        return len(a)
    previous = list(range(len(b) + 1))
    for i, char_a in enumerate(a, start=1):
        current = [i] + [0] * len(b)
        for j, char_b in enumerate(b, start=1):
            cost = 0 if char_a == char_b else 1
            current[j] = min(
                previous[j] + 1,  # deletion
                current[j - 1] + 1,  # insertion
                previous[j - 1] + cost,  # substitution
            )
        previous = current
    return previous[-1]


def is_whitelisted(info: UrlInfo) -> bool:
    """True if the registrable domain (hence any of its subdomains) is official."""
    return info.registrable_domain in ALL_OFFICIAL_DOMAINS


# Fuzzy (Levenshtein) matching is only applied when the official brand label
# is at least this long. Below it, only an exact match after homoglyph
# normalization counts — otherwise short labels like "uala" or "bna" would
# fuzzy-match unrelated short words at edit-distance 1 (e.g. "sala", "bma").
FUZZY_MIN_LABEL_LENGTH = 6


def _lookalike_threshold(label: str) -> int:
    return 1 if len(label) <= 9 else 2


def _evaluate_brand_lookalike(info: UrlInfo) -> RuleMatch | None:
    # The registrable domain's own label may match a brand exactly (e.g. wrong
    # TLD, "mercadopago.xyz") or via homoglyphs/typos. A subdomain label that
    # is an EXACT, unmodified brand name (e.g. "mercadopago.login-seguro.xyz")
    # is not a spoof — that's the brand_embedded case — so exact subdomain
    # matches are excluded here and left to brand_embedded.
    candidates: list[tuple[str, bool]] = [(info.domain_label, True)]
    candidates += [(s, False) for s in info.subdomain.split(".") if s]
    for label, allow_exact in candidates:
        if not label:
            continue
        normalized = normalize_homoglyphs(label)
        for brand_id, pairs in _BRAND_LABELS.items():
            brand = OFFICIAL_BRANDS[brand_id]
            for official_domain, official_label in pairs:
                if not official_label:
                    continue
                distance = levenshtein(normalized, official_label)
                if distance == 0:
                    is_match = allow_exact
                elif len(official_label) >= FUZZY_MIN_LABEL_LENGTH:
                    is_match = distance <= _lookalike_threshold(official_label)
                else:
                    is_match = False
                if is_match:
                    return RuleMatch(
                        id="brand_lookalike",
                        weight=0.9,
                        category="impersonation",
                        reason=f"El dominio imita a {brand.display_name} ({official_domain})",
                    )
    return None


def _evaluate_brand_embedded(info: UrlInfo) -> RuleMatch | None:
    host_tokens = {t for t in re.split(r"[^a-z0-9]+", info.host) if t}
    domain_label = info.domain_label
    subdomain_str = info.subdomain
    for brand_id, brand in OFFICIAL_BRANDS.items():
        if len(brand_id) <= SHORT_BRAND_THRESHOLD:
            hit = brand_id in host_tokens
        else:
            hit = brand_id in domain_label or brand_id in subdomain_str
        if hit:
            return RuleMatch(
                id="brand_embedded",
                weight=0.85,
                category="impersonation",
                reason=(
                    f"El dominio menciona a {brand.display_name} pero no es su sitio oficial "
                    f"({brand.domains[0]})"
                ),
            )
    return None


def _evaluate_shortener(info: UrlInfo) -> RuleMatch | None:
    if info.registrable_domain in SHORTENERS:
        return RuleMatch(
            id="shortener",
            weight=0.5,
            category="hidden_destination",
            reason="El link está acortado y oculta su destino real",
        )
    return None


def _evaluate_ip_host(info: UrlInfo) -> RuleMatch | None:
    if info.is_ip:
        return RuleMatch(
            id="ip_host",
            weight=0.7,
            category="suspicious_domain",
            reason="El sitio usa una dirección IP en lugar de un nombre de dominio",
        )
    return None


def _evaluate_punycode(info: UrlInfo) -> RuleMatch | None:
    if "xn--" in info.host:
        return RuleMatch(
            id="punycode",
            weight=0.6,
            category="impersonation",
            reason="El dominio usa codificación punycode, una técnica común para imitar letras de otro alfabeto",
        )
    return None


def _evaluate_insecure_http(info: UrlInfo) -> RuleMatch | None:
    if info.had_scheme and info.scheme == "http":
        return RuleMatch(
            id="insecure_http",
            weight=0.2,
            category="insecure",
            reason="La conexión no es segura (HTTP sin cifrado)",
        )
    return None


def evaluate_rules(url: str) -> list[RuleMatch]:
    """Runs every rule against a URL and returns the ones that fired.

    Brand rules are skipped entirely for whitelisted (official) domains.
    """
    info = parse_url(url)
    hits: list[RuleMatch] = []

    if not is_whitelisted(info):
        lookalike = _evaluate_brand_lookalike(info)
        if lookalike is not None:
            hits.append(lookalike)
        else:
            embedded = _evaluate_brand_embedded(info)
            if embedded is not None:
                hits.append(embedded)

    for evaluator in (_evaluate_shortener, _evaluate_ip_host, _evaluate_punycode, _evaluate_insecure_http):
        hit = evaluator(info)
        if hit is not None:
            hits.append(hit)

    return hits
