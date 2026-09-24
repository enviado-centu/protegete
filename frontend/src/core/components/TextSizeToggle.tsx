import { useEffect, useState } from 'react'

type TextSize = 'md' | 'lg' | 'xl'

const STORAGE_KEY = 'antiscam:text-size'
const LABELS: Record<TextSize, string> = { md: 'A', lg: 'A+', xl: 'A++' }
const ORDER: TextSize[] = ['md', 'lg', 'xl']

function isTextSize(value: string | null): value is TextSize {
  return value === 'md' || value === 'lg' || value === 'xl'
}

function readStored(): TextSize {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (isTextSize(stored)) return stored
  } catch {
    // localStorage unavailable (private mode, disabled cookies, ...): default.
  }
  return 'md'
}

/** A / A+ / A++ text-size toggle, persisted to localStorage (spec §4b). */
export function TextSizeToggle() {
  const [size, setSize] = useState<TextSize>(readStored)

  useEffect(() => {
    document.documentElement.setAttribute('data-text-size', size)
    try {
      localStorage.setItem(STORAGE_KEY, size)
    } catch {
      // ignore write failures; the visible state still updates this session
    }
  }, [size])

  return (
    <div className="text-size-toggle" role="group" aria-label="Tamaño del texto">
      {ORDER.map((option) => (
        <button
          key={option}
          type="button"
          aria-pressed={size === option}
          aria-label={`Tamaño de texto ${LABELS[option]}`}
          onClick={() => setSize(option)}
        >
          {LABELS[option]}
        </button>
      ))}
    </div>
  )
}
