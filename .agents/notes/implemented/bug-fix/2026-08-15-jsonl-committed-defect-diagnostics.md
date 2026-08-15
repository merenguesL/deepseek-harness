# Agent Note: JSONL corruption names the committed defect

Status: implemented

English | [中文](2026-08-15-jsonl-committed-defect-diagnostics.zh.md)

## Problem

A second process cold-preparing a session whose owning harness process is still live commits crash-repair closers (an `interrupted-tool-result` tool/result, a step/end, and an interrupted turn/end) at the tail of the durable log. The live owner never sees those closers: when its in-flight tool later settles, its appends reuse the same seq numbers, so the log carries two events per seq in the affected range. `load()` then refuses the session, and the JSONL zstd read path reports `corrupt Zstandard session log: complete frame contains a torn JSONL record` — a message that names the wrong defect, because the frame structure and checksums are intact; the damage is a seq collision inside a committed region.

The same checkpoint check also masks an unparsable committed row. Both cases surface the true error only when a later row carries `turn/end`; without one, the scan ends with `committedBytes < inputBytes` and the torn-record message is thrown instead.

## Decision

`SessionLogScanner` exposes its first committed-region defect as `problem` — an unparsable row or a seq gap, with the line number and expected/actual seqs. `readZstdPrefix` throws that defect when the complete-frame scan does not commit every byte; the torn-record message is reserved for a clean scan whose final record is genuinely incomplete inside an otherwise complete frame.

This is a diagnostics fix: a corrupted committed region still refuses the load loudly. It never truncates, renumbers, or drops committed events, because the model-visible transcript must equal the logged one.

## Alternatives considered

**Auto-repair a duplicate-seq island on load.** Rejected: choosing which copy of a seq is truth requires semantic judgment — the synthetic closers were identifiable by their message-id pattern in the incident, but no general rule is safe — and silently dropping committed events would violate the model-visible ⟺ logged invariant.

**Fix the write side instead (cross-process ownership).** The root cause is that a second process cold-repairs a live session's log. Prevention needs a cross-process lock or an equivalent liveness proof; see Deferred.

**Drop the checkpoint check.** Rejected: the check is what rejects a genuinely torn final record inside a complete frame; only its diagnostic should change.

## Deferred

The write-side prevention is not implemented: the JSONL backend has no cross-process ownership primitive, so `load()`/`prepare()` in a second process can still commit crash-repair closers into a log whose owner process is live, and the owner's later appends collide. A cross-process exclusive lock held by the live owner (with a Windows peer) is the intended fix; the read-side change above only makes the resulting corruption report its true cause.

## Consequences

A corrupt committed region now fails `load()` with the line number and the expected/actual seq (or the unparsable row), so the operator can locate the collision instead of chasing a phantom frame problem. The torn-record message still fires for its genuine case. Session history remains unreadable until the log is repaired; the incident session was recovered by deleting the synthetic closer rows, which restores seq contiguity without renumbering.

## Testing

Unit coverage adds two rejection cases: a complete frame repeating a committed seq reports the seq gap, and a complete frame containing an unparsable row reports the unparsable event. The existing torn-record rejection keeps its message for a genuinely incomplete final record.
