import { beforeEach, describe, expect, test, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Chat } from './Chat'
import * as api from '../api'

vi.mock('../api')

function typeAndSend(input: HTMLElement, text: string) {
  const user = userEvent.setup()
  return user
    .type(input, text)
    .then(() => user.click(screen.getByRole('button', { name: /enviar/i })))
}

describe('Chat', () => {
  beforeEach(() => {
    vi.mocked(api.getLessons).mockResolvedValue([])
    vi.mocked(api.askChat).mockResolvedValue({ answer: null, fallback: true })
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
      details: { blacklist: false, whitelist: false, ml_probability: 0.9 },
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
})
