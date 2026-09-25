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
function hostOf(url: string): string {
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
  )
}
