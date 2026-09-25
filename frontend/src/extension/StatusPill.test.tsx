import { describe, expect, test } from 'vitest'
import { render, screen } from '@testing-library/react'
import { StatusPill } from './StatusPill'
import type { CachedTabVerdict } from './tabVerdict'

function verdict(overrides: Partial<CachedTabVerdict> = {}): CachedTabVerdict {
  return {
    url: 'https://example-test-site.invalid/',
    level: 'caution',
    score: 40,
    category: 'none',
    reasons: ['algo raro'],
    tip: 'tené cuidado',
    ...overrides,
  }
}

describe('StatusPill page signals section', () => {
  test('renders nothing extra when there are no page signals', () => {
    render(<StatusPill tabVerdict={verdict()} lessons={[]} />)
    expect(screen.queryByText('Lo que encontramos en la página')).not.toBeInTheDocument()
  })

  test('renders nothing extra when pageSignals is an empty array', () => {
    render(<StatusPill tabVerdict={verdict({ pageSignals: [] })} lessons={[]} />)
    expect(screen.queryByText('Lo que encontramos en la página')).not.toBeInTheDocument()
  })

  test('renders an expandable section listing each page signal reason', () => {
    render(
      <StatusPill
        tabVerdict={verdict({
          pageSignals: [
            { id: 'insecure_password_form', reason: 'formulario de contraseña inseguro' },
            { id: 'hidden_iframes', reason: 'iframe oculto detectado' },
          ],
        })}
        lessons={[]}
      />,
    )

    expect(screen.getByText('Lo que encontramos en la página')).toBeInTheDocument()
    expect(screen.getByText('formulario de contraseña inseguro')).toBeInTheDocument()
    expect(screen.getByText('iframe oculto detectado')).toBeInTheDocument()
  })

  test('renders a lesson card for each page lesson', () => {
    render(
      <StatusPill
        tabVerdict={verdict({
          pageSignals: [{ id: 'insecure_password_form', reason: 'formulario inseguro' }],
          pageLessons: [
            {
              id: 'insecure-forms',
              icon: '🔒',
              title: 'Formularios inseguros',
              how_to_spot: 'Fijate si el candado no aparece',
              example: 'Un formulario de login sin https',
              what_to_do: 'No pongas tu contraseña',
            },
          ],
        })}
        lessons={[]}
      />,
    )

    expect(screen.getByText('Formularios inseguros')).toBeInTheDocument()
  })
})
