/**
 * Pure dashboard math for the usage section: token rollups across day, week,
 * and month granularities, trend figures (moving average, period deltas),
 * trailing range windows, per-bucket cache rates, context occupancy, insight
 * selection, CSV serialization, and display formatting. All functions are
 * pure and locale-free except where a language id picks numeral units; copy
 * lives in locales.ts, colors in the stylesheet.
 */

import type {
  UsageContextPressure,
  UsageDayBucket,
  UsageDescribeValue,
  UsageHeatmap,
  UsageInsight,
  UsageSessionRow,
  UsageTokenBuckets,
  UsageTotals,
} from './report-types.ts'

/** Time grain used by the usage trend and comparison views. */
export type Granularity = 'day' | 'week' | 'month'

/** Trailing-window preset of the trend range filter. */
export type TrendRange = 'all' | 7 | 30 | 90

/** Projected-context share at or above which a session counts as near limit. */
export const NEAR_LIMIT_SHARE = 0.8

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

/**
 * Calculate one session's projected context fill from its occupancy value.
 * @param pressure - the session's contextPressure projection value.
 * @returns the projected share of the context window, or null without a
 * window denominator.
 */
export function contextFillOf(pressure: UsageContextPressure): number | null {
  if (pressure.contextWindow === null || pressure.contextWindow === 0) return null
  const projected = pressure.projectedTokens ?? pressure.pressureTokens ?? 0
  return projected / pressure.contextWindow
}

/**
 * Count length of the unbroken recent daily-activity run.
 * @param series - ascending local-day buckets from the plugin report.
 * @param now - comparison instant as epoch milliseconds, injectable for
 * deterministic tests.
 * @returns consecutive active days ending today or yesterday.
 */
export function streakOf(
  series: readonly UsageDayBucket[],
  now = Date.now(),
): number {
  const active = new Set(series.filter(bucket => bucket.totalTokens > 0).map(bucket => bucket.day))
  let cursor = dayKeyOf(now)
  // A streak counted "today" may legitimately start yesterday: an empty
  // today must not erase a run that is still alive through yesterday.
  if (!active.has(cursor)) cursor = addDays(cursor, -1)
  let streak = 0
  while (active.has(cursor)) {
    streak += 1
    cursor = addDays(cursor, -1)
  }
  return streak
}

/**
 * Find the highest-total day bucket.
 * @param series - ascending local-day buckets from the plugin report.
 * @returns the peak bucket, or null for an empty series.
 */
export function busiestDayOf(
  series: readonly UsageDayBucket[],
): UsageDayBucket | null {
  let best: UsageDayBucket | null = null
  for (const bucket of series) {
    if (best === null || bucket.totalTokens > best.totalTokens) best = bucket
  }
  return best
}

/**
 * Find the densest heatmap cell (server indexing: weekday 0 = Sunday).
 * @param heatmap - 24 local hours by weekday.
 * @returns the peak cell, or null when every cell is empty.
 */
export function busiestCellOf(
  heatmap: UsageHeatmap,
): { hour: number; weekday: number; tokens: number } | null {
  let best: { hour: number; weekday: number; tokens: number } | null = null
  for (const [hour, cells] of heatmap.entries()) {
    for (const [weekday, tokens] of cells.entries()) {
      if (best === null || tokens > best.tokens) best = { hour, weekday, tokens }
    }
  }
  return best !== null && best.tokens > 0 ? best : null
}

/**
 * Calculate the subagent-origin share of reported tokens.
 * @param totals - whole-report totals.
 * @returns subagent tokens over total tokens, or zero before any token.
 */
export function subagentShareOf(totals: UsageTotals): number {
  return totals.totalTokens === 0 ? 0 : totals.subagentTokens / totals.totalTokens
}

/**
 * Read one local-day bucket out of the series.
 * @param series - ascending local-day buckets from the plugin report.
 * @param day - local `YYYY-MM-DD` day key.
 * @returns the bucket for that day, or null when the day had no activity.
 */
export function dayBucketOf(
  series: readonly UsageDayBucket[],
  day: string,
): UsageDayBucket | null {
  return series.find(bucket => bucket.day === day) ?? null
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
 * Calculate a trailing average over one picked metric of the bucket list.
 * @param buckets - ascending rolled buckets.
 * @param pick - metric of a bucket to average.
 * @param window - number of buckets in each average window.
 * @returns one average per bucket, with null until a full window exists.
 */
export function trailingMetricAverage(
  buckets: readonly RolledBucket[],
  pick: (bucket: RolledBucket) => number,
  window = 7,
): Array<number | null> {
  return buckets.map((_, index) => {
    if (index < window - 1) return null
    const windowed = buckets.slice(index - window + 1, index + 1)
    return windowed.reduce((total, bucket) => total + pick(bucket), 0) / window
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
 * Find the first bucket with the highest value of one picked metric.
 * @param buckets - rolled buckets to inspect.
 * @param pick - metric of a bucket to compare.
 * @returns the highest-metric bucket index.
 */
export function peakIndexOfMetric(
  buckets: readonly RolledBucket[],
  pick: (bucket: RolledBucket) => number,
): number {
  let peak = 0
  let peakValue = -1
  buckets.forEach((bucket, index) => {
    const value = pick(bucket)
    if (value > peakValue) {
      peak = index
      peakValue = value
    }
  })
  return peak
}

/**
 * Calculate the per-bucket cache-read share of prompt traffic.
 * @param buckets - rolled buckets to inspect.
 * @returns one ratio per bucket, null where the bucket saw no prompt tokens.
 */
export function cacheRateSeriesOf(
  buckets: readonly RolledBucket[],
): Array<number | null> {
  return buckets.map((bucket) => {
    const prompt = promptTokensOf(bucket)
    return prompt === 0 ? null : bucket.cacheReadTokens / prompt
  })
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
 * @param language - active UI language id; `zh` switches to 万/亿 units.
 * @returns a compact count using 亿/万 (zh) or B, M, k suffixes otherwise.
 */
export function compactTokens(value: number, language?: string): string {
  if (language === 'zh') {
    if (value >= 100_000_000) return trim(value / 100_000_000) + '亿'
    if (value >= 10_000) return trim(value / 10_000) + '万'
    return String(Math.round(value))
  }
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

/** Cap on the auto-generated insight list. */
const INSIGHT_LIMIT = 5

/** Week-over-week delta above which the change reads as a rise. */
const DELTA_EPSILON = 0.0005

/** Subagent share at or above which the split reads as notable. */
const SUBAGENT_SHARE_NOTABLE = 0.3

/** Cache-read share at or above which the hit rate reads as healthy. */
const CACHE_RATE_GOOD = 0.6

/** Cache-read share at or below which the hit rate reads as low. */
const CACHE_RATE_LOW = 0.2

/**
 * Select the dashboard's auto-generated findings from one ready report.
 * Every rule is independent; the list keeps a fixed presentation order and
 * is capped at {@link INSIGHT_LIMIT} entries.
 * @param value - the ready report.
 * @param weekdayLabels - Monday-first weekday labels in display order.
 * @param now - comparison instant as epoch milliseconds, injectable for
 * deterministic tests.
 * @returns the selected insights.
 */
export function insightsOf(
  value: UsageDescribeValue,
  weekdayLabels: readonly string[],
  now = Date.now(),
): UsageInsight[] {
  const { totals } = value
  const insights: UsageInsight[] = []
  if (totals.promptTokens > 0) {
    if (totals.cacheRate >= CACHE_RATE_GOOD) {
      insights.push({
        tone: 'good',
        key: 'insightCacheGood',
        params: { rate: formatPercent(totals.cacheRate, 0) },
      })
    } else if (totals.cacheRate <= CACHE_RATE_LOW) {
      insights.push({
        tone: 'info',
        key: 'insightCacheLow',
        params: { rate: formatPercent(totals.cacheRate, 0) },
      })
    }
  }
  const delta = periodDelta(rollup(filterRangeSeries(value.series, 'all', now), 'day'), 'day')
  if (delta !== null) {
    if (delta.delta > DELTA_EPSILON) {
      insights.push({
        tone: 'warn',
        key: 'insightWeekUp',
        params: { delta: formatPercent(delta.delta, 0) },
      })
    } else if (delta.delta < -DELTA_EPSILON) {
      insights.push({
        tone: 'good',
        key: 'insightWeekDown',
        params: { delta: formatPercent(-delta.delta, 0) },
      })
    }
  }
  if (totals.nearLimitSessions > 0) {
    insights.push({
      tone: 'warn',
      key: 'insightNearLimit',
      params: {
        n: String(totals.nearLimitSessions),
        pct: formatPercent(NEAR_LIMIT_SHARE, 0),
      },
    })
  }
  const share = subagentShareOf(totals)
  if (share >= SUBAGENT_SHARE_NOTABLE) {
    insights.push({
      tone: 'info',
      key: 'insightSubagent',
      params: { share: formatPercent(share, 0) },
    })
  }
  const cell = busiestCellOf(value.heatmap)
  if (cell !== null) {
    // Server cells index weekday 0 = Sunday; display labels are Monday-first.
    // Exactly seven labels ship in both dictionaries; the fallback only
    // satisfies the indexed-access type.
    /* v8 ignore next 2 -- see above */
    const label = weekdayLabels[(cell.weekday + 6) % 7] ?? ''
    insights.push({
      tone: 'info',
      key: 'insightPeakHour',
      params: { weekday: label, hour: String(cell.hour) },
    })
  }
  return insights.slice(0, INSIGHT_LIMIT)
}

/** Escape one CSV field: quotes doubled, the value wrapped when needed. */
function csvField(value: string): string {
  return value.includes('"') || value.includes(',') || value.includes('\n') || value.includes('\r')
    ? `"${value.replaceAll('"', '""')}"`
    : value
}

/** Session-detail CSV header, fixed column order. */
const SESSION_CSV_HEADER = [
  'sessionId',
  'title',
  'cwd',
  'origin',
  'agentPreset',
  'uncachedInputTokens',
  'outputTokens',
  'cacheReadTokens',
  'cacheWriteTokens',
  'totalTokens',
  'cacheRate',
  'calls',
  'measured',
  'updatedAt',
] as const

/**
 * Serialize the session breakdown as RFC 4180 CSV for spreadsheet analysis.
 * @param rows - the report's session rows (any order; written as given).
 * @returns the complete CSV text with a header row, CRLF line endings.
 */
export function toSessionsCsv(rows: readonly UsageSessionRow[]): string {
  const line = (fields: readonly string[]): string => fields.map(csvField).join(',')
  const body = rows.map(row =>
    line([
      String(row.sessionId),
      row.title ?? '',
      row.cwd ?? '',
      row.origin ?? '',
      row.agentPreset ?? '',
      String(row.uncachedInputTokens),
      String(row.outputTokens),
      String(row.cacheReadTokens),
      String(row.cacheWriteTokens),
      String(row.totalTokens),
      row.cacheRate.toFixed(4),
      String(row.calls),
      row.measured ? '1' : '0',
      new Date(row.updatedAt).toISOString(),
    ]),
  )
  return [line([...SESSION_CSV_HEADER]), ...body].join('\r\n') + '\r\n'
}
