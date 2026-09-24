# Anti-scam teaching chat, PWA and extension — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add message analysis, a lesson catalog and a grounded LLM chat to the FastAPI backend, and ship a PWA + Chromium MV3 extension sharing one accessible teaching chat.

**Architecture:** Backend stays 100% Python (FastAPI); new services `text_analyzer`, `lessons`, `llm` behind three endpoints. Frontend is one Vite + React + TS project with a shared `src/core` and two build targets (PWA, extension). Chat layer A (deterministic, backend analysis + lessons) always answers; layer B (`/api/chat`, Ollama) appends when it answers within the timeout.

**Tech Stack:** Python 3.13, FastAPI, httpx, pytest (uv) · Node 24, Vite, React 18, TypeScript, vite-plugin-pwa, tesseract.js, vitest, @testing-library/react, axe-core.

**Spec:** `docs/superpowers/specs/2026-09-24-antiscam-chat-pwa-extension-design.md` (read it; §4b UX rules are mandatory).

## Global Constraints
- Never modify anything under `MODULO-PY/` (read-only; imported via `app/services/motor_adapter.py`).
- Code identifiers/comments in English; all user-facing strings in Spanish (friendly neutral voseo, plain language, no jargon outside lessons).
- No logging or persistence of URLs, messages or images. Extension stores only per-day counters.
- `score` scale stays 0–1; levels `safe` | `caution` | `danger`.
- Ollama: `OLLAMA_URL` default `http://localhost:11434`, `OLLAMA_MODEL` default `nemotron-3-nano:30b-cloud`, `OLLAMA_TIMEOUT_S` default `8`, request with `"stream": false, "think": false`.
- A single weak signal never yields `danger`.
- UX: body ≥ 18px (rem), WCAG 2.2 AA contrast, verdict = color + icon + word + sentence, targets ≥ 48px, keyboard + ARIA live region, `prefers-reduced-motion`, light/dark, A/A+/A++ text size, 🔊 Web Speech read-aloud.
- Conventional commits, no AI attribution lines. Branch `feat/backend-analyze-api`. Do not push.

## Review Focus
- Text with accents/uppercase/extra spaces ("URGENTE: Tu CUENTA será SUSPENDIDA") must fire the same signals as lowercase → test in Task 1.
- A message containing only a legitimate official link (`https://www.mercadopago.com.ar`) and no other signal must be `safe` → test in Task 1.
- Ollama returning HTTP 500, invalid JSON, or taking longer than the timeout → `/api/chat` returns `{"answer": null, "fallback": true}` with HTTP 200 → tests in Task 2.
- Backend unreachable from the UI → friendly Spanish error message, input text preserved → test in Task 3.
- Same domain visited many times in a day counts once in extension metrics; a new day resets "Hoy" but not "Total" → tests in Task 5.

---

### Task 1: Backend — lessons catalog + `/api/analyze-text`

**Files:**
- Create: `backend/app/services/lessons.py`, `backend/app/services/text_analyzer.py`
- Modify: `backend/app/schemas.py` (add models), `backend/app/main.py` (routes)
- Test: `backend/tests/test_lessons.py`, `backend/tests/test_text_analyzer.py`, `backend/tests/test_analyze_text_api.py`

**Interfaces:**
- Consumes: `app.services.analyzer.analyze(url, model) -> AnalyzeResponse`, `app.services.ml_model.get_model()`, `app.services.motor_adapter.official_brands() -> tuple[MotorBrand(id, display_name, domains)]`.
- Produces:
  - `lessons.Lesson` (pydantic: `id, icon, title, how_to_spot, example, what_to_do`), `lessons.all_lessons() -> list[Lesson]`, `lessons.lessons_for(ids: Iterable[str]) -> list[Lesson]` (dedup, catalog order).
  - Lesson ids (exactly): `urgency, credential_request, money_request, prize, brand_impersonation, suspicious_link, impersonal_greeting, fake_domain, hidden_link, insecure_site`. URL categories map: `impersonation→brand_impersonation`, `suspicious_domain→fake_domain`, `hidden_destination→hidden_link`, `insecure→insecure_site`, `blacklisted→fake_domain`.
  - `text_analyzer.analyze_text(text: str, model) -> AnalyzeTextResponse`.
  - Schemas: `AnalyzeTextRequest{text: str (1..5000, stripped non-empty)}`, `Signal{id: str, evidence: str}`, `AnalyzeTextResponse{level, score, category, reasons: list[str], tip, signals: list[Signal], lessons: list[Lesson], urls: list[AnalyzeResponse]}`.
  - Routes: `GET /api/lessons -> list[Lesson]`, `POST /api/analyze-text -> AnalyzeTextResponse`.

Signal weights (sum, capped at 1.0): `credential_request 0.45, money_request 0.4, suspicious_link 0.5 (danger URL) / 0.3 (caution URL), brand_mention 0.25, urgency 0.25, prize 0.25, impersonal_greeting 0.15`. If only one signal fired, cap score at 0.6. Category: `impersonation` if brand + (credential or money or suspicious_link); else `suspicious_link`'s URL category if present; else `social_engineering` if any signal; else `none`. Normalize text with `unicodedata` NFKD + strip accents + lowercase before matching; `evidence` is the matched snippet from the original text (≤ 60 chars). Each fired signal adds one Spanish reason sentence (e.g. `credential_request`: "Te pide una clave o código: ningún banco lo hace por mensaje."). URL extraction regex: `(https?://\S+|www\.\S+|\b[a-z0-9-]+\.(com|ar|net|org|xyz|top|info|online|site|link|click)(\.ar)?(/\S*)?)` — trim trailing punctuation, max 5 URLs.

- [ ] **Step 1: Write failing tests**

```python
# backend/tests/test_text_analyzer.py
import pytest
from app.services.text_analyzer import analyze_text

SCAM = "URGENTE: Estimado cliente, tu cuenta de Mercado Pago será SUSPENDIDA. Ingresá tu clave en http://mercadopago-reintegros.com"

def ids(r): return {s.id for s in r.signals}

def test_classic_scam_is_danger(real_model):
    r = analyze_text(SCAM, real_model)
    assert r.level == "danger"
    assert {"urgency", "credential_request", "brand_mention", "suspicious_link", "impersonal_greeting"} <= ids(r)
    assert r.lessons and r.urls

def test_accents_and_case_do_not_matter(real_model):
    a = analyze_text("tu cuenta sera suspendida, pasame el codigo", real_model)
    b = analyze_text("TU CUENTA SERÁ SUSPENDIDA, PASAME EL CÓDIGO", real_model)
    assert ids(a) == ids(b) == {"urgency", "credential_request"}

def test_single_weak_signal_never_danger(real_model):
    assert analyze_text("¡Ganaste un sorteo!", real_model).level != "danger"

def test_official_link_only_is_safe(real_model):
    r = analyze_text("Mirá https://www.mercadopago.com.ar", real_model)
    assert r.level == "safe" and "suspicious_link" not in ids(r)

def test_plain_message_is_safe(real_model):
    r = analyze_text("Hola ma, llego a las 8 para la cena", real_model)
    assert r.level == "safe" and r.signals == [] and r.category == "none"
```

(Use the existing model fixture from `backend/tests/conftest.py`; rename `real_model` to whatever it is called there.) Plus `test_lessons.py`: every id listed above exists exactly once, every field non-empty, each lesson ≤ 60 words across `how_to_spot + what_to_do`. Plus `test_analyze_text_api.py`: 200 on SCAM, 422 on `""`, `"   "` and 5001 chars; `GET /api/lessons` returns ≥ 10 items.

- [ ] **Step 2:** `cd backend && uv run pytest tests/test_text_analyzer.py tests/test_lessons.py tests/test_analyze_text_api.py -q` → FAIL (module not found).
- [ ] **Step 3:** Implement `lessons.py`, `text_analyzer.py`, schemas, routes as specified above.
- [ ] **Step 4:** `cd backend && uv run pytest -q` → all pass (98 prior + new).
- [ ] **Step 5:** `git add backend && git commit -m "feat(backend): add message analysis and red-flag lesson catalog"`

### Task 2: Backend — `/api/chat` grounded LLM (layer B)

**Files:**
- Create: `backend/app/services/llm.py`
- Modify: `backend/app/config.py` (Ollama env getters), `backend/app/schemas.py`, `backend/app/main.py`, `backend/README.md` (full contract, one example per level, env vars, Ollama note)
- Test: `backend/tests/test_llm.py`, `backend/tests/test_chat_api.py`

**Interfaces:**
- Consumes: `lessons.lessons_for`, `Signal`.
- Produces: `ChatRequest{message: str (1..2000), context: ChatContext | None}`, `ChatContext{level: str | None, signals: list[Signal] = []}`, `ChatResponse{answer: str | None, fallback: bool}`; `llm.build_messages(message, context) -> list[dict]`; `llm.ask(message, context, *, client: httpx.Client | None = None) -> str | None` (None on any error/timeout); route `POST /api/chat`.

System prompt (Spanish, fixed): assistant of an Argentine anti-scam app; audience of every age; answer in ≤ 4 short sentences, plain language, voseo; ONLY use the provided signals and lessons; never decide if something is dangerous beyond the given `level`; if the question is unrelated to scams/online safety, say so kindly and suggest what it can help with; end with one concrete tip. User message content = JSON with `question`, `level`, `signals`, and the `lessons_for(...)` of those signals (or, with no context, the 3 lessons whose title/keywords best overlap the question words; fallback first 3).

- [ ] **Step 1: Failing tests** — use `httpx.MockTransport`:

```python
# backend/tests/test_llm.py
import httpx, json
from app.services import llm

def client(handler): return httpx.Client(transport=httpx.MockTransport(handler), base_url="http://ollama")

def test_returns_answer():
    c = client(lambda req: httpx.Response(200, json={"message": {"content": "  No compartas tu clave.  "}}))
    assert llm.ask("¿Me piden la clave?", None, client=c) == "No compartas tu clave."

def test_sends_think_false_and_grounding():
    seen = {}
    def h(req):
        seen.update(json.loads(req.content)); return httpx.Response(200, json={"message": {"content": "ok"}})
    llm.ask("hola", {"level": "danger", "signals": [{"id": "urgency", "evidence": "suspendida"}]}, client=client(h))
    assert seen["think"] is False and seen["stream"] is False
    assert "urgency" in seen["messages"][-1]["content"]

def test_http_error_returns_none():
    assert llm.ask("x", None, client=client(lambda r: httpx.Response(500))) is None

def test_bad_json_returns_none():
    assert llm.ask("x", None, client=client(lambda r: httpx.Response(200, text="nope"))) is None

def test_timeout_returns_none():
    def h(r): raise httpx.ReadTimeout("slow")
    assert llm.ask("x", None, client=client(h)) is None
```

`test_chat_api.py`: monkeypatch `app.services.llm.ask` → returns "hola" → `{"answer":"hola","fallback":false}`; returns None → `{"answer":null,"fallback":true}` with 200; 422 on empty message.
- [ ] **Step 2:** run them → FAIL.
- [ ] **Step 3:** implement (`httpx.Client(timeout=OLLAMA_TIMEOUT_S)` created per call when none injected; catch `httpx.HTTPError`, `ValueError`, `KeyError`, `TypeError`).
- [ ] **Step 4:** `uv run pytest -q` → all pass. Live smoke (not a test): `uv run python -c "from app.services.llm import ask; print(ask('¿Cómo reconozco un mensaje falso del banco?', None))"` → prints a Spanish answer or `None` (report which).
- [ ] **Step 5:** commit `feat(backend): add grounded LLM chat endpoint with fallback` (include README contract).

### Task 3: Frontend scaffold + shared core (api, chat engine, UI) + PWA

**Files (create under `frontend/`):** `package.json`, `vite.config.ts` (PWA build), `tsconfig.json`, `index.html`, `src/core/api.ts`, `src/core/types.ts`, `src/core/chatEngine.ts`, `src/core/ocr.ts`, `src/core/speech.ts`, `src/core/theme.css`, `src/core/components/{Chat,MessageBubble,VerdictCard,LessonCard,QuickChips,Composer,TextSizeToggle}.tsx`, `src/pwa/main.tsx`, `src/pwa/App.tsx`, `public/icons/*` (simple shield SVG→PNG 192/512), tests `src/core/*.test.ts(x)`.

**Interfaces:**
- `types.ts` mirrors backend: `Level = 'safe'|'caution'|'danger'`, `UrlVerdict`, `TextVerdict`, `Lesson`, `Signal`, `ChatAnswer{answer: string|null, fallback: boolean}`.
- `api.ts`: `API_BASE = import.meta.env.VITE_API_BASE ?? 'http://localhost:8000'`; `analyzeUrl(url)`, `analyzeText(text)`, `getLessons()`, `askChat(message, context)`; throws `ApiUnavailableError` on network failure, `ApiValidationError` on 422.
- `chatEngine.ts`: `classifyInput(text): 'url'|'text'|'question'` (single token that parses as a URL/host → `url`; ends with `?` or starts with cómo/qué/por qué/es seguro and has no URL and < 120 chars → `question`; else `text`); `buildReplyA(verdict): Reply` (verdict word+icon+summary, reasons, lessons, chips); `matchLessons(question, lessons, n=3)` keyword overlap after accent-strip.
- `ocr.ts`: `extractText(file: Blob): Promise<string>` via `tesseract.js` `createWorker('spa')`, worker/lang assets served locally (copy `tesseract.js-core` + `spa.traineddata.gz` into `public/tesseract/` via `vite-plugin-static-copy`; set `workerPath`, `corePath`, `langPath`).
- `speech.ts`: `speak(text)`, `stop()`, `isSpeechSupported()`; prefers `es-AR`, then any `es-*`.
- `Chat` props: `{ initialMessages?: Message[] }`; flow: user message → classify → call A (url/text) or `matchLessons` (question) → render A reply → in parallel `askChat` → append B bubble if `answer`. Image paste/pick → `extractText` → treat as `text`; empty OCR → "No encontré texto en la imagen".
- Empty state: 3 example buttons ("Probar un mensaje falso", "Probar un link sospechoso", "¿Cómo me doy cuenta de una estafa?").
- Verdict words: safe "Parece seguro" ✅ green, caution "Cuidado" ⚠️ amber, danger "Peligroso" ⛔ red; palette tokens in `theme.css` with light/dark and AA contrast.

- [ ] **Step 1: Failing tests** (`vitest`, `jsdom`):

```ts
// src/core/chatEngine.test.ts
import { classifyInput, matchLessons } from './chatEngine'
test('url', () => expect(classifyInput('mercad0pago.com.ar')).toBe('url'))
test('url with scheme', () => expect(classifyInput('https://bit.ly/x')).toBe('url'))
test('question', () => expect(classifyInput('¿Es seguro pagar con QR?')).toBe('question'))
test('message', () => expect(classifyInput('Tu cuenta será suspendida, ingresá tu clave en http://x.xyz')).toBe('text'))
test('lesson match ignores accents', () => {
  const ls = [{ id: 'credential_request', title: 'Te piden tu clave o código', icon:'', how_to_spot:'', example:'', what_to_do:'' }]
  expect(matchLessons('que hago si me piden el codigo', ls as any)[0].id).toBe('credential_request')
})
```

Plus `Chat.test.tsx`: mock `api` → backend unreachable (`ApiUnavailableError`) shows "No pude conectarme al analizador" and the composer still contains the typed text; danger verdict renders the word "Peligroso" (not only color); B answer `null` renders no extra bubble. Plus `a11y.test.tsx`: render `App`, run `axe` → 0 violations with impact serious/critical.
- [ ] **Step 2:** `cd frontend && npm test -- --run` → FAIL.
- [ ] **Step 3:** implement per interfaces and spec §4/§4b.
- [ ] **Step 4:** `npm test -- --run` → pass; `npm run build` → success, `dist/` contains `manifest.webmanifest` and `sw.js`.
- [ ] **Step 5:** commit `feat(frontend): add accessible teaching chat PWA with OCR and read-aloud`.

### Task 4: End-to-end smoke of the PWA against the real backend

- [ ] Start backend (`cd backend && uv run uvicorn app.main:app --port 8000`) and `cd frontend && npx vite preview --port 4173` in background.
- [ ] Headless check with Playwright (`npx playwright` chromium, scratch script, not committed): open the PWA, click each example button, assert a verdict word appears; type `http://bna-homebanking-verificar.xyz/login` → "Peligroso". Save screenshots to the scratchpad and report. Stop servers.
- [ ] Fix any defect found (commit `fix(frontend): …`).

### Task 5: Chromium MV3 extension (badge, metrics, side panel chat)

**Files (under `frontend/`):** `vite.extension.config.ts`, `src/extension/manifest.json`, `src/extension/background.ts`, `src/extension/metrics.ts`, `src/extension/sidepanel.html`, `src/extension/sidepanel.tsx`, `src/extension/MetricsTiles.tsx`, tests `src/extension/metrics.test.ts`; `package.json` script `build:ext` → `dist-extension/`.

**Interfaces:**
- manifest: MV3, `permissions: ["tabs","storage","sidePanel"]`, `host_permissions: ["http://localhost:8000/*"]`, `background.service_worker`, `side_panel.default_path: "sidepanel.html"`, `action` opens side panel (`chrome.sidePanel.setPanelBehavior({openPanelOnActionClick: true})`), icons, CSP default (no remote code).
- `metrics.ts` (pure, storage injected): `type KV = {get(k): Promise<any>, set(k, v): Promise<void>, dump(): object}`; `memoryStore(): KV` (tests) and `chromeStore(area: 'local'|'session'): KV`; `recordVerdict(store: KV, sessionStore: KV, {domain, level, now: Date}) -> Promise<void>` counts only caution/danger, dedupe key = SHA-256 hex of `${yyyy-mm-dd}|${domain}` kept only in `sessionStore` (so no domain text is ever stored); `getMetrics(store, now) -> {today:{total,danger}, week:{total,danger}, total:{total,danger}}` (week = last 7 days incl. today); prunes day keys older than 30 days. Stores no URLs.
- `background.ts`: on `tabs.onUpdated` status `complete` for http/https → `analyzeUrl` → badge: danger "!" red, caution "?" amber, safe "" green → `recordVerdict` with hostname → cache last verdict per tabId in `chrome.storage.session`. Skip non-http(s). On API failure leave badge blank.
- side panel: current tab verdict card (from session cache), `MetricsTiles` (three big tiles: Hoy / Esta semana / Total + caption "amenazas detectadas", danger sub-count), and `<Chat />` from core.

- [ ] **Step 1: Failing tests**

```ts
// src/extension/metrics.test.ts
import { recordVerdict, getMetrics, memoryStore } from './metrics'
const d = (s: string) => new Date(s + 'T12:00:00')
test('dedupes same domain same day', async () => {
  const s = memoryStore(), ss = memoryStore()
  for (let i = 0; i < 5; i++) await recordVerdict(s, ss, { domain: 'x.xyz', level: 'danger', now: d('2026-09-24') })
  expect((await getMetrics(s, d('2026-09-24'))).today).toEqual({ total: 1, danger: 1 })
})
test('safe is not counted', async () => {
  const s = memoryStore(), ss = memoryStore()
  await recordVerdict(s, ss, { domain: 'google.com', level: 'safe', now: d('2026-09-24') })
  expect((await getMetrics(s, d('2026-09-24'))).total.total).toBe(0)
})
test('new day resets today not total', async () => {
  const s = memoryStore(), ss = memoryStore()
  await recordVerdict(s, ss, { domain: 'a.xyz', level: 'caution', now: d('2026-09-24') })
  const m = await getMetrics(s, d('2026-09-25'))
  expect(m.today.total).toBe(0); expect(m.week.total).toBe(1); expect(m.total.total).toBe(1)
})
test('stores no urls', async () => {
  const s = memoryStore(), ss = memoryStore()
  await recordVerdict(s, ss, { domain: 'a.xyz', level: 'danger', now: d('2026-09-24') })
  expect(JSON.stringify(s.dump())).not.toContain('a.xyz')
})
```

- [ ] **Step 2:** `npm test -- --run` → FAIL. **Step 3:** implement. **Step 4:** tests pass; `npm run build:ext` → `dist-extension/manifest.json` valid, no remote script URLs (`grep -r "https://" dist-extension/*.js` shows no script loads). Headless Playwright: launch chromium with `--load-extension=dist-extension`, visit a danger URL served locally? (use `http://localhost:4173/?demo` not needed) — minimal: verify service worker registers and side panel page renders metrics tiles.
- [ ] **Step 5:** commit `feat(extension): add Chromium extension with threat badge, local metrics and side panel chat`.

### Task 6: DEMO.md + final verification

- [ ] Write root `DEMO.md`: prerequisites (uv, Node, Ollama signed in), start commands (backend, `npm run build && npx vite preview`, `npm run build:ext`), load unpacked extension (`chrome://extensions` → Developer mode → Load unpacked → `frontend/dist-extension`), 5 demo cases with exact input and observed output (fake bank URL, "cuenta suspendida" SMS, WhatsApp screenshot image in `docs/demo/whatsapp.png` — generate a simple PNG with the scam text, legitimate site, `bit.ly` shortener), and pitch talking points (AI explains not decides, privacy + cloud caveat, teaches, all ages accessibility, works without LLM).
- [ ] Run full checks: `cd backend && uv run pytest -q`; `cd frontend && npm test -- --run && npm run build && npm run build:ext`. Record results in `odd/tasks/backend-analyze-api.md` progress.
- [ ] Commit `docs: add demo guide and final verification evidence`.
