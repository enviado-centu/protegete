import { expect, test, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { axe } from 'jest-axe'
import App from './App'
import * as api from '../core/api'

vi.mock('../core/api')

test('the app has no serious or critical accessibility violations', async () => {
  vi.mocked(api.getLessons).mockResolvedValue([])
  const { container } = render(<App />)
  await screen.findByRole('button', { name: 'Probar un mensaje falso' })
  const results = await axe(container)
  const blocking = results.violations.filter(
    (violation) => violation.impact === 'serious' || violation.impact === 'critical',
  )
  expect(blocking).toEqual([])
})
