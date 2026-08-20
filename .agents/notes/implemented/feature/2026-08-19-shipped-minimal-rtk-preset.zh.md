# Agent Note: 新增内置预设 minimal-rtk（bash 输出经 rtk 压缩）

Status: implemented

English | [English](2026-08-19-shipped-minimal-rtk-preset.md)

## Problem

内置预设 `minimal` 是双工具基准面：固定 persona、持久 shell 与 `str_replace_editor`。对于 `PATH` 中已有 `rtk` CLI（Rust Token Killer、[rtk-ai/rtk](https://github.com/rtk-ai/rtk)）的部署，需要一个变体，让受支持的 bash 输出在进入模型上下文前被过滤压缩。

## Decision

新增预设 `minimal-rtk`，它基于当前 `minimal`，唯一的 POSIX 行为差异是 `persistent-bash` 的 description：指示模型把受支持的命令一律加 `rtk` 前缀（`rtk ls`、`rtk read`、`rtk git`、`rtk grep`、`rtk rg`、`rtk wc`、`rtk find`、`rtk diff`、`rtk err`、`rtk log`、`rtk json`、`rtk test`、`rtk tsc`、`rtk docker`、`rtk kubectl`、`rtk gh` 等），`&&` 链中每个命令都单独加前缀，并可使用元命令 `rtk gain` 与 `rtk proxy <cmd>`。Windows 的 `persistent-pwsh` 行保持当前 `minimal` 内容，因此该预设只改变 POSIX bash 行为。

预设由目录扫描自动发现：`agent-presets` 会扫描内置根目录，因此在 `apps/cli/config/agent-presets/minimal-rtk/` 放下 `agent.cordis.yml` 与 `preset.yml` 即可注册，无需 manifest 或白名单改动。

集成方式为指令式：指引写在工具 description 里，而非拦截 hook。DSH 的 bash 工具没有命令截获点，因此自动改写无法在 agent 预设中表达。

## Alternatives considered

### 为何不用 `rtk rewrite` 自动改写每条命令？

`rtk rewrite` 是 hook 引擎的转换器，用于替换受支持的命令。DSH 的 `bash` 工具没有命令截获点，预设只能改动工具 description 与配置，因此预设通过显式前缀规则指导模型，而不引入无法运行的 hook。

### 为何显式列出命令而不只是提 `rtk rewrite`？

显式前缀规则本身是正确性保证，因为 `rtk` 可用时不支持过滤的命令会原样透传。示例用于让模型知道哪些命令有过滤器，同时避免教模型一个在本 harness 中无效的 hook 内部命令。

## Consequences

`minimal-rtk` 用户获得与当前 `minimal` 相同的工具面，并使用压缩后的 POSIX bash 输出，代价是需要 `rtk` 二进制位于 `PATH` 上；预设不安装也不打包它。Windows 会话仍使用普通的 PowerShell 工具描述。内置预设 roster 及其 Web e2e 断言都包含 `minimal-rtk`。
