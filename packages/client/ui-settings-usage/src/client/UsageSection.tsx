/**
 * Usage statistics settings section: a client-only report over visible
 * session-list projections. The page loads on first mount, refreshes on
 * demand, and re-renders from the store snapshot; all rollups, deltas, and
 * formats are pure functions of that report value.
 */

import { useState } from 'react'
import { IconRefreshOutline14 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace } from '@deepseek-ai/dsh-client-ui-slots'
import type { UsageDescribeValue } from './report-types.ts'
import {
  compactTokens,
  formatPercent,
  formatTokens,
  promptTokensOf,
} from './usage-math.ts'
import type { UsageState, UsageStore } from './store.ts'
import type { en } from './locales.ts'
import { CacheRateBar, CompositionBar, SeriesChart } from './charts.tsx'
import { Heatmap } from './heatmap.tsx'
import { Breakdown } from './breakdown.tsx'
import css from './UsageSection.module.css'

/* v8 ignore next -- css-module lookups are static strings; the fallback satisfies the indexed-access type */
const cls = (name: string): string => css[name] ?? ''

/** Injected dependencies of {@link UsageSection} (slot `inject`). */
export interface UsageSectionInjected {
  /** The page store (loaded on first mount, refreshed on demand). */
  controller: UsageStore
  hooks: {
    /** Page snapshot source bound by the UI renderer as useSnapshot. */
    snapshot: UsageStore['store']
  }
  /** Section copy. */
  t: (key: keyof typeof en) => string
}

/** Props delivered by the slot outlet: the inject face spread flat. */
export type UsageSectionProps = Partial<InjectFace<UsageSectionInjected>>

/**
 * Assemble the dashboard's plain-text report for the copy button.
 * @param value - the ready report.
 * @param t - bound section copy.
 * @returns one text block with totals, the daily series, and the top
 * sessions, ready for the clipboard.
 */
export function composeReportText(
  value: UsageDescribeValue,
  t: UsageSectionInjected['t'],
): string {
  const { totals } = value
  const lines = [
    t('title'),
    `${t('totalTokens')}: ${formatTokens(totals.totalTokens)}`,
    `${t('inputTokens')}: ${formatTokens(totals.uncachedInputTokens)}`,
    `${t('outputTokens')}: ${formatTokens(totals.outputTokens)}`,
    `${t('cacheRead')}: ${formatTokens(totals.cacheReadTokens)}`,
    `${t('cacheWrite')}: ${formatTokens(totals.cacheWriteTokens)}`,
    `${t('cacheRate')}: ${formatPercent(totals.cacheRate)} · ${t('calls')}: ${totals.calls} · ${t('sessions')}: ${totals.sessions}`,
  ]
  if (value.series.length > 0) {
    lines.push('', t('granularityDay'))
    for (const bucket of value.series)
      lines.push(`${bucket.day}: ${formatTokens(bucket.totalTokens)}`)
  }
  if (value.bySession.length > 0) {
    lines.push('', t('bySession'))
    for (const row of value.bySession.slice(0, 10)) {
      lines.push(
        `${row.title ?? t('untitledSession')} (${row.cwd ?? t('unknownWorkspace')}): ${formatTokens(row.totalTokens)}`,
      )
    }
  }
  return lines.join('\n')
}

/** One stat card: label, compact value, and an exact-value sub-line. */
function StatCard(props: {
  label: string
  value: string
  sub: string
  rate?: number
}): React.ReactNode {
  return (
    <div className={css.card}>
      <div className={css.cardLabel}>{props.label}</div>
      <div className={css.cardValue} title={props.sub}>
        {props.value}
      </div>
      <div className={css.cardSub}>{props.sub}</div>
      {props.rate === undefined ? null : (
        <div className={css.cardRate}>
          <div
            className={css.cardRateFill}
            style={{ width: formatPercent(props.rate, 0) }}
          />
        </div>
      )}
    </div>
  )
}

/** The full dashboard over one ready report. */
function Dashboard(props: {
  state: UsageState
  value: UsageDescribeValue
  controller: UsageStore
  t: UsageSectionInjected['t']
}): React.ReactNode {
  const { state, value, controller, t } = props
  const totals = value.totals
  const rate = totals.cacheRate
  const unmeasured = totals.sessions - totals.measuredSessions
  // The dashboard only renders with a nonzero total, so the share is a
  // plain division of one positive by another.
  const share = (tokens: number): string =>
    formatPercent(tokens / totals.totalTokens)
  const time = new Date(value.generatedAt)
  const pad = (part: number): string => String(part).padStart(2, '0')
  const updated =
    pad(time.getHours()) +
    ':' +
    pad(time.getMinutes()) +
    ':' +
    pad(time.getSeconds())
  const [copyState, setCopyState] = useState<'idle' | 'done' | 'failed'>(
    'idle',
  )
  // One transient feedback span per click; the timeout only clears it. The
  // `'clipboard' in navigator` probe keeps the failure path testable in
  // hosts without a clipboard API (jsdom, some webviews).
  const copyReport = async (): Promise<void> => {
    let ok = false
    if ('clipboard' in navigator) {
      try {
        await navigator.clipboard.writeText(composeReportText(value, t))
        ok = true
      } catch {
        // A host with a non-functional clipboard API reports the failure.
      }
    }
    setCopyState(ok ? 'done' : 'failed')
    window.setTimeout(() => {
      setCopyState('idle')
    }, 2000)
  }
  const weekdays = t('weekdays').split(' ')
  // Exactly seven weekday labels ship in both dictionaries; the `?? ''`
  // fallbacks only satisfy the indexed-access type.
  /* v8 ignore start -- see above */
  const weekdayLabels: [
    string,
    string,
    string,
    string,
    string,
    string,
    string,
  ] = [
    weekdays[0] ?? '',
    weekdays[1] ?? '',
    weekdays[2] ?? '',
    weekdays[3] ?? '',
    weekdays[4] ?? '',
    weekdays[5] ?? '',
    weekdays[6] ?? '',
  ]
  /* v8 ignore stop -- see above */
  const loading = state.status === 'loading'
  return (
    <>
      <div className={css.header}>
        <div>
          <h2 className={css.title}>{t('title')}</h2>
          <p className={css.intro}>{t('intro')}</p>
        </div>
        <div className={css.toolbar}>
          <span className={css.updatedAt}>
            {t('updatedAt').replace('{time}', updated)}
          </span>
          {copyState === 'idle' ? (
            <button
              type="button"
              className={css.copyButton}
              aria-label={t('copyReport')}
              title={t('copyReport')}
              onClick={() => {
                void copyReport()
              }}
            >
              {t('copyReport')}
            </button>
          ) : (
            <span
              className={
                cls('copyState') +
                ' ' +
                (copyState === 'done'
                  ? cls('copyStateOk')
                  : cls('copyStateFail'))
              }
            >
              {copyState === 'done' ? t('copied') : t('copyFailed')}
            </span>
          )}
          <button
            type="button"
            className={css.iconButton}
            aria-label={t('refresh')}
            title={t('refresh')}
            disabled={loading}
            onClick={() => {
              void controller.load()
            }}
          >
            <IconRefreshOutline14 size={14} />
          </button>
        </div>
      </div>
      {state.status === 'error' ? (
        <p className={css.errorNote}>
          {t('loadFailed')}: {state.error}
        </p>
      ) : null}
      {totals.totalTokens === 0 ? (
        <div className={css.empty}>
          <p className={css.emptyTitle}>{t('emptyTitle')}</p>
          <p className={css.emptyBody}>{t('emptyBody')}</p>
          <button
            type="button"
            className={css.primaryButton}
            onClick={() => {
              void controller.load()
            }}
          >
            {t('refresh')}
          </button>
        </div>
      ) : (
        <>
          <div className={css.cards}>
            <StatCard
              label={t('totalTokens')}
              value={compactTokens(totals.totalTokens)}
              sub={formatTokens(totals.totalTokens)}
            />
            <StatCard
              label={t('inputTokens')}
              value={compactTokens(totals.uncachedInputTokens)}
              sub={
                formatTokens(totals.uncachedInputTokens) +
                ' · ' +
                share(totals.uncachedInputTokens)
              }
            />
            <StatCard
              label={t('outputTokens')}
              value={compactTokens(totals.outputTokens)}
              sub={
                formatTokens(totals.outputTokens) +
                ' · ' +
                share(totals.outputTokens)
              }
            />
            <StatCard
              label={t('cacheRead')}
              value={compactTokens(totals.cacheReadTokens)}
              sub={
                formatTokens(totals.cacheReadTokens) +
                ' · ' +
                share(totals.cacheReadTokens)
              }
            />
            <StatCard
              label={t('cacheWrite')}
              value={compactTokens(totals.cacheWriteTokens)}
              sub={
                formatTokens(totals.cacheWriteTokens) +
                ' · ' +
                share(totals.cacheWriteTokens)
              }
            />
            <StatCard
              label={t('cacheRate')}
              value={formatPercent(rate)}
              sub={
                formatTokens(totals.cacheReadTokens) +
                ' / ' +
                formatTokens(promptTokensOf(totals))
              }
              rate={rate}
            />
            <StatCard
              label={t('calls')}
              value={String(totals.calls)}
              sub={t('turns') + ': ' + String(totals.turns)}
            />
            <StatCard
              label={t('sessions')}
              value={String(totals.sessions)}
              sub={t('steps') + ': ' + String(totals.steps)}
            />
          </div>
          {unmeasured > 0 && (
            <p className={css.coverageNote}>
              {t('coverageNote').replace('{n}', String(unmeasured))}
            </p>
          )}

          <section className={css.panel}>
            <h3 className={css.panelTitle}>{t('composition')}</h3>
            <p className={css.panelHint}>{t('compositionHint')}</p>
            <CompositionBar
              buckets={totals}
              total={totals.totalTokens}
              t={props.t}
            />
          </section>

          <section className={css.panel}>
            <h3 className={css.panelTitle}>{t('cacheRateBar')}</h3>
            <p className={css.panelHint}>{t('cacheRateBarHint')}</p>
            <CacheRateBar
              uncachedInputTokens={totals.uncachedInputTokens}
              cacheReadTokens={totals.cacheReadTokens}
              cacheWriteTokens={totals.cacheWriteTokens}
              t={props.t}
            />
          </section>

          <section className={css.panel}>
            <h3 className={css.panelTitle}>{t('trend')}</h3>
            <SeriesChart series={value.series} t={props.t} />
          </section>

          <section className={css.panel}>
            <h3 className={css.panelTitle}>{t('heatmap')}</h3>
            <p className={css.panelHint}>{t('heatmapHint')}</p>
            <Heatmap
              heatmap={value.heatmap}
              total={totals.totalTokens}
              weekdayLabels={weekdayLabels}
              t={props.t}
            />
          </section>

          <section className={css.panel}>
            <h3 className={css.panelTitle}>{t('breakdown')}</h3>
            <Breakdown value={value} t={props.t} />
          </section>
        </>
      )}
    </>
  )
}

/**
 * The usage section root: loads on first mount, then renders the loading,
 * error, empty, or dashboard states from the store snapshot.
 * @param props - the inject face (empty until the shell supplies it).
 * @returns the section element tree, or null before injection.
 */
export function UsageSection(props: UsageSectionProps): React.ReactNode {
  const { controller, useSnapshot, t } = props
  if (controller === undefined || useSnapshot === undefined || t === undefined)
    return null
  const state = useSnapshot(s => s)
  if (state.status === 'idle') void controller.load()
  if (state.status === 'loading' && state.value === null) {
    return (
      <div className={css.section}>
        <div className={css.loading}>{t('loading')}</div>
      </div>
    )
  }
  if (state.status === 'error' && state.value === null) {
    return (
      <div className={css.section}>
        <div className={css.error}>
          <p style={{ margin: 0 }}>
            {t('loadFailed')}: {state.error}
          </p>
          <button
            type="button"
            className={css.primaryButton}
            onClick={() => {
              void controller.load()
            }}
          >
            {t('retry')}
          </button>
        </div>
      </div>
    )
  }
  if (state.value === null) return null
  return (
    <div className={css.section}>
      <Dashboard
        state={state}
        value={state.value}
        controller={controller}
        t={t}
      />
    </div>
  )
}
