// QR decoding core module, mirroring ocr.ts's async-module pattern: heavy
// work (the jsQR fallback decoder) is lazy dynamic-imported so it never
// lands in the initial bundle, and every public function is tolerant of
// "nothing found" — a caller never has to special-case a rejected promise
// just because a frame didn't contain a QR code.

type JsQRFn = typeof import('jsqr')['default']

interface BarcodeDetectorResult {
  rawValue: string
}

interface BarcodeDetectorLike {
  detect(source: CanvasImageSource): Promise<BarcodeDetectorResult[]>
}

declare global {
  interface Window {
    BarcodeDetector?: new (options: { formats: string[] }) => BarcodeDetectorLike
  }
}

function hasBarcodeDetector(): boolean {
  return typeof window !== 'undefined' && 'BarcodeDetector' in window && Boolean(window.BarcodeDetector)
}

let jsQRPromise: Promise<JsQRFn> | undefined

/** Lazy dynamic-import of jsqr, cached after the first call so repeated
 * scan ticks (startQrScanner) don't re-import on every frame. */
function loadJsQR(): Promise<JsQRFn> {
  if (!jsQRPromise) {
    jsQRPromise = import('jsqr').then((mod) => mod.default)
  }
  return jsQRPromise
}

function imageDataFromSource(
  source: CanvasImageSource,
  width: number,
  height: number,
): ImageData | null {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.drawImage(source, 0, 0, width, height)
  return ctx.getImageData(0, 0, width, height)
}

function loadImageElement(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve(img)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('QR_IMAGE_LOAD_FAILED'))
    }
    img.src = url
  })
}

/** Loads `blob` as a decodable image source: prefers createImageBitmap
 * (fast, works off the main thread's layout), falls back to an <img>
 * element when unavailable (older WebViews). */
async function loadImageSource(
  blob: Blob,
): Promise<{ source: CanvasImageSource; width: number; height: number }> {
  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(blob)
    return { source: bitmap, width: bitmap.width, height: bitmap.height }
  }
  const img = await loadImageElement(blob)
  return { source: img, width: img.naturalWidth, height: img.naturalHeight }
}

/** Decodes a QR code from a still image (e.g. an uploaded photo or a
 * pasted screenshot). Prefers the native BarcodeDetector API when
 * available, otherwise lazy-loads jsqr.
 *
 * Never rejects: resolves the decoded string, or `null` when no QR code is
 * found, the image is empty/unreadable, or an unexpected internal error
 * occurs. Callers only ever need to branch on the resolved value. */
export async function decodeQrFromImage(blob: Blob): Promise<string | null> {
  try {
    const { source, width, height } = await loadImageSource(blob)
    if (!width || !height) return null

    if (hasBarcodeDetector()) {
      const detector = new window.BarcodeDetector!({ formats: ['qr_code'] })
      const results = await detector.detect(source)
      return results[0]?.rawValue ?? null
    }

    const imageData = imageDataFromSource(source, width, height)
    if (!imageData) return null
    const jsQR = await loadJsQR()
    const result = jsQR(imageData.data, imageData.width, imageData.height)
    return result?.data ?? null
  } catch {
    return null
  }
}

/** ~8 frames per second, a reasonable balance between responsiveness and
 * battery/CPU use for a live camera scan loop. */
const SCAN_INTERVAL_MS = 1000 / 8

/**
 * Starts polling `video` for a QR code at ~8fps.
 *
 * Ownership split: the caller (the QrScanner dialog) is responsible for
 * calling getUserMedia and assigning the resulting MediaStream to
 * `video.srcObject` — that keeps camera-permission error handling in one
 * place (the dialog component), since this function only needs a video
 * element that is already playing a stream.
 *
 * On a decoded result this function calls `onResult` exactly once and then
 * stops its OWN internal polling loop — the dialog is expected to close or
 * stop scanning on the first result, so there is no reason to keep
 * decoding frames after that. Call the returned stop function to cancel
 * polling early (e.g. on unmount, on close, or when permission is
 * revoked). That returned function is idempotent (safe to call more than
 * once) and, importantly, it does NOT stop the MediaStream's tracks — the
 * caller owns the stream (it called getUserMedia) and is responsible for
 * calling `stream.getTracks().forEach(t => t.stop())` itself.
 */
export function startQrScanner(
  video: HTMLVideoElement,
  onResult: (content: string) => void,
  onError: (error: Error) => void,
): () => void {
  let stopped = false
  let ticking = false
  let jsQRRef: JsQRFn | undefined
  let canvas: HTMLCanvasElement | undefined
  const detector = hasBarcodeDetector() ? new window.BarcodeDetector!({ formats: ['qr_code'] }) : undefined

  async function decodeFrame(): Promise<string | null> {
    if (detector) {
      const results = await detector.detect(video)
      return results[0]?.rawValue ?? null
    }
    const width = video.videoWidth
    const height = video.videoHeight
    if (!width || !height) return null
    if (!canvas) canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.drawImage(video, 0, 0, width, height)
    const imageData = ctx.getImageData(0, 0, width, height)
    if (!jsQRRef) jsQRRef = await loadJsQR()
    const result = jsQRRef(imageData.data, imageData.width, imageData.height)
    return result?.data ?? null
  }

  async function tick() {
    if (stopped || ticking) return
    ticking = true
    try {
      const content = await decodeFrame()
      if (stopped) return
      if (content) {
        stopped = true
        clearInterval(intervalId)
        onResult(content)
      }
    } catch (error) {
      if (!stopped) {
        onError(error instanceof Error ? error : new Error(String(error)))
      }
    } finally {
      ticking = false
    }
  }

  const intervalId = setInterval(() => {
    void tick()
  }, SCAN_INTERVAL_MS)

  return function stop() {
    if (stopped) return
    stopped = true
    clearInterval(intervalId)
  }
}
