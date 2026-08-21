import { describe, expect, it } from 'vitest'
import type {
  UsageDayBucket,
  UsageDescribeValue,
  UsageSessionRow,
  UsageTotals,
} from '../src/client/report-types.ts'
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
  busiestCellOf,
  busiestDayOf,
  cacheRateSeriesOf,
  contextFillOf,
  dayBucketOf,
  insightsOf,
  peakIndexOfMetric,
  streakOf,
  subagentShareOf,
  toSessionsCsv,
  trailingMetricAverage,
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

describe('context and recency math', () => {
  it('derives context fill from the occupancy projection value', () => {
    expect(
      contextFillOf({ pressureTokens: 150, projectedTokens: 160, contextWindow: 200 }),
    ).toBeCloseTo(0.8)
    expect(
      contextFillOf({ pressureTokens: 50, projectedTokens: null, contextWindow: 200 }),
    ).toBeCloseTo(0.25)
    expect(
      contextFillOf({ pressureTokens: 50, projectedTokens: null, contextWindow: null }),
    ).toBeNull()
  })

  it('returns a zero fill when the occupancy value carries no numerator', () => {
    expect(
      contextFillOf({ pressureTokens: null, projectedTokens: null, contextWindow: 200 }),
    ).toBe(0)
  })

  it('counts the unbroken recent daily streak across today gaps', () => {
    const now = Date.parse('2026-07-14T10:00:00')
    const today = dayKeyOf(now)
    const yesterday = addDays(today, -1)
    const before = addDays(today, -2)
    // Today active: the streak counts today plus yesterday's run.
    expect(streakOf([day(before), day(yesterday), day(today)], now)).toBe(3)
    // Today empty but yesterday alive: the run survives.
    expect(streakOf([day(before), day(yesterday)], now)).toBe(2)
    // A gap before yesterday breaks the run.
    expect(streakOf([day(before)], now)).toBe(0)
  })

  it('finds the busiest day and heatmap cell', () => {
    const series = [day('2026-07-01', 100), day('2026-07-02', 900), day('2026-07-03', 300)]
    expect(busiestDayOf(series)).toMatchObject({ day: '2026-07-02', totalTokens: 900 })
    expect(busiestDayOf([])).toBeNull()
    const cells = Array.from({ length: 24 }, () => Array.from({ length: 7 }, () => 0))
    cells[21]![2] = 500
    expect(busiestCellOf(cells)).toEqual({ hour: 21, weekday: 2, tokens: 500 })
    expect(
      busiestCellOf(Array.from({ length: 24 }, () => Array.from({ length: 7 }, () => 0))),
    ).toBeNull()
  })

  it('derives the subagent share and reads one day bucket', () => {
    const zero: UsageTotals = {
      uncachedInputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 0,
      promptTokens: 0,
      cacheRate: 0,
      calls: 0,
      sessions: 0,
      measuredSessions: 0,
      turns: 0,
      steps: 0,
      llmMs: 0,
      firstActivityAt: null,
      lastActivityAt: null,
      subagentTokens: 0,
      subagentSessions: 0,
      activeDays: 0,
      contextSessions: 0,
      nearLimitSessions: 0,
    }
    expect(subagentShareOf(zero)).toBe(0)
    expect(
      subagentShareOf({ ...zero, totalTokens: 200, subagentTokens: 50 }),
    ).toBeCloseTo(0.25)
    const series = [day('2026-07-01', 100), day('2026-07-02', 200)]
    expect(dayBucketOf(series, '2026-07-02')).toMatchObject({ totalTokens: 200 })
    expect(dayBucketOf(series, '2026-07-09')).toBeNull()
  })

  it('marks buckets without prompt traffic as rateless', () => {
    const empty = rollup([day('2026-07-01', 0, {
      uncachedInputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    })], 'day')
    expect(cacheRateSeriesOf(empty)).toEqual([null])
  })

  it('computes per-bucket cache rates and metric peaks', () => {
    const buckets = rollup(
      [
        day('2026-07-01', 100),
        day('2026-07-02', 300, { outputTokens: 40, cacheWriteTokens: 0 }),
      ],
      'day',
    )
    const rates = cacheRateSeriesOf(buckets)
    expect(rates[0]).toBeCloseTo(0.75)
    expect(rates[1]).toBeCloseTo(60 / 70)
    expect(peakIndexOfMetric(buckets, bucket => bucket.outputTokens)).toBe(1)
    const averages = trailingMetricAverage(
      buckets,
      bucket => bucket.outputTokens,
      1,
    )
    expect(averages[0]).toBeCloseTo(buckets[0]!.outputTokens)
    expect(averages[1]).toBeCloseTo(buckets[1]!.outputTokens)
  })

  it('localizes compact token units for zh', () => {
    expect(compactTokens(950_000, 'zh')).toBe('95万')
    expect(compactTokens(9_500, 'zh')).toBe('9500')
    expect(compactTokens(123_456_789, 'zh')).toBe('1.2亿')
    expect(compactTokens(9_499, 'zh')).toBe('9499')
    // Non-zh languages keep the k/M/B units.
    expect(compactTokens(9_500, 'en')).toBe('9.5k')
  })
})

describe('insights', () => {
  const weekdayLabels = ['一', '二', '三', '四', '五', '六', '日']
  const totals = (overrides: Partial<UsageTotals> = {}): UsageTotals => ({
    uncachedInputTokens: 200,
    outputTokens: 100,
    cacheReadTokens: 600,
    cacheWriteTokens: 100,
    totalTokens: 1000,
    promptTokens: 900,
    cacheRate: 600 / 900,
    calls: 2,
    sessions: 2,
    measuredSessions: 2,
    turns: 0,
    steps: 0,
    llmMs: 0,
    firstActivityAt: 1,
    lastActivityAt: 2,
    subagentTokens: 0,
    subagentSessions: 0,
    activeDays: 2,
    contextSessions: 0,
    nearLimitSessions: 0,
    ...overrides,
  })

  it('stays empty for a report without prompt traffic or history', () => {
    const value: UsageDescribeValue = {
      totals: totals({ promptTokens: 0, cacheRate: 0 }),
      series: [],
      bySession: [],
      byWorkspace: [],
      heatmap: Array.from({ length: 24 }, () => Array.from({ length: 7 }, () => 0)),
      heatmapCalls: Array.from({ length: 24 }, () => Array.from({ length: 7 }, () => 0)),
      contextTotals: { systemTokens: 0, toolsTokens: 0, messageTokens: 0, sessions: 0 },
      generatedAt: 0,
    }
    expect(insightsOf(value, weekdayLabels, Date.parse('2026-08-12T12:00:00'))).toEqual([])
  })

  it('flags a low cache rate, a rising week, near-limit sessions, and the peak hour', () => {
    const now = Date.parse('2026-08-12T12:00:00')
    const keys = Array.from({ length: 14 }, (_, index) => addDays(dayKeyOf(now), index - 13))
    const value: UsageDescribeValue = {
      totals: totals({
        cacheRate: 0.1,
        nearLimitSessions: 1,
        subagentTokens: 500,
        subagentSessions: 1,
      }),
      // Rising series: the trailing week doubles the previous one.
      series: keys.map((key, index) => day(key, 100 + index * 100)),
      bySession: [],
      byWorkspace: [],
      // Wednesday (2026-08-12) 21:00 carries the densest cell.
      heatmap: Array.from({ length: 24 }, (_, hour) =>
        Array.from({ length: 7 }, (_, weekday) =>
          hour === 21 && weekday === 3 ? 500 : 0),
      ),
      heatmapCalls: Array.from({ length: 24 }, () => Array.from({ length: 7 }, () => 0)),
      contextTotals: { systemTokens: 0, toolsTokens: 0, messageTokens: 0, sessions: 0 },
      generatedAt: now,
    }
    const insights = insightsOf(value, weekdayLabels, now)
    expect(insights.map(insight => insight.key)).toEqual([
      'insightCacheLow',
      'insightWeekUp',
      'insightNearLimit',
      'insightSubagent',
      'insightPeakHour',
    ])
    expect(insights.every(insight => insight.tone !== undefined)).toBe(true)
    expect(insights[2]!.params).toEqual({ n: '1', pct: '80%' })
    expect(insights[4]!.params).toEqual({ weekday: '三', hour: '21' })
  })

  it('flags a falling week', () => {
    const now = Date.parse('2026-08-12T12:00:00')
    const keys = Array.from({ length: 14 }, (_, index) => addDays(dayKeyOf(now), index - 13))
    const value: UsageDescribeValue = {
      totals: totals({ cacheRate: 0.4 }),
      series: keys.map((key, index) => day(key, 10_000 - index * 500)),
      bySession: [],
      byWorkspace: [],
      heatmap: Array.from({ length: 24 }, () => Array.from({ length: 7 }, () => 0)),
      heatmapCalls: Array.from({ length: 24 }, () => Array.from({ length: 7 }, () => 0)),
      contextTotals: { systemTokens: 0, toolsTokens: 0, messageTokens: 0, sessions: 0 },
      generatedAt: now,
    }
    const insights = insightsOf(value, weekdayLabels, now)
    expect(insights.some(insight => insight.key === 'insightWeekDown')).toBe(true)
  })

  it('caps the insight list at five findings', () => {
    const now = Date.parse('2026-08-12T12:00:00')
    const keys = Array.from({ length: 14 }, (_, index) => addDays(dayKeyOf(now), index - 13))
    const cells = Array.from({ length: 24 }, (_, hour) =>
      Array.from({ length: 7 }, (_, weekday) =>
        hour === 8 && weekday === 2 ? 500 : 0),
    )
    const value: UsageDescribeValue = {
      totals: totals({ cacheRate: 0.05, nearLimitSessions: 3, subagentTokens: 500 }),
      series: keys.map((key, index) => day(key, 100 + index * 100)),
      bySession: [],
      byWorkspace: [],
      heatmap: cells,
      heatmapCalls: Array.from({ length: 24 }, () => Array.from({ length: 7 }, () => 0)),
      contextTotals: { systemTokens: 0, toolsTokens: 0, messageTokens: 0, sessions: 0 },
      generatedAt: now,
    }
    expect(insightsOf(value, weekdayLabels, now)).toHaveLength(5)
  })
})

describe('CSV serialization', () => {
  it('serializes session rows as RFC 4180 CSV with a header', () => {
    const row: UsageSessionRow = {
      sessionId: 's1' as UsageSessionRow['sessionId'],
      title: 'Alpha, Beta',
      cwd: '/tmp/x',
      origin: 'subagent',
      agentPreset: 'coder',
      createdAt: 1,
      updatedAt: Date.parse('2026-08-12T08:09:10Z'),
      uncachedInputTokens: 10,
      outputTokens: 20,
      cacheReadTokens: 30,
      cacheWriteTokens: 40,
      totalTokens: 100,
      cacheRate: 0.5,
      calls: 1,
      turns: 0,
      steps: 0,
      measured: true,
      asOfSeq: 3,
      running: false,
      contextPressure: null,
      contextBreakdown: null,
    }
    const csv = toSessionsCsv([row])
    expect(csv.startsWith('sessionId,title,cwd,origin,agentPreset,')).toBe(true)
    expect(csv).toContain('"Alpha, Beta",/tmp/x,subagent,coder,10,20,30,40,100,0.5000,1,1,2026-08-12T08:09:10.000Z')
    expect(csv.endsWith('\r\n')).toBe(true)
  })

  it('doubles embedded quotes and leaves simple fields bare', () => {
    const row: UsageSessionRow = {
      sessionId: 's2' as UsageSessionRow['sessionId'],
      title: 'say "hi"',
      createdAt: 1,
      updatedAt: 2,
      uncachedInputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 0,
      cacheRate: 0,
      calls: 0,
      turns: 0,
      steps: 0,
      measured: false,
      asOfSeq: null,
      running: false,
      contextPressure: null,
      contextBreakdown: null,
    }
    expect(toSessionsCsv([row])).toContain('"say ""hi""",,,')
  })
})
