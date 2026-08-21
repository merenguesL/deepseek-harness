/**
 * Chart building blocks of the usage section: the single stacked composition
 * bar with hover detail, the prompt cache-rate bar, and the SVG trend chart
 * (stacked buckets per metric, per-bucket cache-rate line, 7-day trailing
 * average, peak marker, hover tooltip, and the granularity / range / metric
 * toggles). All presentation; data arrives through props, colors through CSS
 * custom properties.
 */

import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { UsageContextTotals, UsageTokenBuckets } from './report-types.ts'
import {
  bucketKeyLabel,
  cacheRateSeriesOf,
  compactTokens,
  filterRangeSeries,
  formatPercent,
  formatTokens,
  peakIndexOfMetric,
  periodDelta,
  rollup,
  seriesTotal,
  trailingAverage,
  trailingMetricAverage,
  type Granularity,
  type RolledBucket,
  type TrendRange,
} from './usage-math.ts'
import type { UsageDayBucket } from './report-types.ts'
import type { UsageKey } from './locales.ts'
import css from './UsageSection.module.css'

/* v8 ignore next -- css-module lookups are static strings; the fallback satisfies the indexed-access type */
const cls = (name: string): string => css[name] ?? ''

type T = (key: UsageKey, params?: Record<string, unknown>) => string

/** One tooltip row: colored dot, name, exact value, optional trailing text. */
export interface TooltipRow {
  name: string
  value: string
  color: string
  trailing?: string
}

/** A positioned tooltip card; the caller owns the anchor styles. */
export function ChartTooltip(props: {
  title: string
  rows: readonly TooltipRow[]
  style: React.CSSProperties
}): ReactNode {
  return (
    <div className={css.tooltip} style={props.style} role="tooltip">
      <div className={css.tooltipTitle}>{props.title}</div>
      {props.rows.map(row => (
        <div key={row.name} className={css.tooltipRow}>
          <span className={css.tooltipRowName}>
            <span
              className={css.tooltipDot}
              style={{ background: row.color }}
            />
            {row.name}
          </span>
          <span className={css.tooltipValue}>
            {row.value}
            {row.trailing === undefined ? '' : ' (' + row.trailing + ')'}
          </span>
        </div>
      ))}
    </div>
  )
}

/** The four billing buckets with their fixed display colors. */
export interface UsageSegment {
  key: keyof UsageTokenBuckets
  labelKey: UsageKey
  colorClass: string
  color: string
}

// css-module class lookups are static strings at runtime; the `?? ''` fallback only satisfies the indexed-access type.
/* v8 ignore next -- see above */
export const SEGMENTS: readonly UsageSegment[] = [
  {
    key: 'uncachedInputTokens',
    labelKey: 'inputTokensFull',
    colorClass: css.segInput ?? '',
    color: 'var(--usage-input)',
  },
  {
    key: 'cacheReadTokens',
    labelKey: 'cacheRead',
    colorClass: css.segCacheRead ?? '',
    color: 'var(--usage-cache-read)',
  },
  {
    key: 'cacheWriteTokens',
    labelKey: 'cacheWrite',
    colorClass: css.segCacheWrite ?? '',
    color: 'var(--usage-cache-write)',
  },
  {
    key: 'outputTokens',
    labelKey: 'outputTokens',
    colorClass: css.segOutput ?? '',
    color: 'var(--usage-output)',
  },
]

/** Exact token figures of one buckets object, in billing order. */
function bucketRows(
  buckets: UsageTokenBuckets,
  t: T,
  total: number,
): TooltipRow[] {
  return SEGMENTS.map(segment => ({
    name: t(segment.labelKey),
    value: formatTokens(buckets[segment.key]),
    color: segment.color,
    trailing: formatPercent(buckets[segment.key] / total),
  }))
}

interface CompositionBarProps {
  buckets: UsageTokenBuckets
  total: number
  t: T
}

/**
 * The single percentage bar the usage section leads with: every request's
 * tokens split into the four billing buckets, each segment sized by its
 * share and hovering a segment reveals its exact numbers.
 */
export function CompositionBar(props: CompositionBarProps): ReactNode {
  const { buckets, total, t } = props
  const [hovered, setHovered] = useState<number | null>(null)
  if (total === 0) return null
  let cursor = 0
  const segments = SEGMENTS.map((segment, index) => {
    const width = (buckets[segment.key] / total) * 100
    const start = cursor
    cursor += width
    return { ...segment, index, width, start }
  })
  return (
    <div className={css.composition}>
      <div className={css.bar}>
        {segments.map(segment => (
          <div
            key={segment.key}
            className={cls('segment') + ' ' + segment.colorClass}
            style={{ width: `${segment.width}%` }}
            onMouseEnter={() => {
              setHovered(segment.index)
            }}
            onMouseLeave={() => {
              setHovered(null)
            }}
          />
        ))}
      </div>
      <div className={css.legend}>
        {segments.map(segment => (
          <span
            key={segment.key}
            className={css.legendItem}
            onMouseEnter={() => {
              setHovered(segment.index)
            }}
            onMouseLeave={() => {
              setHovered(null)
            }}
          >
            <span
              className={css.swatch}
              style={{ background: segment.color }}
            />
            {t(segment.labelKey)}
            <span className={css.legendPercent}>
              {formatPercent(segment.width / 100)}
            </span>
          </span>
        ))}
      </div>
      {hovered !== null &&
        (() => {
          const hoveredSegment = segments[hovered]
          /* v8 ignore next -- hovered is a segment index, so the lookup always lands */
          if (hoveredSegment === undefined) return null
          const rows = bucketRows(buckets, t, total).map((row, index) => {
            if (index !== hovered) return row
            const { trailing: _trailing, ...rest } = row
            // bucketRows always sets trailing; the fallback satisfies the type.
            /* v8 ignore next -- see above */
            return { ...rest, value: row.value + ' · ' + (row.trailing ?? '') }
          })
          return (
            <ChartTooltip
              title={t('totalTokens')}
              rows={rows}
              style={{
                left: `clamp(8%, ${hoveredSegment.start + hoveredSegment.width / 2}%, 92%)`,
                top: 26,
                transform: 'translateX(-50%)',
              }}
            />
          )
        })()}
    </div>
  )
}

interface CacheRateBarProps {
  uncachedInputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  t: T
}

/**
 * The prompt cache-rate single bar: cache-read tokens filled green against
 * the rest of prompt traffic, with exact figures on hover.
 */
export function CacheRateBar(props: CacheRateBarProps): ReactNode {
  const { uncachedInputTokens, cacheReadTokens, cacheWriteTokens, t } = props
  const [hovered, setHovered] = useState(false)
  const prompt = uncachedInputTokens + cacheReadTokens + cacheWriteTokens
  if (prompt === 0) return null
  const rate = cacheReadTokens / prompt
  return (
    <div className={css.composition}>
      <div
        className={css.bar}
        onMouseEnter={() => {
          setHovered(true)
        }}
        onMouseLeave={() => {
          setHovered(false)
        }}
      >
        <div
          className={cls('segment') + ' ' + cls('segCacheRead')}
          style={{ width: `${rate * 100}%` }}
        />
        <div
          className={cls('segment') + ' ' + cls('segMiss')}
          style={{ width: `${(1 - rate) * 100}%` }}
        />
      </div>
      <div className={css.legend}>
        <span className={css.legendItem}>
          <span
            className={css.swatch}
            style={{ background: 'var(--usage-cache-read)' }}
          />
          {t('cacheRead')}
          <span className={css.legendPercent}>{formatPercent(rate)}</span>
        </span>
        <span className={css.legendItem}>
          <span
            className={css.swatch}
            style={{ background: 'var(--dsw-alias-label-tertiary)' }}
          />
          {t('cacheMiss')}
          <span className={css.legendPercent}>{formatPercent(1 - rate)}</span>
        </span>
      </div>
      {hovered && (
        <ChartTooltip
          title={t('cacheRateBar')}
          rows={[
            {
              name: t('cacheRead'),
              value: formatTokens(cacheReadTokens),
              color: 'var(--usage-cache-read)',
              trailing: formatPercent(rate),
            },
            {
              name: t('inputTokens'),
              value: formatTokens(uncachedInputTokens),
              color: 'var(--usage-input)',
            },
            {
              name: t('cacheWrite'),
              value: formatTokens(cacheWriteTokens),
              color: 'var(--usage-cache-write)',
            },
            {
              name: t('totalTokens'),
              value: formatTokens(prompt),
              color: 'var(--dsw-alias-label-tertiary)',
            },
          ]}
          style={{ left: '50%', top: 26, transform: 'translateX(-50%)' }}
        />
      )}
    </div>
  )
}

interface SeriesChartProps {
  /** Ascending local-day buckets from the plugin report (rolled internally). */
  series: readonly UsageDayBucket[]
  t: T
}

const WIDTH = 560
const HEIGHT = 190
const PAD_LEFT = 38
const PAD_RIGHT = 10
const PAD_TOP = 12
const PAD_BOTTOM = 22
const PLOT_WIDTH = WIDTH - PAD_LEFT - PAD_RIGHT
const PLOT_HEIGHT = HEIGHT - PAD_TOP - PAD_BOTTOM

/** Round a max upward to a legible axis ceiling (1/2/2.5/5 x 10^k). */
function niceCeil(value: number): number {
  if (value <= 0) return 1
  const power = 10 ** Math.floor(Math.log10(value))
  for (const factor of [1, 2, 2.5, 5, 10]) {
    const candidate = factor * power
    if (candidate >= value) return candidate
  }
  /* v8 ignore next -- the 10x factor always satisfies a positive value bounded by 10^floor(log10(value))+1 */
  return 10 * power
}

/** The quantity the trend chart plots per bucket. */
export type TrendMetric = 'total' | 'output' | 'rate'

/** Read the plotted token quantity of one bucket (rate mode plots a ratio instead). */
function metricValueOf(metric: TrendMetric, bucket: RolledBucket): number {
  return metric === 'output' ? bucket.outputTokens : bucket.totalTokens
}

/**
 * The trend chart: stacked buckets per selected granularity and metric, with
 * a 7-day trailing average (token metrics in day mode), the peak bucket
 * marked, a trailing range filter, and a hover tooltip per bar showing the
 * exact breakdown. Rate mode plots the per-bucket cache hit rate as a line
 * against a fixed 0-100% axis.
 */
export function SeriesChart(props: SeriesChartProps): ReactNode {
  const { series, t } = props
  const [granularity, setGranularity] = useState<Granularity>('day')
  const [range, setRange] = useState<TrendRange>('all')
  const [metric, setMetric] = useState<TrendMetric>('total')
  const [hovered, setHovered] = useState<number | null>(null)
  const visible = useMemo(
    () => filterRangeSeries(series, range),
    [series, range],
  )
  const buckets = useMemo(
    () => rollup(visible, granularity),
    [visible, granularity],
  )
  const rates = useMemo(
    () => (metric === 'rate' ? cacheRateSeriesOf(buckets) : buckets.map(() => null)),
    [buckets, metric],
  )
  const averages = useMemo(() => {
    if (granularity !== 'day' || metric === 'rate') return buckets.map(() => null)
    return metric === 'output'
      ? trailingMetricAverage(buckets, bucket => bucket.outputTokens)
      : trailingAverage(buckets)
  }, [buckets, granularity, metric])
  const delta = useMemo(
    () => (metric === 'total' ? periodDelta(buckets, granularity) : null),
    [buckets, granularity, metric],
  )
  const peak = useMemo(
    () =>
      metric === 'rate'
        ? -1
        : peakIndexOfMetric(buckets, bucket => metricValueOf(metric, bucket)),
    [buckets, metric],
  )
  const max = useMemo(() => {
    if (metric === 'rate') return 1
    let highest = 0
    for (const bucket of buckets)
      highest = Math.max(highest, metricValueOf(metric, bucket))
    for (const average of averages) {
      if (average !== null) highest = Math.max(highest, average)
    }
    return niceCeil(highest)
  }, [buckets, averages, metric])

  const slot = PLOT_WIDTH / Math.max(1, buckets.length)
  const barWidth = Math.max(2, slot * 0.66)
  const yOf = (value: number): number =>
    PAD_TOP + PLOT_HEIGHT - (value / max) * PLOT_HEIGHT
  const gridlines = [0, 0.25, 0.5, 0.75, 1]
  const labelStep = Math.max(1, Math.ceil(buckets.length / 6))

  const points: string[] = []
  let started = false
  averages.forEach((average, index) => {
    if (average === null) return
    const x = PAD_LEFT + slot * (index + 0.5)
    points.push(`${started ? 'L' : 'M'}${x},${yOf(average)}`)
    started = true
  })
  const ratePoints: string[] = []
  let rateStarted = false
  rates.forEach((rate, index) => {
    if (rate === null) {
      rateStarted = false
      return
    }
    const x = PAD_LEFT + slot * (index + 0.5)
    ratePoints.push(`${rateStarted ? 'L' : 'M'}${x},${yOf(rate)}`)
    rateStarted = true
  })

  const granularityKey = (value: Granularity): UsageKey =>
    value === 'day'
      ? 'granularityDay'
      : value === 'week'
        ? 'granularityWeek'
        : 'granularityMonth'
  const metricKey = (value: TrendMetric): UsageKey =>
    value === 'total'
      ? 'metricTotal'
      : value === 'output'
        ? 'metricOutput'
        : 'metricRate'
  const RANGES: readonly TrendRange[] = ['all', 7, 30, 90]
  const rangeKey = (value: TrendRange): string =>
    value === 'all'
      ? t('rangeAll')
      : t('rangeDays', { days: value })

  return (
    <>
      <div className={css.trendToolbar}>
        <div className={css.toggle} role="tablist" aria-label={t('trend')}>
          {(['day', 'week', 'month'] as const).map(option => (
            <button
              key={option}
              type="button"
              role="tab"
              aria-selected={granularity === option}
              className={
                cls('toggleButton') +
                (granularity === option ? ' ' + cls('toggleButtonActive') : '')
              }
              onClick={() => {
                setGranularity(option)
              }}
            >
              {t(granularityKey(option))}
            </button>
          ))}
        </div>
        <div
          className={css.toggle}
          role="radiogroup"
          aria-label={t('trendRange')}
        >
          {RANGES.map(option => (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={range === option}
              className={
                cls('toggleButton') +
                (range === option ? ' ' + cls('toggleButtonActive') : '')
              }
              onClick={() => {
                setRange(option)
              }}
            >
              {rangeKey(option)}
            </button>
          ))}
        </div>
        {delta !== null && (
          <span className={css.delta}>
            <span
              className={
                cls('deltaValue') +
                ' ' +
                (delta.delta > 0.0005
                  ? cls('deltaUp')
                  : delta.delta < -0.0005
                    ? cls('deltaDown')
                    : '')
              }
            >
              {delta.delta > 0.0005
                ? t('deltaUp', { delta: formatPercent(delta.delta, 0) })
                : delta.delta < -0.0005
                  ? t('deltaDown', { delta: formatPercent(-delta.delta, 0) })
                  : t('deltaFlat')}
            </span>
          </span>
        )}
        <div className={css.toggle} role="radiogroup" aria-label={t('metric')}>
          {(['total', 'output', 'rate'] as const).map(option => (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={metric === option}
              className={
                cls('toggleButton') +
                (metric === option ? ' ' + cls('toggleButtonActive') : '')
              }
              onClick={() => {
                setMetric(option)
              }}
            >
              {t(metricKey(option))}
            </button>
          ))}
        </div>
      </div>
      <div className={css.chart}>
        <svg
          className={css.chartSvg}
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          role="img"
          aria-label={t('trend') + ' · ' + t(metricKey(metric))}
        >
          {gridlines.map((fraction) => {
            const y = yOf(max * fraction)
            return (
              <g key={fraction}>
                <line
                  className={css.gridLine}
                  x1={PAD_LEFT}
                  y1={y}
                  x2={WIDTH - PAD_RIGHT}
                  y2={y}
                />
                <text
                  className={css.axisLabel}
                  x={PAD_LEFT - 5}
                  y={y + 3}
                  textAnchor="end"
                >
                  {metric === 'rate'
                    ? formatPercent(max * fraction, 0)
                    : compactTokens(max * fraction)}
                </text>
              </g>
            )
          })}
          {metric !== 'rate' &&
            buckets.map((bucket, index) => {
              const x = PAD_LEFT + slot * index
              const left = x + (slot - barWidth) / 2
              let offset = 0
              return (
                <g
                  key={bucket.key}
                  onMouseEnter={() => {
                    setHovered(index)
                  }}
                  onMouseLeave={() => {
                    setHovered(null)
                  }}
                >
                  {SEGMENTS.map((segment) => {
                    const height = (bucket[segment.key] / max) * PLOT_HEIGHT
                    const rect = (
                      <rect
                        key={segment.key}
                        x={left}
                        y={yOf(offset + bucket[segment.key])}
                        width={barWidth}
                        height={Math.max(0, height)}
                        fill={segment.color}
                      />
                    )
                    offset += bucket[segment.key]
                    return rect
                  })}
                  <rect
                    x={x}
                    y={PAD_TOP}
                    width={slot}
                    height={PLOT_HEIGHT}
                    fill="transparent"
                  />
                </g>
              )
            })}
          {metric === 'rate' &&
            buckets.map((bucket, index) => (
              <rect
                key={bucket.key}
                x={PAD_LEFT + slot * index}
                y={PAD_TOP}
                width={slot}
                height={PLOT_HEIGHT}
                fill="transparent"
                onMouseEnter={() => {
                  setHovered(index)
                }}
                onMouseLeave={() => {
                  setHovered(null)
                }}
              />
            ))}
          {granularity === 'day' && points.length > 0 && (
            <>
              <path
                className={css.maArea}
                d={`${points.join(' ')} L${PAD_LEFT + slot * (buckets.length - 0.5)},${yOf(0)} L${PAD_LEFT + slot * 0.5},${yOf(0)} Z`}
              />
              <path className={css.maLine} d={points.join(' ')} />
            </>
          )}
          {metric === 'rate' && ratePoints.length > 0 && (
            <path className={css.rateLine} d={ratePoints.join(' ')} />
          )}
          {(() => {
            const peakBucket = buckets[peak]
            /* v8 ignore next -- peak is -1 in rate mode and an existing index otherwise */
            if (peakBucket === undefined) return null
            const peakValue = metricValueOf(metric, peakBucket)
            const peakX = PAD_LEFT + slot * (peak + 0.5)
            return (
              <g>
                <circle
                  className={css.peakMarker}
                  cx={peakX}
                  cy={yOf(peakValue)}
                  r={3}
                />
                <text
                  className={css.peakLabel}
                  x={peakX}
                  y={yOf(peakValue) - 7}
                  textAnchor="middle"
                >
                  {t('peak')}
                </text>
              </g>
            )
          })()}
          {buckets.map((bucket, index) =>
            index % labelStep === 0 ? (
              <text
                key={bucket.key}
                className={css.axisLabel}
                x={PAD_LEFT + slot * (index + 0.5)}
                y={HEIGHT - 6}
                textAnchor="middle"
              >
                {bucketKeyLabel(bucket.key, granularity)}
              </text>
            ) : null,
          )}
        </svg>
        {hovered !== null &&
          (() => {
            const bucket = buckets[hovered]
            /* v8 ignore next -- hovered indexes an existing bucket */
            if (bucket === undefined) return null
            const rate = rates[hovered]
            const rateRow: TooltipRow | null =
              metric === 'rate' && rate !== null && rate !== undefined
                ? {
                  name: t('metricRate'),
                  value: formatPercent(rate),
                  color: 'var(--usage-cache-read)',
                }
                : null
            return (
              <ChartTooltip
                title={bucket.key}
                rows={[
                  ...(rateRow === null ? [] : [rateRow]),
                  ...bucketRows(bucket, t, bucket.totalTokens),
                  {
                    name: t('totalTokens'),
                    value: formatTokens(bucket.totalTokens),
                    color: 'var(--dsw-alias-label-tertiary)',
                  },
                  {
                    name: t('calls'),
                    value: String(bucket.calls),
                    color: 'var(--dsw-alias-label-tertiary)',
                  },
                ]}
                style={{
                  left: `clamp(10%, ${((hovered + 0.5) / buckets.length) * 100}%, 90%)`,
                  top: 4,
                  transform: 'translateX(-50%)',
                }}
              />
            )
          })()}
      </div>
      {range !== 'all' &&
        (() => {
          const sum = seriesTotal(visible)
          return (
            <p className={css.rangeSummary}>
              {t('rangeSummary', {
                days: range,
                tokens: formatTokens(sum.tokens),
                calls: sum.calls,
              })}
            </p>
          )
        })()}
      <p className={css.panelHint}>
        {metric === 'rate'
          ? t('trendRateHint', { unit: t(granularityKey(granularity)) })
          : t('trendHint', { unit: t(granularityKey(granularity)) })}
      </p>
    </>
  )
}

interface ContextBarProps {
  totals: UsageContextTotals
  t: T
}

/** Display segments of the heuristic context composition, in stack order. */
/* v8 ignore next 3 -- css-module lookups are static strings; the fallbacks satisfy the indexed-access type */
const CONTEXT_SEGMENTS: readonly { key: keyof UsageContextTotals; labelKey: UsageKey; color: string; colorClass: string }[] = [
  { key: 'systemTokens', labelKey: 'contextSystem', color: 'var(--usage-input)', colorClass: css.segInput ?? '' },
  { key: 'toolsTokens', labelKey: 'contextTools', color: 'var(--usage-cache-write)', colorClass: css.segCacheWrite ?? '' },
  { key: 'messageTokens', labelKey: 'contextMessages', color: 'var(--usage-output)', colorClass: css.segOutput ?? '' },
]

/**
 * The heuristic context-composition bar: system prompt, tool schemas, and
 * conversation tokens summed over sessions that carry the estimator value,
 * each segment sized by share with exact numbers on hover.
 */
export function ContextBar(props: ContextBarProps): ReactNode {
  const { totals, t } = props
  const [hovered, setHovered] = useState<number | null>(null)
  const total = totals.systemTokens + totals.toolsTokens + totals.messageTokens
  if (totals.sessions === 0 || total === 0) {
    return <p className={css.panelHint}>{t('contextEmpty')}</p>
  }
  let cursor = 0
  const segments = CONTEXT_SEGMENTS.map((segment, index) => {
    const value = totals[segment.key]
    const width = (value / total) * 100
    const start = cursor
    cursor += width
    return { ...segment, index, width, start, value }
  })
  return (
    <div className={css.composition}>
      <div className={css.bar}>
        {segments.map(segment => (
          <div
            key={segment.key}
            className={cls('segment') + ' ' + segment.colorClass}
            style={{ width: `${segment.width}%` }}
            onMouseEnter={() => {
              setHovered(segment.index)
            }}
            onMouseLeave={() => {
              setHovered(null)
            }}
          />
        ))}
      </div>
      <div className={css.legend}>
        {segments.map(segment => (
          <span
            key={segment.key}
            className={css.legendItem}
            onMouseEnter={() => {
              setHovered(segment.index)
            }}
            onMouseLeave={() => {
              setHovered(null)
            }}
          >
            <span className={css.swatch} style={{ background: segment.color }} />
            {t(segment.labelKey)}
            <span className={css.legendPercent}>{formatPercent(segment.width / 100)}</span>
          </span>
        ))}
      </div>
      <p className={css.panelHint}>{t('contextSessions', { n: totals.sessions })}</p>
      {hovered !== null &&
        (() => {
          const hoveredSegment = segments[hovered]
          /* v8 ignore next -- hovered is a segment index, so the lookup always lands */
          if (hoveredSegment === undefined) return null
          return (
            <ChartTooltip
              title={t('contextPanel')}
              rows={segments.map(segment =>
                segment.index === hovered
                  ? {
                    name: t(segment.labelKey),
                    value: formatTokens(segment.value),
                    color: segment.color,
                  }
                  : {
                    name: t(segment.labelKey),
                    value: formatTokens(segment.value),
                    color: segment.color,
                    trailing: formatPercent(segment.width / 100),
                  })}
              style={{
                left: `clamp(8%, ${hoveredSegment.start + hoveredSegment.width / 2}%, 92%)`,
                top: 26,
                transform: 'translateX(-50%)',
              }}
            />
          )
        })()}
    </div>
  )
}
