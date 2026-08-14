/**
 * Pure dashboard math for the usage section: token rollups across day, week,
 * and month granularities, trend figures (moving average, period deltas),
 * and display formatting. All functions are pure and locale-free; copy
 * lives in locales.ts, colors in the stylesheet.
 */

import type { UsageDayBucket, UsageTokenBuckets } from './report-types.ts'

export type Granularity = 'day' | 'week' | 'month'

/** Sum of all four disjoint token buckets. */
export function totalTokensOf(buckets: Pick<UsageTokenBuckets, 'uncachedInputTokens' | 'outputTokens' | 'cacheReadTokens' | 'cacheWriteTokens'>): number {
  return buckets.uncachedInputTokens + buckets.outputTokens
    + buckets.cacheReadTokens + buckets.cacheWriteTokens
}

/** Prompt-side traffic; the cache-rate denominator. */
export function promptTokensOf(buckets: Pick<UsageTokenBuckets, 'uncachedInputTokens' | 'cacheReadTokens' | 'cacheWriteTokens'>): number {
  return buckets.uncachedInputTokens + buckets.cacheReadTokens + buckets.cacheWriteTokens
}

/** Cache-read share of prompt traffic; 0 before any prompt token. */
export function cacheRateOf(buckets: UsageTokenBuckets): number {
  const prompt = promptTokensOf(buckets)
  return prompt === 0 ? 0 : buckets.cacheReadTokens / prompt
}

/** One rolled-up time bucket the series chart draws. */
export interface RolledBucket extends UsageTokenBuckets {
  /** Stable key: 'YYYY-MM-DD' for days, the Monday 'YYYY-MM-DD' for weeks, 'YYYY-MM' for months. */
  key: string
  /** Bucket start instant, epoch ms (local calendar). */
  start: number
  totalTokens: number
  calls: number
}

const pad = (value: number): string => String(value).padStart(2, '0')

/** Local calendar day key of one instant. */
export function dayKeyOf(ms: number): string {
  const date = new Date(ms)
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** Local calendar day key shifted by a signed day count. */
export function addDays(day: string, delta: number): string {
  const date = new Date(day + 'T00:00:00')
  date.setDate(date.getDate() + delta)
  return dayKeyOf(date.getTime())
}

/** The Monday of the week containing `day` (local calendar). */
export function weekStartOf(day: string): string {
  const weekday = new Date(day + 'T00:00:00').getDay()
  return addDays(day, weekday === 0 ? -6 : 1 - weekday)
}

/** Month key 'YYYY-MM' of a day key. */
export function monthKeyOf(day: string): string {
  return day.slice(0, 7)
}

/**
 * Roll local-day buckets into the requested granularity, preserving order.
 * Weeks run Monday-Sunday and months are calendar months; a bucket is
 * labeled by its start, and gaps between days simply produce no bucket.
 * @param series - ascending local-day buckets from the plugin report.
 * @param granularity - day (identity), week, or month.
 * @returns the rolled buckets, ascending.
 */
export function rollup(series: readonly UsageDayBucket[], granularity: Granularity): RolledBucket[] {
  if (granularity === 'day') {
    return series.map(day => ({
      ...day,
      key: day.day,
      start: Date.parse(`${day.day}T00:00:00`),
    }))
  }
  const buckets = new Map<string, RolledBucket>()
  for (const day of series) {
    const key = granularity === 'week' ? weekStartOf(day.day) : monthKeyOf(day.day)
    const current = buckets.get(key)
    const start = Date.parse(`${key}T00:00:00`)
    buckets.set(key, current === undefined ? {
      key,
      start,
      uncachedInputTokens: day.uncachedInputTokens,
      outputTokens: day.outputTokens,
      cacheReadTokens: day.cacheReadTokens,
      cacheWriteTokens: day.cacheWriteTokens,
      totalTokens: day.totalTokens,
      calls: day.calls,
    } : {
      ...current,
      uncachedInputTokens: current.uncachedInputTokens + day.uncachedInputTokens,
      outputTokens: current.outputTokens + day.outputTokens,
      cacheReadTokens: current.cacheReadTokens + day.cacheReadTokens,
      cacheWriteTokens: current.cacheWriteTokens + day.cacheWriteTokens,
      totalTokens: current.totalTokens + day.totalTokens,
      calls: current.calls + day.calls,
    })
  }
  // Days arrive ascending and the map keeps insertion order, so the
  // buckets are already ascending.
  return [...buckets.values()]
}

/**
 * 7-day trailing average of a bucket's total, aligned with the bucket list;
 * the first six entries carry null (fewer than seven days of context).
 */
export function trailingAverage(buckets: readonly RolledBucket[], window = 7): Array<number | null> {
  return buckets.map((_, index) => {
    if (index < window - 1) return null
    const windowed = buckets.slice(index - window + 1, index + 1)
    return windowed.reduce((total, bucket) => total + bucket.totalTokens, 0) / window
  })
}

/**
 * Period-over-period delta: the trailing N buckets against the N before
 * them (days 7, weeks 4, months 3). Null when fewer than 2N buckets exist
 * or the previous period is all zeros.
 */
export function periodDelta(
  buckets: readonly RolledBucket[],
  granularity: Granularity,
): { current: number; previous: number; delta: number } | null {
  const window = granularity === 'day' ? 7 : granularity === 'week' ? 4 : 3
  if (buckets.length < window * 2) return null
  const sum = (start: number, end: number): number =>
    buckets.slice(start, end).reduce((total, bucket) => total + bucket.totalTokens, 0)
  const current = sum(buckets.length - window, buckets.length)
  const previous = sum(buckets.length - window * 2, buckets.length - window)
  if (previous === 0) return null
  return { current, previous, delta: (current - previous) / previous }
}

/** Index of the highest-total bucket (first when tied). */
export function peakIndexOf(buckets: readonly RolledBucket[]): number {
  let peak = 0
  let peakTotal = -1
  buckets.forEach((bucket, index) => {
    if (bucket.totalTokens > peakTotal) {
      peak = index
      peakTotal = bucket.totalTokens
    }
  })
  return peak
}

/** Short axis label of a rolled bucket key: '08-12' for days and weeks, '2026-08' for months. */
export function bucketKeyLabel(key: string, granularity: Granularity): string {
  return granularity === 'month' ? key : key.slice(5)
}

/**
 * Compact token count for card labels: 1.23M, 45.6k, 980. One decimal, no
 * trailing zero; sub-thousand values render as whole numbers.
 */
export function compactTokens(value: number): string {
  if (value >= 1_000_000_000) return trim(value / 1_000_000_000) + 'B'
  if (value >= 1_000_000) return trim(value / 1_000_000) + 'M'
  if (value >= 1_000) return trim(value / 1_000) + 'k'
  return String(Math.round(value))
}

const trim = (value: number): string => {
  const rounded = Math.round(value * 10) / 10
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)
}

/** Full token count with thousands separators (tooltips and tables). */
export function formatTokens(value: number): string {
  return new Intl.NumberFormat('en-US').format(value)
}

/** Percent display of a 0..1 ratio, one decimal (100% for 1). */
export function formatPercent(ratio: number, digits = 1): string {
  return `${(ratio * 100).toFixed(digits)}%`
}

/**
 * Relative recency of one instant for list rows: minutes/hours/days up to a
 * month, then null (the caller falls back to an absolute date).
 */
export function relativeAgo(ms: number, now: number): { value: number; unit: 'minute' | 'hour' | 'day' } | null {
  const minutes = Math.max(0, Math.floor((now - ms) / 60_000))
  if (minutes < 60) return { value: minutes, unit: 'minute' }
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return { value: hours, unit: 'hour' }
  const days = Math.floor(hours / 24)
  if (days < 30) return { value: days, unit: 'day' }
  return null
}
