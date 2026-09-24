"""Ensemble: combines rule hits and the ML model into one user-facing verdict.

Scoring, in five lines (see also backend/README.md):
1. The ML probability is rescaled so that the model's own 0.90 threshold lands
   at 0.70 (the caution/danger boundary), keeping both scales comparable.
2. The final score is the max of the strongest rule weight and the rescaled
   ML score, plus a small bonus when several rules fire together.
3. A shortened link caps its ML contribution so a bare shortener alone stays
   in "caution", never "danger" -- the shortener itself isn't proof of harm.
4. A whitelisted official domain (or any of its subdomains) is force-capped
   to "safe", since the model alone flags some of them (e.g. docs.google.com).
5. `category` follows the strongest fired rule; reasons combine rule text
   with translated top ML features, deduplicated, capped at four.
"""

from __future__ import annotations

from app.schemas import AnalyzeResponse, MLInfo, RuleHit
from app.services.ml_model import PhishingModel
from app.services.rules import RuleMatch, evaluate_rules, is_whitelisted
from app.services.urlinfo import parse_url

SHORTENER_ML_CAP = 0.65
WHITELIST_SCORE_CAP = 0.15
COMBO_BONUS_PER_EXTRA_RULE = 0.05
ML_REASON_MIN_PROBABILITY = 0.5
MAX_REASONS = 4

SAFE_LEVEL = "safe"
CAUTION_LEVEL = "caution"
DANGER_LEVEL = "danger"

SAFE_THRESHOLD = 0.4
DANGER_THRESHOLD = 0.7

# Spanish, user-facing translations of the ML model's raw feature names.
# Wording matches the equivalent rule reason where both can fire, so
# deduplication (below) collapses them into a single sentence.
ML_FEATURE_REASONS: dict[str, str] = {
    "cant_guiones": "El dominio tiene varios guiones, algo común en sitios falsos",
    "tld_sospechoso": "Usa una terminación de dominio poco confiable (.xyz, .top, entre otras)",
    "cant_palabras_sospechosas": (
        "El dominio contiene palabras típicas de engaños (login, verificar, clave, entre otras)"
    ),
    "marca_fuera_de_dominio": "Menciona una marca conocida pero no es su sitio oficial",
    "es_acortador": "El link está acortado y oculta su destino real",
    "usa_ip": "El sitio usa una dirección IP en lugar de un nombre de dominio",
    "tiene_punycode": "El dominio usa codificación punycode, una técnica común para imitar letras de otro alfabeto",
    "entropia_dominio": "El nombre del dominio parece aleatorio",
    "longitud_dominio": "El dominio es inusualmente largo",
    "cant_digitos": "El dominio tiene muchos números",
    "proporcion_digitos": "El dominio tiene muchos números",
}

TIPS_BY_CATEGORY: dict[str, str] = {
    "impersonation": "Entrá siempre escribiendo la dirección oficial, nunca desde un link que te enviaron.",
    "suspicious_domain": "Desconfiá de dominios raros o con direcciones IP: revisá bien antes de ingresar datos.",
    "hidden_destination": "Los links acortados ocultan su destino real: fijate a dónde llevan antes de hacer clic.",
    "insecure": "Evitá ingresar datos personales en sitios sin conexión segura (https).",
}
DEFAULT_UNSAFE_TIP = "Revisá bien la dirección antes de ingresar datos personales."
SAFE_TIP = "No se detectaron señales de phishing, pero igual revisá la dirección antes de ingresar datos sensibles."


def _level_for_score(score: float) -> str:
    if score < SAFE_THRESHOLD:
        return SAFE_LEVEL
    if score <= DANGER_THRESHOLD:
        return CAUTION_LEVEL
    return DANGER_LEVEL


def _ml_derived_score(probability: float, threshold: float) -> float:
    """Rescales the model probability so `threshold` maps to the danger boundary (0.7)."""
    if threshold <= 0:
        return probability
    if probability >= threshold:
        remaining = 1 - threshold
        if remaining <= 0:
            return 1.0
        return DANGER_THRESHOLD + (probability - threshold) / remaining * (1 - DANGER_THRESHOLD)
    return probability / threshold * DANGER_THRESHOLD


def _build_reasons(rules: list[RuleMatch], ml_probability: float, top_features: list[str], level: str) -> list[str]:
    reasons: list[str] = []
    for rule in sorted(rules, key=lambda r: -r.weight):
        if rule.reason not in reasons:
            reasons.append(rule.reason)

    if ml_probability >= ML_REASON_MIN_PROBABILITY and level != SAFE_LEVEL:
        for feature in top_features:
            text = ML_FEATURE_REASONS.get(feature)
            if text and text not in reasons:
                reasons.append(text)

    return reasons[:MAX_REASONS]


def _tip_for(level: str, category: str) -> str:
    if level == SAFE_LEVEL:
        return SAFE_TIP
    return TIPS_BY_CATEGORY.get(category, DEFAULT_UNSAFE_TIP)


def analyze(url: str, model: PhishingModel) -> AnalyzeResponse:
    """Runs the rules engine and the ML model, then combines them into one verdict."""
    info = parse_url(url)
    rules = evaluate_rules(url)
    prediction = model.predict(url)

    ml_score = _ml_derived_score(prediction.probability, prediction.threshold)
    if any(rule.id == "shortener" for rule in rules):
        ml_score = min(ml_score, SHORTENER_ML_CAP)

    max_rule = max(rules, key=lambda r: r.weight, default=None)
    max_rule_weight = max_rule.weight if max_rule else 0.0

    base_score = max(max_rule_weight, ml_score)
    bonus = COMBO_BONUS_PER_EXTRA_RULE * max(len(rules) - 1, 0)
    score = min(1.0, base_score + bonus)

    category = max_rule.category if max_rule else ("suspicious_domain" if prediction.flagged else "none")

    if is_whitelisted(info):
        score = min(score, WHITELIST_SCORE_CAP)
        category = "none"

    level = _level_for_score(score)
    reasons = _build_reasons(rules, prediction.probability, prediction.top_features, level)
    tip = _tip_for(level, category)

    return AnalyzeResponse(
        url=url,
        level=level,
        score=round(score, 3),
        category=category,
        reasons=reasons,
        tip=tip,
        ml=MLInfo(
            probability=prediction.probability,
            threshold=prediction.threshold,
            flagged=prediction.flagged,
            top_features=prediction.top_features,
        ),
        rules=[RuleHit(id=r.id, weight=r.weight) for r in rules],
    )
