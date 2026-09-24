import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { analyzeText, analyzeUrl, askChat, ApiUnavailableError, ApiValidationError, getLessons } from './api'

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

test('askChat posts message and context', async () => {
  ;(global.fetch as any).mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ answer: 'hola', fallback: false }),
  })
  const result = await askChat('hola', { level: 'danger', signals: [] })
  expect(result).toEqual({ answer: 'hola', fallback: false })
})
