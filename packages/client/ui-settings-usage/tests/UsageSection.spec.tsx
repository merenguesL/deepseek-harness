// @vitest-environment jsdom
/** Usage dashboard behavior: loading (skeleton), error, empty, and ready
 *  states; hover tooltips on the single bars and trend chart; the
 *  granularity / range / metric toggles; the heatmap with its peak cell;
 *  insights; CSV export; auto refresh; the context panel; and the
 *  workspace/session breakdown tabs with filter, sort, badges, and the
 *  jump-to-session affordance. */
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import type {
  UsageContextTotals,
  UsageDescribeValue,
  UsageDayBucket,
  UsageHeatmap,
  UsageHeatmapCalls,
  UsageResponse,
  UsageSessionRow,
  UsageWorkspaceRow,
} from '../src/client/report-types.ts'
/** The branded session id as declared by the row contract. */
type SessionId = UsageSessionRow['sessionId']
import {
  UsageSection,
  composeReportText,
} from '../src/client/UsageSection.tsx'
import {
  CacheRateBar,
  CompositionBar,
  SeriesChart,
} from '../src/client/charts.tsx'
import { Breakdown } from '../src/client/breakdown.tsx'
import { Heatmap } from '../src/client/heatmap.tsx'
import type { UsageSectionInjected } from '../src/client/UsageSection.tsx'
import { UsageStore } from '../src/client/store.ts'
import type { SnapshotSelectorHook } from '@deepseek-ai/dsh-client-ui-slots'
import type { LocaleSnapshot } from '@deepseek-ai/dsh-client-locale/client'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)

const t: UsageSectionInjected['t'] = (key, params) => {
  const template = zh[key]
  if (params === undefined) return template
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match)
}

/** Locale-face stub over the real snapshot shape: a fixed active language. */
const useLocale = <S,>(selector: (snapshot: LocaleSnapshot) => S): S =>
  selector({ active: 'zh', locales: [{ id: 'zh', label: '中文' }], revision: 0 })

const sid = (id: string): SessionId => id as SessionId

function day(key: string, total: number, calls = 1): UsageDayBucket {
  const input = Math.round(total * 0.2)
  const output = Math.round(total * 0.1)
  const cacheRead = Math.round(total * 0.6)
  const cacheWrite = total - input - output - cacheRead
  return {
    day: key,
    uncachedInputTokens: input,
    outputTokens: output,
    cacheReadTokens: cacheRead,
    cacheWriteTokens: cacheWrite,
    totalTokens: total,
    calls,
  }
}

const DAY_KEYS = [
  '2026-07-01',
  '2026-07-02',
  '2026-07-03',
  '2026-07-04',
  '2026-07-05',
  '2026-07-06',
  '2026-07-07',
  '2026-07-08',
  '2026-07-09',
  '2026-07-10',
  '2026-07-11',
  '2026-07-12',
  '2026-07-13',
  '2026-07-14',
]

function sessionRow(overrides: Partial<UsageSessionRow> = {}): UsageSessionRow {
  return {
    sessionId: sid('s1'),
    title: '会话一',
    createdAt: 1,
    updatedAt: Date.now(),
    uncachedInputTokens: 100,
    outputTokens: 50,
    cacheReadTokens: 300,
    cacheWriteTokens: 20,
    totalTokens: 470,
    cacheRate: 0.7142857,
    calls: 12,
    turns: 5,
    steps: 9,
    measured: true,
    asOfSeq: 5,
    running: false,
    contextPressure: null,
    contextBreakdown: null,
    ...overrides,
  }
}

function workspaceRow(
  overrides: Partial<UsageWorkspaceRow>,
): UsageWorkspaceRow {
  return {
    path: '/tmp/fixture',
    sessions: 2,
    uncachedInputTokens: 140,
    outputTokens: 70,
    cacheReadTokens: 420,
    cacheWriteTokens: 30,
    totalTokens: 660,
    cacheRate: 0.7118644,
    calls: 17,
    turns: 7,
    steps: 12,
    ...overrides,
  }
}

function heatmap(): UsageHeatmap {
  return Array.from({ length: 24 }, (_, hour) =>
    Array.from({ length: 7 }, () => (hour >= 9 && hour <= 11 ? 30_000 : 0)),
  )
}

function heatmapCalls(): UsageHeatmapCalls {
  return Array.from({ length: 24 }, (_, hour) =>
    Array.from({ length: 7 }, () => (hour >= 9 && hour <= 11 ? 4 : 0)),
  )
}

const CONTEXT_TOTALS: UsageContextTotals = {
  systemTokens: 4_000,
  toolsTokens: 6_000,
  messageTokens: 10_000,
  sessions: 2,
}

function report(
  overrides: Partial<UsageDescribeValue> = {},
): UsageDescribeValue {
  const series = DAY_KEYS.map((key, index) => day(key, 1_000 + index * 100))
  const now = Date.now()
  return {
    totals: {
      uncachedInputTokens: 20_000,
      outputTokens: 10_000,
      cacheReadTokens: 60_000,
      cacheWriteTokens: 5_000,
      totalTokens: 95_000,
      promptTokens: 85_000,
      cacheRate: 60_000 / 85_000,
      calls: 300,
      sessions: 2,
      measuredSessions: 2,
      turns: 40,
      steps: 70,
      llmMs: 1_000_000,
      firstActivityAt: 1,
      lastActivityAt: 2,
      subagentTokens: 0,
      subagentSessions: 0,
      activeDays: 14,
      contextSessions: 0,
      nearLimitSessions: 0,
    },
    series,
    bySession: [
      sessionRow({
        sessionId: sid('alpha'),
        title: 'Alpha',
        cwd: '/tmp/fixture',
      }),
      sessionRow({ sessionId: sid('beta'), title: null, cwd: '/tmp/fixture' }),
      // A zero-token session, one without a cwd, and old recency buckets.
      sessionRow({
        sessionId: sid('empty'),
        cwd: '/tmp/fixture',
        totalTokens: 0,
        cacheRate: 0,
        uncachedInputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        calls: 0,
        updatedAt: now - 3_600_000,
      }),
      sessionRow({
        sessionId: sid('old'),
        cacheWriteTokens: 0,
        updatedAt: now - 2 * 86_400_000,
      }),
      sessionRow({
        sessionId: sid('ancient'),
        cwd: '/tmp/fixture',
        updatedAt: now - 40 * 86_400_000,
      }),
    ],
    byWorkspace: [
      workspaceRow({}),
      workspaceRow({ path: '', sessions: 1 }),
      workspaceRow({
        path: '/',
        sessions: 1,
        totalTokens: 0,
        cacheRate: 0,
        uncachedInputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        calls: 0,
      }),
    ],
    heatmap: heatmap(),
    heatmapCalls: heatmapCalls(),
    contextTotals: CONTEXT_TOTALS,
    generatedAt: Date.parse('2026-07-14T12:00:00Z'),
    ...overrides,
  }
}

function apiWith(value: UsageDescribeValue | (() => Promise<never>)) {
  return {
    describe: async (): Promise<UsageResponse> => {
      if (typeof value === 'function') return value()
      return { result: { ok: true, value } }
    },
  }
}

interface MountExtras {
  useLocale?: SnapshotSelectorHook<LocaleSnapshot>
  openSession?: (sessionId: SessionId) => void
  close?: () => void
}

async function mountReady(
  overrides: Partial<UsageDescribeValue> = {},
  extras: MountExtras = {},
) {
  const store = new UsageStore(apiWith(report(overrides)))
  render(
    <UsageSection
      controller={store}
      useSnapshot={bindSnapshotSelector(store.store)}
      t={t}
      {...(extras.useLocale === undefined ? {} : { useLocale: extras.useLocale })}
      {...(extras.openSession === undefined ? {} : { openSession: extras.openSession })}
      {...(extras.close === undefined ? {} : { close: extras.close })}
    />,
  )
  await waitFor(() => {
    expect(screen.getByText(zh.title)).toBeTruthy()
  })
  return store
}

describe('UsageSection states', () => {
  it('shows the skeleton until the first report lands', async () => {
    const store = new UsageStore(apiWith(report()))
    render(
      <UsageSection
        controller={store}
        useSnapshot={bindSnapshotSelector(store.store)}
        t={t}
      />,
    )
    expect(screen.getByText(zh.loading)).toBeTruthy()
    expect(document.querySelector('[class*="skeletonLine"]')).toBeTruthy()
    await waitFor(() => {
      expect(screen.getByText(zh.title)).toBeTruthy()
    })
    expect(screen.getByText('95k')).toBeTruthy()
  })

  it('shows the failure state with a working retry', async () => {
    let fail = true
    const store = new UsageStore({
      describe: async (): Promise<UsageResponse> => {
        if (fail) throw new Error('wire down')
        return { result: { ok: true, value: report() } }
      },
    })
    render(
      <UsageSection
        controller={store}
        useSnapshot={bindSnapshotSelector(store.store)}
        t={t}
      />,
    )
    await waitFor(() => {
      expect(screen.getByText(new RegExp(zh.loadFailed))).toBeTruthy()
    })
    fail = false
    fireEvent.click(screen.getByText(zh.retry))
    await waitFor(() => {
      expect(screen.getByText(zh.title)).toBeTruthy()
    })
  })

  it('shows the empty state for a report without usage', async () => {
    const store = new UsageStore(
      apiWith(
        report({
          totals: {
            ...report().totals,
            totalTokens: 0,
            cacheRate: 0,
            promptTokens: 0,
          },
        }),
      ),
    )
    render(
      <UsageSection
        controller={store}
        useSnapshot={bindSnapshotSelector(store.store)}
        t={t}
      />,
    )
    await waitFor(() => {
      expect(screen.getByText(zh.emptyTitle)).toBeTruthy()
    })
    expect(screen.getByText(zh.emptyBody)).toBeTruthy()
    const refreshButtons = screen.getAllByRole('button', { name: zh.refresh })
    const refreshTarget = refreshButtons[1] ?? refreshButtons[0]
    if (refreshTarget !== undefined) fireEvent.click(refreshTarget)
    await waitFor(() => {
      expect(screen.getByText(zh.emptyTitle)).toBeTruthy()
    })
  })

  it('keeps stale data visible with a warning when a refresh fails', async () => {
    let fail = false
    const store = new UsageStore({
      describe: async (): Promise<UsageResponse> => {
        if (fail) throw new Error('wire down')
        return { result: { ok: true, value: report() } }
      },
    })
    render(
      <UsageSection
        controller={store}
        useSnapshot={bindSnapshotSelector(store.store)}
        t={t}
      />,
    )
    await waitFor(() => {
      expect(screen.getByText(zh.title)).toBeTruthy()
    })
    fail = true
    fireEvent.click(screen.getByLabelText(zh.refresh))
    await waitFor(() => {
      expect(screen.getByText(new RegExp(zh.loadFailed))).toBeTruthy()
    })
    // The dashboard is still there underneath the warning.
    expect(screen.getByText(zh.totalTokens)).toBeTruthy()
  })

  it('renders nothing before the shell injects dependencies', () => {
    expect(UsageSection({})).toBeNull()
  })

  it('silently reloads every 30 seconds while auto refresh is on', async () => {
    let calls = 0
    const store = new UsageStore({
      describe: async (): Promise<UsageResponse> => {
        calls += 1
        return { result: { ok: true, value: report() } }
      },
    })
    render(
      <UsageSection
        controller={store}
        useSnapshot={bindSnapshotSelector(store.store)}
        t={t}
      />,
    )
    await waitFor(() => {
      expect(screen.getByText(zh.title)).toBeTruthy()
    })
    expect(calls).toBe(1)
    await act(async () => {
      vi.useFakeTimers()
    })
    fireEvent.click(screen.getByTitle(zh.autoRefresh))
    expect(
      screen.getByTitle(zh.autoRefresh).getAttribute('aria-pressed'),
    ).toBe('true')
    await act(async () => {
      vi.advanceTimersByTime(30_000)
    })
    expect(calls).toBe(2)
    await act(async () => {
      vi.advanceTimersByTime(30_000)
    })
    expect(calls).toBe(3)
    // The loading chrome that follows a reset keeps the toggle on.
    vi.useRealTimers()
    store.reset()
    await waitFor(() => {
      expect(screen.getByTitle(zh.autoRefresh).getAttribute('aria-pressed')).toBe('true')
    })
    await waitFor(() => {
      expect(screen.getByTitle(zh.autoRefresh).getAttribute('aria-pressed')).toBe('true')
    })
    vi.useRealTimers()
  })
})

describe('UsageSection dashboard', () => {
  it('renders the stat cards with compact values and full sub-lines', async () => {
    await mountReady()
    expect(screen.getByText('95k')).toBeTruthy()
    expect(screen.getByText('95,000 · ↑54% 近 7 天')).toBeTruthy()
    expect(screen.getByText('60k')).toBeTruthy()
    expect(screen.getAllByText(zh.cacheRate).length).toBeGreaterThan(0)
    expect(screen.getAllByText('70.6%').length).toBeGreaterThan(0)
    expect(screen.getByText('300')).toBeTruthy()
    expect(screen.getByText(zh.measuredSub.replace('{n}', '2').replace('{total}', '2'))).toBeTruthy()
    expect(screen.getByText('14')).toBeTruthy()
    expect(screen.getAllByText('0.0%').length).toBeGreaterThan(0)
  })

  it('localizes compact card values for the zh locale', async () => {
    await mountReady({}, { useLocale })
    expect(screen.getByText('9.5万')).toBeTruthy()
    expect(screen.getByText('6万')).toBeTruthy()
  })

  it('shows falling and flat week deltas on the total card', async () => {
    const falling = DAY_KEYS.map((key, index) => day(key, 10_000 - index * 500))
    await mountReady({ series: falling })
    expect(screen.getByText(/95,000 · ↓/)).toBeTruthy()
    cleanup()
    const flat = DAY_KEYS.map(key => day(key, 10_000))
    await mountReady({ series: flat })
    expect(screen.getByText('95,000 · ' + zh.deltaFlat)).toBeTruthy()
  })

  it('renders today and last-7-days cards from the series', async () => {
    await mountReady()
    expect(screen.getByText(zh.today)).toBeTruthy()
    expect(screen.getByText('2.3k')).toBeTruthy()
    expect(screen.getAllByText(zh.last7Days).length).toBeGreaterThan(0)
    expect(screen.getByText('14k')).toBeTruthy()
  })

  it('shows the no-usage-yet sub-line on an empty today card', async () => {
    await mountReady({ series: [] })
    expect(screen.getByText(zh.todayNone)).toBeTruthy()
  })

  it('renders auto-generated insights with severity dots', async () => {
    await mountReady()
    expect(screen.getByText(zh.insightTitle)).toBeTruthy()
    expect(screen.getByText(zh.insightCacheGood.replace('{rate}', '71%'))).toBeTruthy()
    expect(screen.getByText(zh.insightWeekUp.replace('{delta}', '54%'))).toBeTruthy()
    expect(
      screen.getByText(
        zh.insightPeakHour.replace('{weekday}', '日').replace('{hour}', '9'),
      ),
    ).toBeTruthy()
  })

  it('renders the near-limit and subagent insights for the flagged report', async () => {
    await mountReady({
      totals: {
        ...report().totals,
        nearLimitSessions: 2,
        subagentTokens: 47_500,
        subagentSessions: 1,
      },
    })
    expect(
      screen.getByText(
        zh.insightNearLimit.replace('{n}', '2').replace('{pct}', '80%'),
      ),
    ).toBeTruthy()
    expect(screen.getByText(zh.insightSubagent.replace('{share}', '50%'))).toBeTruthy()
  })

  it('exports the session breakdown as CSV', async () => {
    const created: Blob[] = []
    const revoked: string[] = []
    ;(URL as unknown as Record<string, unknown>).createObjectURL = (blob: Blob) => {
      created.push(blob)
      return 'blob:mock'
    }
    ;(URL as unknown as Record<string, unknown>).revokeObjectURL = (url: string) => {
      revoked.push(url)
    }
    // oxlint-disable-next-line typescript/unbound-method -- saving the native method so the stub can restore it
    const nativeClick = HTMLAnchorElement.prototype.click
    HTMLAnchorElement.prototype.click = (): void => {}
    await mountReady()
    vi.useFakeTimers()
    fireEvent.click(screen.getByLabelText(zh.exportCsv))
    await act(async () => {})
    expect(created).toHaveLength(1)
    expect(revoked).toEqual(['blob:mock'])
    expect(screen.getByText(zh.copied)).toBeTruthy()
    await act(async () => {
      vi.advanceTimersByTime(2000)
    })
    expect(screen.getByLabelText(zh.exportCsv)).toBeTruthy()
    vi.useRealTimers()
    HTMLAnchorElement.prototype.click = nativeClick
    const text = await created[0]!.text()
    expect(text.startsWith('sessionId,title,cwd')).toBe(true)
    expect(text).toContain('Alpha,/tmp/fixture')
    expect(text.endsWith('\r\n')).toBe(true)
    Reflect.deleteProperty(URL, 'createObjectURL')
    Reflect.deleteProperty(URL, 'revokeObjectURL')
  })

  it('reports a missing download URL API as an export failure', async () => {
    Reflect.deleteProperty(URL, 'createObjectURL')
    Reflect.deleteProperty(URL, 'revokeObjectURL')
    await mountReady()
    fireEvent.click(screen.getByLabelText(zh.exportCsv))
    await waitFor(() => {
      expect(screen.getByText(zh.exportFailed)).toBeTruthy()
    })
  })

  it('refreshes on demand and updates the freshness stamp', async () => {
    let calls = 0
    const store = new UsageStore({
      describe: async (): Promise<UsageResponse> => {
        calls += 1
        return {
          result: {
            ok: true,
            value: report({ generatedAt: Date.parse('2026-07-14T13:00:00Z') }),
          },
        }
      },
    })
    render(
      <UsageSection
        controller={store}
        useSnapshot={bindSnapshotSelector(store.store)}
        t={t}
      />,
    )
    await waitFor(() => {
      expect(screen.getByText(zh.title)).toBeTruthy()
    })
    expect(calls).toBe(1)
    fireEvent.click(screen.getByLabelText(zh.refresh))
    await waitFor(() => {
      expect(calls).toBe(2)
    })
  })

  it('reveals exact segment numbers when hovering the composition bar', async () => {
    await mountReady()
    const segment = screen.getByText(zh.inputTokensFull)
    fireEvent.mouseEnter(segment)
    const tooltip = screen.getByRole('tooltip')
    expect(within(tooltip).getByText(/20,000/)).toBeTruthy()
    fireEvent.mouseLeave(segment)
    expect(screen.queryByRole('tooltip')).toBeNull()
  })

  it('reveals exact figures when hovering the composition segment div', async () => {
    await mountReady()
    const segmentDiv = screen
      .getByText(zh.inputTokensFull)
      .closest('div')!
      .parentElement!.querySelector('[class*="segment"]')!
    fireEvent.mouseEnter(segmentDiv)
    expect(screen.getByRole('tooltip')).toBeTruthy()
    fireEvent.mouseLeave(segmentDiv)
    expect(screen.queryByRole('tooltip')).toBeNull()
  })

  it('reveals exact figures when hovering the cache-rate bar', async () => {
    await mountReady()
    const bar = screen
      .getByText(zh.cacheRateBar)
      .closest('section')!
      .querySelector('[class*="bar"]')!
    fireEvent.mouseEnter(bar)
    const tooltip = screen.getByRole('tooltip')
    expect(within(tooltip).getByText(/60,000/)).toBeTruthy()
    expect(within(tooltip).getByText(/85,000/)).toBeTruthy()
    fireEvent.mouseLeave(bar)
    expect(screen.queryByRole('tooltip')).toBeNull()
  })

  it('renders the heuristic context composition bar with legend and hover', async () => {
    await mountReady()
    expect(screen.getByText(zh.contextPanel)).toBeTruthy()
    expect(screen.getByText(zh.contextSystem)).toBeTruthy()
    expect(screen.getByText(zh.contextTools)).toBeTruthy()
    expect(screen.getByText(zh.contextMessages)).toBeTruthy()
    expect(screen.getByText(zh.contextSessions.replace('{n}', '2'))).toBeTruthy()
    const segmentDiv = screen
      .getByText(zh.contextSystem)
      .closest('div')!
      .parentElement!.querySelector('[class*="segment"]')!
    fireEvent.mouseEnter(segmentDiv)
    const tooltip = screen.getByRole('tooltip')
    expect(within(tooltip).getByText(/4,000/)).toBeTruthy()
    fireEvent.mouseLeave(segmentDiv)
    const legend = screen.getAllByText(zh.contextTools).at(-1)!
    fireEvent.mouseEnter(legend)
    expect(screen.getByRole('tooltip')).toBeTruthy()
    fireEvent.mouseLeave(legend)
    expect(screen.queryByRole('tooltip')).toBeNull()
    expect(screen.queryByRole('tooltip')).toBeNull()
  })

  it('shows the context panel empty hint without estimates', async () => {
    await mountReady({
      contextTotals: { systemTokens: 0, toolsTokens: 0, messageTokens: 0, sessions: 0 },
    })
    expect(screen.getByText(zh.contextEmpty)).toBeTruthy()
  })

  it('switches the trend granularity and shows the delta chip', async () => {
    await mountReady()
    expect(
      screen
        .getByRole('tab', { name: zh.granularityDay })
        .getAttribute('aria-selected'),
    ).toBe('true')
    fireEvent.click(screen.getByRole('tab', { name: zh.granularityWeek }))
    expect(
      screen
        .getByRole('tab', { name: zh.granularityWeek })
        .getAttribute('aria-selected'),
    ).toBe('true')
    fireEvent.click(screen.getByRole('tab', { name: zh.granularityMonth }))
    expect(
      screen
        .getByRole('tab', { name: zh.granularityMonth })
        .getAttribute('aria-selected'),
    ).toBe('true')
    // 14 daily buckets roll into two calendar weeks; a full day window
    // exists, so the delta chip shows for the day granularity.
    fireEvent.click(screen.getByRole('tab', { name: zh.granularityDay }))
    expect(screen.getByText(zh.peak)).toBeTruthy()
  })

  it('switches the trend metric to output and cache hit rate', async () => {
    render(<SeriesChart series={DAY_KEYS.map((key, index) => day(key, 1_000 + index * 100))} t={t} />)
    const svgLabel = (): string | null =>
      document.querySelector('[role="img"]')!.getAttribute('aria-label')
    expect(svgLabel()).toBe(zh.trend + ' · ' + zh.metricTotal)
    fireEvent.click(screen.getByRole('radio', { name: zh.metricOutput }))
    expect(svgLabel()).toBe(zh.trend + ' · ' + zh.metricOutput)
    expect(screen.getByText(zh.peak)).toBeTruthy()
    fireEvent.click(screen.getByRole('radio', { name: zh.metricRate }))
    expect(svgLabel()).toBe(zh.trend + ' · ' + zh.metricRate)
    expect(screen.getByText('100%')).toBeTruthy()
    expect(screen.getByText(zh.trendRateHint.replace('{unit}', zh.granularityDay))).toBeTruthy()
    expect(screen.queryByText(zh.peak)).toBeNull()
    // Hovering a rate point shows the hit-rate row above the bucket rows.
    const overlay = document.querySelector('[role="img"] rect[fill="transparent"]')!
    fireEvent.mouseEnter(overlay)
    expect(screen.getAllByText(zh.metricRate).length).toBeGreaterThan(0)
    fireEvent.mouseLeave(overlay)
  })

  it('shows falling and flat period deltas', () => {
    const falling = DAY_KEYS.map((key, index) =>
      day(key, 10_000 - index * 500),
    )
    const { unmount } = render(<SeriesChart series={falling} t={t} />)
    expect(
      screen.getByText(content => content.startsWith('\u2193')),
    ).toBeTruthy()
    unmount()
    const flat = DAY_KEYS.map(key => day(key, 10_000))
    render(<SeriesChart series={flat} t={t} />)
    expect(screen.getByText(zh.deltaFlat)).toBeTruthy()
  })

  it('renders a chart with all-zero buckets and zero-prompt bars directly', () => {
    render(<SeriesChart series={[day('2026-07-01', 0)]} t={t} />)
    expect(screen.getByText(zh.peak)).toBeTruthy()
    render(
      <CompositionBar
        buckets={{
          uncachedInputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
        }}
        total={0}
        t={t}
      />,
    )
    render(
      <CacheRateBar
        uncachedInputTokens={0}
        cacheReadTokens={0}
        cacheWriteTokens={0}
        t={t}
      />,
    )
    expect(screen.queryByRole('tooltip')).toBeNull()
  })

  it('shows the hover tooltip over a trend bar', async () => {
    await mountReady()
    const svg = document.querySelector(
      '[role="img"][aria-label^="' + zh.trend + '"]',
    )!
    // The transparent overlay rect per bucket is the hover target; the first
    // one belongs to the first (leftmost) day.
    const overlay = svg.querySelector('rect[fill="transparent"]')!
    fireEvent.mouseEnter(overlay)
    expect(screen.getByText('2026-07-01')).toBeTruthy()
    fireEvent.mouseLeave(overlay)
    expect(screen.queryByText('2026-07-01')).toBeNull()
  })
  it('shows the heatmap with tooltip, calls row, and the peak caption', async () => {
    await mountReady()
    expect(screen.getByText(zh.heatmapHigh)).toBeTruthy()
    expect(screen.getByText(zh.heatmapPeak.replace('{weekday}', '日').replace('{hour}', '9'))).toBeTruthy()
    const cell = document.querySelector('[class*="cellPeak"]') as HTMLButtonElement
    expect(cell).toBeTruthy()
    expect(cell.className.includes('cellHot')).toBe(true)
    fireEvent.mouseEnter(cell)
    await waitFor(() => {
      expect(screen.getAllByText(/30,000/).length).toBeGreaterThan(0)
    })
    expect(within(screen.getByRole('tooltip')).getByText(zh.calls)).toBeTruthy()
    fireEvent.mouseLeave(cell)
    await waitFor(() => {
      expect(screen.queryByRole('tooltip')).toBeNull()
    })
    // Hovering an empty cell shows nothing (scoped to the heatmap grid so
    // the toolbar's own buttons stay out of the search).
    const grid = document.querySelector('[class*="heatmapGrid"]')!
    const cold = Array.from(grid.querySelectorAll('button')).find(
      button => !button.className.includes('cellHot'),
    )!
    fireEvent.mouseEnter(cold)
    await waitFor(() => {
      expect(screen.queryByRole('tooltip')).toBeNull()
    })
  })

  it('shows the empty heatmap hint when no cell has usage', async () => {
    await mountReady({
      heatmap: Array.from({ length: 24 }, () =>
        Array.from({ length: 7 }, () => 0),
      ),
      heatmapCalls: Array.from({ length: 24 }, () =>
        Array.from({ length: 7 }, () => 0),
      ),
    })
    expect(screen.getByText(zh.heatmapEmpty)).toBeTruthy()
  })

  it('lists workspaces and switches to the session breakdown', async () => {
    await mountReady()
    expect(screen.getByText('fixture')).toBeTruthy()
    expect(screen.getByText(zh.unknownWorkspace)).toBeTruthy()
    expect(screen.getByText(new RegExp(zh.sessions + ': 2'))).toBeTruthy()
    fireEvent.click(screen.getByRole('tab', { name: zh.bySession }))
    expect(screen.getByText('Alpha')).toBeTruthy()
    expect(screen.getByText(zh.untitledSession)).toBeTruthy()
  })

  it('renders empty breakdown lists', async () => {
    await mountReady({ byWorkspace: [], bySession: [] })
    expect(screen.getByText(zh.noWorkspaces)).toBeTruthy()
    fireEvent.click(screen.getByRole('tab', { name: zh.bySession }))
    expect(screen.getByText(zh.noSessions)).toBeTruthy()
  })

  it('filters sessions by the search box and reports misses', async () => {
    await mountReady()
    fireEvent.click(screen.getByRole('tab', { name: zh.bySession }))
    const box = screen.getByPlaceholderText(zh.searchPlaceholder)
    fireEvent.change(box, { target: { value: 'Alpha' } })
    expect(screen.getByText('Alpha')).toBeTruthy()
    expect(screen.queryByText(zh.untitledSession)).toBeNull()
    fireEvent.change(box, { target: { value: 'zzz-no-match' } })
    expect(screen.getByText(zh.noMatch)).toBeTruthy()
    fireEvent.change(box, { target: { value: '  ' } })
    expect(screen.getByText('Alpha')).toBeTruthy()
  })

  it('sorts sessions by tokens or by recency', async () => {
    const now = Date.now()
    await mountReady({
      bySession: [
        sessionRow({
          sessionId: sid('small'),
          title: 'Small',
          totalTokens: 100,
          uncachedInputTokens: 100,
          updatedAt: now - 3_600_000,
        }),
        sessionRow({
          sessionId: sid('big'),
          title: 'Big',
          totalTokens: 900,
          uncachedInputTokens: 900,
          updatedAt: now - 7_200_000,
        }),
      ],
    })
    fireEvent.click(screen.getByRole('tab', { name: zh.bySession }))
    const names = (): string[] =>
      Array.from(document.querySelectorAll('[class*="rowName"]')).map(
        node => node.textContent ?? '',
      )
    expect(names()[0]).toBe('Big')
    fireEvent.click(screen.getByRole('radio', { name: zh.sortRecent }))
    expect(names()[0]).toBe('Small')
    fireEvent.click(screen.getByRole('radio', { name: zh.sortTokens }))
    expect(names()[0]).toBe('Big')
  })

  it('shows subagent and running badges on session rows', async () => {
    await mountReady({
      bySession: [
        sessionRow({
          sessionId: sid('child'),
          title: '子任务',
          origin: 'subagent',
          running: true,
        }),
      ],
    })
    fireEvent.click(screen.getByRole('tab', { name: zh.bySession }))
    expect(screen.getByText(zh.subagentBadge)).toBeTruthy()
    expect(screen.getByText(zh.runningBadge)).toBeTruthy()
  })

  it('shows the agent preset fragment when the row records one', async () => {
    await mountReady({
      bySession: [sessionRow({ sessionId: sid('preset'), title: '预设', agentPreset: 'coder' })],
    })
    fireEvent.click(screen.getByRole('tab', { name: zh.bySession }))
    expect(screen.getByText(/coder/)).toBeTruthy()
  })

  it('shows the context-occupancy meter and warns near the window limit', async () => {
    await mountReady({
      bySession: [
        sessionRow({
          sessionId: sid('full'),
          title: '接近上限',
          contextPressure: {
            pressureTokens: 150_000,
            projectedTokens: 160_000,
            contextWindow: 200_000,
          },
        }),
        sessionRow({
          sessionId: sid('mid'),
          title: '健康',
          contextPressure: {
            pressureTokens: 50_000,
            projectedTokens: null,
            contextWindow: 200_000,
          },
        }),
        sessionRow({
          sessionId: sid('nowin'),
          title: '无窗口',
          contextPressure: {
            pressureTokens: 1_000,
            projectedTokens: null,
            contextWindow: null,
          },
        }),
      ],
    })
    fireEvent.click(screen.getByRole('tab', { name: zh.bySession }))
    expect(screen.getByText('80%')).toBeTruthy()
    expect(screen.getByText('25%')).toBeTruthy()
    const dashes = screen.getAllByText('—')
    expect(dashes.length).toBeGreaterThanOrEqual(1)
  })

  it('opens the session and closes settings when a row is clicked', async () => {
    const opened: SessionId[] = []
    let closed = false
    await mountReady({}, {
      openSession: (id) => { opened.push(id) },
      close: () => { closed = true },
    })
    fireEvent.click(screen.getByRole('tab', { name: zh.bySession }))
    fireEvent.click(screen.getByText('Alpha'))
    expect(opened).toEqual([sid('alpha')])
    expect(closed).toBe(true)
  })

  it('renders session rows as plain rows without the sessions face', async () => {
    await mountReady()
    fireEvent.click(screen.getByRole('tab', { name: zh.bySession }))
    const row = screen.getByText('Alpha').closest('button')!
    expect(row.className.includes('rowClickable')).toBe(false)
    fireEvent.click(row)
  })

  it('shows the coverage note only when some sessions lack a projection', async () => {
    await mountReady({ totals: { ...report().totals, measuredSessions: 1 } })
    expect(screen.getByText(zh.coverageNote.replace('{n}', '1'))).toBeTruthy()
  })

  it('omits the coverage note when every session is measured', async () => {
    await mountReady()
    expect(screen.queryByText(zh.coverageNote.replace('{n}', '0'))).toBeNull()
    expect(screen.queryByText(zh.coverageNote.replace('{n}', '2'))).toBeNull()
  })
  it('filters the trend by trailing range and sums the visible series', () => {
    const now = Date.now()
    const recent = Array.from({ length: 14 }, (_, index) => {
      const date = new Date(now - (13 - index) * 86_400_000)
      const pad = (value: number): string => String(value).padStart(2, '0')
      return day(
        `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
        1_000,
        2,
      )
    })
    render(<SeriesChart series={recent} t={t} />)
    // Four range presets plus three metric options.
    const radios = screen.getAllByRole('radio')
    expect(radios).toHaveLength(7)
    fireEvent.click(
      screen.getByRole('radio', { name: zh.rangeDays.replace('{days}', '7') }),
    )
    expect(
      screen
        .getByRole('radio', { name: zh.rangeDays.replace('{days}', '7') })
        .getAttribute('aria-checked'),
    ).toBe('true')
    const escape = (text: string): string => text.replace(/[.*+?^`{}()|[\]\\]/g, '\\$&')
    expect(
      screen.getByText(
        new RegExp(
          escape(
            zh.rangeSummary
              .replace('{days}', '7')
              .replace('{tokens}', '7,000')
              .replace('{calls}', '14'),
          ),
        ),
      ),
    ).toBeTruthy()
    fireEvent.click(screen.getByRole('radio', { name: zh.rangeAll }))
    expect(screen.queryByText(zh.rangeSummary.slice(0, 10))).toBeNull()
    fireEvent.click(
      screen.getByRole('radio', { name: zh.rangeDays.replace('{days}', '30') }),
    )
    expect(
      screen.getByText(
        new RegExp(
          escape(
            zh.rangeSummary
              .replace('{days}', '30')
              .replace('{tokens}', '14,000')
              .replace('{calls}', '28'),
          ),
        ),
      ),
    ).toBeTruthy()
    fireEvent.click(
      screen.getByRole('radio', { name: zh.rangeDays.replace('{days}', '90') }),
    )
    expect(
      screen
        .getByRole('radio', { name: zh.rangeDays.replace('{days}', '90') })
        .getAttribute('aria-checked'),
    ).toBe('true')
  })

  it('copies the plain-text report and shows transient feedback', async () => {
    const writes: string[] = []
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async (text: string): Promise<void> => {
          writes.push(text)
        },
      },
    })
    await mountReady()
    vi.useFakeTimers()
    fireEvent.click(screen.getByLabelText(zh.copyReport))
    await act(async () => {})
    expect(screen.getByText(zh.copied)).toBeTruthy()
    act(() => {
      vi.advanceTimersByTime(2000)
    })
    expect(screen.queryByText(zh.copied)).toBeNull()
    expect(screen.getByLabelText(zh.copyReport)).toBeTruthy()
    vi.useRealTimers()
    expect(writes[0]?.startsWith(zh.title)).toBe(true)
    expect(writes[0]).toContain('95,000')
    expect(writes[0]).toContain('2026-07-01: 1,000')
    expect(writes[0]).toContain('Alpha')
  })

  it('reports a clipboard rejection as a copy failure', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async (): Promise<void> => {
          throw new Error('denied')
        },
      },
    })
    await mountReady()
    fireEvent.click(screen.getByLabelText(zh.copyReport))
    await waitFor(() => {
      expect(screen.getByText(zh.copyFailed)).toBeTruthy()
    })
  })

  it('reports a missing clipboard API as a copy failure', async () => {
    Reflect.deleteProperty(navigator, 'clipboard')
    await mountReady()
    fireEvent.click(screen.getByLabelText(zh.copyReport))
    await waitFor(() => {
      expect(screen.getByText(zh.copyFailed)).toBeTruthy()
    })
  })

  it('composes the plain-text report without series or sessions', () => {
    const empty = report({ series: [], bySession: [] })
    const text = composeReportText(empty, t)
    expect(text.startsWith(zh.title + '\n' + zh.totalTokens + ': 95,000')).toBe(
      true,
    )
    expect(text.includes('2026-07-01')).toBe(false)
    expect(text.includes(zh.bySession)).toBe(false)
  })

  it('marks sessions without a projection as not counted in the breakdown', async () => {
    const missing = sessionRow({
      sessionId: sid('missing'),
      title: null,
      measured: false,
      asOfSeq: null,
    })
    await mountReady({ bySession: [missing] })
    fireEvent.click(screen.getByRole('tab', { name: zh.bySession }))
    expect(screen.getByText(zh.untitledSession)).toBeTruthy()
    expect(screen.getByText(new RegExp(zh.unmeasured))).toBeTruthy()
  })

  it('shows a short id fragment for long session ids', async () => {
    const longId = sessionRow({
      sessionId: sid('0123456789abcdef-suffix'),
      title: null,
      measured: false,
      asOfSeq: null,
    })
    await mountReady({ bySession: [longId] })
    fireEvent.click(screen.getByRole('tab', { name: zh.bySession }))
    expect(screen.getByText(/def-suffix/)).toBeTruthy()
  })

  it('shows the share-of-total row in the heatmap tooltip', async () => {
    await mountReady()
    const cell = screen
      .getAllByRole('button', { hidden: false })
      .find(button => button.className.includes('cellHot'))!
    fireEvent.mouseEnter(cell)
    await waitFor(() => {
      expect(screen.getByText(zh.shareOfTotal)).toBeTruthy()
    })
    await waitFor(() => {
      expect(screen.getAllByText('31.6%').length).toBeGreaterThan(0)
    })
  })

  it('renders a zero-total heatmap share row safely', () => {
    render(
      <Heatmap
        heatmap={heatmap()}
        calls={heatmapCalls()}
        total={0}
        weekdayLabels={['一', '二', '三', '四', '五', '六', '日']}
        t={t}
      />,
    )
    const cell = screen
      .getAllByRole('button')
      .find(button => button.className.includes('cellHot'))!
    fireEvent.mouseEnter(cell)
    expect(screen.getByText(zh.shareOfTotal)).toBeTruthy()
    expect(screen.getByText('0.0%')).toBeTruthy()
  })

  it('shows minute and hour recency fragments in the session sub-line', async () => {
    const now = Date.now()
    await mountReady({
      bySession: [
        sessionRow({ sessionId: sid('min'), title: '分钟', updatedAt: now - 5 * 60_000 }),
        sessionRow({ sessionId: sid('hour'), title: '小时', updatedAt: now - 3 * 3_600_000 }),
      ],
    })
    fireEvent.click(screen.getByRole('tab', { name: zh.bySession }))
    expect(screen.getByText(/5 分钟前/)).toBeTruthy()
    expect(screen.getByText(/3 小时前/)).toBeTruthy()
  })

  it('shows a 0.0% share fragment for a zero-token workspace', async () => {
    await mountReady({
      byWorkspace: [workspaceRow({ path: '/z', sessions: 1, totalTokens: 0, cacheRate: 0, uncachedInputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, calls: 0 })],
    })
    expect(screen.getByText(/占总量 0.0%/)).toBeTruthy()
  })

  it('omits the workspace share fragment when the report total is zero', () => {
    const zero = report({
      byWorkspace: [workspaceRow({ path: '/z', sessions: 1 })],
      totals: { ...report().totals, totalTokens: 0 },
    })
    render(<Breakdown value={zero} t={t} />)
    expect(screen.queryByText(/占总量/)).toBeNull()
  })

  it('shows the just-now recency label for a session touched this minute', async () => {
    await mountReady({
      bySession: [sessionRow({ sessionId: sid('fresh'), title: '新鲜', updatedAt: Date.now() })],
    })
    fireEvent.click(screen.getByRole('tab', { name: zh.bySession }))
    expect(screen.getByText(/刚刚/)).toBeTruthy()
  })
})

describe('UsageStore', () => {
  it('reset drops the loaded report', async () => {
    const store = new UsageStore(apiWith(report()))
    await act(async () => {
      await store.load()
    })
    expect(store.store.getSnapshot().status).toBe('ready')
    store.reset()
    expect(store.store.getSnapshot().status).toBe('idle')
  })

  it('records a non-Error rejection as its string form', async () => {
    const store = new UsageStore({
      describe: async (): Promise<UsageResponse> => {
        throw 'boom'
      },
    })
    await act(async () => {
      await store.load()
    })
    const state = store.store.getSnapshot()
    expect(state.status).toBe('error')
    expect(state.error).toBe('boom')
  })

  it('records a refused wire response as its error message', async () => {
    const store = new UsageStore({
      describe: async (): Promise<UsageResponse> => ({
        result: {
          ok: false,
          error: { code: 'internal', message: 'host says no', details: {} },
        },
      }),
    })
    await act(async () => {
      await store.load()
    })
    expect(store.store.getSnapshot().error).toBe('host says no')
  })

  it('discards a superseded failure without flipping the store', async () => {
    const settles: Array<(value: unknown) => void> = []
    const store = new UsageStore({
      describe: (): Promise<UsageResponse> =>
        new Promise((_resolve, reject) => {
          settles.push(reject)
        }),
    })
    const first = store.load()
    const second = store.load()
    settles[0]!(new Error('stale failure'))
    await act(async () => {
      await first
    })
    expect(store.store.getSnapshot().status).toBe('loading')
    settles[1]!(new Error('still failing'))
    await act(async () => {
      await second
    })
    expect(store.store.getSnapshot().status).toBe('error')
    expect(store.store.getSnapshot().error).toBe('still failing')
  })

  it('a newer load supersedes a slower older one', async () => {
    const settles: Array<(value: UsageResponse) => void> = []
    const store = new UsageStore({
      describe: (): Promise<UsageResponse> =>
        new Promise((resolve) => {
          settles.push(resolve)
        }),
    })
    const first = store.load()
    const second = store.load()
    settles[1]!({
      result: { ok: true, value: report({ generatedAt: 2 }) },
    })
    await act(async () => {
      await second
    })
    settles[0]!({
      result: { ok: true, value: report({ generatedAt: 1 }) },
    })
    await act(async () => {
      await first
    })
    expect(store.store.getSnapshot().value?.generatedAt).toBe(2)
  })
})
