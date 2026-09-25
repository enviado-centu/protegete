import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Chat } from '../core/components/Chat'
import { VerdictCard } from '../core/components/VerdictCard'
import { MetricsTiles } from './MetricsTiles'
import { getCachedTabVerdict, type CachedTabVerdict } from './tabVerdict'
import { getMetrics, chromeStore, type Metrics } from './metrics'
import '../core/theme.css'

const VERDICT_WORD: Record<CachedTabVerdict['level'], string> = {
  safe: 'Parece seguro',
  caution: 'Cuidado',
  danger: 'Peligroso',
}

const VERDICT_ICON: Record<CachedTabVerdict['level'], string> = {
  safe: '✅',
  caution: '⚠️',
  danger: '⛔',
}

async function activeTabId(): Promise<number | null> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  return tab?.id ?? null
}

/** Compact subject line for the current-tab verdict card: just the host,
 * so the card stays readable at side-panel widths (~360-400px). Falls back
 * to the raw string when it isn't a parseable URL. */
function hostOf(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return url
  }
}

function SidePanel() {
  const [tabVerdict, setTabVerdict] = useState<CachedTabVerdict | null>(null)
  const [metrics, setMetrics] = useState<Metrics | null>(null)

  useEffect(() => {
    let cancelled = false

    async function load() {
      const tabId = await activeTabId()
      const verdict = tabId != null ? await getCachedTabVerdict(tabId) : null
      const currentMetrics = await getMetrics(chromeStore('local'), new Date())
      if (!cancelled) {
        setTabVerdict(verdict)
        setMetrics(currentMetrics)
      }
    }

    load()
    const onChanged = () => load()
    chrome.storage.onChanged.addListener(onChanged)
    return () => {
      cancelled = true
      chrome.storage.onChanged.removeListener(onChanged)
    }
  }, [])

  return (
    <div className="app sidepanel">
      <header className="app__header">
        <div className="app__brand">
          <div>
            <h1>Alerta Estafa</h1>
            <p className="app__tagline">Panel de esta pestaña</p>
          </div>
        </div>
      </header>

      <section aria-label="Veredicto de esta página">
        {tabVerdict ? (
          <VerdictCard
            level={tabVerdict.level}
            word={VERDICT_WORD[tabVerdict.level]}
            icon={VERDICT_ICON[tabVerdict.level]}
            subject={hostOf(tabVerdict.url)}
            summary={tabVerdict.tip}
            reasons={tabVerdict.reasons}
          />
        ) : (
          <p className="sidepanel__no-verdict">
            Todavía no analizamos esta página. Navegá a un sitio para ver su veredicto acá.
          </p>
        )}
      </section>

      <section>
        <h2 className="sidepanel__section-title">Amenazas que frenamos</h2>
        {metrics && <MetricsTiles metrics={metrics} />}
      </section>

      <section aria-label="Chat de ayuda" className="sidepanel__chat-section">
        <h2 className="sidepanel__section-title">Preguntanos</h2>
        <Chat />
      </section>
    </div>
  )
}

const container = document.getElementById('root')
if (!container) {
  throw new Error('#root element missing from sidepanel.html')
}

createRoot(container).render(
  <StrictMode>
    <SidePanel />
  </StrictMode>,
)
