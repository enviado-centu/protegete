"""Tests for app.services.llm (Task 2 of the antiscam plan)."""

from __future__ import annotations

import json

import httpx

from app.services import llm


def client(handler):
    return httpx.Client(transport=httpx.MockTransport(handler), base_url="http://ollama")


def test_returns_answer() -> None:
    c = client(lambda req: httpx.Response(200, json={"message": {"content": "  No compartas tu clave.  "}}))
    assert llm.ask("¿Me piden la clave?", None, client=c) == "No compartas tu clave."


def test_sends_think_false_and_grounding() -> None:
    seen = {}

    def h(req):
        seen.update(json.loads(req.content))
        return httpx.Response(200, json={"message": {"content": "ok"}})

    llm.ask("hola", {"level": "danger", "signals": [{"id": "urgency", "evidence": "suspendida"}]}, client=client(h))
    assert seen["think"] is False and seen["stream"] is False
    assert "urgency" in seen["messages"][-1]["content"]


def test_http_error_returns_none() -> None:
    assert llm.ask("x", None, client=client(lambda r: httpx.Response(500))) is None


def test_bad_json_returns_none() -> None:
    assert llm.ask("x", None, client=client(lambda r: httpx.Response(200, text="nope"))) is None


def test_timeout_returns_none() -> None:
    def h(r):
        raise httpx.ReadTimeout("slow")

    assert llm.ask("x", None, client=client(h)) is None


def test_build_messages_includes_url_category_reasons_and_page_signals() -> None:
    context = {
        "level": "danger",
        "url": "http://bna-verificacion.xyz",
        "category": "suspicious_domain",
        "reasons": ["El sitio imita a un banco pero no es su dirección oficial."],
        "signals": [{"id": "urgency", "evidence": "suspendida"}],
        "page_signals": [{"id": "popups", "reason": "La página abre ventanas emergentes sin que hicieras clic."}],
    }
    messages = llm.build_messages("hola", context)
    payload = json.loads(messages[-1]["content"])
    assert payload["url"] == "http://bna-verificacion.xyz"
    assert payload["category"] == "suspicious_domain"
    assert payload["reasons"] == ["El sitio imita a un banco pero no es su dirección oficial."]
    assert payload["page_signals"] == [
        {"id": "popups", "reason": "La página abre ventanas emergentes sin que hicieras clic."}
    ]


def test_build_messages_includes_history_as_prior_turns() -> None:
    history = [
        {"role": "user", "text": "¿por qué es peligroso?"},
        {"role": "assistant", "text": "Porque te pide la clave."},
    ]
    messages = llm.build_messages("¿y ahora qué hago?", None, history)
    assert messages[1] == {"role": "user", "content": "¿por qué es peligroso?"}
    assert messages[2] == {"role": "assistant", "content": "Porque te pide la clave."}
    assert messages[-1]["role"] == "user"


def test_is_grounded_true_for_answer_using_only_evidence_words() -> None:
    context = {
        "level": "danger",
        "category": "suspicious_domain",
        "reasons": ["El sitio imita a un banco pero no es su dirección oficial."],
    }
    answer = "Este sitio imita a un Banco pero no es su dirección oficial. No ingreses tu clave ahí."
    assert llm.is_grounded(answer, context) is True


def test_is_grounded_false_for_hallucinated_brand_not_in_evidence() -> None:
    context = {"level": "safe", "reasons": []}
    answer = "Ayer encontré una oferta increíble, te recomiendo DirecTV para ver el partido."
    assert llm.is_grounded(answer, context) is False


def test_is_grounded_allows_known_global_and_official_brands() -> None:
    answer = "No compartas la clave de tu WhatsApp con nadie que te la pida."
    assert llm.is_grounded(answer, None) is True


def test_ask_falls_back_to_none_when_answer_is_not_grounded() -> None:
    context = {"level": "safe", "reasons": []}
    c = client(
        lambda req: httpx.Response(
            200, json={"message": {"content": "Te recomiendo DirecTV para ver el partido gratis."}}
        )
    )
    assert llm.ask("¿qué me recomendás?", context, client=c) is None


def test_ask_passes_history_and_context_through_to_ollama() -> None:
    seen: dict = {}

    def h(req):
        seen.update(json.loads(req.content))
        return httpx.Response(200, json={"message": {"content": "Dale, cuidate."}})

    history = [{"role": "user", "text": "hola"}, {"role": "assistant", "text": "hola, contame"}]
    context = {"level": "danger", "url": "http://x.xyz", "category": "malicious", "reasons": ["r1"]}
    llm.ask("¿sigo?", context, client=client(h), history=history)
    assert seen["messages"][1] == {"role": "user", "content": "hola"}
    assert seen["messages"][2] == {"role": "assistant", "content": "hola, contame"}
    payload = json.loads(seen["messages"][-1]["content"])
    assert payload["url"] == "http://x.xyz"
