# Agent Note: JSONL 损坏报出真正的已提交缺陷

Status: implemented

[English](2026-08-15-jsonl-committed-defect-diagnostics.md) | 中文

## Problem

第二个进程在会话的属主 harness 进程仍然存活时对其做冷准备，会把崩溃修复闭合事件（一条 `interrupted-tool-result` tool/result、一条 step/end 和一条 interrupted turn/end）提交到持久日志末尾。属主进程看不到这些闭合事件：当它在途的工具调用稍后结算时，其追加会复用相同的 seq 编号，于是日志在受影响区间内每个 seq 出现两条事件。随后 `load()` 拒绝该会话，而 JSONL zstd 读取路径报出 `corrupt Zstandard session log: complete frame contains a torn JSONL record`——这条消息指错了缺陷，因为帧结构与校验和都完好；真正的损伤是已提交区域内的 seq 冲突。

同一个 checkpoint 检查还会掩盖无法解析的已提交行。这两种情况只有在后续某行携带 `turn/end` 时才会暴露真实错误；否则扫描以 `committedBytes < inputBytes` 结束，抛出的是撕裂记录消息。

## Decision

`SessionLogScanner` 通过 `problem` 暴露其第一个已提交区域缺陷——无法解析的行或 seq 缺口，附带行号与期望/实际 seq。`readZstdPrefix` 在完整帧扫描未能提交全部字节时抛出该缺陷；撕裂记录消息只保留给扫描干净、但最后一个记录在完整帧内确实不完整的情况。

这只是诊断修复：损坏的已提交区域仍然大声拒绝加载。它从不截断、重编号或丢弃已提交事件，因为模型可见的 transcript 必须与日志一致。

## Alternatives considered

**加载时自动修复重复 seq 岛。** 拒绝：选择哪个 seq 副本为真需要语义判断——事故中合成闭合事件可以凭消息 id 模式识别，但没有任何通用规则是安全的——而且静默丢弃已提交事件会违反 model-visible ⟺ logged 不变式。

**改为修复写侧（跨进程所有权）。** 根因是第二个进程对活动会话的日志做崩溃修复。预防需要跨进程锁或等价的活动性证明；见 Deferred。

**去掉 checkpoint 检查。** 拒绝：正是该检查拒绝完整帧内真正撕裂的末记录；需要改的只是它的诊断信息。

## Deferred

写侧预防尚未实现：JSONL 后端没有跨进程所有权原语，因此第二个进程的 `load()`/`prepare()` 仍可能向属主进程存活的日志提交崩溃修复闭合事件，属主随后的追加会冲突。预期的修复是属主进程持有的跨进程排他锁（含 Windows 对等实现）；上述读侧改动只是让由此产生的损坏报出真实原因。

## Consequences

损坏的已提交区域现在会使 `load()` 带行号与期望/实际 seq（或无法解析的行）失败，操作者可以定位冲突，而不是去追查一个并不存在的帧问题。撕裂记录消息仍然在其真实场景下触发。会话历史在日志修复前仍不可读；事故会话通过删除合成闭合事件行恢复，恢复 seq 连续性且无需重编号。

## Testing

单元覆盖新增两个拒绝用例：完整帧重复已提交 seq 时报 seq 缺口；完整帧内含无法解析行时报无法解析事件。既有的撕裂记录拒绝用例在末记录真正不完整时保持原消息。
