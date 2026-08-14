# Agent Note: Client-only settings usage dashboard over session projections

Status: implemented

English | [中文](2026-08-14-settings-usage-dashboard.zh.md)

## Problem

The web GUI had no view over provider-reported token totals, while the existing session list already exposed optional cumulative `tokenUsage` projections. Adding a host-side usage RPC and a time-series projection would make the feature larger than the requested browser enhancement and would modify core skeleton packages.

## Decision

Keep the existing host, API, token-meter, connection, and settings-shell packages unchanged for this feature.

Add `@deepseek-ai/dsh-client-ui-settings-usage` as an optional browser plugin. It registers a `settings.section` entry through the existing slot ledger, supplies its own locale dictionaries, and binds its own snapshot store through the `InjectFace` hook. The web bundle only adds the plugin to its composition roster.

Build the report in the plugin from the existing `session.list` response. Each row reads the durable `tokenUsage` projection when present; totals and workspace/session breakdowns are exact for those cumulative buckets, while calls are a lower bound of one per nonzero session and turns, steps, and model latency remain unavailable.

Use each row's `updatedAt` as one local activity marker for the day trend and heatmap. This keeps the page useful without pretending that the existing cumulative projection contains per-request timestamps or a model/provider dimension.

## Alternatives considered

- **Add a host `usage.describe` RPC and an hour-bucketed projection** — rejected for this replay because it changes the wire and token-meter skeleton to support one optional browser page.
- **Modify `SettingsRoot` or the settings navigation projection** — rejected because `settings.section` already provides the registration and rendering seam.
- **Fetch every session history in the browser** — rejected because the existing list projection is bounded and a client page should not create an unbounded history-read workload.
- **Add model/provider breakdowns** — rejected because `tokenUsage` carries no model or provider key.

## Consequences

The feature remains removable from the bundle without touching the settings shell or any host contract. The dashboard includes only sessions returned by the current `session.list` call; rows without a token projection contribute zero. Its time chart is an activity-marker visualization rather than an exact request history, and the displayed call count is explicitly a lower bound.

The report is rebuilt on first mount, manual refresh, and an idle connection reset. It has no write path, pushed invalidation, host state, or model-visible effect.

## Testing

- The client package type-checks independently against the current upstream plugin graph.
- The package tests cover slot registration before and after declaration, locale-following labels, HMR recovery, connection-reset behavior, store loading/error/latest-wins states, dashboard rendering, and report aggregation/normalization.
- The web composition keeps the package in the bundle roster without changing `SettingsRoot`, connection contracts, API proxy files, or token-meter projections.
