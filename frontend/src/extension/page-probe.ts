// Isolated-world content script (Feature C), run_at document_idle. Thin
// orchestration shim around the tested pure functions in
// pageProbeCollect.ts and mainWorldReport.ts: waits for load, then waits
// for the MAIN-world probe's final report (or a max cap), collects the
// DOM-derivable signals, merges the two, and sends the complete
// PageSignals object to the background service worker. Not itself unit
// tested — kept intentionally thin. Bundled as a classic IIFE (see
// scripts/build-content-scripts.mjs), never as an ES module.
//
// Privacy: only the final numeric/boolean PageSignals object and the page
// URL (already sent for the base /api/analyze call) are sent onward — never
// page HTML/script text or cookie values.

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
  }

  chrome.runtime.sendMessage({ type: 'page-signals', url: location.href, signals })
}

void run()
