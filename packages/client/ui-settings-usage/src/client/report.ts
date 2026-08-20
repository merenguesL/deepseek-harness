/** Build a bounded usage report from the existing session.list projection. */

import type { SessionSummary } from '@deepseek-ai/dsh-api-remotes/client'
import type {
  UsageDayBucket,
  UsageDescribeValue,
  UsageHeatmap,
  UsageSessionRow,
  UsageTokenBuckets,
  UsageTotals,
  UsageWorkspaceRow,
} from './report-types.ts'

const ZERO: UsageTokenBuckets = {
  uncachedInputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
}

function finiteNonnegative(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : 0
}

function totalTokens(buckets: UsageTokenBuckets): number {
  return (
    buckets.uncachedInputTokens +
    buckets.outputTokens +
    buckets.cacheReadTokens +
    buckets.cacheWriteTokens
  )
}

function promptTokens(buckets: UsageTokenBuckets): number {
  return (
    buckets.uncachedInputTokens +
    buckets.cacheReadTokens +
    buckets.cacheWriteTokens
  )
}

/** One session's projected usage as the report consumes it, or null when the
 * session.list row carried no `tokenUsage` value. */
function projectionOf(
  session: SessionSummary,
): { buckets: UsageTokenBuckets; asOfSeq: number } | null {
  const values = session.projections?.values as
    | Record<string, unknown>
    | undefined
  const usage = values?.tokenUsage
  if (typeof usage !== 'object' || usage === null) return null
  const raw = usage as Record<string, unknown>
  return {
    buckets: {
      uncachedInputTokens: finiteNonnegative(raw.uncachedInputTokens),
      outputTokens: finiteNonnegative(raw.outputTokens),
      cacheReadTokens: finiteNonnegative(raw.cacheReadTokens),
      cacheWriteTokens: finiteNonnegative(raw.cacheWriteTokens),
    },
    asOfSeq: session.projections?.asOfSeq ?? 0,
  }
}

function add(
  left: UsageTokenBuckets,
  right: UsageTokenBuckets,
): UsageTokenBuckets {
  return {
    uncachedInputTokens: left.uncachedInputTokens + right.uncachedInputTokens,
    outputTokens: left.outputTokens + right.outputTokens,
    cacheReadTokens: left.cacheReadTokens + right.cacheReadTokens,
    cacheWriteTokens: left.cacheWriteTokens + right.cacheWriteTokens,
  }
}

function cacheRateOf(buckets: UsageTokenBuckets): number {
  const prompt = promptTokens(buckets)
  return prompt === 0 ? 0 : buckets.cacheReadTokens / prompt
}

function dayOf(timestamp: number): string {
  const date = new Date(timestamp)
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function emptyHeatmap(): UsageHeatmap {
  return Array.from({ length: 24 }, () => Array.from({ length: 7 }, () => 0))
}

function rowOf(session: SessionSummary): UsageSessionRow {
  const projection = projectionOf(session)
  const buckets = projection?.buckets ?? { ...ZERO }
  const total = totalTokens(buckets)
  // session.list exposes the durable cumulative projection but not its source
  // step count. One reported projection therefore proves at least one call.
  const calls = total === 0 ? 0 : 1
  return {
    ...buckets,
    sessionId: session.sessionId,
    title: null,
    ...(session.cwd === undefined ? {} : { cwd: session.cwd }),
    // The public list contract intentionally has no creation timestamp; using
    // updatedAt keeps the row sortable without inventing a second source.
    createdAt: session.updatedAt,
    updatedAt: session.updatedAt,
    measured: projection !== null,
    asOfSeq: projection?.asOfSeq ?? null,
    totalTokens: total,
    cacheRate: cacheRateOf(buckets),
    calls,
    turns: 0,
    steps: 0,
  }
}

function workspaceRows(rows: readonly UsageSessionRow[]): UsageWorkspaceRow[] {
  const grouped = new Map<string, UsageWorkspaceRow>()
  for (const row of rows) {
    const path = row.cwd ?? ''
    const current = grouped.get(path)
    if (current === undefined) {
      grouped.set(path, {
        uncachedInputTokens: row.uncachedInputTokens,
        outputTokens: row.outputTokens,
        cacheReadTokens: row.cacheReadTokens,
        cacheWriteTokens: row.cacheWriteTokens,
        path,
        sessions: 1,
        totalTokens: row.totalTokens,
        cacheRate: row.cacheRate,
        calls: row.calls,
        turns: 0,
        steps: 0,
      })
      continue
    }
    const buckets = add(current, row)
    Object.assign(current, buckets, {
      sessions: current.sessions + 1,
      totalTokens: totalTokens(buckets),
      cacheRate: cacheRateOf(buckets),
      calls: current.calls + row.calls,
    })
  }
  return [...grouped.values()].sort((a, b) => b.totalTokens - a.totalTokens)
}

/**
 * Assemble the plugin's best-effort report from visible session summaries.
 * Exact hourly usage is intentionally absent because the existing list API
 * exposes cumulative tokenUsage, not usage events or an hour series. The
 * session's last-activity timestamp is used as one activity marker so the
 * client can still provide a useful local-day trend and heatmap.
 * @param sessions - visible rows returned by session.list.
 * @param generatedAt - report timestamp, injectable for deterministic tests.
 * @returns dashboard report.
 */
export function buildUsageReport(
  sessions: readonly SessionSummary[],
  generatedAt = Date.now(),
): UsageDescribeValue {
  const rows = sessions.map(session => rowOf(session))
  const totalsBuckets = rows.reduce<UsageTokenBuckets>(
    (sum, row) => add(sum, row),
    { ...ZERO },
  )
  const prompt = promptTokens(totalsBuckets)
  const active = rows.filter(row => row.totalTokens > 0)
  const totals: UsageTotals = {
    ...totalsBuckets,
    totalTokens: totalTokens(totalsBuckets),
    promptTokens: prompt,
    cacheRate: cacheRateOf(totalsBuckets),
    calls: rows.reduce((sum, row) => sum + row.calls, 0),
    sessions: rows.length,
    measuredSessions: rows.reduce(
      (sum, row) => sum + (row.measured ? 1 : 0),
      0,
    ),
    turns: 0,
    steps: 0,
    llmMs: 0,
    firstActivityAt:
      active.length === 0
        ? null
        : Math.min(...active.map(row => row.updatedAt)),
    lastActivityAt:
      active.length === 0
        ? null
        : Math.max(...active.map(row => row.updatedAt)),
  }
  const days = new Map<string, UsageDayBucket>()
  const heatmap = emptyHeatmap()
  for (const row of active) {
    const day = dayOf(row.updatedAt)
    const current = days.get(day)
    const dayRow = current ?? { ...ZERO, day, totalTokens: 0, calls: 0 }
    const buckets = add(dayRow, row)
    days.set(day, {
      ...buckets,
      day,
      totalTokens: totalTokens(buckets),
      calls: dayRow.calls + row.calls,
    })
    const date = new Date(row.updatedAt)
    const hour = date.getHours()
    const weekday = date.getDay()
    const cells = heatmap[hour]
    if (cells !== undefined)
      cells[weekday] = (cells[weekday] ?? 0) + row.totalTokens
  }
  return {
    totals,
    series: [...days.values()].sort((a, b) => a.day.localeCompare(b.day)),
    bySession: [...rows].sort((a, b) => b.totalTokens - a.totalTokens),
    byWorkspace: workspaceRows(rows),
    heatmap,
    generatedAt,
  }
}
