// Pure buffering/merge logic for the MAIN-world probe's postMessage reports
// (page-probe-main.ts -> page-probe.ts). Extracted so it's unit-testable
// independent of `window`/`MessageEvent` -- the orchestrator (page-probe.ts)
// still owns the actual `window.addEventListener('message', ...)` wiring
// and the `event.source === window` origin check (neither of which can be
// exercised from a pure unit test), but every merge/shape decision below
// can be.
//
// Design note (see the docstring on watchMainWorldReport in page-probe.ts
// for the full story): the MAIN-world script posts an early (~1.5s) partial
// report and a final report (tagged `final: true`), sent at ~3s or on
// `pagehide`, whichever comes first. The isolated-world listener MUST be
// attached at script start (not after a settle delay) so it doesn't miss
// either postMessage call -- this module's `mergeMainWorldReport` is the
// pure reducer applied to each one as it arrives.

export interface MainWorldReport {
  notificationPrompts: number
  notificationPromptWithin10s: boolean
  popupsUnsolicited: number
  minerGlobals: string[]
}

export function emptyMainWorldReport(): MainWorldReport {
  return {
    notificationPrompts: 0,
    notificationPromptWithin10s: false,
    popupsUnsolicited: 0,
    minerGlobals: [],
  }
}

export interface MainWorldProbeMessage extends Partial<MainWorldReport> {
  source: 'protegete-probe'
  /** True for the final (pagehide-or-~3s) report; false/absent for the
   * early (~1.5s) partial one. */
  final?: boolean
}

/**
 * True (with type narrowing) when `data` looks like a message from
 * page-probe-main.ts, matched by its literal `source` tag. Callers MUST
 * additionally verify `event.source === window` before trusting a message
 * shaped like this -- this function alone can't see the postMessage
 * event's origin, only the payload shape.
 */
export function isProtegeteProbeMessage(data: unknown): data is MainWorldProbeMessage {
  return (
    typeof data === 'object' &&
    data !== null &&
    (data as { source?: unknown }).source === 'protegete-probe'
  )
}

/**
 * Pure merge: folds one incoming MAIN-world message into the previously
 * buffered report. A field the incoming message omits keeps its previous
 * value, so the early (~1.5s) report's fields survive until the final
 * report supersedes them (and a final report that itself omits a field,
 * e.g. because it fired from `pagehide` before the miner check ran, still
 * doesn't regress an already-known field back to its default).
 */
export function mergeMainWorldReport(
  previous: MainWorldReport,
  incoming: MainWorldProbeMessage,
): MainWorldReport {
  return {
    notificationPrompts: incoming.notificationPrompts ?? previous.notificationPrompts,
    notificationPromptWithin10s:
      incoming.notificationPromptWithin10s ?? previous.notificationPromptWithin10s,
    popupsUnsolicited: incoming.popupsUnsolicited ?? previous.popupsUnsolicited,
    minerGlobals: incoming.minerGlobals ?? previous.minerGlobals,
  }
}

export function isFinalMainWorldMessage(data: MainWorldProbeMessage): boolean {
  return data.final === true
}
