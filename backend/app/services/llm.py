"""Layer B: grounded LLM chat via Ollama (Task 2 of the antiscam plan).

Always additive to layer A (the deterministic `/api/analyze-text` /
`/api/analyze` verdicts): this module never decides whether something is
dangerous. It only rephrases the already-verified `level` and `signals` it
is given, grounded in the matching lessons, and teaches. Any error or
timeout talking to Ollama returns `None`, and the caller (`/api/chat`)
reports `{"answer": null, "fallback": true}` -- the app must keep working
when the LLM is down.

No message content is logged: `ask` never writes the question or the
Ollama response anywhere but the HTTP response it returns.
"""

from __future__ import annotations

import json
import re
import unicodedata
from typing import Any, Mapping

import httpx

from app.config import get_ollama_model, get_ollama_timeout_s, get_ollama_url
from app.services import motor_adapter
from app.services.lessons import Lesson, all_lessons, lessons_for

CHAT_PATH = "/api/chat"

SYSTEM_PROMPT = (
    "Sos el asistente de una app argentina que ayuda a prevenir estafas online. "
    "Tu audiencia incluye a personas de todas las edades, de chicos a personas mayores: "
    "usá un lenguaje simple, cercano y en voseo (vos/tenés), sin tecnicismos. "
    "Respondé en como máximo 4 oraciones cortas. "
    "El mensaje del usuario es un JSON con la pregunta y, cuando existe, la evidencia real "
    "verificada de esta app: el sitio (url), su categoría, sus razones (reasons), señales de "
    "la página (page_signals), señales del texto (signals) y lecciones relacionadas (lessons). "
    "Respondé ÚNICAMENTE en base a esa evidencia: citá o parafraseá las reasons/señales/lecciones "
    "que te dimos. Si no tenés esa evidencia, decí 'No tengo ese dato' en vez de inventar. "
    "Nunca inventes marcas, empresas, fechas ni eventos que no estén en la evidencia, y nunca "
    "recomiendes un servicio comercial específico que no aparezca ahí. Nunca digas que vos "
    "visitaste o navegaste el sitio: solo conocés la evidencia que te pasamos. "
    "Si la pregunta no tiene que ver con estafas o seguridad online, decilo con amabilidad y contá "
    "brevemente en qué sí podés ayudar. Terminá siempre con un consejo concreto tomado de las "
    "lecciones (lessons) que te dimos."
)

# Well-known legitimate global brands/platforms that are safe to name even
# when they aren't literally present in this turn's evidence (e.g. "no
# compartas tu clave de WhatsApp" as generic advice) -- on top of the
# official Argentine brands from the motor's whitelist, resolved below.
_GLOBAL_KNOWN_BRANDS = (
    "WhatsApp",
    "Google",
    "Gmail",
    "Facebook",
    "Instagram",
    "Microsoft",
    "Apple",
    "Amazon",
    "Mercado Pago",
    "Mercado Libre",
    "Argentina",
    "ANSES",
    "AFIP",
)

# Matches a capitalized word (proper-noun candidate), including mixed-case
# brand names like "DirecTV"/"WhatsApp". All-caps acronyms (PIN, CVV,
# URGENTE) are filtered out separately in `is_grounded` (they're excluded
# here too, since fully upper-case never matches `[a-z...]` below -- kept
# permissive on case so "DirecTV"-style tokens are still caught) so they
# never trigger the grounding check.
_CAPITALIZED_WORD_RE = re.compile(r"\b[A-ZÁÉÍÓÚÑ][A-Za-zÁÉÍÓÚÑáéíóúñ]{1,}\b")
_SENTENCE_SPLIT_RE = re.compile(r"(?<=[.!?])\s+")


def _normalize(text: str) -> str:
    decomposed = unicodedata.normalize("NFKD", text)
    return "".join(c for c in decomposed if not unicodedata.combining(c)).lower()


def _keywords(text: str) -> set[str]:
    return {word for word in re.findall(r"[a-z0-9]+", _normalize(text)) if len(word) > 2}


def _lessons_for_question(question: str, limit: int = 3) -> list[Lesson]:
    """The `limit` lessons whose title/how_to_spot best overlap the question's words.

    Falls back to the first `limit` catalog lessons when there's no question
    text or no keyword overlap at all.
    """
    catalog = all_lessons()
    question_words = _keywords(question)
    if not question_words:
        return catalog[:limit]

    scored: list[tuple[int, Lesson]] = []
    for lesson in catalog:
        lesson_words = _keywords(lesson.title) | _keywords(lesson.how_to_spot)
        overlap = len(question_words & lesson_words)
        if overlap:
            scored.append((overlap, lesson))

    if not scored:
        return catalog[:limit]

    scored.sort(key=lambda pair: -pair[0])
    return [lesson for _, lesson in scored[:limit]]


def _normalize_context(context: Any) -> dict[str, Any] | None:
    """Accepts a `ChatContext` model, a plain dict, or `None`; always returns a dict or `None`."""
    if context is None:
        return None
    if isinstance(context, Mapping):
        return dict(context)
    if hasattr(context, "model_dump"):
        return context.model_dump()
    return dict(context)


def _signal_id(signal: Any) -> str:
    return signal["id"] if isinstance(signal, Mapping) else signal.id


def _signal_as_dict(signal: Any) -> dict[str, Any]:
    return dict(signal) if isinstance(signal, Mapping) else {"id": signal.id, "evidence": signal.evidence}


def _page_signal_as_dict(signal: Any) -> dict[str, Any]:
    return dict(signal) if isinstance(signal, Mapping) else {"id": signal.id, "reason": signal.reason}


def _history_as_dicts(history: Any) -> list[dict[str, str]]:
    """Normalizes `history` (list of `ChatHistoryTurn` models or dicts) to plain dicts."""
    if not history:
        return []
    turns: list[dict[str, str]] = []
    for turn in history:
        entry = dict(turn) if isinstance(turn, Mapping) else turn.model_dump()
        role = entry.get("role")
        text = entry.get("text")
        if role in ("user", "assistant") and isinstance(text, str) and text:
            turns.append({"role": role, "text": text})
    return turns


def build_messages(message: str, context: Any, history: Any = None) -> list[dict[str, str]]:
    """Builds the Ollama chat `messages` list: system prompt + prior turns + grounded user turn.

    The final user message content is a JSON object with `question`, `level`,
    `url`, `category`, `reasons`, `signals`, `page_signals`, and the lessons
    for those signals -- or, when there's no context, the 3 lessons whose
    title/keywords best overlap the question. Prior turns (`history`, at
    most a few short user/assistant exchanges) are included ahead of it so
    the model has short-term memory of the conversation.
    """
    normalized_context = _normalize_context(context)
    level = normalized_context.get("level") if normalized_context else None
    url = normalized_context.get("url") if normalized_context else None
    category = normalized_context.get("category") if normalized_context else None
    reasons = (normalized_context.get("reasons") if normalized_context else None) or []
    raw_signals = (normalized_context.get("signals") if normalized_context else None) or []
    raw_page_signals = (normalized_context.get("page_signals") if normalized_context else None) or []

    if raw_signals:
        seen_ids: list[str] = []
        for signal in raw_signals:
            signal_id = _signal_id(signal)
            if signal_id not in seen_ids:
                seen_ids.append(signal_id)
        lessons = lessons_for(seen_ids)
    else:
        lessons = _lessons_for_question(message)

    user_payload = {
        "question": message,
        "level": level,
        "url": url,
        "category": category,
        "reasons": list(reasons),
        "signals": [_signal_as_dict(signal) for signal in raw_signals],
        "page_signals": [_page_signal_as_dict(signal) for signal in raw_page_signals],
        "lessons": [lesson.model_dump() for lesson in lessons],
    }

    messages = [{"role": "system", "content": SYSTEM_PROMPT}]
    for turn in _history_as_dicts(history):
        messages.append({"role": turn["role"], "content": turn["text"]})
    messages.append({"role": "user", "content": json.dumps(user_payload, ensure_ascii=False)})
    return messages


def _evidence_vocabulary(context: Any) -> set[str]:
    """Normalized words available as grounding evidence for `context`.

    Includes the verdict's own url/category/reasons/signals/page_signals
    text plus every lesson's own copy (our own teaching content, never
    user-supplied, so it's safe to consider "known" vocabulary too).
    """
    normalized_context = _normalize_context(context) or {}
    parts: list[str] = []
    if normalized_context.get("url"):
        parts.append(str(normalized_context["url"]))
    if normalized_context.get("category"):
        parts.append(str(normalized_context["category"]))
    parts.extend(str(reason) for reason in normalized_context.get("reasons") or [])
    for signal in normalized_context.get("signals") or []:
        parts.append(str(_signal_as_dict(signal).get("evidence", "")))
    for signal in normalized_context.get("page_signals") or []:
        parts.append(str(_page_signal_as_dict(signal).get("reason", "")))
    for lesson in all_lessons():
        parts.append(f"{lesson.title} {lesson.how_to_spot} {lesson.example} {lesson.what_to_do}")
    text = " ".join(parts)
    return {_normalize(word) for word in re.findall(r"[A-Za-zÁÉÍÓÚÑáéíóúñ]+", text)}


def _known_brand_words() -> set[str]:
    """Normalized words from official brand names (motor whitelist) + a small global list."""
    words: set[str] = set()
    for brand in _GLOBAL_KNOWN_BRANDS:
        words |= {_normalize(word) for word in re.findall(r"[A-Za-zÁÉÍÓÚÑáéíóúñ]+", brand)}
    try:
        brands = motor_adapter.official_brands()
    except Exception:  # pragma: no cover - defensive: grounding must never crash the chat
        return words
    for brand in brands:
        words |= {_normalize(word) for word in re.findall(r"[A-Za-zÁÉÍÓÚÑáéíóúñ]+", brand.display_name)}
    return words


def is_grounded(answer: str, context: Any) -> bool:
    """True unless `answer` names a capitalized brand/company/service word that isn't
    backed by evidence: the verdict's own url/category/reasons/signals/page_signals, our
    own lesson copy, an official brand (motor whitelist), or a well-known global brand.

    A sentence-initial capitalized word is never flagged on its own (ordinary
    Spanish capitalization, not a proper-noun claim). This is a best-effort
    hallucination guard, not a full NLP check -- it exists to catch invented
    brand/company names (e.g. a recommended streaming service that was never
    part of the evidence), not to grade grammar.
    """
    if not answer or not answer.strip():
        return False

    allowed = _evidence_vocabulary(context) | _known_brand_words()

    for sentence in _SENTENCE_SPLIT_RE.split(answer):
        stripped = sentence.strip().lstrip("¿¡\"'“(")
        if not stripped:
            continue
        first_match = _CAPITALIZED_WORD_RE.search(stripped)
        first_start = first_match.start() if first_match else None
        for match in _CAPITALIZED_WORD_RE.finditer(stripped):
            word_raw = match.group(0)
            if word_raw.isupper():
                # All-caps (PIN, CVV, URGENTE) is emphasis/acronym, not a
                # proper-noun claim.
                continue
            if match.start() == first_start:
                # Sentence-initial capitalization is ordinary Spanish style,
                # not evidence of a proper noun.
                continue
            word = _normalize(word_raw)
            if word not in allowed:
                return False
    return True


def ask(
    message: str,
    context: Any,
    *,
    client: httpx.Client | None = None,
    history: Any = None,
) -> str | None:
    """Asks Ollama a grounded question. Returns the answer, or `None` on any error/timeout.

    A `client` can be injected for tests (`httpx.MockTransport`); otherwise a
    short-lived `httpx.Client` is created per call, timing out after
    `OLLAMA_TIMEOUT_S` seconds (default 8s). An answer that isn't grounded in
    the given context/lessons (see `is_grounded`) is treated the same as any
    other failure: `None`, so the caller falls back to layer A.
    """
    messages = build_messages(message, context, history)
    payload = {
        "model": get_ollama_model(),
        "messages": messages,
        "stream": False,
        "think": False,
    }

    owns_client = client is None
    http_client = client or httpx.Client(base_url=get_ollama_url(), timeout=get_ollama_timeout_s())
    try:
        response = http_client.post(CHAT_PATH, json=payload)
        response.raise_for_status()
        data = response.json()
        content = data["message"]["content"]
        if not isinstance(content, str):
            return None
        answer = content.strip()
        if not answer:
            return None
        if not is_grounded(answer, context):
            return None
        return answer
    except (httpx.HTTPError, ValueError, KeyError, TypeError):
        return None
    finally:
        if owns_client:
            http_client.close()
