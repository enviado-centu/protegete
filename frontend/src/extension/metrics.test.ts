import { describe, expect, test } from 'vitest'
import { recordVerdict, getMetrics, memoryStore } from './metrics'

const d = (s: string) => new Date(s + 'T12:00:00')

describe('metrics', () => {
  test('dedupes same domain same day', async () => {
    const s = memoryStore()
    const ss = memoryStore()
    for (let i = 0; i < 5; i++) {
      await recordVerdict(s, ss, { domain: 'x.xyz', level: 'danger', now: d('2026-09-24') })
    }
    expect((await getMetrics(s, d('2026-09-24'))).today).toEqual({ total: 1, danger: 1 })
  })

  test('safe is not counted', async () => {
    const s = memoryStore()
    const ss = memoryStore()
    await recordVerdict(s, ss, { domain: 'google.com', level: 'safe', now: d('2026-09-24') })
    expect((await getMetrics(s, d('2026-09-24'))).total.total).toBe(0)
  })

  test('new day resets today not total', async () => {
    const s = memoryStore()
    const ss = memoryStore()
    await recordVerdict(s, ss, { domain: 'a.xyz', level: 'caution', now: d('2026-09-24') })
    const m = await getMetrics(s, d('2026-09-25'))
    expect(m.today.total).toBe(0)
    expect(m.week.total).toBe(1)
    expect(m.total.total).toBe(1)
  })

  test('stores no urls', async () => {
    const s = memoryStore()
    const ss = memoryStore()
    await recordVerdict(s, ss, { domain: 'a.xyz', level: 'danger', now: d('2026-09-24') })
    expect(JSON.stringify(s.dump())).not.toContain('a.xyz')
  })
})
