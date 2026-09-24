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
- [x] T2 — Rules engine (brands AR, homoglyph/Levenshtein lookalikes, brand-in-subdomain, shortener, IP, http), tests. Route: delegated.
- [x] T3 — `POST /api/analyze` ensemble + Spanish explanations + CORS + README, tests. Route: delegated.

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
- T1 done: `backend/` uv project scaffolded (`app/config.py`, `app/schemas.py`, `app/services/ml_model.py` adapter over `predict.predecir`, `app/main.py` with lifespan-loaded model + `GET /api/health`). Tests: `backend/tests/{conftest,test_ml_model,test_health}.py`. `uv run pytest -q`: 6 passed. Commit: a75b675 `feat(backend): scaffold FastAPI app with ML adapter and health endpoint`.
- T2 done: `app/services/urlinfo.py` (shared URL parsing: scheme, host, registrable domain, subdomain, IP detection) and `app/services/rules.py` (AR + global brand table, homoglyph normalization, Levenshtein, whitelist, `brand_lookalike`, `brand_embedded`, `shortener`, `ip_host`, `punycode`, `insecure_http`). Tests: `backend/tests/test_rules.py` (homoglyph, Levenshtein, whitelist, all 6 rules, short-brand token-vs-substring guard). `uv run pytest -q`: 29 passed.
  - Design note: `brand_lookalike` only accepts an exact (distance-0) label match on the registrable domain's own label (e.g. wrong-TLD squatting `mercadopago.xyz`) or on a homoglyph/typo-modified subdomain label; an *unmodified* exact brand name placed in the subdomain (e.g. `mercadopago.login-seguro.xyz`) is left to `brand_embedded`, matching the spec's own example.
  - Open risk (not covered by acceptance tests, flagging for awareness): Levenshtein threshold 1 on short official labels (e.g. "uala", 4 chars) can false-positive on unrelated short words of edit-distance 1 (e.g. hypothetical "sala.com.ar"). Left as-is per the literal spec ("scale by length"); would need a product decision to tighten further (e.g. minimum label length for fuzzy matching).

- T3 done: `app/services/analyzer.py` (ensemble: ML-probability rescale, rule/ML combination with combo bonus, shortener ML cap, whitelist safe cap, category from strongest rule, deduped/capped Spanish reasons, per-category tip), `POST /api/analyze` wired in `app/main.py` with CORS (`allow_origin_regex` for `chrome-extension://*` / `localhost` / `127.0.0.1`, plus `EXTRA_CORS_ORIGINS`), URL validation (strip, empty, >2048 chars, no plausible host → 422) in `app/schemas.py`. `backend/README.md` added (setup, run, env vars, curl example with real captured output, scoring explanation, privacy note). Tests: `backend/tests/{test_analyzer,test_analyze_api}.py` (all acceptance-criteria cases, real-model integration). `uv run pytest -q`: 49 passed. Commit: pending (see next command).
- Manual verification: started `uv run uvicorn app.main:app --port 8765`, curled `/api/health` (`{"status":"ok","model_version":"4c"}`), `/api/analyze` for `mercad0pago.com.ar` (danger/impersonation), `bit.ly/x` (caution/hidden_destination), `docs.google.com/document` (safe/none), empty URL (422), and a CORS preflight from `chrome-extension://...` (200, `access-control-allow-origin` echoed). Server stopped afterward.

## Next step
Feature complete (T1-T3 done, all acceptance criteria verified). No further steps planned; open decision gaps noted above (short-brand Levenshtein fuzzy-match risk in `brand_lookalike`) are left for a future product decision, not blocking.
