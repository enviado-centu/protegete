import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import {
  analyzePage,
  analyzeText,
  analyzeUrl,
  askChat,
  ApiUnavailableError,
  ApiValidationError,
  getLessons,
} from './api'
import type { PageSignals } from './types'

const originalFetch = global.fetch

beforeEach(() => {
  global.fetch = vi.fn()
})

afterEach(() => {
  global.fetch = originalFetch
  vi.restoreAllMocks()
})

test('analyzeUrl posts to /api/analyze and returns json', async () => {
  ;(global.fetch as any).mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ url: 'http://x.com', level: 'safe' }),
  })
  const result = await analyzeUrl('http://x.com')
  expect(result).toEqual({ url: 'http://x.com', level: 'safe' })
  expect(global.fetch).toHaveBeenCalledWith(
    expect.stringContaining('/api/analyze'),
    expect.objectContaining({ method: 'POST' }),
  )
})

test('with no VITE_API_BASE, requests are same-origin (relative /api/... URLs)', async () => {
  ;(global.fetch as any).mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ url: 'http://x.com', level: 'safe' }),
  })
  await analyzeUrl('http://x.com')
  // Exact match (not just "contains"): no scheme/host prefix at all, so a
  // Vite dev/preview proxy or same-origin deployment can serve this path
  // without needing to know the backend's host.
  expect(global.fetch).toHaveBeenCalledWith('/api/analyze', expect.objectContaining({ method: 'POST' }))
})

test('when VITE_API_BASE is explicitly set, it is used verbatim as an absolute prefix', async () => {
  vi.stubEnv('VITE_API_BASE', 'http://localhost:8000')
  vi.resetModules()
  const { analyzeUrl: analyzeUrlWithBase } = await import('./api')
  ;(global.fetch as any).mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ url: 'http://x.com', level: 'safe' }),
  })
  await analyzeUrlWithBase('http://x.com')
  expect(global.fetch).toHaveBeenCalledWith(
    'http://localhost:8000/api/analyze',
    expect.objectContaining({ method: 'POST' }),
  )
  vi.unstubAllEnvs()
  vi.resetModules()
})

test('network failure throws ApiUnavailableError', async () => {
  ;(global.fetch as any).mockRejectedValue(new TypeError('Failed to fetch'))
  await expect(analyzeText('hola')).rejects.toBeInstanceOf(ApiUnavailableError)
})

test('422 throws ApiValidationError', async () => {
  ;(global.fetch as any).mockResolvedValue({ ok: false, status: 422, json: async () => ({}) })
  await expect(analyzeText('')).rejects.toBeInstanceOf(ApiValidationError)
})

test('getLessons GETs the lessons endpoint', async () => {
  ;(global.fetch as any).mockResolvedValue({ ok: true, status: 200, json: async () => [] })
  await getLessons()
  expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('/api/lessons'))
})

test('analyzePage posts url and signals to /api/analyze-page', async () => {
  ;(global.fetch as any).mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ url: 'http://x.com', level: 'safe', page_signals: [], lessons: [] }),
  })
  const signals: PageSignals = {
    malvertising: [],
    cryptominer: false,
    obfuscated_js: 0,
    hidden_iframes: 0,
    insecure_password_form: false,
    cross_site_password_form: false,
    notification_prompt: false,
    popups: 0,
    offsite_meta_refresh: false,
    third_party_domains: 0,
    tracker_cookies: 0,
  }
  const result = await analyzePage('http://x.com', signals)
  expect(result).toEqual({ url: 'http://x.com', level: 'safe', page_signals: [], lessons: [] })
  expect(global.fetch).toHaveBeenCalledWith(
    expect.stringContaining('/api/analyze-page'),
    expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ url: 'http://x.com', signals }),
    }),
  )
})

test('askChat posts message and context', async () => {
  ;(global.fetch as any).mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ answer: 'hola', fallback: false }),
  })
  const result = await askChat('hola', { level: 'danger', signals: [] })
  expect(result).toEqual({ answer: 'hola', fallback: false })
})
