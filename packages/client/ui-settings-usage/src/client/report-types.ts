/** Local report vocabulary used by the optional usage settings plugin. */

import type { SessionSummary } from '@deepseek-ai/dsh-api-remotes/client'

/** Four disjoint provider-reported token buckets. */
export interface UsageTokenBuckets {
  uncachedInputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
}

/** Heuristic context-composition projection value (token-meter's estimator). */
export interface UsageContextBreakdown {
  systemTokens: number
  toolsTokens: number
  messageTokens: number
}

/** Context-occupancy projection value: provider numerator, window denominator. */
export interface UsageContextPressure {
  pressureTokens: number | null
  projectedTokens: number | null
  contextWindow: number | null
}

/** Whole-report totals. */
export interface UsageTotals extends UsageTokenBuckets {
  totalTokens: number
  promptTokens: number
  cacheRate: number
  /** Lower bound: one when a session has usage, because session.list has no call count. */
  calls: number
  sessions: number
  /** Sessions whose session.list row carried a `tokenUsage` projection value. */
  measuredSessions: number
  turns: number
  steps: number
  llmMs: number
  firstActivityAt: number | null
  lastActivityAt: number | null
  /** Tokens contributed by subagent-origin sessions, with their session count. */
  subagentTokens: number
  subagentSessions: number
  /** Distinct local days with recorded activity. */
  activeDays: number
  /** Sessions carrying a contextWindow denominator in their contextPressure value. */
  contextSessions: number
  /** Sessions whose projected context fills at least NEAR_LIMIT_SHARE of their window. */
  nearLimitSessions: number
}

/** One day bucket derived from session recency. */
export interface UsageDayBucket extends UsageTokenBuckets {
  day: string
  totalTokens: number
  calls: number
}

/** One visible session's projected usage. */
export interface UsageSessionRow extends UsageTokenBuckets {
  sessionId: SessionSummary['sessionId']
  /** The session's `title` projection value; null before the first title lands. */
  title: string | null
  cwd?: string
  /** Agent preset the session was composed from; absent when unrecorded. */
  agentPreset?: string
  /** Whether the session's agent is attached and running right now. */
  running: boolean
  /** Coarse durable origin; `subagent` rows descend from a fork/spawn. */
  origin?: 'subagent'
  createdAt: number
  updatedAt: number
  /** Whether the session.list row carried a `tokenUsage` projection value. */
  measured: boolean
  /** Projection recency marker: the list cache watermark seq, null without a projection. */
  asOfSeq: number | null
  totalTokens: number
  cacheRate: number
  calls: number
  turns: number
  steps: number
  /** Context-occupancy projection value, null when the row carried none. */
  contextPressure: UsageContextPressure | null
  /** Heuristic context-composition projection value, null when the row carried none. */
  contextBreakdown: UsageContextBreakdown | null
}

/** Usage grouped by the session working directory. */
export interface UsageWorkspaceRow extends UsageTokenBuckets {
  path: string
  sessions: number
  totalTokens: number
  cacheRate: number
  calls: number
  turns: number
  steps: number
}

/** 24 local hours by weekday, populated from session last-activity timestamps. */
export type UsageHeatmap = number[][]

/** Known-call counts parallel to {@link UsageHeatmap} (same 24x7 indexing). */
export type UsageHeatmapCalls = number[][]

/** Summed heuristic context composition across sessions that carry the value. */
export interface UsageContextTotals extends UsageContextBreakdown {
  /** Sessions whose row carried a `contextBreakdown` projection value. */
  sessions: number
}

/** One auto-generated dashboard finding, rendered through the section copy. */
export interface UsageInsight {
  /** Severity deciding the marker color. */
  tone: 'good' | 'info' | 'warn'
  /** Dictionary key of the finding text. */
  key: keyof typeof import('./locales.ts').zh
  /** Template parameters handed to the translate call. */
  params: Record<string, string>
}

/** Dashboard report assembled entirely inside the optional plugin. */
export interface UsageDescribeValue {
  totals: UsageTotals
  series: UsageDayBucket[]
  bySession: UsageSessionRow[]
  byWorkspace: UsageWorkspaceRow[]
  heatmap: UsageHeatmap
  /** Known-call counts parallel to `heatmap`. */
  heatmapCalls: UsageHeatmapCalls
  contextTotals: UsageContextTotals
  generatedAt: number
}

/** Narrow response face consumed by the page store. */
export interface UsageResponse {
  rpcId?: unknown
  result:
    | { ok: true; value: UsageDescribeValue }
    | { ok: false; error: { message: string; [key: string]: unknown } }
}

/** Source supplied by the plugin's connection adapter or by tests. */
export interface UsageReportSource {
  describe(): Promise<UsageResponse>
}
