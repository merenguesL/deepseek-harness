/**
 * Chart building blocks of the usage section: the single stacked composition
 * bar with hover detail, the prompt cache-rate bar, and the SVG trend chart
 * (stacked buckets, 7-day trailing average, peak marker, hover tooltip, and
 * the day/week/month rollup toggle). All presentation; data arrives through
 * props, colors through CSS custom properties.
 */

import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { UsageTokenBuckets } from './report-types.ts'
import {
  bucketKeyLabel, compactTokens, formatPercent, formatTokens, peakIndexOf,
  periodDelta, rollup, trailingAverage, type Granularity,
} from './usage-math.ts'
import type { UsageDayBucket } from './report-types.ts'
import type { UsageKey } from './locales.ts'
import css from './UsageSection.module.css'

/* v8 ignore next -- css-module lookups are static strings; the fallback satisfies the indexed-access type */
const cls = (name: string): string => css[name] ?? ''

type T = (key: UsageKey) => string

/** One tooltip row: colored dot, name, exact value, optional trailing text. */
export interface TooltipRow {
  name: string
  value: string
  color: string
  trailing?: string
}

/** A positioned tooltip card; the caller owns the anchor styles. */
export function ChartTooltip(props: { title: string; rows: readonly TooltipRow[]; style: React.CSSProperties }): ReactNode {
  return (
    <div className={css.tooltip} style={props.style} role="tooltip">
      <div className={css.tooltipTitle}>{props.title}</div>
      {props.rows.map(row => (
        <div key={row.name} className={css.tooltipRow}>
          <span className={css.tooltipRowName}>
            <span className={css.tooltipDot} style={{ background: row.color }} />
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
  { key: 'uncachedInputTokens', labelKey: 'inputTokensFull', colorClass: css.segInput ?? '', color: 'var(--usage-input)' },
  { key: 'cacheReadTokens', labelKey: 'cacheRead', colorClass: css.segCacheRead ?? '', color: 'var(--usage-cache-read)' },
  { key: 'cacheWriteTokens', labelKey: 'cacheWrite', colorClass: css.segCacheWrite ?? '', color: 'var(--usage-cache-write)' },
  { key: 'outputTokens', labelKey: 'outputTokens', colorClass: css.segOutput ?? '', color: 'var(--usage-output)' },
]

/** Exact token figures of one buckets object, in billing order. */
function bucketRows(buckets: UsageTokenBuckets, t: T, total: number): TooltipRow[] {
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
            onMouseEnter={() => { setHovered(segment.index) }}
            onMouseLeave={() => { setHovered(null) }}
          />
        ))}
      </div>
      <div className={css.legend}>
        {segments.map(segment => (
          <span
            key={segment.key}
            className={css.legendItem}
            onMouseEnter={() => { setHovered(segment.index) }}
            onMouseLeave={() => { setHovered(null) }}
          >
            <span className={css.swatch} style={{ background: segment.color }} />
            {t(segment.labelKey)}
            <span className={css.legendPercent}>{formatPercent(segment.width / 100)}</span>
          </span>
        ))}
      </div>
      {hovered !== null && (() => {
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
      <div className={css.bar} onMouseEnter={() => { setHovered(true) }} onMouseLeave={() => { setHovered(false) }}>
        <div className={cls('segment') + ' ' + cls('segCacheRead')} style={{ width: `${rate * 100}%` }} />
        <div className={cls('segment') + ' ' + cls('segMiss')} style={{ width: `${(1 - rate) * 100}%` }} />
      </div>
      <div className={css.legend}>
        <span className={css.legendItem}>
          <span className={css.swatch} style={{ background: 'var(--usage-cache-read)' }} />
          {t('cacheRead')}
          <span className={css.legendPercent}>{formatPercent(rate)}</span>
        </span>
        <span className={css.legendItem}>
          <span className={css.swatch} style={{ background: 'var(--dsw-alias-label-tertiary)' }} />
          {t('cacheMiss')}
          <span className={css.legendPercent}>{formatPercent(1 - rate)}</span>
        </span>
      </div>
      {hovered && (
        <ChartTooltip
          title={t('cacheRateBar')}
          rows={[
            { name: t('cacheRead'), value: formatTokens(cacheReadTokens), color: 'var(--usage-cache-read)', trailing: formatPercent(rate) },
            { name: t('inputTokens'), value: formatTokens(uncachedInputTokens), color: 'var(--usage-input)' },
            { name: t('cacheWrite'), value: formatTokens(cacheWriteTokens), color: 'var(--usage-cache-write)' },
            { name: t('totalTokens'), value: formatTokens(prompt), color: 'var(--dsw-alias-label-tertiary)' },
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

/**
 * The trend chart: stacked buckets per selected granularity with a 7-day
 * trailing average (day mode), the peak bucket marked, and a hover tooltip
 * per bar showing the exact breakdown.
 */
export function SeriesChart(props: SeriesChartProps): ReactNode {
  const { series, t } = props
  const [granularity, setGranularity] = useState<Granularity>('day')
  const [hovered, setHovered] = useState<number | null>(null)
  const buckets = useMemo(() => rollup(series, granularity), [series, granularity])
  const averages = useMemo(
    () => (granularity === 'day' ? trailingAverage(buckets) : buckets.map(() => null)),
    [buckets, granularity],
  )
  const delta = useMemo(() => periodDelta(buckets, granularity), [buckets, granularity])
  const peak = useMemo(() => peakIndexOf(buckets), [buckets])
  const max = useMemo(() => {
    let highest = 0
    for (const bucket of buckets) highest = Math.max(highest, bucket.totalTokens)
    for (const average of averages) {
      if (average !== null) highest = Math.max(highest, average)
    }
    return niceCeil(highest)
  }, [buckets, averages])

  const slot = PLOT_WIDTH / Math.max(1, buckets.length)
  const barWidth = Math.max(2, slot * 0.66)
  const yOf = (value: number): number => PAD_TOP + PLOT_HEIGHT - (value / max) * PLOT_HEIGHT
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

  const granularityKey = (value: Granularity): UsageKey =>
    value === 'day' ? 'granularityDay' : value === 'week' ? 'granularityWeek' : 'granularityMonth'

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
              className={cls('toggleButton') + (granularity === option ? ' ' + cls('toggleButtonActive') : '')}
              onClick={() => { setGranularity(option) }}
            >
              {t(granularityKey(option))}
            </button>
          ))}
        </div>
        {delta !== null && (
          <span className={css.delta}>
            <span
              className={
                cls('deltaValue') + ' ' +
                (delta.delta > 0.0005 ? cls('deltaUp') : delta.delta < -0.0005 ? cls('deltaDown') : '')
              }
            >
              {delta.delta > 0.0005
                ? t('deltaUp').replace('{delta}', formatPercent(delta.delta, 0))
                : delta.delta < -0.0005
                  ? t('deltaDown').replace('{delta}', formatPercent(-delta.delta, 0))
                  : t('deltaFlat')}
            </span>
          </span>
        )}
      </div>
      <div className={css.chart}>
        <svg
          className={css.chartSvg}
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          role="img"
          aria-label={t('trend')}
        >
          {gridlines.map((fraction) => {
            const y = yOf(max * fraction)
            return (
              <g key={fraction}>
                <line className={css.gridLine} x1={PAD_LEFT} y1={y} x2={WIDTH - PAD_RIGHT} y2={y} />
                <text className={css.axisLabel} x={PAD_LEFT - 5} y={y + 3} textAnchor="end">
                  {compactTokens(max * fraction)}
                </text>
              </g>
            )
          })}
          {buckets.map((bucket, index) => {
            const x = PAD_LEFT + slot * index
            const left = x + (slot - barWidth) / 2
            let offset = 0
            return (
              <g key={bucket.key} onMouseEnter={() => { setHovered(index) }} onMouseLeave={() => { setHovered(null) }}>
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
                <rect x={x} y={PAD_TOP} width={slot} height={PLOT_HEIGHT} fill="transparent" />
              </g>
            )
          })}
          {granularity === 'day' && points.length > 0 && (
            <>
              <path
                className={css.maArea}
                d={`${points.join(' ')} L${PAD_LEFT + slot * (buckets.length - 0.5)},${yOf(0)} L${PAD_LEFT + slot * 0.5},${yOf(0)} Z`}
              />
              <path className={css.maLine} d={points.join(' ')} />
            </>
          )}
          {(() => {
            const peakBucket = buckets[peak]
            /* v8 ignore next -- the block only renders when buckets is non-empty */
            if (peakBucket === undefined) return null
            const peakX = PAD_LEFT + slot * (peak + 0.5)
            return (
              <g>
                <circle
                  className={css.peakMarker}
                  cx={peakX}
                  cy={yOf(peakBucket.totalTokens)}
                  r={3}
                />
                <text
                  className={css.peakLabel}
                  x={peakX}
                  y={yOf(peakBucket.totalTokens) - 7}
                  textAnchor="middle"
                >
                  {t('peak')}
                </text>
              </g>
            )
          })()}
          {buckets.map((bucket, index) => (
            index % labelStep === 0 ? (
              <text key={bucket.key} className={css.axisLabel} x={PAD_LEFT + slot * (index + 0.5)} y={HEIGHT - 6} textAnchor="middle">
                {bucketKeyLabel(bucket.key, granularity)}
              </text>
            ) : null
          ))}
        </svg>
        {hovered !== null && (() => {
          const bucket = buckets[hovered]
          /* v8 ignore next -- hovered indexes an existing bucket */
          if (bucket === undefined) return null
          return (
            <ChartTooltip
              title={bucket.key}
              rows={[
                ...bucketRows(bucket, t, bucket.totalTokens),
                { name: t('totalTokens'), value: formatTokens(bucket.totalTokens), color: 'var(--dsw-alias-label-tertiary)' },
                { name: t('calls'), value: String(bucket.calls), color: 'var(--dsw-alias-label-tertiary)' },
              ]}
              style={{ left: `clamp(10%, ${((hovered + 0.5) / buckets.length) * 100}%, 90%)`, top: 4, transform: 'translateX(-50%)' }}
            />
          )
        })()}
      </div>
      <p className={css.panelHint}>{t('trendHint').replace('{unit}', t(granularityKey(granularity)))}</p>
    </>
  )
}
