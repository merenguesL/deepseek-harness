import { describe, expect, it } from 'vitest'
import type { UsageDayBucket } from '../src/client/report-types.ts'
import {
  addDays,
  bucketKeyLabel,
  cacheRateOf,
  compactTokens,
  dayKeyOf,
  filterRangeSeries,
  formatPercent,
  formatTokens,
  monthKeyOf,
  peakIndexOf,
  periodDelta,
  promptTokensOf,
  relativeAgo,
  rollup,
  seriesTotal,
  totalTokensOf,
  trailingAverage,
  trendRangeDays,
  weekStartOf,
} from '../src/client/usage-math.ts'

const day = (
  key: string,
  total = 100,
  extra: Partial<UsageDayBucket> = {},
): UsageDayBucket => ({
  day: key,
  uncachedInputTokens: 10,
  outputTokens: 20,
  cacheReadTokens: 60,
  cacheWriteTokens: 10,
  totalTokens: total,
  calls: 1,
  ...extra,
})

describe('bucket math', () => {
  it('sums buckets and prompt traffic', () => {
    const buckets = {
      uncachedInputTokens: 1,
      outputTokens: 2,
      cacheReadTokens: 3,
      cacheWriteTokens: 4,
    }
    expect(totalTokensOf(buckets)).toBe(10)
    expect(promptTokensOf(buckets)).toBe(8)
    expect(cacheRateOf(buckets)).toBeCloseTo(0.375)
    expect(
      cacheRateOf({
        uncachedInputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      }),
    ).toBe(0)
  })

  it('shifts calendar days across month boundaries', () => {
    expect(dayKeyOf(Date.parse('2026-08-12T23:30:00'))).toBe('2026-08-12')
    expect(addDays('2026-08-31', 1)).toBe('2026-09-01')
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31')
    expect(weekStartOf('2026-08-13')).toBe('2026-08-10')
    expect(weekStartOf('2026-08-16')).toBe('2026-08-10')
    expect(weekStartOf('2026-08-17')).toBe('2026-08-17')
    expect(monthKeyOf('2026-08-12')).toBe('2026-08')
  })
})

describe('rollup', () => {
  const series = [
    day('2026-08-10', 100),
    day('2026-08-11', 200),
    day('2026-08-12', 300),
    day('2026-08-19', 400),
    day('2026-09-01', 500),
  ]

  it('keeps day identity and order', () => {
    const rolled = rollup(series, 'day')
    expect(rolled.map(bucket => bucket.key)).toEqual([
      '2026-08-10',
      '2026-08-11',
      '2026-08-12',
      '2026-08-19',
      '2026-09-01',
    ])
    expect(rolled[0]).toMatchObject({
      uncachedInputTokens: 10,
      totalTokens: 100,
      calls: 1,
    })
  })

  it('rolls weeks Monday-first and months by calendar key', () => {
    const weeks = rollup(series, 'week')
    expect(weeks.map(bucket => bucket.key)).toEqual([
      '2026-08-10',
      '2026-08-17',
      '2026-08-31',
    ])
    expect(weeks[0]!.totalTokens).toBe(600)
    expect(weeks[0]!.calls).toBe(3)
    expect(weeks[2]!.totalTokens).toBe(500)
    const months = rollup(series, 'month')
    expect(months.map(bucket => bucket.key)).toEqual(['2026-08', '2026-09'])
    expect(months[0]!.totalTokens).toBe(1000)
  })
})

describe('trend range windows', () => {
  it('decodes the preset day counts', () => {
    expect(trendRangeDays('all')).toBeNull()
    expect(trendRangeDays(7)).toBe(7)
    expect(trendRangeDays(30)).toBe(30)
    expect(trendRangeDays(90)).toBe(90)
  })

  it('keeps the full series for the all preset', () => {
    const series = [day('2026-08-10'), day('2026-08-11')]
    const filtered = filterRangeSeries(
      series,
      'all',
      Date.parse('2026-08-12T12:00:00'),
    )
    expect(filtered).toEqual(series)
    expect(filtered).not.toBe(series)
  })

  it('keeps only the trailing window on the local calendar', () => {
    const series = [
      day('2026-08-01', 100),
      day('2026-08-05', 200),
      day('2026-08-11', 300),
      day('2026-08-12', 400),
      // Future-dated buckets survive the floor comparison.
      day('2026-08-20', 500),
    ].map((bucket, index) => ({ ...bucket, calls: index + 1 }))
    const now = Date.parse('2026-08-12T12:00:00')
    const filtered = filterRangeSeries(series, 7, now)
    expect(filtered.map(bucket => bucket.day)).toEqual([
      '2026-08-11',
      '2026-08-12',
      '2026-08-20',
    ])
  })

  it('returns an empty list when nothing falls inside the window', () => {
    expect(
      filterRangeSeries(
        [day('2026-07-01')],
        7,
        Date.parse('2026-08-12T12:00:00'),
      ),
    ).toEqual([])
  })

  it('sums tokens and calls of a bucket list', () => {
    expect(seriesTotal([])).toEqual({ tokens: 0, calls: 0 })
    expect(
      seriesTotal([
        day('2026-08-10', 100),
        day('2026-08-11', 200, { calls: 3 }),
      ]),
    ).toEqual({ tokens: 300, calls: 4 })
  })
})

describe('trend figures', () => {
  it('computes the 7-day trailing average aligned with the buckets', () => {
    const series = Array.from({ length: 10 }, (_, index) =>
      day('2026-08-' + String(index + 1).padStart(2, '0'), (index + 1) * 10),
    )
    const rolled = rollup(series, 'day')
    const average = trailingAverage(rolled)
    expect(average.slice(0, 6)).toEqual([null, null, null, null, null, null])
    expect(average[6]).toBeCloseTo(40)
    expect(average[9]).toBeCloseTo(70)
    // Week/month modes serve nulls (no average overlay).
    expect(trailingAverage(rollup(series, 'week'))[0]).toBeNull()
  })

  it('compares the trailing window against the previous one per granularity', () => {
    const series = Array.from({ length: 20 }, (_, index) =>
      day('2026-08-' + String(index + 1).padStart(2, '0'), 10),
    )
    const days = rollup(series, 'day')
    expect(periodDelta(days, 'day')).toMatchObject({
      current: 70,
      previous: 70,
      delta: 0,
    })
    const grown = days.map((bucket, index) =>
      index >= 13 ? { ...bucket, totalTokens: 14 } : bucket,
    )
    expect(periodDelta(grown, 'day')).toMatchObject({
      current: 98,
      previous: 70,
    })
    expect(periodDelta(rollup(series.slice(0, 10), 'day'), 'day')).toBeNull()
    // A zero previous period reports null, not a division by zero.
    const zero = series.map(bucket => ({ ...bucket, totalTokens: 0 }))
    expect(periodDelta(rollup(zero.slice(0, 14), 'day'), 'day')).toBeNull()
  })

  it('finds the first peak bucket', () => {
    const series = [
      day('2026-08-10', 100),
      day('2026-08-11', 300),
      day('2026-08-12', 200),
      day('2026-08-13', 300),
    ]
    expect(peakIndexOf(rollup(series, 'day'))).toBe(1)
    expect(peakIndexOf([])).toBe(0)
  })
})

describe('formatting', () => {
  it('compacts token counts with one trimmed decimal', () => {
    expect(compactTokens(0)).toBe('0')
    expect(compactTokens(999)).toBe('999')
    expect(compactTokens(1_000)).toBe('1k')
    expect(compactTokens(1_500)).toBe('1.5k')
    expect(compactTokens(1_230_000)).toBe('1.2M')
    expect(compactTokens(1_200_000_000)).toBe('1.2B')
    expect(formatTokens(1_234_567)).toBe('1,234,567')
    expect(formatPercent(0.5)).toBe('50.0%')
    expect(formatPercent(1)).toBe('100.0%')
  })

  it('labels bucket keys per granularity', () => {
    expect(bucketKeyLabel('2026-08-12', 'day')).toBe('08-12')
    expect(bucketKeyLabel('2026-08-12', 'week')).toBe('08-12')
    expect(bucketKeyLabel('2026-08', 'month')).toBe('2026-08')
  })

  it('describes relative recency up to a month', () => {
    const now = Date.parse('2026-08-12T12:00:00Z')
    expect(relativeAgo(now - 60_000, now)).toEqual({
      value: 1,
      unit: 'minute',
    })
    expect(relativeAgo(now - 3_600_000, now)).toEqual({
      value: 1,
      unit: 'hour',
    })
    expect(relativeAgo(now - 2 * 86_400_000, now)).toEqual({
      value: 2,
      unit: 'day',
    })
    expect(relativeAgo(now - 31 * 86_400_000, now)).toBeNull()
    expect(relativeAgo(now + 5_000, now)).toEqual({ value: 0, unit: 'minute' })
  })
})
