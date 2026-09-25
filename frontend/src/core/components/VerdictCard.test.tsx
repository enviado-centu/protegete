import { describe, expect, test } from 'vitest'
import { render, screen } from '@testing-library/react'
import { VerdictCard } from './VerdictCard'

const baseProps = {
  level: 'danger' as const,
  word: 'Peligroso',
  icon: '⛔',
  summary: 'Esto tiene señales claras de estafa. No ingreses datos ni hagas clic.',
  reasons: ['Usa apuro y urgencia para que no pienses antes de actuar.'],
}

describe('VerdictCard', () => {
  test('summary sentence is not duplicated in the reasons list', () => {
    render(<VerdictCard {...baseProps} />)
    const summary = screen.getByText(baseProps.summary)
    expect(summary).toBeInTheDocument()
    const listItems = screen.getAllByRole('listitem').map((item) => item.textContent)
    expect(listItems).not.toContain(baseProps.summary)
    expect(listItems).toEqual(baseProps.reasons)
  })

  test('renders no subject line when none is given', () => {
    render(<VerdictCard {...baseProps} />)
    expect(screen.queryByText('bna-homebanking-verificar.xyz')).not.toBeInTheDocument()
  })

  test('renders a compact subject (e.g. a host) when given', () => {
    render(<VerdictCard {...baseProps} subject="bna-homebanking-verificar.xyz" />)
    expect(screen.getByText('bna-homebanking-verificar.xyz')).toBeInTheDocument()
  })
})
