/** Browser-side aggregation over the existing session.list projection. */
import { describe, expect, it } from 'vitest'
import type { SessionSummary } from '@deepseek-ai/dsh-api-remotes/client'
import { buildUsageReport } from '../src/client/report.ts'

type TokenUsage = {
  uncachedInputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
}

function session(
  id: string,
  updatedAt: number,
  usage?: TokenUsage,
  cwd?: string,
): SessionSummary {
  const row = {
    sessionId: id as SessionSummary['sessionId'],
    updatedAt,
    running: false,
    blank: false,
    ...(cwd === undefined ? {} : { cwd }),
  }
  if (usage === undefined) return row
  return {
    ...row,
    projections: {
      asOfSeq: 1,
      values: { tokenUsage: usage },
    } as unknown as SessionSummary['projections'],
  } as SessionSummary
}

function dayOf(timestamp: number): string {
  const date = new Date(timestamp)
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

describe('buildUsageReport', () => {
  it('aggregates tokenUsage rows without changing the session-list contract', () => {
    const firstAt = new Date(2026, 7, 19, 9, 30).getTime()
    const secondAt = new Date(2026, 7, 20, 14, 15).getTime()
    const value = buildUsageReport(
      [
        session(
          'alpha',
          firstAt,
          {
            uncachedInputTokens: 100,
            outputTokens: 50,
            cacheReadTokens: 300,
            cacheWriteTokens: 10,
          },
          '/work/project',
        ),
        session(
          'beta',
          secondAt,
          {
            uncachedInputTokens: 20,
            outputTokens: 30,
            cacheReadTokens: 0,
            cacheWriteTokens: 5,
          },
          '/work/project',
        ),
        session('empty', secondAt, undefined, '/work/other'),
      ],
      1234,
    )

    expect(value.generatedAt).toBe(1234)
    expect(value.totals).toMatchObject({
      uncachedInputTokens: 120,
      outputTokens: 80,
      cacheReadTokens: 300,
      cacheWriteTokens: 15,
      totalTokens: 515,
      promptTokens: 435,
      calls: 2,
      sessions: 3,
      measuredSessions: 2,
      firstActivityAt: firstAt,
      lastActivityAt: secondAt,
    })
    expect(value.bySession.map(row => String(row.sessionId))).toEqual([
      'alpha',
      'beta',
      'empty',
    ])
    expect(value.bySession.map(row => row.measured)).toEqual([
      true,
      true,
      false,
    ])
    expect(value.bySession.map(row => row.asOfSeq)).toEqual([1, 1, null])
    expect(value.byWorkspace[0]).toMatchObject({
      path: '/work/project',
      sessions: 2,
      totalTokens: 515,
      calls: 2,
    })
    expect(value.byWorkspace[1]).toMatchObject({
      path: '/work/other',
      sessions: 1,
      totalTokens: 0,
      calls: 0,
    })
    expect(value.series).toEqual([
      expect.objectContaining({
        day: dayOf(firstAt),
        totalTokens: 460,
        calls: 1,
      }),
      expect.objectContaining({
        day: dayOf(secondAt),
        totalTokens: 55,
        calls: 1,
      }),
    ])
    expect(
      value.heatmap[new Date(firstAt).getHours()]![new Date(firstAt).getDay()],
    ).toBe(460)
    expect(
      value.heatmap[new Date(secondAt).getHours()]![
        new Date(secondAt).getDay()
      ],
    ).toBe(55)
  })

  it('normalizes malformed projection values and leaves missing values empty', () => {
    const value = buildUsageReport(
      [
        session('bad', 1, {
          uncachedInputTokens: -1,
          outputTokens: Number.POSITIVE_INFINITY,
          cacheReadTokens: 1.9,
          cacheWriteTokens: Number.NaN,
        }),
      ],
      2,
    )

    expect(value.totals).toMatchObject({
      uncachedInputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 1,
      cacheWriteTokens: 0,
      totalTokens: 1,
      calls: 1,
      measuredSessions: 1,
    })
    expect(value.bySession[0]?.cacheRate).toBe(1)
    expect(value.bySession[0]?.measured).toBe(true)
  })

  it('tolerates a projection block without a recency seq', () => {
    const row = session('noseq', 1, {
      uncachedInputTokens: 4,
      outputTokens: 2,
      cacheReadTokens: 1,
      cacheWriteTokens: 0,
    }) as SessionSummary & { projections: { values: Record<string, unknown> } }
    const value = buildUsageReport(
      [
        {
          ...row,
          projections: { values: row.projections.values },
        } as SessionSummary,
      ],
      2,
    )
    expect(value.totals.measuredSessions).toBe(1)
    expect(value.bySession[0]?.asOfSeq).toBe(0)
  })
})

describe('extended projection consumption', () => {
  function richSession(
    id: string,
    updatedAt: number,
    values: Record<string, unknown>,
    extra: Partial<SessionSummary> = {},
  ): SessionSummary {
    return {
      sessionId: id as SessionSummary['sessionId'],
      updatedAt,
      running: false,
      blank: false,
      projections: { asOfSeq: 7, values },
      ...extra,
    }
  }

  it('consumes title, context, origin, running, and preset fields from the rows', () => {
    const at = new Date(2026, 7, 14, 10, 0).getTime()
    const value = buildUsageReport(
      [
        richSession(
          'rich',
          at,
          {
            tokenUsage: {
              uncachedInputTokens: 100,
              outputTokens: 50,
              cacheReadTokens: 300,
              cacheWriteTokens: 50,
            },
            title: '重构登录',
            contextPressure: {
              pressureTokens: 150_000,
              projectedTokens: 170_000,
              contextWindow: 200_000,
            },
            contextBreakdown: { systemTokens: 4_000, toolsTokens: 6_000, messageTokens: 10_000 },
          },
          { origin: 'subagent', agentPreset: 'coder', running: true, cwd: '/work/app' },
        ),
        richSession('plain', at, {}),
      ],
      1234,
    )

    const rich = value.bySession.find(row => String(row.sessionId) === 'rich')!
    expect(rich.title).toBe('重构登录')
    expect(rich.origin).toBe('subagent')
    expect(rich.agentPreset).toBe('coder')
    expect(rich.running).toBe(true)
    expect(rich.contextPressure).toEqual({
      pressureTokens: 150_000,
      projectedTokens: 170_000,
      contextWindow: 200_000,
    })
    expect(rich.contextBreakdown).toEqual({
      systemTokens: 4_000,
      toolsTokens: 6_000,
      messageTokens: 10_000,
    })
    const plain = value.bySession.find(row => String(row.sessionId) === 'plain')!
    expect(plain.title).toBeNull()
    expect(plain.contextPressure).toBeNull()
    expect(plain.contextBreakdown).toBeNull()
    expect(plain.running).toBe(false)

    expect(value.totals).toMatchObject({
      subagentTokens: rich.totalTokens,
      subagentSessions: 1,
      activeDays: 1,
      contextSessions: 1,
      nearLimitSessions: 1,
    })
    expect(value.contextTotals).toEqual({
      systemTokens: 4_000,
      toolsTokens: 6_000,
      messageTokens: 10_000,
      sessions: 1,
    })
  })

  it('normalizes malformed context values without inventing windows', () => {
    const value = buildUsageReport(
      [
        richSession('bad', 1, {
          contextPressure: { pressureTokens: -5, projectedTokens: 1.9, contextWindow: 0 },
          contextBreakdown: { systemTokens: Number.NaN, toolsTokens: 2.7, messageTokens: 3 },
        }),
      ],
      2,
    )
    const row = value.bySession[0]!
    expect(row.contextPressure).toEqual({
      pressureTokens: 0,
      projectedTokens: 1,
      contextWindow: null,
    })
    expect(row.contextBreakdown).toEqual({ systemTokens: 0, toolsTokens: 2, messageTokens: 3 })
    expect(value.totals.contextSessions).toBe(0)
    expect(value.totals.nearLimitSessions).toBe(0)
  })

  it('defaults absent occupancy fields to null without a window', () => {
    const value = buildUsageReport(
      [richSession('partial', 1, { contextPressure: { contextWindow: 100 } })],
      2,
    )
    expect(value.bySession[0]!.contextPressure).toEqual({
      pressureTokens: null,
      projectedTokens: null,
      contextWindow: 100,
    })
  })

  it('counts near-limit sessions on the projected share of the window', () => {
    const at = 1
    const value = buildUsageReport(
      [
        richSession('hot', at, {
          contextPressure: { pressureTokens: 90, projectedTokens: 95, contextWindow: 100 },
        }),
        richSession('warm', at, {
          contextPressure: { pressureTokens: 79, projectedTokens: null, contextWindow: 100 },
        }),
        richSession('pressure-hot', at, {
          contextPressure: { pressureTokens: 95, contextWindow: 100 },
        }),
        richSession('empty-pressure', at, {
          contextPressure: { contextWindow: 100 },
        }),
      ],
      2,
    )
    expect(value.totals.contextSessions).toBe(4)
    expect(value.totals.nearLimitSessions).toBe(2)
  })
})
