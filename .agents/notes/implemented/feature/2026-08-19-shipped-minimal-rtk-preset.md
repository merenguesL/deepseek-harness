# Agent Note: Ship the minimal-rtk preset (rtk-compressed bash output)

Status: implemented

English | [中文](2026-08-19-shipped-minimal-rtk-preset.zh.md)

## Problem

The shipped `minimal` preset is the two-tool benchmark surface: a fixed persona, persistent shell, and `str_replace_editor`. A variant is useful for deployments that have the `rtk` CLI (Rust Token Killer, [rtk-ai/rtk](https://github.com/rtk-ai/rtk)) available on `PATH`, so supported bash output is filtered and compressed before it reaches the model context.

## Decision

Ship a new preset `minimal-rtk`, a current copy of `minimal` whose POSIX `persistent-bash` description instructs the model to prefix supported commands with `rtk` (`rtk ls`, `rtk read`, `rtk git`, `rtk grep`, `rtk rg`, `rtk wc`, `rtk find`, `rtk diff`, `rtk err`, `rtk log`, `rtk json`, `rtk test`, `rtk tsc`, `rtk docker`, `rtk kubectl`, `rtk gh`, ...), to prefix every command in an `&&` chain, and to use the meta commands `rtk gain` and `rtk proxy <cmd>`. The Windows `persistent-pwsh` row remains the current `minimal` row, so the preset changes only POSIX bash behavior.

The preset is discovered automatically: `agent-presets` scans the shipped root directory, so adding `apps/cli/config/agent-presets/minimal-rtk/` with `agent.cordis.yml` and `preset.yml` registers it without a manifest or allowlist change.

The integration is instruction-based: the guidance lives in the tool description, not an interception hook. DSH's bash tool has no command-interception point, so automatic rewriting is not expressible in an agent preset.

## Alternatives considered

### Why not automatically rewrite every command through `rtk rewrite`?

`rtk rewrite` is a hook engine transformer that substitutes supported commands. DSH's `bash` tool has no command-interception point; a preset can only change a tool's description and configuration. The preset therefore teaches the model the explicit-prefix rule instead of introducing a hook that cannot run.

### Why list commands explicitly instead of only naming `rtk rewrite`?

The explicit-prefix rule is the correctness guarantee because unsupported commands pass through unchanged when `rtk` is available. The examples show the model which commands have filters without teaching it a hook-internal command that is inert in this harness.

## Consequences

Users of `minimal-rtk` get the same current tool surface as `minimal` with compressed POSIX bash output, at the cost of requiring the `rtk` binary on `PATH`; the preset does not install or bundle it. Windows sessions retain the ordinary PowerShell tool description. The shipped preset roster and its Web e2e assertion include `minimal-rtk`.
