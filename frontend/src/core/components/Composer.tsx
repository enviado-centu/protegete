import {
  useLayoutEffect,
  useRef,
  type ChangeEvent,
  type ClipboardEvent,
  type KeyboardEvent,
} from 'react'

export interface ComposerProps {
  value: string
  onChange: (value: string) => void
  onSend: (text: string) => void
  onImage: (file: Blob) => void
  disabled?: boolean
}

const MAX_ROWS = 4
const FALLBACK_LINE_HEIGHT = 24

/** Text/URL input plus image paste and picker (spec: input accepts text/URL,
 * paste of images, and an image picker). The textarea auto-grows from one
 * line up to `MAX_ROWS` and never shows a manual resize handle, so it works
 * cleanly from 300px-wide panels up (no drag handle, no layout jump). */
export function Composer({ value, onChange, onSend, onImage, disabled }: ComposerProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Auto-grow: reset height then measure the natural content height, capped
  // at MAX_ROWS lines (beyond that the textarea scrolls internally). Kept
  // overflow-y: hidden by default (CSS) and only switched to auto once
  // content genuinely exceeds the cap — Chromium's empty-textarea
  // scrollHeight reflects its *wrapped placeholder* text, not the actual
  // (empty) content, so leaving overflow-y: auto on unconditionally would
  // register the box as scrollable — and can even paint a scrollbar — on
  // an empty single-line composer.
  useLayoutEffect(() => {
    const node = textareaRef.current
    if (!node) return
    if (!value) {
      node.style.height = ''
      node.style.overflowY = 'hidden'
      return
    }
    node.style.height = 'auto'
    const computed = window.getComputedStyle(node)
    const lineHeight = Number.parseFloat(computed.lineHeight) || FALLBACK_LINE_HEIGHT
    const paddingY =
      (Number.parseFloat(computed.paddingTop) || 0) + (Number.parseFloat(computed.paddingBottom) || 0)
    const borderY =
      (Number.parseFloat(computed.borderTopWidth) || 0) +
      (Number.parseFloat(computed.borderBottomWidth) || 0)
    const maxHeight = lineHeight * MAX_ROWS + paddingY + borderY
    node.style.height = `${Math.min(node.scrollHeight, maxHeight)}px`
    node.style.overflowY = node.scrollHeight > maxHeight ? 'auto' : 'hidden'
  }, [value])

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
        ref={textareaRef}
        aria-label="Escribí tu mensaje"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
        placeholder="Escribí o pegá acá…"
        rows={1}
        disabled={disabled}
      />
      <button
        type="button"
        className="composer__icon-btn"
        aria-label="Adjuntar captura"
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
      <button
        type="submit"
        className="composer__send-btn"
        aria-label="Enviar"
        disabled={disabled || !value.trim()}
      >
        Enviar
      </button>
    </form>
  )
}
