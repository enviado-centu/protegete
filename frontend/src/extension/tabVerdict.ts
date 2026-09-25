// Shared between background.ts (writer) and sidepanel.tsx (reader): the
// last verdict computed for a tab, cached in chrome.storage.session (never
// chrome.storage.local, so it never survives a browser restart).

import type { Lesson, Level, PageSignal } from '../core/types'

export interface CachedTabVerdict {
  url: string
  level: Level
  score: number
  category: string
  reasons: string[]
  tip: string
  /** Page-content signals from the in-browser probe (Feature C), when the
   * /api/analyze-page enrichment has run for this tab. */
  pageSignals?: PageSignal[]
  pageLessons?: Lesson[]
}

function tabVerdictKey(tabId: number): string {
  return `tab-verdict:${tabId}`
}

export async function setCachedTabVerdict(
  tabId: number,
  verdict: CachedTabVerdict,
): Promise<void> {
  await chrome.storage.session.set({ [tabVerdictKey(tabId)]: verdict })
}

export async function getCachedTabVerdict(tabId: number): Promise<CachedTabVerdict | null> {
  const key = tabVerdictKey(tabId)
  const result = await chrome.storage.session.get(key)
  return (result[key] as CachedTabVerdict | undefined) ?? null
}

export async function clearCachedTabVerdict(tabId: number): Promise<void> {
  await chrome.storage.session.remove(tabVerdictKey(tabId))
}
