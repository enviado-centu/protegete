"""Combines the normal full-URL analysis with page-behavior signals into one verdict.

Reuses `app.services.analyzer.analyze` as the single source of truth for
URL-only behavior (whitelist/blacklist short-circuit, ML scoring, weak-rule
cap, reasons/tip wording), then layers page rules (`app.services.page_rules`)
on top using the same "max weight + per-extra-rule combo bonus" shape, with
its own (larger) bonus and its own weak-rule cap tuned for page-level
signals -- see the constants below.
"""

from __future__ import annotations

import httpx

from app.schemas import AnalyzePageResponse, PageSignal, PageSignals, RuleHit
from app.services.analyzer import (
    DANGER_THRESHOLD,
    REPUTATION_FLAGGED_REASON,
    SAFE_LEVEL,
    SAFE_TIP,
    TIPS_BY_CATEGORY,
    DEFAULT_UNSAFE_TIP,
    _build_reasons,
    _level_for_score,
    _ml_derived_score,
    analyze,
)
from app.services.lessons import PAGE_RULE_TO_LESSON_ID, lessons_for
from app.services.ml_model import PhishingModel
from app.services.page_rules import evaluate_page_rules
from app.services.rules import RuleMatch, evaluate_rules, is_whitelisted
from app.services.urlinfo import parse_url

# Larger than analyzer.py's COMBO_BONUS_PER_EXTRA_RULE (0.05): independent
# live-page evidence corroborating a URL analysis is treated as stronger
# confirmation than piling up additional URL-only heuristics. Verified
# against the required test: malvertising(0.6) + popups(0.45) => two page
# rules => 0.6 + 0.15*(2-1) = 0.75 > DANGER_THRESHOLD(0.7) => "danger".
PAGE_SIGNAL_COMBO_BONUS = 0.15

# Mirrors analyzer.py's weak-rule cap, applied over the combined (URL + page)
# rule set: if every fired rule (URL and page alike) is weaker than this
# threshold, and the ML model hasn't independently reached the danger
# boundary on its own, clamp the combined score below it.
PAGE_WEAK_WEIGHT_THRESHOLD = 0.5
PAGE_WEAK_ONLY_SCORE_CAP = 0.6


def analyze_page(
    url: str,
    signals: PageSignals,
    model: PhishingModel,
    *,
    reputation_client: httpx.Client | None = None,
) -> AnalyzePageResponse:
    base = analyze(url, model, reputation_client=reputation_client)
    info = parse_url(url)
    whitelisted = is_whitelisted(info)

    # A whitelisted official domain's forced-safe verdict is never overridden
    # by page signals, and page findings aren't surfaced for it either (an
    # official site using analytics/ads infra must stay safe, with no
    # confusing "we found X but you're safe" UI).
    if whitelisted and base.category == "none":
        return AnalyzePageResponse(**base.model_dump(), page_signals=[], lessons=[])

    page_matches, info_signals = evaluate_page_rules(signals)
    if not page_matches:
        # No page rule fired: every AnalyzeResponse field stays IDENTICAL to
        # plain /api/analyze, plus any info-only signals (e.g. tracker_cookies
        # alone) surfaced but never affecting level/score, and no lessons.
        return AnalyzePageResponse(**base.model_dump(), page_signals=info_signals, lessons=[])

    # Recompute URL rules for the full RuleMatch (id+weight+category+reason):
    # base.rules only carries id+weight. evaluate_rules is pure/deterministic/
    # local, so calling it twice is cheap and safe.
    url_matches = evaluate_rules(url)
    if base.details.reputation == "flagged":
        # Mirror analyze()'s own synthetic reputation rule so it isn't lost
        # when recombining rule sets.
        url_matches = [
            *url_matches,
            RuleMatch(id="reputation_flagged", weight=1.0, category="malicious", reason=REPUTATION_FLAGGED_REASON),
        ]

    all_matches = [*url_matches, *page_matches]
    max_weight = max(m.weight for m in all_matches)

    prediction = model.predict(url)
    ml_score = _ml_derived_score(prediction.probability, prediction.threshold)

    bonus = PAGE_SIGNAL_COMBO_BONUS * max(len(all_matches) - 1, 0)
    score = min(1.0, max(max_weight, ml_score) + bonus)

    only_weak = all(m.weight < PAGE_WEAK_WEIGHT_THRESHOLD for m in all_matches)
    if only_weak and ml_score < DANGER_THRESHOLD:
        score = min(score, PAGE_WEAK_ONLY_SCORE_CAP)

    top = max(all_matches, key=lambda m: m.weight)
    category = top.category
    level = _level_for_score(score)

    reasons = _build_reasons(all_matches, prediction.probability, prediction.flagged, prediction.top_features, level)
    tip = SAFE_TIP if level == SAFE_LEVEL else TIPS_BY_CATEGORY.get(category, DEFAULT_UNSAFE_TIP)
    rule_hits = [RuleHit(id=m.id, weight=m.weight) for m in all_matches]

    page_signal_entries = [PageSignal(id=m.id, reason=m.reason) for m in page_matches] + info_signals
    lesson_ids: list[str] = []
    for match in page_matches:
        lesson_id = PAGE_RULE_TO_LESSON_ID.get(match.id)
        if lesson_id and lesson_id not in lesson_ids:
            lesson_ids.append(lesson_id)
    lessons = lessons_for(lesson_ids)

    return AnalyzePageResponse(
        url=url,
        level=level,
        score=round(score, 3),
        category=category,
        reasons=reasons,
        tip=tip,
        ml=base.ml,
        rules=rule_hits,
        details=base.details,
        page_signals=page_signal_entries,
        lessons=lessons,
    )
