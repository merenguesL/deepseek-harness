/** `settings.theme` namespace dictionaries (the Appearance row's copy). */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'appearance.title': '外观',
  'appearance.light': '浅色',
  'appearance.dark': '深色',
  'appearance.system': '跟随系统',
  'appearance.outputTint.title': '模型回复输出背景',
  'appearance.outputTint.description': '为模型回复的文字输出添加自定义底色，便于与思考过程和工具调用区分',
  'appearance.outputTint.switch': '模型回复输出背景开关',
  'appearance.outputTint.custom': '自定义颜色',
  'appearance.outputTint.swatch': '预设颜色 {color}',
} satisfies Record<string, string>

/** The settings.theme namespace key union. */
export type ThemeKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'appearance.title': 'Appearance',
  'appearance.light': 'Light',
  'appearance.dark': 'Dark',
  'appearance.system': 'System',
  'appearance.outputTint.title': 'Assistant output tint',
  'appearance.outputTint.description': 'Tint the assistant text output with a color of your choice so it stands apart from thinking and tool calls.',
  'appearance.outputTint.switch': 'Assistant output tint switch',
  'appearance.outputTint.custom': 'Custom color',
  'appearance.outputTint.swatch': 'Preset color {color}',
} satisfies Record<ThemeKey, string>
