import { useRef, type ChangeEvent, type ClipboardEvent, type KeyboardEvent } from 'react'

export interface ComposerProps {
  value: string
  onChange: (value: string) => void
  onSend: (text: string) => void
  onImage: (file: Blob) => void
  disabled?: boolean
}

/** Text/URL input plus image paste and picker (spec: input accepts text/URL,
 * paste of images, and an image picker). */
export function Composer({ value, onChange, onSend, onImage, disabled }: ComposerProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)

  function submit() {
    if (disabled || !value.trim()) return
    onSend(value)
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      submit()
    }
  }

  function handlePaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    const item = Array.from(event.clipboardData.items).find((entry) =>
      entry.type.startsWith('image/'),
    )
    if (!item) return
    const file = item.getAsFile()
    if (file) {
      event.preventDefault()
      onImage(file)
    }
  }

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (file) onImage(file)
  }

  return (
    <form
      className="composer"
      onSubmit={(event) => {
        event.preventDefault()
        submit()
      }}
    >
      <label className="visually-hidden" htmlFor="composer-input">
        Escribí tu mensaje, pegá un link o describí lo que recibiste
      </label>
      <textarea
        id="composer-input"
        aria-label="Escribí tu mensaje"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
        placeholder="Pegá un link, un mensaje o una captura..."
        rows={2}
        disabled={disabled}
      />
      <button
        type="button"
        aria-label="Adjuntar una imagen"
        onClick={() => fileInputRef.current?.click()}
        disabled={disabled}
      >
        <span aria-hidden="true">🖼️</span>
      </button>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        aria-label="Imagen a analizar"
        className="visually-hidden"
        onChange={handleFileChange}
      />
      <button type="submit" aria-label="Enviar" disabled={disabled || !value.trim()}>
        Enviar
      </button>
    </form>
  )
}
