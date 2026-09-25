import type { Level } from '../types'

export interface VerdictCardProps {
  level: Level
  word: string
  icon: string
  summary: string
  reasons: string[]
  /** Compact label for what was analyzed (e.g. a URL's host). Optional:
   * only the side panel's current-tab card sets it today. */
  subject?: string
}

/**
 * Verdict is always color + icon + word + a plain-language sentence, never
 * color alone (WCAG 2.2 / spec §4b).
 */
export function VerdictCard({ level, word, icon, summary, reasons, subject }: VerdictCardProps) {
  return (
    <div
      className={`verdict-card verdict-card--${level}`}
      role="group"
      aria-label={`Veredicto: ${word}`}
    >
      {subject && <p className="verdict-card__subject">{subject}</p>}
      <p className="verdict-card__headline">
        <span aria-hidden="true">{icon}</span> <strong>{word}</strong>
      </p>
      <p className="verdict-card__summary">{summary}</p>
      {reasons.length > 0 && (
        <ul className="verdict-card__reasons">
          {reasons.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      )}
    </div>
  )
}
