// OCR is dynamically imported so tesseract.js (and its wasm/lang assets)
// never land in the initial bundle. All assets are served locally — from
// /tesseract in the PWA build (see vite.config.ts) or from the extension's
// own bundled files (see vite.extension.config.ts) — the MV3 extension
// forbids remote code, so both builds ship the assets themselves.

function hasChromeRuntime(): boolean {
  return (
    typeof chrome !== 'undefined' &&
    typeof chrome.runtime?.getURL === 'function'
  )
}

function assetPath(relative: string): string {
  return hasChromeRuntime() ? chrome.runtime.getURL(`tesseract/${relative}`) : `/tesseract/${relative}`
}

/** Safety net: OCR must never leave the chat stuck "busy" forever (e.g. a
 * corrupt image or a stalled worker). After this many ms, extractText
 * rejects and the caller (Chat) shows OCR_FAILED_MESSAGE. */
export const OCR_TIMEOUT_MS = 45_000

/** Rejects with OCR_TIMEOUT if `work` does not settle within OCR_TIMEOUT_MS. */
function withTimeout<T>(work: Promise<T>): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_resolve, reject) => {
    timeoutId = setTimeout(() => reject(new Error('OCR_TIMEOUT')), OCR_TIMEOUT_MS)
  })
  return Promise.race([work, timeout]).finally(() => clearTimeout(timeoutId))
}

type OcrWorker = Awaited<ReturnType<typeof import('tesseract.js')['createWorker']>>

/** Extracts Spanish text from an image (screenshot of a scam message).
 * The timeout covers loading the worker too, not only recognition: a worker
 * whose script or wasm is blocked never becomes ready and never rejects.
 * The worker is terminated on every outcome, including a timeout. */
export async function extractText(file: Blob): Promise<string> {
  let worker: OcrWorker | undefined
  let timedOut = false
  const work = (async () => {
    const { createWorker } = await import('tesseract.js')
    const created = await createWorker('spa', 1, {
      workerPath: assetPath('worker.min.js'),
      corePath: assetPath('tesseract-core-lstm.wasm.js'),
      langPath: assetPath(''),
      gzip: true,
      // Inside the MV3 extension a blob: worker cannot importScripts() a
      // chrome-extension:// URL, so the worker must be created from its file.
      workerBlobURL: !hasChromeRuntime(),
    })
    if (timedOut) {
      await created.terminate()
      throw new Error('OCR_TIMEOUT')
    }
    worker = created
    const {
      data: { text },
    } = await created.recognize(file)
    return text.trim()
  })()
  try {
    return await withTimeout(work)
  } catch (error) {
    timedOut = true
    throw error
  } finally {
    await worker?.terminate()
  }
}
