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
