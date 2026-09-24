# Feature: backend-analyze-api

## Objective
FastAPI backend that receives a URL from a client (browser extension / PWA), runs it through the team's trained phishing model plus deterministic rules, and returns a user-facing verdict with explained reasons.

## Problem / Why
The ML module (`MODULO-PY-modelo-ml/MODULO-PY-modelo-ml`, `predict.predecir(url)`) works, but:
- no HTTP interface exists for the clients;
- its recall at the 0.90 threshold is ~22%, and it misses Argentine brand impersonation (homoglyphs like `mercad0pago.com.ar`, concatenations like `mercadopagoseguro.com`) because `MARCAS_OFICIALES` has no Argentine brands;
- `features_principales` are technical names, not user-facing explanations.

## Scope (authorized)
- New `backend/` folder (uv project, Python 3.13) at repo root.
- Import the ML module read-only via a configurable path. Do NOT modify files under `MODULO-PY-modelo-ml/`.
- Endpoints: `GET /api/health`, `POST /api/analyze` (URL input).
- Rules engine for Argentine brand impersonation, homoglyphs, shorteners, IP hosts, plain HTTP.
- Ensemble ML + rules → level / score / category / reasons / tip (Spanish user-facing text).
- CORS for browser-extension and localhost origins.
- Tests (pytest) and a short README with run instructions.

## Out of scope
Text/message analysis, OCR, `/api/chat`, persistence, auth, deploy.

## Constraints
- No storage of analyzed URLs; logs must not include request content.
- scikit-learn pinned to 1.9.1 (model pickle version).
- Code identifiers and comments in English; user-facing strings in Spanish (Argentine users; ML module outputs are Spanish).

## API contract
`POST /api/analyze` request: `{ "url": "https://..." }`
Response:
```json
{
  "url": "http://mercad0pago.com.ar",
  "level": "danger",
  "score": 0.93,
  "category": "impersonation",
  "reasons": ["El dominio imita a Mercado Pago (mercadopago.com.ar)"],
  "tip": "Entrá siempre escribiendo la dirección oficial, no desde links.",
  "ml": { "probability": 0.504, "threshold": 0.9, "flagged": false, "top_features": ["longitud_dominio"] },
  "rules": [{ "id": "brand_lookalike", "weight": 0.9 }]
}
```
- `level`: `safe` (<0.4) | `caution` (0.4–0.7) | `danger` (>0.7)
- `category`: `impersonation` | `suspicious_domain` | `hidden_destination` | `insecure` | `none`

## Tasks
- [x] T1 — Scaffold `backend/` uv project, ML adapter wrapping `predecir`, `GET /api/health`, tests. Route: delegated (writer trigger: 2+ non-trivial files).
- [ ] T2 — Rules engine (brands AR, homoglyph/Levenshtein lookalikes, brand-in-subdomain, shortener, IP, http), tests. Route: delegated.
- [ ] T3 — `POST /api/analyze` ensemble + Spanish explanations + CORS + README, tests. Route: delegated.

## Acceptance criteria
- `mercad0pago.com.ar` and `mercadopagoseguro.com` → `danger`, category `impersonation`.
- `https://www.mercadopago.com.ar`, `https://www.bna.com.ar`, `https://docs.google.com/document` → `safe`.
- `https://bit.ly/x` → `caution` (`hidden_destination`), not `danger`.
- Invalid/empty URL → HTTP 422.
- All tests pass.

## Checks
- `cd backend && uv run pytest -q`
- Manual: `uv run uvicorn app.main:app --port 8000` + POST sample.

## TDD
Mode: not configured (no project/session TDD setting) → ordinary functional checks with pytest.

## Delivery
Strategy: ask-on-risk. Forecast ~450 authored lines. RDD: disabled globally by user.

## Progress / Evidence
- T1 done: `backend/` uv project scaffolded (`app/config.py`, `app/schemas.py`, `app/services/ml_model.py` adapter over `predict.predecir`, `app/main.py` with lifespan-loaded model + `GET /api/health`). Tests: `backend/tests/{conftest,test_ml_model,test_health}.py`. `uv run pytest -q`: 6 passed. Commit: pending (see next command).

## Next step
T2 — rules engine.
