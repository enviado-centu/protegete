import { CATEGORY_TO_LESSON_ID } from '../core/chatEngine'
import { LessonCard } from '../core/components/LessonCard'
import type { Lesson } from '../core/types'
import type { CachedTabVerdict } from './tabVerdict'

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

/** Compact subject line for the current-tab verdict: just the host, so the
 * pill stays readable at side-panel widths (~300-400px). Falls back to the
 * raw string when it isn't a parseable URL. */
export function hostOf(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return url
  }
}

export interface StatusPillProps {
  tabVerdict: CachedTabVerdict | null
  lessons: Lesson[]
}

/**
 * One-line current-page verdict (icon + word + host), expandable to the
 * reasons and a matching lesson. Uses a native `<details>` so it is
 * tappable/keyboard-operable and exposes `aria-expanded` for free.
 */
export function StatusPill({ tabVerdict, lessons }: StatusPillProps) {
  if (!tabVerdict) {
    return (
      <p className="status-pill status-pill--empty">
        Abrí un sitio y te decimos si es seguro.
      </p>
    )
  }

  const word = VERDICT_WORD[tabVerdict.level]
  const icon = VERDICT_ICON[tabVerdict.level]
  const host = hostOf(tabVerdict.url)
  const lessonId = CATEGORY_TO_LESSON_ID[tabVerdict.category as keyof typeof CATEGORY_TO_LESSON_ID]
  const lesson = lessonId ? lessons.find((entry) => entry.id === lessonId) : undefined

  return (
    <>
      <details className={`status-pill status-pill--${tabVerdict.level}`}>
        <summary
          className="status-pill__summary"
          aria-label={`Veredicto de esta página: ${word}, ${host}. Tocá para ver más detalles.`}
        >
          <span aria-hidden="true">{icon}</span>
          <strong className="status-pill__word">{word}</strong>
          <span className="status-pill__host">· {host}</span>
        </summary>
        <div className="status-pill__body">
          <p>{tabVerdict.tip}</p>
          {tabVerdict.reasons.length > 0 && (
            <ul className="status-pill__reasons">
              {tabVerdict.reasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          )}
          {lesson && <LessonCard lesson={lesson} />}
        </div>
      </details>
      <PageSignalsSection tabVerdict={tabVerdict} />
    </>
  )
}

export interface PageSignalsSectionProps {
  tabVerdict: CachedTabVerdict | null
}

/**
 * Expandable "Lo que encontramos en la página" section, fed by the
 * in-browser page signal probe (Feature C). Only rendered when the cached
 * verdict carries page signals. Reuses the exact same `<details>` /
 * `.status-pill__body` / `.status-pill__reasons` pattern as the main
 * verdict pill above, for visual and accessibility consistency.
 */
export function PageSignalsSection({ tabVerdict }: PageSignalsSectionProps) {
  const pageSignals = tabVerdict?.pageSignals
  if (!pageSignals || pageSignals.length === 0) return null

  const pageLessons = tabVerdict?.pageLessons ?? []

  return (
    <details className="status-pill status-pill--page-signals">
      <summary
        className="status-pill__summary"
        aria-label="Lo que encontramos en la página. Tocá para ver más detalles."
      >
        <span aria-hidden="true">🔍</span>
        <strong className="status-pill__word">Lo que encontramos en la página</strong>
      </summary>
      <div className="status-pill__body">
        <ul className="status-pill__reasons">
          {pageSignals.map((signal) => (
            <li key={signal.id}>{signal.reason}</li>
          ))}
        </ul>
        {pageLessons.map((pageLesson) => (
          <LessonCard key={pageLesson.id} lesson={pageLesson} />
        ))}
      </div>
    </details>
  )
}
