export interface QuickChipsProps {
  chips: string[]
  onSelect: (chip: string) => void
}

/** Quick-action chips (>=48px targets) shown under every assistant reply. */
export function QuickChips({ chips, onSelect }: QuickChipsProps) {
  if (chips.length === 0) return null
  return (
    <div className="quick-chips" role="group" aria-label="Preguntas rápidas">
      {chips.map((chip) => (
        <button key={chip} type="button" className="chip" onClick={() => onSelect(chip)}>
          {chip}
        </button>
      ))}
    </div>
  )
}
