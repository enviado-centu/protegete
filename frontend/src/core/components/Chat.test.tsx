import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { render, screen, waitFor, waitForElementToBeRemoved } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Chat } from './Chat'
import * as api from '../api'
import * as ocr from '../ocr'
import * as qr from '../qr'
import type { ChatContext } from '../types'

vi.mock('../api')
vi.mock('../ocr')
vi.mock('../qr', () => ({ decodeQrFromImage: vi.fn(), startQrScanner: vi.fn() }))

function typeAndSend(input: HTMLElement, text: string) {
  const user = userEvent.setup()
  return user
    .type(input, text)
    .then(() => user.click(screen.getByRole('button', { name: /enviar/i })))
}

/** A promise plus its resolve/reject, so a test can hold a mocked async
 * call open to observe an intermediate ("busy") UI state before letting it
 * settle. */
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('Chat', () => {
  beforeEach(() => {
    vi.mocked(api.getLessons).mockResolvedValue([])
    vi.mocked(api.askChat).mockResolvedValue({ answer: null, fallback: true })
    vi.mocked(qr.decodeQrFromImage).mockResolvedValue(null)
  })

  test('backend unreachable shows a friendly error and keeps the typed text', async () => {
    vi.mocked(api.analyzeText).mockRejectedValue(new api.ApiUnavailableError())
    render(<Chat />)
    const input = screen.getByRole('textbox', { name: /escribí tu mensaje/i })
    await typeAndSend(input, 'este mensaje me parece raro avisame')

    expect(
      await screen.findByText(/no pude conectarme al analizador/i),
    ).toBeInTheDocument()
    expect(input).toHaveValue('este mensaje me parece raro avisame')
  })

  test('danger verdict renders the word "Peligroso", not only color', async () => {
    vi.mocked(api.analyzeUrl).mockResolvedValue({
      url: 'http://bna-homebanking-verificar.xyz',
      level: 'danger',
      score: 0.9,
      category: 'suspicious_domain',
      reasons: ['El sitio imita a un banco pero no es su dirección oficial.'],
      tip: 'No ingreses tus datos ahí.',
      ml: { probability: 0.9, threshold: 0.5, flagged: true, top_features: [] },
      rules: [{ id: 'fake_domain', weight: 0.5 }],
      details: { blacklist: false, whitelist: false, ml_probability: 0.9, reputation: 'unavailable' },
    })
    render(<Chat />)
    const input = screen.getByRole('textbox', { name: /escribí tu mensaje/i })
    await typeAndSend(input, 'bna-homebanking-verificar.xyz')

    expect(await screen.findByText('Peligroso')).toBeInTheDocument()
  })

  test('a null layer-B answer renders no extra bubble', async () => {
    vi.mocked(api.analyzeText).mockResolvedValue({
      level: 'safe',
      score: 0,
      category: 'none',
      reasons: [],
      tip: 'Todo bien.',
      signals: [],
      lessons: [],
      urls: [],
    })
    vi.mocked(api.askChat).mockResolvedValue({ answer: null, fallback: true })
    render(<Chat />)
    const input = screen.getByRole('textbox', { name: /escribí tu mensaje/i })
    await typeAndSend(input, 'hola familia les cuento que llego tarde')

    await screen.findByText('Parece seguro')
    expect(screen.queryAllByTestId('assistant-b')).toHaveLength(0)
  })

  test('a successful layer-B answer is appended under the A reply', async () => {
    vi.mocked(api.analyzeText).mockResolvedValue({
      level: 'safe',
      score: 0,
      category: 'none',
      reasons: [],
      tip: 'Todo bien.',
      signals: [],
      lessons: [],
      urls: [],
    })
    vi.mocked(api.askChat).mockResolvedValue({ answer: 'Todo tranquilo.', fallback: false })
    render(<Chat />)
    const input = screen.getByRole('textbox', { name: /escribí tu mensaje/i })
    await typeAndSend(input, 'hola familia les cuento que llego tarde')

    expect(await screen.findByText('Todo tranquilo.')).toBeInTheDocument()
  })

  test('renders three example buttons in the empty state', async () => {
    render(<Chat />)
    expect(
      await screen.findByRole('button', { name: 'Probar un mensaje falso' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Probar un link sospechoso' })).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: '¿Cómo me doy cuenta de una estafa?' }),
    ).toBeInTheDocument()
  })

  test('an OCR failure is reported as a reading error, not as "no text"', async () => {
    vi.mocked(ocr.extractText).mockRejectedValue(new Error('worker failed'))
    const { container } = render(<Chat />)
    const input = container.querySelector('input[type=file]') as HTMLInputElement
    await userEvent.upload(input, new File(['x'], 'shot.png', { type: 'image/png' }))
    expect(await screen.findByText('No pude leer la imagen. Probá con otra captura o pegá el texto.')).toBeInTheDocument()
    expect(screen.queryByText('No encontré texto en la imagen.')).not.toBeInTheDocument()
  })

  test('shows "Analizando…" while a text analysis is in flight, then clears it', async () => {
    const gate = deferred<Awaited<ReturnType<typeof api.analyzeText>>>()
    vi.mocked(api.analyzeText).mockReturnValue(gate.promise)
    render(<Chat />)
    const input = screen.getByRole('textbox', { name: /escribí tu mensaje/i })
    await typeAndSend(input, 'hola familia les cuento que llego tarde')

    expect(await screen.findByText('Analizando…')).toBeInTheDocument()

    gate.resolve({
      level: 'safe',
      score: 0,
      category: 'none',
      reasons: [],
      tip: 'Todo bien.',
      signals: [],
      lessons: [],
      urls: [],
    })

    await waitForElementToBeRemoved(() => screen.queryByText('Analizando…'))
  })

  test('shows "Leyendo la imagen…" while OCR runs, then "Analizando…" once it resolves', async () => {
    const ocrGate = deferred<string>()
    const analysisGate = deferred<Awaited<ReturnType<typeof api.analyzeText>>>()
    vi.mocked(ocr.extractText).mockReturnValue(ocrGate.promise)
    vi.mocked(api.analyzeText).mockReturnValue(analysisGate.promise)

    const { container } = render(<Chat />)
    const input = container.querySelector('input[type=file]') as HTMLInputElement
    await userEvent.upload(input, new File(['x'], 'shot.png', { type: 'image/png' }))

    expect(await screen.findByText('Leyendo la imagen…')).toBeInTheDocument()

    ocrGate.resolve('cuenta suspendida, ingresá tu clave ya')

    expect(await screen.findByText('Analizando…')).toBeInTheDocument()
    expect(screen.queryByText('Leyendo la imagen…')).not.toBeInTheDocument()

    analysisGate.resolve({
      level: 'safe',
      score: 0,
      category: 'none',
      reasons: [],
      tip: 'Todo bien.',
      signals: [],
      lessons: [],
      urls: [],
    })

    await waitForElementToBeRemoved(() => screen.queryByText('Analizando…'))
  })

  test('calls onHasMessagesChange when the conversation goes from empty to non-empty', async () => {
    vi.mocked(api.analyzeText).mockResolvedValue({
      level: 'safe',
      score: 0,
      category: 'none',
      reasons: [],
      tip: 'Todo bien.',
      signals: [],
      lessons: [],
      urls: [],
    })
    const onHasMessagesChange = vi.fn()
    render(<Chat onHasMessagesChange={onHasMessagesChange} />)
    expect(onHasMessagesChange).toHaveBeenCalledWith(false)

    const input = screen.getByRole('textbox', { name: /escribí tu mensaje/i })
    await typeAndSend(input, 'hola familia les cuento que llego tarde')

    expect(await screen.findByText('Parece seguro')).toBeInTheDocument()
    expect(onHasMessagesChange).toHaveBeenCalledWith(true)
  })

  test('a question calls layer B first and shows the answer as the main reply', async () => {
    vi.mocked(api.askChat).mockResolvedValue({ answer: 'Porque te pide la clave.', fallback: false })
    const analyzeTextCallsBefore = vi.mocked(api.analyzeText).mock.calls.length
    const analyzeUrlCallsBefore = vi.mocked(api.analyzeUrl).mock.calls.length
    render(<Chat />)
    const input = screen.getByRole('textbox', { name: /escribí tu mensaje/i })
    await typeAndSend(input, '¿por qué es peligroso?')

    expect(await screen.findByText('Porque te pide la clave.')).toBeInTheDocument()
    expect(vi.mocked(api.analyzeText).mock.calls.length).toBe(analyzeTextCallsBefore)
    expect(vi.mocked(api.analyzeUrl).mock.calls.length).toBe(analyzeUrlCallsBefore)
  })

  test('a question with lessons collapses them under "Aprendé más"', async () => {
    vi.mocked(api.getLessons).mockResolvedValue([
      {
        id: 'urgency',
        icon: '⏰',
        title: 'Te apuran para que no pienses',
        how_to_spot: 'x',
        example: 'y',
        what_to_do: 'z',
      },
    ])
    vi.mocked(api.askChat).mockResolvedValue({ answer: 'Porque te apura.', fallback: false })
    render(<Chat />)
    const input = screen.getByRole('textbox', { name: /escribí tu mensaje/i })
    await typeAndSend(input, '¿por qué es urgente?')

    await screen.findByText('Porque te apura.')
    const details = screen.getByText('Aprendé más').closest('details')
    expect(details).not.toBeNull()
    expect(details).not.toHaveAttribute('open')
    expect(screen.getByText('Te apuran para que no pienses')).toBeInTheDocument()
  })

  test('a question falls back to lesson cards when layer B fails', async () => {
    vi.mocked(api.getLessons).mockResolvedValue([
      {
        id: 'urgency',
        icon: '⏰',
        title: 'Te apuran para que no pienses',
        how_to_spot: 'x',
        example: 'y',
        what_to_do: 'z',
      },
    ])
    vi.mocked(api.askChat).mockRejectedValue(new Error('timeout'))
    render(<Chat />)
    const input = screen.getByRole('textbox', { name: /escribí tu mensaje/i })
    await typeAndSend(input, '¿por qué es urgente?')

    expect(await screen.findByText('Te apuran para que no pienses')).toBeInTheDocument()
    expect(screen.queryByText('Aprendé más')).not.toBeInTheDocument()
  })

  test('a URL verdict builds a full grounded context (url, category, reasons)', async () => {
    vi.mocked(api.analyzeUrl).mockResolvedValue({
      url: 'http://bna-homebanking-verificar.xyz',
      level: 'danger',
      score: 0.9,
      category: 'suspicious_domain',
      reasons: ['El sitio imita a un banco pero no es su dirección oficial.'],
      tip: 'No ingreses tus datos ahí.',
      ml: { probability: 0.9, threshold: 0.5, flagged: true, top_features: [] },
      rules: [{ id: 'fake_domain', weight: 0.5 }],
      details: { blacklist: false, whitelist: false, ml_probability: 0.9, reputation: 'unavailable' },
    })
    vi.mocked(api.askChat).mockResolvedValue({ answer: null, fallback: true })
    render(<Chat />)
    const input = screen.getByRole('textbox', { name: /escribí tu mensaje/i })
    await typeAndSend(input, 'bna-homebanking-verificar.xyz')

    await screen.findByText('Peligroso')
    expect(api.askChat).toHaveBeenCalledWith(
      'bna-homebanking-verificar.xyz',
      expect.objectContaining({
        level: 'danger',
        category: 'suspicious_domain',
        url: 'http://bna-homebanking-verificar.xyz',
        reasons: ['El sitio imita a un banco pero no es su dirección oficial.'],
      }),
      [],
    )
  })

  test('initialContext seeds the first question, and history grows with each turn', async () => {
    const context: ChatContext = {
      level: 'danger',
      url: 'http://scam.example',
      category: 'malicious',
      reasons: ['Está en una lista de sitios maliciosos.'],
    }
    vi.mocked(api.askChat).mockResolvedValue({ answer: 'Porque está en una lista negra.', fallback: false })
    render(<Chat initialContext={context} contextKey="tab-1" />)
    const input = screen.getByRole('textbox', { name: /escribí tu mensaje/i })
    await typeAndSend(input, '¿por qué es peligroso?')

    await screen.findByText('Porque está en una lista negra.')
    expect(api.askChat).toHaveBeenCalledWith('¿por qué es peligroso?', context, [])

    await typeAndSend(input, '¿qué hago ahora?')
    await screen.findAllByText('Porque está en una lista negra.')
    expect(api.askChat).toHaveBeenLastCalledWith('¿qué hago ahora?', context, [
      { role: 'user', text: '¿por qué es peligroso?' },
      { role: 'assistant', text: 'Porque está en una lista negra.' },
    ])
  })
})

describe('Chat already-scammed recovery guide', () => {
  beforeEach(() => {
    // This file's api/ocr/qr mocks persist across tests (no clearMocks in
    // vite.config.ts) -- reset call history so this describe's
    // toHaveBeenCalled()/not assertions only see its own calls.
    vi.clearAllMocks()
    vi.mocked(api.getLessons).mockResolvedValue([
      {
        id: 'already_scammed',
        icon: '🆘',
        title: '¿Ya caíste? Qué hacer ahora',
        how_to_spot: 'x',
        example: 'y',
        what_to_do: 'z',
      },
      {
        id: 'urgency',
        icon: '⏰',
        title: 'Te apuran para que no pienses',
        how_to_spot: 'x',
        example: 'y',
        what_to_do: 'z',
      },
    ])
    vi.mocked(api.askChat).mockResolvedValue({ answer: null, fallback: true })
    vi.mocked(qr.decodeQrFromImage).mockResolvedValue(null)
  })

  test('a trigger phrase shows the guide immediately with no analyze call', async () => {
    render(<Chat />)
    const input = screen.getByRole('textbox', { name: /escribí tu mensaje/i })
    await typeAndSend(input, 'me estafaron, ya puse mis datos')

    expect(await screen.findByText('¿Ya caíste? Qué hacer ahora')).toBeInTheDocument()
    expect(screen.getByText(/tranqui, actuemos rápido/i)).toBeInTheDocument()
    expect(api.analyzeText).not.toHaveBeenCalled()
    expect(api.analyzeUrl).not.toHaveBeenCalled()
  })

  test('a trigger phrase that also contains a URL still shows the guide first and keeps analyzing the link', async () => {
    vi.mocked(api.analyzeText).mockResolvedValue({
      level: 'danger',
      score: 0.9,
      category: 'none',
      reasons: [],
      tip: 'x',
      signals: [],
      lessons: [],
      urls: [],
    })
    render(<Chat />)
    const input = screen.getByRole('textbox', { name: /escribí tu mensaje/i })
    await typeAndSend(input, 'ya puse mis datos en http://mercadopago-reintegros.com')

    expect(await screen.findByText('¿Ya caíste? Qué hacer ahora')).toBeInTheDocument()
    await waitFor(() => expect(api.analyzeText).toHaveBeenCalled())
  })

  test('a normal question does not trigger the guide', async () => {
    render(<Chat />)
    const input = screen.getByRole('textbox', { name: /escribí tu mensaje/i })
    await typeAndSend(input, '¿cómo me doy cuenta de una estafa?')

    await waitFor(() => expect(api.askChat).toHaveBeenCalled())
    expect(screen.queryByText(/tranqui, actuemos rápido/i)).not.toBeInTheDocument()
  })

  test('a danger verdict shows the recovery chip, and tapping it shows the guide', async () => {
    vi.mocked(api.analyzeUrl).mockResolvedValue({
      url: 'http://bna-homebanking-verificar.xyz',
      level: 'danger',
      score: 0.9,
      category: 'suspicious_domain',
      reasons: ['El sitio imita a un banco pero no es su dirección oficial.'],
      tip: 'No ingreses tus datos ahí.',
      ml: { probability: 0.9, threshold: 0.5, flagged: true, top_features: [] },
      rules: [{ id: 'fake_domain', weight: 0.5 }],
      details: { blacklist: false, whitelist: false, ml_probability: 0.9, reputation: 'unavailable' },
    })
    render(<Chat />)
    const input = screen.getByRole('textbox', { name: /escribí tu mensaje/i })
    await typeAndSend(input, 'bna-homebanking-verificar.xyz')

    const chip = await screen.findByRole('button', { name: /ya pusiste tus datos/i })
    await userEvent.click(chip)

    expect(await screen.findByText('¿Ya caíste? Qué hacer ahora')).toBeInTheDocument()
  })

  test('safe and caution verdicts show no recovery chip', async () => {
    vi.mocked(api.analyzeUrl).mockResolvedValue({
      url: 'https://mercadopago.com.ar',
      level: 'safe',
      score: 0,
      category: 'none',
      reasons: [],
      tip: 'Todo bien.',
      ml: { probability: 0, threshold: 0.5, flagged: false, top_features: [] },
      rules: [],
      details: { blacklist: false, whitelist: true, ml_probability: 0, reputation: 'clean' },
    })
    render(<Chat />)
    const input = screen.getByRole('textbox', { name: /escribí tu mensaje/i })
    await typeAndSend(input, 'mercadopago.com.ar')

    await screen.findByText('Parece seguro')
    expect(screen.queryByRole('button', { name: /ya pusiste tus datos/i })).not.toBeInTheDocument()
  })
})

describe('Chat QR scanning', () => {
  let originalMediaDevices: typeof navigator.mediaDevices

  beforeEach(() => {
    // The api/ocr/qr modules are mocked once for the whole file (no
    // clearMocks in vite.config.ts), so this describe's own assertions like
    // `.not.toHaveBeenCalled()` need a clean call history per test.
    vi.clearAllMocks()
    vi.mocked(api.getLessons).mockResolvedValue([
      {
        id: 'fake_qr',
        icon: '🔲',
        title: 'Códigos QR falsos',
        how_to_spot: 'x',
        example: 'y',
        what_to_do: 'z',
      },
    ])
    vi.mocked(api.askChat).mockResolvedValue({ answer: null, fallback: true })
    vi.mocked(qr.decodeQrFromImage).mockResolvedValue(null)
    originalMediaDevices = navigator.mediaDevices
    Object.defineProperty(navigator, 'mediaDevices', {
      value: {
        getUserMedia: vi.fn(() =>
          Promise.resolve({ getTracks: () => [] } as unknown as MediaStream),
        ),
      },
      configurable: true,
    })
    Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true })
    vi.mocked(qr.startQrScanner).mockReturnValue(vi.fn())
  })

  afterEach(() => {
    Object.defineProperty(navigator, 'mediaDevices', {
      value: originalMediaDevices,
      configurable: true,
    })
  })

  function safeUrlVerdict() {
    return {
      url: 'https://mercadopago.com.ar',
      level: 'safe' as const,
      score: 0,
      category: 'none' as const,
      reasons: [],
      tip: 'Todo bien.',
      ml: { probability: 0, threshold: 0.5, flagged: false, top_features: [] },
      rules: [],
      details: { blacklist: false, whitelist: true, ml_probability: 0, reputation: 'clean' as const },
    }
  }

  function dangerUrlVerdict() {
    return {
      url: 'http://bna-homebanking-verificar.xyz',
      level: 'danger' as const,
      score: 0.9,
      category: 'suspicious_domain' as const,
      reasons: ['El sitio imita a un banco pero no es su dirección oficial.'],
      tip: 'No ingreses tus datos ahí.',
      ml: { probability: 0.9, threshold: 0.5, flagged: true, top_features: [] },
      rules: [{ id: 'fake_domain', weight: 0.5 }],
      details: { blacklist: false, whitelist: false, ml_probability: 0.9, reputation: 'unavailable' as const },
    }
  }

  async function openScannerAndDeliver(content: string) {
    const callsBefore = vi.mocked(qr.startQrScanner).mock.calls.length
    render(<Chat enableQrScan />)
    await userEvent.click(screen.getByRole('button', { name: /escanear código qr/i }))
    await waitFor(() =>
      expect(vi.mocked(qr.startQrScanner).mock.calls.length).toBeGreaterThan(callsBefore),
    )
    const onResult = vi.mocked(qr.startQrScanner).mock.calls[callsBefore][1]
    onResult(content)
  }

  test('the QR button is visible when enableQrScan is set (PWA)', () => {
    render(<Chat enableQrScan />)
    expect(screen.getByRole('button', { name: /escanear código qr/i })).toBeInTheDocument()
  })

  test('the QR button is absent by default (extension side panel)', () => {
    render(<Chat />)
    expect(screen.queryByRole('button', { name: /escanear código qr/i })).not.toBeInTheDocument()
  })

  test('a URL QR runs the URL analysis and adds the quishing sentence + fake_qr lesson on a non-safe verdict', async () => {
    vi.mocked(api.analyzeUrl).mockResolvedValue(dangerUrlVerdict())
    await openScannerAndDeliver('http://bna-homebanking-verificar.xyz')

    expect(await screen.findByText('Peligroso')).toBeInTheDocument()
    expect(api.analyzeUrl).toHaveBeenCalledWith('http://bna-homebanking-verificar.xyz')
    expect(await screen.findByText(/vino de un código qr/i)).toBeInTheDocument()
    expect(await screen.findByText('Códigos QR falsos')).toBeInTheDocument()
  })

  test('a URL QR with a safe verdict shows no quishing sentence', async () => {
    vi.mocked(api.analyzeUrl).mockResolvedValue(safeUrlVerdict())
    await openScannerAndDeliver('https://mercadopago.com.ar')

    expect(await screen.findByText('Parece seguro')).toBeInTheDocument()
    expect(screen.queryByText(/vino de un código qr/i)).not.toBeInTheDocument()
  })

  test('a wifi QR shows a descriptive message with no backend call', async () => {
    await openScannerAndDeliver('WIFI:T:WPA;S:MiRed;P:clave123;;')

    expect(await screen.findByText(/red wi-fi/i)).toBeInTheDocument()
    expect(api.analyzeUrl).not.toHaveBeenCalled()
    expect(api.analyzeText).not.toHaveBeenCalled()
  })

  test('a tel QR shows a descriptive message with no backend call', async () => {
    await openScannerAndDeliver('tel:+541122334455')

    expect(await screen.findByText(/llamada telefónica/i)).toBeInTheDocument()
    expect(api.analyzeUrl).not.toHaveBeenCalled()
    expect(api.analyzeText).not.toHaveBeenCalled()
  })

  test('uploading an image containing a QR takes the QR path, not OCR', async () => {
    vi.mocked(qr.decodeQrFromImage).mockResolvedValue('https://mercadopago.com.ar')
    vi.mocked(api.analyzeUrl).mockResolvedValue(safeUrlVerdict())
    const { container } = render(<Chat />)
    const input = container.querySelector('input[type=file]') as HTMLInputElement
    await userEvent.upload(input, new File(['x'], 'qr.png', { type: 'image/png' }))

    expect(await screen.findByText('Parece seguro')).toBeInTheDocument()
    expect(ocr.extractText).not.toHaveBeenCalled()
    expect(api.analyzeUrl).toHaveBeenCalledWith('https://mercadopago.com.ar')
  })

  test('uploading an image without a QR falls back to OCR', async () => {
    vi.mocked(qr.decodeQrFromImage).mockResolvedValue(null)
    vi.mocked(ocr.extractText).mockResolvedValue('cuenta suspendida, ingresá tu clave ya')
    vi.mocked(api.analyzeText).mockResolvedValue({
      level: 'safe',
      score: 0,
      category: 'none',
      reasons: [],
      tip: 'Todo bien.',
      signals: [],
      lessons: [],
      urls: [],
    })
    const { container } = render(<Chat />)
    const input = container.querySelector('input[type=file]') as HTMLInputElement
    await userEvent.upload(input, new File(['x'], 'shot.png', { type: 'image/png' }))

    expect(await screen.findByText('Parece seguro')).toBeInTheDocument()
    expect(ocr.extractText).toHaveBeenCalled()
  })
})
