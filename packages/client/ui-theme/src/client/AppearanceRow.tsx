/**
 * Appearance preference row registered into the General section item slot
 * (figma 501:30012 'Frame 2117131228'): title + three preference cubes, plus
 * the assistant-output tint switch and palette. Registered by this package —
 * the theme feature owns its own settings surface. Selection follows the
 * persisted preference, never the resolved active theme.
 */
import clsx from 'clsx'
import {
  IconDarkOutline16, IconFollowsystemOutline16, IconLightOutline16,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { ThemePreference } from '../theme-settings.ts'
import type { ThemeKey } from './locales.ts'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { createAppearanceRowStore } from './settings-store.ts'
import css from './AppearanceRow.module.css'

/** Injected business face: the preference writes (t rides the standard locale seat). */
export interface AppearanceRowInjected {
  /** Switch the theme preference. */
  setTheme: (id: ThemePreference) => void
  /** Set the assistant-output tint color; the empty string disables it. */
  setOutputTint: (color: string) => void
}

/** Full component props: runtime share + store share + locale seat + injected face. */
export type AppearanceRowComponentProps =
  PropsRuntime<'settings.general.item'> & PropsStore<ReturnType<typeof createAppearanceRowStore>>
  & PropsLocale<'settings.theme'> & AppearanceRowInjected

/** Cube order and icons (figma 501:30015-30017: Light, Dark, System). */
const CUBES: readonly { id: ThemePreference; labelKey: ThemeKey; Icon: typeof IconLightOutline16 }[] = [
  { id: 'light', labelKey: 'appearance.light', Icon: IconLightOutline16 },
  { id: 'dark', labelKey: 'appearance.dark', Icon: IconDarkOutline16 },
  { id: 'system', labelKey: 'appearance.system', Icon: IconFollowsystemOutline16 },
]

/** Restrained pastel presets for the output tint (the first doubles as the switch-on default). */
const TINT_PRESETS: readonly string[] = [
  '#E7F5F8', '#E4F1FC', '#E9F5EB', '#F4F0FA', '#FBF1E7', '#FBEEEF',
]

/**
 * Render the Appearance row.
 * @param props - composed slot props.
 * @returns the row element tree.
 */
export function AppearanceRow({ t, setTheme, setOutputTint, useStore }: AppearanceRowComponentProps) {
  const preference = useStore(s => s.preference)
  const outputTint = useStore(s => s.outputTint)
  const tintOn = outputTint !== ''
  // The switch-on gesture needs a concrete color: the first preset.
  /* v8 ignore next -- fallback arm: TINT_PRESETS is a non-empty literal. */
  const current = outputTint === '' ? (TINT_PRESETS[0] ?? '') : outputTint
  const customSelected = outputTint !== '' && !TINT_PRESETS.includes(outputTint)
  return (
    <div className={css.group}>
      <div className={css.title}>{t('appearance.title')}</div>
      <div className={css.cubeRow}>
        {CUBES.map(({ id, labelKey, Icon }) => (
          <button
            key={id}
            type="button"
            className={clsx(css.themeCube, preference === id && css.selected)}
            aria-pressed={preference === id}
            onClick={() => { setTheme(id) }}
          >
            <Icon />
            {t(labelKey)}
          </button>
        ))}
      </div>
      <div className={css.toggleRow}>
        <div className={css.toggleText}>
          <div className={css.title}>{t('appearance.outputTint.title')}</div>
          <div className={css.desc}>{t('appearance.outputTint.description')}</div>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={tintOn}
          aria-label={t('appearance.outputTint.switch')}
          className={css.switch}
          onClick={() => { setOutputTint(tintOn ? '' : current) }}
        />
      </div>
      <div className={css.paletteRow} data-inactive={tintOn ? undefined : ''}>
        {TINT_PRESETS.map(color => (
          <button
            key={color}
            type="button"
            className={clsx(css.swatch, outputTint === color && css.swatchSelected)}
            style={{ background: color }}
            aria-label={t('appearance.outputTint.swatch', { color })}
            aria-pressed={outputTint === color}
            onClick={() => { setOutputTint(color) }}
          />
        ))}
        <label className={css.customColor} title={t('appearance.outputTint.custom')}>
          <span className={clsx(css.swatch, customSelected && css.swatchSelected)} style={{ background: current }} />
          <input
            type="color"
            value={current}
            aria-label={t('appearance.outputTint.custom')}
            onChange={(event) => { setOutputTint(event.currentTarget.value) }}
          />
        </label>
      </div>
    </div>
  )
}
