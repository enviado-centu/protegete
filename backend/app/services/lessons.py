"""Static red-flag lesson catalog (Task 1 of the antiscam-chat-pwa-extension plan).

Each lesson teaches one red flag a scam message or link can show: how to spot
it, a realistic Argentine example, and what to do about it. Content is
Spanish, warm and plain-language for all ages (kids to seniors); each
lesson's `how_to_spot` + `what_to_do` stays at or under 60 words combined
(enforced by `backend/tests/test_lessons.py`).

`Lesson` ids are consumed by `app.services.text_analyzer` (one id per fired
signal) and by the URL category map below (each `AnalyzeResponse.category`
maps to a lesson id, see `URL_CATEGORY_TO_LESSON_ID`).
"""

from __future__ import annotations

from collections.abc import Iterable

from pydantic import BaseModel


class Lesson(BaseModel):
    """One red-flag lesson shown alongside a verdict."""

    id: str
    icon: str
    title: str
    how_to_spot: str
    example: str
    what_to_do: str


# Maps a URL-analyzer category (AnalyzeResponse.category) to the lesson id
# that best explains it, per the plan's Task 1 interfaces table.
URL_CATEGORY_TO_LESSON_ID: dict[str, str] = {
    "impersonation": "brand_impersonation",
    "suspicious_domain": "fake_domain",
    "hidden_destination": "hidden_link",
    "insecure": "insecure_site",
    "blacklisted": "fake_domain",
}

_LESSONS: tuple[Lesson, ...] = (
    Lesson(
        id="urgency",
        icon="⏰",
        title="Te apuran para que no pienses",
        how_to_spot=(
            "Si un mensaje dice que tenés que actuar YA o perdés algo (tu cuenta, tu plata, un "
            "premio), es una señal de alarma: los apuros buscan que no pares a pensar."
        ),
        example='"URGENTE: tu cuenta de Mercado Pago será suspendida en 24 horas."',
        what_to_do=(
            "Respirá y no hagas clic todavía. Entrá a la app o al sitio oficial escribiendo vos "
            "la dirección, sin usar el link del mensaje."
        ),
    ),
    Lesson(
        id="credential_request",
        icon="🔑",
        title="Te piden tu clave o código",
        how_to_spot=(
            "Ningún banco, billetera virtual o empresa te pide tu clave, PIN, CVV o el código "
            "que te llega por SMS. Si te lo piden, es un engaño."
        ),
        example='"Para verificar tu cuenta, ingresá tu clave y el código de verificación."',
        what_to_do="No lo compartas por ningún medio. Cortá la conversación y avisá a tu banco por sus canales oficiales.",
    ),
    Lesson(
        id="money_request",
        icon="💸",
        title="Te piden plata o datos para transferir",
        how_to_spot=(
            "Desconfiá si te piden un CBU, CVU, alias o una transferencia/seña para 'liberar' "
            "un pago, un premio o evitar un problema."
        ),
        example='"Transferí $500 de seña a este alias para recibir tu reintegro de ANSES."',
        what_to_do="No transfieras nada. Los organismos oficiales nunca cobran para darte algo que ya te corresponde.",
    ),
    Lesson(
        id="prize",
        icon="🎁",
        title="Ganaste algo que nunca jugaste",
        how_to_spot=(
            "Si te avisan que ganaste un sorteo, un premio o un reintegro sin haber participado, "
            "es casi siempre un anzuelo para tus datos."
        ),
        example='"¡Felicitaciones! Ganaste un premio de Correo Argentino, hacé clic para reclamarlo."',
        what_to_do="No hagas clic ni compartas datos. Si dudás, buscá el sitio oficial de la empresa y consultá ahí.",
    ),
    Lesson(
        id="brand_impersonation",
        icon="🏦",
        title="Se hace pasar por una empresa conocida",
        how_to_spot=(
            "Usa el nombre y el logo de un banco o empresa conocida, pero el link no es su "
            "dirección oficial (letras cambiadas, palabras de más)."
        ),
        example='Un mensaje "del BNA" que en realidad viene de bna-verificacion.xyz.',
        what_to_do="Fijate bien la dirección antes de entrar. Ante la duda, escribí vos la dirección oficial en el navegador.",
    ),
    Lesson(
        id="suspicious_link",
        icon="🔗",
        title="El link no lleva a donde dice",
        how_to_spot=(
            "El texto del link o del mensaje no coincide con la dirección real a la que apunta, "
            "o usa una dirección rara para hacerse pasar por otra."
        ),
        example='"Ingresá a mercadopago-reintegros.com para cobrar tu reintegro."',
        what_to_do="No lo toques. Entrá directamente desde la app oficial o escribiendo vos la dirección conocida.",
    ),
    Lesson(
        id="impersonal_greeting",
        icon="👤",
        title="No te llama por tu nombre",
        how_to_spot=(
            'Un saludo genérico como "Estimado cliente" en vez de tu nombre suele indicar un '
            "envío masivo, no un mensaje real de tu banco."
        ),
        example='"Estimado cliente, su cuenta presenta una irregularidad."',
        what_to_do="Tomalo como una señal más de alerta y verificá por los canales oficiales antes de responder.",
    ),
    Lesson(
        id="fake_domain",
        icon="🌐",
        title="La dirección del sitio es rara",
        how_to_spot=(
            "Terminaciones poco comunes (.xyz, .top, .info), muchos guiones o números, o "
            "palabras como 'verificar' agregadas al nombre real son señales de un sitio falso."
        ),
        example='"bancoprovincia-verificacion.xyz" en vez de "bancoprovincia.com.ar".',
        what_to_do="No ingreses tus datos ahí. Buscá la dirección oficial en un buscador o en un mensaje anterior confiable.",
    ),
    Lesson(
        id="hidden_link",
        icon="🕵️",
        title="El link acorta o esconde el destino",
        how_to_spot=(
            "Los acortadores (bit.ly y similares) ocultan a dónde te llevan de verdad. No es "
            "malo por sí solo, pero conviene desconfiar si viene de un desconocido."
        ),
        example='"Mirá esto: bit.ly/3xY9z" enviado por WhatsApp de un número desconocido.',
        what_to_do="Si podés, pasá el mouse por encima para ver el destino, o mejor, no lo abras si no esperabas ese mensaje.",
    ),
    Lesson(
        id="insecure_site",
        icon="🔓",
        title="El sitio no es seguro",
        how_to_spot=(
            "Si la dirección empieza con 'http://' en vez de 'https://', la conexión no está "
            "cifrada: cualquiera podría ver lo que escribís ahí."
        ),
        example='"http://correo-argentino-envios.com/seguimiento"',
        what_to_do="Evitá cargar datos personales o contraseñas en sitios sin 'https://' y candado en la barra de direcciones.",
    ),
)

_LESSONS_BY_ID: dict[str, Lesson] = {lesson.id: lesson for lesson in _LESSONS}


def all_lessons() -> list[Lesson]:
    """Returns every lesson in catalog order."""
    return list(_LESSONS)


def lessons_for(ids: Iterable[str]) -> list[Lesson]:
    """Returns the lessons for the given ids, deduplicated, in catalog order.

    Unknown ids are silently ignored.
    """
    wanted = set(ids)
    return [lesson for lesson in _LESSONS if lesson.id in wanted]
