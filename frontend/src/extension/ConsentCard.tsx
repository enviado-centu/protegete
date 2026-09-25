import { useState } from 'react'
import {
  originOf,
  registerPersistentScan,
  requestOriginPermission,
  scanTabOnce,
  unregisterPersistentScan,
} from './scan'

export interface ConsentCardProps {
  url: string
  tabId: number
  /** Called once the card should stop being shown for this page: either
   * the user declined ("Ahora no"), or the one-off scan + optional
   * reload-and-review pass finished. A completed scan also naturally hides
   * the card because the tab's cached verdict then carries `pageSignals`
   * (see sidepanel.tsx), but `onDismiss` is what covers "Ahora no", where
   * no scan (and so no `pageSignals`) ever happens. */
  onDismiss?: () => void
}

type Stage = 'idle' | 'denied' | 'scanning' | 'reload-offer' | 'reloading' | 'done'

// Gives the reloaded page's probe time to run (~3-4s, see page-probe.ts)
// and send its result before we decide whether to drop the persistent
// registration ("Recordar para este sitio" left unchecked).
const RELOAD_SETTLE_MS = 6000

/**
 * Consent-first page scanning card (Feature B): shown once per un-scanned
 * http(s) page. Nothing about the page is read until the user taps "Sí,
 * revisar esta página" — see scan.ts for the actual permission request and
 * script injection this drives.
 */
export function ConsentCard({ url, tabId, onDismiss }: ConsentCardProps) {
  const [stage, setStage] = useState<Stage>('idle')
  const [remember, setRemember] = useState(false)

  function dismiss() {
    setStage('done')
    onDismiss?.()
  }

  async function handleConsent() {
    // MUST be the very first call in this handler (live user gesture) —
    // see requestOriginPermission's docstring.
    const granted = await requestOriginPermission(url)
    if (!granted) {
      setStage('denied')
      return
    }
    setStage('scanning')
    try {
      await scanTabOnce(tabId)
    } catch {
      // Best-effort: the merged result, if any, still arrives through the
      // normal page-signals message pipeline.
    }
    setStage('reload-offer')
  }

  async function handleReload() {
    const origin = originOf(url)
    if (!origin) {
      dismiss()
      return
    }
    setStage('reloading')
    try {
      await registerPersistentScan(origin)
      await chrome.tabs.reload(tabId)
    } catch {
      // Reload/registration failing still leaves the one-off scan's result
      // in place; don't get the user stuck on this card.
    }
    window.setTimeout(() => {
      if (!remember) void unregisterPersistentScan(origin)
    }, RELOAD_SETTLE_MS)
    dismiss()
  }

  if (stage === 'done') return null

  if (stage === 'denied') {
    return (
      <p className="consent-card consent-card--note" role="status">
        No te pedimos de nuevo. Podés activarlo cuando quieras volviendo a tocar el botón.
      </p>
    )
  }

  if (stage === 'reload-offer') {
    return (
      <div className="consent-card" role="group" aria-label="Revisar el comportamiento al abrirse">
        <p>
          Para ver qué hace al abrirse (pop-ups, pedidos de notificaciones), la recargo una vez
          con la revisión activa. ¿Dale?
        </p>
        <button type="button" className="consent-card__btn consent-card__btn--primary" onClick={handleReload}>
          Recargar y revisar
        </button>
        <button type="button" className="consent-card__btn" onClick={dismiss}>
          No, gracias
        </button>
      </div>
    )
  }

  if (stage === 'scanning' || stage === 'reloading') {
    return (
      <p className="consent-card consent-card--note" role="status" aria-live="polite">
        {stage === 'scanning' ? 'Revisando la página…' : 'Recargando…'}
      </p>
    )
  }

  return (
    <div className="consent-card" role="group" aria-label="Consentimiento para revisar la página">
      <h3 className="consent-card__title">🔍 ¿Querés que revise esta página a fondo?</h3>
      <p>
        Miro el código, los formularios, la publicidad y el texto que se ve. No guardo nada y
        nunca leo lo que escribís en formularios.
      </p>
      <label className="consent-card__checkbox">
        <input
          type="checkbox"
          checked={remember}
          onChange={(event) => setRemember(event.target.checked)}
        />
        Recordar para este sitio
      </label>
      <div className="consent-card__actions">
        <button
          type="button"
          className="consent-card__btn consent-card__btn--primary"
          onClick={handleConsent}
        >
          Sí, revisar esta página
        </button>
        <button type="button" className="consent-card__btn" onClick={dismiss}>
          Ahora no
        </button>
      </div>
    </div>
  )
}
