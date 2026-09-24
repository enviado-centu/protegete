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
