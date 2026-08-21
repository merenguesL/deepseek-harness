# Agent Note: manual projection-cache backfill script

Status: implemented
Archived: 2026-08-21

English | [中文](2026-08-21-projection-cache-backfill-script.zh.md)

## Problem

The persisted projection cache (`<home>/storages/session_projcache.json`) discards its whole medium whenever the `session_projcache` domain version bumps, and the web GUI reads its zero-I/O listing columns from it: the usage page aggregates `tokenUsage`, the stats strip reads `sessionStats`, and the session list reads `sessionListMetadata`/`title` hints. After a rebuild, only sessions that go live or get cold-read regain rows; on the operator deployment 65 of 79 historical sessions never re-opened, so the usage page showed only the last two days (rows without a cached `tokenUsage` aggregate as zero) and the only remedy was opening every session by hand. No bulk path existed: `coldSnapshot` had no production caller.

## Decision

`packages/session/session-projection-cache/backfill.ts` is a manually-run maintenance script that mounts the shipped storage stack (json backend under `<home>/storages`, the storage-domain form), the projection registry with the usage-relevant units (token-meter's `tokenUsage`/`contextPressure`/`contextBreakdown` plus `sessionStats`), the real jsonl session persistence, and the projection cache; then runs the production `coldSnapshot` ladder — full-log replay, fold, fail-soft write-back — for every persisted session lacking a usable cached row. Sessions with a usable record are skipped untouched, so rows of units the script does not mount are never dropped from their records.

The script refuses to run against the default dsh home while something answers on 127.0.0.1:3080, because the running server holds the medium's in-memory table and rewrites the whole file on its next checkpoint, discarding the backfill; `--force` overrides the probe and a non-default `DSH_HOME` skips it. The operating procedure is: stop the web server, run `pnpm exec tsx packages/session/session-projection-cache/backfill.ts`, restart. The first real run backfilled 65 sessions in ~12 seconds with zero failures (largest single session ~1.8s).

## Alternatives considered

**Product-built lazy backfill** — the host cold-reads sessions with missing rows at boot or when the listing serves a gap. It is the durable fix (every future domain version bump loses rows again) but it is a product change owning config surface, rate limiting, and tests; rejected for now, revisited the next time the medium rebuilds.

**Merging the surviving `.back`/`.pre-rebuild` medium snapshots** — zero replay, but the snapshots covered only 18 of the 65 missing sessions, still required stopping the server, and whole-file rewrite by the live server would discard the merge exactly the same way. Full replay from logs is barely slower and needs no snapshot archaeology.

**Aggregating usage by scanning all session logs per poll** — measured ~111 MB of decompressed JSONL and seconds of CPU per full scan on this deployment, growing linearly with history; the projection cache's cold-read ladder exists precisely to avoid this, and the usage page already rides it.

## Consequences

The usage page and stats recover without product changes, and the script is re-runnable after every future cache-medium rebuild. Backfilled sessions carry only the mounted units' rows: `title`, `todos`, `plan`, `goal`, `permissions`, `sessionListMetadata`, `imageLimits`, and subagent rows stay absent until each session is next opened, which re-folds them through the full registry. The live-server probe is best-effort — a server on a non-default port is not detected — so stopping the server remains the real requirement, not the check.

## Testing

The script is exercised manually against the operator deployment (the 65-session run above) and against a throwaway `DSH_HOME` for the empty-home path; it is deliberately outside the package tsconfig program and the shipped `files` list, so no unit test pins it.
