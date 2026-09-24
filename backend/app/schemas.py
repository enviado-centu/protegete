"""Pydantic request/response models for the public API."""

from __future__ import annotations

from pydantic import BaseModel, Field, field_validator

from app.services.urlinfo import has_plausible_host

MAX_URL_LENGTH = 2048


class AnalyzeRequest(BaseModel):
    """Body of POST /api/analyze."""

    url: str = Field(..., min_length=1, max_length=MAX_URL_LENGTH)

    @field_validator("url")
    @classmethod
    def _validate_url(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError("url must not be empty")
        if not has_plausible_host(stripped):
            raise ValueError("url must have a plausible host")
        return stripped


class MLInfo(BaseModel):
    """ML model contribution to the verdict."""

    probability: float
    threshold: float
    flagged: bool
    top_features: list[str]


class RuleHit(BaseModel):
    """One rule that fired during analysis."""

    id: str
    weight: float


class AnalyzeResponse(BaseModel):
    """Body of the POST /api/analyze response."""

    url: str
    level: str
    score: float
    category: str
    reasons: list[str]
    tip: str
    ml: MLInfo
    rules: list[RuleHit]


class HealthResponse(BaseModel):
    """Body of the GET /api/health response."""

    status: str
    model_version: str | None = None
