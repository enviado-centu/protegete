import type {
  AnalyzePageResult,
  ChatAnswer,
  ChatContext,
  Lesson,
  PageSignals,
  TextVerdict,
  UrlVerdict,
} from './types'

// Empty string means "same origin": requests become relative (`/api/...`),
// which a Vite dev/preview proxy (see server.proxy in vite.config.ts) or a
// same-origin deployment can serve without knowing the backend's host.
// The extension build has no dev server, so it overrides this at build time
// via `define` in vite.extension.config.ts to always target localhost:8000.
export const API_BASE: string = (import.meta.env.VITE_API_BASE as string | undefined) ?? ''

/** Thrown when the backend cannot be reached at all (network/CORS/offline). */
export class ApiUnavailableError extends Error {
  constructor(message = 'No pude conectarme al analizador.') {
    super(message)
    this.name = 'ApiUnavailableError'
  }
}

/** Thrown on HTTP 422 (invalid input rejected by the backend). */
export class ApiValidationError extends Error {
  constructor(message = 'Ese contenido no es válido.') {
    super(message)
    this.name = 'ApiValidationError'
  }
}

async function post<T>(path: string, body: unknown): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch {
    throw new ApiUnavailableError()
  }
  return handle<T>(response)
}

async function get<T>(path: string): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${API_BASE}${path}`)
  } catch {
    throw new ApiUnavailableError()
  }
  return handle<T>(response)
}

async function handle<T>(response: Response): Promise<T> {
  if (response.status === 422) {
    throw new ApiValidationError()
  }
  if (!response.ok) {
    throw new ApiUnavailableError()
  }
  return (await response.json()) as T
}

export function analyzeUrl(url: string): Promise<UrlVerdict> {
  return post<UrlVerdict>('/api/analyze', { url })
}

export function analyzeText(text: string): Promise<TextVerdict> {
  return post<TextVerdict>('/api/analyze-text', { text })
}

/**
 * Sends page content signals collected entirely in-browser (Feature C) for
 * enrichment. Only the booleans/counts/matched-name lists in `signals` are
 * sent — never page HTML/script text or cookie values.
 */
export function analyzePage(url: string, signals: PageSignals): Promise<AnalyzePageResult> {
  return post<AnalyzePageResult>('/api/analyze-page', { url, signals })
}

export function getLessons(): Promise<Lesson[]> {
  return get<Lesson[]>('/api/lessons')
}

export function askChat(
  message: string,
  context?: ChatContext | null,
): Promise<ChatAnswer> {
  return post<ChatAnswer>('/api/chat', { message, context: context ?? null })
}
