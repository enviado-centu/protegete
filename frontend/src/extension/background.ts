// MV3 service worker: analyzes the active tab's URL on navigation, sets the
// toolbar badge, records privacy-preserving local metrics, and opens the
// side panel on the toolbar icon click.

import { analyzeUrl } from '../core/api'
import { recordVerdict, chromeStore } from './metrics'
import { setCachedTabVerdict, clearCachedTabVerdict } from './tabVerdict'
import type { Level } from '../core/types'

const BADGE_TEXT: Record<Level, string> = { safe: '', caution: '?', danger: '!' }
const BADGE_COLOR: Record<Level, string> = {
  safe: '#2d6a4f',
  caution: '#966000',
  danger: '#d92d20',
}

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
    await setBadge(tabId, verdict.level)

    const domain = new URL(url).hostname
    await recordVerdict(chromeStore('local'), chromeStore('session'), {
      domain,
      level: verdict.level,
      now: new Date(),
    })

    await setCachedTabVerdict(tabId, {
      url: verdict.url,
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
