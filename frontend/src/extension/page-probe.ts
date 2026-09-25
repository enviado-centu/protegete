// Isolated-world content script (Feature C), run_at document_idle. Thin
// orchestration shim around the tested pure functions in
// pageProbeCollect.ts and mainWorldReport.ts: waits for load, then waits
// for the MAIN-world probe's final report (or a max cap), collects the
// DOM-derivable signals, merges the two, and sends the complete
// PageSignals object to the background service worker. Not itself unit
// tested — kept intentionally thin. Bundled as a classic IIFE (see
// scripts/build-content-scripts.mjs), never as an ES module.
//
// Privacy: only the final numeric/boolean PageSignals object, the page URL
// (already sent for the base /api/analyze call) and — only after explicit
// user consent, since this script now only ever runs post-consent (see
// scan.ts) — up to 5000 chars of the page's own VISIBLE text
// (document.body.innerText, never raw HTML/script text, never form field
// values) are sent onward.

import { collectPageSignals } from './pageProbeCollect'
import {
  emptyMainWorldReport,
  isFinalMainWorldMessage,
  isProtegeteProbeMessage,
  mergeMainWorldReport,
  type MainWorldReport,
} from './mainWorldReport'
import type { PageSignals } from '../core/types'

// Upper bound on how long we'll wait, after `load`, for the MAIN-world
// probe's final (~3s-from-document_start, or pagehide) report before giving
// up and collecting with whatever partial report (possibly none) has
// arrived. Slightly above the MAIN-world script's own ~3s final-report
// timer so the common case resolves via the report itself, not the cap.
const MAIN_WORLD_MAX_WAIT_MS = 4000

/** Cap on the visible text sent to /api/analyze-text alongside the page
 * signals — mirrors the backend's MAX_TEXT_LENGTH-adjacent limit and keeps
 * the payload bounded regardless of page size. */
const VISIBLE_TEXT_MAX_LENGTH = 5000

/** Only the visible, rendered text a person reading the page would see —
 * never raw HTML, script contents, or any form field's value. */
function collectVisibleText(): string {
  const text = document.body?.innerText ?? ''
  return text.slice(0, VISIBLE_TEXT_MAX_LENGTH)
}

function waitForLoad(): Promise<void> {
  if (document.readyState === 'complete') return Promise.resolve()
  return new Promise((resolve) => {
    window.addEventListener('load', () => resolve(), { once: true })
  })
}

/**
 * Listens for the MAIN-world probe's postMessage report(s), buffering the
 * latest merged state (mergeMainWorldReport, from mainWorldReport.ts) and
 * resolving `waitForFinal()` as soon as a final report arrives (or after
 * its own cap, whichever comes first).
 *
 * The listener MUST be attached as early as possible (script start, not
 * after any wait) because page-probe-main.ts's timers (~1.5s/~3s) run from
 * ITS OWN start (document_start), which happens before this isolated-world
 * script's document_idle start — waiting until after a settle delay to
 * start listening would miss both of its postMessage calls in the common
 * case of a fast-loading page. This was a real bug: the previous version
 * attached the listener only after the settle wait, so cryptominer/
 * notification_prompt/popups reports were silently missed.
 */
function watchMainWorldReport(): {
  get: () => MainWorldReport
  waitForFinal: (maxMs: number) => Promise<MainWorldReport>
  stop: () => void
} {
  let latest: MainWorldReport = emptyMainWorldReport()
  let finalReceived = false
  let resolveFinal: ((report: MainWorldReport) => void) | null = null

  function onMessage(event: MessageEvent) {
    if (event.source !== window) return
    if (!isProtegeteProbeMessage(event.data)) return

    latest = mergeMainWorldReport(latest, event.data)
    if (isFinalMainWorldMessage(event.data)) {
      finalReceived = true
      resolveFinal?.(latest)
      resolveFinal = null
    }
  }

  window.addEventListener('message', onMessage)

  return {
    get: () => latest,
    waitForFinal: (maxMs) =>
      new Promise((resolve) => {
        // The final report may already have arrived before waitForFinal()
        // was even called (listener is live from script start) — resolve
        // immediately rather than waiting for a message that already came.
        if (finalReceived) {
          resolve(latest)
          return
        }
        resolveFinal = resolve
        setTimeout(() => {
          resolveFinal = null
          resolve(latest)
        }, maxMs)
      }),
    stop: () => window.removeEventListener('message', onMessage),
  }
}

async function run(): Promise<void> {
  // Attach the listener immediately (before any await) so it's live well
  // before page-probe-main.ts's ~1.5s/~3s reports fire.
  const mainWorldWatch = watchMainWorldReport()

  await waitForLoad()
  // Wait for either the MAIN-world probe's final report or the max cap —
  // whichever comes first — instead of a blind fixed settle delay.
  await mainWorldWatch.waitForFinal(MAIN_WORLD_MAX_WAIT_MS)

  const domSignals = collectPageSignals(document, location.href)
  const mainWorldReport = mainWorldWatch.get()
  mainWorldWatch.stop()

  const signals: PageSignals = {
    malvertising: domSignals.malvertising ?? [],
    cryptominer: (mainWorldReport.minerGlobals?.length ?? 0) > 0,
    obfuscated_js: domSignals.obfuscated_js ?? 0,
    hidden_iframes: domSignals.hidden_iframes ?? 0,
    insecure_password_form: domSignals.insecure_password_form ?? false,
    cross_site_password_form: domSignals.cross_site_password_form ?? false,
    notification_prompt: mainWorldReport.notificationPromptWithin10s,
    popups: mainWorldReport.popupsUnsolicited,
    offsite_meta_refresh: domSignals.offsite_meta_refresh ?? false,
    third_party_domains: domSignals.third_party_domains ?? 0,
    tracker_cookies: domSignals.tracker_cookies ?? 0,
    notification_permission_granted: mainWorldReport.notificationPermissionGranted,
    // popups_opened/forced_redirects (the "portero" counters) are known
    // only to the background service worker (navigation/tab events, never
    // page content) — it merges them in before calling /api/analyze-page.
  }

  const visibleText = collectVisibleText()

  chrome.runtime.sendMessage({ type: 'page-signals', url: location.href, signals, visibleText })
}

void run()
