import type { Metrics } from './metrics'

export interface MetricsTilesProps {
  metrics: Metrics
}

const TILES: Array<{ key: keyof Metrics; caption: string }> = [
  { key: 'today', caption: 'Hoy' },
  { key: 'week', caption: 'Semana' },
  { key: 'total', caption: 'Total' },
]

/** Singular/plural agreement for a count label (e.g. "1 peligrosa" vs
 * "2 peligrosas"), applied to every count shown in the tiles. */
function pluralize(count: number, singular: string, plural: string): string {
  return count === 1 ? singular : plural
}

/** One compact row of 3 stat chips (spec: metrics readable at a glance, no
 * charts, no separate section heading duplicating this caption). */
export function MetricsTiles({ metrics }: MetricsTilesProps) {
  return (
    <section className="metrics-tiles" aria-label="Estadísticas de amenazas detectadas">
      <p className="metrics-tiles__caption">Amenazas detectadas</p>
      <div className="metrics-tiles__grid">
        {TILES.map(({ key, caption }) => {
          const counts = metrics[key]
          const threatsLabel = pluralize(
            counts.total,
            'amenaza detectada',
            'amenazas detectadas',
          )
          const dangerLabel = pluralize(counts.danger, 'peligrosa', 'peligrosas')
          const describedText =
            counts.danger > 0
              ? `${caption}: ${counts.total} ${threatsLabel}, ${counts.danger} ${dangerLabel}`
              : `${caption}: ${counts.total} ${threatsLabel}`
          return (
            <div className="metrics-tile" key={key} role="group" aria-label={describedText}>
              <p className="metrics-tile__number" aria-hidden="true">
                {counts.total}
              </p>
              <p className="metrics-tile__caption">{caption}</p>
              {counts.danger > 0 && (
                <p className="metrics-tile__danger">
                  {counts.danger} {dangerLabel}
                </p>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}
