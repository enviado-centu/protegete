import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ConsentCard } from './ConsentCard'
import * as scan from './scan'

vi.mock('./scan', async () => {
  const actual = await vi.importActual<typeof import('./scan')>('./scan')
  return {
    ...actual,
    requestOriginPermission: vi.fn(),
    scanTabOnce: vi.fn(),
    registerPersistentScan: vi.fn(),
    unregisterPersistentScan: vi.fn(),
  }
})

describe('ConsentCard', () => {
  const originalChrome = (globalThis as { chrome?: unknown }).chrome

  beforeEach(() => {
    ;(globalThis as { chrome?: unknown }).chrome = {
      tabs: { reload: vi.fn().mockResolvedValue(undefined) },
    }
    vi.mocked(scan.scanTabOnce).mockResolvedValue(undefined)
    vi.mocked(scan.registerPersistentScan).mockResolvedValue(undefined)
    vi.mocked(scan.unregisterPersistentScan).mockResolvedValue(undefined)
  })

  afterEach(() => {
    ;(globalThis as { chrome?: unknown }).chrome = originalChrome
    vi.restoreAllMocks()
  })

  test('renders the consent copy and both buttons', () => {
    render(<ConsentCard url="https://example.com" tabId={1} />)
    expect(screen.getByText(/¿Querés que revise esta página a fondo\?/)).toBeInTheDocument()
    expect(screen.getByText(/nunca leo lo que escribís en formularios/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sí, revisar esta página' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Ahora no' })).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: /Recordar para este sitio/ })).toBeInTheDocument()
  })

  test('"Ahora no" dismisses the card and calls onDismiss without requesting permission', async () => {
    const onDismiss = vi.fn()
    render(<ConsentCard url="https://example.com" tabId={1} onDismiss={onDismiss} />)
    await userEvent.click(screen.getByRole('button', { name: 'Ahora no' }))

    expect(onDismiss).toHaveBeenCalled()
    expect(scan.requestOriginPermission).not.toHaveBeenCalled()
    expect(screen.queryByText(/¿Querés que revise esta página a fondo\?/)).not.toBeInTheDocument()
  })

  test('consenting requests the permission, scans once, then offers the reload', async () => {
    vi.mocked(scan.requestOriginPermission).mockResolvedValue(true)
    render(<ConsentCard url="https://example.com" tabId={1} />)
    await userEvent.click(screen.getByRole('button', { name: 'Sí, revisar esta página' }))

    expect(scan.requestOriginPermission).toHaveBeenCalledWith('https://example.com')
    expect(await screen.findByText(/la recargo una vez/)).toBeInTheDocument()
    expect(scan.scanTabOnce).toHaveBeenCalledWith(1)
  })

  test('a denied permission shows a note and never scans', async () => {
    vi.mocked(scan.requestOriginPermission).mockResolvedValue(false)
    render(<ConsentCard url="https://example.com" tabId={1} />)
    await userEvent.click(screen.getByRole('button', { name: 'Sí, revisar esta página' }))

    expect(await screen.findByText(/No te pedimos de nuevo/)).toBeInTheDocument()
    expect(scan.scanTabOnce).not.toHaveBeenCalled()
  })

  test('"Recargar y revisar" registers the persistent probe, reloads, and later unregisters when not remembered', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.mocked(scan.requestOriginPermission).mockResolvedValue(true)
    const onDismiss = vi.fn()
    render(<ConsentCard url="https://example.com" tabId={1} onDismiss={onDismiss} />)

    await userEvent.setup({ delay: null }).click(
      screen.getByRole('button', { name: 'Sí, revisar esta página' }),
    )
    await screen.findByText(/la recargo una vez/)
    await userEvent.setup({ delay: null }).click(screen.getByRole('button', { name: 'Recargar y revisar' }))

    expect(scan.registerPersistentScan).toHaveBeenCalledWith('https://example.com')
    expect(
      (globalThis as unknown as { chrome: { tabs: { reload: ReturnType<typeof vi.fn> } } }).chrome.tabs.reload,
    ).toHaveBeenCalledWith(1)
    expect(onDismiss).toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(7000)
    expect(scan.unregisterPersistentScan).toHaveBeenCalledWith('https://example.com')

    vi.useRealTimers()
  })

  test('checking "Recordar para este sitio" keeps the persistent probe registered', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.mocked(scan.requestOriginPermission).mockResolvedValue(true)
    render(<ConsentCard url="https://example.com" tabId={1} />)

    const user = userEvent.setup({ delay: null })
    await user.click(screen.getByRole('checkbox', { name: /Recordar para este sitio/ }))
    await user.click(screen.getByRole('button', { name: 'Sí, revisar esta página' }))
    await screen.findByText(/la recargo una vez/)
    await user.click(screen.getByRole('button', { name: 'Recargar y revisar' }))

    await vi.advanceTimersByTimeAsync(7000)
    expect(scan.unregisterPersistentScan).not.toHaveBeenCalled()

    vi.useRealTimers()
  })
})
