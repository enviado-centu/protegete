// MV3 service worker: analyzes the active tab's URL on navigation, sets the
// toolbar badge, records privacy-preserving local metrics, and opens the
// side panel on the toolbar icon click.

import { analyzePage, analyzeText, analyzeUrl } from '../core/api'
import { getCachedTabVerdict, clearCachedTabVerdict } from './tabVerdict'
import { applyVerdictToTab, setBadge, type TabVerdictInput } from './applyVerdict'
import {
  clearBehaviorCounters,
  emptyCounters,
  getBehaviorCounters,
  handleTopLevelCommit,
  recordChildTabCreated,
  setBehaviorCounters,
} from './behaviorWatcher'
import { mergeVerdicts } from './verdictMerge'
import type { Level, PageSignals } from '../core/types'

export type { TabVerdictInput } from './applyVerdict'
export { applyVerdictToTab } from './applyVerdict'

/** Severity ordering used to decide whether a page-signals enrichment
 * result should replace the cached (base-URL) verdict for a tab. */
const LEVEL_RANK: Record<Level, number> = { safe: 0, caution: 1, danger: 2 }

function isHttpUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

/**
 * Analyzes `url` for `tabId`, updates the badge, records the (deduped,
 * domain-hashed) local metric, and caches the verdict for the side panel.
 * Exported so it can be invoked directly (e.g. from tests) without a real
 * `chrome.tabs.onUpdated` navigation.
 */
export async function handleTabUrl(tabId: number, url: string): Promise<void> {
  if (!isHttpUrl(url)) {
    await setBadge(tabId, null)
    return
  }

  try {
    const verdict = await analyzeUrl(url)
    await applyVerdictToTab(tabId, verdict.url, {
      level: verdict.level,
      score: verdict.score,
      category: verdict.category,
      reasons: verdict.reasons,
      tip: verdict.tip,
    })
  } catch {
    // Backend unreachable/timeout/etc: leave the badge blank rather than
    // showing a stale or misleading state.
    await setBadge(tabId, null)
  }
}

/**
 * Handles a `{ type: 'page-signals', url, signals, visibleText? }` runtime
 * message from the content-script orchestrator (page-probe.ts), only ever
 * run after explicit user consent (see scan.ts — no more always-on content
 * scripts). Merges in the background-only "portero" behavior counters
 * (popups/forced redirects — never page content, see behaviorWatcher.ts),
 * sends the signals to POST /api/analyze-page, and — when `visibleText` was
 * collected — also sends it to POST /api/analyze-text and merges both
 * results (max level wins, reasons unioned/deduped — see verdictMerge.ts).
 * The merged result replaces the cached (base-URL) verdict for this tab
 * when it's at least as severe — strictly higher severity, or the same
 * severity with more reasons; a lower-severity result never downgrades an
 * already-cached higher verdict. Exported so it can be invoked directly
 * (e.g. from tests) without a real `chrome.runtime.onMessage` dispatch.
 */
export async function handlePageSignalsMessage(
  message: { type?: string; url?: string; signals?: PageSignals; visibleText?: string },
  sender: { tab?: { id?: number } },
): Promise<void> {
  if (message?.type !== 'page-signals') return

  const tabId = sender.tab?.id
  if (tabId == null || !message.url || !message.signals) return

  try {
    const counters = await getBehaviorCounters(tabId)
    const signals: PageSignals = {
      ...message.signals,
      popups_opened: counters?.popupsOpened ?? 0,
      forced_redirects: counters?.forcedRedirects ?? 0,
    }

    let result = await analyzePage(message.url, signals)
    if (message.visibleText) {
      try {
        const textResult = await analyzeText(message.visibleText)
        result = mergeVerdicts(result, textResult)
      } catch {
        // The visible-text pass is additive; the page-signals result alone
        // still stands if it fails.
      }
    }

    const cached = await getCachedTabVerdict(tabId)

    const shouldUpdate =
      !cached ||
      LEVEL_RANK[result.level] > LEVEL_RANK[cached.level] ||
      (result.level === cached.level && result.reasons.length > cached.reasons.length)

    if (!shouldUpdate) return

    await applyVerdictToTab(tabId, result.url, {
      level: result.level,
      score: result.score,
      category: result.category,
      reasons: result.reasons,
      tip: result.tip,
      pageSignals: result.page_signals,
      pageLessons: result.lessons,
    })
  } catch {
    // Page-signals analysis is a best-effort enrichment on top of the base
    // URL verdict; a failure here must not disturb the existing cache/badge.
  }
}

if (typeof chrome !== 'undefined' && chrome.tabs?.onUpdated) {
  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status !== 'complete') return
    const url = tab.url
    if (!url) return
    void handleTabUrl(tabId, url)
  })

  chrome.tabs.onRemoved?.addListener((tabId) => {
    void clearCachedTabVerdict(tabId)
    void clearBehaviorCounters(tabId)
  })
}

if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener((message, sender) => {
    void handlePageSignalsMessage(message, sender)
  })
}

// "Portero" (always-on, no page reading — see behaviorWatcher.ts): counts
// popups/new tabs opened by a tab and forced redirects on a tab's own
// navigation, purely from navigation/tab events. Exported so tests can
// drive them directly (e.g. from tests) without real chrome.webNavigation/
// chrome.tabs events.

/** A child tab was created with `openerTabId` as its opener: counts as an
 * unsolicited popup only within the opener's grace window (see
 * `recordChildTabCreated`). Deduped by `newTabId` so the two listeners
 * below (`onCreatedNavigationTarget` + `tabs.onCreated`) never double-count
 * the same new tab. */
const countedPopupTabIds = new Set<number>()

export async function notePopupFromOpener(
  openerTabId: number | undefined | null,
  newTabId: number | undefined | null,
  now: number = Date.now(),
): Promise<void> {
  if (openerTabId == null || newTabId == null) return
  if (countedPopupTabIds.has(newTabId)) return
  countedPopupTabIds.add(newTabId)

  const counters = await getBehaviorCounters(openerTabId)
  if (!counters) return
  await setBehaviorCounters(openerTabId, recordChildTabCreated(counters, now))
}

/** One `chrome.webNavigation.onCommitted` event for a top-level frame:
 * resets the tab's counters on a fresh navigation, or increments
 * `forcedRedirects` on a client/server-redirect navigation (see
 * `handleTopLevelCommit`). */
export async function noteTopLevelCommit(
  tabId: number,
  transitionQualifiers: string[] | undefined,
  now: number = Date.now(),
): Promise<void> {
  const isRedirect = (transitionQualifiers ?? []).some(
    (q) => q === 'client_redirect' || q === 'server_redirect',
  )
  const counters = (await getBehaviorCounters(tabId)) ?? emptyCounters(now)
  await setBehaviorCounters(tabId, handleTopLevelCommit(counters, now, isRedirect))
}

if (typeof chrome !== 'undefined' && chrome.webNavigation?.onCommitted) {
  chrome.webNavigation.onCommitted.addListener((details) => {
    if (details.frameId !== 0) return
    void noteTopLevelCommit(details.tabId, details.transitionQualifiers)
  })
}

if (typeof chrome !== 'undefined' && chrome.webNavigation?.onCreatedNavigationTarget) {
  chrome.webNavigation.onCreatedNavigationTarget.addListener((details) => {
    void notePopupFromOpener(details.sourceTabId, details.tabId)
  })
}

if (typeof chrome !== 'undefined' && chrome.tabs?.onCreated) {
  chrome.tabs.onCreated.addListener((tab) => {
    void notePopupFromOpener(tab.openerTabId, tab.id)
  })
}

/**
 * Wires the toolbar icon to open the UI. Chrome (and modern Edge/Brave)
 * support `chrome.sidePanel`, so the icon opens the real side panel. Older
 * Chromium builds and Opera (no sidePanel API as of this writing) fall back
 * to opening the exact same page as the toolbar-icon popup via
 * `chrome.action.setPopup` — same UI, sized for a popup window (see
 * `sidepanel.tsx`'s `isPopupFallback` / theme.css's `.popup` rules).
 * Exported so tests can call it directly against a fake `chrome` global.
 */
export async function wireToolbarIcon(): Promise<void> {
  if (typeof chrome === 'undefined') return

  if (chrome.sidePanel?.setPanelBehavior) {
    try {
      await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })
    } catch {
      // Nothing else to do: the side panel still opens via the
      // default_path association.
    }
    return
  }

  if (chrome.action?.setPopup) {
    try {
      await chrome.action.setPopup({ popup: 'sidepanel.html' })
    } catch {
      // No popup fallback available either: the toolbar icon click is a
      // no-op, which is still safer than throwing from the service worker.
    }
  }
}

void wireToolbarIcon()

// Exposed on the service worker's global scope (not importable from outside
// the module graph) so E2E tooling can drive it directly via
// `serviceWorker.evaluate(() => self.handleTabUrl(tabId, url))` without a
// real (DNS-dependent) tab navigation, and similarly for the "portero"
// counters, which real chrome.webNavigation/chrome.tabs events are hard to
// synthesize precisely in browser automation.
if (typeof self !== 'undefined') {
  Object.assign(self as unknown as Record<string, unknown>, {
    handleTabUrl,
    notePopupFromOpener,
    noteTopLevelCommit,
  })
}
