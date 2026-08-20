/**
 * Pure dashboard math for the usage section: token rollups across day, week,
 * and month granularities, trend figures (moving average, period deltas),
 * trailing range windows, and display formatting. All functions are pure and
 * locale-free; copy lives in locales.ts, colors in the stylesheet.
 */

import type { UsageDayBucket, UsageTokenBuckets } from './report-types.ts'

/** Time grain used by the usage trend and comparison views. */
export type Granularity = 'day' | 'week' | 'month'

/** Trailing-window preset of the trend range filter. */
export type TrendRange = 'all' | 7 | 30 | 90

/**
 * Sharpen one {@link TrendRange} preset into its day count.
 * @param range - the selected preset.
 * @returns the trailing day count, or null to keep the full series.
 */
export function trendRangeDays(range: TrendRange): number | null {
  return range === 'all' ? null : range
}

/**
 * Keep only day buckets inside the trailing window of one trend range
 * preset. The window is inclusive: `days` days ending today (local
 * calendar), and future-dated buckets survive the filter.
 * @param series - ascending local-day buckets from the plugin report.
 * @param range - the selected preset.
 * @param now - comparison instant as epoch milliseconds, injectable for
 * deterministic tests.
 * @returns the buckets whose day key falls inside the window.
 */
export function filterRangeSeries(
  series: readonly UsageDayBucket[],
  range: TrendRange,
  now = Date.now(),
): UsageDayBucket[] {
  const days = trendRangeDays(range)
  if (days === null) return [...series]
  const floor = addDays(dayKeyOf(now), 1 - days)
  return series.filter(bucket => bucket.day >= floor)
}

/**
 * Sum tokens and calls over one day-bucket list.
 * @param buckets - the buckets to aggregate.
 * @returns total tokens and total calls of the list.
 */
export function seriesTotal(buckets: readonly UsageDayBucket[]): {
  tokens: number
  calls: number
} {
  return buckets.reduce(
    (sum, bucket) => ({
      tokens: sum.tokens + bucket.totalTokens,
      calls: sum.calls + bucket.calls,
    }),
    { tokens: 0, calls: 0 },
  )
}

/**
 * Sum all four disjoint token buckets.
 * @param buckets - token counts to add.
 * @returns total input, output, cache-read, and cache-write tokens.
 */
export function totalTokensOf(
  buckets: Pick<
    UsageTokenBuckets,
  | 'uncachedInputTokens'
  | 'outputTokens'
  | 'cacheReadTokens'
  | 'cacheWriteTokens'
  >,
): number {
  return (
    buckets.uncachedInputTokens +
  buckets.outputTokens +
  buckets.cacheReadTokens +
  buckets.cacheWriteTokens
  )
}

/**
 * Sum prompt-side traffic used as the cache-rate denominator.
 * @param buckets - uncached input, cache-read, and cache-write counts.
 * @returns prompt-side token count.
 */
export function promptTokensOf(
  buckets: Pick<
    UsageTokenBuckets,
  'uncachedInputTokens' | 'cacheReadTokens' | 'cacheWriteTokens'
  >,
): number {
  return (
    buckets.uncachedInputTokens +
  buckets.cacheReadTokens +
  buckets.cacheWriteTokens
  )
}

/**
 * Calculate the cache-read share of prompt traffic.
 * @param buckets - token counts for one usage bucket.
 * @returns cache-read ratio, or zero before any prompt token.
 */
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

/**
 * Return the local calendar day key of one instant.
 * @param ms - instant as epoch milliseconds.
 * @returns a `YYYY-MM-DD` local date key.
 */
export function dayKeyOf(ms: number): string {
  const date = new Date(ms)
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/**
 * Shift a local calendar day key by a signed day count.
 * @param day - starting `YYYY-MM-DD` local date key.
 * @param delta - number of days to add or subtract.
 * @returns the shifted local date key.
 */
export function addDays(day: string, delta: number): string {
  const date = new Date(day + 'T00:00:00')
  date.setDate(date.getDate() + delta)
  return dayKeyOf(date.getTime())
}

/**
 * Return the Monday of the week containing a local date.
 * @param day - local `YYYY-MM-DD` date key.
 * @returns the week's Monday as a local date key.
 */
export function weekStartOf(day: string): string {
  const weekday = new Date(day + 'T00:00:00').getDay()
  return addDays(day, weekday === 0 ? -6 : 1 - weekday)
}

/**
 * Return the month key of a local date.
 * @param day - local `YYYY-MM-DD` date key.
 * @returns the `YYYY-MM` month key.
 */
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
export function rollup(
  series: readonly UsageDayBucket[],
  granularity: Granularity,
): RolledBucket[] {
  if (granularity === 'day') {
    return series.map(day => ({
      ...day,
      key: day.day,
      start: Date.parse(`${day.day}T00:00:00`),
    }))
  }
  const buckets = new Map<string, RolledBucket>()
  for (const day of series) {
    const key =
      granularity === 'week' ? weekStartOf(day.day) : monthKeyOf(day.day)
    const current = buckets.get(key)
    const start = Date.parse(`${key}T00:00:00`)
    buckets.set(
      key,
      current === undefined
        ? {
          key,
          start,
          uncachedInputTokens: day.uncachedInputTokens,
          outputTokens: day.outputTokens,
          cacheReadTokens: day.cacheReadTokens,
          cacheWriteTokens: day.cacheWriteTokens,
          totalTokens: day.totalTokens,
          calls: day.calls,
        }
        : {
          ...current,
          uncachedInputTokens:
        current.uncachedInputTokens + day.uncachedInputTokens,
          outputTokens: current.outputTokens + day.outputTokens,
          cacheReadTokens: current.cacheReadTokens + day.cacheReadTokens,
          cacheWriteTokens: current.cacheWriteTokens + day.cacheWriteTokens,
          totalTokens: current.totalTokens + day.totalTokens,
          calls: current.calls + day.calls,
        },
    )
  }
  // Days arrive ascending and the map keeps insertion order, so the
  // buckets are already ascending.
  return [...buckets.values()]
}

/**
 * Calculate a trailing average aligned with the bucket list.
 * @param buckets - ascending rolled buckets.
 * @param window - number of buckets in each average window.
 * @returns one average per bucket, with null until a full window exists.
 */
export function trailingAverage(
  buckets: readonly RolledBucket[],
  window = 7,
): Array<number | null> {
  return buckets.map((_, index) => {
    if (index < window - 1) return null
    const windowed = buckets.slice(index - window + 1, index + 1)
    return (
      windowed.reduce((total, bucket) => total + bucket.totalTokens, 0) / window
    )
  })
}

/**
 * Compare the trailing period with the preceding period.
 * @param buckets - ascending rolled buckets.
 * @param granularity - grain selecting the comparison window.
 * @returns current total, previous total, and relative delta, or null when the comparison is unavailable.
 */
export function periodDelta(
  buckets: readonly RolledBucket[],
  granularity: Granularity,
): { current: number; previous: number; delta: number } | null {
  const window = granularity === 'day' ? 7 : granularity === 'week' ? 4 : 3
  if (buckets.length < window * 2) return null
  const sum = (start: number, end: number): number =>
    buckets
      .slice(start, end)
      .reduce((total, bucket) => total + bucket.totalTokens, 0)
  const current = sum(buckets.length - window, buckets.length)
  const previous = sum(buckets.length - window * 2, buckets.length - window)
  if (previous === 0) return null
  return { current, previous, delta: (current - previous) / previous }
}

/**
 * Find the first bucket with the highest total.
 * @param buckets - rolled buckets to inspect.
 * @returns the highest-total bucket index.
 */
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

/**
 * Format a rolled bucket key for a short chart axis label.
 * @param key - rolled bucket key.
 * @param granularity - grain of the key.
 * @returns a short month, day, or week label.
 */
export function bucketKeyLabel(key: string, granularity: Granularity): string {
  return granularity === 'month' ? key : key.slice(5)
}

/**
 * Compact a token count for card labels.
 * @param value - token count.
 * @returns a compact count using B, M, or k suffixes where appropriate.
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

/**
 * Format a token count with thousands separators.
 * @param value - token count.
 * @returns the localized full count.
 */
export function formatTokens(value: number): string {
  return new Intl.NumberFormat('en-US').format(value)
}

/**
 * Format a ratio as a percentage.
 * @param ratio - ratio in the range 0..1.
 * @param digits - number of fractional digits.
 * @returns the percentage string.
 */
export function formatPercent(ratio: number, digits = 1): string {
  return `${(ratio * 100).toFixed(digits)}%`
}

/**
 * Express one instant's recency for a list row.
 * @param ms - instant as epoch milliseconds.
 * @param now - comparison instant as epoch milliseconds.
 * @returns a minute, hour, or day value up to one month, otherwise null.
 */
export function relativeAgo(
  ms: number,
  now: number,
): { value: number; unit: 'minute' | 'hour' | 'day' } | null {
  const minutes = Math.max(0, Math.floor((now - ms) / 60_000))
  if (minutes < 60) return { value: minutes, unit: 'minute' }
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return { value: hours, unit: 'hour' }
  const days = Math.floor(hours / 24)
  if (days < 30) return { value: days, unit: 'day' }
  return null
}
