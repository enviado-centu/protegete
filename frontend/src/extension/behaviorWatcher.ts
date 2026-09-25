// "Portero" (gatekeeper): an always-on, navigation-only behavior watcher —
// never reads page content. It counts, per tab:
//   - popups/new tabs the tab opened within a short grace window of its own
//     last top-level navigation commit (chrome.webNavigation
//     .onCreatedNavigationTarget / chrome.tabs.onCreated with openerTabId,
//     wired in background.ts)
//   - forced (client/server) redirects on that tab's own navigation
//     (chrome.webNavigation.onCommitted's transitionQualifiers)
//
// Only these two small counts are ever stored (chrome.storage.session
// only — cleared on browser restart, never chrome.storage.local), and
// counters reset on every new (non-redirect) top-level navigation. No URL
// of an opened tab, and no navigation URL beyond what's already sent to
// /api/analyze, is ever recorded here.
//
// This module is pure/testable; background.ts owns the actual
// chrome.webNavigation/chrome.tabs wiring.

export interface TabBehaviorCounters {
  popupsOpened: number
  forcedRedirects: number
  /** ms timestamp of this tab's last top-level (non-redirect) navigation
   * commit — used to decide whether a newly-created child tab falls inside
   * the "opened by this navigation" grace window. */
  lastNavigationAt: number
}

/** A child tab created within this many ms of the opener's last top-level
 * navigation commit counts as an unsolicited popup. */
export const POPUP_GRACE_MS = 5000

export function emptyCounters(now: number): TabBehaviorCounters {
  return { popupsOpened: 0, forcedRedirects: 0, lastNavigationAt: now }
}

/**
 * Applies one `chrome.webNavigation.onCommitted` event for this tab's
 * top-level frame: a genuinely new navigation (not a redirect) resets the
 * counters to a fresh "site visit"; a client/server-redirect navigation
 * increments `forcedRedirects` without resetting (a forced redirect is
 * itself a new top-level commit, but the counters should keep tracking the
 * visit it belongs to, not restart from zero).
 */
export function handleTopLevelCommit(
  counters: TabBehaviorCounters,
  now: number,
  isRedirect: boolean,
): TabBehaviorCounters {
  if (isRedirect) {
    return { ...counters, forcedRedirects: counters.forcedRedirects + 1 }
  }
  return emptyCounters(now)
}

/**
 * Applies one "a child tab was created with this tab as opener" event.
 * Counts as an unsolicited popup only when it happened within
 * `POPUP_GRACE_MS` of `counters`'s last navigation commit — a tab opened
 * long after the page settled is far more likely to be a deliberate
 * middle-click/"open in new tab" than an unsolicited popup.
 */
export function recordChildTabCreated(counters: TabBehaviorCounters, now: number): TabBehaviorCounters {
  if (now - counters.lastNavigationAt > POPUP_GRACE_MS) return counters
  return { ...counters, popupsOpened: counters.popupsOpened + 1 }
}

function behaviorKey(tabId: number): string {
  return `behavior:${tabId}`
}

export async function getBehaviorCounters(tabId: number): Promise<TabBehaviorCounters | null> {
  const key = behaviorKey(tabId)
  const result = await chrome.storage.session.get(key)
  return (result[key] as TabBehaviorCounters | undefined) ?? null
}

export async function setBehaviorCounters(tabId: number, counters: TabBehaviorCounters): Promise<void> {
  await chrome.storage.session.set({ [behaviorKey(tabId)]: counters })
}

export async function clearBehaviorCounters(tabId: number): Promise<void> {
  await chrome.storage.session.remove(behaviorKey(tabId))
}
