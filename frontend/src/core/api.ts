import type { ChatAnswer, ChatContext, Lesson, TextVerdict, UrlVerdict } from './types'

export const API_BASE: string =
  (import.meta.env.VITE_API_BASE as string | undefined) ?? 'http://localhost:8000'

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

export function getLessons(): Promise<Lesson[]> {
  return get<Lesson[]>('/api/lessons')
}

export function askChat(
  message: string,
  context?: ChatContext | null,
): Promise<ChatAnswer> {
  return post<ChatAnswer>('/api/chat', { message, context: context ?? null })
}
