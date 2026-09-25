import type { Category, Lesson, Level, UrlVerdict, Verdict } from './types'
import { isTextVerdict } from './types'

export type InputKind = 'url' | 'text' | 'question'

// A single token (no whitespace) that looks like a scheme URL, a www host,
// or a bare domain (label.label...).
const URL_TOKEN_RE = /^(https?:\/\/\S+|www\.\S+|[a-z0-9-]+(\.[a-z0-9-]+)+)$/i
const HAS_URL_RE = /(https?:\/\/\S+|www\.\S+)/i
const QUESTION_START_RE =
  /^¿?\s*(c[oó]mo|qu[eé]|por qu[eé]|es seguro)\b/i

/**
 * Classifies free-form chat input so the engine knows which backend
 * endpoint (or lesson lookup) to use next.
 */
export function classifyInput(raw: string): InputKind {
  const input = raw.trim()
  if (!input) return 'text'

  const hasWhitespace = /\s/.test(input)
  if (!hasWhitespace && URL_TOKEN_RE.test(input)) {
    return 'url'
  }

  const hasUrl = HAS_URL_RE.test(input)
  if (!hasUrl && input.length < 120) {
    const endsWithQuestionMark = input.endsWith('?')
    const startsWithQuestionWord = QUESTION_START_RE.test(input)
    if (endsWithQuestionMark || startsWithQuestionWord) {
      return 'question'
    }
  }

  return 'text'
}

function normalize(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
}

const STOPWORDS = new Set([
  'que',
  'como',
  'por',
  'para',
  'con',
  'una',
  'uno',
  'los',
  'las',
  'del',
  'que',
  'soy',
  'tal',
  'esta',
  'estas',
  'este',
  'ese',
])

function tokenize(value: string): string[] {
  return normalize(value)
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 2 && !STOPWORDS.has(token))
}

/**
 * Ranks `lessons` by keyword overlap with `question` (accent/case
 * insensitive). Falls back to the catalog's first `n` entries when nothing
 * overlaps, so the chat never answers a free question with an empty list.
 */
export function matchLessons(
  question: string,
  lessons: Lesson[],
  n = 3,
): Lesson[] {
  const questionTokens = new Set(tokenize(question))
  const scored = lessons.map((lesson) => {
    const haystack = tokenize(
      `${lesson.title} ${lesson.how_to_spot} ${lesson.what_to_do}`,
    )
    const score = haystack.reduce(
      (acc, token) => acc + (questionTokens.has(token) ? 1 : 0),
      0,
    )
    return { lesson, score }
  })
  const overlapping = scored
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
  const ranked = overlapping.length > 0 ? overlapping : scored
  return ranked.slice(0, n).map((entry) => entry.lesson)
}

/** Maps a URL verdict `category` to the lesson id it teaches (Task 1 contract). */
export const CATEGORY_TO_LESSON_ID: Partial<Record<Category, string>> = {
  impersonation: 'brand_impersonation',
  suspicious_domain: 'fake_domain',
  hidden_destination: 'hidden_link',
  insecure: 'insecure_site',
  blacklisted: 'fake_domain',
  risky_site: 'risky_streaming',
  malicious: 'malicious_site',
}

const VERDICT_WORD: Record<Level, string> = {
  safe: 'Parece seguro',
  caution: 'Cuidado',
  danger: 'Peligroso',
}

const VERDICT_ICON: Record<Level, string> = {
  safe: '✅',
  caution: '⚠️',
  danger: '⛔',
}

// One plain-language sentence per level, independent of the reasons list
// below it (never repeats the first bullet — spec §4b).
const SUMMARY_BY_LEVEL: Record<Level, string> = {
  safe: 'No encontramos señales de estafa, pero siempre conviene revisar.',
  caution: 'Hay señales sospechosas. Revisalo con calma antes de seguir.',
  danger: 'Esto tiene señales claras de estafa. No ingreses datos ni hagas clic.',
}

const QUICK_CHIPS = ['¿Cómo lo reconozco?', '¿Qué hago ahora?']

/** Lesson id (see backend `lessons.py`) for the "already scammed" recovery
 * guide, and the chat copy that introduces it. */
export const ALREADY_SCAMMED_LESSON_ID = 'already_scammed'
export const ALREADY_SCAMMED_INTRO = 'Tranqui, actuemos rápido. Hacé esto ahora, en este orden:'

/** Entry point shown as an extra chip on a `danger` verdict (spec: "Danger
 * verdict entry point"). Reuses the same trigger path as a typed phrase --
 * see `isAlreadyScammedTrigger`'s caller in `Chat.tsx`. */
export const DANGER_RECOVERY_CHIP = '¿Ya pusiste tus datos? Qué hacer ahora'

// Deterministic (layer A) phrases that mean "I already fell for a scam":
// each pattern pairs a self-report verb/phrase with its most likely object,
// so a stray "estafa" or "código" in an unrelated question doesn't misfire.
// Matched against `normalize(text)` (accent/case-insensitive).
const ALREADY_SCAMMED_PATTERNS: RegExp[] = [
  /\bya\s+(puse|di|pase|comparti|entregue)\b[\s\S]{0,25}\b(datos|clave|contrasena|codigo|tarjeta)\b/,
  /\bme\s+estafaron\b/,
  /\b(cai|caiste|cayo)\b[\s\S]{0,15}\b(estafa|trampa|engano)\b/,
  /\bme\s+robaron\b[\s\S]{0,20}\b(cuenta|whatsapp|plata|tarjeta)\b/,
  /\ble[s]?\s+pase\b[\s\S]{0,15}\bcodigo\b/,
  /\bya\s+(hice|realice)\b[\s\S]{0,15}\btransferencia\b/,
  /\bme\s+hackearon\b/,
]

/** True when `raw` reports the user already fell for a scam (spec: layer A
 * trigger, no LLM needed). Takes precedence over normal URL/text analysis in
 * `Chat.tsx`. */
export function isAlreadyScammedTrigger(raw: string): boolean {
  const text = normalize(raw)
  return ALREADY_SCAMMED_PATTERNS.some((pattern) => pattern.test(text))
}

/** True when `raw` contains a URL anywhere in it (not just as the whole
 * input) -- used to decide whether the normal analysis pipeline should still
 * run after the recovery guide (spec: "if the message ALSO contains a URL,
 * still show the guide first and keep the existing analysis behavior"). */
export function containsUrl(raw: string): boolean {
  return HAS_URL_RE.test(raw)
}

export interface Reply {
  level: Level
  word: string
  icon: string
  summary: string
  reasons: string[]
  lessons: Lesson[]
  chips: string[]
  /** URL verdicts referenced by this reply (the verdict itself for a URL
   * input, or the URLs found inside an analyzed text message). */
  urls: UrlVerdict[]
}

/**
 * Builds the deterministic "layer A" chat reply from a URL or text verdict.
 * `lessonsCatalog` is only needed for URL verdicts (which carry a category,
 * not lesson objects) so their category can be mapped to a full lesson.
 */
export function buildReplyA(
  verdict: Verdict,
  lessonsCatalog: Lesson[] = [],
): Reply {
  const level = verdict.level
  const reasons = verdict.reasons
  const summary = SUMMARY_BY_LEVEL[level]

  let lessons: Lesson[]
  let urls: UrlVerdict[]
  if (isTextVerdict(verdict)) {
    lessons = verdict.lessons
    urls = verdict.urls
  } else {
    const lessonId = CATEGORY_TO_LESSON_ID[verdict.category]
    lessons = lessonId
      ? lessonsCatalog.filter((lesson) => lesson.id === lessonId)
      : []
    urls = [verdict]
  }

  return {
    level,
    word: VERDICT_WORD[level],
    icon: VERDICT_ICON[level],
    summary,
    reasons,
    lessons,
    chips: level === 'danger' ? [...QUICK_CHIPS, DANGER_RECOVERY_CHIP] : QUICK_CHIPS,
    urls,
  }
}
