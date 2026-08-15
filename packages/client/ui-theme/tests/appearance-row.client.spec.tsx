// @vitest-environment jsdom
/** AppearanceRow behavior: three cubes, selection follows the persisted
 * preference, clicks drive setTheme; the output-tint switch drives
 * setOutputTint. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createSnapshotStore, type SessionListState, type WorkspaceListState } from '@deepseek-ai/dsh-client-runtime/client'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import { AppearanceRow } from '../src/client/AppearanceRow.tsx'
import type { AppearanceRowComponentProps } from '../src/client/AppearanceRow.tsx'
import { createAppearanceRowStore } from '../src/client/settings-store.ts'
import { OUTPUT_TINT_COLOR, type ThemePreference } from '../src/theme-settings.ts'

afterEach(cleanup)

const COPY: Record<string, string> = {
  'appearance.title': 'Appearance',
  'appearance.light': 'Light',
  'appearance.dark': 'Dark',
  'appearance.system': 'System',
  'appearance.outputTint.title': 'Assistant output tint',
  'appearance.outputTint.description': 'Tint the assistant text output.',
  'appearance.outputTint.switch': 'Assistant output tint switch',
}

/** Empty global standard-kit hooks (the row reads neither). */
function emptySessions() {
  const store = createSnapshotStore<SessionListState>(
    { ids: [], byId: {}, current: undefined, phase: 'ready', subagentsByParent: {}, jobsBySession: {}, currentAddress: undefined })
  return bindSnapshotSelector(store)
}
function emptyWorkspaces() {
  const store = createSnapshotStore<WorkspaceListState>({
    items: [], archivedSessionIds: [], state: 'idle', phase: 'ready', error: null,
    baselinesReady: true, recentWorkspaceId: undefined,
  })
  return bindSnapshotSelector(store)
}

function mount(preference: ThemePreference = 'system', outputTint = '') {
  // Real store instance — the sanctioned zero-machinery path for tests.
  const store = createAppearanceRowStore().create()
  store.actions.sync(preference, outputTint, 0)
  const setTheme = vi.fn()
  const setOutputTint = vi.fn()
  const props: AppearanceRowComponentProps = {
    useSessions: emptySessions(),
    useWorkspaces: emptyWorkspaces(),
    useStore: bindSnapshotSelector(store),
    actions: store.actions,
    t: (key: string, params?: Record<string, unknown>) =>
      params === undefined ? COPY[key] ?? key : (COPY[key] ?? key).replace('{color}', String(params.color)),
    setTheme,
    setOutputTint,
  }
  render(<AppearanceRow {...props} />)
  return { store, setTheme, setOutputTint }
}

const pressed = (name: RegExp): string | null =>
  screen.getByRole('button', { name }).getAttribute('aria-pressed')

const switchChecked = (): string | null =>
  screen.getByRole('switch', { name: 'Assistant output tint switch' }).getAttribute('aria-checked')

describe('AppearanceRow', () => {
  it('renders the title and three cubes with the preference cube selected', () => {
    mount('dark')
    expect(screen.getByText('Appearance')).toBeDefined()
    expect(pressed(/Dark/)).toBe('true')
    expect(pressed(/Light/)).toBe('false')
    expect(pressed(/System/)).toBe('false')
  })

  it('click drives setTheme; selection follows the store mirror, not the click echo', () => {
    const b = mount('dark')
    fireEvent.click(screen.getByRole('button', { name: /Light/ }))
    expect(b.setTheme).toHaveBeenCalledWith('light')
    // No store write yet: selection is unchanged.
    expect(pressed(/Dark/)).toBe('true')
    act(() => { b.store.actions.sync('light', '', 1) })
    expect(pressed(/Light/)).toBe('true')
    expect(pressed(/Dark/)).toBe('false')
  })

  it('switch reflects the tint and drives setOutputTint (on writes the fixed product color)', () => {
    const b = mount('system')
    expect(switchChecked()).toBe('false')
    fireEvent.click(screen.getByRole('switch'))
    expect(b.setOutputTint).toHaveBeenCalledWith(OUTPUT_TINT_COLOR)
    act(() => { b.store.actions.sync('system', OUTPUT_TINT_COLOR, 1) })
    expect(switchChecked()).toBe('true')
    // Off clears the color.
    fireEvent.click(screen.getByRole('switch'))
    expect(b.setOutputTint).toHaveBeenCalledWith('')
  })
})
