import { StrictMode, useCallback, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Chat } from '../core/components/Chat'
import type { ChatMessage } from '../core/components/chatMessage'
import { ShieldIcon } from '../core/components/ShieldIcon'
import { TextSizeToggle } from '../core/components/TextSizeToggle'
import { getLessons } from '../core/api'
import type { ChatContext, Lesson } from '../core/types'
import { StatusPill, hostOf } from './StatusPill'
import { MetricsTiles } from './MetricsTiles'
import { getCachedTabVerdict, type CachedTabVerdict } from './tabVerdict'
import { getMetrics, chromeStore, type Metrics } from './metrics'
import { applyVerdictToTab } from './background'
import { ConsentCard } from './ConsentCard'
import { ScreenshotButton } from './ScreenshotButton'
import { RememberedSites } from './RememberedSites'
import { getRememberedOrigins, originOf, type ScreenshotReviewResult } from './scan'
import { mergeVerdicts } from './verdictMerge'
import '../core/theme.css'

async function activeTabId(): Promise<number | null> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  return tab?.id ?? null
}

function isHttpUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

/** Builds the grounded chat context from the current tab's cached verdict
 * (URL analysis, optionally enriched by page signals — Task B): the exact
 * evidence a "¿por qué es peligroso?" question should be answered from. */
function chatContextFromTabVerdict(verdict: CachedTabVerdict | null): ChatContext | null {
  if (!verdict) return null
  return {
    level: verdict.level,
    category: verdict.category,
    url: verdict.url,
    reasons: verdict.reasons,
    page_signals: verdict.pageSignals?.map((signal) => ({ id: signal.id, reason: signal.reason })),
  }
}

/** The side panel's opening bubble: names the page it's looking at and
 * offers two one-tap questions, so a first-time user isn't staring at an
 * empty composer. */
function greetingMessages(verdict: CachedTabVerdict | null): ChatMessage[] {
  if (!verdict) return []
  return [
    {
      id: 'greeting',
      role: 'assistantB',
      text: `Estoy mirando ${hostOf(verdict.url)}. Preguntame lo que quieras sobre este sitio, por ejemplo: ¿por qué es peligroso?`,
      chips: ['¿Por qué es peligroso?', '¿Qué hago ahora?'],
    },
  ]
}

// Browsers without chrome.sidePanel (older Chromium, Opera) open this same
// page as the toolbar-icon popup instead (see background.ts). A popup has
// no host chrome giving it a size, so it needs one of its own.
const isPopupFallback = typeof chrome !== 'undefined' && !chrome.sidePanel

function SidePanel() {
  const [tabId, setTabId] = useState<number | null>(null)
  const [tabVerdict, setTabVerdict] = useState<CachedTabVerdict | null>(null)
  const [metrics, setMetrics] = useState<Metrics | null>(null)
  const [lessons, setLessons] = useState<Lesson[]>([])
  const [hasMessages, setHasMessages] = useState(false)
  const [metricsExpanded, setMetricsExpanded] = useState(true)

  const handleHasMessagesChange = useCallback((value: boolean) => {
    setHasMessages(value)
  }, [])

  // Identifies the tab+page the chat's grounded context belongs to: changes
  // whenever the active tab or its verdict's URL changes, so <Chat> remounts
  // (fresh greeting/history) instead of carrying a stale page's evidence
  // into a new one.
  const contextKey = tabId != null ? `${tabId}:${tabVerdict?.url ?? ''}` : undefined

  useEffect(() => {
    let cancelled = false

    async function load() {
      const currentTabId = await activeTabId()
      const verdict = currentTabId != null ? await getCachedTabVerdict(currentTabId) : null
      const currentMetrics = await getMetrics(chromeStore('local'), new Date())
      if (!cancelled) {
        setTabId(currentTabId)
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
        <Chat
          key={contextKey}
          contextKey={contextKey}
          initialContext={chatContextFromTabVerdict(tabVerdict)}
          initialMessages={greetingMessages(tabVerdict)}
          onHasMessagesChange={handleHasMessagesChange}
        />
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
