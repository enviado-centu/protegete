// Types mirroring the backend contract (see docs/superpowers/plans and
// backend/app/schemas.py). Kept intentionally close to the Python shapes so
// the frontend never guesses field names.

export type Level = 'safe' | 'caution' | 'danger'

export type Category =
  | 'impersonation'
  | 'suspicious_domain'
  | 'hidden_destination'
  | 'insecure'
  | 'blacklisted'
  | 'social_engineering'
  | 'risky_site'
  | 'malicious'
  | 'none'

export interface MLInfo {
  probability: number
  threshold: number
  flagged: boolean
  top_features: string[]
}

export interface RuleHit {
  id: string
  weight: number
}

export interface Details {
  blacklist: boolean
  whitelist: boolean
  ml_probability: number
  reputation: 'flagged' | 'clean' | 'unavailable'
}

/** Response of POST /api/analyze */
export interface UrlVerdict {
  url: string
  level: Level
  score: number
  category: Category
  reasons: string[]
  tip: string
  ml: MLInfo
  rules: RuleHit[]
  details: Details
}

export interface Signal {
  id: string
  evidence: string
}

export interface Lesson {
  id: string
  icon: string
  title: string
  how_to_spot: string
  example: string
  what_to_do: string
}

/** Response of POST /api/analyze-text */
export interface TextVerdict {
  level: Level
  score: number
  category: Category
  reasons: string[]
  tip: string
  signals: Signal[]
  lessons: Lesson[]
  urls: UrlVerdict[]
}

export interface ChatContext {
  level?: Level | null
  signals?: Signal[]
}

/** Response of POST /api/chat */
export interface ChatAnswer {
  answer: string | null
  fallback: boolean
}

export type Verdict = UrlVerdict | TextVerdict

export function isTextVerdict(verdict: Verdict): verdict is TextVerdict {
  return 'signals' in verdict
}

/**
 * In-browser page signals sent to POST /api/analyze-page (Feature C). Only
 * booleans/counts/matched-name lists ever leave the browser — never page
 * HTML/script text, URLs beyond the base analyze call, or cookie values.
 * Field names/types must match the backend contract exactly.
 */
export interface PageSignals {
  malvertising: string[]
  cryptominer: boolean
  obfuscated_js: number
  hidden_iframes: number
  insecure_password_form: boolean
  cross_site_password_form: boolean
  notification_prompt: boolean
  popups: number
  offsite_meta_refresh: boolean
  third_party_domains: number
  tracker_cookies: number
}

export interface PageSignal {
  id: string
  reason: string
}

/** Response of POST /api/analyze-page */
export interface AnalyzePageResult extends UrlVerdict {
  page_signals: PageSignal[]
  lessons: Lesson[]
}
