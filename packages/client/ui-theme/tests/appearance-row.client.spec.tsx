// @vitest-environment jsdom
/** AppearanceRow behavior: three cubes, selection follows the persisted
 * preference, clicks drive setTheme; the output-tint switch and palette
 * drive setOutputTint. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createSnapshotStore, type SessionListState, type WorkspaceListState } from '@deepseek-ai/dsh-client-runtime/client'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import { AppearanceRow } from '../src/client/AppearanceRow.tsx'
import type { AppearanceRowComponentProps } from '../src/client/AppearanceRow.tsx'
import { createAppearanceRowStore } from '../src/client/settings-store.ts'
import type { ThemePreference } from '../src/client/index.ts'

afterEach(cleanup)

const COPY: Record<string, string> = {
  'appearance.title': 'Appearance',
  'appearance.light': 'Light',
  'appearance.dark': 'Dark',
  'appearance.system': 'System',
  'appearance.outputTint.title': 'Assistant output tint',
  'appearance.outputTint.description': 'Tint the assistant text output.',
  'appearance.outputTint.switch': 'Assistant output tint switch',
  'appearance.outputTint.custom': 'Custom color',
  'appearance.outputTint.swatch': 'Preset color {color}',
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

  it('switch reflects the tint and drives setOutputTint (on restores the first preset)', () => {
    const b = mount('system')
    expect(switchChecked()).toBe('false')
    fireEvent.click(screen.getByRole('switch'))
    expect(b.setOutputTint).toHaveBeenCalledWith('#E7F5F8')
    act(() => { b.store.actions.sync('system', '#E7F5F8', 1) })
    expect(switchChecked()).toBe('true')
    // Off clears the color.
    fireEvent.click(screen.getByRole('switch'))
    expect(b.setOutputTint).toHaveBeenCalledWith('')
  })

  it('palette swatch click picks that color; the selected swatch stays pressed', () => {
    const b = mount('system')
    const swatch = screen.getByRole('button', { name: 'Preset color #E4F1FC' })
    fireEvent.click(swatch)
    expect(b.setOutputTint).toHaveBeenCalledWith('#E4F1FC')
    expect(swatch.getAttribute('aria-pressed')).toBe('false')
    act(() => { b.store.actions.sync('system', '#E4F1FC', 1) })
    expect(swatch.getAttribute('aria-pressed')).toBe('true')
    // The switch turns the active tint off.
    fireEvent.click(screen.getByRole('switch'))
    expect(b.setOutputTint).toHaveBeenCalledWith('')
  })

  it('custom color input writes its value and shows the custom swatch selected', () => {
    const b = mount('system')
    const input = screen.getByLabelText('Custom color') as HTMLInputElement
    fireEvent.change(input, { target: { value: '#aabbcc' } })
    expect(b.setOutputTint).toHaveBeenCalledWith('#aabbcc')
    act(() => { b.store.actions.sync('system', '#aabbcc', 1) })
    // No preset matches: the custom swatch carries the pressed state.
    expect(screen.getByRole('button', { name: 'Preset color #E7F5F8' }).getAttribute('aria-pressed')).toBe('false')
    expect(input.value).toBe('#aabbcc')
  })
})
