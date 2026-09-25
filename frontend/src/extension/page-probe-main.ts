// MAIN-world content script (Feature C), injected at document_start.
// Runs in the page's own JS realm (not the isolated content-script world)
// so it can intercept the page's *real* window.open / Notification calls —
// an isolated-world content script has its own separate `window` and
// cannot see those. Bundled as a classic IIFE (see
// scripts/build-content-scripts.mjs), never as an ES module.
//
// Privacy: this script never reads or reports page HTML/text/URLs. It only
// reports counts/booleans plus a small fixed list of known miner-global
// names (safe, not "page content") via window.postMessage to the isolated
// world, which then forwards a fully-numeric/boolean PageSignals object to
// the backend — see page-probe.ts and pageProbeCollect.ts.
;(function () {
  const UNSOLICITED_OPEN_WINDOW_MS = 1000
  const NOTIFICATION_PROMPT_GRACE_MS = 10000
  const EARLY_REPORT_DELAY_MS = 1500
  const FULL_REPORT_DELAY_MS = 3000

  const startTime = Date.now()
  let lastClickAt = 0
  let popupsUnsolicited = 0
  let notificationPrompts = 0
  let notificationPromptWithin10s = false
  // Guards against sending the final report twice (both the ~3s timer and
  // `pagehide` call `report(..., true)`; whichever fires first wins).
  let finalReportSent = false

  document.addEventListener(
    'click',
    () => {
      lastClickAt = Date.now()
    },
    true,
  )

  const originalOpen = window.open
  if (typeof originalOpen === 'function') {
    window.open = function (...args: Parameters<typeof window.open>) {
      const sinceClick = Date.now() - lastClickAt
      if (lastClickAt === 0 || sinceClick > UNSOLICITED_OPEN_WINDOW_MS) {
        popupsUnsolicited += 1
      }
      return originalOpen.apply(window, args)
    }
  }

  if (typeof Notification !== 'undefined' && typeof Notification.requestPermission === 'function') {
    const originalRequestPermission = Notification.requestPermission.bind(Notification)
    Notification.requestPermission = function (...args: Parameters<typeof Notification.requestPermission>) {
      notificationPrompts += 1
      if (Date.now() - startTime <= NOTIFICATION_PROMPT_GRACE_MS) {
        notificationPromptWithin10s = true
      }
      return originalRequestPermission(...args)
    }
  }

  /** Known miner-global names only (never arbitrary page content). */
  function collectMinerGlobals(): string[] {
    const win = window as unknown as Record<string, unknown>
    const minerGlobals: string[] = []
    if (win.CoinHive) minerGlobals.push('CoinHive')
    if (win.CryptoLoot) minerGlobals.push('CryptoLoot')
    if ((win.Client as Record<string, unknown> | undefined)?.Anonymous) minerGlobals.push('Client.Anonymous')
    if (win.WMP) minerGlobals.push('WMP')
    if (win.CoinImp) minerGlobals.push('CoinImp')
    return minerGlobals
  }

  /** `Notification.permission` is a static, always-readable property (no
   * hook needed) — 'granted' means the site already has permission,
   * regardless of when/how it was granted. Never page content. */
  function notificationPermissionGranted(): boolean {
    return typeof Notification !== 'undefined' && Notification.permission === 'granted'
  }

  /**
   * Posts a report to the isolated-world listener (page-probe.ts). `final`
   * marks the ~3s/pagehide report that includes the miner-global check, as
   * opposed to the ~1.5s early partial one; the isolated side treats
   * receiving a final report (or a 4s timeout, whichever comes first) as
   * "done waiting". A final report is sent at most once.
   */
  function report(extra: { minerGlobals?: string[] } | undefined, final: boolean) {
    if (final) {
      if (finalReportSent) return
      finalReportSent = true
    }
    window.postMessage(
      {
        source: 'protegete-probe',
        notificationPrompts,
        notificationPromptWithin10s,
        popupsUnsolicited,
        minerGlobals: extra?.minerGlobals ?? [],
        notificationPermissionGranted: notificationPermissionGranted(),
        final,
      },
      '*',
    )
  }

  // Early report at ~1.5s: notification/popup counts so the isolated world
  // doesn't have to wait the full miner-check delay for those two.
  setTimeout(() => report(undefined, false), EARLY_REPORT_DELAY_MS)

  // Final report at ~3s, including the miner-global check (known globals
  // only — never arbitrary page content).
  setTimeout(() => report({ minerGlobals: collectMinerGlobals() }, true), FULL_REPORT_DELAY_MS)

  // Also send a final report immediately if the page is being unloaded
  // (fast redirect/navigation away) before the ~3s timer fires, so the
  // isolated side isn't left waiting on a report that will never arrive
  // before the page (and its listener) is gone.
  window.addEventListener('pagehide', () => report({ minerGlobals: collectMinerGlobals() }, true))
})()
