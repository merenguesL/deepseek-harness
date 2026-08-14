/** Local report vocabulary used by the optional usage settings plugin. */

import type { SessionSummary } from '@deepseek-ai/dsh-api-remotes/client'

/** Four disjoint provider-reported token buckets. */
export interface UsageTokenBuckets {
  uncachedInputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
}

/** Whole-report totals. */
export interface UsageTotals extends UsageTokenBuckets {
  totalTokens: number
  promptTokens: number
  cacheRate: number
  /** Lower bound: one when a session has usage, because session.list has no call count. */
  calls: number
  sessions: number
  turns: number
  steps: number
  llmMs: number
  firstActivityAt: number | null
  lastActivityAt: number | null
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
  title: string | null
  cwd?: string
  createdAt: number
  updatedAt: number
  totalTokens: number
  cacheRate: number
  calls: number
  turns: number
  steps: number
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

/** Dashboard report assembled entirely inside the optional plugin. */
export interface UsageDescribeValue {
  totals: UsageTotals
  series: UsageDayBucket[]
  bySession: UsageSessionRow[]
  byWorkspace: UsageWorkspaceRow[]
  heatmap: UsageHeatmap
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
