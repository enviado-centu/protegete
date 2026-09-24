# Feature: antiscam-chat-pwa-extension

Objective, scope, constraints and task details: see spec `docs/superpowers/specs/2026-09-24-antiscam-chat-pwa-extension-design.md` and plan `docs/superpowers/plans/2026-09-24-antiscam-chat-pwa-extension.md` (single source; not duplicated here).

Authorized by user 2026-09-24 (spec + plan approved, parallel execution approved). Deadline: hackathon close ~9 h from 20:00 ART.

## Tasks
- [ ] T1 — Backend lessons + /api/analyze-text. Route: delegated writer (main tree).
- [ ] T2 — Backend /api/chat (Ollama nemotron cloud) + README contract. Route: delegated writer (same as T1).
- [ ] T3 — Frontend core + PWA. Route: delegated writer in isolated git worktree (parallel with T1–T2).
- [ ] T4 — E2E smoke PWA vs real backend. Route: delegated.
- [ ] T5 — Chromium MV3 extension + metrics. Route: delegated.
- [ ] T6 — DEMO.md + final verification. Route: delegated/inline.

## TDD
Plan prescribes failing-test-first per task (pytest / vitest).

## Delivery
Branch feat/backend-analyze-api, no push. RDD disabled by user.

## Progress / Evidence
(pending)
