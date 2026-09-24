"""Lazy adapter around the teammate's MODULO-PY/motor package.

`motor/listas.py` (whitelist + blacklist) and `motor/reglas.py` (deterministic
rules with ready-made Spanish reasons) are the PRIMARY source of lists and
rules for the analyzer (see odd/tasks/backend-analyze-api.md, T8). This
module is the only place that imports `motor.*`: it exposes a small typed
interface so the rest of the backend never touches the motor package's own
data shapes (dicts, dataclasses defined in Spanish) directly.

Like `ml_model.RealPhishingModel`, the MODULO-PY folder is inserted into
`sys.path` lazily (on first use), using the same `get_ml_module_path()`
mechanism, so importing this adapter module has no import-time side effect.
MODULO-PY is a separate git clone and is read-only: this module never writes
to it.
"""

from __future__ import annotations

import sys
from dataclasses import dataclass

from app.config import get_ml_module_path


@dataclass(frozen=True)
class MotorBrand:
    """One official brand from the motor's whitelist (motor/datos/lista_blanca.json)."""

    id: str
    display_name: str
    domains: tuple[str, ...]


@dataclass(frozen=True)
class MotorSignal:
    """One fired rule from motor/reglas.py, already carrying a Spanish reason."""

    id: str
    points: int
    reason: str


@dataclass(frozen=True)
class BlacklistHit:
    """A blacklist match from motor/listas.py::esta_en_lista_negra."""

    kind: str  # "url" | "dominio"
    match: str


_motor_listas = None
_motor_reglas = None


def _ensure_loaded() -> None:
    """Inserts MODULO-PY on sys.path (once) and imports the motor submodules."""
    global _motor_listas, _motor_reglas
    if _motor_listas is not None:
        return
    module_path_str = str(get_ml_module_path())
    if module_path_str not in sys.path:
        sys.path.insert(0, module_path_str)
    from motor import listas as motor_listas  # type: ignore[import-not-found]
    from motor import reglas as motor_reglas  # type: ignore[import-not-found]

    _motor_listas = motor_listas
    _motor_reglas = motor_reglas


def is_whitelisted(url: str) -> bool:
    """True if the URL's registrable domain is an official brand domain."""
    _ensure_loaded()
    assert _motor_listas is not None
    return _motor_listas.es_oficial(url) is not None


def blacklist_hit(url: str) -> BlacklistHit | None:
    """The blacklist match for this URL (own list + feed, if present), or None."""
    _ensure_loaded()
    assert _motor_listas is not None
    hit = _motor_listas.esta_en_lista_negra(url)
    if hit is None:
        return None
    return BlacklistHit(kind=hit["tipo"], match=hit["coincidencia"])


def official_brands() -> tuple[MotorBrand, ...]:
    """All official brands from the motor's whitelist (id, display name, domains).

    Used by rules.py to run OUR homoglyph/fuzzy typosquat check
    (`brand_lookalike`) against the motor's own brand catalog, instead of
    hand-duplicating it -- the motor's `imitacion_marca` rule does not do
    homoglyph normalization or edit-distance matching (see T8 overlap map),
    so that check still needs to run, but the brand data itself has a single
    source of truth: the motor's lista_blanca.json.
    """
    _ensure_loaded()
    assert _motor_listas is not None
    marcas = _motor_listas.cargar_lista_blanca()
    return tuple(
        MotorBrand(id=marca_id, display_name=datos["nombre"], domains=tuple(datos["dominios"]))
        for marca_id, datos in marcas.items()
    )


def evaluate_signals(url: str) -> tuple[MotorSignal, ...]:
    """Every motor rule that fired, most points first (see motor/reglas.py)."""
    _ensure_loaded()
    assert _motor_reglas is not None
    return tuple(
        MotorSignal(id=senal.id, points=senal.puntos, reason=senal.frase)
        for senal in _motor_reglas.evaluar_reglas(url)
    )
