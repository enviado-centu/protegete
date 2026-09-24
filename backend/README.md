# Phishing Link Analyzer API

FastAPI backend that scores a URL for phishing risk, combining the team's
trained ML model with a deterministic rules engine focused on Argentine
brand impersonation. Built for a browser extension / PWA client.

## Setup

```bash
cd backend
uv sync
```

Requires the sibling `MODULO-PY-modelo-ml/MODULO-PY-modelo-ml` folder (the
trained model + feature extraction code) to be present at the repo root;
this backend imports it read-only and never modifies it.

## Run

```bash
uv run uvicorn app.main:app --reload --port 8000
```

## Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `ML_MODULE_PATH` | `<repo>/MODULO-PY-modelo-ml/MODULO-PY-modelo-ml` | Filesystem path to the ML module (predict.py, features.py, models/). |
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
  ]
}
```

The URL scheme is optional (`mercad0pago.com.ar` works). Empty, overlong
(>2048 chars) or hostless input returns `422`.

`level` is `safe` (score < 0.4), `caution` (0.4-0.7) or `danger` (> 0.7).
`category` is `impersonation`, `suspicious_domain`, `hidden_destination`,
`insecure` or `none`.

## How scoring works (5 lines)

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

## Privacy

Analyzed URLs are never logged or persisted; there is no request-content
logging and no storage layer.

## Tests

```bash
uv run pytest -q
```
