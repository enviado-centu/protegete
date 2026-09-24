# Feature: antiscam-chat-pwa-extension

Objective, scope, constraints and task details: see spec `docs/superpowers/specs/2026-09-24-antiscam-chat-pwa-extension-design.md` and plan `docs/superpowers/plans/2026-09-24-antiscam-chat-pwa-extension.md` (single source; not duplicated here).

Authorized by user 2026-09-24 (spec + plan approved, parallel execution approved). Deadline: hackathon close ~9 h from 20:00 ART.

## Tasks
- [x] T1 — Backend lessons + /api/analyze-text. Route: delegated writer (main tree).
- [x] T2 — Backend /api/chat (Ollama nemotron cloud) + README contract. Route: delegated writer (same as T1).
- [ ] T3 — Frontend core + PWA. Route: delegated writer in isolated git worktree (parallel with T1–T2).
- [ ] T4 — E2E smoke PWA vs real backend. Route: delegated.
- [ ] T5 — Chromium MV3 extension + metrics. Route: delegated.
- [ ] T6 — DEMO.md + final verification. Route: delegated/inline.

## TDD
Plan prescribes failing-test-first per task (pytest / vitest).

## Delivery
Branch feat/backend-analyze-api, no push. RDD disabled by user.

## Progress / Evidence

### T1 — Backend lessons + /api/analyze-text (done)
- Failing tests observed first: `uv run pytest tests/test_text_analyzer.py tests/test_lessons.py tests/test_analyze_text_api.py -q` → 2 collection errors (`ModuleNotFoundError: app.services.text_analyzer` / `app.services.lessons`).
- Implemented `backend/app/services/lessons.py` (10 lessons, ids exactly per plan), `backend/app/services/text_analyzer.py` (accent/case-insensitive signal matching via NFKD + index map, URL extraction regex, weights/category/score per plan), `AnalyzeTextRequest/Signal/AnalyzeTextResponse` in `backend/app/schemas.py`, routes `GET /api/lessons` / `POST /api/analyze-text` in `backend/app/main.py`.
- `uv run pytest tests/test_text_analyzer.py tests/test_lessons.py tests/test_analyze_text_api.py -q`: 15 passed.
- `cd backend && uv run pytest -q`: 113 passed (98 prior + 15 new).
- Commit: `ec3ccf6` `feat(backend): add message analysis and red-flag lesson catalog`.

### T2 — Backend /api/chat + README contract (done)
- Failing tests observed first: `uv run pytest tests/test_llm.py tests/test_chat_api.py -q` → 2 collection errors (`ImportError: cannot import name 'llm'`).
- Implemented `backend/app/services/llm.py` (`build_messages`, `ask`, Spanish grounded system prompt, `think: false`/`stream: false`, error/timeout → `None`), Ollama env getters in `backend/app/config.py`, `ChatContext/ChatRequest/ChatResponse` in `backend/app/schemas.py`, route `POST /api/chat` in `backend/app/main.py`, full contract + env vars + Ollama privacy note in `backend/README.md` (all examples verified via `TestClient`, real output pasted).
- `uv run pytest tests/test_llm.py tests/test_chat_api.py -q`: 10 passed.
- `cd backend && uv run pytest -q`: 123 passed (113 prior + 10 new).
- Live smoke (`uv run python -c "from app.services.llm import ask; print(ask('¿Cómo reconozco un mensaje falso del banco?', None))"` equivalent, with timing): Ollama reachable at `http://localhost:11434`, model `nemotron-3-nano:30b-cloud` available; `think: false` accepted (no error). Real answer returned in ~3.3-4.4s (well under the 8s `OLLAMA_TIMEOUT_S`), e.g.: "Si te mandan 'Estimado cliente' o un saludo genérico, es sospechoso... abrí tu app bancaria directamente o llamá al banco." No fallback needed.
- Live `/api/chat` via `TestClient` with a danger context (`credential_request` + `urgency` signals): HTTP 200, `fallback: false`, grounded Spanish answer referencing not sharing the clave and verifying via official channels, ~3.25s.
- Commit: `304bc21` `feat(backend): add grounded LLM chat endpoint with fallback`.

Deviations from plan interfaces: none.
