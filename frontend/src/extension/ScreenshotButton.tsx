import { useState } from 'react'
import { scanVisibleScreenshot, type ScreenshotReviewResult } from './scan'

export interface ScreenshotButtonProps {
  onResult: (result: ScreenshotReviewResult) => void
}

/**
 * "📸 Revisar también lo que se ve" (Feature B.4): captures the visible
 * tab, OCRs it entirely in-browser (the image itself never leaves the
 * device — only the extracted text is analyzed), and reports the merged
 * result via `onResult`. Only shown once the page has already been scanned
 * (see sidepanel.tsx), matching the spec's "in the scanned state" gate.
 */
export function ScreenshotButton({ onResult }: ScreenshotButtonProps) {
  const [reading, setReading] = useState(false)
  const [error, setError] = useState(false)

  async function handleClick() {
    setReading(true)
    setError(false)
    try {
      const win = await chrome.windows.getCurrent()
      if (win.id == null) throw new Error('no window id')
      const result = await scanVisibleScreenshot(win.id)
      if (result) onResult(result)
    } catch {
      setError(true)
    } finally {
      setReading(false)
    }
  }

  return (
    <div className="screenshot-btn">
      <button
        type="button"
        className="consent-card__btn"
        onClick={handleClick}
        disabled={reading}
      >
        📸 Revisar también lo que se ve
      </button>
      {reading && (
        <p role="status" aria-live="polite" className="screenshot-btn__status">
          Leyendo la pantalla…
        </p>
      )}
      {error && (
        <p role="status" aria-live="polite" className="screenshot-btn__status">
          No pude leer la pantalla. Probá de nuevo.
        </p>
      )}
    </div>
  )
}
