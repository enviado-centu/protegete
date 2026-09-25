import { useEffect, useState } from 'react'
import { getRememberedOrigins, unregisterPersistentScan } from './scan'

/**
 * "Sitios que reviso siempre" settings row (Feature B.3): lists the
 * origins the user opted to always scan ("Recordar para este sitio") with
 * a remove button per site.
 */
export function RememberedSites() {
  const [origins, setOrigins] = useState<string[]>([])

  useEffect(() => {
    let cancelled = false
    getRememberedOrigins().then((value) => {
      if (!cancelled) setOrigins(value)
    })
    return () => {
      cancelled = true
    }
  }, [])

  async function handleRemove(origin: string) {
    await unregisterPersistentScan(origin)
    setOrigins((prev) => prev.filter((entry) => entry !== origin))
  }

  if (origins.length === 0) return null

  return (
    <details className="status-pill">
      <summary className="status-pill__summary" aria-label="Sitios que reviso siempre. Tocá para ver más detalles.">
        <span aria-hidden="true">⚙️</span>
        <strong className="status-pill__word">Sitios que reviso siempre</strong>
      </summary>
      <div className="status-pill__body">
        <ul className="remembered-sites__list">
          {origins.map((origin) => (
            <li key={origin} className="remembered-sites__item">
              <span>{origin}</span>
              <button type="button" className="remembered-sites__remove" onClick={() => handleRemove(origin)}>
                Quitar
              </button>
            </li>
          ))}
        </ul>
      </div>
    </details>
  )
}
