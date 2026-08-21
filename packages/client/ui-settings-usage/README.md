# @deepseek-ai/dsh-client-ui-settings-usage

English | [中文](README.zh.md)

Usage statistics settings section: a read-only, best-effort dashboard built entirely by this optional browser plugin. It reads the existing `session.list` response, uses each visible session's durable projections when present (`tokenUsage`, `title`, `contextPressure`, `contextBreakdown`), and registers the page through the `settings.section` slot. It adds no host RPC and does not change the settings shell. Product copy is Chinese-only: the single `zh` dictionary registers under both shipped locale ids, so a locale switch never surfaces a raw key.

The page leads with twelve stat cards in three rows — total (with the week-over-week delta), today, the trailing 7 days, and the cache hit rate with its fill bar; the four billing buckets with their shares; and known calls, sessions (with the measured count), active days (with the daily streak), and the subagent-origin share. An insights panel follows: auto-generated findings with severity dots covering cache-rate health, the week-over-week movement, sessions filling at least 80% of their context window, a notable subagent share, and the busiest hour-of-day. Then come the single percentage bars (the token-composition bar over the four billing buckets and the prompt cache-rate bar), the trend chart (stacked tokens per local day, week, or month; a total / output / cache-hit-rate metric toggle — rate mode draws the per-bucket hit rate as a line on a fixed 0–100% axis; a 7-day trailing average and peak marker for token metrics; a range toggle for all, 7, 30, or 90 days), the heuristic context-composition bar (system prompt / tool schemas / conversation, summed over sessions carrying the estimator value), the hour-of-day heatmap (the busiest cell ringed and captioned; tooltips add the known-call count), and the breakdown lists — per workspace with share-of-total, and per session with the durable title projection, a text filter, a tokens/recency sort, subagent and running badges, the agent-preset fragment, and a context-occupancy meter that warns at 80% of the window. Clicking a session row opens that session and closes settings; the affordance renders only when the composition provides the sessions service.

The whole dashboard is colored through the app's design tokens: the plugin defines its own segment colors on the section root, so each bucket, bar, cell, and tooltip dot uses the theme palette instead of browser defaults. Compact card values switch to 万/亿 numerals when the UI language is Chinese.

The report is a pure function of the existing session-list rows. It aggregates cumulative projections in the browser, uses each session's `updatedAt` as one activity marker for the local trend and heatmap, and treats a nonzero session as at least one known call. There is no write path and no pushed invalidation; the section reloads on first mount, on demand, after a connection reset, and — while the auto toggle is on — every 30 seconds as a silent refresh. A loading skeleton fills the first mount. A copy button puts the totals, daily series, and top sessions into the clipboard as plain text; an export button downloads the session breakdown as RFC 4180 CSV; and a coverage note appears whenever some listed sessions contributed no projection, so the displayed totals are never mistaken for a complete platform billing statement.

## Model Experience

None, as the section renders a browser configuration UI; nothing here reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **Only visible `session.list` rows are included** — a deployment without the `tokenUsage` projection, or a row without projection values, contributes zero rather than triggering a history read. The dashboard surfaces this gap: listed sessions without usable projections are counted separately (the sessions card, the amber coverage note, and per-row "not counted" markers), so the numbers shown are the measured subset, not an estimate of the whole.
- **Deleted sessions leave the list** — the billing totals from sessions that were removed on the host are not included in any later report.
- **The time view is indicative, not a request history** — the existing list contract has cumulative totals and one `updatedAt` timestamp, so the plugin places a session's total at that activity marker instead of inventing per-call timestamps.
- **Known calls are a lower bound** — a nonzero session counts as one call; exact calls, turns, steps, and model latency are not present in the existing projection and remain zero or unavailable.
- **Usage carries no model dimension** — the `tokenUsage` projection names no model or provider, so the dashboard cannot break tokens down more finely than session, workspace, and origin.
- **The cache rate is a single aggregate** — the prompt-side ratio across all included sessions, not a per-request distribution.
- **Context figures are last-wins and heuristic** — `contextPressure` is the newest sample carried forward, not a live gauge, and `contextBreakdown` prices the surface with the token-meter estimator, not provider reports; sessions without those projections show no meter and no composition contribution.
- **Titles and badges are projection-bounded** — a session before its first title lands shows the trailing id fragment; `running` reflects only attached agents, so cold sessions always read idle.
