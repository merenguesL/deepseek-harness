# Agent Note: 设置-外观中的模型回复输出背景

Status: implemented

[English](2026-08-14-assistant-output-tint-appearance.md) | 中文

## 问题

模型回复的文字输出、思考披露与工具调用行都停留在同一块朴素表面上，长回答难以与周围的消息流区分。产品要求给模型回复输出（不含思考与工具调用）加上克制的浅青色背景，由「设置 → 通用 → 外观」下的开关控制，并允许用户自行挑选颜色（调色盘）。

## 决策

**主题插件拥有该偏好，会话插件负责渲染。** `ui-theme` 的持久化 section 新增 `outputTint`，一个通过既有 settings scope 持久化的 CSS 颜色字符串（空字符串表示关闭；该边界由 [Host settings 支撑的偏好决策](../../../.agents/notes/implemented/bug-fix/2026-08-06-host-backed-web-preferences.md) 拥有）。

## 曾考虑的替代方案

- **开关背后放固定 token。** 不采用：用户提出需要调色盘后，颜色必须由用户提供，因此设置项直接携带该值，CSS 直接消费。
- **会话插件硬注入 cordis `theme` 服务。** 不采用：底色是可选的表层功能；沿用既有 `chatFileMentions` 先例使用 `ctx.get` 加事件订阅，让 ui-conversation 在缺少 ui-theme 时仍可激活，同时收敛到主题构造时的发布。

## 后果

切换开关会把 `ui-theme.outputTint` 持久化到设置文档，并即时重绘文字输出（含流式帧）；更换调色盘颜色或通过开关清空都会立即生效并跨刷新保留。深色模式以 24% 透明度渲染用户颜色，浅色选择不会刺眼。该功能默认关闭（opt-in），纯展示层：不进入模型请求，也不进入会话日志。
