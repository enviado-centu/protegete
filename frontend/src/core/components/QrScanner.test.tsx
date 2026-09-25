import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QrScanner } from './QrScanner'
import * as qr from '../qr'

vi.mock('../qr', () => ({ startQrScanner: vi.fn() }))

function fakeStream(stop: () => void) {
  return {
    getTracks: () => [{ stop }],
  } as unknown as MediaStream
}

function baseProps() {
  return {
    onResult: vi.fn(),
    onClose: vi.fn(),
    onFallbackImage: vi.fn(),
  }
}

describe('QrScanner', () => {
  let originalMediaDevices: typeof navigator.mediaDevices

  beforeEach(() => {
    originalMediaDevices = navigator.mediaDevices
    vi.mocked(qr.startQrScanner).mockReturnValue(vi.fn())
  })

  afterEach(() => {
    Object.defineProperty(navigator, 'mediaDevices', {
      value: originalMediaDevices,
      configurable: true,
    })
    Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true })
    vi.restoreAllMocks()
  })

  test('renders as a labelled, accessible dialog', () => {
    Object.defineProperty(navigator, 'mediaDevices', {
      value: { getUserMedia: vi.fn(() => new Promise(() => {})) },
      configurable: true,
    })
    render(<QrScanner {...baseProps()} />)

    const dialog = screen.getByRole('dialog', { name: 'Escanear código QR' })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
  })

  test('Escape closes the dialog', () => {
    Object.defineProperty(navigator, 'mediaDevices', {
      value: { getUserMedia: vi.fn(() => new Promise(() => {})) },
      configurable: true,
    })
    const props = baseProps()
    render(<QrScanner {...props} />)

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })

    expect(props.onClose).toHaveBeenCalled()
  })

  test('a visible 48px+ "Cerrar" button also closes it', () => {
    Object.defineProperty(navigator, 'mediaDevices', {
      value: { getUserMedia: vi.fn(() => new Promise(() => {})) },
      configurable: true,
    })
    const props = baseProps()
    render(<QrScanner {...props} />)

    fireEvent.click(screen.getByRole('button', { name: 'Cerrar' }))

    expect(props.onClose).toHaveBeenCalled()
  })

  test('permission denied shows the exact Spanish copy and the fallback upload button', async () => {
    Object.defineProperty(navigator, 'mediaDevices', {
      value: {
        getUserMedia: vi.fn(() => Promise.reject(Object.assign(new Error('denied'), { name: 'NotAllowedError' }))),
      },
      configurable: true,
    })
    render(<QrScanner {...baseProps()} />)

    expect(
      await screen.findByText('No pudimos usar la cámara. Revisá los permisos o subí una foto del QR.'),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Subir foto del QR' })).toBeInTheDocument()
  })

  test('unsupported camera (no mediaDevices) shows the exact https copy and the fallback upload button', async () => {
    Object.defineProperty(navigator, 'mediaDevices', {
      value: undefined,
      configurable: true,
    })
    render(<QrScanner {...baseProps()} />)

    expect(await screen.findByText('Para usar la cámara abrí la app con https.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Subir foto del QR' })).toBeInTheDocument()
  })

  test('insecure context (no https) shows the exact https copy', async () => {
    Object.defineProperty(window, 'isSecureContext', { value: false, configurable: true })
    Object.defineProperty(navigator, 'mediaDevices', {
      value: { getUserMedia: vi.fn(() => new Promise(() => {})) },
      configurable: true,
    })
    render(<QrScanner {...baseProps()} />)

    expect(await screen.findByText('Para usar la cámara abrí la app con https.')).toBeInTheDocument()
  })

  test('stops all camera tracks and the scanner loop on unmount', async () => {
    const stopTrack = vi.fn()
    const getUserMedia = vi.fn(() => Promise.resolve(fakeStream(stopTrack)))
    Object.defineProperty(navigator, 'mediaDevices', {
      value: { getUserMedia },
      configurable: true,
    })
    const stopScanner = vi.fn()
    vi.mocked(qr.startQrScanner).mockReturnValue(stopScanner)

    const { unmount } = render(<QrScanner {...baseProps()} />)

    await waitFor(() => expect(getUserMedia).toHaveBeenCalled())
    await waitFor(() => expect(qr.startQrScanner).toHaveBeenCalled())

    unmount()

    expect(stopTrack).toHaveBeenCalled()
    expect(stopScanner).toHaveBeenCalled()
  })

  test('stops all camera tracks when closed via Escape', async () => {
    const stopTrack = vi.fn()
    const getUserMedia = vi.fn(() => Promise.resolve(fakeStream(stopTrack)))
    Object.defineProperty(navigator, 'mediaDevices', {
      value: { getUserMedia },
      configurable: true,
    })

    const props = baseProps()
    render(<QrScanner {...props} />)

    await waitFor(() => expect(getUserMedia).toHaveBeenCalled())
    await waitFor(() => expect(qr.startQrScanner).toHaveBeenCalled())

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })

    expect(props.onClose).toHaveBeenCalled()
    expect(stopTrack).toHaveBeenCalled()
  })

  test('stops all camera tracks on a successful scan result', async () => {
    const stopTrack = vi.fn()
    const getUserMedia = vi.fn(() => Promise.resolve(fakeStream(stopTrack)))
    Object.defineProperty(navigator, 'mediaDevices', {
      value: { getUserMedia },
      configurable: true,
    })
    const props = baseProps()
    let deliverResult: ((content: string) => void) | undefined
    vi.mocked(qr.startQrScanner).mockImplementation((_video, onResult) => {
      deliverResult = onResult
      return vi.fn()
    })

    render(<QrScanner {...props} />)

    await waitFor(() => expect(deliverResult).toBeDefined())
    deliverResult?.('https://ejemplo.com/qr')

    expect(props.onResult).toHaveBeenCalledWith('https://ejemplo.com/qr')
    expect(stopTrack).toHaveBeenCalled()
  })

  test('picking a fallback photo hands the raw file to onFallbackImage without deciding for the caller', async () => {
    Object.defineProperty(navigator, 'mediaDevices', {
      value: undefined,
      configurable: true,
    })
    const props = baseProps()
    render(<QrScanner {...props} />)

    await screen.findByText('Para usar la cámara abrí la app con https.')
    const file = new File(['x'], 'qr.png', { type: 'image/png' })
    const input = document.querySelector('input[type=file]') as HTMLInputElement
    fireEvent.change(input, { target: { files: [file] } })

    expect(props.onFallbackImage).toHaveBeenCalledWith(file)
  })
})
