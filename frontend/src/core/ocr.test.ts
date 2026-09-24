import { expect, test, vi } from 'vitest'

const recognize = vi.fn(async () => ({ data: { text: '  hola mundo  \n' } }))
const terminate = vi.fn(async () => {})
const createWorker = vi.fn(async () => ({ recognize, terminate }))

vi.mock('tesseract.js', () => ({ createWorker }))

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
