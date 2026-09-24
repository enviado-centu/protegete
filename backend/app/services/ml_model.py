"""Adapter around the team's trained phishing ML module.

Wraps `predict.predecir` from MODULO-PY-modelo-ml behind a small interface
(`PhishingModel`) so the rest of the backend, and its tests, can depend on
that interface instead of importing the external module directly. The real
module is read-only: never modify anything under MODULO-PY-modelo-ml/.
"""

from __future__ import annotations

import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

from app.config import get_ml_module_path


@dataclass(frozen=True)
class MLPrediction:
    """Result of scoring a single URL with the ML model."""

    probability: float
    threshold: float
    flagged: bool
    top_features: list[str]


class PhishingModel(Protocol):
    """Interface implemented by any phishing-scoring backend (real or fake)."""

    def predict(self, url: str) -> MLPrediction:
        """Scores a URL and returns an MLPrediction."""
        ...

    @property
    def version(self) -> str | None:
        """Model version identifier, if the underlying module exposes one."""
        ...


class RealPhishingModel:
    """Loads the trained model from MODULO-PY-modelo-ml on first use, then caches it.

    The ML module's predict.py loads its joblib model at import time and
    expects its own folder on sys.path (it does `from features import ...`).
    We insert that folder into sys.path lazily, on first prediction, so
    importing this adapter module never has a side effect on its own.
    """

    def __init__(self, module_path: Path | None = None) -> None:
        self._module_path = module_path or get_ml_module_path()
        self._predecir = None
        self._version: str | None = None

    def _ensure_loaded(self) -> None:
        if self._predecir is not None:
            return
        module_path_str = str(self._module_path)
        if module_path_str not in sys.path:
            sys.path.insert(0, module_path_str)
        import predict

        self._predecir = predict.predecir
        metadata = getattr(predict, "METADATOS", {}) or {}
        self._version = metadata.get("version")

    def predict(self, url: str) -> MLPrediction:
        self._ensure_loaded()
        assert self._predecir is not None
        raw = self._predecir(url)
        top_features = [f["feature"] for f in raw["features_principales"]]
        return MLPrediction(
            probability=raw["probabilidad"],
            threshold=raw["umbral"],
            flagged=raw["es_sospechoso"],
            top_features=top_features,
        )

    @property
    def version(self) -> str | None:
        self._ensure_loaded()
        return self._version


_model_instance: PhishingModel | None = None


def get_model() -> PhishingModel:
    """Returns the process-wide cached model instance, loading it on first call."""
    global _model_instance
    if _model_instance is None:
        _model_instance = RealPhishingModel()
    return _model_instance


def set_model(model: PhishingModel | None) -> None:
    """Overrides the cached model instance. Used by tests to inject a fake model."""
    global _model_instance
    _model_instance = model
