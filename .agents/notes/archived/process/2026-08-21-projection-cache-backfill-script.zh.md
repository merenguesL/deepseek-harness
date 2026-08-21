# Agent Note: 手动回填投影缓存的维护脚本

Status: implemented
Archived: 2026-08-21

[English](2026-08-21-projection-cache-backfill-script.md) | 中文

## 问题

持久化投影缓存（`<home>/storages/session_projcache.json`）在 `session_projcache` 域版本升位时丢弃整个介质，而 web GUI 的零 I/O 列读取正依赖它：用量统计页聚合 `tokenUsage`，统计条读取 `sessionStats`，会话列表读取 `sessionListMetadata`/`title` 提示。一次重建之后，只有重新进入运行态或被冷读过的会话才重新获得行；在运维部署上，79 个历史会话中有 65 个从未再被打开，用量统计页因此只显示最近两天（没有缓存 `tokenUsage` 的行按零聚合），唯一的补救手段是逐个手动打开会话。此前不存在任何批量路径：`coldSnapshot` 没有生产调用方。

## 决策

`packages/session/session-projection-cache/backfill.ts` 是一个手动运行的维护脚本：挂载与 shipped 组合一致的存储栈（`<home>/storages` 下的 json 后端与 storage-domain 形态）、带有用量相关单元的投影注册表（token-meter 的 `tokenUsage`/`contextPressure`/`contextBreakdown` 与 `sessionStats`）、真实的 jsonl 会话持久化以及投影缓存，然后对每个缺少可用缓存行的持久会话运行生产 `coldSnapshot` 梯子——全量日志回放、折叠、fail-soft 写回。已有可用记录的会话原样跳过，因此脚本未挂载的单元的行绝不会从其记录中被丢弃。

脚本在默认 dsh home 上运行时会先探测 127.0.0.1:3080：有响应即拒绝运行，因为运行中的服务持有介质的内存表，会在下一次检查点把整个文件重写、丢弃回填成果；`--force` 可越过探测，非默认 `DSH_HOME` 跳过探测。操作流程是：停掉 web 服务，运行 `pnpm exec tsx packages/session/session-projection-cache/backfill.ts`，再启动服务。首次真实运行在约 12 秒内回填了 65 个会话，零失败（最大单会话约 1.8 秒）。

## 曾考虑的替代方案

**产品内建的惰性回填**——由宿主在启动时或列表出现缺口时对缺行会话做冷读。它才是持久解（未来每次域版本升位都会再丢行），但属于需要配置面、限流与测试的产品变更；本次不采纳，介质下次重建时再重新评估。

**合并残留的 `.back`/`.pre-rebuild` 介质快照**——零回放，但快照只覆盖 65 个缺失会话中的 18 个，同样要求停服务，且运行中服务对整文件的重写会以完全相同的方式丢弃合并结果。从日志全量重放只慢一点，且无需快照考古。

**每次轮询全量扫描所有会话日志来聚合用量**——在本部署上实测每轮全量约 111 MB 解压 JSONL、秒级 CPU，且随历史线性增长；投影缓存的冷读梯子的存在意义正是避免这一点，用量统计页也已经骑在它上面。

## 影响

用量统计与统计条无需产品变更即可恢复，且脚本在未来每次缓存介质重建后都可重复运行。被回填的会话只携带已挂载单元的行：`title`、`todos`、`plan`、`goal`、`permissions`、`sessionListMetadata`、`imageLimits` 与 subagent 行在会话下次被打开（经完整注册表重折）之前保持缺失。存活探测是尽力而为——非默认端口上的服务不会被探测到——所以停服务才是真正的硬性要求，探测只是辅助。

## Testing

脚本针对运维部署手动演练（上述 65 会话运行），并针对一次性 `DSH_HOME` 验证空 home 路径；它有意位于包 tsconfig program 与发布 `files` 列表之外，因此没有单元测试固定它。
