/**
 * Usage dashboard page store: one snapshot over the plugin's local report.
 * The report is rebuilt from the existing session-list projection on every
 * refresh, so this store owns only loading state and latest-wins behavior.
 */

import type { SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { UsageDescribeValue, UsageReportSource } from './report-types.ts'

/** Page snapshot. */
export interface UsageState {
  status: 'idle' | 'loading' | 'ready' | 'error'
  /** Whole-report failure text; the previous value survives the failure. */
  error: string | null
  value: UsageDescribeValue | null
}

/**
 * The usage page store. A reload from ready keeps the previous value visible
 * (silent refresh); a reload from idle or error shows the loading state.
 * @param api - the wire face the section reads.
 */
export class UsageStore {
  /** Snapshot of the current loading state and latest report. */
  readonly store: SnapshotStore<UsageState>
  private generation = 0

  constructor(private readonly api: UsageReportSource) {
    this.store = createSnapshotStore<UsageState>({ status: 'idle', error: null, value: null })
  }

  /**
   * Fetch one fresh report. A newer call supersedes this one (latest-wins).
   * @returns settlement after the report lands or the failure is recorded.
   */
  async load(): Promise<void> {
    const generation = ++this.generation
    if (this.store.getSnapshot().status !== 'ready') {
      this.store.update((state) => { state.status = 'loading'; state.error = null })
    }
    let value: UsageDescribeValue
    try {
      const response = await this.api.describe()
      if (generation !== this.generation) return
      if (!response.result.ok) throw new Error(response.result.error.message)
      value = response.result.value
    } catch (error) {
      if (generation !== this.generation) return
      this.store.update((state) => {
        state.status = 'error'
        state.error = error instanceof Error ? error.message : String(error)
      })
      return
    }
    this.store.update((state) => {
      state.status = 'ready'
      state.error = null
      state.value = value
    })
  }

  /**
   * Drop the loaded report so the next mount shows the loading state again.
   * @returns nothing.
   */
  reset(): void {
    this.generation += 1
    this.store.update((state) => {
      state.status = 'idle'
      state.error = null
      state.value = null
    })
  }
}
