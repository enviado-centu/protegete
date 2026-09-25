import { describe, expect, test } from 'vitest'
import { scoreObfuscation } from './obfuscation'

// NOTE: the `eval(`, `atob(`, and `document.write(` occurrences below are
// plain string fixtures fed to the pure detector under test — none of this
// text is ever executed or written to a document.

/** Benign, dense, minified-looking code: long but with no eval/atob, no
 * String.fromCharCode spam, no hex-escape spam, and no long encoded string
 * literal — must NOT be flagged. */
function benignMinifiedSnippet(): string {
  let out = ''
  let i = 0
  while (out.length < 1800) {
    out += `function f${i}(a,b,c){var d=a+b*c;return d>0?d:-d;}f${i}(1,2,3);`
    i += 1
  }
  return out
}

describe('scoreObfuscation', () => {
  test('does not flag benign minified-looking code', () => {
    const text = benignMinifiedSnippet()
    expect(text.length).toBeGreaterThanOrEqual(1500)
    expect(scoreObfuscation(text)).toBe(false)
  })

  test('flags eval(atob("...")) with a long base64 payload', () => {
    const payload = 'A'.repeat(1200)
    const text = `eval(atob("${payload}"))`
    expect(scoreObfuscation(text)).toBe(true)
  })

  test('flags 40+ \\xNN hex escapes in a string literal', () => {
    const hexEscapes = Array.from({ length: 45 }, (_, n) => `\\x${(n % 16).toString(16).padStart(2, '0')}`).join('')
    const text = `var s = "${hexEscapes}";`
    expect(scoreObfuscation(text)).toBe(true)
  })

  test('flags 3+ occurrences of String.fromCharCode', () => {
    const text = 'String.fromCharCode(1);String.fromCharCode(2);String.fromCharCode(3);'
    expect(scoreObfuscation(text)).toBe(true)
  })

  test('flags document.write( combined with unescape(', () => {
    const text = 'document.write(unescape("%3Cscript%3E"));'
    expect(scoreObfuscation(text)).toBe(true)
  })

  test('flags a long quoted base64-looking string literal on its own', () => {
    const payload = 'A'.repeat(1000)
    const text = `var blob = "${payload}";`
    expect(scoreObfuscation(text)).toBe(true)
  })

  test('does not flag a short eval without atob', () => {
    const text = 'eval("1+1")'
    expect(scoreObfuscation(text)).toBe(false)
  })
})
