# @deepseek-ai/dsh-client-ui-settings-usage

English | [中文](README.zh.md)

Usage statistics settings section: a read-only, best-effort dashboard built entirely by this optional browser plugin. It reads the existing `session.list` response, uses each visible session's durable `tokenUsage` projection when present, and registers the page through the `settings.section` slot. It adds no host RPC and does not change the settings shell.

The page leads with stat cards (total, uncached input, output, cache read, cache write, cache hit rate, known calls, sessions), then the two single percentage bars: the token-composition bar — every reported total split into the four billing buckets, each segment sized by its share and colored per bucket — and the prompt cache-rate bar (cache reads against the rest of prompt traffic). Hovering a segment or bar reveals the exact numbers and percentages. Below come the trend chart (stacked tokens per local day, week, or month, with a 7-day trailing average and a peak marker; the day granularity compares the trailing week against the previous one as a delta chip; a range toggle narrows the view to all, the trailing 7, 30, or 90 days and shows what the visible window sums to), the hour-of-day heatmap (cell tooltips include the cell's share of the grand total), and the breakdown lists (per workspace and per session, each row with a mini stacked bar, cache rate, and known-call count; rows whose session carries no usable projection are marked as not counted).

The whole dashboard is colored through the app's design tokens: the plugin defines its own segment colors on the section root, so each bucket, bar, cell, and tooltip dot uses the theme palette instead of browser defaults.

The report is a pure function of the existing session-list rows. It aggregates cumulative projections in the browser, uses each session's `updatedAt` as one activity marker for the local trend and heatmap, and treats a nonzero session as at least one known call. There is no write path and no pushed invalidation; the section reloads on first mount, on demand, and after a connection reset. A copy button puts the totals, daily series, and top sessions into the clipboard as plain text, and a coverage note appears whenever some listed sessions contributed no projection, so the displayed totals are never mistaken for a complete platform billing statement.

## Model Experience

None, as the section renders a browser configuration UI; nothing here reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **Only visible `session.list` rows are included** — a deployment without the `tokenUsage` projection, or a row without projection values, contributes zero rather than triggering a history read. The dashboard surfaces this gap: listed sessions without usable projections are counted separately (the totals card, the amber coverage note, and per-row "not counted" markers), so the numbers shown are the measured subset, not an estimate of the whole.
- **Deleted sessions leave the list** — the billing totals from sessions that were removed on the host are not included in any later report.
- **The time view is indicative, not a request history** — the existing list contract has cumulative totals and one `updatedAt` timestamp, so the plugin places a session's total at that activity marker instead of inventing per-call timestamps.
- **Known calls are a lower bound** — a nonzero session counts as one call; exact calls, turns, steps, and model latency are not present in the existing projection and remain zero or unavailable.
- **Usage carries no model dimension** — the `tokenUsage` projection names no model or provider, so the dashboard cannot break tokens down more finely than session and workspace.
- **The cache rate is a single aggregate** — the prompt-side ratio across all included sessions, not a per-request distribution.
