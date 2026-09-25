import {
  useLayoutEffect,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
  type KeyboardEvent,
} from 'react'
import { copyToMemory } from '../blob'
import { isDictationSupported, startDictation } from '../dictation'
import { stop as stopReadAloud } from '../speech'

export interface ComposerProps {
  value: string
  onChange: (value: string) => void
  onSend: (text: string) => void
  onImage: (file: Blob) => void
  disabled?: boolean
  /** Shows the "Escanear código QR" button (PWA only — the extension side
   * panel can't reliably use the camera, see qr-and-phone-scanning task). */
  enableQrScan?: boolean
  /** Opens the live camera QR scanner dialog. Required when `enableQrScan`
   * is true. */
  onOpenScanner?: () => void
  /** Shows the 🎤 dictation button (PWA only — the extension side panel
   * can't reliably get mic permission in an MV3 side panel, see
   * voice-dictation task). Also hidden whenever the browser doesn't support
   * the Web Speech recognition API (feature detection via
   * `isDictationSupported`). */
  enableDictation?: boolean
}

const DICTATING_LABEL = 'Escuchando…'
const DICTATION_TOOLTIP =
  'El dictado usa el reconocimiento de voz del navegador (en Chrome, el audio lo procesa Google).'

const MAX_ROWS = 4
const FALLBACK_LINE_HEIGHT = 24

/** Text/URL input plus image paste and picker (spec: input accepts text/URL,
 * paste of images, and an image picker). The textarea auto-grows from one
 * line up to `MAX_ROWS` and never shows a manual resize handle, so it works
 * cleanly from 300px-wide panels up (no drag handle, no layout jump). */
export function Composer({
  value,
  onChange,
  onSend,
  onImage,
  disabled,
  enableQrScan,
  onOpenScanner,
  enableDictation,
}: ComposerProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const stopDictationRef = useRef<(() => void) | null>(null)
  const [listening, setListening] = useState(false)
  const [dictationError, setDictationError] = useState<string | null>(null)

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

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const input = event.target
    const file = input.files?.[0]
    if (!file) return
    const image = await copyToMemory(file)
    input.value = ''
    onImage(image)
  }

  /** Toggles dictation. Starting it stops any ongoing read-aloud (spec: the
   * app shouldn't talk over the user) and captures the composer's current
   * text once, so every recognized result (interim or final) replaces the
   * dictated tail while keeping whatever was already typed. Clicking again
   * while listening stops the session directly — it doesn't wait for the
   * recognizer's own onEnd, since a caller-initiated stop should feel
   * instant. */
  function handleDictationClick() {
    if (listening) {
      stopDictationRef.current?.()
      stopDictationRef.current = null
      setListening(false)
      return
    }

    setDictationError(null)
    stopReadAloud()
    const baseText = value

    stopDictationRef.current = startDictation({
      onText: (text, isFinal) => {
        onChange(baseText.trim() ? `${baseText} ${text}` : text)
        if (isFinal) setListening(false)
      },
      onEnd: () => setListening(false),
      onError: (message) => {
        setDictationError(message)
        setListening(false)
      },
    })
    setListening(true)
  }

  return (
    <>
      {listening && (
        <p className="composer__dictation-status" role="status">
          {DICTATING_LABEL}
        </p>
      )}
      {dictationError && (
        <p className="composer__dictation-error" role="alert">
          {dictationError}
        </p>
      )}
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
        {enableQrScan && (
          <button
            type="button"
            className="composer__icon-btn"
            aria-label="Escanear código QR"
            onClick={onOpenScanner}
            disabled={disabled}
          >
            <span aria-hidden="true">🔳</span>
          </button>
        )}
        {enableDictation && isDictationSupported() && (
          <button
            type="button"
            className={`composer__icon-btn${listening ? ' is-listening' : ''}`}
            aria-label="Dictar mensaje"
            aria-pressed={listening}
            title={DICTATION_TOOLTIP}
            onClick={handleDictationClick}
            disabled={disabled}
          >
            <span aria-hidden="true">🎤</span>
          </button>
        )}
        <button
          type="submit"
          className="composer__send-btn"
          aria-label="Enviar"
          disabled={disabled || !value.trim()}
        >
          Enviar
        </button>
      </form>
    </>
  )
}
