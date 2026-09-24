"""Message (text) analysis: red-flag signals, verdict and lessons.

Task 1 of `docs/superpowers/plans/2026-09-24-antiscam-chat-pwa-extension.md`.
Reuses the existing URL analyzer (`app.services.analyzer.analyze`) for any
link found inside the message, and the lesson catalog
(`app.services.lessons`) to teach each fired signal.

Matching is accent- and case-insensitive: the message is normalized with
`unicodedata` NFKD, stripping combining marks and lowercasing, while keeping
a position map back to the original text so `Signal.evidence` can be sliced
from the untouched original (never from the normalized copy).
"""

from __future__ import annotations

import re
import unicodedata

from app.schemas import AnalyzeResponse, AnalyzeTextResponse, Signal
from app.services import motor_adapter
from app.services.analyzer import analyze
from app.services.lessons import URL_CATEGORY_TO_LESSON_ID, lessons_for
from app.services.ml_model import PhishingModel

MAX_URLS = 5
MAX_EVIDENCE_LENGTH = 60

SAFE_THRESHOLD = 0.4
DANGER_THRESHOLD = 0.7

SINGLE_SIGNAL_SCORE_CAP = 0.6

# Weights per fired signal (plan Task 1). "suspicious_link" is not here: its
# weight depends on the worst URL result found inside the text (0.5 danger /
# 0.3 caution), computed in `_suspicious_link_signal`.
SIGNAL_WEIGHTS: dict[str, float] = {
    "credential_request": 0.45,
    "money_request": 0.4,
    "brand_mention": 0.25,
    "urgency": 0.25,
    "prize": 0.25,
    "impersonal_greeting": 0.15,
}

SUSPICIOUS_LINK_DANGER_WEIGHT = 0.5
SUSPICIOUS_LINK_CAUTION_WEIGHT = 0.3

# Spanish keyword/phrase lists per signal, matched against the normalized
# (accent-stripped, lowercased) text with word boundaries. Order inside each
# tuple doesn't matter; the earliest match in the text wins for `evidence`.
KEYWORD_SIGNALS: dict[str, tuple[str, ...]] = {
    "urgency": (
        "urgente",
        "urgencia",
        "inmediato",
        "inmediatamente",
        "ahora mismo",
        "ya mismo",
        "suspendida",
        "suspendido",
        "suspendera",
        "suspenderá",
        "bloqueada",
        "bloqueado",
        "bloqueara",
        "vence hoy",
        "vence en",
        "expira hoy",
        "ultimo aviso",
        "última advertencia",
    ),
    "credential_request": (
        "codigo de verificacion",
        "clave",
        "contrasena",
        "codigo",
        "pin",
        "cvv",
        "token",
    ),
    "money_request": (
        "cbu",
        "cvu",
        "alias",
        "transferencia",
        "transferi",
        "transferí",
        "sena",
    ),
    "prize": (
        "ganaste",
        "premio",
        "sorteo",
        "reintegro",
    ),
    "impersonal_greeting": (
        "estimado cliente",
        "estimada cliente",
        "estimado usuario",
        "estimada usuaria",
        "apreciado cliente",
        "apreciada cliente",
    ),
}

REASON_BY_SIGNAL: dict[str, str] = {
    "urgency": "Usa apuro y urgencia para que no pienses antes de actuar.",
    "credential_request": "Te pide una clave o código: ningún banco lo hace por mensaje.",
    "money_request": "Te pide plata, un CBU/alias o una transferencia.",
    "prize": "Promete un premio o reintegro que no pediste.",
    "brand_mention": "Menciona una marca conocida: verificá que sea realmente su canal oficial.",
    "suspicious_link": "Incluye un link que nuestro análisis considera sospechoso.",
    "impersonal_greeting": "Te saluda de forma genérica ('estimado cliente'), no por tu nombre.",
}

# Text signal id -> lesson id (mostly 1:1; brand_mention teaches the
# "brand_impersonation" lesson, per the plan's Task 1 interfaces).
SIGNAL_TO_LESSON_ID: dict[str, str] = {
    "urgency": "urgency",
    "credential_request": "credential_request",
    "money_request": "money_request",
    "prize": "prize",
    "brand_mention": "brand_impersonation",
    "suspicious_link": "suspicious_link",
    "impersonal_greeting": "impersonal_greeting",
}

TIP_BY_LEVEL: dict[str, str] = {
    "danger": "No respondas ni hagas clic: verificá por los canales oficiales antes de hacer nada.",
    "caution": "Revisá bien antes de responder o hacer clic; ante la duda, verificá por canales oficiales.",
    "safe": "No se detectaron señales de estafa, pero igual revisá antes de compartir datos personales.",
}

# Task 1 URL extraction regex (plan): scheme-prefixed URLs, bare "www."
# hosts, and bare domains ending in a common TLD (optionally ".ar" for
# ".com.ar"-style Argentine domains).
_URL_PATTERN = re.compile(
    r"(?:https?://\S+|www\.\S+|\b[a-z0-9-]+\.(?:com|ar|net|org|xyz|top|info|online|site|link|click)(?:\.ar)?(?:/\S*)?)",
    re.IGNORECASE,
)
_TRAILING_PUNCTUATION = ").,;:!?]}'\""


def _normalize_with_map(text: str) -> tuple[str, list[int]]:
    """NFKD-normalizes + strips accents + lowercases `text`, one char at a time.

    Returns the normalized string plus a parallel list mapping each
    normalized character back to the index of the original character it came
    from, so a match span in the normalized text can be sliced out of the
    *original* text for `Signal.evidence`.
    """
    normalized_chars: list[str] = []
    index_map: list[int] = []
    for original_index, char in enumerate(text):
        for decomposed_char in unicodedata.normalize("NFKD", char):
            if unicodedata.combining(decomposed_char):
                continue
            normalized_chars.append(decomposed_char.lower())
            index_map.append(original_index)
    return "".join(normalized_chars), index_map


def _normalize_plain(text: str) -> str:
    """Same normalization as `_normalize_with_map`, without the position map."""
    decomposed = unicodedata.normalize("NFKD", text)
    return "".join(c for c in decomposed if not unicodedata.combining(c)).lower()


def _keyword_pattern(keyword: str) -> re.Pattern[str]:
    escaped = re.escape(keyword).replace(r"\ ", r"\s+")
    return re.compile(rf"\b{escaped}\b")


def _first_match(keywords: tuple[str, ...], normalized_text: str) -> re.Match[str] | None:
    best: re.Match[str] | None = None
    for keyword in keywords:
        match = _keyword_pattern(keyword).search(normalized_text)
        if match and (best is None or match.start() < best.start()):
            best = match
    return best


def _first_brand_match(normalized_text: str) -> re.Match[str] | None:
    best: re.Match[str] | None = None
    for brand in motor_adapter.official_brands():
        normalized_brand = _normalize_plain(brand.display_name)
        if not normalized_brand:
            continue
        match = _keyword_pattern(normalized_brand).search(normalized_text)
        if match and (best is None or match.start() < best.start()):
            best = match
    return best


def _evidence(original: str, index_map: list[int], match: re.Match[str]) -> str:
    if not index_map:
        return ""
    start = index_map[match.start()]
    end = index_map[match.end() - 1] + 1
    return original[start:end][:MAX_EVIDENCE_LENGTH]


def _extract_urls(text: str) -> list[str]:
    urls: list[str] = []
    for match in _URL_PATTERN.finditer(text):
        raw = match.group(0).rstrip(_TRAILING_PUNCTUATION)
        if raw:
            urls.append(raw)
        if len(urls) >= MAX_URLS:
            break
    return urls


def _level_for_score(score: float) -> str:
    if score < SAFE_THRESHOLD:
        return "safe"
    if score <= DANGER_THRESHOLD:
        return "caution"
    return "danger"


def analyze_text(text: str, model: PhishingModel) -> AnalyzeTextResponse:
    """Scores a free-text message for scam red flags.

    Runs Spanish keyword/brand signal detection over the message, plus the
    existing URL analyzer over any link found inside it, and combines both
    into one verdict, following the same 0-1 `score` / safe|caution|danger
    `level` scale as `app.services.analyzer.analyze`.
    """
    normalized_text, index_map = _normalize_with_map(text)

    signals: list[Signal] = []
    for signal_id in ("urgency", "credential_request", "money_request", "prize", "impersonal_greeting"):
        match = _first_match(KEYWORD_SIGNALS[signal_id], normalized_text)
        if match is not None:
            signals.append(Signal(id=signal_id, evidence=_evidence(text, index_map, match)))

    brand_match = _first_brand_match(normalized_text)
    if brand_match is not None:
        signals.append(Signal(id="brand_mention", evidence=_evidence(text, index_map, brand_match)))

    url_strings = _extract_urls(text)
    url_results: list[AnalyzeResponse] = [analyze(url, model) for url in url_strings]

    suspicious_link_result: AnalyzeResponse | None = None
    suspicious_link_url: str | None = None
    suspicious_link_weight = 0.0
    danger_index = next((i for i, r in enumerate(url_results) if r.level == "danger"), None)
    if danger_index is not None:
        suspicious_link_result = url_results[danger_index]
        suspicious_link_url = url_strings[danger_index]
        suspicious_link_weight = SUSPICIOUS_LINK_DANGER_WEIGHT
    else:
        caution_index = next((i for i, r in enumerate(url_results) if r.level == "caution"), None)
        if caution_index is not None:
            suspicious_link_result = url_results[caution_index]
            suspicious_link_url = url_strings[caution_index]
            suspicious_link_weight = SUSPICIOUS_LINK_CAUTION_WEIGHT

    if suspicious_link_result is not None and suspicious_link_url is not None:
        signals.append(Signal(id="suspicious_link", evidence=suspicious_link_url[:MAX_EVIDENCE_LENGTH]))

    fired_ids = {signal.id for signal in signals}

    weights_sum = sum(
        SIGNAL_WEIGHTS[s.id] if s.id != "suspicious_link" else suspicious_link_weight for s in signals
    )
    score = min(1.0, weights_sum)
    if len(signals) == 1:
        score = min(score, SINGLE_SIGNAL_SCORE_CAP)

    level = _level_for_score(score)

    has_brand = "brand_mention" in fired_ids
    has_risk_signal = bool({"credential_request", "money_request", "suspicious_link"} & fired_ids)
    if has_brand and has_risk_signal:
        category = "impersonation"
    elif suspicious_link_result is not None:
        category = suspicious_link_result.category
    elif fired_ids:
        category = "social_engineering"
    else:
        category = "none"

    reasons = [REASON_BY_SIGNAL[signal.id] for signal in signals]
    tip = TIP_BY_LEVEL[level]

    lesson_ids: set[str] = {SIGNAL_TO_LESSON_ID[signal.id] for signal in signals}
    for url_result in url_results:
        mapped_lesson_id = URL_CATEGORY_TO_LESSON_ID.get(url_result.category)
        if mapped_lesson_id:
            lesson_ids.add(mapped_lesson_id)

    return AnalyzeTextResponse(
        level=level,
        score=round(score, 3),
        category=category,
        reasons=reasons,
        tip=tip,
        signals=signals,
        lessons=lessons_for(lesson_ids),
        urls=url_results,
    )
