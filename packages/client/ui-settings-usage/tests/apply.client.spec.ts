/** Usage section registration: slot declaration injection and the locale-following label thunk. */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { usePinnedBrowserLanguages } from '@deepseek-ai/dsh-client-test-runtime'
import { apply, inject } from '@deepseek-ai/dsh-client-ui-settings-usage/client'
import { UsageSection } from '../src/client/UsageSection.tsx'

// The service reads its initial locale from the browser; these specs assert
// the shipped Chinese copy, so they state the browser they assume.
usePinnedBrowserLanguages('zh-CN')

async function bench() {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const locale = new LocaleRuntime(ctx)
  locale.setLocale('zh')
  ctx.provide('locale', locale)
  // The apply path only captures the wire face; no call leaves this fake
  // until a section actually loads.
  const connection = {
    api: { sessions: { list: async () => ({ result: { ok: true, value: { items: [] } } }) } },
    isLoopback: true,
  }
  ctx.provide('connection', connection as never)
  return { ctx, slots: ctx.get('slots') as SlotRegistry, locale, connection }
}

function declare(slots: SlotRegistry): () => void {
  return slots.register(
    {
      name: 'root',
      children: {
        'settings.section': { kind: 'list', scope: 'root' },
      },
    } as never,
    () => null,
  )
}

describe('ui-settings-usage apply', () => {
  it('declares the services it uses', () => {
    expect(inject).toEqual(['slots', 'locale', 'connection'])
  })

  it('registers the usage nav entry for declarations before or after apply', async () => {
    const before = await bench()
    declare(before.slots)
    await before.ctx.plugin({ inject: [...inject], apply }).await()
    const entries = before.slots.entries('settings.section')
    expect(entries).toHaveLength(1)
    const entry = entries[0]!
    expect(entry.component).toBe(UsageSection)
    expect(entry.options).toMatchObject({ id: 'usage', order: 20 })
    // The nav label is a locale-following thunk; owners resolve at read time.
    expect(resolveSlotLabel(entry.options.label)).toBe('用量统计')
    const injected = (entry.inject as unknown as () => import('../src/client/UsageSection.tsx').UsageSectionInjected)()
    expect(injected.t('nav')).toBe('用量统计')
    expect(injected.t('totalTokens')).toBe('总 Tokens')
    expect(typeof injected.controller.load).toBe('function')
    expect(typeof injected.hooks.snapshot.getSnapshot).toBe('function')

    const after = await bench()
    await after.ctx.plugin({ inject: [...inject], apply }).await()
    expect(after.slots.entries('settings.section')).toHaveLength(0)
    declare(after.slots)
    await Promise.resolve()
    expect(after.slots.entries('settings.section')).toHaveLength(1)
    expect(after.slots.entries('settings.section')[0]!.component).toBe(UsageSection)
  })

  it('the label thunk follows the active locale without re-registration', async () => {
    const b = await bench()
    declare(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const injected = b.slots.entries('settings.section')[0]!.inject as unknown as () => import('../src/client/UsageSection.tsx').UsageSectionInjected
    b.locale.setLocale('en')
    expect(resolveSlotLabel(b.slots.entries('settings.section')[0]!.options.label)).toBe('Usage stats')
    expect(injected().t('totalTokens')).toBe('Total tokens')
    b.locale.setLocale('zh')
    expect(resolveSlotLabel(b.slots.entries('settings.section')[0]!.options.label)).toBe('用量统计')
  })

  it('re-registers after an HMR collapse re-declares the slot (stale disposer must not block)', async () => {
    const b = await bench()
    const redeclare = declare(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    expect(b.slots.entries('settings.section')).toHaveLength(1)
    redeclare()
    expect(b.slots.entries('settings.section')).toHaveLength(0)
    declare(b.slots)
    await Promise.resolve()
    expect(b.slots.entries('settings.section')).toHaveLength(1)
  })

  it('connection reset reloads a still-idle store', async () => {
    const b = await bench()
    declare(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const injected = b.slots.entries('settings.section')[0]!.inject as unknown as () => import('../src/client/UsageSection.tsx').UsageSectionInjected
    expect(injected().controller.store.getSnapshot().status).toBe('idle')
    b.ctx.emit('connection/reset')
    await Promise.resolve()
    // The reset only refreshes idle stores; the load() call is fire-and-forget.
    expect(typeof injected().controller.load).toBe('function')
  })

  it('connection reset skips stores that already loaded', async () => {
    const b = await bench()
    declare(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const injected = b.slots.entries('settings.section')[0]!.inject as unknown as () => import('../src/client/UsageSection.tsx').UsageSectionInjected
    const controller = injected().controller
    // The bench wire answers a valid report, so the store reaches ready.
    b.connection.api.sessions.list = async () => ({ result: { ok: true, value: { items: [] } } })
    await controller.load()
    expect(controller.store.getSnapshot().status).toBe('ready')
    b.ctx.emit('connection/reset')
    await Promise.resolve()
    expect(controller.store.getSnapshot().status).toBe('ready')
  })
})
