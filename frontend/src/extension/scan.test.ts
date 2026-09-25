import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
  getRememberedOrigins,
  originOf,
  registerPersistentScan,
  requestOriginPermission,
  scanTabOnce,
  scanVisibleScreenshot,
  unregisterPersistentScan,
} from './scan'
import * as api from '../core/api'
import * as ocr from '../core/ocr'

vi.mock('../core/api')
vi.mock('../core/ocr')

describe('originOf', () => {
  test('extracts scheme+host from a URL', () => {
    expect(originOf('https://example.com/path?x=1')).toBe('https://example.com')
  })

  test('null for an invalid URL', () => {
    expect(originOf('not a url')).toBeNull()
  })
})

function fakeStorageArea() {
  const data = new Map<string, unknown>()
  return {
    async get(key: string) {
      return data.has(key) ? { [key]: data.get(key) } : {}
    },
    async set(items: Record<string, unknown>) {
      for (const [k, v] of Object.entries(items)) data.set(k, v)
    },
  }
}

describe('requestOriginPermission', () => {
  const originalChrome = (globalThis as { chrome?: unknown }).chrome

  afterEach(() => {
    ;(globalThis as { chrome?: unknown }).chrome = originalChrome
    vi.restoreAllMocks()
  })

  test('requests the exact origin with a /* suffix', async () => {
    const request = vi.fn().mockResolvedValue(true)
    ;(globalThis as { chrome?: unknown }).chrome = { permissions: { request } }

    const granted = await requestOriginPermission('https://example.com/foo')

    expect(granted).toBe(true)
    expect(request).toHaveBeenCalledWith({ origins: ['https://example.com/*'] })
  })

  test('false for an invalid url without calling chrome.permissions', async () => {
    const request = vi.fn()
    ;(globalThis as { chrome?: unknown }).chrome = { permissions: { request } }
    expect(await requestOriginPermission('nope')).toBe(false)
    expect(request).not.toHaveBeenCalled()
  })

  test('false when the browser denies or the call throws', async () => {
    const request = vi.fn().mockRejectedValue(new Error('denied'))
    ;(globalThis as { chrome?: unknown }).chrome = { permissions: { request } }
    expect(await requestOriginPermission('https://example.com')).toBe(false)
  })
})

describe('scanTabOnce', () => {
  const originalChrome = (globalThis as { chrome?: unknown }).chrome

  afterEach(() => {
    ;(globalThis as { chrome?: unknown }).chrome = originalChrome
    vi.restoreAllMocks()
  })

  test('injects the MAIN-world probe before the isolated probe', async () => {
    const calls: unknown[] = []
    const executeScript = vi.fn(async (opts: unknown) => {
      calls.push(opts)
    })
    ;(globalThis as { chrome?: unknown }).chrome = { scripting: { executeScript } }

    await scanTabOnce(42)

    expect(calls).toEqual([
      { target: { tabId: 42 }, files: ['page-probe-main.js'], world: 'MAIN' },
      { target: { tabId: 42 }, files: ['page-probe.js'] },
    ])
  })
})

describe('remembered origins (register/unregister)', () => {
  const originalChrome = (globalThis as { chrome?: unknown }).chrome

  beforeEach(() => {
    ;(globalThis as { chrome?: unknown }).chrome = {
      storage: { local: fakeStorageArea() },
      scripting: {
        registerContentScripts: vi.fn().mockResolvedValue(undefined),
        unregisterContentScripts: vi.fn().mockResolvedValue(undefined),
      },
    }
  })

  afterEach(() => {
    ;(globalThis as { chrome?: unknown }).chrome = originalChrome
    vi.restoreAllMocks()
  })

  test('registering an origin remembers it exactly once', async () => {
    await registerPersistentScan('https://example.com')
    await registerPersistentScan('https://example.com')
    expect(await getRememberedOrigins()).toEqual(['https://example.com'])
  })

  test('registering calls registerContentScripts with MAIN then isolated probes scoped to the origin', async () => {
    await registerPersistentScan('https://example.com')
    const registerContentScripts = (
      globalThis as unknown as { chrome: { scripting: { registerContentScripts: ReturnType<typeof vi.fn> } } }
    ).chrome.scripting.registerContentScripts
    expect(registerContentScripts).toHaveBeenCalledWith([
      expect.objectContaining({ matches: ['https://example.com/*'], js: ['page-probe-main.js'], world: 'MAIN' }),
      expect.objectContaining({ matches: ['https://example.com/*'], js: ['page-probe.js'] }),
    ])
  })

  test('unregistering forgets the origin', async () => {
    await registerPersistentScan('https://example.com')
    await unregisterPersistentScan('https://example.com')
    expect(await getRememberedOrigins()).toEqual([])
  })
})

describe('scanVisibleScreenshot', () => {
  const originalChrome = (globalThis as { chrome?: unknown }).chrome
  const originalFetch = global.fetch

  afterEach(() => {
    ;(globalThis as { chrome?: unknown }).chrome = originalChrome
    global.fetch = originalFetch
    vi.restoreAllMocks()
  })

  test('captures, OCRs, and analyzes the extracted text with a screen-prefixed reason', async () => {
    const captureVisibleTab = vi.fn().mockResolvedValue('data:image/png;base64,AAAA')
    ;(globalThis as { chrome?: unknown }).chrome = { tabs: { captureVisibleTab } }
    global.fetch = vi.fn().mockResolvedValue({ blob: async () => new Blob(['x']) }) as unknown as typeof fetch
    vi.mocked(ocr.extractText).mockResolvedValue('GANASTE UN IPHONE INGRESÁ TU CLAVE')
    vi.mocked(api.analyzeText).mockResolvedValue({
      level: 'danger',
      score: 0.9,
      category: 'social_engineering',
      reasons: ['Promete un premio.'],
      tip: 'No hagas clic.',
      signals: [],
      lessons: [],
      urls: [],
    })

    const result = await scanVisibleScreenshot(1)

    expect(captureVisibleTab).toHaveBeenCalledWith(1, { format: 'png' })
    expect(result?.level).toBe('danger')
    expect(result?.reasons).toEqual(['En la pantalla: Promete un premio.'])
  })

  test('returns null when OCR finds no text', async () => {
    ;(globalThis as { chrome?: unknown }).chrome = {
      tabs: { captureVisibleTab: vi.fn().mockResolvedValue('data:image/png;base64,AAAA') },
    }
    global.fetch = vi.fn().mockResolvedValue({ blob: async () => new Blob(['x']) }) as unknown as typeof fetch
    vi.mocked(ocr.extractText).mockResolvedValue('')

    expect(await scanVisibleScreenshot(1)).toBeNull()
    expect(api.analyzeText).not.toHaveBeenCalled()
  })
})
