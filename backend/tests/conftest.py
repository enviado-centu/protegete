"""Shared pytest fixtures."""

from __future__ import annotations

import pytest

from app.services import ml_model
from app.services.ml_model import MLPrediction


class FakePhishingModel:
    """In-memory stand-in for PhishingModel, used by tests that don't need the real model."""

    def __init__(self, probability: float = 0.0, top_features: list[str] | None = None) -> None:
        self._probability = probability
        self._top_features = top_features or []
        self.calls: list[str] = []

    def predict(self, url: str) -> MLPrediction:
        self.calls.append(url)
        return MLPrediction(
            probability=self._probability,
            threshold=0.9,
            flagged=self._probability >= 0.9,
            top_features=self._top_features,
        )

    @property
    def version(self) -> str | None:
        return "fake-1"


@pytest.fixture
def fake_model() -> FakePhishingModel:
    return FakePhishingModel()


@pytest.fixture
def use_fake_model(fake_model: FakePhishingModel):
    """Installs a fake model as the process-wide singleton for the duration of a test."""
    ml_model.set_model(fake_model)
    yield fake_model
    ml_model.set_model(None)
