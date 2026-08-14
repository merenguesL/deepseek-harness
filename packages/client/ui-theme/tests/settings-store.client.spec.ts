/** Appearance row store: snapshot-mirror action and the revision guard. */
import { describe, expect, it } from 'vitest'
import { createAppearanceRowStore } from '../src/client/settings-store.ts'

describe('createAppearanceRowStore', () => {
  it('init shape: system preference, tint off, revision at -1', () => {
    const store = createAppearanceRowStore().create()
    expect(store.getSnapshot()).toEqual({ preference: 'system', outputTint: '', revision: -1 })
  })

  it('sync mirrors the preference and tint and advances the revision', () => {
    const store = createAppearanceRowStore().create()
    store.actions.sync('dark', '#E7F5F8', 0)
    expect(store.getSnapshot()).toEqual({ preference: 'dark', outputTint: '#E7F5F8', revision: 0 })
    store.actions.sync('light', '', 2)
    expect(store.getSnapshot().preference).toBe('light')
    expect(store.getSnapshot().outputTint).toBe('')
    expect(store.getSnapshot().revision).toBe(2)
  })

  it('revision guard drops stale and duplicate writes', () => {
    const store = createAppearanceRowStore().create()
    store.actions.sync('dark', '#E7F5F8', 3)
    store.actions.sync('system', '#E4F1FC', 2)
    store.actions.sync('system', '#E4F1FC', 3)
    expect(store.getSnapshot().preference).toBe('dark')
    expect(store.getSnapshot().outputTint).toBe('#E7F5F8')
    expect(store.getSnapshot().revision).toBe(3)
  })
})
