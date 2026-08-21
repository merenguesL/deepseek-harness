/**
 * Usage statistics settings section: a client-only report over visible
 * session-list projections. The page loads on first mount, refreshes on
 * demand (optionally every 30 seconds), and re-renders from the store
 * snapshot; all rollups, deltas, insights, and formats are pure functions of
 * that report value. Session rows can jump to their session through the
 * injected sessions face, closing the panel via the shell's close affordance.
 */

import { useEffect, useState } from 'react'
import { IconRefreshOutline14 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import type { InjectFace } from '@deepseek-ai/dsh-client-ui-slots'
import type { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import type { UsageDescribeValue, UsageInsight } from './report-types.ts'
import {
  compactTokens,
  dayBucketOf,
  dayKeyOf,
  filterRangeSeries,
  formatPercent,
  formatTokens,
  insightsOf,
  periodDelta,
  promptTokensOf,
  rollup,
  seriesTotal,
  streakOf,
  subagentShareOf,
  toSessionsCsv,
} from './usage-math.ts'
import type { UsageState, UsageStore } from './store.ts'
import type { zh } from './locales.ts'
import { CacheRateBar, CompositionBar, ContextBar, SeriesChart } from './charts.tsx'
import { Heatmap } from './heatmap.tsx'
import { Breakdown } from './breakdown.tsx'
import css from './UsageSection.module.css'

/* v8 ignore next -- css-module lookups are static strings; the fallback satisfies the indexed-access type */
const cls = (...names: string[]): string =>
  names.map(name => css[name] ?? '').filter(Boolean).join(' ')

/** Injected dependencies of {@link UsageSection} (slot `inject`). */
export interface UsageSectionInjected {
  /** The page store (loaded on first mount, refreshed on demand). */
  controller: UsageStore
  hooks: {
    /** Page snapshot source bound by the UI renderer as useSnapshot. */
    snapshot: UsageStore['store']
    /** Locale snapshot source bound by the UI renderer as useLocale. */
    locale: LocaleRuntime
  }
  /** Section copy. */
  t: (key: keyof typeof zh, params?: Record<string, unknown>) => string
  /**
    * Open a session in the main window. Present only when the composition
    * provides the optional sessions service; the affordance hides otherwise.
    */
  openSession?: (sessionId: SessionId) => void
}

/** Props delivered by the slot outlet: the inject face spread flat plus the shell's close. */
export type UsageSectionProps = Partial<InjectFace<UsageSectionInjected>> & {
  close?: () => void
}

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
    t('totalTokens') + ': ' + formatTokens(totals.totalTokens),
    t('inputTokens') + ': ' + formatTokens(totals.uncachedInputTokens),
    t('outputTokens') + ': ' + formatTokens(totals.outputTokens),
    t('cacheRead') + ': ' + formatTokens(totals.cacheReadTokens),
    t('cacheWrite') + ': ' + formatTokens(totals.cacheWriteTokens),
    `${t('cacheRate')}: ${formatPercent(totals.cacheRate)} · ${t('calls')}: ${totals.calls} · ${t('sessions')}: ${totals.sessions}`,
  ]
  if (value.series.length > 0) {
    lines.push('', t('granularityDay'))
    for (const bucket of value.series)
      lines.push(bucket.day + ': ' + formatTokens(bucket.totalTokens))
  }
  if (value.bySession.length > 0) {
    lines.push('', t('bySession'))
    for (const row of value.bySession.slice(0, 10)) {
      lines.push(
        (row.title ?? t('untitledSession'))
          + ' (' + (row.cwd ?? t('unknownWorkspace')) + '): '
          + formatTokens(row.totalTokens),
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

/** One auto-generated finding row: severity dot plus localized text. */
function InsightRow(props: { insight: UsageInsight; t: UsageSectionInjected['t'] }): React.ReactNode {
  const toneClass =
    props.insight.tone === 'good'
      ? cls('insightGood')
      : props.insight.tone === 'warn'
        ? cls('insightWarn')
        : cls('insightInfo')
  return (
    <li className={css.insightItem}>
      <span className={cls('insightDot') + ' ' + toneClass} aria-hidden />
      <span>{props.t(props.insight.key, props.insight.params)}</span>
    </li>
  )
}

/** Loading skeleton: card and panel placeholders with the shared shimmer. */
function Skeleton(): React.ReactNode {
  return (
    <>
      <div className={css.cards}>
        {[0, 1, 2, 3].map(index => (
          <div key={index} className={cls('card', 'skeletonCard')}>
            <div className={cls('skeletonLine', 'skeletonWide')} />
            <div className={cls('skeletonLine', 'skeletonValue')} />
            <div className={cls('skeletonLine', 'skeletonWide')} />
          </div>
        ))}
      </div>
      {[0, 1].map(index => (
        <div key={index} className={cls('panel', 'skeletonPanel')}>
          <div className={cls('skeletonLine', 'skeletonWide')} />
          <div className={cls('skeletonLine', 'skeletonTall')} />
        </div>
      ))}
    </>
  )
}

/** The full dashboard over one ready report. */
function Dashboard(props: {
  state: UsageState
  value: UsageDescribeValue
  controller: UsageStore
  t: UsageSectionInjected['t']
  language: string | undefined
  auto: boolean
  toggleAuto: () => void
  openSession: UsageSectionInjected['openSession']
  onClose: (() => void) | undefined
}): React.ReactNode {
  const { state, value, controller, t, language, auto, toggleAuto, openSession, onClose } = props
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
  const now = value.generatedAt
  const compact = (tokens: number): string => compactTokens(tokens, language)
  const today = dayBucketOf(value.series, dayKeyOf(now))
  const week = seriesTotal(filterRangeSeries(value.series, 7, now))
  const weekDelta = periodDelta(rollup(value.series, 'day'), 'day')
  const streak = streakOf(value.series, now)
  const insights = insightsOf(value, t('weekdays').split(' '), now)
  const [copyState, setCopyState] = useState<'idle' | 'done' | 'failed'>(
    'idle',
  )
  const [exportState, setExportState] = useState<'idle' | 'done' | 'failed'>(
    'idle',
  )
  // One transient feedback span per click; the timeout only clears it. The
  // 'clipboard' in navigator probe keeps the failure path testable in
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
  const exportCsv = (): void => {
    try {
      const blob = new Blob([toSessionsCsv(value.bySession)], {
        type: 'text/csv;charset=utf-8',
      })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = 'usage-sessions-' + dayKeyOf(value.generatedAt) + '.csv'
      anchor.click()
      URL.revokeObjectURL(url)
      setExportState('done')
    } catch {
      // A host without the Blob download URL API reports the failure.
      setExportState('failed')
    }
    window.setTimeout(() => {
      setExportState('idle')
    }, 2000)
  }
  const weekdays = t('weekdays').split(' ')
  // Exactly seven weekday labels ship in both dictionaries; the ?? ''
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
  const weekDeltaLabel =
    weekDelta === null
      ? null
      : weekDelta.delta > 0.0005
        ? t('deltaUp', { delta: formatPercent(weekDelta.delta, 0) })
          + ' ' + t('last7Days')
        : weekDelta.delta < -0.0005
          ? t('deltaDown', { delta: formatPercent(-weekDelta.delta, 0) })
            + ' ' + t('last7Days')
          : t('deltaFlat')
  return (
    <>
      <div className={css.header}>
        <div>
          <h2 className={css.title}>{t('title')}</h2>
          <p className={css.intro}>{t('intro')}</p>
        </div>
        <div className={css.toolbar}>
          <span className={css.updatedAt}>
            {t('updatedAt', { time: updated })}
          </span>
          <button
            type="button"
            className={cls('autoButton') + (auto ? ' ' + cls('autoButtonOn') : '')}
            aria-pressed={auto}
            title={t('autoRefresh')}
            onClick={toggleAuto}
          >
            {t('autoLabel')}
          </button>
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
          {exportState === 'idle' ? (
            <button
              type="button"
              className={css.copyButton}
              aria-label={t('exportCsv')}
              title={t('exportCsv')}
              onClick={exportCsv}
            >
              {t('exportCsv')}
            </button>
          ) : (
            <span
              className={
                cls('copyState') +
                ' ' +
                (exportState === 'done'
                  ? cls('copyStateOk')
                  : cls('copyStateFail'))
              }
            >
              {exportState === 'done' ? t('copied') : t('exportFailed')}
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
              value={compact(totals.totalTokens)}
              sub={weekDeltaLabel === null
                ? formatTokens(totals.totalTokens)
                : formatTokens(totals.totalTokens) + ' · ' + weekDeltaLabel}
            />
            <StatCard
              label={t('today')}
              value={compact(today?.totalTokens ?? 0)}
              sub={today === null
                ? t('todayNone')
                : `${t('calls')}: ${today.calls}`}
            />
            <StatCard
              label={t('last7Days')}
              value={compact(week.tokens)}
              sub={`${t('calls')}: ${week.calls}`}
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
              label={t('inputTokens')}
              value={compact(totals.uncachedInputTokens)}
              sub={
                formatTokens(totals.uncachedInputTokens) +
                ' · ' +
                share(totals.uncachedInputTokens)
              }
            />
            <StatCard
              label={t('outputTokens')}
              value={compact(totals.outputTokens)}
              sub={
                formatTokens(totals.outputTokens) +
                ' · ' +
                share(totals.outputTokens)
              }
            />
            <StatCard
              label={t('cacheRead')}
              value={compact(totals.cacheReadTokens)}
              sub={
                formatTokens(totals.cacheReadTokens) +
                ' · ' +
                share(totals.cacheReadTokens)
              }
            />
            <StatCard
              label={t('cacheWrite')}
              value={compact(totals.cacheWriteTokens)}
              sub={
                formatTokens(totals.cacheWriteTokens) +
                ' · ' +
                share(totals.cacheWriteTokens)
              }
            />
            <StatCard
              label={t('calls')}
              value={String(totals.calls)}
              sub={t('turns') + ': ' + String(totals.turns)}
            />
            <StatCard
              label={t('sessions')}
              value={String(totals.sessions)}
              sub={t('measuredSub', {
                n: totals.measuredSessions,
                total: totals.sessions,
              })}
            />
            <StatCard
              label={t('activeDays')}
              value={String(totals.activeDays)}
              sub={streak > 0 ? t('activeDaysSub', { n: streak }) : '—'}
            />
            <StatCard
              label={t('subagentShare')}
              value={formatPercent(subagentShareOf(totals))}
              sub={t('subagentShareSub', { n: totals.subagentSessions })}
            />
          </div>
          {insights.length > 0 && (
            <section className={cls('panel', 'insightPanel')}>
              <h3 className={css.panelTitle}>{t('insightTitle')}</h3>
              <ul className={css.insightList}>
                {insights.map(insight => (
                  <InsightRow key={insight.key} insight={insight} t={t} />
                ))}
              </ul>
            </section>
          )}
          {unmeasured > 0 && (
            <p className={css.coverageNote}>
              {t('coverageNote', { n: unmeasured })}
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
            <h3 className={css.panelTitle}>{t('contextPanel')}</h3>
            <p className={css.panelHint}>{t('contextPanelHint')}</p>
            <ContextBar
              totals={value.contextTotals}
              t={props.t}
            />
          </section>

          <section className={css.panel}>
            <h3 className={css.panelTitle}>{t('heatmap')}</h3>
            <p className={css.panelHint}>{t('heatmapHint')}</p>
            <Heatmap
              heatmap={value.heatmap}
              calls={value.heatmapCalls}
              total={totals.totalTokens}
              weekdayLabels={weekdayLabels}
              t={props.t}
            />
          </section>

          <section className={css.panel}>
            <h3 className={css.panelTitle}>{t('breakdown')}</h3>
            <Breakdown
              value={value}
              t={props.t}
              openSession={openSession}
              onClose={onClose}
            />
          </section>
        </>
      )}
    </>
  )
}

/** Auto-refresh cadence for the silently reloaded report. */
const AUTO_REFRESH_MS = 30_000

/**
 * The usage section root: loads on first mount, then renders the loading,
 * error, empty, or dashboard states from the store snapshot. The auto
 * refresh toggle silently reloads every 30 seconds while the page stays
 * mounted.
 * @param props - the inject face (empty until the shell supplies it) plus
 * the shell's close affordance.
 * @returns the section element tree, or null before injection.
 */
export function UsageSection(props: UsageSectionProps): React.ReactNode {
  const { controller, useSnapshot, useLocale, t, openSession, close } = props
  if (controller === undefined || useSnapshot === undefined || t === undefined)
    return null
  const state = useSnapshot(s => s)
  const language = useLocale !== undefined ? useLocale(s => s.active) : undefined
  const [auto, setAuto] = useState(false)
  useEffect(() => {
    if (!auto) return undefined
    const timer = window.setInterval(() => {
      void controller.load()
    }, AUTO_REFRESH_MS)
    return () => {
      window.clearInterval(timer)
    }
  }, [auto, controller])
  const toggleAuto = (): void => {
    setAuto(value => !value)
  }
  if (state.status === 'idle') void controller.load()
  if (state.status === 'loading' && state.value === null) {
    return (
      <div className={css.section}>
        <DashboardChrome
          t={t}
          auto={auto}
          toggleAuto={toggleAuto}
          loading
        />
        <Skeleton />
      </div>
    )
  }
  if (state.status === 'error' && state.value === null) {
    return (
      <div className={css.section}>
        <DashboardChrome
          t={t}
          auto={auto}
          toggleAuto={toggleAuto}
        />
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
        language={language}
        auto={auto}
        toggleAuto={toggleAuto}
        openSession={openSession}
        onClose={close}
      />
    </div>
  )
}

/** Header chrome shared by the loading, error, and dashboard states. */
function DashboardChrome(props: {
  t: UsageSectionInjected['t']
  auto: boolean
  toggleAuto: () => void
  loading?: boolean
}): React.ReactNode {
  return (
    <div className={css.header}>
      <div>
        <h2 className={css.title}>{props.t('title')}</h2>
        <p className={css.intro}>{props.t('intro')}</p>
      </div>
      <div className={css.toolbar}>
        <span className={css.updatedAt}>
          {props.loading === true ? props.t('loading') : ''}
        </span>
        <button
          type="button"
          className={
            cls('autoButton') + (props.auto ? ' ' + cls('autoButtonOn') : '')
          }
          aria-pressed={props.auto}
          title={props.t('autoRefresh')}
          onClick={props.toggleAuto}
        >
          {props.t('autoLabel')}
        </button>
      </div>
    </div>
  )
}
