// OCR is dynamically imported so tesseract.js (and its wasm/lang assets)
// never land in the initial bundle. All assets are served locally from
// /tesseract (see vite.config.ts) — the MV3 extension forbids remote code.

const WORKER_PATH = '/tesseract/worker.min.js'
const CORE_PATH = '/tesseract/tesseract-core-lstm.wasm.js'
const LANG_PATH = '/tesseract/'

/** Extracts Spanish text from an image (screenshot of a scam message). */
export async function extractText(file: Blob): Promise<string> {
  const { createWorker } = await import('tesseract.js')
  const worker = await createWorker('spa', 1, {
    workerPath: WORKER_PATH,
    corePath: CORE_PATH,
    langPath: LANG_PATH,
    gzip: true,
  })
  try {
    const {
      data: { text },
    } = await worker.recognize(file)
    return text.trim()
  } finally {
    await worker.terminate()
  }
}
