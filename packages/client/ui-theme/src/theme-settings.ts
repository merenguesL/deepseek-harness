/** Theme preferences stored in the Host user-settings document. */

import z from '@deepseek-ai/schemastery'

/** Built-in preferences accepted at the registry and settings boundaries. */
export const THEME_PREFERENCES = ['light', 'dark', 'system'] as const

/** Settings namespace owned by the theme plugin. */
export const THEME_SETTINGS_NAMESPACE = 'ui-theme'

/** Field carrying the selected built-in theme preference. */
export const THEME_PREFERENCE_FIELD = 'preference'

/** Field carrying the assistant-output tint color. */
export const OUTPUT_TINT_FIELD = 'outputTint'

/** Theme preference persisted by the product Appearance row. */
export type ThemePreference = typeof THEME_PREFERENCES[number]

/** Default preference when the user-settings document has no override. */
export const DEFAULT_PREFERENCE: ThemePreference = 'system'

/** Default output-tint color: the empty string keeps the tint off. */
export const DEFAULT_OUTPUT_TINT = ''

/**
 * The product's fixed assistant-output tint color: the value of the
 * `--dsw-static-deepseek-50` token, which also backs the user-bubble surface
 * `--dsw-specific-bubble`. The Appearance row offers no color picker — the
 * tint is either off or this color — so the durable setting only ever holds
 * the empty string or this value.
 */
export const OUTPUT_TINT_COLOR = 'rgb(237, 243, 254)'

/** Durable theme section shared by the Host schema and the browser scope. */
export interface ThemeSettings {
  /** Selected built-in preference. */
  preference: ThemePreference
  /**
   * Assistant-output tint: the empty string keeps the tint off; the fixed
   * product color {@link OUTPUT_TINT_COLOR} turns it on. The chat view
   * paints the assistant text output with this color, dimmed on the dark
   * palette. Any other persisted value (residue of the removed color
   * palette) is normalized to the fixed color when adopted.
   */
  outputTint: string
}

/** Durable theme schema; also the wire envelope the browser scope validates against. */
export const ThemeSettingsSchema: z<ThemeSettings> = z.object({
  [THEME_PREFERENCE_FIELD]: z.union([...THEME_PREFERENCES]).default(DEFAULT_PREFERENCE),
  [OUTPUT_TINT_FIELD]: z.string().default(DEFAULT_OUTPUT_TINT),
})

/**
 * Narrow one wire or registry value to a persistable preference.
 * @param value - value crossing the settings or registry boundary.
 * @returns whether the value is a built-in preference.
 */
export function isThemePreference(value: unknown): value is ThemePreference {
  return THEME_PREFERENCES.some(preference => preference === value)
}
