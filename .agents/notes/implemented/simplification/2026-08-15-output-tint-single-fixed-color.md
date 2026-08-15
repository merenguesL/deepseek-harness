# Agent Note: Assistant-output tint is a switch with one fixed color

Status: implemented

English | [中文](2026-08-15-output-tint-single-fixed-color.zh.md)

## Problem

The [palette decision](../feature/2026-08-14-assistant-output-tint-appearance.md) shipped the tint switch with six preset swatches and a native color picker. After using it, the product decision reversed: a color-choosing surface is more burden than benefit for a subtle output background. The requirement is a single switch with one default color, restrained and harmonious with the page.

## Decision

The Appearance row now offers only the switch. Turning it on persists `OUTPUT_TINT_COLOR` (`rgb(237, 243, 254)`), the value of the `--dsw-static-deepseek-50` token that also backs the user-bubble surface (`--dsw-specific-bubble`); turning it off persists the empty string. `ui-theme.outputTint` keeps its string shape — empty disables, a color enables — so the snapshot contract with ui-conversation is untouched: the chat view still receives the resolved CSS color and dims it on the dark palette with color-mix.

The palette is gone from the UI, but the durable field can still hold palette-era values written before this change. Adoption normalizes any non-empty persisted value to `OUTPUT_TINT_COLOR`: a user who had the tint on keeps it on, rendered with the fixed color, instead of the runtime carrying a color the UI can no longer express.

## Alternatives considered

- **A boolean durable field.** Rejected: the snapshot must still expose a concrete CSS color for the chat view, so a boolean would need a mapping step inside the theme service — two representations of one flag instead of one. The color string stays the honest durable value: it is exactly what the chat view paints.
- **Normalizing palette-era values to the empty string.** Rejected: a user who deliberately enabled the tint would have it silently switched off by the removal; keeping it on with the fixed color preserves intent.
- **Keeping the palette.** Rejected by the product decision: the tint is a subtle visual aid, not a customization surface.

## Consequences

The settings row shrinks to a switch; the swatch/picker styles, the palette locale keys, and the settings-chrome snapshot lines are gone. The fixed color is on-brand by construction: the same light brand tint as the user bubbles, so the output card reads as part of the same conversation surface; the dark palette still dims it to 24% via color-mix. Palette-era persisted values converge to the fixed color at adoption, so no stale custom color outlives the feature that produced it. The pre-release stance makes that convergence a silent migration rather than a compatibility shim: the palette has no external consumers.
