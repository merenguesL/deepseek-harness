/**
 * Hour-of-day activity heatmap: 24 hour columns by 7 weekday rows (Monday
 * first, matching the shipped calendar conventions), each cell's opacity
 * scaled by its share of the busiest cell. Hovering a cell reveals its
 * exact tokens, share of the report, and known-call count; the busiest cell
 * is ringed and captioned under the legend.
 */

import { useState } from 'react'
import type { ReactNode } from 'react'
import type { UsageHeatmap, UsageHeatmapCalls } from './report-types.ts'
import { busiestCellOf, formatPercent, formatTokens } from './usage-math.ts'
import type { UsageKey } from './locales.ts'
import { ChartTooltip } from './charts.tsx'
import css from './UsageSection.module.css'

type T = (key: UsageKey, params?: Record<string, unknown>) => string

/** Ramp stops for the low-to-high legend, darkest = busiest. */
const RAMP = [0.1, 0.3, 0.55, 0.8, 1]

interface HeatmapProps {
  heatmap: UsageHeatmap
  /** Parallel known-call counts per cell (same indexing). */
  calls: UsageHeatmapCalls
  /** Whole-report token total for the per-cell share row. */
  total: number
  /** Row order of weekday labels: index 0 = Monday (exactly seven). */
  weekdayLabels: readonly [
    string,
    string,
    string,
    string,
    string,
    string,
    string,
  ]
  t: T
}

const HOURS = Array.from({ length: 24 }, (_, hour) => hour)
/* v8 ignore next -- css-module lookups are static strings; the fallback satisfies the indexed-access type */
const cls = (name: string): string => css[name] ?? ''
/** Display rows 0-6 (Monday first); literal indexes make the label tuple index safe. */
const ROWS = [0, 1, 2, 3, 4, 5, 6] as const

/**
 * The heatmap grid. Server cells are indexed weekday 0=Sunday; the client
 * reorders rows to Monday-first for display. Hour labels render every third
 * hour so the axis stays legible at panel width.
 */
export function Heatmap(props: HeatmapProps): ReactNode {
  const { heatmap, calls, total, weekdayLabels, t } = props
  const [hovered, setHovered] = useState<{
    hour: number
    label: string
  } | null>(null)
  let max = 0
  for (const row of heatmap) {
    for (const value of row) max = Math.max(max, value)
  }
  if (max === 0) {
    return <p className={css.panelHint}>{t('heatmapEmpty')}</p>
  }
  const cellFor = (hour: number, displayRow: number): number => {
    const weekday = (displayRow + 1) % 7
    // The wire schema pins 24x7 cells; the fallback only satisfies the type.
    /* v8 ignore next -- see above */
    return heatmap[hour]?.[weekday] ?? 0
  }
  const callsFor = (hour: number, displayRow: number): number => {
    const weekday = (displayRow + 1) % 7
    /* v8 ignore next -- see above */
    return calls[hour]?.[weekday] ?? 0
  }
  const peak = busiestCellOf(heatmap)
  return (
    <div>
      <div className={css.heatmapWrap}>
        <div className={css.heatmapDays}>
          {weekdayLabels.map(label => (
            <span key={label}>{label}</span>
          ))}
        </div>
        <div className={css.heatmapGrid}>
          <div className={css.heatmapHours}>
            {HOURS.map(hour => (
              <span key={hour}>{hour % 3 === 0 ? hour : ''}</span>
            ))}
          </div>
          {ROWS.map(row =>
            HOURS.map((hour) => {
              const value = cellFor(hour, row)
              const isPeak =
                peak !== null
                && peak.hour === hour
                && peak.weekday === (row + 1) % 7
              return (
                <button
                  key={row * 24 + hour}
                  type="button"
                  tabIndex={-1}
                  className={
                    cls('cell')
                    + (value > 0 ? ' ' + cls('cellHot') : '')
                    + (isPeak ? ' ' + cls('cellPeak') : '')
                  }
                  style={{
                    opacity:
                      value === 0 ? undefined : 0.08 + 0.92 * (value / max),
                  }}
                  onMouseEnter={() => {
                    setHovered({ hour, label: weekdayLabels[row] })
                  }}
                  onMouseLeave={() => {
                    setHovered(null)
                  }}
                  aria-label={t('heatmapCell', {
                    weekday: weekdayLabels[row],
                    hour,
                    tokens: formatTokens(value),
                  })}
                />
              )
            }),
          )}
        </div>
      </div>
      <div className={css.heatmapLegend}>
        <span>{t('heatmapLow')}</span>
        <span className={css.heatmapRamp}>
          {RAMP.map(step => (
            <span
              key={step}
              className={css.heatmapRampCell}
              style={{ background: 'var(--usage-input)', opacity: step }}
            />
          ))}
        </span>
        <span>{t('heatmapHigh')}</span>
        {peak !== null && (
          <span className={css.heatmapPeak}>
            {t('heatmapPeak', {
              // Exactly seven labels ship in both dictionaries; the fallback
              // only satisfies the indexed-access type.
              /* v8 ignore next -- see above */
              weekday:
                weekdayLabels[(peak.weekday + 6) % 7] ?? '',
              hour: peak.hour,
            })}
          </span>
        )}
      </div>
      {hovered !== null &&
        (() => {
          const displayRow = weekdayLabels.indexOf(hovered.label)
          const value = cellFor(hovered.hour, displayRow)
          if (value === 0) return null
          return (
            <ChartTooltip
              title={t('heatmapCell', {
                weekday: hovered.label,
                hour: hovered.hour,
                tokens: formatTokens(value),
              })}
              rows={[
                {
                  name: t('totalTokens'),
                  value: formatTokens(value),
                  color: 'var(--usage-input)',
                },
                {
                  name: t('shareOfTotal'),
                  value: formatPercent(total === 0 ? 0 : value / total),
                  color: 'var(--usage-input)',
                },
                {
                  name: t('calls'),
                  value: String(callsFor(hovered.hour, displayRow)),
                  color: 'var(--dsw-alias-label-tertiary)',
                },
              ]}
              style={{ left: '50%', top: 190, transform: 'translateX(-50%)' }}
            />
          )
        })()}
    </div>
  )
}
