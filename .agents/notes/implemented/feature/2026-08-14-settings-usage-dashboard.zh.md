# Agent Note: 基于会话投影的纯客户端设置页用量统计仪表盘

Status: implemented

[English](2026-08-14-settings-usage-dashboard.md) | 中文

## Problem

Web GUI 此前没有展示 provider 上报 token 总量的页面，但现有会话列表已经可选地携带累计 `tokenUsage` 投影。为此增加宿主用量 RPC 和时间序列投影，会让功能超出浏览器增强的范围，并修改核心骨架包。

## Decision

本功能保持现有宿主、API、token-meter、连接和设置骨架包不变。

新增 `@deepseek-ai/dsh-client-ui-settings-usage` 可选浏览器插件。它通过现有插槽账本注册 `settings.section` 条目，提供自己的语言字典，并通过 `InjectFace` 的 hook 绑定自己的快照 store。Web bundle 只在组合清单中增加该插件。

报告由插件基于现有 `session.list` 响应构建。每行在存在时读取持久化的 `tokenUsage` 投影；对这些累计桶来说，总量和工作区/会话明细是准确的，但调用数是每个非零会话至少一次的下限，回合数、步骤数和模型耗时保持不可用。

使用每行的 `updatedAt` 作为一次本地活跃标记来生成日趋势和热力图。这样可以在不假装累计投影包含每次请求时间或模型/provider 维度的前提下提供有用页面。

## Alternatives considered

- **新增宿主 `usage.describe` RPC 和按小时分桶投影** —— 否决：本次重放只需要可选浏览器页面，不应为此修改 wire 和 token-meter 骨架。
- **修改 `SettingsRoot` 或设置导航投影** —— 否决：`settings.section` 已经提供注册和渲染插槽。
- **让浏览器读取每个会话的全部历史** —— 否决：现有列表投影有明确边界，客户端页面不应制造无界的历史读取负载。
- **增加模型/provider 明细** —— 否决：`tokenUsage` 不携带模型或 provider 键。

## Consequences

该功能可以从 bundle 中移除而不触碰设置骨架或任何宿主契约。仪表盘只统计当前 `session.list` 返回的会话；没有 token 投影的行按零计入。时间图表是活跃标记可视化，不是精确请求历史，调用数明确是下限。

报告在首次挂载、手动刷新和连接重置且仍为空闲时重新构建。它没有写入路径、推送失效、宿主状态或面向模型的效果。

## Testing

- 客户端包基于当前上游插件图独立通过类型检查。
- 包测试覆盖声明前后插槽注册、随语言切换的标签、HMR 恢复、连接重置、store 加载/错误/latest-wins 状态、仪表盘渲染以及报告聚合/规范化。
- Web 组合只在 bundle 清单中保留该包，不修改 `SettingsRoot`、连接契约、API proxy 文件或 token-meter 投影。
