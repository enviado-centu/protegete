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
- [x] T8 — Integrate teammate's `MODULO-PY/motor/` (whitelist JSON, own+feed blacklist, deterministic rules with readable reasons) as the primary rules/lists source. Backend `rules.py` keeps only signals the motor does not cover (no duplicated reasons, single whitelist). Read-only import; never modify `MODULO-PY/`. User authorized 2026-09-24 ("si conectalo"). Route: delegated (writer trigger: rules + analyzer + tests + README).
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

- T8 done: `MODULO-PY/motor/` (`listas.py` whitelist/blacklist, `reglas.py` deterministic rules) is now the primary source for lists and rules. New `app/services/motor_adapter.py` (lazy, same sys.path mechanism as `ml_model.py`) is the only module that imports `motor.*`, exposing `is_whitelisted(url)`, `blacklist_hit(url)`, `official_brands()`, `evaluate_signals(url)`.

  **Overlap map** (motor's `evaluar_reglas` id → our old rule):
  - `marca_host`/`marca_otro_tld`/`marca_path` (imitacion_marca) — **partial** overlap with our old `brand_embedded`/part of `brand_lookalike`: motor does exact-token, alias+"pegada"-word, and plain-substring matching (no homoglyph normalization, no edit distance). Mapped to our existing `brand_embedded` id (weights 0.85/0.75) plus a new weak `brand_mention` id (0.3, path-only — motor's own test suite uses an innocuous news-article mention as its example, so this must stay weak).
  - Homoglyph/Levenshtein typosquats (`mercad0pago.com.ar`, `ua1a.com.ar`) — **not covered** by motor at all (verified against `motor/reglas.py::_coincide`, which has no normalization/edit-distance step). Kept as our own `brand_lookalike`, but the brand catalog itself is now pulled from `motor_adapter.official_brands()` (no more hand-duplicated AR brand table) plus a small documented `GLOBAL_BRANDS` fallback (google, paypal, microsoft, apple, netflix, whatsapp, instagram, facebook — motor's whitelist is Argentina-scoped and has zero global-brand coverage; without this fallback `docs.google.com` loses its whitelist short-circuit, breaking an acceptance case).
  - `tld` / `palabra_1` / `palabra_2mas` — **equivalent** to our old `suspicious_tld`/`scam_keywords` (same underlying `TLDS_SOSPECHOSOS`/`PALABRAS_SOSPECHOSAS` lists from `features.py`). Removed our copies; motor's versions are exact-token-only (no substring matching for compounds without a separator — see "changed case" below).
  - `ip` / `punycode` / `acortador` — **equivalent** to our old `ip_host`/`punycode`/`shortener`; removed our copies, mapped motor's ids to the same names/weights/categories so the public `rules[].id` contract and `analyzer.py`'s shortener-ML-cap logic (keyed on id `"shortener"`) are unchanged.
  - `puerto` / `arroba` — **new** signals we had no equivalent for (explicit port, "@" hiding the real host). Mapped to new ids `explicit_port` (weak, 0.15) and `at_symbol` (0.6, `hidden_destination`).
  - Whitelist (`lista_blanca.json`) — **equivalent** to our old whitelist for the ~50 Argentine brands it carries; extended with the `GLOBAL_BRANDS` fallback above.
  - Blacklist (`lista_negra_propia.txt` + optional feed) — **new** capability we didn't have. Short-circuits to `danger`/score 1.0/category `blacklisted` (new category, documented), with a reason synthesized by us (`motor.listas.esta_en_lista_negra` returns structured data, not a ready-made phrase, unlike `reglas.py`). Works without the feed file (it's absent in this checkout; `tests/test_motor_adapter.py` proves it).
  - `insecure_http` — **not covered** by motor (no HTTP-vs-HTTPS rule); kept entirely on our side, unchanged.

  **Removed from `rules.py`**: the old hand-maintained `OFFICIAL_BRANDS` AR entries (mercadopago, mercadolibre, afip, arca, anses, argentina, bna, galicia, santander, bbva, macro, brubank, uala, naranjax — now sourced from motor), `_evaluate_suspicious_tld`, `_evaluate_scam_keywords`, `_evaluate_ip_host`, `_evaluate_punycode`, `_evaluate_shortener`, `_get_ml_lists()` (no longer needed). `_evaluate_brand_embedded` narrowed to `GLOBAL_BRANDS` only. `_evaluate_brand_lookalike` narrowed to fire only on homoglyph-normalized-exact or fuzzy-typo matches (a plain unmodified exact match is now always the motor's/`brand_embedded`'s job, avoiding a double reason for the same signal — verified against a hypothetical `mercadopagoo.com` overlap case during implementation).

  **Behavior changes / reported, not silently changed**:
  - `http://bna-homebanking-verificar.xyz/login` is a real entry in `motor/datos/lista_negra_propia.txt` (`dominio:bna-homebanking-verificar.xyz`), so it now short-circuits to a single `blacklisted` reason instead of the T5/T6-era 4-reason combo (`brand_embedded` + `suspicious_tld` + `scam_keywords` + `insecure_http`). Still `level: danger` (the only requirement this task's acceptance list places on this URL) — score is now 1.0 instead of ~1.0-via-combo. `tests/test_analyzer.py::test_weak_signals_reinforce_a_strong_rule` and `tests/test_analyze_api.py::test_brand_impersonation_plus_weak_signals_is_danger_with_all_reasons` were moved to `http://mercadopago-clave.xyz/login` to keep coverage of the "brand + weak signals combine" scenario on a non-blacklisted domain; a new `test_blacklisted_domain_is_danger` covers the blacklist short-circuit directly.
  - `http://mercadopago.xyz` (exact brand name, wrong TLD): now fires the motor's `marca_otro_tld` (mapped to `brand_embedded`, weight 0.75) instead of our old `brand_lookalike` (0.9). Both are `danger` (0.75 > 0.7 threshold, chosen deliberately for this). `tests/test_rules.py::test_wrong_tld_exact_label_fires` updated.
  - `https://example.com/verificaridentidad` (a scam keyword glued to another word with no separator): the motor's `palabras_enganio` only does exact-token matching (split on non-alphanumeric characters), unlike our old substring-for-long-keywords logic — this compound is no longer flagged. Not part of any acceptance criterion; documented as a known, accepted minor regression in `tests/test_rules.py::test_long_keyword_glued_without_separator_is_a_documented_motor_gap`.
  - New category value `blacklisted` added (documented above and in `backend/README.md`); existing categories (`impersonation`, `suspicious_domain`, `hidden_destination`, `insecure`, `none`) unchanged.

  **`details` block** (additive, `app/schemas.py::Details`): `{"blacklist": bool, "whitelist": bool, "ml_probability": float}`, populated in `analyzer.analyze()`.

  **Files**: new `app/services/motor_adapter.py`; rewritten `app/services/rules.py` (373 lines, was 362) and `app/services/analyzer.py` (blacklist handling + `details`); `app/schemas.py` (+`Details`); new `backend/tests/test_motor_adapter.py`; updated `backend/tests/{test_rules,test_analyzer,test_analyze_api}.py`; `backend/README.md` (motor as source, feed refresh instructions, `details` block, updated scoring section).

  **Tests**: `uv run pytest -q` → 98 passed (was 75; +23: 1 new `test_motor_adapter.py` module with 9 tests, plus new/changed cases in `test_rules.py`/`test_analyzer.py`/`test_analyze_api.py`).

  **Verified against the real model** (all required acceptance cases): `http://bna-homebanking-verificar.xyz/login` → danger/blacklisted/score 1.0; `https://www.bna.com.ar/verificar-identidad` → safe/score 0.055/whitelist=true; `mercad0pago.com.ar` → danger/impersonation/score 0.9 ("El dominio imita a Mercado Pago (mercadopago.com.ar)"); `bit.ly/x` → caution/hidden_destination/score 0.65; `sala.com.ar` → safe/score 0.096 (T4 regression still holds); a second blacklist entry (`mercadopago-reintegros.com`, own list) → danger/blacklisted/score 1.0. `git -C MODULO-PY status --porcelain` → only pre-existing `?? motor/` (no changes made to the read-only clone).

  **Nothing blocked.** T7 (team contract) is the only remaining item, still blocked on the pending team decision noted below.
  - Commit: pending (see report).

## Next step
Feature complete (T1-T6, T8 done, all acceptance criteria verified against the real model). T7 (team contract in README) remains blocked on the pending team decision (score scale, level vocabulary) — no further steps planned until that's resolved.
