"""Pydantic request/response models for the public API."""

from __future__ import annotations

from pydantic import BaseModel, Field, field_validator

from app.services.lessons import Lesson
from app.services.urlinfo import has_plausible_host

MAX_URL_LENGTH = 2048
MAX_TEXT_LENGTH = 5000
MAX_CHAT_MESSAGE_LENGTH = 2000


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


class Details(BaseModel):
    """T8: additional machine-readable detail, additive to the base contract.

    `ml_probability` mirrors `ml.probability` (kept here too so a client can
    read the raw model score without digging into the `ml` sub-object).

    `reputation` (additive): the optional Google Safe Browsing v4 Lookup
    result -- `"flagged"` (Google has it as malware/phishing/etc.),
    `"clean"` (checked, no match) or `"unavailable"` (no API key
    configured, or the lookup failed/timed out). See
    `app/services/reputation.py`.
    """

    blacklist: bool
    whitelist: bool
    ml_probability: float
    reputation: str


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
    details: Details


class HealthResponse(BaseModel):
    """Body of the GET /api/health response."""

    status: str
    model_version: str | None = None


class AnalyzeTextRequest(BaseModel):
    """Body of POST /api/analyze-text."""

    text: str = Field(..., min_length=1, max_length=MAX_TEXT_LENGTH)

    @field_validator("text")
    @classmethod
    def _validate_text(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("text must not be blank")
        return value


class Signal(BaseModel):
    """One red-flag signal fired by the text analyzer."""

    id: str
    evidence: str


class AnalyzeTextResponse(BaseModel):
    """Body of the POST /api/analyze-text response."""

    level: str
    score: float
    category: str
    reasons: list[str]
    tip: str
    signals: list[Signal]
    lessons: list[Lesson]
    urls: list[AnalyzeResponse]


class PageSignals(BaseModel):
    """Page-behavior signals collected by extension content scripts.

    Booleans/counts only -- content scripts never send page content or
    other page text, and this data is never logged (see the privacy note on
    the `/api/analyze-page` route in `app/main.py`). All fields are optional
    with safe (inert) defaults and bounded to reject pathological payloads.
    """

    malvertising: list[str] = Field(default_factory=list, max_length=50)
    cryptominer: bool = False
    obfuscated_js: int = Field(default=0, ge=0, le=1000)
    hidden_iframes: int = Field(default=0, ge=0, le=1000)
    insecure_password_form: bool = False
    cross_site_password_form: bool = False
    notification_prompt: bool = False
    popups: int = Field(default=0, ge=0, le=1000)
    offsite_meta_refresh: bool = False
    third_party_domains: int = Field(default=0, ge=0, le=1000)
    tracker_cookies: int = Field(default=0, ge=0, le=1000)


class PageSignal(BaseModel):
    """One page-behavior red flag surfaced back to the client (scoring or info-only)."""

    id: str
    reason: str


class AnalyzePageRequest(BaseModel):
    """Body of POST /api/analyze-page."""

    url: str = Field(..., min_length=1, max_length=MAX_URL_LENGTH)
    signals: PageSignals = Field(default_factory=PageSignals)

    @field_validator("url")
    @classmethod
    def _validate_url(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError("url must not be empty")
        if not has_plausible_host(stripped):
            raise ValueError("url must have a plausible host")
        return stripped


class AnalyzePageResponse(AnalyzeResponse):
    """Body of the POST /api/analyze-page response.

    Extends AnalyzeResponse with the page-level signals that fired (scoring
    and info-only) and the lessons they map to.
    """

    page_signals: list[PageSignal]
    lessons: list[Lesson]


class ChatContext(BaseModel):
    """Verified verdict context passed alongside a chat question, if any."""

    level: str | None = None
    signals: list[Signal] = Field(default_factory=list)


class ChatRequest(BaseModel):
    """Body of POST /api/chat."""

    message: str = Field(..., min_length=1, max_length=MAX_CHAT_MESSAGE_LENGTH)
    context: ChatContext | None = None

    @field_validator("message")
    @classmethod
    def _validate_message(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("message must not be blank")
        return value


class ChatResponse(BaseModel):
    """Body of the POST /api/chat response."""

    answer: str | None
    fallback: bool
