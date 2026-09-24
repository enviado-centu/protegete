"""Tests for the ML adapter: the fake model contract and the real model integration."""

from __future__ import annotations

from app.services import ml_model
from app.services.ml_model import RealPhishingModel


def test_fake_model_implements_prediction_contract(fake_model) -> None:
    fake_model._probability = 0.974
    fake_model._top_features = ["cant_guiones"]
    prediction = fake_model.predict("http://example.com")
    assert prediction.probability == 0.974
    assert prediction.threshold == 0.9
    assert prediction.flagged is True
    assert prediction.top_features == ["cant_guiones"]


def test_get_model_returns_cached_singleton() -> None:
    ml_model.set_model(None)
    try:
        first = ml_model.get_model()
        second = ml_model.get_model()
        assert first is second
    finally:
        ml_model.set_model(None)


def test_real_model_scores_known_phishing_domain() -> None:
    """Integration test against the actual trained model (read-only import)."""
    model = RealPhishingModel()
    prediction = model.predict("http://afip-clave-fiscal.online")
    assert prediction.probability > 0.9
    assert prediction.flagged is True
    assert prediction.threshold == 0.9


def test_real_model_scores_known_legit_domain() -> None:
    model = RealPhishingModel()
    prediction = model.predict("https://bna.com.ar")
    assert prediction.probability < 0.5
    assert prediction.flagged is False


def test_real_model_exposes_version() -> None:
    model = RealPhishingModel()
    assert model.version == "4c"
