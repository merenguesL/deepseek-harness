/**
 * Breakdown lists of the usage section: one tab per dimension (workspace,
 * session), each row a name plus a mini stacked bar, cache rate, and call
 * count. Tabs and hover states are component-local viewing state.
 */

import { useState } from 'react'
import type { ReactNode } from 'react'
import type { UsageDescribeValue } from './report-types.ts'
import { compactTokens, formatPercent, relativeAgo, totalTokensOf } from './usage-math.ts'
import type { UsageKey } from './locales.ts'
import { SEGMENTS } from './charts.tsx'
import css from './UsageSection.module.css'

type T = (key: UsageKey) => string
/* v8 ignore next -- css-module lookups are static strings; the fallback satisfies the indexed-access type */
const cls = (name: string): string => css[name] ?? ''

interface BreakdownProps {
  value: UsageDescribeValue
  t: T
}

type Tab = 'workspace' | 'session'

/** The mini stacked bar shared by both breakdown lists. */
function MiniBar(props: { buckets: Parameters<typeof totalTokensOf>[0]; total: number; t: T }): ReactNode {
  const { buckets, total, t } = props
  if (total === 0) return <span className={css.miniBar} />
  return (
    <span className={css.miniBar}>
      {SEGMENTS.map((segment) => {
        const width = (buckets[segment.key] / total) * 100
        return width <= 0 ? null : (
          <span
            key={segment.key}
            style={{ width: `${width}%`, background: segment.color }}
            title={t(segment.labelKey)}
          />
        )
      })}
    </span>
  )
}

/** Basename of a workspace path for display; the full path stays in the sub-line. */
function basenameOf(path: string): string {
  const parts = path.split(/[/\\]/).filter(part => part.length > 0)
  return parts.at(-1) ?? path
}

function agoText(ms: number, now: number, t: T): string {
  const ago = relativeAgo(ms, now)
  if (ago === null) {
    const date = new Date(ms)
    const pad = (value: number): string => String(value).padStart(2, '0')
    return t('sessionAgoDate').replace('{date}', `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`)
  }
  if (ago.unit === 'minute') return t('sessionAgoMinute').replace('{value}', String(ago.value))
  if (ago.unit === 'hour') return t('sessionAgoHour').replace('{value}', String(ago.value))
  return t('sessionAgoDay').replace('{value}', String(ago.value))
}

/**
 * The two breakdown tabs. Session rows are sorted by the plugin (tokens
 * descending); the current instant is sampled once per render for recency.
 */
export function Breakdown(props: BreakdownProps): ReactNode {
  const { value, t } = props
  const [tab, setTab] = useState<Tab>('workspace')
  const now = Date.now()
  const workspaces = value.byWorkspace
  const sessions = value.bySession
  return (
    <div>
      <div className={css.breakdownTabs} role="tablist" aria-label={t('breakdown')}>
        {(['workspace', 'session'] as const).map(option => (
          <button
            key={option}
            type="button"
            role="tab"
            aria-selected={tab === option}
            className={cls('tab') + (tab === option ? ' ' + cls('tabActive') : '')}
            onClick={() => { setTab(option) }}
          >
            {option === 'workspace' ? t('byWorkspace') : t('bySession')}
          </button>
        ))}
      </div>
      {tab === 'workspace' ? (
        workspaces.length === 0 ? (
          <p className={css.panelHint}>{t('noWorkspaces')}</p>
        ) : (
          <div className={css.rows}>
            {workspaces.map(workspace => (
              <div key={workspace.path} className={css.row}>
                <div className={css.rowMain}>
                  <div className={css.rowName}>{workspace.path === '' ? t('unknownWorkspace') : basenameOf(workspace.path)}</div>
                  <div className={css.rowSub}>
                    {workspace.path === '' ? '' : workspace.path + ' · '}
                    {`${t('sessions')}: ${workspace.sessions}`}
                  </div>
                </div>
                <MiniBar buckets={workspace} total={workspace.totalTokens} t={t} />
                <span className={css.rowRate}>{formatPercent(workspace.cacheRate)}</span>
                <span className={css.rowTokens}>{compactTokens(workspace.totalTokens)}</span>
                <span className={css.rowCalls}>{workspace.calls}</span>
              </div>
            ))}
          </div>
        )
      ) : (
        sessions.length === 0 ? (
          <p className={css.panelHint}>{t('noSessions')}</p>
        ) : (
          <div className={css.rows}>
            {sessions.map(session => (
              <div key={String(session.sessionId)} className={css.row}>
                <div className={css.rowMain}>
                  <div className={css.rowName}>{session.title ?? t('untitledSession')}</div>
                  <div className={css.rowSub}>
                    {session.cwd === undefined ? '' : basenameOf(session.cwd) + ' · '}
                    {agoText(session.updatedAt, now, t)}
                  </div>
                </div>
                <MiniBar buckets={session} total={session.totalTokens} t={t} />
                <span className={css.rowRate}>{formatPercent(session.cacheRate)}</span>
                <span className={css.rowTokens}>{compactTokens(session.totalTokens)}</span>
                <span className={css.rowCalls}>{session.calls}</span>
              </div>
            ))}
          </div>
        )
      )}
      <div className={css.rowSub} style={{ marginTop: 8 }}>
        {t('cacheRate') + ' · ' + t('calls')}
      </div>
    </div>
  )
}
