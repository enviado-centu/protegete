"""FastAPI application entrypoint."""

from __future__ import annotations

from contextlib import asynccontextmanager
from typing import AsyncIterator

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_extra_cors_origins
from app.schemas import AnalyzeRequest, AnalyzeResponse, HealthResponse
from app.services.analyzer import analyze
from app.services.ml_model import get_model

# Browser-extension origins are opaque per-install IDs, and local dev servers
# use arbitrary ports, so both need a regex rather than a fixed origin list.
CORS_ORIGIN_REGEX = r"^(chrome-extension://.*|http://localhost(:\d+)?|http://127\.0\.0\.1(:\d+)?)$"


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    # Load the ML model once at startup, not on every request.
    get_model()
    yield


app = FastAPI(title="Phishing Link Analyzer API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=CORS_ORIGIN_REGEX,
    allow_origins=get_extra_cors_origins(),
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


@app.get("/api/health", response_model=HealthResponse)
def health() -> HealthResponse:
    model = get_model()
    return HealthResponse(status="ok", model_version=model.version)


@app.post("/api/analyze", response_model=AnalyzeResponse)
def analyze_url(payload: AnalyzeRequest) -> AnalyzeResponse:
    # Privacy: the analyzed URL is never logged or persisted anywhere.
    model = get_model()
    return analyze(payload.url, model)
