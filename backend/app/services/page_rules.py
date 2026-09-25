"""Deterministic rules over page-behavior signals collected by extension content scripts.

Content scripts send booleans/counts only -- never page content -- and this
module never logs anything it receives (see `app/main.py`'s
`/api/analyze-page` route). Each rule maps one signal to a `RuleMatch`
(reused verbatim by `app.services.page_analyzer` alongside the normal
full-URL rules from `app.services.rules`), plus the matching user-facing
`PageSignal` used for the response's `page_signals` list.

`tracker_cookies` is deliberately NOT a scoring rule (its "weight" is
conceptually 0): on its own it's weak, common even on legitimate sites, and
must never affect score/level/category or the combo bonus. It only produces
an info-only `PageSignal`, returned separately from the scoring matches.
"""

from __future__ import annotations

from app.schemas import PageSignal, PageSignals
from app.services.rules import RuleMatch

CRYPTOMINER_REASON = "La página usa tu computadora para minar criptomonedas sin avisarte."
INSECURE_PASSWORD_FORM_REASON = "Te pide una contraseña en una conexión sin cifrar."
MALVERTISING_REASON = (
    "La página carga publicidad de redes conocidas por pop-ups engañosos y descargas falsas."
)
OBFUSCATED_JS_REASON = "Tiene código escondido a propósito, algo típico de sitios maliciosos."
CROSS_SITE_PASSWORD_FORM_REASON = (
    "El formulario envía tu contraseña a un sitio distinto del que estás visitando."
)
HIDDEN_IFRAMES_REASON = (
    "La página esconde ventanas invisibles (iframes) que pueden ejecutar código sin que lo notes."
)
POPUPS_REASON = (
    "La página abre ventanas emergentes sin que hicieras clic, una táctica típica de sitios engañosos."
)
OFFSITE_META_REFRESH_REASON = "La página te redirige automáticamente a otro sitio distinto sin avisarte."
NOTIFICATION_PROMPT_REASON = (
    "Te pide permiso para mandarte notificaciones apenas entrás: suelen usarlas para spam y estafas."
)
THIRD_PARTY_DOMAINS_REASON = "La página carga contenido de una cantidad inusualmente alta de dominios externos."
TRACKER_COOKIES_REASON = (
    "La página usa varias cookies de seguimiento publicitario; esto por sí solo no significa que sea maliciosa."
)

# "Portero" (always-on, navigation-only behavior watcher -- see
# background.ts's behaviorWatcher.ts) rules: never derived from page
# content, only from tab/navigation events.
NOTIFICATION_PERMISSION_GRANTED_REASON = (
    "Este sitio ya tiene permiso para mandarte notificaciones: podés quitárselo desde el "
    "candado de la barra de direcciones."
)

# signals.<field> >= this count fires the corresponding rule (booleans/list
# presence are checked directly, not through this threshold table).
THIRD_PARTY_DOMAINS_THRESHOLD = 30
TRACKER_COOKIES_THRESHOLD = 5
POPUPS_OPENED_THRESHOLD = 2
FORCED_REDIRECTS_THRESHOLD = 1


def _popups_opened_reason(count: int) -> str:
    return f"Este sitio abrió {count} ventanas o pestañas solo."


def _forced_redirects_reason(count: int) -> str:
    if count == 1:
        return "Te redirigió a otro sitio sin que toques nada."
    return f"Te redirigió {count} veces a otro sitio sin que toques nada."


def evaluate_page_rules(signals: PageSignals) -> tuple[list[RuleMatch], list[PageSignal]]:
    """Runs every page-behavior rule and returns (scoring matches, info-only signals).

    Order (by weight, strongest first) mirrors the table in the task brief;
    order doesn't affect scoring (page_analyzer takes the max weight) but
    keeps the source readable in the same order as the spec.
    """
    matches: list[RuleMatch] = []

    if signals.cryptominer:
        matches.append(RuleMatch(id="cryptominer", weight=0.95, category="malicious", reason=CRYPTOMINER_REASON))
    if signals.insecure_password_form:
        matches.append(
            RuleMatch(
                id="insecure_password_form",
                weight=0.85,
                category="insecure",
                reason=INSECURE_PASSWORD_FORM_REASON,
            )
        )
    if signals.malvertising:
        matches.append(RuleMatch(id="malvertising", weight=0.6, category="risky_site", reason=MALVERTISING_REASON))
    if signals.obfuscated_js >= 1:
        matches.append(RuleMatch(id="obfuscated_js", weight=0.5, category="malicious", reason=OBFUSCATED_JS_REASON))
    if signals.cross_site_password_form:
        matches.append(
            RuleMatch(
                id="cross_site_password_form",
                weight=0.55,
                category="suspicious_domain",
                reason=CROSS_SITE_PASSWORD_FORM_REASON,
            )
        )
    if signals.hidden_iframes >= 1:
        matches.append(
            RuleMatch(id="hidden_iframes", weight=0.4, category="malicious", reason=HIDDEN_IFRAMES_REASON)
        )
    if signals.popups >= 1:
        matches.append(RuleMatch(id="popups", weight=0.45, category="risky_site", reason=POPUPS_REASON))
    if signals.offsite_meta_refresh:
        matches.append(
            RuleMatch(
                id="offsite_meta_refresh",
                weight=0.4,
                category="suspicious_domain",
                reason=OFFSITE_META_REFRESH_REASON,
            )
        )
    if signals.notification_prompt:
        matches.append(
            RuleMatch(
                id="notification_prompt",
                weight=0.3,
                category="risky_site",
                reason=NOTIFICATION_PROMPT_REASON,
            )
        )
    if signals.third_party_domains >= THIRD_PARTY_DOMAINS_THRESHOLD:
        matches.append(
            RuleMatch(
                id="third_party_domains",
                weight=0.15,
                category="risky_site",
                reason=THIRD_PARTY_DOMAINS_REASON,
            )
        )
    if signals.popups_opened >= POPUPS_OPENED_THRESHOLD:
        matches.append(
            RuleMatch(
                id="popups_opened",
                weight=0.5,
                category="risky_site",
                reason=_popups_opened_reason(signals.popups_opened),
            )
        )
    if signals.forced_redirects >= FORCED_REDIRECTS_THRESHOLD:
        matches.append(
            RuleMatch(
                id="forced_redirects",
                weight=0.4,
                category="suspicious_domain",
                reason=_forced_redirects_reason(signals.forced_redirects),
            )
        )
    if signals.notification_permission_granted:
        matches.append(
            RuleMatch(
                id="notification_permission_granted",
                weight=0.35,
                category="risky_site",
                reason=NOTIFICATION_PERMISSION_GRANTED_REASON,
            )
        )

    info_only: list[PageSignal] = []
    if signals.tracker_cookies >= TRACKER_COOKIES_THRESHOLD:
        info_only.append(PageSignal(id="tracker_cookies", reason=TRACKER_COOKIES_REASON))

    return matches, info_only
