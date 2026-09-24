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
normalization or edit distance), the plain HTTP check, and a small,
explicitly documented fallback brand list (`GLOBAL_BRANDS` in `rules.py`)
for global tech brands the motor's Argentine-focused whitelist doesn't
carry at all (google, paypal, microsoft, apple, netflix, whatsapp,
instagram, facebook) -- without it, `docs.google.com` would lose its
whitelist short-circuit. See the module docstring in `rules.py` for the
full rule-by-rule overlap map.

### Refreshing the blacklist feed

The optional OpenPhish feed is downloaded (not committed) from inside
`MODULO-PY`, not from this backend:

```bash
cd ../MODULO-PY
uv run python -m motor.actualizar_lista_negra
```

This writes `motor/datos/lista_negra_feed.txt`. The backend picks it up on
next process start (motor caches its lists in-process).

## Run

```bash
uv run uvicorn app.main:app --reload --port 8000
```

## Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `ML_MODULE_PATH` | `<repo>/MODULO-PY` | Filesystem path to the ML module (predict.py, features.py, models/). |
| `EXTRA_CORS_ORIGINS` | (empty) | Comma-separated list of extra allowed CORS origins, added on top of the built-in `chrome-extension://*` / `localhost` / `127.0.0.1` regex. |

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
    "ml_probability": 0.5041827088330316
  }
}
```

The URL scheme is optional (`mercad0pago.com.ar` works). Empty, overlong
(>2048 chars) or hostless input returns `422`.

`level` is `safe` (score < 0.4), `caution` (0.4-0.7) or `danger` (> 0.7).
`category` is `impersonation`, `suspicious_domain`, `hidden_destination`,
`insecure`, `blacklisted` (T8: an exact match in the motor's blacklist) or
`none`.

`details` (T8, additive) is machine-readable, for clients that don't want to
parse `reasons`/`rules`: `blacklist`/`whitelist` are whether the motor's
lists matched, and `ml_probability` mirrors `ml.probability`.

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

## Privacy

Analyzed URLs are never logged or persisted; there is no request-content
logging and no storage layer.

## Tests

```bash
uv run pytest -q
```
