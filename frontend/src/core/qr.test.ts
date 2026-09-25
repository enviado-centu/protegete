import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const jsQRMock = vi.fn()
vi.mock('jsqr', () => ({ default: jsQRMock }))

function fakeBitmap(width = 10, height = 10) {
  return { width, height, close: vi.fn() }
}

function fakeCanvasContext() {
  return {
    drawImage: vi.fn(),
    getImageData: vi.fn(() => ({ data: new Uint8ClampedArray(4), width: 1, height: 1 })),
  }
}

function setBarcodeDetector(detect: (...args: unknown[]) => unknown) {
  ;(window as unknown as { BarcodeDetector: unknown }).BarcodeDetector = vi.fn(() => ({ detect }))
}

function clearBarcodeDetector() {
  delete (window as { BarcodeDetector?: unknown }).BarcodeDetector
}

describe('decodeQrFromImage', () => {
  let originalCreateImageBitmap: typeof globalThis.createImageBitmap
  let originalGetContext: typeof HTMLCanvasElement.prototype.getContext

  beforeEach(() => {
    originalCreateImageBitmap = globalThis.createImageBitmap
    originalGetContext = HTMLCanvasElement.prototype.getContext
    globalThis.createImageBitmap = vi.fn(async () => fakeBitmap()) as never
    HTMLCanvasElement.prototype.getContext = vi.fn(() => fakeCanvasContext()) as never
  })

  afterEach(() => {
    globalThis.createImageBitmap = originalCreateImageBitmap
    HTMLCanvasElement.prototype.getContext = originalGetContext
    clearBarcodeDetector()
    jsQRMock.mockReset()
  })

  test('uses the native BarcodeDetector when available and returns the decoded value', async () => {
    const detect = vi.fn(async () => [{ rawValue: 'https://ejemplo.com/pago' }])
    setBarcodeDetector(detect)

    const { decodeQrFromImage } = await import('./qr')
    const result = await decodeQrFromImage(new Blob(['fake image bytes']))

    expect(result).toBe('https://ejemplo.com/pago')
    expect(detect).toHaveBeenCalled()
  })

  test('falls back to jsQR and returns null when no QR code is found', async () => {
    jsQRMock.mockReturnValue(null)

    const { decodeQrFromImage } = await import('./qr')
    const result = await decodeQrFromImage(new Blob(['fake image bytes']))

    expect(result).toBeNull()
    expect(jsQRMock).toHaveBeenCalled()
  })

  test('resolves null (never rejects) when decoding throws unexpectedly', async () => {
    jsQRMock.mockImplementation(() => {
      throw new Error('boom')
    })

    const { decodeQrFromImage } = await import('./qr')
    await expect(decodeQrFromImage(new Blob(['fake image bytes']))).resolves.toBeNull()
  })
})

describe('startQrScanner', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    clearBarcodeDetector()
  })

  function fakeVideo() {
    return document.createElement('video')
  }

  test('calls onResult when the detector finds content, then stops its own polling', async () => {
    const detect = vi.fn(async () => [{ rawValue: 'https://ejemplo.com/qr' }])
    setBarcodeDetector(detect)

    const { startQrScanner } = await import('./qr')
    const onResult = vi.fn()
    const onError = vi.fn()
    const video = fakeVideo()

    startQrScanner(video, onResult, onError)
    await vi.advanceTimersByTimeAsync(125)

    expect(onResult).toHaveBeenCalledWith('https://ejemplo.com/qr')
    expect(onResult).toHaveBeenCalledTimes(1)
    expect(onError).not.toHaveBeenCalled()

    detect.mockClear()
    await vi.advanceTimersByTimeAsync(500)
    expect(detect).not.toHaveBeenCalled()
  })

  test('calls onError when the detector fails unexpectedly', async () => {
    const detect = vi.fn(async () => {
      throw new Error('camera glitch')
    })
    setBarcodeDetector(detect)

    const { startQrScanner } = await import('./qr')
    const onResult = vi.fn()
    const onError = vi.fn()
    const video = fakeVideo()

    startQrScanner(video, onResult, onError)
    await vi.advanceTimersByTimeAsync(125)

    expect(onError).toHaveBeenCalledWith(expect.any(Error))
    expect(onResult).not.toHaveBeenCalled()
  })

  test('the returned cleanup function stops polling and is idempotent', async () => {
    const detect = vi.fn(async () => [])
    setBarcodeDetector(detect)

    const { startQrScanner } = await import('./qr')
    const onResult = vi.fn()
    const onError = vi.fn()
    const video = fakeVideo()

    const stop = startQrScanner(video, onResult, onError)
    await vi.advanceTimersByTimeAsync(125)
    expect(detect).toHaveBeenCalled()

    stop()
    stop() // must be safe to call more than once

    detect.mockClear()
    await vi.advanceTimersByTimeAsync(500)
    expect(detect).not.toHaveBeenCalled()
    expect(onResult).not.toHaveBeenCalled()
  })
})
