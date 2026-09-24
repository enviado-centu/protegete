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
from app.services.lessons import Lesson, all_lessons, lessons_for

CHAT_PATH = "/api/chat"

SYSTEM_PROMPT = (
    "Sos el asistente de una app argentina que ayuda a prevenir estafas online. "
    "Tu audiencia incluye a personas de todas las edades, de chicos a personas mayores: "
    "usá un lenguaje simple, cercano y en voseo (vos/tenés), sin tecnicismos. "
    "Respondé en como máximo 4 oraciones cortas. "
    'Usá ÚNICAMENTE las señales y lecciones que te pasamos en el mensaje del usuario (JSON): '
    'nunca inventes datos ni decidas por tu cuenta si algo es peligroso más allá del "level" que te dan. '
    "Si la pregunta no tiene que ver con estafas o seguridad online, decilo con amabilidad y contá "
    "brevemente en qué sí podés ayudar. Terminá siempre con un consejo concreto y accionable."
)


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


def build_messages(message: str, context: Any) -> list[dict[str, str]]:
    """Builds the Ollama chat `messages` list: fixed system prompt + grounded user turn.

    The user message content is a JSON object with `question`, `level`,
    `signals`, and the lessons for those signals -- or, when there's no
    context, the 3 lessons whose title/keywords best overlap the question.
    """
    normalized_context = _normalize_context(context)
    level = normalized_context.get("level") if normalized_context else None
    raw_signals = (normalized_context.get("signals") if normalized_context else None) or []

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
        "signals": [_signal_as_dict(signal) for signal in raw_signals],
        "lessons": [lesson.model_dump() for lesson in lessons],
    }
    return [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": json.dumps(user_payload, ensure_ascii=False)},
    ]


def ask(message: str, context: Any, *, client: httpx.Client | None = None) -> str | None:
    """Asks Ollama a grounded question. Returns the answer, or `None` on any error/timeout.

    A `client` can be injected for tests (`httpx.MockTransport`); otherwise a
    short-lived `httpx.Client` is created per call, timing out after
    `OLLAMA_TIMEOUT_S` seconds (default 8s).
    """
    messages = build_messages(message, context)
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
        return answer or None
    except (httpx.HTTPError, ValueError, KeyError, TypeError):
        return None
    finally:
        if owns_client:
            http_client.close()
