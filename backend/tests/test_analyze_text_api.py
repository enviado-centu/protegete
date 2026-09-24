"""Tests for POST /api/analyze-text and GET /api/lessons (Task 1 of the antiscam plan)."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.main import app

SCAM = (
    "URGENTE: Estimado cliente, tu cuenta de Mercado Pago será SUSPENDIDA. "
    "Ingresá tu clave en http://mercadopago-reintegros.com"
)


@pytest.fixture
def client():
    with TestClient(app) as c:
        yield c


def test_analyze_text_200_on_scam(client) -> None:
    response = client.post("/api/analyze-text", json={"text": SCAM})
    assert response.status_code == 200
    body = response.json()
    assert body["level"] == "danger"
    assert body["signals"]
    assert body["lessons"]
    assert body["urls"]


@pytest.mark.parametrize("text", ["", "   ", "x" * 5001])
def test_analyze_text_422_on_invalid(client, text) -> None:
    response = client.post("/api/analyze-text", json={"text": text})
    assert response.status_code == 422


def test_get_lessons_returns_at_least_ten(client) -> None:
    response = client.get("/api/lessons")
    assert response.status_code == 200
    body = response.json()
    assert isinstance(body, list)
    assert len(body) >= 10
