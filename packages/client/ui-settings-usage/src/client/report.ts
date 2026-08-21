/** Build a bounded usage report from the existing session.list projection. */

import type { SessionSummary } from '@deepseek-ai/dsh-api-remotes/client'
import type {
  UsageContextBreakdown,
  UsageContextPressure,
  UsageContextTotals,
  UsageDayBucket,
  UsageDescribeValue,
  UsageHeatmap,
  UsageHeatmapCalls,
  UsageSessionRow,
  UsageTokenBuckets,
  UsageTotals,
  UsageWorkspaceRow,
} from './report-types.ts'
import { NEAR_LIMIT_SHARE } from './usage-math.ts'

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

/** The row's `title` projection value, or null before the first title lands. */
function titleOf(session: SessionSummary): string | null {
  const values = session.projections?.values as
    | Record<string, unknown>
    | undefined
  const title = values?.title
  return typeof title === 'string' && title.length > 0 ? title : null
}

/** The row's context-occupancy value with every field normalized, or null. */
function contextPressureOf(session: SessionSummary): UsageContextPressure | null {
  const values = session.projections?.values as
    | Record<string, unknown>
    | undefined
  const pressure = values?.contextPressure
  if (typeof pressure !== 'object' || pressure === null) return null
  const raw = pressure as Record<string, unknown>
  const window = finiteNonnegative(raw.contextWindow)
  return {
    pressureTokens: raw.pressureTokens === undefined
      ? null
      : finiteNonnegative(raw.pressureTokens),
    projectedTokens: raw.projectedTokens === undefined
      ? null
      : finiteNonnegative(raw.projectedTokens),
    contextWindow: window === 0 ? null : window,
  }
}

/** The row's heuristic context-composition value, or null. */
function contextBreakdownOf(session: SessionSummary): UsageContextBreakdown | null {
  const values = session.projections?.values as
    | Record<string, unknown>
    | undefined
  const breakdown = values?.contextBreakdown
  if (typeof breakdown !== 'object' || breakdown === null) return null
  const raw = breakdown as Record<string, unknown>
  return {
    systemTokens: finiteNonnegative(raw.systemTokens),
    toolsTokens: finiteNonnegative(raw.toolsTokens),
    messageTokens: finiteNonnegative(raw.messageTokens),
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

function emptyHeatmapCalls(): UsageHeatmapCalls {
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
    title: titleOf(session),
    ...(session.cwd === undefined ? {} : { cwd: session.cwd }),
    ...(session.agentPreset === undefined ? {} : { agentPreset: session.agentPreset }),
    running:  session.running,
    ...(session.origin === undefined ? {} : { origin: session.origin }),
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
    contextPressure: contextPressureOf(session),
    contextBreakdown: contextBreakdownOf(session),
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

/** Sum the heuristic context composition over rows that carry the value. */
function contextTotalsOf(rows: readonly UsageSessionRow[]): UsageContextTotals {
  const totals: UsageContextTotals = {
    systemTokens: 0,
    toolsTokens: 0,
    messageTokens: 0,
    sessions: 0,
  }
  for (const row of rows) {
    const breakdown = row.contextBreakdown
    if (breakdown === null) continue
    totals.systemTokens += breakdown.systemTokens
    totals.toolsTokens += breakdown.toolsTokens
    totals.messageTokens += breakdown.messageTokens
    totals.sessions += 1
  }
  return totals
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
  const subagent = rows.filter(row => row.origin === 'subagent')
  const contextSessions = rows.filter(
    row => row.contextPressure !== null
      && row.contextPressure.contextWindow !== null,
  )
  const nearLimit = rows.filter((row) => {
    const pressure = row.contextPressure
    if (pressure === null || pressure.contextWindow === null) return false
    const projected = pressure.projectedTokens ?? pressure.pressureTokens ?? 0
    return projected / pressure.contextWindow >= NEAR_LIMIT_SHARE
  })
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
    subagentTokens: subagent.reduce((sum, row) => sum + row.totalTokens, 0),
    subagentSessions: subagent.length,
    activeDays: 0,
    contextSessions: contextSessions.length,
    nearLimitSessions: nearLimit.length,
  }
  const days = new Map<string, UsageDayBucket>()
  const heatmap = emptyHeatmap()
  const heatmapCalls = emptyHeatmapCalls()
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
    /* oxlint-disable typescript/no-non-null-assertion -- the matrices are locally built 24x7, so hour and weekday are always in range */
    const cells = heatmap[hour]!
    cells[weekday] = cells[weekday]! + row.totalTokens
    const callCells = heatmapCalls[hour]!
    callCells[weekday] = callCells[weekday]! + row.calls
    /* oxlint-enable typescript/no-non-null-assertion */
  }
  const series = [...days.values()].sort((a, b) => a.day.localeCompare(b.day))
  totals.activeDays = series.length
  return {
    totals,
    series,
    bySession: [...rows].sort((a, b) => b.totalTokens - a.totalTokens),
    byWorkspace: workspaceRows(rows),
    heatmap,
    heatmapCalls,
    contextTotals: contextTotalsOf(rows),
    generatedAt,
  }
}
