// @vitest-environment jsdom
/** Usage dashboard behavior: loading, error, empty, and ready states; hover
 *  tooltips on the single bars and trend chart; the day/week/month toggle;
 *  the heatmap; and the workspace/session breakdown tabs. */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import type { UsageDescribeValue, UsageDayBucket, UsageHeatmap, UsageResponse, UsageSessionRow, UsageWorkspaceRow } from '../src/client/report-types.ts'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { UsageSection } from '../src/client/UsageSection.tsx'
import { CacheRateBar, CompositionBar, SeriesChart } from '../src/client/charts.tsx'
import type { UsageSectionInjected } from '../src/client/UsageSection.tsx'
import { UsageStore } from '../src/client/store.ts'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)

const t: UsageSectionInjected['t'] = key => zh[key]

const sid = (id: string): SessionId => id as SessionId

function day(key: string, total: number, calls = 1): UsageDayBucket {
  const input = Math.round(total * 0.2)
  const output = Math.round(total * 0.1)
  const cacheRead = Math.round(total * 0.6)
  const cacheWrite = total - input - output - cacheRead
  return {
    day: key, uncachedInputTokens: input, outputTokens: output, cacheReadTokens: cacheRead,
    cacheWriteTokens: cacheWrite, totalTokens: total, calls,
  }
}

const DAY_KEYS = [
  '2026-07-01', '2026-07-02', '2026-07-03', '2026-07-04', '2026-07-05', '2026-07-06', '2026-07-07',
  '2026-07-08', '2026-07-09', '2026-07-10', '2026-07-11', '2026-07-12', '2026-07-13', '2026-07-14',
]

function sessionRow(overrides: Partial<UsageSessionRow> = {}): UsageSessionRow {
  return {
    sessionId: sid('s1'), title: '会话一', createdAt: 1, updatedAt: Date.now(),
    uncachedInputTokens: 100, outputTokens: 50, cacheReadTokens: 300, cacheWriteTokens: 20,
    totalTokens: 470, cacheRate: 0.7142857, calls: 12, turns: 5, steps: 9,
    ...overrides,
  }
}

function workspaceRow(overrides: Partial<UsageWorkspaceRow>): UsageWorkspaceRow {
  return {
    path: '/tmp/fixture', sessions: 2,
    uncachedInputTokens: 140, outputTokens: 70, cacheReadTokens: 420, cacheWriteTokens: 30,
    totalTokens: 660, cacheRate: 0.7118644, calls: 17, turns: 7, steps: 12,
    ...overrides,
  }
}

function heatmap(): UsageHeatmap {
  return Array.from({ length: 24 }, (_, hour) =>
    Array.from({ length: 7 }, () => (hour >= 9 && hour <= 11 ? 30_000 : 0)))
}

function report(overrides: Partial<UsageDescribeValue> = {}): UsageDescribeValue {
  const series = DAY_KEYS.map((key, index) => day(key, 1_000 + index * 100))
  const now = Date.now()
  return {
    totals: {
      uncachedInputTokens: 20_000, outputTokens: 10_000, cacheReadTokens: 60_000,
      cacheWriteTokens: 5_000, totalTokens: 95_000, promptTokens: 85_000,
      cacheRate: 60_000 / 85_000, calls: 300, sessions: 2, turns: 40, steps: 70,
      llmMs: 1_000_000, firstActivityAt: 1, lastActivityAt: 2,
    },
    series,
    bySession: [
      sessionRow({ sessionId: sid('alpha'), title: 'Alpha', cwd: '/tmp/fixture' }),
      sessionRow({ sessionId: sid('beta'), title: null, cwd: '/tmp/fixture' }),
      // A zero-token session, one without a cwd, and old recency buckets.
      sessionRow({ sessionId: sid('empty'), cwd: '/tmp/fixture', totalTokens: 0, cacheRate: 0, uncachedInputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, calls: 0, updatedAt: now - 3_600_000 }),
      sessionRow({ sessionId: sid('old'), cacheWriteTokens: 0, updatedAt: now - 2 * 86_400_000 }),
      sessionRow({ sessionId: sid('ancient'), cwd: '/tmp/fixture', updatedAt: now - 40 * 86_400_000 }),
    ],
    byWorkspace: [
      workspaceRow({}),
      workspaceRow({ path: '', sessions: 1 }),
      workspaceRow({ path: '/', sessions: 1, totalTokens: 0, cacheRate: 0, uncachedInputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, calls: 0 }),
    ],
    heatmap: heatmap(),
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

async function mountReady(overrides: Partial<UsageDescribeValue> = {}) {
  const store = new UsageStore(apiWith(report(overrides)))
  render(<UsageSection controller={store} useSnapshot={bindSnapshotSelector(store.store)} t={t} />)
  await waitFor(() => {expect(screen.getByText(zh.title)).toBeTruthy()})
  return store
}

describe('UsageSection states', () => {
  it('shows the loading state until the first report lands', async () => {
    const store = new UsageStore(apiWith(report()))
    render(<UsageSection controller={store} useSnapshot={bindSnapshotSelector(store.store)} t={t} />)
    expect(screen.getByText(zh.loading)).toBeTruthy()
    await waitFor(() => {expect(screen.getByText(zh.title)).toBeTruthy()})
  })

  it('shows the failure state with a working retry', async () => {
    let fail = true
    const store = new UsageStore({
      describe: async (): Promise<UsageResponse> => {
        if (fail) throw new Error('wire down')
        return { result: { ok: true, value: report() } }
      },
    })
    render(<UsageSection controller={store} useSnapshot={bindSnapshotSelector(store.store)} t={t} />)
    await waitFor(() => {expect(screen.getByText(new RegExp(zh.loadFailed))).toBeTruthy()})
    fail = false
    fireEvent.click(screen.getByText(zh.retry))
    await waitFor(() => {expect(screen.getByText(zh.title)).toBeTruthy()})
  })

  it('shows the empty state for a report without usage', async () => {
    const store = new UsageStore(apiWith(report({
      totals: { ...report().totals, totalTokens: 0, cacheRate: 0, promptTokens: 0 },
    })))
    render(<UsageSection controller={store} useSnapshot={bindSnapshotSelector(store.store)} t={t} />)
    await waitFor(() => {expect(screen.getByText(zh.emptyTitle)).toBeTruthy()})
    expect(screen.getByText(zh.emptyBody)).toBeTruthy()
    const refreshButtons = screen.getAllByRole('button', { name: zh.refresh })
    const refreshTarget = refreshButtons[1] ?? refreshButtons[0]
    if (refreshTarget !== undefined) fireEvent.click(refreshTarget)
    await waitFor(() => {expect(screen.getByText(zh.emptyTitle)).toBeTruthy()})
  })

  it('keeps stale data visible with a warning when a refresh fails', async () => {
    let fail = false
    const store = new UsageStore({
      describe: async (): Promise<UsageResponse> => {
        if (fail) throw new Error('wire down')
        return { result: { ok: true, value: report() } }
      },
    })
    render(<UsageSection controller={store} useSnapshot={bindSnapshotSelector(store.store)} t={t} />)
    await waitFor(() => {expect(screen.getByText(zh.title)).toBeTruthy()})
    fail = true
    fireEvent.click(screen.getByLabelText(zh.refresh))
    await waitFor(() => {expect(screen.getByText(new RegExp(zh.loadFailed))).toBeTruthy()})
    // The dashboard is still there underneath the warning.
    expect(screen.getByText(zh.totalTokens)).toBeTruthy()
  })

  it('renders nothing before the shell injects dependencies', () => {
    expect(UsageSection({})).toBeNull()
  })
})

describe('UsageSection dashboard', () => {
  it('renders the stat cards with compact values and full sub-lines', async () => {
    await mountReady()
    expect(screen.getByText('95k')).toBeTruthy()
    expect(screen.getByText('95,000')).toBeTruthy()
    expect(screen.getByText('60k')).toBeTruthy()
    expect(screen.getByText(zh.cacheRate)).toBeTruthy()
    expect(screen.getAllByText('70.6%').length).toBeGreaterThan(0)
    expect(screen.getByText('300')).toBeTruthy()
    expect(screen.getByText(zh.turns + ': 40')).toBeTruthy()
    expect(screen.getByText(zh.steps + ': 70')).toBeTruthy()
  })

  it('refreshes on demand and updates the freshness stamp', async () => {
    let calls = 0
    const store = new UsageStore({
      describe: async (): Promise<UsageResponse> => {
        calls += 1
        return { result: { ok: true, value: report({ generatedAt: Date.parse('2026-07-14T13:00:00Z') }) } }
      },
    })
    render(<UsageSection controller={store} useSnapshot={bindSnapshotSelector(store.store)} t={t} />)
    await waitFor(() => {expect(screen.getByText(zh.title)).toBeTruthy()})
    expect(calls).toBe(1)
    fireEvent.click(screen.getByLabelText(zh.refresh))
    await waitFor(() => {expect(calls).toBe(2)})
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
    const segmentDiv = screen.getByText(zh.inputTokensFull).closest('div')!.parentElement!.querySelector('[class*="segment"]')!
    fireEvent.mouseEnter(segmentDiv)
    expect(screen.getByRole('tooltip')).toBeTruthy()
    fireEvent.mouseLeave(segmentDiv)
    expect(screen.queryByRole('tooltip')).toBeNull()
  })

  it('reveals exact figures when hovering the cache-rate bar', async () => {
    await mountReady()
    const bar = screen.getByText(zh.cacheRateBar).closest('section')!.querySelector('[class*="bar"]')!
    fireEvent.mouseEnter(bar)
    const tooltip = screen.getByRole('tooltip')
    expect(within(tooltip).getByText(/60,000/)).toBeTruthy()
    expect(within(tooltip).getByText(/85,000/)).toBeTruthy()
    fireEvent.mouseLeave(bar)
    expect(screen.queryByRole('tooltip')).toBeNull()
  })

  it('switches the trend granularity and shows the delta chip', async () => {
    await mountReady()
    expect(screen.getByRole('tab', { name: zh.granularityDay }).getAttribute('aria-selected')).toBe('true')
    fireEvent.click(screen.getByRole('tab', { name: zh.granularityWeek }))
    expect(screen.getByRole('tab', { name: zh.granularityWeek }).getAttribute('aria-selected')).toBe('true')
    fireEvent.click(screen.getByRole('tab', { name: zh.granularityMonth }))
    expect(screen.getByRole('tab', { name: zh.granularityMonth }).getAttribute('aria-selected')).toBe('true')
    // 14 daily buckets roll into two calendar weeks; a full day window
    // exists, so the delta chip shows for the day granularity.
    fireEvent.click(screen.getByRole('tab', { name: zh.granularityDay }))
    expect(screen.getByText(zh.peak)).toBeTruthy()
  })

  it('shows falling and flat period deltas', () => {
    const falling = DAY_KEYS.map((key, index) => day(key, 10_000 - index * 500))
    const { unmount } = render(<SeriesChart series={falling} t={t} />)
    expect(screen.getByText(content => content.startsWith('\u2193'))).toBeTruthy()
    unmount()
    const flat = DAY_KEYS.map(key => day(key, 10_000))
    render(<SeriesChart series={flat} t={t} />)
    expect(screen.getByText(zh.deltaFlat)).toBeTruthy()
  })

  it('renders a chart with all-zero buckets and zero-prompt bars directly', () => {
    render(<SeriesChart series={[day('2026-07-01', 0)]} t={t} />)
    expect(screen.getByText(zh.peak)).toBeTruthy()
    render(<CompositionBar
      buckets={{ uncachedInputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }}
      total={0}
      t={t}
    />)
    render(<CacheRateBar uncachedInputTokens={0} cacheReadTokens={0} cacheWriteTokens={0} t={t} />)
    expect(screen.queryByRole('tooltip')).toBeNull()
  })

  it('shows the hover tooltip over a trend bar', async () => {
    await mountReady()
    const svg = document.querySelector('[role="img"][aria-label="' + zh.trend + '"]')!
    // The transparent overlay rect per bucket is the hover target; the first
    // one belongs to the first (leftmost) day.
    const overlay = svg.querySelector('rect[fill="transparent"]')!
    fireEvent.mouseEnter(overlay)
    expect(screen.getByText('2026-07-01')).toBeTruthy()
    fireEvent.mouseLeave(overlay)
    expect(screen.queryByText('2026-07-01')).toBeNull()
  })

  it('shows the heatmap with tooltip and the empty heatmap hint', async () => {
    await mountReady()
    expect(screen.getByText(zh.heatmapHigh)).toBeTruthy()
    const cell = screen.getAllByRole('button', { hidden: false }).find(button => button.className.includes('cellHot'))!
    fireEvent.mouseEnter(cell)
    await waitFor(() => {expect(screen.getAllByText(/30,000/).length).toBeGreaterThan(0)})
    fireEvent.mouseLeave(cell)
    await waitFor(() => {expect(screen.queryByRole('tooltip')).toBeNull()})
    // Hovering an empty cell shows nothing (scoped to the heatmap grid so
    // the toolbar's own buttons stay out of the search).
    const grid = document.querySelector('[class*="heatmapGrid"]')!
    const cold = Array.from(grid.querySelectorAll('button')).find(button => !button.className.includes('cellHot'))!
    fireEvent.mouseEnter(cold)
    await waitFor(() => {expect(screen.queryByRole('tooltip')).toBeNull()})
  })

  it('shows the empty heatmap hint when no cell has usage', async () => {
    await mountReady({ heatmap: Array.from({ length: 24 }, () => Array.from({ length: 7 }, () => 0)) })
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

  it('omits the composition and cache-rate bars when there is no prompt traffic', async () => {
    await mountReady({
      totals: {
        ...report().totals, totalTokens: 0, cacheRate: 0, promptTokens: 0,
        cacheReadTokens: 0, uncachedInputTokens: 0, cacheWriteTokens: 0,
      },
    })
    expect(screen.queryByText(zh.composition)).toBeNull()
    expect(screen.queryByText(zh.cacheRateBar)).toBeNull()
  })
})

describe('UsageStore', () => {
  it('reset drops the loaded report', async () => {
    const store = new UsageStore(apiWith(report()))
    await act(async () => { await store.load() })
    expect(store.store.getSnapshot().status).toBe('ready')
    store.reset()
    expect(store.store.getSnapshot().status).toBe('idle')
  })

  it('records a non-Error rejection as its string form', async () => {
    const store = new UsageStore({ describe: async (): Promise<UsageResponse> => { throw 'boom' } })
    await act(async () => { await store.load() })
    const state = store.store.getSnapshot()
    expect(state.status).toBe('error')
    expect(state.error).toBe('boom')
  })

  it('records a refused wire response as its error message', async () => {
    const store = new UsageStore({
      describe: async (): Promise<UsageResponse> => ({
        result: { ok: false, error: { code: 'internal', message: 'host says no', details: {} } },
      }),
    })
    await act(async () => { await store.load() })
    expect(store.store.getSnapshot().error).toBe('host says no')
  })

  it('discards a superseded failure without flipping the store', async () => {
    const settles: Array<(value: unknown) => void> = []
    const store = new UsageStore({
      describe: (): Promise<UsageResponse> =>
        new Promise((_resolve, reject) => { settles.push(reject) }),
    })
    const first = store.load()
    const second = store.load()
    settles[0]!(new Error('stale failure'))
    await act(async () => { await first })
    expect(store.store.getSnapshot().status).toBe('loading')
    settles[1]!(new Error('still failing'))
    await act(async () => { await second })
    expect(store.store.getSnapshot().status).toBe('error')
    expect(store.store.getSnapshot().error).toBe('still failing')
  })

  it('a newer load supersedes a slower older one', async () => {
    const settles: Array<(value: UsageResponse) => void> = []
    const store = new UsageStore({
      describe: (): Promise<UsageResponse> =>
        new Promise((resolve) => { settles.push(resolve) }),
    })
    const first = store.load()
    const second = store.load()
    // The older call settles first; its result must be discarded.
    settles[0]!({ result: { ok: true, value: report() } })
    await act(async () => { await first })
    expect(store.store.getSnapshot().status).toBe('loading')
    settles[1]!({ result: { ok: true, value: report() } })
    await act(async () => { await second })
    expect(store.store.getSnapshot().status).toBe('ready')
  })
})

void within
