// Pure verdict-combining logic (Feature B): merges two independently-scored
// results (e.g. the page-signals verdict + the visible-text verdict, or a
// screenshot OCR verdict) into one, per spec: "max level wins; reasons are
// unioned and deduped". Never re-scored/averaged, so a `danger` from either
// source is never hidden by a milder second source.

import type { Level } from '../core/types'

const LEVEL_RANK: Record<Level, number> = { safe: 0, caution: 1, danger: 2 }

export interface MergeableVerdict {
  level: Level
  score: number
  category: string
  reasons: string[]
  tip: string
}

/**
 * Merges `b` into `a`: the higher-severity side's `level`/`category`/`tip`
 * wins (ties keep `a`'s), `score` is the max of both, and `reasons` is the
 * union of both lists, order-preserving and deduplicated.
 */
export function mergeVerdicts<T extends MergeableVerdict>(a: T, b: MergeableVerdict): T {
  const bWins = LEVEL_RANK[b.level] > LEVEL_RANK[a.level]
  const winner = bWins ? b : a
  return {
    ...a,
    level: winner.level,
    score: Math.max(a.score, b.score),
    category: winner.category,
    tip: winner.tip,
    reasons: Array.from(new Set([...a.reasons, ...b.reasons])),
    // `winner.category` is narrowed to MergeableVerdict's plain `string`,
    // but T's own `category` field (e.g. the backend's `Category` union) is
    // guaranteed to only ever hold values the backend itself produced on
    // either side of the merge, so this is safe despite the wider type.
  } as T
}
