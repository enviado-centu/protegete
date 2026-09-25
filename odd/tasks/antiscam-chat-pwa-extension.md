# Feature: antiscam-chat-pwa-extension

Objective, scope, constraints and task details: see spec `docs/superpowers/specs/2026-09-24-antiscam-chat-pwa-extension-design.md` and plan `docs/superpowers/plans/2026-09-24-antiscam-chat-pwa-extension.md` (single source; not duplicated here).

Authorized by user 2026-09-24 (spec + plan approved, parallel execution approved). Deadline: hackathon close ~9 h from 20:00 ART.

## Tasks
- [x] T1 — Backend lessons + /api/analyze-text. Route: delegated writer (main tree).
- [x] T2 — Backend /api/chat (Ollama nemotron cloud) + README contract. Route: delegated writer (same as T1).
- [ ] T3 — Frontend core + PWA. Route: delegated writer in isolated git worktree (parallel with T1–T2).
- [x] T4 — E2E smoke PWA vs real backend. Route: delegated.
- [x] T5 — Chromium MV3 extension + metrics. Route: delegated.
- [x] T6 — DEMO.md + final verification. Route: delegated/inline.

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

### T4 — E2E smoke PWA vs real backend (done)
- `cd frontend && npm install`: 551 packages installed (esbuild/tesseract.js postinstall scripts blocked by npm allowScripts policy; verified harmless via `node -e "require('esbuild')"`).
- `cd frontend && npm run build`: succeeded, `dist/manifest.webmanifest` and `dist/sw.js` present.
- `npx -y playwright@latest install chromium`: installed chromium-1243. Added `playwright@^1.63.0` as a devDependency (`frontend/package.json`/`package-lock.json`) so a Node scratch script could `import` it — kept in place for reuse by T5.
- Backend `cd backend && uv run uvicorn app.main:app --port 8000` (background): `GET /docs` → 200.
- Frontend `npx vite preview --port 4173` (background): `GET /` → 200. Ollama `localhost:11434/api/tags` → 200 (reachable).
- Scratch Playwright driver (`frontend/.scratch-e2e.mjs`, deleted after the run, not committed) drove the built PWA:
  - Example "Probar un mensaje falso" → verdict word `⛔ Peligroso`.
  - Example "Probar un link sospechoso" → verdict word `⛔ Peligroso`.
  - Example "¿Cómo me doy cuenta de una estafa?" → no verdict word (expected: routes to `matchLessons`, not analyze), 1 lesson card rendered.
  - Typed `http://bna-homebanking-verificar.xyz/login` → `⛔ Peligroso`.
  - Typed SMS scam text ("URGENTE: tu cuenta del Banco Nación será suspendida. Pasame el código que te llegó por SMS") → `⛔ Peligroso`, 3 lesson cards.
  - Typed `¿Cómo me doy cuenta de una estafa?` → 1 lesson card, then a layer-B (`assistant-b`) bubble appeared after ~4.0s (< 10s budget) with a grounded Spanish answer.
  - Image OCR: generated a scam-text PNG via a Playwright screenshot of an HTML snippet, uploaded through the composer's file input → tesseract OCR extracted the text → verdict rendered as `⛔ Peligroso`.
  - Screenshots captured: light theme (SMS scam case), dark theme (`prefers-color-scheme: dark` emulation), A++ text-size toggle state — all visually inspected: verdict always shown as color+icon+word+sentence, AA-looking contrast in both themes, A++ noticeably larger type. No color-only signaling observed.
  - `npx vitest run`: 5 test files, 26 tests, all passed (incl. `a11y.test.tsx` axe check and `Chat.test.tsx` unreachable/danger/fallback-B cases) — no regressions from the E2E run.
- Screenshots (scratchpad, not committed): `sms_scam_light.png`, `theme_light.png`, `theme_dark.png`, `theme_aplusplus.png`, `scam-src.png`, `results.json`.
- No defects found; no `fix(...)` commit needed. Both background servers stopped and confirmed down (`curl` → connection refused) at the end of the task.

### T5 — Chromium MV3 extension + metrics (done)
- Failing test observed first: `npx vitest run src/extension/metrics.test.ts` → FAIL, `Failed to resolve import "./metrics" from "src/extension/metrics.test.ts"` (module not found).
- Implemented `frontend/src/extension/metrics.ts` exactly per plan interface: `KV{get,set,dump}`, `memoryStore()`, `chromeStore(area)`, `recordVerdict(store, sessionStore, {domain, level, now})` (caution/danger only; dedupe key = SHA-256 hex of `${yyyy-mm-dd}|${domain}` via Web Crypto `crypto.subtle.digest`, written only to `sessionStore`), `getMetrics(store, now)` (today/week[7d incl. today]/total, each `{total, danger}`; prunes day keys older than 30 days).
- `npx vitest run src/extension/metrics.test.ts` → PASS, 4/4 tests (dedupe same domain/day, safe not counted, new day resets today not total, no domain text ever in the persistent store's dump).
- Implemented the rest of the extension: `src/extension/manifest.json` (MV3; `permissions: ["tabs","storage","sidePanel"]`; `host_permissions: ["http://localhost:8000/*"]`; `background.service_worker: "background.js"` type module; `side_panel.default_path: "sidepanel.html"`; `action.default_icon`/`default_title`; CSP `script-src 'self'; object-src 'self'`), `src/extension/background.ts` (`handleTabUrl(tabId, url)` exported and wired to `chrome.tabs.onUpdated` for `status === 'complete'` http/https tabs; sets the badge — danger `!` red / caution `?` amber / safe blank green-cleared / non-http blank; calls `recordVerdict`; caches the verdict per tab via `src/extension/tabVerdict.ts` (session-only cache, cleared on `tabs.onRemoved`); `chrome.sidePanel.setPanelBehavior({openPanelOnActionClick:true})`; also assigned to `self.handleTabUrl` for direct E2E invocation), `src/extension/sidepanel.tsx`+`.html` (current-tab verdict card via `VerdictCard` + cached verdict, `<MetricsTiles/>`, shared `<Chat/>` from `core/components/Chat`), `src/extension/MetricsTiles.tsx` (3 tiles, big numbers, captions "Hoy"/"Esta semana"/"Total", subtitle "amenazas detectadas", danger sub-count "N peligrosas"; reuses `theme.css` tokens, adds `.metrics-tile*` rules there for shared light/dark/AA contrast), `vite.extension.config.ts` (root=`src/extension`, multi-entry `background.ts` + `sidepanel.html`, fixed `[name].js` output names, `viteStaticCopy` for `manifest.json`, icons, and the same tesseract assets as the PWA build — all absolute posix-style paths, `emptyOutDir` into `dist-extension/`).
- Shared-core change: `src/core/ocr.ts` now resolves tesseract asset paths via `chrome.runtime.getURL('tesseract/…')` when `chrome.runtime.getURL` exists (extension), else the existing `/tesseract/…` absolute path (PWA) — `ocr.test.ts` still passes unmodified (no `chrome` global in jsdom → PWA branch).
- `frontend/tsconfig.json`: added `"chrome"` to `compilerOptions.types` (installed `@types/chrome` devDependency) so extension files type-check.
- `npx tsc --noEmit`: clean, no errors.
- `npm run build:ext` → `dist-extension/{manifest.json, background.js, sidepanel.html, sidepanel.js, assets/sidepanel.css, chunks/*.js, icons/*, tesseract/*}`. `manifest.json` parses as valid JSON (verified via `JSON.parse`). `grep -rEno 'src=["\']https?://|<script[^>]+https?://' dist-extension/*.html dist-extension/*.js dist-extension/chunks/*.js` → no matches (no remote script loads); the only `http://` string present is the `localhost:8000` API base URL in `chunks/tabVerdict.js` (a `fetch` target, not a script load).
- Defect found and fixed pre-emptively during build verification: initial `manifest.json` had `"default_locale": "es"` with no `_locales/` directory — Chrome refuses to load such a manifest. Removed `default_locale` (no i18n messages are used) before the extension was ever loaded in a browser; also added an explicit `action.default_icon` so the toolbar icon doesn't fall back to a generic puzzle icon. Included in this same commit (caught before any browser load, not a separate `fix` commit).
- `npx vitest run` (full suite): 6 files, 30 tests, all passed (26 prior + 4 new metrics tests) — no regressions.
- `npm run build` (PWA): still succeeds unchanged (`dist/manifest.webmanifest`, `dist/sw.js` present) — confirms the shared `ocr.ts` change didn't affect the PWA path.
- Headless Playwright extension verification (`frontend/.scratch-ext-e2e.mjs`, deleted after the run, not committed), real backend running on `localhost:8000`:
  - `chromium.launchPersistentContext(userDataDir, { headless: true, args: ['--disable-extensions-except=<dist-extension>', '--load-extension=<dist-extension>', '--headless=new'] })` — **`headless: true` + the `--headless=new` arg worked directly**; the service worker registered and no headed fallback was needed (fallback code path exists but wasn't exercised).
  - Extension id extracted from the service worker URL: `pikfllcemmmipijnnbpinffpjfjhnpch`.
  - Opened `chrome-extension://<id>/sidepanel.html` → 3 `.metrics-tile` elements rendered, all showing `0` initially.
  - Obtained a real `tabId` via `worker.evaluate(() => chrome.tabs.query({}))`.
  - Invoked `worker.evaluate(([id,url]) => self.handleTabUrl(id,url), [tabId, 'http://bna-homebanking-verificar.xyz/login'])` against the real backend.
  - `chrome.action.getBadgeText({tabId})` → `"!"` (danger badge, as expected).
  - Reloaded the side panel: all three tiles now read `1` with `1 peligrosas` (Hoy / Esta semana / Total each `{total:1, danger:1}`), matching `recordVerdict`/`getMetrics` semantics.
  - Screenshots (scratchpad, not committed): `sidepanel_initial.png`, `sidepanel_after_danger.png` (visually confirmed: tiles legible, current-tab verdict card correctly shows "Todavía no analizamos esta página" since the panel's *active* tab was the unrelated throwaway `about:blank` tab, not the tabId that was directly driven — expected, not a defect), `ext_results.json` (raw values).
- Both background servers/processes stopped after verification (backend uvicorn PID killed; Playwright context closed; temp `userDataDir` left in OS temp, not the repo).
- Scratch files removed (`frontend/.scratch-ext-e2e.mjs`); `frontend/dist-extension/` untouched by git (already in `.gitignore`).
- Commit: see below (single `feat(extension)` commit covering T5 plus the shared `ocr.ts`/`tsconfig.json`/`theme.css` changes it needed).

Deviations from plan interfaces: none functionally — `handleTabUrl` and the tab-verdict cache were factored into a small shared `tabVerdict.ts` module (not named in the plan) purely so the side panel doesn't import `background.ts` and accidentally re-register the `chrome.tabs.onUpdated`/`onRemoved` listeners; the exported plan-named function (`handleTabUrl`) and its behavior are unchanged.

### UI defects fix (post-T5 review, before T6) — done
Parent reviewed T4/T5 E2E screenshots (`sms_scam_light.png`, `sidepanel_after_danger.png`) and found 5 defects. Fixed all, commit `251634a` `fix(frontend): polish chat layout, verdict summary and metrics labels`:
1. Composer overlapped content with a transparent-looking background (page-level `position: sticky` inside a non-height-constrained `.app`). Fixed: `.app` is now `height: 100dvh; overflow: hidden` (an `overflow-y: auto` fallback for the side panel's extra sections), `.chat`/`.chat__scroll` are height-constrained flex children with `min-height: 0` so only the transcript scrolls, and `.composer` is a normal flex child (no longer sticky) with an opaque `--color-surface-raised` background, a top border and shadow. `Chat.tsx` auto-scrolls the transcript to the newest message via a ref.
2. Verdict summary repeated the first reason (`reasons[0]` was reused as the summary). Fixed in `chatEngine.ts`: `SUMMARY_BY_LEVEL` gives one fixed plain-language sentence per level (danger/caution/safe, exact text from the review), independent of `reasons`.
3. "1 peligrosas" (missing singular). Fixed in `MetricsTiles.tsx` with a `pluralize(count, singular, plural)` helper applied to both the danger count and the "amenaza(s) detectada(s)" subtitle/aria text.
4. Side panel had a large empty gap under "Preguntanos". Fixed: the chat's `<section>` got `.sidepanel__chat-section` (`flex: 1; min-height: 18rem`) so it grows to fill the remaining height instead of the composer sticking mid-page; a `max-width: 420px` media query tightens `.app` padding and metrics-tile sizing for ~360-400px widths.
5. Side panel's current-tab verdict card didn't show what was analyzed. Added an optional `subject` prop to `VerdictCard` (rendered above the headline); `sidepanel.tsx` passes the URL's `hostname` (via a `hostOf()` helper, falling back to the raw string if unparseable).

New/changed tests: `chatEngine.test.ts` (summary is a level sentence, not `reasons[0]`, for danger/caution/safe), `VerdictCard.test.tsx` (new — summary not duplicated in the `<li>` list, subject renders only when given), `MetricsTiles.test.tsx` (new — singular "1 peligrosa"/"amenaza detectada" vs plural for 0/2+).

- `npx vitest run`: 8 files, 39 tests, all passed (33 prior + 6 new).
- `npm run build` / `npm run build:ext`: both succeeded, unchanged output shape.
- Re-ran E2E with Playwright (real backend on :8000, PWA preview on :4173, extension built and loaded headless as in T5) and saved screenshots to `scratchpad/shots/v2/`: `pwa_empty_state.png`, `pwa_sms_scam_viewport.png`, `pwa_sms_scam_fullpage.png`, `pwa_sms_scam_verdict_top.png`, `pwa_dark.png`, `pwa_aplusplus.png`, `sidepanel_after_danger_380.png`, `sidepanel_380_scroll_{top,mid,bottom}.png` — all visually inspected: composer never overlaps the transcript/empty-state/lesson cards in any of them (bounding-box check in the driver script also asserted no vertical intersection between `.composer` and `.chat__scroll`), verdict summary sentence differs from the first bullet, metrics show "1 peligrosa"/"1 amenaza detectada" (singular), side panel's current-tab card shows the host (`bna-homebanking-verificar.xyz`) above the verdict, no dead gap under "Preguntanos" (chat section now fills remaining height; side panel scrolls as one column when content exceeds the viewport, same as a normal page). Scratch driver scripts (`.scratch-e2e-v2.mjs`, `.scratch-ext-v2.mjs`, `.scratch-ext-scroll.mjs`, `.scratch-top.mjs`) deleted after the run, not committed.

### T6 — DEMO.md + final verification (done)
- Wrote root `DEMO.md` (Spanish): requisitos (uv, Node 24, Ollama signed in + `nemotron-3-nano:30b-cloud`), levantar backend/PWA/extensión, checklist de 1 minuto, 5 casos de demo with real backend output pasted (link falso de banco, SMS, captura de WhatsApp, sitio legítimo, acortador) plus a free chat question, "Puntos para la defensa", "Si algo falla en vivo", "Preguntas probables del jurado" (5 Q&A).
- Generated `docs/demo/whatsapp-estafa.png` via a Playwright screenshot of an HTML WhatsApp-style chat bubble (scam text impersonating Banco Nación); referenced from `DEMO.md`.
- All 5 demo cases plus the free question were run live against the real backend (`localhost:8000`) and real Ollama (`nemotron-3-nano:30b-cloud` via Ollama Cloud) on 2026-09-24; outputs pasted verbatim into `DEMO.md` (case 1 `danger`/`blacklisted` score 1.0; case 2 `danger`/`impersonation` score 0.95, 3 lessons; case 3 text extracted from the generated WhatsApp image analyzed as `danger`/`blacklisted`, 4 signals, 5 lessons; case 4 `safe`/`none` score 0.15, whitelisted; case 5 `caution`/`hidden_destination` score 0.65; free question answered in ~6.7s, `fallback: false`).
- Final full checks: `cd backend && uv run pytest -q` → 123 passed. `cd frontend && npm test -- --run` → 8 files, 39 tests passed. `cd frontend && npm run build` → succeeded (`dist/manifest.webmanifest`, `dist/sw.js` present). `cd frontend && npm run build:ext` → succeeded (`dist-extension/{manifest.json,background.js,sidepanel.html,sidepanel.js,...}`).
- Commit: `docs: add demo guide and final verification evidence` (includes `DEMO.md`, `docs/demo/whatsapp-estafa.png`, this tracker update). No push (per delivery policy).
