// Consent-first page scanning orchestration (Feature B). Every chrome.* call
// here either needs a user gesture (chrome.permissions.request MUST be
// called synchronously from a click handler, with no awaited work before
// it, or Chrome silently denies it) or acts on a specific tab
// (chrome.scripting.*, chrome.tabs.captureVisibleTab) — both work from any
// extension context (a side-panel page, not just the service worker), so
// this module is called directly from the side panel's click handlers and
// stays independently testable against a mocked `chrome` global.
//
// Privacy: nothing here reads page content until the user has explicitly
// granted the per-origin host permission for this exact site.

import { analyzeText } from '../core/api'
import { extractText } from '../core/ocr'

/** Origin (scheme + host [+ port], no path) for `url`, or `null` if `url`
 * isn't a valid absolute URL. */
export function originOf(url: string): string | null {
  try {
    return new URL(url).origin
  } catch {
    return null
  }
}

/**
 * Requests the origin host permission for `url` via the browser's own
 * permission prompt. MUST be invoked directly inside a click handler (no
 * `await` before this call in the caller) — Chrome requires a live user
 * gesture for `chrome.permissions.request` and silently returns `false`
 * otherwise.
 */
export async function requestOriginPermission(url: string): Promise<boolean> {
  const origin = originOf(url)
  if (!origin) return false
  try {
    return await chrome.permissions.request({ origins: [`${origin}/*`] })
  } catch {
    return false
  }
}

const PROBE_FILES = {
  main: 'page-probe-main.js',
  isolated: 'page-probe.js',
} as const

/**
 * Runs the existing page probe once, immediately, in `tabId` — no reload.
 * Injects the exact same built files (`page-probe-main.js` MAIN-world, then
 * `page-probe.js` isolated) that persistent registration
 * (`registerPersistentScan`) uses, so there is exactly one probe
 * implementation either way. The isolated probe sends its own
 * `page-signals` runtime message (handled by background.ts) with the
 * results — this function doesn't wait for or return them, only for the
 * injection itself to complete.
 */
export async function scanTabOnce(tabId: number): Promise<void> {
  await chrome.scripting.executeScript({
    target: { tabId },
    files: [PROBE_FILES.main],
    world: 'MAIN',
  })
  await chrome.scripting.executeScript({
    target: { tabId },
    files: [PROBE_FILES.isolated],
  })
}

const REMEMBERED_ORIGINS_KEY = 'remembered-scan-origins'

/** Origins the user opted to always scan ("Recordar para este sitio"). */
export async function getRememberedOrigins(): Promise<string[]> {
  const result = await chrome.storage.local.get(REMEMBERED_ORIGINS_KEY)
  return (result[REMEMBERED_ORIGINS_KEY] as string[] | undefined) ?? []
}

async function setRememberedOrigins(origins: string[]): Promise<void> {
  await chrome.storage.local.set({ [REMEMBERED_ORIGINS_KEY]: origins })
}

function scriptIds(origin: string): { main: string; isolated: string } {
  return { main: `protegete-probe-main:${origin}`, isolated: `protegete-probe-isolated:${origin}` }
}

/**
 * Registers the persistent (survives reload/new tabs) probe for `origin`
 * and remembers it in `chrome.storage.local` (Feature B.3's "Recordar para
 * este sitio" / the "Sitios que reviso siempre" settings list). Idempotent:
 * re-registering the same origin just replaces its scripts.
 */
export async function registerPersistentScan(origin: string): Promise<void> {
  const ids = scriptIds(origin)
  const matches = [`${origin}/*`]
  await chrome.scripting
    .unregisterContentScripts({ ids: [ids.main, ids.isolated] })
    .catch(() => undefined)
  await chrome.scripting.registerContentScripts([
    { id: ids.main, matches, js: [PROBE_FILES.main], world: 'MAIN', runAt: 'document_start' },
    { id: ids.isolated, matches, js: [PROBE_FILES.isolated], runAt: 'document_idle' },
  ])
  const origins = await getRememberedOrigins()
  if (!origins.includes(origin)) await setRememberedOrigins([...origins, origin])
}

/** Unregisters `origin`'s persistent probe and forgets it. */
export async function unregisterPersistentScan(origin: string): Promise<void> {
  const ids = scriptIds(origin)
  await chrome.scripting
    .unregisterContentScripts({ ids: [ids.main, ids.isolated] })
    .catch(() => undefined)
  const origins = await getRememberedOrigins()
  await setRememberedOrigins(origins.filter((entry) => entry !== origin))
}

export interface ScreenshotReviewResult {
  level: 'safe' | 'caution' | 'danger'
  score: number
  category: string
  reasons: string[]
  tip: string
}

/**
 * Screenshot review (Feature B.4): captures the visible tab as a PNG, OCRs
 * it entirely in-browser (the image itself is never sent to the backend —
 * only the extracted text, same as pasting a screenshot in the chat), and
 * analyzes that text. Returns `null` when OCR found no text.
 */
export async function scanVisibleScreenshot(windowId: number): Promise<ScreenshotReviewResult | null> {
  const dataUrl = await chrome.tabs.captureVisibleTab(windowId, { format: 'png' })
  const blob = await (await fetch(dataUrl)).blob()
  const text = await extractText(blob)
  if (!text) return null

  const result = await analyzeText(text)
  return {
    level: result.level,
    score: result.score,
    category: result.category,
    reasons: result.reasons.map((reason) => `En la pantalla: ${reason}`),
    tip: result.tip,
  }
}
