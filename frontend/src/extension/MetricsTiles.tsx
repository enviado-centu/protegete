import type { Metrics } from './metrics'

export interface MetricsTilesProps {
  metrics: Metrics
}

const TILES: Array<{ key: keyof Metrics; caption: string }> = [
  { key: 'today', caption: 'Hoy' },
  { key: 'week', caption: 'Esta semana' },
  { key: 'total', caption: 'Total' },
]

/** Three big-number tiles (spec §4b): no charts, readable at a glance. */
export function MetricsTiles({ metrics }: MetricsTilesProps) {
  return (
    <section className="metrics-tiles" aria-label="Estadísticas de amenazas detectadas">
      <div className="metrics-tiles__grid">
        {TILES.map(({ key, caption }) => {
          const counts = metrics[key]
          return (
            <div className="metrics-tile" key={key}>
              <p className="metrics-tile__number" aria-hidden="true">
                {counts.total}
              </p>
              <p className="metrics-tile__caption">{caption}</p>
              <p className="metrics-tile__subtitle">amenazas detectadas</p>
              <p className="metrics-tile__danger">{counts.danger} peligrosas</p>
              <span className="visually-hidden">
                {caption}: {counts.total} amenazas detectadas, {counts.danger} peligrosas
              </span>
            </div>
          )
        })}
      </div>
    </section>
  )
}
