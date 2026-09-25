import { useEffect, useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react'
import { copyToMemory } from '../blob'
import { startQrScanner } from '../qr'

/**
 * Full-screen accessible QR scanner dialog.
 *
 * Ownership boundaries (read this before wiring it up elsewhere):
 * - This component owns camera permission (`getUserMedia`), the live
 *   scanning loop (via `startQrScanner` from `qr.ts`), and stopping the
 *   camera stream on every exit path (a successful scan, Escape, the
 *   "Cerrar" button, and unmount).
 * - It does NOT decode the fallback-uploaded photo itself. When the user
 *   picks a photo via "Subir foto del QR", the raw file is handed back
 *   through `onFallbackImage` — the caller decides how to decode it (e.g.
 *   by calling `decodeQrFromImage` from `qr.ts`) and how to report "no QR
 *   found", the same way `Composer` hands raw images up to `Chat` for OCR
 *   instead of deciding that itself. This keeps the contract simple: this
 *   component only ever reports a *live-scanned* result via `onResult`.
 */
export interface QrScannerProps {
  /** Called exactly once, with the decoded content, after a successful
   * live camera scan. Never called for the fallback-photo path. */
  onResult: (content: string) => void
  /** Called when the user closes the dialog (Escape or the "Cerrar"
   * button). The caller is responsible for unmounting the dialog. */
  onClose: () => void
  /** Called with the raw picked file when the user uses the "Subir foto
   * del QR" fallback. Decoding it is the caller's responsibility. */
  onFallbackImage: (file: Blob) => void
}

type CameraState = 'active' | 'denied' | 'unsupported'

export const QR_SCANNER_DENIED_MESSAGE =
  'No pudimos usar la cámara. Revisá los permisos o subí una foto del QR.'
export const QR_SCANNER_UNSUPPORTED_MESSAGE = 'Para usar la cámara abrí la app con https.'

function isCameraSupported(): boolean {
  return Boolean(window.isSecureContext) && Boolean(navigator.mediaDevices?.getUserMedia)
}

const FOCUSABLE_SELECTOR =
  'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'

export function QrScanner({ onResult, onClose, onFallbackImage }: QrScannerProps) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const previouslyFocusedRef = useRef<Element | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const stopScannerRef = useRef<(() => void) | null>(null)
  const onResultRef = useRef(onResult)
  const [state, setState] = useState<CameraState>('active')

  useEffect(() => {
    onResultRef.current = onResult
  }, [onResult])

  /** Stops the live scan loop and every camera track. Safe to call more
   * than once (both the scanner stop function and MediaStreamTrack.stop
   * are idempotent) and reused by every exit path. */
  function stopCamera() {
    stopScannerRef.current?.()
    stopScannerRef.current = null
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
  }

  // Focus management: move focus in on mount, return it to whatever
  // triggered the dialog on unmount, and always release the camera.
  useEffect(() => {
    previouslyFocusedRef.current = document.activeElement
    closeButtonRef.current?.focus()
    return () => {
      stopCamera()
      const toRefocus = previouslyFocusedRef.current
      if (toRefocus instanceof HTMLElement) toRefocus.focus()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Camera acquisition: runs once on mount. onResult is read through a ref
  // so a caller passing a fresh inline callback each render doesn't tear
  // down and re-request the camera.
  useEffect(() => {
    if (!isCameraSupported()) {
      setState('unsupported')
      return
    }
    let cancelled = false
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'environment' } })
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop())
          return
        }
        streamRef.current = stream
        const video = videoRef.current
        if (!video) return
        video.srcObject = stream
        try {
          const playResult = video.play?.()
          if (playResult && typeof playResult.catch === 'function') {
            playResult.catch(() => {})
          }
        } catch {
          // Autoplay can be rejected/unsupported in some environments
          // (and jsdom's play() isn't implemented at all); the live
          // scanning loop below doesn't depend on playback actually
          // starting, so this is safe to ignore.
        }
        stopScannerRef.current = startQrScanner(
          video,
          (content) => {
            stopCamera()
            onResultRef.current(content)
          },
          () => {
            // Internal decode-tick errors are non-fatal: the live preview
            // keeps running silently and the user can still fall back to
            // "Subir foto del QR" if scanning never finds anything.
          },
        )
        setState('active')
      })
      .catch(() => {
        if (!cancelled) setState('denied')
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function close() {
    stopCamera()
    onClose()
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      event.preventDefault()
      close()
      return
    }
    if (event.key !== 'Tab') return
    const nodeList = dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
    if (!nodeList || nodeList.length === 0) return
    const focusable = Array.from(nodeList).filter((el) => !el.hasAttribute('disabled'))
    if (focusable.length === 0) return
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const input = event.target
    const file = input.files?.[0]
    if (!file) return
    const image = await copyToMemory(file)
    input.value = ''
    onFallbackImage(image)
  }

  const errorMessage =
    state === 'denied'
      ? QR_SCANNER_DENIED_MESSAGE
      : state === 'unsupported'
        ? QR_SCANNER_UNSUPPORTED_MESSAGE
        : null

  return (
    <div
      className="qr-scanner"
      role="dialog"
      aria-modal="true"
      aria-label="Escanear código QR"
      ref={dialogRef}
      onKeyDown={handleKeyDown}
    >
      <div className="qr-scanner__header">
        <p className="qr-scanner__title">Escanear código QR</p>
        <button
          type="button"
          ref={closeButtonRef}
          className="qr-scanner__close"
          onClick={close}
        >
          Cerrar
        </button>
      </div>

      {errorMessage ? (
        <div className="qr-scanner__message" role="alert">
          <p>{errorMessage}</p>
        </div>
      ) : (
        <div className="qr-scanner__viewport">
          {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
          <video ref={videoRef} className="qr-scanner__video" playsInline muted autoPlay />
          <div className="qr-scanner__frame" aria-hidden="true" />
          <p className="qr-scanner__hint">Apuntá la cámara al código QR</p>
        </div>
      )}

      <button
        type="button"
        className="qr-scanner__fallback-btn"
        onClick={() => fileInputRef.current?.click()}
      >
        Subir foto del QR
      </button>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        aria-label="Foto del QR"
        className="visually-hidden"
        onChange={handleFileChange}
      />
    </div>
  )
}
