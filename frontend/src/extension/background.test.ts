import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { handlePageSignalsMessage, wireToolbarIcon } from './background'
import { getCachedTabVerdict, setCachedTabVerdict } from './tabVerdict'
import type { PageSignals } from '../core/types'

describe('wireToolbarIcon', () => {
  const originalChrome = (globalThis as { chrome?: unknown }).chrome

  afterEach(() => {
    ;(globalThis as { chrome?: unknown }).chrome = originalChrome
    vi.restoreAllMocks()
  })

  test('uses chrome.sidePanel when the API is available', async () => {
    const setPanelBehavior = vi.fn().mockResolvedValue(undefined)
    const setPopup = vi.fn().mockResolvedValue(undefined)
    ;(globalThis as { chrome?: unknown }).chrome = {
      sidePanel: { setPanelBehavior },
      action: { setPopup },
    }

    await wireToolbarIcon()

    expect(setPanelBehavior).toHaveBeenCalledWith({ openPanelOnActionClick: true })
    expect(setPopup).not.toHaveBeenCalled()
  })

  test('falls back to chrome.action.setPopup when sidePanel is unavailable (e.g. Opera)', async () => {
    const setPopup = vi.fn().mockResolvedValue(undefined)
    ;(globalThis as { chrome?: unknown }).chrome = {
      action: { setPopup },
    }

    await wireToolbarIcon()

    expect(setPopup).toHaveBeenCalledWith({ popup: 'sidepanel.html' })
  })

  test('never throws when neither API is available', async () => {
    ;(globalThis as { chrome?: unknown }).chrome = {}
    await expect(wireToolbarIcon()).resolves.toBeUndefined()
  })

  test('never throws when the browser rejects the call', async () => {
    const setPopup = vi.fn().mockRejectedValue(new Error('nope'))
    ;(globalThis as { chrome?: unknown }).chrome = { action: { setPopup } }
    await expect(wireToolbarIcon()).resolves.toBeUndefined()
  })
})

/** Minimal in-memory chrome.storage.StorageArea fake matching the
 * get(key)->{[key]:value} / set(items) / remove(key) contract that
 * tabVerdict.ts and metrics.ts's chromeStore rely on. */
function fakeStorageArea() {
  const data = new Map<string, unknown>()
  return {
    async get(key: string) {
      return data.has(key) ? { [key]: data.get(key) } : {}
    },
    async set(items: Record<string, unknown>) {
      for (const [k, v] of Object.entries(items)) data.set(k, v)
    },
    async remove(key: string) {
      data.delete(key)
    },
  }
}

const EMPTY_SIGNALS: PageSignals = {
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

describe('handlePageSignalsMessage', () => {
  const originalChrome = (globalThis as { chrome?: unknown }).chrome
  const originalFetch = global.fetch
  const TAB_ID = 7

  beforeEach(() => {
    ;(globalThis as { chrome?: unknown }).chrome = {
      action: {
        setBadgeText: vi.fn().mockResolvedValue(undefined),
        setBadgeBackgroundColor: vi.fn().mockResolvedValue(undefined),
      },
      storage: {
        session: fakeStorageArea(),
        local: fakeStorageArea(),
      },
    }
    global.fetch = vi.fn()
  })

  afterEach(() => {
    ;(globalThis as { chrome?: unknown }).chrome = originalChrome
    global.fetch = originalFetch
    vi.restoreAllMocks()
  })

  async function seedCachedVerdict(level: 'safe' | 'caution' | 'danger', reasons: string[]) {
    await setCachedTabVerdict(TAB_ID, {
      url: 'https://example-test-site.invalid/',
      level,
      score: 10,
      category: 'none',
      reasons,
      tip: 'tip inicial',
    })
  }

  function mockAnalyzePageResponse(body: unknown) {
    ;(global.fetch as any).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => body,
    })
  }

  test('a higher-severity page-analysis result replaces the cached verdict', async () => {
    await seedCachedVerdict('caution', ['algo raro'])
    mockAnalyzePageResponse({
      url: 'https://example-test-site.invalid/',
      level: 'danger',
      score: 90,
      category: 'malicious',
      reasons: ['formulario de contraseña inseguro'],
      tip: 'tip nuevo',
      page_signals: [{ id: 'insecure_password_form', reason: 'formulario de contraseña inseguro' }],
      lessons: [],
    })

    await handlePageSignalsMessage(
      { type: 'page-signals', url: 'https://example-test-site.invalid/', signals: EMPTY_SIGNALS },
      { tab: { id: TAB_ID } },
    )

    const cached = await getCachedTabVerdict(TAB_ID)
    expect(cached?.level).toBe('danger')
    expect(cached?.reasons).toEqual(['formulario de contraseña inseguro'])
    expect(cached?.pageSignals).toEqual([
      { id: 'insecure_password_form', reason: 'formulario de contraseña inseguro' },
    ])
  })

  test('a lower-severity page-analysis result does not overwrite the cached verdict', async () => {
    await seedCachedVerdict('danger', ['sitio en lista negra'])
    mockAnalyzePageResponse({
      url: 'https://example-test-site.invalid/',
      level: 'safe',
      score: 0,
      category: 'none',
      reasons: [],
      tip: 'todo bien',
      page_signals: [],
      lessons: [],
    })

    await handlePageSignalsMessage(
      { type: 'page-signals', url: 'https://example-test-site.invalid/', signals: EMPTY_SIGNALS },
      { tab: { id: TAB_ID } },
    )

    const cached = await getCachedTabVerdict(TAB_ID)
    expect(cached?.level).toBe('danger')
    expect(cached?.reasons).toEqual(['sitio en lista negra'])
  })

  test('a same-severity result with more reasons updates the cached verdict', async () => {
    await seedCachedVerdict('caution', ['razon original'])
    mockAnalyzePageResponse({
      url: 'https://example-test-site.invalid/',
      level: 'caution',
      score: 40,
      category: 'suspicious_domain',
      reasons: ['razon original', 'iframe oculto detectado'],
      tip: 'tip actualizado',
      page_signals: [{ id: 'hidden_iframes', reason: 'iframe oculto detectado' }],
      lessons: [],
    })

    await handlePageSignalsMessage(
      { type: 'page-signals', url: 'https://example-test-site.invalid/', signals: EMPTY_SIGNALS },
      { tab: { id: TAB_ID } },
    )

    const cached = await getCachedTabVerdict(TAB_ID)
    expect(cached?.reasons).toEqual(['razon original', 'iframe oculto detectado'])
  })

  test('ignores messages that are not page-signals', async () => {
    await seedCachedVerdict('safe', [])
    await handlePageSignalsMessage({ type: 'something-else' }, { tab: { id: TAB_ID } })
    expect(global.fetch).not.toHaveBeenCalled()
  })

  test('does nothing when the sender has no tab id', async () => {
    await handlePageSignalsMessage(
      { type: 'page-signals', url: 'https://example-test-site.invalid/', signals: EMPTY_SIGNALS },
      {},
    )
    expect(global.fetch).not.toHaveBeenCalled()
  })

  test('never throws when the backend is unreachable', async () => {
    await seedCachedVerdict('safe', [])
    ;(global.fetch as any).mockRejectedValue(new TypeError('Failed to fetch'))
    await expect(
      handlePageSignalsMessage(
        { type: 'page-signals', url: 'https://example-test-site.invalid/', signals: EMPTY_SIGNALS },
        { tab: { id: TAB_ID } },
      ),
    ).resolves.toBeUndefined()
  })
})
