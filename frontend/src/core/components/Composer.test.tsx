import { beforeEach, describe, expect, test, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Composer } from './Composer'
import * as dictation from '../dictation'
import * as speech from '../speech'

vi.mock('../dictation')
vi.mock('../speech')

function baseProps(overrides: Partial<Parameters<typeof Composer>[0]> = {}) {
  return {
    value: '',
    onChange: vi.fn(),
    onSend: vi.fn(),
    onImage: vi.fn(),
    ...overrides,
  }
}

describe('Composer dictation', () => {
  beforeEach(() => {
    // This file's dictation/speech mocks persist across tests (no
    // clearMocks in vite.config.ts) -- reset call history per test so
    // `startDictation.mock.calls[0]` always refers to *this* test's click.
    vi.clearAllMocks()
    vi.mocked(dictation.isDictationSupported).mockReturnValue(true)
    vi.mocked(dictation.startDictation).mockReturnValue(vi.fn())
  })

  test('the mic button is hidden when dictation is unsupported', () => {
    vi.mocked(dictation.isDictationSupported).mockReturnValue(false)
    render(<Composer {...baseProps()} enableDictation />)
    expect(screen.queryByRole('button', { name: /dictar mensaje/i })).not.toBeInTheDocument()
  })

  test('the mic button is hidden when enableDictation is false', () => {
    render(<Composer {...baseProps()} />)
    expect(screen.queryByRole('button', { name: /dictar mensaje/i })).not.toBeInTheDocument()
  })

  test('the mic button is visible when supported and enabled', () => {
    render(<Composer {...baseProps()} enableDictation />)
    expect(screen.getByRole('button', { name: /dictar mensaje/i })).toBeInTheDocument()
  })

  test('clicking the mic button stops read-aloud and starts recognition', async () => {
    render(<Composer {...baseProps()} enableDictation />)
    await userEvent.click(screen.getByRole('button', { name: /dictar mensaje/i }))

    expect(speech.stop).toHaveBeenCalled()
    expect(dictation.startDictation).toHaveBeenCalledWith(
      expect.objectContaining({
        onText: expect.any(Function),
        onEnd: expect.any(Function),
        onError: expect.any(Function),
      }),
    )
    expect(screen.getByRole('button', { name: /dictar mensaje/i })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(screen.getByText('Escuchando…')).toBeInTheDocument()
  })

  test('recognized text fills the composer input without sending', async () => {
    const onChange = vi.fn()
    const onSend = vi.fn()
    render(<Composer {...baseProps({ onChange, onSend })} enableDictation />)
    await userEvent.click(screen.getByRole('button', { name: /dictar mensaje/i }))

    const { onText } = vi.mocked(dictation.startDictation).mock.calls[0][0]
    act(() => onText('hola como estas', false))

    expect(onChange).toHaveBeenCalledWith('hola como estas')
    expect(onSend).not.toHaveBeenCalled()
  })

  test('recognized text appends to existing composer text with a space', async () => {
    const onChange = vi.fn()
    render(
      <Composer {...baseProps({ value: 'mensaje previo', onChange })} enableDictation />,
    )
    await userEvent.click(screen.getByRole('button', { name: /dictar mensaje/i }))

    const { onText } = vi.mocked(dictation.startDictation).mock.calls[0][0]
    act(() => onText('mas texto', true))

    expect(onChange).toHaveBeenCalledWith('mensaje previo mas texto')
  })

  test('a permission-denied error shows the Spanish message and resets the listening state', async () => {
    render(<Composer {...baseProps()} enableDictation />)
    const micButton = screen.getByRole('button', { name: /dictar mensaje/i })
    await userEvent.click(micButton)

    const { onError } = vi.mocked(dictation.startDictation).mock.calls[0][0]
    act(() => onError('No pudimos usar el micrófono. Revisá los permisos del navegador.'))

    expect(
      screen.getByText('No pudimos usar el micrófono. Revisá los permisos del navegador.'),
    ).toBeInTheDocument()
    expect(micButton).toHaveAttribute('aria-pressed', 'false')
    expect(screen.queryByText('Escuchando…')).not.toBeInTheDocument()
  })

  test('clicking the mic button again while listening stops dictation', async () => {
    const stopFn = vi.fn()
    vi.mocked(dictation.startDictation).mockReturnValue(stopFn)
    render(<Composer {...baseProps()} enableDictation />)
    const micButton = screen.getByRole('button', { name: /dictar mensaje/i })
    await userEvent.click(micButton)
    await userEvent.click(micButton)

    expect(stopFn).toHaveBeenCalled()
    expect(micButton).toHaveAttribute('aria-pressed', 'false')
  })

  test('the mic button has a short privacy tooltip', () => {
    render(<Composer {...baseProps()} enableDictation />)
    const micButton = screen.getByRole('button', { name: /dictar mensaje/i })
    expect(micButton.getAttribute('title')).toMatch(/google/i)
  })
})
