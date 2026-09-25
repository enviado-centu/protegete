import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
  POPUP_GRACE_MS,
  clearBehaviorCounters,
  emptyCounters,
  getBehaviorCounters,
  handleTopLevelCommit,
  recordChildTabCreated,
  setBehaviorCounters,
} from './behaviorWatcher'

describe('handleTopLevelCommit', () => {
  test('a fresh (non-redirect) navigation resets counters to zero', () => {
    const counters = { popupsOpened: 3, forcedRedirects: 2, lastNavigationAt: 100 }
    const next = handleTopLevelCommit(counters, 5000, false)
    expect(next).toEqual({ popupsOpened: 0, forcedRedirects: 0, lastNavigationAt: 5000 })
  })

  test('a redirect increments forcedRedirects without resetting popupsOpened', () => {
    const counters = { popupsOpened: 2, forcedRedirects: 0, lastNavigationAt: 100 }
    const next = handleTopLevelCommit(counters, 200, true)
    expect(next).toEqual({ popupsOpened: 2, forcedRedirects: 1, lastNavigationAt: 100 })
  })

  test('multiple redirects accumulate', () => {
    let counters = emptyCounters(0)
    counters = handleTopLevelCommit(counters, 10, true)
    counters = handleTopLevelCommit(counters, 20, true)
    counters = handleTopLevelCommit(counters, 30, true)
    expect(counters.forcedRedirects).toBe(3)
  })
})

describe('recordChildTabCreated', () => {
  test('counts a popup opened within the grace window', () => {
    const counters = emptyCounters(1000)
    const next = recordChildTabCreated(counters, 1000 + POPUP_GRACE_MS - 1)
    expect(next.popupsOpened).toBe(1)
  })

  test('does not count a tab opened after the grace window elapsed', () => {
    const counters = emptyCounters(1000)
    const next = recordChildTabCreated(counters, 1000 + POPUP_GRACE_MS + 1)
    expect(next.popupsOpened).toBe(0)
    expect(next).toEqual(counters)
  })

  test('counts multiple popups within the window', () => {
    let counters = emptyCounters(0)
    counters = recordChildTabCreated(counters, 100)
    counters = recordChildTabCreated(counters, 200)
    expect(counters.popupsOpened).toBe(2)
  })
})

/** Same fake chrome.storage.session shape used by background.test.ts. */
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

describe('per-tab counter storage', () => {
  const originalChrome = (globalThis as { chrome?: unknown }).chrome

  beforeEach(() => {
    ;(globalThis as { chrome?: unknown }).chrome = { storage: { session: fakeStorageArea() } }
  })

  afterEach(() => {
    ;(globalThis as { chrome?: unknown }).chrome = originalChrome
    vi.restoreAllMocks()
  })

  test('round-trips counters for a tab and returns null when unset', async () => {
    expect(await getBehaviorCounters(42)).toBeNull()
    await setBehaviorCounters(42, { popupsOpened: 2, forcedRedirects: 1, lastNavigationAt: 100 })
    expect(await getBehaviorCounters(42)).toEqual({
      popupsOpened: 2,
      forcedRedirects: 1,
      lastNavigationAt: 100,
    })
  })

  test('clearBehaviorCounters removes the stored counters', async () => {
    await setBehaviorCounters(7, emptyCounters(0))
    await clearBehaviorCounters(7)
    expect(await getBehaviorCounters(7)).toBeNull()
  })

  test('counters for different tabs are independent', async () => {
    await setBehaviorCounters(1, { popupsOpened: 5, forcedRedirects: 0, lastNavigationAt: 0 })
    await setBehaviorCounters(2, { popupsOpened: 0, forcedRedirects: 0, lastNavigationAt: 0 })
    expect((await getBehaviorCounters(1))?.popupsOpened).toBe(5)
    expect((await getBehaviorCounters(2))?.popupsOpened).toBe(0)
  })
})
