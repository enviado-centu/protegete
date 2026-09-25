// MV3 service worker: analyzes the active tab's URL on navigation, sets the
// toolbar badge, records privacy-preserving local metrics, and opens the
// side panel on the toolbar icon click.

import { analyzePage, analyzeUrl } from '../core/api'
import { recordVerdict, chromeStore } from './metrics'
import { setCachedTabVerdict, getCachedTabVerdict, clearCachedTabVerdict } from './tabVerdict'
import type { Category, Lesson, Level, PageSignal, PageSignals } from '../core/types'

const BADGE_TEXT: Record<Level, string> = { safe: '', caution: '?', danger: '!' }
const BADGE_COLOR: Record<Level, string> = {
  safe: '#2d6a4f',
  caution: '#966000',
  danger: '#d92d20',
}

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

async function setBadge(tabId: number, level: Level | null) {
  const text = level ? BADGE_TEXT[level] : ''
  await chrome.action.setBadgeText({ tabId, text })
  if (level) {
    await chrome.action.setBadgeBackgroundColor({ tabId, color: BADGE_COLOR[level] })
  }
}

interface TabVerdictInput {
  level: Level
  score: number
  category: Category | string
  reasons: string[]
  tip: string
  pageSignals?: PageSignal[]
  pageLessons?: Lesson[]
}

/**
 * Updates the toolbar badge, records the (deduped, domain-hashed) local
 * metric, and caches `verdict` for `tabId`/`url` so the side panel can read
 * it. Shared by the base URL-analysis flow (`handleTabUrl`) and the
 * page-signals enrichment flow (`handlePageSignalsMessage`).
 */
async function applyVerdictToTab(tabId: number, url: string, verdict: TabVerdictInput): Promise<void> {
  await setBadge(tabId, verdict.level)

  const domain = new URL(url).hostname
  await recordVerdict(chromeStore('local'), chromeStore('session'), {
    domain,
    level: verdict.level,
    now: new Date(),
  })

  await setCachedTabVerdict(tabId, {
    url,
    level: verdict.level,
    score: verdict.score,
    category: verdict.category,
    reasons: verdict.reasons,
    tip: verdict.tip,
    pageSignals: verdict.pageSignals,
    pageLessons: verdict.pageLessons,
  })
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
 * Handles a `{ type: 'page-signals', url, signals }` runtime message from
 * the content-script orchestrator (page-probe.ts): sends the in-browser
 * signals to POST /api/analyze-page and, when the result is at least as
 * severe as the cached (base-URL) verdict for this tab — strictly higher
 * severity, or the same severity with more reasons — replaces the cached
 * verdict/badge with the richer result. A lower-severity result never
 * downgrades an already-cached higher verdict. Exported so it can be
 * invoked directly (e.g. from tests) without a real
 * `chrome.runtime.onMessage` dispatch.
 */
export async function handlePageSignalsMessage(
  message: { type?: string; url?: string; signals?: PageSignals },
  sender: { tab?: { id?: number } },
): Promise<void> {
  if (message?.type !== 'page-signals') return

  const tabId = sender.tab?.id
  if (tabId == null || !message.url || !message.signals) return

  try {
    const result = await analyzePage(message.url, message.signals)
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
  })
}

if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener((message, sender) => {
    void handlePageSignalsMessage(message, sender)
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
// real (DNS-dependent) tab navigation.
if (typeof self !== 'undefined') {
  ;(self as unknown as { handleTabUrl: typeof handleTabUrl }).handleTabUrl = handleTabUrl
}
