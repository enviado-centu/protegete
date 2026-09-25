import { StrictMode, useCallback, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Chat } from '../core/components/Chat'
import { ShieldIcon } from '../core/components/ShieldIcon'
import { TextSizeToggle } from '../core/components/TextSizeToggle'
import { getLessons } from '../core/api'
import type { Lesson } from '../core/types'
import { StatusPill } from './StatusPill'
import { MetricsTiles } from './MetricsTiles'
import { getCachedTabVerdict, type CachedTabVerdict } from './tabVerdict'
import { getMetrics, chromeStore, type Metrics } from './metrics'
import '../core/theme.css'

async function activeTabId(): Promise<number | null> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  return tab?.id ?? null
}

// Browsers without chrome.sidePanel (older Chromium, Opera) open this same
// page as the toolbar-icon popup instead (see background.ts). A popup has
// no host chrome giving it a size, so it needs one of its own.
const isPopupFallback = typeof chrome !== 'undefined' && !chrome.sidePanel

function SidePanel() {
  const [tabVerdict, setTabVerdict] = useState<CachedTabVerdict | null>(null)
  const [metrics, setMetrics] = useState<Metrics | null>(null)
  const [lessons, setLessons] = useState<Lesson[]>([])
  const [hasMessages, setHasMessages] = useState(false)
  const [metricsExpanded, setMetricsExpanded] = useState(true)

  const handleHasMessagesChange = useCallback((value: boolean) => {
    setHasMessages(value)
  }, [])

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

  useEffect(() => {
    let cancelled = false
    getLessons()
      .then((catalog) => {
        if (!cancelled) setLessons(catalog)
      })
      .catch(() => {
        // The lesson link in the status pill is a bonus; losing the catalog
        // keeps the rest of the panel usable.
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Once the conversation is in use, the top area collapses behind a
  // toggle to give the chat room; the status pill and metrics stay one tap
  // away instead of disappearing.
  const showTopDetails = !hasMessages || metricsExpanded

  return (
    <div className={`app sidepanel${isPopupFallback ? ' popup' : ''}`}>
      <header className="sidepanel__topbar">
        <div className="sidepanel__brand">
          <ShieldIcon size={22} />
          <span className="sidepanel__brand-name">Protegete</span>
        </div>
        <div className="sidepanel__topbar-actions">
          <TextSizeToggle />
          {hasMessages && (
            <button
              type="button"
              className="sidepanel__toggle-metrics"
              aria-expanded={metricsExpanded}
              onClick={() => setMetricsExpanded((value) => !value)}
            >
              {metricsExpanded ? 'Ocultar métricas' : 'Ver métricas'}
            </button>
          )}
        </div>
      </header>

      {showTopDetails && (
        <div className="sidepanel__top">
          <section aria-label="Veredicto de esta página">
            <StatusPill tabVerdict={tabVerdict} lessons={lessons} />
          </section>
          {metrics && <MetricsTiles metrics={metrics} />}
        </div>
      )}

      <section aria-label="Chat de ayuda" className="sidepanel__chat-section">
        <Chat onHasMessagesChange={handleHasMessagesChange} />
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
