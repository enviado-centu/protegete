import type { Metrics } from './metrics'

export interface MetricsTilesProps {
  metrics: Metrics
}

const TILES: Array<{ key: keyof Metrics; caption: string }> = [
  { key: 'today', caption: 'Hoy' },
  { key: 'week', caption: 'Esta semana' },
  { key: 'total', caption: 'Total' },
]

/** Singular/plural agreement for a count label (e.g. "1 peligrosa" vs
 * "2 peligrosas"), applied to every count shown in the tiles. */
function pluralize(count: number, singular: string, plural: string): string {
  return count === 1 ? singular : plural
}

/** Three big-number tiles (spec §4b): no charts, readable at a glance. */
export function MetricsTiles({ metrics }: MetricsTilesProps) {
  return (
    <section className="metrics-tiles" aria-label="Estadísticas de amenazas detectadas">
      <div className="metrics-tiles__grid">
        {TILES.map(({ key, caption }) => {
          const counts = metrics[key]
          const threatsLabel = pluralize(
            counts.total,
            'amenaza detectada',
            'amenazas detectadas',
          )
          const dangerLabel = pluralize(counts.danger, 'peligrosa', 'peligrosas')
          return (
            <div className="metrics-tile" key={key}>
              <p className="metrics-tile__number" aria-hidden="true">
                {counts.total}
              </p>
              <p className="metrics-tile__caption">{caption}</p>
              <p className="metrics-tile__subtitle">{threatsLabel}</p>
              <p className="metrics-tile__danger">
                {counts.danger} {dangerLabel}
              </p>
              <span className="visually-hidden">
                {caption}: {counts.total} {threatsLabel}, {counts.danger} {dangerLabel}
              </span>
            </div>
          )
        })}
      </div>
    </section>
  )
}
