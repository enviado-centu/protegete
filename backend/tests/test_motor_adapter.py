"""Tests for the lazy adapter around MODULO-PY/motor (T8)."""

from __future__ import annotations

from pathlib import Path

from app.services import motor_adapter


def test_is_whitelisted_for_an_official_domain() -> None:
    assert motor_adapter.is_whitelisted("https://www.bna.com.ar/personas") is True


def test_is_whitelisted_false_for_a_lookalike() -> None:
    assert motor_adapter.is_whitelisted("https://mercad0pago.com.ar") is False


def test_blacklist_hit_for_a_domain_entry() -> None:
    hit = motor_adapter.blacklist_hit("http://bna-homebanking-verificar.xyz/login")
    assert hit is not None
    assert hit.kind == "dominio"
    assert hit.match == "bna-homebanking-verificar.xyz"


def test_blacklist_hit_none_for_a_clean_url() -> None:
    assert motor_adapter.blacklist_hit("https://example.com") is None


def test_official_brands_include_bna_and_mercadopago() -> None:
    brands = {b.id: b for b in motor_adapter.official_brands()}
    assert "bna" in brands
    assert brands["bna"].domains == ("bna.com.ar",)
    assert "mercadopago" in brands
    assert "mercadopago.com.ar" in brands["mercadopago"].domains


def test_evaluate_signals_returns_ready_made_spanish_reasons() -> None:
    signals = motor_adapter.evaluate_signals("http://sitio.xyz")
    assert any(s.id == "tld" and "xyz" in s.reason for s in signals)


def test_evaluate_signals_never_raises_on_malformed_urls() -> None:
    for url in ("", "   ", "http://[::1", "http://sitio.com:abc/"):
        assert isinstance(motor_adapter.evaluate_signals(url), tuple)


def test_blacklist_works_without_the_optional_feed_file(monkeypatch) -> None:
    """The motor's OpenPhish feed (lista_negra_feed.txt) is gitignored and may
    not exist on disk (it doesn't, in this checkout). Blacklist lookups must
    still work off the "own" list alone -- verified here by pointing the
    motor at a feed path that is guaranteed not to exist, then confirming a
    known "own list" entry still matches.
    """
    motor_adapter._ensure_loaded()
    motor_listas = motor_adapter._motor_listas
    assert motor_listas is not None

    original_feed_path = motor_listas.RUTA_LISTA_NEGRA_FEED
    missing_path = original_feed_path.parent / "definitely_does_not_exist.txt"
    assert not missing_path.exists()

    monkeypatch.setattr(motor_listas, "RUTA_LISTA_NEGRA_FEED", missing_path)
    motor_listas.recargar()
    try:
        hit = motor_adapter.blacklist_hit("http://bna-homebanking-verificar.xyz/login")
        assert hit is not None
        assert hit.kind == "dominio"
    finally:
        motor_listas.recargar()  # restore caches built off the real feed path


def test_feed_file_is_absent_in_this_checkout() -> None:
    """Sanity check that the scenario above reflects the real environment:
    MODULO-PY/motor/datos/lista_negra_feed.txt is gitignored and not
    downloaded by default (see motor/actualizar_lista_negra.py), so the
    backend must -- and does -- work without it.
    """
    from app.config import get_ml_module_path

    feed_path = get_ml_module_path() / "motor" / "datos" / "lista_negra_feed.txt"
    assert not Path(feed_path).exists()
