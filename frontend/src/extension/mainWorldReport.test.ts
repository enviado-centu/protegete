import { describe, expect, test } from 'vitest'
import {
  emptyMainWorldReport,
  isFinalMainWorldMessage,
  isProtegeteProbeMessage,
  mergeMainWorldReport,
} from './mainWorldReport'

describe('isProtegeteProbeMessage', () => {
  test('accepts a message with the exact source tag', () => {
    expect(isProtegeteProbeMessage({ source: 'protegete-probe' })).toBe(true)
  })

  test('rejects a message with a different or missing source', () => {
    expect(isProtegeteProbeMessage({ source: 'something-else' })).toBe(false)
    expect(isProtegeteProbeMessage({})).toBe(false)
  })

  test('rejects non-object payloads (null, primitives, arrays)', () => {
    expect(isProtegeteProbeMessage(null)).toBe(false)
    expect(isProtegeteProbeMessage(undefined)).toBe(false)
    expect(isProtegeteProbeMessage('protegete-probe')).toBe(false)
    expect(isProtegeteProbeMessage(42)).toBe(false)
  })
})

describe('mergeMainWorldReport', () => {
  test('starts from the empty report', () => {
    expect(emptyMainWorldReport()).toEqual({
      notificationPrompts: 0,
      notificationPromptWithin10s: false,
      popupsUnsolicited: 0,
      minerGlobals: [],
      notificationPermissionGranted: false,
    })
  })

  test('applies the early (~1.5s) partial report on top of the empty one', () => {
    const merged = mergeMainWorldReport(emptyMainWorldReport(), {
      source: 'protegete-probe',
      notificationPrompts: 1,
      notificationPromptWithin10s: true,
      popupsUnsolicited: 2,
      minerGlobals: [],
    })

    expect(merged).toEqual({
      notificationPrompts: 1,
      notificationPromptWithin10s: true,
      popupsUnsolicited: 2,
      minerGlobals: [],
      notificationPermissionGranted: false,
    })
  })

  test('the final (~3s) report supersedes fields the early report set', () => {
    const afterEarly = mergeMainWorldReport(emptyMainWorldReport(), {
      source: 'protegete-probe',
      notificationPrompts: 1,
      notificationPromptWithin10s: true,
      popupsUnsolicited: 1,
      minerGlobals: [],
    })

    const afterFinal = mergeMainWorldReport(afterEarly, {
      source: 'protegete-probe',
      final: true,
      notificationPrompts: 1,
      notificationPromptWithin10s: true,
      popupsUnsolicited: 1,
      minerGlobals: ['CoinHive'],
    })

    expect(afterFinal.minerGlobals).toEqual(['CoinHive'])
  })

  test('a final report that omits a field keeps the previously buffered value, not the default', () => {
    const afterEarly = mergeMainWorldReport(emptyMainWorldReport(), {
      source: 'protegete-probe',
      notificationPrompts: 3,
      notificationPromptWithin10s: true,
      popupsUnsolicited: 5,
      minerGlobals: [],
    })

    // A pagehide-triggered final report may fire before the miner check
    // sampled anything, e.g. it only sends minerGlobals; other fields are
    // omitted from the payload entirely (not explicitly reset to 0/false).
    const afterFinal = mergeMainWorldReport(afterEarly, {
      source: 'protegete-probe',
      final: true,
      minerGlobals: ['CryptoLoot'],
    })

    expect(afterFinal).toEqual({
      notificationPrompts: 3,
      notificationPromptWithin10s: true,
      popupsUnsolicited: 5,
      minerGlobals: ['CryptoLoot'],
      notificationPermissionGranted: false,
    })
  })

  test('an out-of-order early report after the final one never regresses already-final data', () => {
    // Guards against a stray/duplicate early-timer message arriving after
    // the final one (shouldn't normally happen, but the merge itself must
    // stay a no-op for fields the late message omits regardless of order).
    const afterFinal = mergeMainWorldReport(emptyMainWorldReport(), {
      source: 'protegete-probe',
      final: true,
      notificationPrompts: 1,
      notificationPromptWithin10s: true,
      popupsUnsolicited: 1,
      minerGlobals: ['WMP'],
    })

    const afterStaleEarly = mergeMainWorldReport(afterFinal, {
      source: 'protegete-probe',
      notificationPrompts: 1,
      notificationPromptWithin10s: true,
      popupsUnsolicited: 1,
    })

    expect(afterStaleEarly.minerGlobals).toEqual(['WMP'])
  })
})

describe('notificationPermissionGranted', () => {
  test('carried through by the final report and preserved by later omitting messages', () => {
    const afterFinal = mergeMainWorldReport(emptyMainWorldReport(), {
      source: 'protegete-probe',
      final: true,
      notificationPermissionGranted: true,
    })
    expect(afterFinal.notificationPermissionGranted).toBe(true)
  })
})

describe('isFinalMainWorldMessage', () => {
  test('true only when final is explicitly true', () => {
    expect(isFinalMainWorldMessage({ source: 'protegete-probe', final: true })).toBe(true)
    expect(isFinalMainWorldMessage({ source: 'protegete-probe', final: false })).toBe(false)
    expect(isFinalMainWorldMessage({ source: 'protegete-probe' })).toBe(false)
  })
})
