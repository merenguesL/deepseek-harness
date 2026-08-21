/**
 * Breakdown lists of the usage section: one tab per dimension (workspace,
 * session). Session rows carry the durable title projection, subagent and
 * running badges, a context-occupancy meter, and open on click (jumping to
 * the session and closing settings); the tab owns a text filter and a
 * tokens/recency sort. Tabs, filter, and sort are component-local viewing
 * state.
 */

import { useState } from 'react'
import type { ReactNode } from 'react'
import type { SessionId, SessionSummary } from '@deepseek-ai/dsh-api-remotes/client'
import type { UsageDescribeValue, UsageSessionRow } from './report-types.ts'
import {
  compactTokens,
  contextFillOf,
  formatPercent,
  NEAR_LIMIT_SHARE,
  relativeAgo,
  totalTokensOf,
} from './usage-math.ts'
import type { UsageKey } from './locales.ts'
import { SEGMENTS } from './charts.tsx'
import css from './UsageSection.module.css'

type T = (key: UsageKey, params?: Record<string, unknown>) => string
/* v8 ignore next -- css-module lookups are static strings; the fallback satisfies the indexed-access type */
const cls = (name: string): string => css[name] ?? ''

interface BreakdownProps {
  value: UsageDescribeValue
  t: T
  /** Open a session in the main window; absent when the host exposes no sessions service. */
  openSession?: ((sessionId: SessionId) => void) | undefined
  /** Close the settings panel after a jump (the shell owns open state). */
  onClose?: (() => void) | undefined
}

type Tab = 'workspace' | 'session'
type Sort = 'tokens' | 'recent'

/** The mini stacked bar shared by both breakdown lists. */
function MiniBar(props: {
  buckets: Parameters<typeof totalTokensOf>[0]
  total: number
  t: T
}): ReactNode {
  const { buckets, total, t } = props
  if (total === 0) return <span className={css.miniBar} />
  return (
    <span className={css.miniBar}>
      {SEGMENTS.map((segment) => {
        const width = (buckets[segment.key] / total) * 100
        return width <= 0 ? null : (
          <span
            key={segment.key}
            style={{
              width: `${width}%`,
              background: segment.color,
            }}
            title={t(segment.labelKey)}
          />
        )
      })}
    </span>
  )
}

/** Context-occupancy meter: fill share of the session's window, warn at the limit. */
function ContextMeter(props: { row: UsageSessionRow; t: T }): ReactNode {
  const { row, t } = props
  if (row.contextPressure === null) return <span className={css.rowContext}>—</span>
  const fill = contextFillOf(row.contextPressure)
  if (fill === null) return <span className={css.rowContext}>—</span>
  const near = fill >= NEAR_LIMIT_SHARE
  return (
    <span
      className={cls('rowContext') + (near ? ' ' + cls('rowContextWarn') : '')}
      title={t('contextHeader') + ' ' + formatPercent(fill, 0)}
    >
      <span className={css.rowContextBar}>
        <span
          className={css.rowContextFill}
          style={{ width: `${Math.min(100, fill * 100)}%` }}
        />
      </span>
      <span className={css.rowContextPct}>{formatPercent(fill, 0)}</span>
    </span>
  )
}

/** Basename of a workspace path for display; the full path stays in the sub-line. */
function basenameOf(path: string): string {
  const parts = path.split(/[/\\]/).filter(part => part.length > 0)
  return parts.at(-1) ?? path
}

/** Trailing id fragment for list rows whose durable title is unavailable. */
function shortIdOf(id: SessionSummary['sessionId']): string {
  const value = String(id)
  return value.length <= 10 ? value : value.slice(-10)
}

function agoText(ms: number, now: number, t: T): string {
  const ago = relativeAgo(ms, now)
  if (ago === null) {
    const date = new Date(ms)
    const pad = (value: number): string => String(value).padStart(2, '0')
    return t('sessionAgoDate', {
      date: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    })
  }
  if (ago.value === 0) return t('sessionAgoJustNow')
  if (ago.unit === 'minute') return t('sessionAgoMinute', { value: ago.value })
  if (ago.unit === 'hour') return t('sessionAgoHour', { value: ago.value })
  return t('sessionAgoDay', { value: ago.value })
}

/** Case-insensitive substring match over the visible identity fields. */
function matchesFilter(row: UsageSessionRow, filter: string): boolean {
  const needle = filter.trim().toLowerCase()
  if (needle === '') return true
  return (
    (row.title ?? '').toLowerCase().includes(needle)
    || (row.cwd ?? '').toLowerCase().includes(needle)
    || String(row.sessionId).toLowerCase().includes(needle)
    || (row.agentPreset ?? '').toLowerCase().includes(needle)
  )
}

/**
 * The two breakdown tabs. Session rows are sorted per the tab's sort control
 * and filtered by its search box; the current instant is sampled once per
 * render for recency.
 */
export function Breakdown(props: BreakdownProps): ReactNode {
  const { value, t, openSession, onClose } = props
  const [tab, setTab] = useState<Tab>('workspace')
  const [sort, setSort] = useState<Sort>('tokens')
  const [filter, setFilter] = useState('')
  const now = Date.now()
  const workspaces = value.byWorkspace
  const totalTokens = value.totals.totalTokens
  const sessions = [...value.bySession]
    .filter(row => matchesFilter(row, filter))
    .sort((a, b) =>
      sort === 'tokens'
        ? b.totalTokens - a.totalTokens
        : b.updatedAt - a.updatedAt,
    )
  const openRow = (row: UsageSessionRow): void => {
    openSession?.(row.sessionId)
    onClose?.()
  }
  return (
    <div>
      <div
        className={css.breakdownTabs}
        role="tablist"
        aria-label={t('breakdown')}
      >
        {(['workspace', 'session'] as const).map(option => (
          <button
            key={option}
            type="button"
            role="tab"
            aria-selected={tab === option}
            className={
              cls('tab') +
              (tab === option ? ' ' + cls('tabActive') : '')
            }
            onClick={() => {
              setTab(option)
            }}
          >
            {option === 'workspace'
              ? t('byWorkspace')
              : t('bySession')}
          </button>
        ))}
        {tab === 'session' && (
          <>
            <input
              type="search"
              className={css.searchBox}
              value={filter}
              placeholder={t('searchPlaceholder')}
              aria-label={t('searchPlaceholder')}
              onChange={(event) => {
                setFilter(event.target.value)
              }}
            />
            <div className={css.toggle} role="radiogroup" aria-label={t('sortTokens')}>
              {(['tokens', 'recent'] as const).map(option => (
                <button
                  key={option}
                  type="button"
                  role="radio"
                  aria-checked={sort === option}
                  className={
                    cls('toggleButton') +
                    (sort === option ? ' ' + cls('toggleButtonActive') : '')
                  }
                  onClick={() => {
                    setSort(option)
                  }}
                >
                  {option === 'tokens' ? t('sortTokens') : t('sortRecent')}
                </button>
              ))}
            </div>
          </>
        )}
      </div>
      {tab === 'workspace' ? (
        workspaces.length === 0 ? (
          <p className={css.panelHint}>{t('noWorkspaces')}</p>
        ) : (
          <div className={css.rows}>
            {workspaces.map(workspace => (
              <div key={workspace.path} className={css.row}>
                <div className={css.rowMain}>
                  <div className={css.rowName}>
                    {workspace.path === ''
                      ? t('unknownWorkspace')
                      : basenameOf(workspace.path)}
                  </div>
                  <div className={css.rowSub}>
                    {workspace.path === ''
                      ? ''
                      : workspace.path + ' · '}
                    {`${t('sessions')}: ${workspace.sessions}`}
                    {totalTokens === 0
                      ? ''
                      : ' · ' + t('ofTotal', { share: formatPercent(workspace.totalTokens / totalTokens) })}
                  </div>
                </div>
                <MiniBar
                  buckets={workspace}
                  total={workspace.totalTokens}
                  t={t}
                />
                <span className={css.rowRate}>
                  {formatPercent(workspace.cacheRate)}
                </span>
                <span className={css.rowTokens}>
                  {compactTokens(workspace.totalTokens)}
                </span>
                <span className={css.rowCalls}>
                  {workspace.calls}
                </span>
                <span className={css.rowContext}>—</span>
              </div>
            ))}
          </div>
        )
      ) : sessions.length === 0 ? (
        <p className={css.panelHint}>
          {value.bySession.length === 0 ? t('noSessions') : t('noMatch')}
        </p>
      ) : (
        <div className={css.rows}>
          {sessions.map(session => (
            <button
              key={String(session.sessionId)}
              type="button"
              className={
                cls('row') +
                (openSession === undefined ? '' : ' ' + cls('rowClickable'))
              }
              onClick={() => { openRow(session) }}
              title={openSession === undefined ? undefined : t('openSession')}
            >
              <div className={css.rowMain}>
                <div className={css.rowName}>
                  {session.title ?? t('untitledSession')}
                  {session.origin === 'subagent' && (
                    <span className={cls('badge') + ' ' + cls('badgeSub')}>
                      {t('subagentBadge')}
                    </span>
                  )}
                  {session.running && (
                    <span className={cls('badge') + ' ' + cls('badgeRun')}>
                      {t('runningBadge')}
                    </span>
                  )}
                </div>
                <div
                  className={
                    cls('rowSub') +
                    (session.measured
                      ? ''
                      : ' ' + cls('rowSubWarn'))
                  }
                >
                  {session.cwd === undefined
                    ? ''
                    : basenameOf(session.cwd) + ' · '}
                  {shortIdOf(session.sessionId)}
                  {session.agentPreset === undefined
                    ? ''
                    : ' · ' + session.agentPreset}
                  {' · '}
                  {agoText(session.updatedAt, now, t)}
                  {session.measured
                    ? ''
                    : ' · ' + t('unmeasured')}
                </div>
              </div>
              <MiniBar
                buckets={session}
                total={session.totalTokens}
                t={t}
              />
              <span className={css.rowRate}>
                {formatPercent(session.cacheRate)}
              </span>
              <span className={css.rowTokens}>
                {compactTokens(session.totalTokens)}
              </span>
              <span className={css.rowCalls}>
                {session.calls}
              </span>
              <ContextMeter row={session} t={t} />
            </button>
          ))}
        </div>
      )}
      <div className={css.rowSub} style={{ marginTop: 8 }}>
        {t('cacheRate') + ' · ' + t('calls') + ' · ' + t('contextHeader')}
      </div>
    </div>
  )
}
