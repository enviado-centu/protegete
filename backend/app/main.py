"""FastAPI application entrypoint."""

from __future__ import annotations

from contextlib import asynccontextmanager
from typing import AsyncIterator

from fastapi import FastAPI

from app.schemas import HealthResponse
from app.services.ml_model import get_model


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    # Load the ML model once at startup, not on every request.
    get_model()
    yield


app = FastAPI(title="Phishing Link Analyzer API", lifespan=lifespan)


@app.get("/api/health", response_model=HealthResponse)
def health() -> HealthResponse:
    model = get_model()
    return HealthResponse(status="ok", model_version=model.version)
