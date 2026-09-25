// Shared "apply this verdict to a tab" logic: sets the toolbar badge,
// records the local (deduped, domain-hashed) metric, and caches the
// verdict for the side panel to read. Used by background.ts's own
// URL/page-signals flows AND directly by the side panel (e.g. after a
// screenshot review — see ScreenshotButton.tsx). Deliberately has NO
// top-level chrome.* listener registration (unlike background.ts), so
// importing it from the side panel never double-registers the service
// worker's navigation/tab listeners.

import { recordVerdict, chromeStore } from './metrics'
import { setCachedTabVerdict } from './tabVerdict'
import type { Category, Lesson, Level, PageSignal } from '../core/types'

const BADGE_TEXT: Record<Level, string> = { safe: '', caution: '?', danger: '!' }
const BADGE_COLOR: Record<Level, string> = {
  safe: '#2d6a4f',
  caution: '#966000',
  danger: '#d92d20',
}

export async function setBadge(tabId: number, level: Level | null): Promise<void> {
  const text = level ? BADGE_TEXT[level] : ''
  await chrome.action.setBadgeText({ tabId, text })
  if (level) {
    await chrome.action.setBadgeBackgroundColor({ tabId, color: BADGE_COLOR[level] })
  }
}

export interface TabVerdictInput {
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
 * it.
 */
export async function applyVerdictToTab(tabId: number, url: string, verdict: TabVerdictInput): Promise<void> {
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
