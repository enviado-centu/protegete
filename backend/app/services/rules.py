"""Deterministic phishing-detection rules.

Primary source (T8): the teammate's `MODULO-PY/motor/` package, accessed
through `motor_adapter`.

- `motor.listas`: the whitelist (official brand domains) and the blacklist
  (own list + optional OpenPhish feed) short-circuit everything else, exactly
  as our own whitelist used to.
- `motor.reglas`: deterministic rules over the full URL (brand mention in
  host/path, suspicious TLD, scam keywords, IP host, punycode/homoglyph
  host, shortener, explicit port, "@" in URL), each with a ready-made
  Spanish reason. We reuse those reasons as-is instead of writing our own.

This module keeps ONLY what the motor does not cover:
- `brand_lookalike`: homoglyph-normalized + Levenshtein fuzzy matching
  against the *whole* domain label (e.g. "mercad0pago.com.ar",
  "ua1a.com.ar"). The motor's `imitacion_marca` only does exact-token /
  concatenated-word / plain-substring matching -- it has no homoglyph
  normalization and no edit distance, so it misses these typosquats
  entirely (verified against MODULO-PY/motor/reglas.py::_coincide). The
  brand catalog itself is *not* duplicated here: it's pulled from the
  motor's own whitelist via `motor_adapter.official_brands()`, plus a small
  documented fallback for brands the motor doesn't carry at all (see
  GLOBAL_BRANDS below).
- `brand_embedded` / whitelist fallback for `GLOBAL_BRANDS`: a handful of
  global (non-Argentine) tech brands -- google, paypal, microsoft, apple,
  netflix, whatsapp, instagram, facebook -- that motor/datos/lista_blanca.json
  does not include at all (it's scoped to the Argentine market). Without
  this, "docs.google.com" would lose its whitelist short-circuit and
  "google-verificacion.xyz"-style embedded mentions would go undetected.
  This is the "minimal, documented fallback" the T8 task explicitly allows.
- `insecure_http`: the motor has no HTTP-vs-HTTPS rule at all.

See odd/tasks/backend-analyze-api.md, T8 Progress/Evidence for the full
rule-by-rule overlap map.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

import tldextract

from app.services import feeds, motor_adapter
from app.services.urlinfo import UrlInfo, parse_url

_extractor = tldextract.TLDExtract(suffix_list_urls=())


@dataclass(frozen=True)
class Brand:
    """A brand: its display name and its official registrable domains.

    `domains[0]` is the canonical domain shown in user-facing reasons.
    """

    display_name: str
    domains: tuple[str, ...]


# Global brands NOT present in MODULO-PY/motor/datos/lista_blanca.json (that
# file is scoped to brands relevant to Argentine users). Kept here as a
# small, explicit, documented fallback -- see module docstring. If the motor
# ever adds global brand coverage, these entries should be removed.
GLOBAL_BRANDS: dict[str, Brand] = {
    "google": Brand("Google", ("google.com",)),
    "paypal": Brand("PayPal", ("paypal.com",)),
    "microsoft": Brand("Microsoft", ("microsoft.com",)),
    "apple": Brand("Apple", ("apple.com",)),
    "netflix": Brand("Netflix", ("netflix.com",)),
    "whatsapp": Brand("WhatsApp", ("whatsapp.com",)),
    "instagram": Brand("Instagram", ("instagram.com",)),
    "facebook": Brand("Facebook", ("facebook.com",)),
}

# Official sports/streaming broadcasters -- not "brands" for impersonation
# matching purposes (no fuzzy/lookalike catalog entry needed), just domains
# that must short-circuit to "safe" so the pirate_streaming rule below never
# false-positives on them (e.g. "https://www.tycsports.com/envivo").
OFFICIAL_STREAMING_DOMAINS: frozenset[str] = frozenset({
    "tycsports.com",
    "espn.com.ar",
    "espn.com",
    "disneyplus.com",
    "star.com",
    "paramountplus.com",
    "dazn.com",
    "flow.com.ar",
    "telefe.com",
    "tvpublica.com.ar",
    "directvgo.com",
    "max.com",
    "netflix.com",
    "youtube.com",
})

GLOBAL_WHITELIST_DOMAINS: frozenset[str] = frozenset(
    domain for brand in GLOBAL_BRANDS.values() for domain in brand.domains
) | OFFICIAL_STREAMING_DOMAINS

# Brand labels at or below this length require an exact token match for
# brand_embedded (instead of a plain substring match) to avoid false
# positives like "bna" matching inside unrelated words. None of the current
# GLOBAL_BRANDS ids are this short, but the guard is kept for safety.
SHORT_BRAND_THRESHOLD = 5

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
    """True if the registrable domain (hence any of its subdomains) is official.

    Primary source: the motor's whitelist. Falls back to GLOBAL_WHITELIST_DOMAINS
    for brands the motor doesn't carry (see module docstring).
    """
    if motor_adapter.is_whitelisted(info.original):
        return True
    return info.registrable_domain in GLOBAL_WHITELIST_DOMAINS


# Fuzzy (Levenshtein) matching is only applied when the official brand label
# is at least this long. Below it, only an exact match after homoglyph
# normalization counts -- otherwise short labels like "uala" or "bna" would
# fuzzy-match unrelated short words at edit-distance 1 (e.g. "sala", "bma").
FUZZY_MIN_LABEL_LENGTH = 6


def _lookalike_threshold(label: str) -> int:
    return 1 if len(label) <= 9 else 2


def _brand_lookalike_universe() -> list[tuple[str, str, str]]:
    """(display_name, official_domain, official_label) for every candidate brand.

    Combines the motor's whitelist (primary, Argentine-focused) with
    GLOBAL_BRANDS (fallback, see module docstring). Recomputed per call --
    motor_adapter.official_brands() is itself backed by the motor's own
    lru_cache, so this stays cheap.
    """
    universe: list[tuple[str, str, str]] = []
    for brand in motor_adapter.official_brands():
        for domain in brand.domains:
            universe.append((brand.display_name, domain, _extractor(domain).domain))
    for brand in GLOBAL_BRANDS.values():
        for domain in brand.domains:
            universe.append((brand.display_name, domain, _extractor(domain).domain))
    return universe


def _evaluate_brand_lookalike(info: UrlInfo) -> RuleMatch | None:
    """Homoglyph-normalized and/or Levenshtein-fuzzy match against a brand label.

    Only two cases fire here (see module docstring for why a plain exact
    match is deliberately excluded -- that's the motor's/`brand_embedded`'s
    job, to avoid a duplicate reason for the same signal):
    1. The label, after homoglyph normalization, exactly matches an official
       brand label, AND normalization actually changed something (i.e. the
       raw label contains a homoglyph substitution like "0" for "o"). This
       covers "mercad0pago.com.ar" and "ua1a.com.ar".
    2. The normalized label is a *non-zero* edit distance away from an
       official brand label (a typo), and that label is long enough
       (>= FUZZY_MIN_LABEL_LENGTH) for fuzzy matching to be safe. This
       covers "mercadopag.com.ar".
    """
    candidates = [info.domain_label] + [s for s in info.subdomain.split(".") if s]
    universe = _brand_lookalike_universe()
    for label in candidates:
        if not label:
            continue
        normalized = normalize_homoglyphs(label)
        homoglyph_applied = normalized != label
        for display_name, official_domain, official_label in universe:
            if not official_label:
                continue
            distance = levenshtein(normalized, official_label)
            if distance == 0:
                is_match = homoglyph_applied
            elif len(official_label) >= FUZZY_MIN_LABEL_LENGTH:
                is_match = distance <= _lookalike_threshold(official_label)
            else:
                is_match = False
            if is_match:
                return RuleMatch(
                    id="brand_lookalike",
                    weight=0.9,
                    category="impersonation",
                    reason=f"El dominio imita a {display_name} ({official_domain})",
                )
    return None


def _evaluate_brand_embedded(info: UrlInfo) -> RuleMatch | None:
    """Plain exact/substring brand mention, for GLOBAL_BRANDS only.

    Argentine brands get the equivalent check from the motor's own
    `imitacion_marca` rule (`marca_host` / `marca_otro_tld`, mapped below);
    duplicating that here for the same brands would produce two reasons for
    one signal.
    """
    host_tokens = {t for t in re.split(r"[^a-z0-9]+", info.host) if t}
    domain_label = info.domain_label
    subdomain_str = info.subdomain
    for brand_id, brand in GLOBAL_BRANDS.items():
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


def _evaluate_insecure_http(info: UrlInfo) -> RuleMatch | None:
    """The motor has no HTTP-vs-HTTPS rule; this stays entirely on our side."""
    if info.had_scheme and info.scheme == "http":
        return RuleMatch(
            id="insecure_http",
            weight=0.2,
            category="insecure",
            reason="La conexión no es segura (HTTP sin cifrado)",
        )
    return None


# --- Pirate streaming (risky_site) --------------------------------------
#
# Deterministic, offline family-marker rule for Argentine pirate
# football/series-streaming sites (futbollibre, rojadirecta, and friends):
# constantly-hopping domains known for malvertising, fake "play"/download
# buttons and scam pop-ups, but with no brand to impersonate -- so none of
# the brand rules above catch them, and the motor has no equivalent either.
# Not a reputation lookup: this stays 100% local/offline like the rest of
# `rules.py`. See `app.services.reputation` for the optional online source.
PIRATE_STREAMING_FAMILY_MARKERS: frozenset[str] = frozenset({
    "futbollibre",
    "futbol-libre",
    "librefutbol",
    "pelotalibre",
    "rojadirecta",
    "tarjetaroja",
    "tarjetarojatv",
    "futbolenvivo",
    "futbolgratis",
    "verfutbol",
    "futbollibretv",
    "pirlotv",
    "pirlo",
    "streameast",
    "crackstreams",
    "sportsurge",
    "totalsportek",
    "vipleague",
    "vipbox",
    "hesgoal",
    "buffstreams",
    "socceronline",
    "librefutboltv",
    "futbollibrehd",
})

# Weak streaming keywords: low-confidence alone, only meaningful combined
# with a sports word below. "hd" is deliberately weak-of-the-weak -- it must
# never count on its own, only alongside another weak keyword (see
# _evaluate_pirate_streaming).
_PIRATE_STREAMING_WEAK_KEYWORDS: frozenset[str] = frozenset({
    "envivo",
    "gratis",
    "fullhd",
    "streaming",
    "stream",
    "livetv",
    "tvonline",
    "hd",
})
_PIRATE_STREAMING_SPORTS_WORDS: frozenset[str] = frozenset({
    "futbol",
    "football",
    "soccer",
    "partido",
    "nba",
    "f1",
    "boxeo",
    "ufc",
})

PIRATE_STREAMING_STRONG_WEIGHT = 0.85
PIRATE_STREAMING_WEAK_WEIGHT = 0.45

PIRATE_STREAMING_REASON = (
    "Es un sitio de fútbol o series gratis sin permiso: suelen tener publicidad "
    "engañosa, botones falsos y virus."
)


def _normalize_streaming_label(label: str) -> str:
    """Lowercase + homoglyph/digit-substitution + hyphen-stripped label.

    Reuses `normalize_homoglyphs` (already lowercase-only input expected) so
    "futb0l-libre" and "futbol-libre" both normalize to "futbollibre",
    matching the family marker of the same name.
    """
    return normalize_homoglyphs(label.lower()).replace("-", "")


_NORMALIZED_FAMILY_MARKERS: frozenset[str] = frozenset(
    _normalize_streaming_label(marker) for marker in PIRATE_STREAMING_FAMILY_MARKERS
)


def _evaluate_pirate_streaming(info: UrlInfo) -> RuleMatch | None:
    """Strong family-marker match (weight 0.85), else a weak keyword +
    sports-word combination (weight 0.45). Only host labels (registrable
    domain label + subdomain labels) are checked, never the path -- so a
    news article mentioning "futbol" in its URL path stays unaffected.
    """
    raw_labels = [info.domain_label] + [s for s in info.subdomain.split(".") if s]
    normalized_labels = [_normalize_streaming_label(label) for label in raw_labels if label]

    for normalized in normalized_labels:
        if any(marker in normalized for marker in _NORMALIZED_FAMILY_MARKERS):
            return RuleMatch(
                id="pirate_streaming",
                weight=PIRATE_STREAMING_STRONG_WEIGHT,
                category="risky_site",
                reason=PIRATE_STREAMING_REASON,
            )

    matched_weak = {
        keyword
        for normalized in normalized_labels
        for keyword in _PIRATE_STREAMING_WEAK_KEYWORDS
        if keyword in normalized
    }
    # "hd" alone (with no other weak keyword) never counts.
    has_qualifying_weak_keyword = bool(matched_weak - {"hd"}) or ("hd" in matched_weak and len(matched_weak) > 1)
    has_sports_word = any(
        word in normalized for normalized in normalized_labels for word in _PIRATE_STREAMING_SPORTS_WORDS
    )
    if has_qualifying_weak_keyword and has_sports_word:
        return RuleMatch(
            id="pirate_streaming",
            weight=PIRATE_STREAMING_WEAK_WEIGHT,
            category="risky_site",
            reason=PIRATE_STREAMING_REASON,
        )
    return None


# --- Motor rule mapping ------------------------------------------------
#
# Maps each motor/reglas.py signal id to (our RuleMatch id, weight,
# category). Weights are chosen to preserve the analyzer's existing scoring
# guarantees (thresholds, weak-signal cap, shortener cap) rather than a
# linear rescale of the motor's own point system (PUNTOS in
# MODULO-PY/motor/reglas.py), which is unbounded and not on our 0..1 scale.
#
# - marca_host / marca_otro_tld map to the existing "brand_embedded" id
#   (weight varies: a host mention is a stronger signal than a wrong-TLD
#   exact match) so API consumers keyed on that id keep working.
# - marca_path is intentionally weak: the motor's own test suite uses an
#   innocuous news article ("diario.com/nota/bna/tasas") as its example, so
#   a bare path mention must not push a URL into "danger" by itself.
# - tld / palabra_1 / palabra_2mas reuse the existing "suspicious_tld" /
#   "scam_keywords" ids and weights (both weak signals, see
#   analyzer.WEAK_RULE_IDS).
# - ip / punycode / acortador reuse the existing "ip_host" / "punycode" /
#   "shortener" ids and weights unchanged (the "shortener" id is also keyed
#   on by analyzer.py's SHORTENER_ML_CAP logic).
# - puerto / arroba are new signals the motor added that we had no
#   equivalent for; "puerto" (explicit port) is a weak structural anomaly,
#   "arroba" (an "@" hiding the real destination host) is a real
#   URL-obfuscation technique, scored like punycode/shortener.
_MOTOR_SIGNAL_MAP: dict[str, tuple[str, float, str]] = {
    "marca_host": ("brand_embedded", 0.85, "impersonation"),
    # 0.75 (not 0.7): an exact brand name squatted on a different TLD (e.g.
    # "mercadopago.xyz") must clear DANGER_THRESHOLD (0.7) alone, matching
    # the old brand_lookalike behavior for this same "wrong TLD" case.
    "marca_otro_tld": ("brand_embedded", 0.75, "impersonation"),
    "marca_path": ("brand_mention", 0.3, "impersonation"),
    "tld": ("suspicious_tld", 0.25, "suspicious_domain"),
    "palabra_1": ("scam_keywords", 0.2, "suspicious_domain"),
    "palabra_2mas": ("scam_keywords", 0.25, "suspicious_domain"),
    "ip": ("ip_host", 0.7, "suspicious_domain"),
    "punycode": ("punycode", 0.6, "impersonation"),
    "acortador": ("shortener", 0.5, "hidden_destination"),
    "puerto": ("explicit_port", 0.15, "suspicious_domain"),
    "arroba": ("at_symbol", 0.6, "hidden_destination"),
}

# Motor signal ids skipped for a whitelisted domain. `imitacion_marca`
# already checks `es_oficial()` internally and self-skips, but
# `tld_sospechoso` / `palabras_enganio` do not (e.g. "verificar" in
# "bna.com.ar/verificar-identidad" would otherwise still fire), so we filter
# them here to preserve the pre-T8 whitelist short-circuit behavior.
_MOTOR_CONTENT_SIGNAL_IDS = frozenset({"marca_host", "marca_otro_tld", "marca_path", "tld", "palabra_1", "palabra_2mas"})

# The two motor signals that, like our own brand_lookalike/brand_embedded,
# look at the HOST (not the path): when one of these fires, it already
# explains the same host-level impersonation signal our own checks would
# report, so we must not also run our own check (that would produce two
# reasons for one signal, e.g. both "brand_lookalike" and "brand_embedded"
# for "mercadopagoo.com"). `marca_path` looks at the path instead -- a
# different URL region -- so it's never mutually exclusive with a host-level
# check and is left in the normal per-signal loop below.
_MOTOR_HOST_BRAND_SIGNAL_IDS = frozenset({"marca_host", "marca_otro_tld"})

# Blacklist hits don't come with a ready-made Spanish reason (unlike
# motor/reglas.py signals): motor.listas.esta_en_lista_negra() only returns
# structured {"tipo", "coincidencia"} data, so this reason is synthesized here.
BLACKLISTED_CATEGORY = "blacklisted"


def _evaluate_blacklist(url: str) -> RuleMatch | None:
    hit = motor_adapter.blacklist_hit(url)
    if hit is None:
        return None
    if hit.kind == "dominio":
        reason = f"Este dominio está en nuestra lista negra de sitios reportados como fraudulentos ({hit.match})"
    else:
        reason = "Esta dirección exacta está en nuestra lista negra de sitios reportados como fraudulentos"
    return RuleMatch(id="blacklisted", weight=1.0, category=BLACKLISTED_CATEGORY, reason=reason)


MALWARE_HOST_REASON = (
    "Este sitio figura en una lista pública de sitios que distribuyen virus (URLhaus)."
)


def _evaluate_malware_host(url: str) -> RuleMatch | None:
    """URLhaus malware-URL feed match (Feature B). See `app.services.feeds`.

    Mirrors `_evaluate_blacklist`'s shape, but does NOT short-circuit the
    rest of `evaluate_rules` -- its RuleMatch is appended like any other
    non-blacklist rule; it still dominates scoring via max(rule weights)
    since weight=1.0, same as how "reputation_flagged" already works in
    analyzer.py.
    """
    if feeds.is_urlhaus_match(url):
        return RuleMatch(id="malware_host", weight=1.0, category="malicious", reason=MALWARE_HOST_REASON)
    return None


def _map_motor_signal(signal: motor_adapter.MotorSignal) -> RuleMatch | None:
    mapping = _MOTOR_SIGNAL_MAP.get(signal.id)
    if mapping is None:
        return None
    our_id, weight, category = mapping
    return RuleMatch(id=our_id, weight=weight, category=category, reason=signal.reason)


def evaluate_rules(url: str) -> list[RuleMatch]:
    """Runs every rule against a URL and returns the ones that fired.

    Order: blacklist short-circuits first (a known-malicious URL needs no
    further explanation), same as whitelist used to short-circuit to safe.
    Brand rules and the motor's content signals (marca_*, tld, palabra_*)
    are skipped entirely for whitelisted (official) domains -- e.g.
    "bna.com.ar/verificar-identidad" must stay safe with zero rules despite
    "verificar" being a scam keyword.
    """
    blacklisted = _evaluate_blacklist(url)
    if blacklisted is not None:
        return [blacklisted]

    info = parse_url(url)
    hits: list[RuleMatch] = []
    whitelisted = is_whitelisted(info)

    if not whitelisted:
        malware_host = _evaluate_malware_host(url)
        if malware_host is not None:
            hits.append(malware_host)

    motor_signals = motor_adapter.evaluate_signals(url)
    motor_host_brand = next((s for s in motor_signals if s.id in _MOTOR_HOST_BRAND_SIGNAL_IDS), None)

    if not whitelisted:
        if motor_host_brand is not None:
            # The motor already found a host-level brand mention; use its
            # reason instead of also running our own host-level checks.
            mapped = _map_motor_signal(motor_host_brand)
            if mapped is not None:
                hits.append(mapped)
        else:
            lookalike = _evaluate_brand_lookalike(info)
            if lookalike is not None:
                hits.append(lookalike)
            else:
                embedded = _evaluate_brand_embedded(info)
                if embedded is not None:
                    hits.append(embedded)

    for signal in motor_signals:
        if signal is motor_host_brand:
            continue  # already added above
        if whitelisted and signal.id in _MOTOR_CONTENT_SIGNAL_IDS:
            continue
        mapped = _map_motor_signal(signal)
        if mapped is not None:
            hits.append(mapped)

    insecure = _evaluate_insecure_http(info)
    if insecure is not None:
        hits.append(insecure)

    if not whitelisted:
        pirate = _evaluate_pirate_streaming(info)
        if pirate is not None:
            hits.append(pirate)

    return hits
