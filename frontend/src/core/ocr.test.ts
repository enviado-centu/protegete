import { afterEach, expect, test, vi } from 'vitest'

const recognize = vi.fn(async () => ({ data: { text: '  hola mundo  \n' } }))
const terminate = vi.fn(async () => {})
const createWorker = vi.fn(async () => ({ recognize, terminate }))

vi.mock('tesseract.js', () => ({ createWorker }))

afterEach(() => {
  vi.useRealTimers()
  recognize.mockClear()
  terminate.mockClear()
})

test('extractText trims whitespace and terminates the worker', async () => {
  const { extractText } = await import('./ocr')
  const text = await extractText(new Blob(['fake image bytes']))
  expect(text).toBe('hola mundo')
  expect(createWorker).toHaveBeenCalledWith(
    'spa',
    1,
    expect.objectContaining({
      workerPath: expect.stringContaining('/tesseract/'),
      langPath: '/tesseract/',
    }),
  )
  expect(terminate).toHaveBeenCalled()
})

test('extractText rejects after a 45s safety timeout and still terminates the worker', async () => {
  vi.useFakeTimers()
  // Simulate a stuck/never-resolving recognition (e.g. a corrupt image).
  recognize.mockReturnValueOnce(new Promise(() => {}))

  const { extractText, OCR_TIMEOUT_MS } = await import('./ocr')
  expect(OCR_TIMEOUT_MS).toBe(45_000)

  const result = extractText(new Blob(['fake image bytes']))
  const assertion = expect(result).rejects.toThrow('OCR_TIMEOUT')

  await vi.advanceTimersByTimeAsync(OCR_TIMEOUT_MS)
  await assertion

  expect(terminate).toHaveBeenCalled()
})

test('extractText also times out when the OCR worker never finishes loading', async () => {
  vi.useFakeTimers()
  // Simulate a worker that never becomes ready (e.g. its script is blocked).
  createWorker.mockReturnValueOnce(new Promise(() => {}) as never)

  const { extractText, OCR_TIMEOUT_MS } = await import('./ocr')
  const result = extractText(new Blob(['fake image bytes']))
  const assertion = expect(result).rejects.toThrow('OCR_TIMEOUT')

  await vi.advanceTimersByTimeAsync(OCR_TIMEOUT_MS)
  await assertion
})
