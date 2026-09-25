import { describe, expect, test } from 'vitest'
import { collectPageSignals } from './pageProbeCollect'

function parse(html: string): Document {
  return new DOMParser().parseFromString(html, 'text/html')
}

// A ~1600-char inline script that trips the obfuscation heuristic (eval( +
// atob( both present) — a plain string fixture, never executed here.
const OBFUSCATED_SCRIPT = `eval(atob("${'A'.repeat(1580)}"))`

describe('collectPageSignals', () => {
  test('detects malvertising script src, obfuscated inline script, and a hidden cross-origin iframe', () => {
    const html = `
      <html>
        <body>
          <script src="https://popads.net/pop.js"></script>
          <script>${OBFUSCATED_SCRIPT}</script>
          <iframe src="https://evil-tracker.example/x" width="1" height="1"></iframe>
        </body>
      </html>
    `
    const doc = parse(html)
    const signals = collectPageSignals(doc, 'https://example-test-site.invalid/')

    expect(signals.malvertising).toContain('popads.net')
    expect(signals.obfuscated_js).toBeGreaterThanOrEqual(1)
    expect(signals.hidden_iframes).toBeGreaterThanOrEqual(1)
    expect(signals.third_party_domains).toBeGreaterThanOrEqual(1)
  })

  test('a clean minimal page yields all-zero/false/empty signals', () => {
    const doc = parse('<html><body><p>hola</p></body></html>')
    const signals = collectPageSignals(doc, 'https://example-test-site.invalid/')

    expect(signals.malvertising).toEqual([])
    expect(signals.obfuscated_js).toBe(0)
    expect(signals.hidden_iframes).toBe(0)
    expect(signals.insecure_password_form).toBe(false)
    expect(signals.cross_site_password_form).toBe(false)
    expect(signals.offsite_meta_refresh).toBe(false)
    expect(signals.third_party_domains).toBe(0)
    expect(signals.tracker_cookies).toBe(0)
  })

  test('flags an insecure (http) password form', () => {
    const doc = parse('<html><body><form><input type="password"></form></body></html>')
    const signals = collectPageSignals(doc, 'http://example-test-site.invalid/login')
    expect(signals.insecure_password_form).toBe(true)
  })

  test('does not flag a password form served over https with a same-scheme action', () => {
    const doc = parse('<html><body><form><input type="password"></form></body></html>')
    const signals = collectPageSignals(doc, 'https://example-test-site.invalid/login')
    expect(signals.insecure_password_form).toBe(false)
  })

  test('flags mixed content: a password form on an https page posting to an http action', () => {
    const doc = parse(
      '<html><body><form action="http://example-test-site.invalid/submit"><input type="password"></form></body></html>',
    )
    const signals = collectPageSignals(doc, 'https://example-test-site.invalid/login')
    expect(signals.insecure_password_form).toBe(true)
  })

  test('flags a password form whose action posts to a different registrable host', () => {
    const doc = parse(
      '<html><body><form action="https://other-site.invalid/submit"><input type="password"></form></body></html>',
    )
    const signals = collectPageSignals(doc, 'https://example-test-site.invalid/')
    expect(signals.cross_site_password_form).toBe(true)
  })

  test('does not flag a password form posting back to the same site', () => {
    const doc = parse(
      '<html><body><form action="/submit"><input type="password"></form></body></html>',
    )
    const signals = collectPageSignals(doc, 'https://example-test-site.invalid/login')
    expect(signals.cross_site_password_form).toBe(false)
  })

  test('flags an offsite meta refresh', () => {
    const doc = parse(
      '<html><head><meta http-equiv="refresh" content="0;url=https://other-site.invalid/"></head><body></body></html>',
    )
    const signals = collectPageSignals(doc, 'https://example-test-site.invalid/')
    expect(signals.offsite_meta_refresh).toBe(true)
  })

  test('counts tracker cookies from an explicit cookie string, not real document.cookie', () => {
    const doc = parse('<html><body></body></html>')
    const signals = collectPageSignals(
      doc,
      'https://example-test-site.invalid/',
      '_ga=1; _fbp=2; unrelated=3',
    )
    expect(signals.tracker_cookies).toBe(2)
  })

  test('leaves cryptominer, notification_prompt and popups at their runtime defaults', () => {
    const doc = parse('<html><body></body></html>')
    const signals = collectPageSignals(doc, 'https://example-test-site.invalid/')
    expect(signals.cryptominer).toBe(false)
    expect(signals.notification_prompt).toBe(false)
    expect(signals.popups).toBe(0)
  })
})
