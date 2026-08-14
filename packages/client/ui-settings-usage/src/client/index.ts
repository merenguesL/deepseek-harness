/**
 * Usage statistics settings section, browser half: registers the Usage page
 * in the settings nav and binds its store to the connection. The report is
 * read-only, so the page has no write path; freshness rides the refresh
 * button and connection resets, never a pushed invalidation.
 * Export discipline:
 * packages/client/AGENTS.md.
 */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { ConnectionHandle } from '@deepseek-ai/dsh-api-remotes/client'
// Type-only: pulls the shell's SlotMap merge (the 'settings.section' entry).
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { UsageSection } from './UsageSection.tsx'
import type { UsageSectionInjected } from './UsageSection.tsx'
import { UsageStore } from './store.ts'
import { buildUsageReport } from './report.ts'
import type { UsageReportSource } from './report-types.ts'
import { en, zh, type UsageKey } from './locales.ts'

export type { UsageSectionInjected, UsageSectionProps } from './UsageSection.tsx'
export type { UsageKey } from './locales.ts'
export type { UsageState, UsageStore } from './store.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The Usage statistics page copy. */
    'settings.usage': UsageKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'settings.usage'

/**
 * Required services (cordis fiber inject). The target slot is declared by
 * ui-settings' apply, whose activation order relative to this one is NOT
 * constrained; registration depends on each slot through `slots.inject()`.
 */
export const inject = ['slots', 'locale', 'connection']

/**
 * Register the Usage section once the `settings.section` declaration is on
 * the ledger and bind its store to the connection. No pushed invalidation
 * exists for usage — the report is recomputed per call, so the section only
 * reloads on mount, on demand, and after a connection reset.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-settings-usage: copy dictionaries')

  const connection = ctx.get('connection') as ConnectionHandle
  const source: UsageReportSource = {
    async describe() {
      const response = await connection.api.sessions.list({})
      if (!response.result.ok) return { result: response.result }
      return { result: { ok: true, value: buildUsageReport(response.result.value.items) } }
    },
  }
  const controller = new UsageStore(source)
  // Registration-time text (the nav label thunk) and the inject faces share
  // one bound translate; copy freshness rides the locale revision.
  const t = ctx.locale.bind(NS) as UsageSectionInjected['t']
  const injected = (): UsageSectionInjected => ({ controller, hooks: { snapshot: controller.store }, t })

  // A connection reset may have lost the session the report was built from;
  // the next mount refreshes from the wire again.
  ctx.effect(() => {
    const refresh = (): void => {
      if (controller.store.getSnapshot().status === 'idle') void controller.load()
    }
    return ctx.on('connection/reset', refresh)
  }, 'ui-settings-usage: connection reset refresh')

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'usage',
    order: 20,
    label: () => t('nav'),
    inject: injected,
  }, UsageSection))
}
