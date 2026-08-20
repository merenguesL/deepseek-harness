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
