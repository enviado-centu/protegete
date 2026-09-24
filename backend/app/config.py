"""Runtime configuration for the backend, resolved from environment variables."""

from __future__ import annotations

import os
from pathlib import Path

_APP_DIR = Path(__file__).resolve().parent
_REPO_ROOT = _APP_DIR.parent.parent

DEFAULT_ML_MODULE_PATH = _REPO_ROOT / "MODULO-PY"


def get_ml_module_path() -> Path:
    """Filesystem path to the ML module folder (predict.py, features.py, models/).

    Configurable via the ML_MODULE_PATH env var; defaults to the sibling
    MODULO-PY folder at the repo root, resolved
    relative to this file so it works regardless of the process cwd.
    """
    raw = os.environ.get("ML_MODULE_PATH")
    return Path(raw).resolve() if raw else DEFAULT_ML_MODULE_PATH


def get_extra_cors_origins() -> list[str]:
    """Additional allowed CORS origins from the EXTRA_CORS_ORIGINS env var.

    Comma-separated list, e.g. "https://example.com,https://foo.bar".
    """
    raw = os.environ.get("EXTRA_CORS_ORIGINS", "")
    return [origin.strip() for origin in raw.split(",") if origin.strip()]
