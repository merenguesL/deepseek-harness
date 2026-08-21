# Agent Note: Deepening the usage dashboard inside the plugin boundary

Status: implemented

English | [中文](2026-08-15-settings-usage-dashboard-depth.zh.md)

## Problem

The usage dashboard ([2026-08-14-settings-usage-dashboard.md](2026-08-14-settings-usage-dashboard.md)) read only the `tokenUsage` projection of each `session.list` row, so sessions showed trailing-id placeholders instead of titles, context occupancy and composition projections went unused, and the page offered no way to act on what it showed (no jump-to-session, no export, no live refresh). Users also could not see which sessions were approaching their context window or how much usage subagents contributed.

## Decision

Keep every skeleton package unchanged — no host RPC, no wire field, no token-meter change, no settings-shell edit. All growth stays inside `@deepseek-ai/dsh-client-ui-settings-usage` and consumes only what the existing `session.list` row contract already carries.

Consume the row's other durable projections and fields: `title` (real session names in the breakdown), `contextPressure` (a per-session context-occupancy meter with a warning at 80% of the window and a near-limit count in the totals), `contextBreakdown` (a heuristic system/tools/conversation composition panel summed over sessions that carry the value), `running` and `origin: 'subagent'` (row badges and a subagent-share card), and `agentPreset` (a sub-line fragment).

Derive richer analytics as pure functions in `usage-math.ts`: today and trailing-7-day cards, active-day count with a daily streak, busiest day and heatmap cell, per-bucket cache-rate series, auto-selected insights (cache-rate health, week-over-week delta, near-limit sessions, subagent share, busiest hour) rendered with severity dots, and RFC 4180 CSV serialization of the session breakdown.

Extend the presentation within the existing slot entry: the trend chart gains a total / output / cache-hit-rate metric toggle (rate mode plots a per-bucket line on a fixed 0–100% axis), the breakdown gains a text filter, a tokens/recency sort, and click-to-open (the inject face exposes `openSession` only when the optional `sessions` service exists, and the click closes the panel through the shell's `close` owner prop), the toolbar gains a 30-second silent auto-refresh toggle and the CSV export, first mount renders a skeleton, and compact card values switch to 万/亿 numerals when the active locale is Chinese.

Register the section's Chinese-only copy under both shipped locale ids (`{ zh, en: zh }`): the typed `register` overload keeps enforcing the merged key union, and no locale switch can surface a raw key.

## Alternatives considered

- **A host usage RPC with per-call events** — rejected: the existing projection seam already carries everything these features need, and a new wire surface would modify skeleton packages for a client-only page.
- **Cost estimation with configurable prices** — rejected: no price source exists in the repo, and invented unit prices would present fabrication as measurement.
- **Per-request timestamps from the client** — rejected: the list contract has one `updatedAt` per row; inventing request history would misrepresent the data.
- **Dropping the `LocaleNamespaceMap` merge to register one locale** — rejected: the untyped register path would lose the compile-time key-union check; reusing the zh dictionary for both seats keeps the check and the single source of copy.

## Consequences

The dashboard now answers "which session, which project, which hour, how full" in one page while remaining removable without touching the shell. The context meter and composition panel are advisory: they are last-wins projections and estimator heuristics, documented as such in the README limitations. The jump-to-session affordance degrades silently in compositions without the sessions service. The Chinese-only decision means English-locale readers see Chinese text on this page; reverting that is a one-line dictionary change.

## Testing

- Package tests cover the new projection consumption (titles, context values, origin, running, preset), the derived math (streak, busiest day/cell, insights, CSV, localized compact numerals), every new render behavior (insights, metric toggle, context panel, heatmap peak, filter/sort/badges/meter, jump-to-session, CSV export success and failure, auto refresh, skeleton, locale numerals), and the sessions-face wiring in `apply`.
- Per-file branch/statement coverage on `src/client` stays at 100%.
