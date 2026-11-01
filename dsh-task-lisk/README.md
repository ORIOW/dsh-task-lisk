# dsh-task-lisk（DSH·任务看板）

跨工作区、跨会话的任务列表插件：**侧栏底部按钮开关 shell.overlay 浮动看板**，用户和 agent 双向读写，
支持子任务、优先级、截止时间、周期重复，以及条件化的暂停/硬停。

## 需求覆盖

| 需求 | 实现 |
| --- | --- |
| 1 跨工作区、跨会话 | 任务存在宿主侧领域存储 `task-lisk`（`ctx.storageDomain`，进程级全局，重启保留），与具体会话/工作区无关；任务上只记录来源 `sessionId` / `workspace` 作为归属标签 |
| 2 侧边栏 / 浮动 GUI | `sidebar.footer.action` 自绘按钮（`id: dsh-task-lisk`，窄栏只显图标、宽栏显「任务」+ 未完成徽标），点击开关 `shell.overlay` 可拖拽浮动看板（`id: dsh-task-lisk.float`）；看板按实测宽度自动在「扁平 / 按会话分组」间切换（工具栏三态下拉可显式指定），标题栏「?」按钮打开内嵌帮助浮层（详见「浮动看板的分组」「问号帮助」两节） |
| 3 用户与 agent 双向编辑 | 用户：面板新增/改写/勾选/删除/加子任务；agent：`task_lisk` 工具（list/create/update/complete/remove）读写同一份数据；反向：折叠官方 `todo_write` 的 `todo/write` 会话事件，把 agent 会话内清单自动同步成看板任务（不重复建同名任务，只更新状态） |
| 4 子任务 / 周期 / 分级 / deadline | `parentId`+`depth`（默认层级上限 2，可配 `maxDepth`）；`priority: low\|normal\|high\|urgent`；`dueAt`（epoch ms，面板显示今天/明天/逾期）；`repeat: daily\|weekly\|monthly` —— 完成后**原地滚到下一周期**（`rollCount` 计数，`monthly` 做月末夹取） |
| 5 提醒 | **不实现**（用户已撤回该需求：面板可见即可，通知交由 `dsh-notify-me`）。`dueAt` 仅用于显示与排序 |
| 6 条件化执行 / 停止 | 会话级策略（默认策略 + 逐会话覆盖，存领域 global）：`off` 不干预；`every-step` 每次模型请求前卡门等人在面板点「放行」（可选填一句话，作为 notice 并入该步的 messages）；`on-subtask-done` 只在 agent **真正完成**一个任务时武装（`task_lisk complete` / `update status=done` / `todo_write` 里新变成 `completed` 的条目），下一步之前卡门；只读 `list`、新建、改标题都不算；`stop` 在 `agent/pre-step` 返回 `{kind:'reject'}` 硬停本回合（先注入一条 notice 让模型改为总结说明） |

## 安装

工作区包（workspace bundle）形式，由 DSH 插件管理器安装：

```
plugin_manager(action="install_bundle", target="<本目录绝对路径>")
```

安装后插件在 profile 的 `cordis.patch.yml` 里以 `id/name = dsh-task-lisk` 出现；
**不要**手改 profile 的 `package.json` / `cordis.patch.yml`，也不要在 profile 里跑 pnpm。

## 结构

```
dsh-task-lisk/
├── package.json          # dsh.bundle.patch + dsh.client{platform:'web'}
├── cordis.patch.yml      # 把插件 insert 进 profile 组合
└── lib/
    ├── index.js          # 宿主半身：领域存储 / RPC 通道 / task_lisk 工具 / 会话折叠 / 暂停卡门
    └── client.js         # 浏览器半身：sidebar.footer.action 开关按钮 + shell.overlay 浮动看板
```

## 浮动看板的分组（批 2 · F2）

看板列表有「扁平」与「按会话分组」两种呈现，判定基准是**看板自身实测宽度**（拖拽/缩放后的 `w`），不是 `window.innerWidth`：实测宽 < 480px 自动按会话分组，≥ 480px 保持扁平。默认窗宽 380，因此安装后首次打开即为分组视图（用户已确认接受）。

- 工具栏（与筛选/刷新同一行）有「分组」三态下拉：**自动 / 扁平 / 分组**。显式选择覆盖自动判定，选回「自动」恢复按宽度判定；三态持久化在 `localStorage` 键 `dsh.task-lisk.float.v1` 的 `groupMode` 字段（值 `auto|flat|grouped`）。
- 组头 = 会话标题（从客户端 sessions 服务取 `displayTitle`，取不到回退短 id）；组间按会话在列表中的首次出现顺序，组内沿用既有排序口径（`order` → 创建时间），不新造第二套排序。
- 无 `sessionId` 的任务归「未分组」组：置底且始终显示（不可折叠、不受折叠影响）。
- 组可点击折叠/展开；折叠态持久化到新键 `dsh.task-lisk.float.collapsed.v1`（形如 `{ [sessionId]: true }`，全局一份）。
- 分组只是视觉重排，不过滤、不隐藏任何任务。
- 当前会话组高亮：左侧色条 +「当前」小标签。数据来自客户端 sessions 服务（主会话判据 `retainedBy.mainView > 0`）；服务不可用或取不到当前会话时高亮自动关闭，UI 新建任务不带 `sessionId`（保持 `null`），绝不臆造。UI 新建任务（含子任务）在拿到当前会话 id 时会写入该 id。

## 问号帮助（批 2 · F3）

入口是浮动看板标题栏的「?」按钮（排在「任务」标题与「✕」之间）：点击打开；点击面板外的暗色遮罩或按 `Esc` 关闭；首次打开看板不自动弹出。

内容固定 6 节：① 看板是什么；② 任务·子任务·周期；③ 优先级·截止；④ 给 agent 用（`task_lisk` 工具）；⑤ 暂停与放行（含放行留言）；⑥ 浮动与分组用法。

帮助是看板内部的第二浮层（绝对定位覆盖看板本体，不新开席位），避免被窄容器裁切；看板关闭时帮助不可达。

## 每日首访提示（批 3 · P2）

每天**第一次打开浮动看板**时（本地日历日口径，`YYYY-MM-DD`），若还有未完成任务，看板顶部（工具栏之上）出现一条可关闭的横幅：文案含未完成数（`今天还有 N 个未完成任务`），有逾期时追加 `，其中 M 个已逾期`。

- 展示即记：横幅出现时就写盘，用户看没看都算当天已提示，同一天不反复打扰；点「知道了」只隐藏当前横幅，不再写盘。
- 当天打开时未完成任务为 0：不显示横幅、也不写盘（当天后来新建了任务，再打开仍会正常提示）。
- 跨天自动重置（本地日期判定）；「暂停/硬停」策略不影响本提示。
- 持久化键 `dsh.task-lisk.nudge.v1`（值形如 `{"date":"2026-11-01"}`，全局一份）；读写全 `try/catch`，localStorage 不可用时视为从未提示且不影响看板。
- 不发 RPC、不写任务数据、不发系统通知、不自动打开看板、无定时器。

## 宿主 API 依赖（均为运行时既有）

- `ctx.storageDomain.open(defineDomain(...))` —— 领域名 `task_lisk`（**领域/表名不允许连字符**），表 `tasks`，global 存策略 + `configDefaultApplied`
- `ctx.tools.register(defineTool(...))` —— 工具 `task_lisk`
- `ctx.webServer.register({kind:'prefix', path:'/dsh-task-lisk'})` + `ctx.connection.requestRejection` —— RPC 通道
- `ctx.on('session/event')` —— 折叠 `todo/write`
- `ctx.on('agent/pre-step')` / `ctx.on('tools/result')` / `ctx.on('agent/turn-stopping')` / `ctx.on('agent/disposed')` —— 暂停/停止
- 客户端：`ctx.slots.inject('shell.overlay'|'sidebar.footer.action')` + `ctx.connection.rpc.call(channel, method, payload)`

## RPC 端点

`list` / `create` / `update` / `toggle` / `setStatus` / `remove` / `policy` / `release` / `import` / `status`。
信封与 DSH 连接层一致：请求 `{type:'client-request', method, payload, rpcId}` →
响应 `{type:'server-response', rpcId, result:{ok:true,value}|{ok:false,error:{code,message,details}}}`。
`release` 可带 `text`（人类放行时的补充说明），会作为 notice 并入该步 `messages`。

`task_lisk` 工具的 `list` / `create` / `update` / `complete` / `remove` 输出里每条任务都带 `sessionId`（无会话为空串 `""`，不是 `null` / 缺字段）；`list` 的 `summary` 行尾对非空会话追加 `sid=<前 8 位>`，便于核对任务归属哪个会话。

## 验证（工作区级脚本，不进包）

```powershell
cd "<本目录上一级>"
$node = "C:\Users\A005490\AppData\Roaming\dsh-desktop\harness\.desktop-bin\node.cmd"
& $node --import ./smoke-loader.mjs smoke-task-lisk.mjs        # 40 项：加载/注册形状/口径/纯逻辑（含 F2/F3/P2）/SSR
& $node --import ./smoke-loader.mjs smoke-host-runtime.mjs     # 74 项：伪 ctx 真跑 apply()（工具/RPC/折叠/卡门，含 sessionId 输出断言）
```

`smoke-loader.mjs` 把裸包解析锚点指到 `<resources>/app.asar/node_modules/`：官方
`@deepseek-ai/*` 只存在于 `app.asar` **归档内部**，该进程是 Electron（自带 asar fs 垫片），
所以归档内文件可以正常解析与读取；旧版指向 `app.asar.unpacked` 的锚点已失效。

## 已知边界（P0）

- 面板每 1.5s 轮询 `list`；数据量在数百条内无压力，未做增量推送。
- 子任务层级上限默认 2（`maxDepth` 可调到 4）。
- 周期任务只做「原地滚动」，不生成历史实例（历史仅由 `rollCount`/`lastCompletedAt` 体现）。
- 面板文案暂为硬编码中文（未接 `ctx.clientLocale`），后续可迁移到 locale 命名空间。
- 删除任务默认级联删除子任务（面板会二次确认）。
- 当前会话高亮依赖客户端 sessions 服务；服务缺失或取不到当前会话时自动降级（不显示高亮，新建任务不带 `sessionId`）。