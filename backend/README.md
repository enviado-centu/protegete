# Phishing Link Analyzer API

FastAPI backend that scores a URL for phishing risk, combining the team's
trained ML model with a deterministic rules engine focused on Argentine
brand impersonation. Built for a browser extension / PWA client.

## Setup

```bash
cd backend
uv sync
```

Requires the sibling `MODULO-PY` folder (the trained model, feature
extraction code, and the `motor/` rules-and-lists package) to be present at
the repo root; this backend imports it read-only and never modifies it.

## Lists and rules come from MODULO-PY/motor (T8)

The whitelist, blacklist and deterministic rules with human-readable Spanish
reasons are owned by `MODULO-PY/motor/` (`listas.py`, `reglas.py`), a
teammate's package, not by this backend. `app/services/motor_adapter.py` is
the only module that imports it (lazily, read-only, same `sys.path`
mechanism as the ML model adapter) and exposes a small typed interface to
`app/services/rules.py`:

- **Whitelist** (`motor/datos/lista_blanca.json`): official brand domains.
  Short-circuits straight to `safe`, same as before.
- **Blacklist** (`motor/datos/lista_negra_propia.txt`, plus
  `motor/datos/lista_negra_feed.txt` if present): known-malicious URLs and
  domains. Short-circuits straight to `danger` / category `blacklisted`,
  with a single reason. The feed file is optional and gitignored -- the
  backend works fine without it (verified in
  `backend/tests/test_motor_adapter.py`).
- **Rules** (`motor/reglas.py`): brand mention in host/path, suspicious TLD,
  scam keywords, IP host, punycode/homoglyph host, shortener, explicit
  port, "@" hiding the real destination -- each with a ready-made Spanish
  reason that we reuse verbatim instead of writing our own.

`app/services/rules.py` keeps only what the motor does **not** cover:
homoglyph/typo (Levenshtein) brand lookalikes (e.g. `mercad0pago.com.ar`,
`ua1a.com.ar` -- the motor only does exact/substring matching, no homoglyph
normalization or edit distance), the plain HTTP check, a deterministic
pirate-streaming family-marker rule (see below), and a small, explicitly
documented fallback brand/whitelist list (`GLOBAL_BRANDS` /
`OFFICIAL_STREAMING_DOMAINS` in `rules.py`) for global tech brands and
official sports broadcasters the motor's Argentine-focused whitelist
doesn't carry at all (google, paypal, microsoft, apple, netflix, whatsapp,
instagram, facebook, tycsports.com, espn.com/.com.ar, disneyplus.com,
star.com, paramountplus.com, dazn.com, flow.com.ar, telefe.com,
tvpublica.com.ar, directvgo.com, max.com, youtube.com) -- without it,
`docs.google.com` and `www.tycsports.com/envivo` would lose their
whitelist short-circuit. See the module docstring in `rules.py` for the
full rule-by-rule overlap map.

### Pirate-streaming sites (`risky_site`) and reputation (`malicious`)

Sites like `futbollibrefullhd.org` (an Argentine pirate football-streaming
site, a family known for malvertising, fake "play"/download buttons and
scam pop-ups that constantly hop domains) have no brand to impersonate, so
none of the rules above catch them. `app/services/rules.py` adds a
deterministic, fully offline `pirate_streaming` rule (category
`risky_site`): a strong match against ~24 known family markers
(`futbollibre`, `rojadirecta`, `pelotalibre`, `streameast`,
`crackstreams`, ...) on the host's domain/subdomain labels (never the
path, so a news article merely mentioning "futbol" stays unaffected), or a
weaker match combining a streaming keyword (`envivo`, `gratis`,
`streaming`, ...) with a sports word (`futbol`, `nba`, `f1`, ...) -- a
single weak keyword alone never fires.

Separately, `app/services/reputation.py` adds an **optional** online
reputation source: the Google Safe Browsing v4 Lookup API, the same
database Chrome/Edge (Google Safe Browsing) and, indirectly, Microsoft
SmartScreen use to flag dangerous sites. It's disabled by default (no
network call at all) and only activates when `GOOGLE_SAFE_BROWSING_API_KEY`
is set -- get a free key at [Google Cloud
Console](https://console.cloud.google.com/) → APIs & Services → enable
**"Safe Browsing API"** → Credentials → create an API key. A match maps to
rule id `reputation_flagged` (category `malicious`, weight 1.0). Requests
time out after 2s, results are cached in-memory for 10 minutes (max 1000
URLs), and any error (missing key, network failure, timeout, malformed
response) degrades to `"unavailable"` -- a reputation lookup can never
break `/api/analyze`. The looked-up URL is never logged.

### Refreshing the blacklist feed

The optional OpenPhish feed is downloaded (not committed) from inside
`MODULO-PY`, not from this backend:

```bash
cd ../MODULO-PY
uv run python -m motor.actualizar_lista_negra
```

This writes `motor/datos/lista_negra_feed.txt` (currently ~300 OpenPhish
URLs in this checkout). The backend picks it up on next process start
(motor caches its lists in-process). It is **not** downloaded automatically
at request time or on backend startup -- refresh it manually, on a
schedule you control.

### URLhaus malware-URL feed and `malware_host` rule

Separately from the motor's own blacklist, `app/services/feeds.py` lazily
loads a second, independent feed: [URLhaus](https://urlhaus.abuse.ch/)
(abuse.ch), a public list of URLs currently distributing malware. It's
stored at `backend/data/urlhaus.txt` (gitignored -- only `backend/data/
.gitkeep` is committed) and matched in `app/services/rules.py`'s
`malware_host` rule (weight 1.0, category `malicious`), which does **not**
short-circuit like the motor's own blacklist but flows through the normal
`max(rule weight, ML score)` scoring like `reputation_flagged`/
`pirate_streaming`. Missing the feed file is never an error -- the rule
simply never fires until the feed is fetched.

Refresh it manually (or on a schedule you control):

```bash
cd backend
uv run python -m app.scripts.update_feeds
```

Downloads the current URLhaus recent-URLs text feed, writes it atomically
(temp file + rename) to `backend/data/urlhaus.txt`, and reloads the
in-process cache. Configurable via the `URLHAUS_FEED_PATH` env var.

## Run

```bash
uv run uvicorn app.main:app --reload --port 8000
```

## Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `ML_MODULE_PATH` | `<repo>/MODULO-PY` | Filesystem path to the ML module (predict.py, features.py, models/). |
| `EXTRA_CORS_ORIGINS` | (empty) | Comma-separated list of extra allowed CORS origins, added on top of the built-in `chrome-extension://*` / `localhost` / `127.0.0.1` regex. |
| `OLLAMA_URL` | `http://localhost:11434` | Base URL of the Ollama server used by `POST /api/chat` (layer B). |
| `OLLAMA_MODEL` | `nemotron-3-nano:30b-cloud` | Ollama model name. Runs on Ollama Cloud (chosen for the demo machine's 8 GB RAM): chat text sent to layer B leaves the device, but only the user's question plus the already-verified signals, never the raw analyzed URL/message from layer A. |
| `OLLAMA_TIMEOUT_S` | `8` | Request timeout (seconds) for Ollama calls. On timeout or any error, `/api/chat` falls back to `{"answer": null, "fallback": true}` instead of failing. |
| `GOOGLE_SAFE_BROWSING_API_KEY` | (unset) | Enables the optional Google Safe Browsing v4 Lookup reputation source (`app/services/reputation.py`). Unset by default: no network call is ever made. Get a key at Google Cloud Console → enable "Safe Browsing API". |
| `SAFE_BROWSING_TIMEOUT_S` | `2` | Request timeout (seconds) for Safe Browsing calls. On timeout or any error, the lookup degrades to `"unavailable"` instead of failing `/api/analyze`. |

## API

### `GET /api/health`

```json
{ "status": "ok", "model_version": "4c" }
```

### `POST /api/analyze`

Request:

```bash
curl -s -X POST localhost:8000/api/analyze \
  -H 'content-type: application/json' \
  -d '{"url": "http://mercad0pago.com.ar"}'
```

Response:

```json
{
  "url": "http://mercad0pago.com.ar",
  "level": "danger",
  "score": 0.95,
  "category": "impersonation",
  "reasons": [
    "El dominio imita a Mercado Pago (mercadopago.com.ar)",
    "La conexión no es segura (HTTP sin cifrado)",
    "El dominio es inusualmente largo",
    "El dominio tiene muchos números"
  ],
  "tip": "Entrá siempre escribiendo la dirección oficial, nunca desde un link que te enviaron.",
  "ml": {
    "probability": 0.5041827088330316,
    "threshold": 0.9,
    "flagged": false,
    "top_features": ["longitud_dominio", "cant_digitos", "tld_ar"]
  },
  "rules": [
    { "id": "brand_lookalike", "weight": 0.9 },
    { "id": "insecure_http", "weight": 0.2 }
  ],
  "details": {
    "blacklist": false,
    "whitelist": false,
    "ml_probability": 0.5041827088330316,
    "reputation": "unavailable"
  }
}
```

The URL scheme is optional (`mercad0pago.com.ar` works). Empty, overlong
(>2048 chars) or hostless input returns `422`.

`level` is `safe` (score < 0.4), `caution` (0.4-0.7) or `danger` (> 0.7).
`category` is `impersonation`, `suspicious_domain`, `hidden_destination`,
`insecure`, `blacklisted` (T8: an exact match in the motor's blacklist),
`risky_site` (pirate-streaming family marker), `malicious` (Google Safe
Browsing match) or `none`.

`details` (T8, additive) is machine-readable, for clients that don't want to
parse `reasons`/`rules`: `blacklist`/`whitelist` are whether the motor's
lists matched, `ml_probability` mirrors `ml.probability`, and `reputation`
is `"flagged"` / `"clean"` / `"unavailable"` from the optional Safe
Browsing lookup (see "Pirate-streaming sites and reputation" above).

### `POST /api/analyze-text`

Scores a free-text message (SMS, WhatsApp, e-mail) for scam red flags:
Spanish keyword/brand signals plus the same URL analyzer above for any link
found inside the text. Request `{ "text": "..." }` (1-5000 chars, non-blank
after stripping, else 422). Response keeps the `/api/analyze` shape (`level`,
`score`, `category`, `reasons`, `tip`) plus `signals` (fired red flags with
the matched evidence snippet from the original text), `lessons` (one lesson
per fired signal / URL category, from `GET /api/lessons`), and `urls`
(`AnalyzeResponse` for every link found in the text, reusing `/api/analyze`).

Signal ids: `urgency`, `credential_request`, `money_request`, `prize`,
`brand_mention`, `suspicious_link`, `impersonal_greeting`. Matching is
accent- and case-insensitive. A single weak signal never reaches `danger`
(its score is capped at 0.6).

Danger example:

```bash
curl -s -X POST localhost:8000/api/analyze-text \
  -H 'content-type: application/json' \
  -d '{"text": "URGENTE: Estimado cliente, tu cuenta de Mercado Pago será SUSPENDIDA. Ingresá tu clave en http://mercadopago-reintegros.com"}'
```

```json
{
  "level": "danger",
  "score": 1.0,
  "category": "impersonation",
  "reasons": [
    "Usa apuro y urgencia para que no pienses antes de actuar.",
    "Te pide una clave o código: ningún banco lo hace por mensaje.",
    "Te saluda de forma genérica ('estimado cliente'), no por tu nombre.",
    "Menciona una marca conocida: verificá que sea realmente su canal oficial.",
    "Incluye un link que nuestro análisis considera sospechoso."
  ],
  "tip": "No respondas ni hagas clic: verificá por los canales oficiales antes de hacer nada.",
  "signals": [
    { "id": "urgency", "evidence": "URGENTE" },
    { "id": "credential_request", "evidence": "clave" },
    { "id": "impersonal_greeting", "evidence": "Estimado cliente" },
    { "id": "brand_mention", "evidence": "Mercado Pago" },
    { "id": "suspicious_link", "evidence": "http://mercadopago-reintegros.com" }
  ],
  "lessons": [ /* urgency, credential_request, brand_impersonation, suspicious_link, impersonal_greeting, fake_domain */ ],
  "urls": [
    {
      "url": "http://mercadopago-reintegros.com",
      "level": "danger",
      "score": 1.0,
      "category": "blacklisted",
      "reasons": ["Este dominio está en nuestra lista negra de sitios reportados como fraudulentos (mercadopago-reintegros.com)"],
      "tip": "Este sitio fue reportado como fraudulento: no ingreses datos ni sigas navegando en él.",
      "ml": { "probability": 0.352, "threshold": 0.9, "flagged": false, "top_features": ["cant_guiones", "longitud_dominio", "entropia_dominio"] },
      "rules": [{ "id": "blacklisted", "weight": 1.0 }],
      "details": { "blacklist": true, "whitelist": false, "ml_probability": 0.352 }
    }
  ]
}
```

Caution example (`{"text": "Pasame tu alias para hacer la transferencia"}`):

```json
{
  "level": "caution",
  "score": 0.4,
  "category": "social_engineering",
  "reasons": ["Te pide plata, un CBU/alias o una transferencia."],
  "tip": "Revisá bien antes de responder o hacer clic; ante la duda, verificá por canales oficiales.",
  "signals": [{ "id": "money_request", "evidence": "alias" }],
  "lessons": [{ "id": "money_request", "icon": "💸", "title": "Te piden plata o datos para transferir", "..." : "..." }],
  "urls": []
}
```

Safe example (`{"text": "Hola, como estas? Nos vemos mañana"}`):

```json
{
  "level": "safe",
  "score": 0.0,
  "category": "none",
  "reasons": [],
  "tip": "No se detectaron señales de estafa, pero igual revisá antes de compartir datos personales.",
  "signals": [],
  "lessons": [],
  "urls": []
}
```

### `GET /api/lessons`

Returns the static red-flag lesson catalog (12 lessons, Spanish, `id, icon,
title, how_to_spot, example, what_to_do`), each ≤ 60 words across
`how_to_spot` + `what_to_do`:

```bash
curl -s localhost:8000/api/lessons
```

```json
[
  {
    "id": "urgency",
    "icon": "⏰",
    "title": "Te apuran para que no pienses",
    "how_to_spot": "Si un mensaje dice que tenés que actuar YA o perdés algo (tu cuenta, tu plata, un premio), es una señal de alarma: los apuros buscan que no pares a pensar.",
    "example": "\"URGENTE: tu cuenta de Mercado Pago será suspendida en 24 horas.\"",
    "what_to_do": "Respirá y no hagas clic todavía. Entrá a la app o al sitio oficial escribiendo vos la dirección, sin usar el link del mensaje."
  }
  /* ... 11 more: credential_request, money_request, prize, brand_impersonation,
     suspicious_link, impersonal_greeting, fake_domain, hidden_link, insecure_site,
     risky_streaming, malicious_site */
]
```

### `POST /api/chat`

Layer B: a grounded LLM answer via Ollama, additive to layer A above. The
LLM never decides risk -- it only rephrases the evidence it is given (or,
with no context, the lessons closest to the question) and always ends with
one concrete tip taken from that evidence. Request:

```json
{
  "message": "...",
  "context": {
    "level": "danger",
    "category": "impersonation",
    "url": "http://bna-verificacion.xyz",
    "reasons": ["El sitio imita a un banco pero no es su dirección oficial."],
    "signals": [{"id": "credential_request", "evidence": "..."}],
    "page_signals": [{"id": "popups", "reason": "..."}]
  },
  "history": [{"role": "user", "text": "..."}, {"role": "assistant", "text": "..."}]
}
```

`message` (1-2000 chars, non-blank, else 422), `context` (optional; `url`/
`category` optional strings, `reasons` up to 12 entries of up to 300 chars
each, `page_signals` up to 20 entries) and `history` (optional, up to 6
prior turns of up to 600 chars each, used as short-term memory for
follow-up questions) are all bounded so a pathological payload can't blow
up the prompt.

```bash
curl -s -X POST localhost:8000/api/chat \
  -H 'content-type: application/json' \
  -d '{"message": "¿Qué hago si me piden la clave por WhatsApp?", "context": {"level": "danger", "signals": [{"id": "credential_request", "evidence": "pasame tu clave"}, {"id": "urgency", "evidence": "urgente"}]}}'
```

```json
{
  "answer": "No compartas tu clave con nadie. Nadie de confianza te pedirá esa info vía WhatsApp. Si te lo piden, cortá el chat al instante. Entrá a la app directamente y verificá si hay realmente un problema.",
  "fallback": false
}
```

If Ollama is unreachable, returns an error, invalid JSON, or takes longer
than `OLLAMA_TIMEOUT_S` (default 8s), the endpoint still answers `200` with:

```json
{ "answer": null, "fallback": true }
```

**Grounding guard (`app.services.llm.is_grounded`):** after Ollama
responds, the answer is checked for any capitalized brand/company/service
name that isn't backed by the given evidence (`url`/`category`/`reasons`/
`signals`/`page_signals`), our own lesson copy, an official brand from the
motor whitelist, or a small list of well-known global brands (WhatsApp,
Google, Mercado Pago, etc.). An ungrounded answer (e.g. inventing a
recommended streaming service that was never part of the evidence) is
treated the same as any other failure -- `{"answer": null, "fallback":
true}` -- so layer A always stands on its own rather than showing a
hallucinated answer.

No message content, URL, verdict or history is ever logged or persisted.

### `POST /api/analyze-page`

Enriches a base URL verdict with page-behavior signals collected entirely
in-browser by the extension's content scripts (`frontend/src/extension/
page-probe.ts` / `page-probe-main.ts`) -- never page HTML, script text, or
cookie values themselves, only booleans/counts/matched-network-name lists.
Request:

```json
{
  "url": "https://example.com/",
  "signals": {
    "malvertising": ["popads.net"],
    "cryptominer": true,
    "obfuscated_js": 1,
    "hidden_iframes": 1,
    "insecure_password_form": false,
    "cross_site_password_form": false,
    "notification_prompt": false,
    "popups": 0,
    "offsite_meta_refresh": false,
    "third_party_domains": 2,
    "tracker_cookies": 0,
    "popups_opened": 0,
    "forced_redirects": 0,
    "notification_permission_granted": false
  }
}
```

`popups_opened`, `forced_redirects` and `notification_permission_granted`
come from the extension's always-on "portero" behavior watcher
(`frontend/src/extension/behaviorWatcher.ts`) -- counted purely from
`chrome.webNavigation`/`chrome.tabs` events (new tabs a page opened, forced
client/server redirects on its own navigation), never from page content,
and only ever sent to this endpoint after the user has explicitly
consented to scan that page (see `DEMO.md`'s "Consentimiento y
privacidad"). Rules: `popups_opened >= 2` (weight 0.5, risky_site),
`forced_redirects >= 1` (weight 0.4, suspicious_domain),
`notification_permission_granted` (weight 0.35, risky_site) --
`app/services/page_rules.py`.

Response extends `/api/analyze`'s shape with `page_signals` (fired
page-level red flags, scoring or info-only, each `{id, reason}`) and
`lessons` (one lesson per fired page rule, from `GET /api/lessons`).
`signals` is optional and every field defaults to its inert
value (`false`/`0`/`[]`), so `{"url": "..."}` alone behaves exactly like
`/api/analyze` plus empty `page_signals`/`lessons`.

Page rules mirror `/api/analyze`'s "max weight + combo bonus" shape, with a
larger per-extra-rule bonus (0.15) since independent live-page evidence
corroborates the URL verdict more strongly than another URL-only
heuristic. `tracker_cookies` alone is never a scoring signal -- too weak
and common on legitimate sites -- it only ever produces an info-only
`page_signals` entry with no lesson attached and no effect on
`level`/`score`/`category`. A whitelisted official domain's forced-`safe`
verdict is never overridden by page signals (`page_signals`/`lessons` come
back empty for it, same "official site using analytics/ads infra must
stay safe" behavior as `/api/analyze`).

```bash
curl -s -X POST localhost:8000/api/analyze-page \
  -H 'content-type: application/json' \
  -d '{"url": "http://example-scam-site.invalid/", "signals": {"malvertising": ["popads.net"], "cryptominer": true, "obfuscated_js": 1, "hidden_iframes": 1}}'
```

## How scoring works

1. The ML probability is rescaled so the model's own 0.90 threshold lands at
   0.70 (the caution/danger boundary), putting both signals on one scale.
2. The final score is `max(strongest rule weight, rescaled ML score)`, plus a
   small bonus when several rules fire together (capped at 1.0).
3. A shortened link caps its ML contribution so a bare shortener alone stays
   in "caution", never "danger".
4. Official domains (and any of their subdomains) are force-capped to
   "safe", since the ML model alone flags some of them.
5. `category` follows the strongest fired rule; `reasons` combine rule text
   with translated top ML features, deduplicated and capped at four.
6. Several rules look at the *full* URL (host + path + query), which the ML
   model never sees: `suspicious_tld` (registrable domain's TLD),
   `scam_keywords` (words like "verificar"/"homebanking"), `brand_mention`
   (a bare brand mention in the path), `explicit_port` and `at_symbol`
   ("@" hiding the real destination host) are weak on their own and
   score-capped so they can never combine into "danger" by themselves --
   only alongside a stronger rule (e.g. brand impersonation) do they
   reinforce it. A cautious ML-only reason sentence is added when the
   model's own probability is at/above its threshold.
7. A blacklist hit (T8) short-circuits straight to `danger` / score `1.0` /
   category `blacklisted`, with a single reason -- symmetric to the
   whitelist short-circuit to `safe`.
8. A pirate-streaming family-marker match (`pirate_streaming`, weight 0.85)
   or a Safe Browsing reputation match (`reputation_flagged`, weight 1.0)
   are neither weak signals nor whitelist/blacklist short-circuits -- they
   flow through the normal `max(rule weight, ML score)` scoring like any
   other rule, so a genuinely high ML score can only ever push the final
   score up, never down below what these rules already guarantee.

## Privacy

Analyzed URLs, messages and chat questions are never logged or persisted;
there is no request-content logging and no storage layer. `POST /api/chat`
sends only the user's question plus the already-verified `level`/`signals`
to Ollama (see `OLLAMA_MODEL` above) -- never raw analyzed URLs or messages.

## Tests

```bash
uv run pytest -q
```
