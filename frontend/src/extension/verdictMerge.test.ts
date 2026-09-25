import { describe, expect, test } from 'vitest'
import { mergeVerdicts } from './verdictMerge'

describe('mergeVerdicts', () => {
  test('the higher-severity side wins level/category/tip', () => {
    const a = { level: 'caution' as const, score: 0.4, category: 'risky_site', reasons: ['r1'], tip: 't1' }
    const b = { level: 'danger' as const, score: 0.9, category: 'malicious', reasons: ['r2'], tip: 't2' }
    const merged = mergeVerdicts(a, b)
    expect(merged.level).toBe('danger')
    expect(merged.category).toBe('malicious')
    expect(merged.tip).toBe('t2')
    expect(merged.score).toBe(0.9)
  })

  test('a tie keeps the first side', () => {
    const a = { level: 'safe' as const, score: 0.1, category: 'none', reasons: ['r1'], tip: 't1' }
    const b = { level: 'safe' as const, score: 0.3, category: 'other', reasons: ['r2'], tip: 't2' }
    const merged = mergeVerdicts(a, b)
    expect(merged.level).toBe('safe')
    expect(merged.category).toBe('none')
    expect(merged.tip).toBe('t1')
    expect(merged.score).toBe(0.3)
  })

  test('reasons are unioned and deduplicated, order-preserving', () => {
    const a = { level: 'safe' as const, score: 0, category: 'none', reasons: ['r1', 'r2'], tip: 't' }
    const b = { level: 'safe' as const, score: 0, category: 'none', reasons: ['r2', 'r3'], tip: 't' }
    const merged = mergeVerdicts(a, b)
    expect(merged.reasons).toEqual(['r1', 'r2', 'r3'])
  })

  test('extra fields on `a` (e.g. page_signals) are preserved', () => {
    const a = {
      level: 'safe' as const,
      score: 0,
      category: 'none',
      reasons: [] as string[],
      tip: 't',
      page_signals: [{ id: 'x', reason: 'y' }],
    }
    const b = { level: 'danger' as const, score: 1, category: 'malicious', reasons: ['r'], tip: 't2' }
    const merged = mergeVerdicts(a, b)
    expect(merged.page_signals).toEqual([{ id: 'x', reason: 'y' }])
  })
})
