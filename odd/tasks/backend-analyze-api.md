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
- [x] T4 — Fix: restrict `brand_lookalike` fuzzy (Levenshtein) matching to official labels ≥6 chars; short brands (bna/uala/macro) now require an exact post-homoglyph match. Route: direct (single-file fix + tests).
- [x] T5 — Weak-signal rules over the FULL URL (host + path + query): `suspicious_tld` and `scam_keywords`, reusing `TLDS_SOSPECHOSOS` / `PALABRAS_SOSPECHOSAS` imported from the ML module's `features.py` (no copies). Additive score only, never `danger` on their own; whitelist short-circuits first (`bna.com.ar/verificar-identidad` stays safe). Route: delegated (writer trigger: rules + analyzer + tests).
- [x] T6 — ML reason sentence emitted ONLY when the ML probability is at/above the threshold, cautious wording ("El análisis automático del dominio lo considera muy similar a sitios fraudulentos conocidos."). Route: delegated (same writer as T5).
- [ ] T7 — Team contract documented in README (keys `level/score/reasons/tip`, Node adds `explanation`, `details` block, one example per level). Blocked on team decision: score scale (0–1 vs 0–100) and level vocabulary. Route: pending.

Context (2026-09-24, team agreement): Node owns the Ollama/LLM step, the `explanation` field and its fallback (empty explanation → extension shows `reasons`). Python never knows about the LLM.

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
  - Resolved (T4): the open risk below was confirmed as a real false positive by parent review (`sala.com.ar` → `danger`/`impersonation`, Levenshtein 1 from "uala") and fixed as a defect, not left as a product decision. See T4 entry below.

- T3 done: `app/services/analyzer.py` (ensemble: ML-probability rescale, rule/ML combination with combo bonus, shortener ML cap, whitelist safe cap, category from strongest rule, deduped/capped Spanish reasons, per-category tip), `POST /api/analyze` wired in `app/main.py` with CORS (`allow_origin_regex` for `chrome-extension://*` / `localhost` / `127.0.0.1`, plus `EXTRA_CORS_ORIGINS`), URL validation (strip, empty, >2048 chars, no plausible host → 422) in `app/schemas.py`. `backend/README.md` added (setup, run, env vars, curl example with real captured output, scoring explanation, privacy note). Tests: `backend/tests/{test_analyzer,test_analyze_api}.py` (all acceptance-criteria cases, real-model integration). `uv run pytest -q`: 49 passed. Commit: 27bec8c `feat(backend): add analyze endpoint with ML+rules ensemble, CORS and README`.
- Manual verification: started `uv run uvicorn app.main:app --port 8765`, curled `/api/health` (`{"status":"ok","model_version":"4c"}`), `/api/analyze` for `mercad0pago.com.ar` (danger/impersonation), `bit.ly/x` (caution/hidden_destination), `docs.google.com/document` (safe/none), empty URL (422), and a CORS preflight from `chrome-extension://...` (200, `access-control-allow-origin` echoed). Server stopped afterward.

- T4 done (fix, not a product choice): parent review found a real false positive — `POST /api/analyze {"url":"sala.com.ar"}` returned `danger`/`impersonation` (Levenshtein 1 from brand "uala"). Fixed in `app/services/rules.py::_evaluate_brand_lookalike`: fuzzy (Levenshtein) matching now only applies when the official brand label is ≥6 chars (`FUZZY_MIN_LABEL_LENGTH`); labels shorter than that (bna, uala, macro, galicia's "galicia"=7 unaffected) require an exact match *after* homoglyph normalization only — homoglyph spoofs like `ua1a.com.ar` or `bn4.com.ar` still fire, plain short-word typos like `sala.com.ar`, `macra.com.ar`, `bma.com.ar` no longer do. Distance-scaling boundary also aligned to the parent's spec (`≤1` for 6–9 chars, `≤2` for ≥10; was previously `≤8`/`>8`, now `≤9`/`>9` — no behavior change for the existing `mercad0pago.com.ar`/`mercadopagoseguro.com`/`mercadopag.com.ar` cases).
  - Regression tests added: `tests/test_rules.py` (`sala.com.ar`, `macra.com.ar`, `bma.com.ar` → no `brand_lookalike`; `ua1a.com.ar` → `brand_lookalike` still fires; `mercadopag.com.ar` typo of a long brand still fires) and `tests/test_analyze_api.py` (`sala.com.ar` → not danger/impersonation; `ua1a.com.ar` → danger/impersonation).
  - `uv run pytest -q`: 54 passed.
  - Verified via `analyze()` directly against the real model: `sala.com.ar` → `{"level":"safe","score":0.096,"category":"none","rules":[]}`; `ua1a.com.ar` → `{"level":"danger","score":0.9,"category":"impersonation","rules":[{"id":"brand_lookalike","weight":0.9}]}`.
  - Commit: pending (see report).

- T5+T6 done: two weak full-URL rules added to `app/services/rules.py` — `suspicious_tld` (registrable domain's TLD in `TLDS_SOSPECHOSOS`, weight 0.25) and `scam_keywords` (any word from `PALABRAS_SOSPECHOSAS` found in host+path+query; exact-token match for keywords ≤5 chars, also substring match for ≥6 chars so unseparated compounds are caught while short words like "bank" can't false-positive inside "embankment"; reason lists up to 3 matched words). Both lists are imported lazily from the ML module's `features.py` via `_get_ml_lists()` (same sys.path mechanism as `ml_model.RealPhishingModel`, no copies). Both new rules run inside the existing `if not is_whitelisted(info):` block in `evaluate_rules`, so they're skipped for whitelisted domains exactly like the brand rules (`bna.com.ar/verificar-identidad` fires none of them despite "verificar" being a scam keyword).
  - `app/services/analyzer.py`: `WEAK_RULE_IDS = {suspicious_tld, scam_keywords, insecure_http}` and `WEAK_RULES_ONLY_SCORE_CAP = 0.6` — when every fired rule is weak AND the rescaled ML score hasn't independently reached the danger boundary (0.7) on its own, the combined rule+bonus score is capped at 0.6 (comfortably below "danger"). The ML score itself is never capped, so a genuinely high, independent ML probability still reaches "danger" even if a weak rule also happens to fire (verified: real model flags plain `.xyz` domains like `example.xyz/login` at ~0.98 independently of any rule — that's legitimate ML-driven danger, not something T5's cap should or does suppress).
  - T6: `_build_reasons` now also takes `ml_flagged` (== `prediction.flagged`, the model's own probability≥threshold semantics) and appends `ML_FLAGGED_REASON` ("El análisis automático del dominio lo considera muy similar a sitios fraudulentos conocidos.") only when flagged AND the level isn't `safe` (avoids a contradictory sentence on a whitelist-forced-safe verdict, e.g. `docs.google.com`, which the real model does flag on its own).
  - Tests added: `tests/test_rules.py` (`TestSuspiciousTld`, `TestScamKeywords` — path-only match, hyphen-compound multi-word match, 3-word cap, short-keyword-not-substring, long-keyword-substring-without-separator, whitelist short-circuit for both), `tests/test_analyzer.py` (weak-only never danger, weak+strong reinforce, independent high ML not suppressed, a fake-model regression proving the cap prevents the combo bonus from tipping a near-threshold ML score into danger, `TestMlFlaggedReason` for above/below/whitelisted-safe), `tests/test_analyze_api.py` (brand+weak-signals combo with all 4 expected reason sentences, weak-signals-only not danger using a real-model-verified example, `bna.com.ar/verificar-identidad` safe with zero rules, `sala.com.ar` regression still not danger/impersonation).
  - `uv run pytest -q`: 75 passed.
  - Verified via `analyze()` directly against the real model (acceptance URLs): `bna-homebanking-verificar.xyz/login` → danger/impersonation/score 1.0, reasons = [brand_embedded, .xyz, "homebanking, login, verificar", HTTP inseguro] (exactly the 4 required, capped before the ML sentence); `example.xyz/login` → danger (ML-independent, ~0.98 probability, includes the ML sentence); `bna.com.ar/verificar-identidad` → safe/score 0.055/no rules; `mercad0pago.com.ar` and `mercadopagoseguro.com` → danger/impersonation (unchanged); `mercadopago.com.ar`/`docs.google.com` → safe; `bit.ly/x` → caution/hidden_destination (now also carries the ML sentence since the real model flags it); `sala.com.ar` → safe (T4 regression still holds).
  - README `backend/README.md` scoring section: added a 6th line documenting the two new rules and the cap/threshold behavior; contract section untouched.
  - Commit: pending (see report).

## Next step
Feature complete (T1-T6 done, all acceptance criteria verified against the real model). T7 (team contract in README) remains blocked on the pending team decision (score scale, level vocabulary) — no further steps planned until that's resolved.
