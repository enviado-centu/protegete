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

/** Extracts Spanish text from an image (screenshot of a scam message). */
export async function extractText(file: Blob): Promise<string> {
  const { createWorker } = await import('tesseract.js')
  const worker = await createWorker('spa', 1, {
    workerPath: assetPath('worker.min.js'),
    corePath: assetPath('tesseract-core-lstm.wasm.js'),
    langPath: assetPath(''),
    gzip: true,
    // Inside the MV3 extension a blob: worker cannot importScripts() a
    // chrome-extension:// URL, so the worker must be created from its file.
    workerBlobURL: !hasChromeRuntime(),
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
