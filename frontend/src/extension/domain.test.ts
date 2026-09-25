import { describe, expect, test } from 'vitest'
import { registrableHost } from './domain'

describe('registrableHost', () => {
  test('takes the last three labels for a .com.ar host', () => {
    expect(registrableHost('www.banco.com.ar')).toBe('banco.com.ar')
  })

  test('takes the last three labels for a .gob.ar host', () => {
    expect(registrableHost('foo.gob.ar')).toBe('foo.gob.ar')
  })

  test('takes the last two labels for an ordinary host', () => {
    expect(registrableHost('www.example.com')).toBe('example.com')
  })

  test('returns a bare registrable host unchanged', () => {
    expect(registrableHost('example.com')).toBe('example.com')
  })

  test('handles a deep subdomain of a .com.ar host', () => {
    expect(registrableHost('login.homebanking.banco.com.ar')).toBe('banco.com.ar')
  })
})
