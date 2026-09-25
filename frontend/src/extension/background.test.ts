import { afterEach, describe, expect, test, vi } from 'vitest'
import { wireToolbarIcon } from './background'

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
