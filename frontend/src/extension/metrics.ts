// Local, privacy-preserving threat metrics for the extension (spec §4).
// Never stores a URL or plain domain in the persistent store: only per-day
// { caution, danger } counters plus a running total. Same-domain-same-day
// dedupe is done via a SHA-256 hash of `${yyyy-mm-dd}|${domain}`, kept only
// in the (per-browser-session) sessionStore — never written to the
// persistent store, so no domain text is ever retained across sessions.

import type { Level } from '../core/types'

/** Minimal async key-value contract both stores implement. */
export interface KV {
  get(key: string): Promise<unknown>
  set(key: string, value: unknown): Promise<void>
  /** Synchronous snapshot of everything held — tests only. */
  dump(): Record<string, unknown>
}

/** In-memory KV store, used by unit tests (no chrome.* APIs needed). */
export function memoryStore(): KV {
  const data = new Map<string, unknown>()
  return {
    async get(key) {
      return data.has(key) ? data.get(key) : undefined
    },
    async set(key, value) {
      data.set(key, value)
    },
    dump() {
      return Object.fromEntries(data.entries())
    },
  }
}

/** chrome.storage-backed KV store (extension runtime only). */
export function chromeStore(area: 'local' | 'session'): KV {
  const storage = chrome.storage[area]
  return {
    async get(key) {
      const result = await storage.get(key)
      return result[key]
    },
    async set(key, value) {
      await storage.set({ [key]: value })
    },
    dump() {
      // Best-effort synchronous snapshot; chrome.storage is async-only, so
      // this is not used against chromeStore in practice (tests use
      // memoryStore). Kept for interface completeness.
      return {}
    },
  }
}

const DAY_MS = 24 * 60 * 60 * 1000
const RETENTION_DAYS = 30
const WEEK_DAYS = 7
const METRICS_KEY = 'metrics:days'
const DEDUPE_PREFIX = 'metrics:dedupe:'

/** Counts of potential-threat verdicts for one day (or an aggregate window). */
export interface Counts {
  total: number
  danger: number
}

type DayCounts = { caution: number; danger: number }
type DaysMap = Record<string, DayCounts>

function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10) // YYYY-MM-DD (UTC)
}

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

function pruneOldDays(days: DaysMap, now: Date): DaysMap {
  const cutoff = new Date(now)
  cutoff.setUTCDate(cutoff.getUTCDate() - RETENTION_DAYS)
  const cutoffKey = dayKey(cutoff)
  const pruned: DaysMap = {}
  for (const [key, value] of Object.entries(days)) {
    if (key >= cutoffKey) pruned[key] = value
  }
  return pruned
}

/**
 * Records one verdict for the given domain/day. Only `caution`/`danger`
 * count toward metrics (`safe` is a no-op). Repeated verdicts for the same
 * registrable domain on the same day count once, via a dedupe key that is
 * only ever stored (as a SHA-256 hash) in `sessionStore` — the persistent
 * `store` never sees the domain in any form.
 */
export async function recordVerdict(
  store: KV,
  sessionStore: KV,
  { domain, level, now }: { domain: string; level: Level; now: Date },
): Promise<void> {
  if (level !== 'caution' && level !== 'danger') return

  const key = dayKey(now)
  const dedupeKey = DEDUPE_PREFIX + (await sha256Hex(`${key}|${domain}`))
  const alreadyCounted = await sessionStore.get(dedupeKey)
  if (alreadyCounted) return
  await sessionStore.set(dedupeKey, true)

  const days = ((await store.get(METRICS_KEY)) as DaysMap | undefined) ?? {}
  const day = days[key] ?? { caution: 0, danger: 0 }
  day[level] += 1
  days[key] = day
  await store.set(METRICS_KEY, pruneOldDays(days, now))
}

export interface Metrics {
  today: Counts
  week: Counts
  total: Counts
}

function sumRange(days: DaysMap, keys: string[]): Counts {
  let total = 0
  let danger = 0
  for (const key of keys) {
    const day = days[key]
    if (!day) continue
    total += day.caution + day.danger
    danger += day.danger
  }
  return { total, danger }
}

/** Aggregates today / this week (last 7 days incl. today) / all-time counts. */
export async function getMetrics(store: KV, now: Date): Promise<Metrics> {
  const days = ((await store.get(METRICS_KEY)) as DaysMap | undefined) ?? {}

  const todayKey = dayKey(now)
  const weekKeys: string[] = []
  for (let i = 0; i < WEEK_DAYS; i++) {
    const d = new Date(now.getTime() - i * DAY_MS)
    weekKeys.push(dayKey(d))
  }

  return {
    today: sumRange(days, [todayKey]),
    week: sumRange(days, weekKeys),
    total: sumRange(days, Object.keys(days)),
  }
}
