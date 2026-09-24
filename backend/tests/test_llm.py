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
