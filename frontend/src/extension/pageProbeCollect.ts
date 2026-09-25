// Pure DOM-derivable subset of the in-browser page signal collector
// (Feature C). Takes an explicit Document + pageUrl so it's testable
// against arbitrary jsdom fixtures, independent of the test runner's
// ambient location. Never reads or returns page text/HTML — only
// booleans/counts/matched-network-names (see core/types.ts's PageSignals).
//
// `cryptominer`, `notification_prompt`, and `popups` are left at their
// runtime defaults (false/false/0): those come from the MAIN-world probe
// (page-probe-main.ts) at runtime and are merged in by the orchestrator
// (page-probe.ts), not by this pure collector.

import { matchMalvertisingHost } from './malvertising'
import { scoreObfuscation } from './obfuscation'
import { registrableHost } from './domain'
import type { PageSignals } from '../core/types'

const MIN_OBFUSCATION_CANDIDATE_LENGTH = 1500
const HIDDEN_SIZE_PX_THRESHOLD = 2
const OFFSCREEN_OFFSET_PX_THRESHOLD = 1000
const TRACKER_COOKIE_PATTERNS = ['_ga', '_gid', '_fbp', '__gads', '_hj', 'IDE', '_uetsid', '_clck']

function resolveHost(url: string, base: string): string | null {
  try {
    return new URL(url, base).hostname.toLowerCase()
  } catch {
    return null
  }
}

function resolveHref(url: string, base: string): string | null {
  try {
    return new URL(url, base).href
  } catch {
    return null
  }
}

function parseInlineStyle(styleAttr: string | null): Record<string, string> {
  const result: Record<string, string> = {}
  if (!styleAttr) return result
  for (const declaration of styleAttr.split(';')) {
    const separatorIndex = declaration.indexOf(':')
    if (separatorIndex === -1) continue
    const key = declaration.slice(0, separatorIndex).trim().toLowerCase()
    const value = declaration.slice(separatorIndex + 1).trim().toLowerCase()
    if (key && value) result[key] = value
  }
  return result
}

function parsePx(value: string | undefined | null): number | null {
  if (!value) return null
  const match = /^(-?\d+(?:\.\d+)?)(?:px)?$/.exec(value.trim())
  return match ? parseFloat(match[1]) : null
}

/** True when an iframe's inline style (or width/height attrs) hides it via
 * a near-zero size, display:none/visibility:hidden, or a large negative
 * offset pushing it off-screen. */
function isHiddenBySizeOrStyle(iframe: Element): boolean {
  const style = parseInlineStyle(iframe.getAttribute('style'))
  const width = parsePx(style.width) ?? parsePx(iframe.getAttribute('width'))
  const height = parsePx(style.height) ?? parsePx(iframe.getAttribute('height'))

  if (width !== null && width <= HIDDEN_SIZE_PX_THRESHOLD) return true
  if (height !== null && height <= HIDDEN_SIZE_PX_THRESHOLD) return true
  if (style.display === 'none') return true
  if (style.visibility === 'hidden') return true

  const left = parsePx(style.left)
  const top = parsePx(style.top)
  if (left !== null && left <= -OFFSCREEN_OFFSET_PX_THRESHOLD) return true
  if (top !== null && top <= -OFFSCREEN_OFFSET_PX_THRESHOLD) return true

  return false
}

function countTrackerCookies(cookieString: string): number {
  const names = cookieString
    .split(';')
    .map((entry) => entry.split('=')[0]?.trim())
    .filter((name): name is string => Boolean(name))

  return names.filter((name) => TRACKER_COOKIE_PATTERNS.some((pattern) => name.includes(pattern)))
    .length
}

/**
 * Derives the DOM-observable subset of PageSignals from `doc`, resolving
 * relative URLs against the explicit `pageUrl` (never reads `location.href`
 * internally, so it's testable against any jsdom fixture). `cookieString`
 * defaults to the document's own `document.cookie` when omitted, but tests
 * should pass it explicitly since jsdom's cookie jar isn't populated by
 * fixture HTML.
 */
export function collectPageSignals(
  doc: Document,
  pageUrl: string,
  cookieString?: string,
): Partial<PageSignals> {
  const pageHost = resolveHost(pageUrl, pageUrl) ?? ''
  const pageRegistrable = registrableHost(pageHost)
  const isHttpPage = pageUrl.trim().toLowerCase().startsWith('http:')

  const malvertisingMatches = new Set<string>()
  const thirdPartyHosts = new Set<string>()

  for (const script of Array.from(doc.querySelectorAll('script[src]'))) {
    const src = script.getAttribute('src')
    if (!src) continue
    const host = resolveHost(src, pageUrl)
    if (!host) continue
    const match = matchMalvertisingHost(host)
    if (match) malvertisingMatches.add(match)
    if (host !== pageHost) thirdPartyHosts.add(host)
  }

  for (const iframe of Array.from(doc.querySelectorAll('iframe[src]'))) {
    const src = iframe.getAttribute('src')
    if (!src) continue
    const host = resolveHost(src, pageUrl)
    if (!host) continue
    const match = matchMalvertisingHost(host)
    if (match) malvertisingMatches.add(match)
  }

  let obfuscatedJs = 0
  for (const script of Array.from(doc.querySelectorAll('script:not([src])'))) {
    const text = script.textContent ?? ''
    if (text.length >= MIN_OBFUSCATION_CANDIDATE_LENGTH && scoreObfuscation(text)) {
      obfuscatedJs += 1
    }
  }

  let hiddenIframes = 0
  for (const iframe of Array.from(doc.querySelectorAll('iframe'))) {
    const src = iframe.getAttribute('src')
    const host = src ? resolveHost(src, pageUrl) : null
    if (!host || host === pageHost) continue
    if (isHiddenBySizeOrStyle(iframe)) hiddenIframes += 1
  }

  // Insecure when either: the page itself is served over plain http and
  // has any password field, or a password form (on any page) submits to a
  // plain-http action — classic mixed-content credential leak, even from
  // an https page.
  let insecurePasswordForm = isHttpPage && Boolean(doc.querySelector('input[type="password"]'))
  for (const form of Array.from(doc.querySelectorAll('form'))) {
    if (!form.querySelector('input[type="password"]')) continue
    const action = form.getAttribute('action')
    if (!action) continue
    const resolvedAction = resolveHref(action, pageUrl)
    if (resolvedAction?.toLowerCase().startsWith('http:')) insecurePasswordForm = true
  }

  let crossSitePasswordForm = false
  for (const form of Array.from(doc.querySelectorAll('form'))) {
    if (!form.querySelector('input[type="password"]')) continue
    const action = form.getAttribute('action')
    const actionHost = action ? resolveHost(action, pageUrl) : pageHost
    if (!actionHost) continue
    if (registrableHost(actionHost) !== pageRegistrable) crossSitePasswordForm = true
  }

  let offsiteMetaRefresh = false
  const metaRefresh = doc.querySelector('meta[http-equiv="refresh" i]')
  if (metaRefresh) {
    const content = metaRefresh.getAttribute('content') ?? ''
    const urlMatch = /url=(.+)$/i.exec(content)
    if (urlMatch) {
      const host = resolveHost(urlMatch[1].trim(), pageUrl)
      if (host && host !== pageHost) offsiteMetaRefresh = true
    }
  }

  const cookies = cookieString ?? doc.defaultView?.document.cookie ?? ''

  return {
    malvertising: Array.from(malvertisingMatches),
    obfuscated_js: obfuscatedJs,
    hidden_iframes: hiddenIframes,
    insecure_password_form: insecurePasswordForm,
    cross_site_password_form: crossSitePasswordForm,
    offsite_meta_refresh: offsiteMetaRefresh,
    third_party_domains: thirdPartyHosts.size,
    tracker_cookies: countTrackerCookies(cookies),
    cryptominer: false,
    notification_prompt: false,
    popups: 0,
  }
}
