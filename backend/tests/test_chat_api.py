"""Tests for POST /api/chat (Task 2 of the antiscam plan)."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services import llm


@pytest.fixture
def client():
    with TestClient(app) as c:
        yield c


def test_chat_returns_answer_when_llm_succeeds(client, monkeypatch) -> None:
    monkeypatch.setattr(llm, "ask", lambda message, context, **kwargs: "hola")
    response = client.post("/api/chat", json={"message": "¿es seguro pagar con QR?"})
    assert response.status_code == 200
    assert response.json() == {"answer": "hola", "fallback": False}


def test_chat_returns_fallback_when_llm_returns_none(client, monkeypatch) -> None:
    monkeypatch.setattr(llm, "ask", lambda message, context, **kwargs: None)
    response = client.post("/api/chat", json={"message": "¿es seguro pagar con QR?"})
    assert response.status_code == 200
    assert response.json() == {"answer": None, "fallback": True}


@pytest.mark.parametrize("payload", [{"message": ""}, {"message": "   "}])
def test_chat_422_on_empty_message(client, payload) -> None:
    response = client.post("/api/chat", json=payload)
    assert response.status_code == 422


def test_chat_missing_message_field_is_422(client) -> None:
    response = client.post("/api/chat", json={})
    assert response.status_code == 422


def test_chat_accepts_full_context_and_history(client, monkeypatch) -> None:
    seen = {}

    def fake_ask(message, context, **kwargs):
        seen["context"] = context
        seen["history"] = kwargs.get("history")
        return "ok"

    monkeypatch.setattr(llm, "ask", fake_ask)
    response = client.post(
        "/api/chat",
        json={
            "message": "¿por qué es peligroso?",
            "context": {
                "level": "danger",
                "url": "http://bna-verificacion.xyz",
                "category": "suspicious_domain",
                "reasons": ["El sitio imita a un banco."],
                "page_signals": [{"id": "popups", "reason": "Abre ventanas solo."}],
            },
            "history": [
                {"role": "user", "text": "hola"},
                {"role": "assistant", "text": "hola, contame"},
            ],
        },
    )
    assert response.status_code == 200
    assert response.json() == {"answer": "ok", "fallback": False}
    assert seen["context"].url == "http://bna-verificacion.xyz"
    assert seen["history"][0].text == "hola"


def test_chat_reasons_over_limit_is_422(client) -> None:
    response = client.post(
        "/api/chat",
        json={"message": "hola", "context": {"reasons": ["r"] * 13}},
    )
    assert response.status_code == 422


def test_chat_history_over_limit_is_422(client) -> None:
    response = client.post(
        "/api/chat",
        json={"message": "hola", "history": [{"role": "user", "text": "hi"}] * 7},
    )
    assert response.status_code == 422
