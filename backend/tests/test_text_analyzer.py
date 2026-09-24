"""Tests for app.services.text_analyzer.analyze_text (Task 1 of the antiscam plan)."""

from __future__ import annotations

from app.services.text_analyzer import analyze_text

SCAM = (
    "URGENTE: Estimado cliente, tu cuenta de Mercado Pago será SUSPENDIDA. "
    "Ingresá tu clave en http://mercadopago-reintegros.com"
)


def ids(r):
    return {s.id for s in r.signals}


def test_classic_scam_is_danger(fake_model) -> None:
    r = analyze_text(SCAM, fake_model)
    assert r.level == "danger"
    assert {"urgency", "credential_request", "brand_mention", "suspicious_link", "impersonal_greeting"} <= ids(r)
    assert r.lessons and r.urls


def test_accents_and_case_do_not_matter(fake_model) -> None:
    a = analyze_text("tu cuenta sera suspendida, pasame el codigo", fake_model)
    b = analyze_text("TU CUENTA SERÁ SUSPENDIDA, PASAME EL CÓDIGO", fake_model)
    assert ids(a) == ids(b) == {"urgency", "credential_request"}


def test_single_weak_signal_never_danger(fake_model) -> None:
    assert analyze_text("¡Ganaste un sorteo!", fake_model).level != "danger"


def test_official_link_only_is_safe(fake_model) -> None:
    r = analyze_text("Mirá https://www.mercadopago.com.ar", fake_model)
    assert r.level == "safe" and "suspicious_link" not in ids(r)


def test_plain_message_is_safe(fake_model) -> None:
    r = analyze_text("Hola ma, llego a las 8 para la cena", fake_model)
    assert r.level == "safe" and r.signals == [] and r.category == "none"
