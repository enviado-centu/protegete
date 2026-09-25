import { describe, expect, test } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MetricsTiles } from './MetricsTiles'
import type { Metrics } from './metrics'

function metrics(danger: number, total: number): Metrics {
  const counts = { total, danger }
  return { today: counts, week: counts, total: counts }
}

describe('MetricsTiles pluralization', () => {
  test('singular for exactly 1 dangerous threat', () => {
    render(<MetricsTiles metrics={metrics(1, 1)} />)
    expect(screen.getAllByText('1 peligrosa').length).toBeGreaterThan(0)
    expect(screen.queryByText('1 peligrosas')).not.toBeInTheDocument()
  })

  test('plural for 0 or 2+ dangerous threats', () => {
    render(<MetricsTiles metrics={metrics(2, 2)} />)
    expect(screen.getAllByText('2 peligrosas').length).toBeGreaterThan(0)
  })

  test('singular for exactly 1 threat detected in the accessible label', () => {
    render(<MetricsTiles metrics={metrics(0, 1)} />)
    expect(screen.getByRole('group', { name: 'Hoy: 1 amenaza detectada' })).toBeInTheDocument()
  })

  test('plural for 0 threats detected in the accessible label', () => {
    render(<MetricsTiles metrics={metrics(0, 0)} />)
    expect(screen.getByRole('group', { name: 'Hoy: 0 amenazas detectadas' })).toBeInTheDocument()
  })
})
