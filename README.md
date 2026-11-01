# dsh-task-lisk · DSH 任务看板

> 跨工作区、跨会话的任务看板插件，为 [DeepSeek Harness](https://github.com/deepseek-ai) Desktop（Web profile）编写。
> 侧栏底部按钮开关一块可拖拽的浮动看板，用户与 agent 读写同一份任务数据。

- 当前版本：`0.1.2`
- 许可证：MIT（见 [LICENSE](LICENSE)）
- 宿主要求：DSH Desktop `>= 0.2.0-rc.2`，peer 依赖 `@deepseek-ai/cordis ~4.0.4`、`react ^18.2.0`（由宿主提供，不随包安装）

## 功能

- **跨工作区、跨会话**：任务存在宿主侧领域存储（`ctx.storageDomain`，进程级全局、重启保留），与会话/工作区无关；任务上的 `sessionId` / `workspace` 只是归属标签。
- **侧栏 + 浮动看板**：`sidebar.footer.action` 自绘按钮（窄栏只显图标，宽栏显「任务」+ 未完成徽标），点击开关 `shell.overlay` 浮动窗（可拖拽、可缩放，几何与开合状态持久化）。
- **双向编辑**：面板新增/改写/勾选/删除/加子任务；agent 用 `task_lisk` 工具（`list` / `create` / `update` / `complete` / `remove`）。反向折叠官方 `todo_write` 的会话事件，把 agent 会话内清单自动同步为看板任务。
- **子任务 / 分级 / 截止 / 周期**：`parentId` + `depth`（默认层级上限 2）、`priority: low|normal|high|urgent`、`dueAt`（面板显示今天/明天/逾期）、`repeat: daily|weekly|monthly`（完成后原地滚到下一周期，`monthly` 做月末夹取）。
- **按会话分组**：看板按自身实测宽度 `< 480px` 自动分组，工具栏三态下拉（自动/扁平/分组）可显式覆盖；组头取会话标题（取不到回退短 id），当前会话组左侧色条 +「当前」标签，组可折叠，无会话任务归「未分组」并置底。
- **问号帮助**：标题栏「?」打开 6 节内嵌帮助浮层（不新开席位，点遮罩或 `Esc` 关闭，首次打开不自动弹）。
- **每日首访提示**：当天第一次打开看板且仍有未完成任务时，顶部出现一条可关闭横幅（有逾期时追加数量）；展示即记，同一天不重复，跨天自动重置，无定时器、不发通知。
- **条件化暂停 / 硬停**：策略 `off` / `every-step` / `on-subtask-done` / `stop`，在 `agent/pre-step` 卡门等人在面板「放行」（可附一句话并入该步消息），或直接硬停本回合。
- **不做提醒**：`dueAt` 只用于显示与排序，通知交给 `dsh-notify-me`。

## 安装

必须通过 DSH 插件管理器安装（install 是 **generation 拷贝**，不是软链到源码）：

```text
plugin_manager(action="install_bundle", target="<本仓库 dsh-task-lisk 目录的绝对路径>")
```

改过源码后重装，**另一条命令不够用** —— 相同版本号直接重装只会返回 `already-installed`，必须先移除：

```text
plugin_manager(action="remove_bundle",  target="dsh-task-lisk")
plugin_manager(action="install_bundle", target="<...>\dsh-task-lisk")
```

安装后插件在 profile 的 `cordis.patch.yml` 中表现为 `id/name = dsh-task-lisk`。
**不要**手改 profile 的 `package.json` / `cordis.patch.yml`，也不要在 profile 目录里跑 pnpm。

浏览器半身的改动需要刷新页面才生效；宿主半身的改动需要重启 Harness 子进程。

## 验证（工作区级脚本，不进包）

三个套件都不需要启动 GUI，用桌面版自带的 Electron node 即可（它自带 asar 读取能力）：

```powershell
cd "<本仓库根>"
$node = "C:\Users\A005490\AppData\Roaming\dsh-desktop\harness\.desktop-bin\node.cmd"

& $node --check dsh-task-lisk/lib/index.js
& $node --check dsh-task-lisk/lib/client.js
& $node --import ./smoke-loader.mjs smoke-task-lisk.mjs      # 40 项：加载形状 / 口径 / 纯逻辑 / SSR
& $node --import ./smoke-loader.mjs smoke-host-runtime.mjs   # 74 项：伪 ctx 真跑 apply()，工具 / RPC / 折叠 / 卡门
& $node --import ./smoke-loader.mjs verify-bundle.mjs        # 31 项：bundle 契约与产物自检
```

`smoke-loader.mjs` 把裸包解析锚点指向 `<resources>/app.asar/node_modules/`：官方 `@deepseek-ai/*` 只存在于 asar 归档内部，而该运行时自带 asar fs 垫片，所以归档内文件可正常解析。

## 仓库结构

```text
.
├── dsh-task-lisk/            # 插件本体（安装时指向这个目录）
│   ├── package.json          # dsh.bundle.patch + dsh.client{platform:'web'}
│   ├── cordis.patch.yml      # 把插件 insert 进 profile 组合
│   ├── README.md             # 功能与实现细节（需求覆盖表、宿主 API 依赖、RPC 端点）
│   └── lib/
│       ├── index.js          # 宿主半身：领域存储 / RPC 通道 / task_lisk 工具 / 会话折叠 / 暂停卡门
│       └── client.js         # 浏览器半身：侧栏按钮 + 浮动看板 + 分组 + 帮助 + 每日首访提示
├── smoke-task-lisk.mjs       # 客户端套件（40 项）
├── smoke-host-runtime.mjs    # 宿主套件（74 项，伪 ctx 真跑 apply）
├── verify-bundle.mjs         # bundle 契约自检（31 项）
├── smoke-loader.mjs          # 裸包解析锚点（指向 app.asar）
├── DECISIONS.md              # 设计与选型决策记录
├── HANDOFF.md                # 阶段交接账本
├── SESSION-BRIDGE.md         # 双会话（开发 / 派活）协作桥
├── autoclaw_tasks/           # 派给外部执行会话的任务单
└── autoclaw_results/         # 执行会话回执（status 字段为权威完成信号）
```

`research/`（取证与探针草稿）、`tmp/`、依赖与构建产物不进版本库（见 `.gitignore`）。

## 文档

- 功能与实现细节：[dsh-task-lisk/README.md](dsh-task-lisk/README.md)
- 技术与产品决策：[DECISIONS.md](DECISIONS.md)
- 阶段交接：[HANDOFF.md](HANDOFF.md)

## 许可证

[MIT](LICENSE)