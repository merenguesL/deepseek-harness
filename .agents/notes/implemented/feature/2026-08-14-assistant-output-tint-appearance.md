# Agent Note: Assistant-output tint in Appearance settings

Status: implemented

English | [中文](2026-08-14-assistant-output-tint-appearance.zh.md)

## Problem

The assistant text output, thinking disclosure, and tool-call rows all sit on the same plain surface, so a long answer is hard to separate from the surrounding flow. The product asked for a restrained light-cyan background on the model reply output (not on thinking or tool calls), controlled by a switch under Settings → General → Appearance, with the freedom to pick the color oneself (调色盘).

## Decision

**The theme plugin owns the preference; the conversation plugin renders it.** `ui-theme`'s durable section gains `outputTint`, a CSS color string persisted through the existing settings scope (empty string disables; the [Host-backed preferences decision](../../../.agents/notes/implemented/bug-fix/2026-08-06-host-backed-web-preferences.md) owns that boundary).

## Alternatives considered

- **A fixed token behind the switch.** Rejected after the user asked for a palette: the color must be user-authored, so the setting carries the value itself and the CSS consumes it directly.
- **A hard cordis `theme` inject for the chat plugin.** Rejected: the tint is an optional surface feature; `ctx.get` with an event subscription (the existing `chatFileMentions` precedent) keeps ui-conversation activatable without ui-theme while still converging on the theme's construction publish.

## Consequences

Toggling the switch persists `ui-theme.outputTint` in the settings document and repaints text output live, including streaming frames; switching the palette color or clearing it through the switch takes effect immediately and survives reloads. Dark mode renders the user color at 24% opacity so a light pick does not glare. The feature is opt-in (default off) and presentation-only: nothing reaches the model request or the session log.
