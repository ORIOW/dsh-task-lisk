# 决策记录（DECISIONS）— dsh-task-lisk

> 本文件记录**已经由用户拍板或由官方机制定死**的决策，供实现时直接照做；需求与验收标准见 `HANDOFF.md`。
> 最后更新：2026-10-05（v1）。

## D1 · 自研而非选现成插件（m00300）
**决策**：自行开发一个 DSH 插件覆盖 6 项需求。
**理由**：13620 个 `dsh-plugin` 中无单个插件同时满足；四处空白（会话内任务同步、周期+子任务+分级、启动后 N 秒/倒计时提醒、暂停/停止）。
**证据**：`research/todoboard/REPORT.md`、`research/autoexec/REPORT.md`、`research/catalog/`。

## D2 · 需求 5「条件化提醒」整条撤回（m00459，用户）
**决策**：本插件**不实现任何提醒、调度、通知**。
**用户原话要点**：插件在侧边栏 GUI 显示出来就能看见待办任务，不需要提醒；已安装 `dsh-notify-me`，审批和会话提醒功能已经有了。
**后果**：
- 不做 `ctx.schedule` 集成（原 §5.0 方案作废，仅存为知识）；
- 不做启动补发、不做浏览器 `Notification`、不做兜底自写调度器；
- `HANDOFF.md` §6.4、§7 需求 5 行、§8 提醒项作废；
- 任务模型里的 `reminder` 字段删除；`NOW` 相关字段（`dueAt`）**保留**，仅用于列表显示与排序（deadline 仍是需求 4 的一部分）。

## D3′ · UI 形态：shell.overlay 浮动窗取代主面板（2026-10-18 用户拍板，2026-10-27 批 1 落地）
**决策**：客户端入口为 `sidebar.footer.action` 自绘按钮（`id: dsh-task-lisk`，窄栏只显图标、宽栏显「任务」+ 未完成徽标），点击开关 `shell.overlay` 可拖拽浮动看板（`id: dsh-task-lisk.float`，标题栏含任务/刷新/×）。
**原 D3 作废原因**：用户反馈看板藏在侧边栏图标后查看不便，已拍板改为浮动窗 + 侧栏底部按钮。
**备注**：原 D3 方案（`sidebar.panellist` 图标 + `main` keyed 主面板，m00459 引出 + 需求 2）自本条起作废，不再执行。

## D4 · 需求 4「周期重复任务」保留，但语义收窄
**决策**：周期 = 任务自身的状态机——完成一次后按规则生成**下一次实例**（新的 deadline/时间点）；`daily` / `weekly`（含 `byWeekday`）/ `monthly`（自写，因为原生 cron 已随需求 5 撤回而不可用）。
**理由**：这是"任务清单"的语义，不是"提醒"的语义；用户撤回的只是提醒。

## D5 · 需求 3 的同步方向（待用户确认，默认按此实现）
**默认**：**自建权威列表**（板是真相），并**折叠官方 `todo_write` 事件**把会话内任务上行同步进板（按 `sessionId + content` 幂等 upsert，标 `source.kind='session-todo'`）。
**理由**：官方 `todos` 投影在 `turn/start` 归 `null`，不能当持久层；官方 practices 也要求插件自有数据放在 storage 服务里。
**下行**：面板把任务派发到指定会话（`agent.steer` / `agent.followup`，先例 `research/todoboard/package/lib/index.js:1614-1627`）。

## D6 · 存储形态（待用户确认，默认按此实现）
**默认**：`ctx.storageDomain.open(spec)`（原生、有 `domain/changed` 事件）。
**兜底**：`$DSH_HOME/task-lisk/board.json` 原子写（临时文件 + rename），便于人肉编辑与导出。

## D7 · 安装方式（官方技能铁律，不再讨论）
**决策**：工作区内写 bundle 包 → `plugin_manager action: install_bundle`，`target` = 包目录。
**禁止**：手改 profile 的 `package.json`/`cordis.patch.yml`；在 `$DSH_HOME` 下建包；在 profile 目录跑 pnpm。
**备注**：每次 `plugin_manager` 调用需审批；新装 bundle 可经 HMR 生效，替换已装包才需重启。

## D8 · 放置平面（官方技能判定，不再讨论）
**决策**：本插件全部能力挂 **Host 平面**（工具注册、`agent/pre-step` 钩子、持久化、`webServer` 路由、槽位声明）。
**理由**：提供共享服务的插件必须放 Host；preset 只贡献作用域内的工具/人格/提示段。

## D9 · 需求 6 的暂停/停止判据（技术定死）
- **暂停**（可原地恢复）= 在 `agent/pre-step` 里 `await` 一个 gate Promise，只拦 `step > 1`；参考 `dsh-pause` `lib/index.js:328/332-341/349/355-359`。
- **硬停**（本轮结束回 idle）= `return { kind: 'reject' }` ⇒ `turn/end {reason:{kind:'blocked'}}`。
- **续跑下一子任务** = `agent/turn-stopping`（事后动作，不能否决回合）。
- 提示词只能实现"软暂停"（模型自愿结束回合），不作为主机制。

## D10 · `on-subtask-done` 的语义收窄为「真正完成一个任务后暂停」（2026-10-17 第二轮）
**决策**：只有**真正的完成动作**才武装卡门——`task_lisk complete`（`status:"todo"` 的取消完成不算）、`task_lisk update status:"done"`、`todo_write` 里**新变成** `completed` 的条目。只读 `list`、新建 `create`、改标题、失败结果、子派发（子 agent）一律不武装。
**理由**：需求 6 的原文是「执行完一个子任务就暂停」；旧实现「任何 task_lisk/todo_write 成功调用都武装」会让只读一次 `list` 就停下，语义退化。
**代价（如实记录）**：设置该策略后，若 agent 在一次工具调用后直接结束回合，卡门不会触发（pre-step 门天然只在「还有下一步」时生效）——与 `dsh-pause` 的启发式一致。

## D11 · 标识不互信：门与武装同时按 agentId 与 sessionId 记账
**决策**：卡门表以 agentId 为键但记录 `{agentId, sessionId}`，`release` 按任一命中；武装标记两个标识都放；`agent/disposed` 除清标记外必须 `reject` 掉挂起的门。
**理由**：`dsh-pause` 用 `payload.agent.id` 当会话键（说明根 agent 的 id 通常等于会话 id），客户端 `release` 只发 `sessionId`——「两者恒等」是**未文档化的巧合**，一旦不成立就是「永远放行不了」或「挂起的 pre-step 悬空」。不把巧合当前提。

## D12 · 完成时间只有一个写入口
**决策**：新增 `setStatusOf(record, status)`：`done` 一律走 `completeTask`（写 `completedAt`/`lastCompletedAt`、周期任务滚动），其余状态清 `completedAt`；RPC `setStatus`、RPC `update`、工具 `update` 三处共用。
**理由**：旧实现里工具 `update status=done` 只 patch `status`，会出现「已完成但没有完成时间、周期任务不滚动」的坏记录。

## 仍待用户拍板
| # | 问题 | 默认 |
|---|---|---|
| 1 | 插件名是否用 `dsh-task-lisk` | 用 |
| 3 | 存储：`storageDomain` 还是 JSON | `storageDomain`（兜底 JSON） |
| 4 | 是否把官方 `todo_write` 当主列表 | 否（自建权威 + 上行同步） |
| 6 | 安装时机（是否接受 HMR 不重启） | 先试 HMR，无效再约重启 |