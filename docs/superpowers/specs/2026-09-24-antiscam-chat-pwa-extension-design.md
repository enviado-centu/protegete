# Anti-scam assistant: teaching chat, PWA and Chromium extension — Design

Date: 2026-09-24 · Status: draft for review · Deadline: hackathon close in ~9 h

## 1. Intent

Argentine users receive phishing links, scam SMS/WhatsApp/e-mails and screenshots of them.
The product must **detect** the threat and **teach** the user to recognize its red flags, so
they can spot the next one on their own.

Success for the demo:
- A user pastes a link, a message or a screenshot and gets a clear verdict, the red flags found
  and a short lesson for each one.
- The user can ask free questions ("¿es seguro pagar con QR?") and get a grounded answer.
- The extension flags the current page automatically and shows how many threats it caught
  today / this week / in total.
- Everything keeps working if the LLM is down.

Principles (for the pitch):
- **AI explains, never decides.** Rules + blacklist/whitelist + ML decide the verdict. The LLM
  only rephrases verified signals and teaches.
- **Privacy.** No URLs or messages are stored. Images are read on-device (OCR in the browser).
  Metrics are local counters only. Known caveat: the LLM runs on Ollama Cloud
  (`nemotron-3-nano:30b-cloud`, chosen because the demo machine has 8 GB RAM), so chat text
  sent to layer B leaves the device; layer B receives only the user's question plus the
  already-verified signals.
- **Teach, don't just block.** Every alert links to a lesson.

## 2. Architecture

```
frontend/ (Vite + React + TS)
  core/        api client, chat engine, chat UI components, OCR (tesseract.js)
  pwa/         PWA shell (manifest + service worker) → chat
  extension/   MV3: service worker (tab check, badge, metrics) + side panel (metrics + chat)
        │ HTTP (localhost:8000)
backend/ (FastAPI, existing)
  POST /api/analyze        URL verdict (done: motor rules + lists + ML)
  POST /api/analyze-text   NEW: message verdict + signals + lessons (+ URLs inside → /analyze logic)
  GET  /api/lessons        NEW: red-flag lesson catalog
  POST /api/chat           NEW: layer B, grounded LLM answer via Ollama, with timeout
```

### Chat: layer A + layer B
- **A (deterministic, always answers first):** the chat engine classifies the input:
  URL → `/api/analyze`; text → `/api/analyze-text`; image → OCR → `/api/analyze-text`;
  quick buttons ("¿Cómo lo reconozco?", "¿Qué hago ahora?") → lessons already in the response;
  free question → keyword match against the lesson catalog + topic chips.
- **B (LLM, additive):** in parallel the chat calls `/api/chat` with the question and, if any,
  the last verdict's signals. The backend builds a grounded prompt (fixed instructions +
  verified signals + relevant lessons), calls Ollama with `think: false` and a ~8 s timeout.
  On success the answer is appended under A's reply. On timeout/error `/api/chat` returns
  `{"answer": null, "fallback": true}` and the UI shows nothing extra.
- The LLM is isolated in `backend/app/services/llm.py` behind a small interface (fake in tests).

## 3. Backend additions

### `POST /api/analyze-text`
Request `{ "text": "..." }` (1–5000 chars, else 422). Response keeps the `/api/analyze` shape
(`level`, `score` 0–1, `category`, `reasons`, `tip`) plus:
- `signals`: `[{ "id": "urgency", "evidence": "tu cuenta será suspendida" }]`
- `lessons`: lesson objects for the fired signals
- `urls`: per-URL results for links found in the text (reusing the existing analyzer)

Signals (Spanish keyword/regex, accent- and case-insensitive): `urgency`, `credential_request`
(clave, código, token, PIN, CVV, "código de verificación"), `money_request` (CBU/CVU/alias,
transferencia, seña), `prize` (ganaste, premio, sorteo, reintegro), `brand_mention` (brands from
`motor/` official list), `suspicious_link` (a URL inside the text that the URL analyzer rates
caution/danger), `impersonal_greeting` ("estimado cliente"). Weights follow the URL engine's
rule: a single weak signal never reaches `danger`; a credential request + brand or + suspicious
link does.

### `GET /api/lessons`
~8 lessons: `{ id, title, how_to_spot, example, what_to_do }`, Spanish, static module
`backend/app/services/lessons.py`. Each signal id and each URL rule category maps to a lesson.

### `POST /api/chat`
Request `{ "message": "...", "context": { "signals": [...], "level": "danger" } | null }`.
Response `{ "answer": "..." | null, "fallback": bool }`. Config via env: `OLLAMA_URL`
(default `http://localhost:11434`), `OLLAMA_MODEL` (default `nemotron-3-nano:30b-cloud`),
`OLLAMA_TIMEOUT_S` (default 8). No logging of message content.

## 4. Frontend

- **PWA:** single chat screen; input accepts text/URL, paste of images, and an image picker.
  Messages render verdict badge (🟢/🟡/🔴), reasons, lesson cards, quick-action chips, and the
  optional B answer. Installable (manifest + service worker caching the shell only).
- **Extension (Chromium MV3):** service worker analyzes the active tab URL on navigation
  (skips `chrome://`, whitelisted short-circuit is server side), sets badge color/text.
  Side panel: current page verdict, **metrics** (today / this week / total potential threats =
  caution + danger, with danger count), and the same chat component from `core/`.
  Metrics: `chrome.storage.local` holds only `{ "YYYY-MM-DD": { caution, danger } }` and
  `total`; dedupe per registrable domain per day via `chrome.storage.session`. No URLs stored.
- **Fallback plan if time runs short:** drop the chat inside the side panel (replace with an
  "Abrir chat" button to the PWA). Badge + metrics always ship.

## 5. Error handling
- Backend down → chat shows "No pude conectarme al analizador" and keeps the input.
- LLM timeout/error → A reply stands alone (no error shown).
- OCR finds no text → "No encontré texto en la imagen".
- Invalid input → 422 → friendly message.

## 6. Verification (done by the agent; the user does no manual testing)
- Backend: pytest for analyze-text signals/levels, lessons catalog, chat endpoint with a fake
  LLM (success, timeout → fallback), plus one live smoke call to Ollama.
- Frontend: vitest for the chat engine (input classification, A-reply building, metrics
  counter/dedupe); `npm run build` for PWA and extension must succeed.
- End-to-end smoke: start backend, run the 5 demo cases through the API and the built PWA
  (headless), record outputs in `DEMO.md`.

## 7. Deliverables
- Code + tests, one commit per piece on `feat/backend-analyze-api`.
- `backend/README.md`: full contract (T7) with one example per level.
- `DEMO.md`: how to start everything, how to load the unpacked extension, and 5 demo cases
  (fake bank URL, "cuenta suspendida" SMS, WhatsApp screenshot, legitimate site, shortener)
  with expected results, plus pitch talking points.

## 8. Out of scope
Page-injected banners, history, accounts, public deploy, local LLM model, Node service.
