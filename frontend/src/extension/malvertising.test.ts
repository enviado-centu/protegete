import { describe, expect, test } from 'vitest'
import { matchMalvertisingHost } from './malvertising'

describe('matchMalvertisingHost', () => {
  test('matches an exact known network host', () => {
    expect(matchMalvertisingHost('popads.net')).toBe('popads.net')
  })

  test('matches a subdomain of a known network host', () => {
    expect(matchMalvertisingHost('ads.popads.net')).toBe('popads.net')
  })

  test('is case-insensitive', () => {
    expect(matchMalvertisingHost('Ads.PopAds.NET')).toBe('popads.net')
  })

  test('matches the "popunder" substring rule', () => {
    expect(matchMalvertisingHost('something-popunder-network.io')).toBe('popunder')
  })

  test('returns null for an unrelated host', () => {
    expect(matchMalvertisingHost('example.com')).toBeNull()
  })

  test('matches several other listed networks', () => {
    expect(matchMalvertisingHost('cdn.propellerads.com')).toBe('propellerads.com')
    expect(matchMalvertisingHost('juicyads.com')).toBe('juicyads.com')
    expect(matchMalvertisingHost('profitablegatecpm.com')).toBe('profitablegatecpm.com')
  })
})
