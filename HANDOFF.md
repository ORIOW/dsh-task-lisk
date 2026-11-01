# DSH 任务管理插件 — 需求与设计交接文档（HANDOFF）

> **本文件用途**：把用户提出的 6 项需求、前期调研结论、运行时真值、官方 API 证据、工程规范与分期计划一次性固化，供**新会话/新 Agent 无上下文直接接手实施**。
> **版本**：v3 · 2026-10-05（本机 DSH Desktop，profile `web`）。
> **v3 变更（优先于下文任何冲突内容；决策记录见同目录 `DECISIONS.md`）**：
> 1. **需求 5「条件化提醒」整条撤回**（用户 m00459 原话：「7.提醒功能，我想了想应该不需要了，因为只要插件在侧边栏的GUI显示出来，我就可以看见待办任务，根本不需要提醒。而且我已经安装dsh-notify-me插件，审批和会话提醒的功能已经有了」）⇒ 本插件**不做任何提醒/调度/通知**：下面 v2 修正第 3 条所写的原生 `ctx.schedule` 方案**作废**（§5.0 仅存为知识）；§6.4、§7 的"需求 5"行、§8 的提醒项全部作废。
> 2. **UI 形态定案：shell.overlay 浮动窗取代主面板**（`sidebar.footer.action` 侧栏底部按钮开关 `shell.overlay` 可拖拽浮动看板 `dsh-task-lisk.float`；2026-10-18 用户拍板、2026-10-27 批 1 落地，详见 `SESSION-BRIDGE.md` §2.1）。待决问题 2 关闭。
> 3. **需求 4 的"周期重复任务"保留**：其语义是"完成一次后生成下一次实例"（任务自身状态机），与提醒无关；`monthly` 因不再有原生 cron 兜底，由插件自写。
> 4. 待决问题 5（外部通知通道）、7（提醒语义）**关闭**；问题 1（插件名）、3（存储）、4（是否镜像官方 `todo_write`）、6（安装窗口/HMR）仍开放。
> **v2 相对 v1 的修正**（v1 的结论已被推翻，勿按 v1 执行）：
> 1. **安装方式**：v1 写的"手改 profile 的 `package.json`/`cordis.patch.yml` + 在 profile 跑 pnpm"**作废**；权威做法是**写工作区 bundle 包，再用 `plugin_manager` 的 `install_bundle`**（它自行完成安装与 bundle 选择）。
> 2. **放置平面（v1 标记的"头号风险"已解除）**：官方技能权威判定——**提供共享服务的插件必须放 Host 平面**（tools/prompt 注册表、Agent loop、sessions、持久化、settings、sandbox、模型路由、subagent 后端都由 Host 插件提供）；preset 只贡献**作用域内**的工具/人格/提示段/策略。我们的插件挂 Host 平面即可，不必担心 preset 会话里看不见。
> 3. ~~需求 5 有原生实现可复用（`ctx.schedule`）~~ → **已被 v3 第 1 条作废**。
> 4. **持久化优先走原生 `ctx.storageDomain`**（§5.10），自写 JSON 只作为兜底。
> **本文档性质**：需求 = 权威（用户原话照录）；技术真值 = 分「已验证（带 `path:LINE` 或 inspect 契约）」与「待核验」两类，**未标注的都当待核验处理**。
> **未做的动作**：未安装、未启用、未运行任何自研插件；未改动 web profile（v2 起也不需要手改）。

---

## 0. 一句话任务

在 `C:\Users\A005490\Desktop\old\old AI files\DSH plugins develop\task_lisk` 下**自研一个 DSH 插件**（暂定名 `dsh-task-lisk`），用一个插件覆盖下面 6 项需求；现成生态（13620 个 `dsh-plugin` 主题插件）中**没有任何一个同时满足**（见 §2）。

---

## 1. 需求（用户原话，m00001 逐字照录）

> 寻找dsh有没有类似任务列表或任务管理器的插件，要满足以下功能：
> 1、支持跨工作区、跨对话；
> 2、在侧边栏中，或者浮动GUI；
> 3、支持用户和agnet编辑任务列表，用户可以给会话规划任务，agent也可以把自己生成的会话内的任务同步到任务列表中；
> 4、支持子任务，按周期重复任务，任务分级，deadline；
> 5、支持条件化的任务提醒，比如dsh desktop启动后xx秒进行提醒，定时提醒，倒计时提醒等；
> 6、支持条件化的任务执行和停止，比如执行完一个子任务就暂停

补充（用户后续追问，m00297）：**是否可以通过传提示词让模型自行判断已完成子任务、自行暂停输出**——结论是只能做到"软暂停"，见 §9.3；正式的暂停/停止要用 `agent/pre-step`（见 §5.1、§6.6）。

### 1.1 需求逐条拆解 + 验收标准

| # | 需求 | 拆解 | 可测验收标准（新会话直接照此验） |
|---|---|---|---|
| 1 | 跨工作区、跨对话 | 存储必须是**单一全局库**，不按 workspace/session 分库；面板按 cwd 分组只是视图 | 在 A 工作区建的任务，切到 B 工作区、并在新会话中打开面板可见；杀掉 DSH 重启后仍在 |
| 2 | 侧边栏 或 浮动 GUI | 至少一种；浮窗需可拖、可缩、位置记忆 | 浮窗在页面上可拖动/缩放，刷新页面后位置保持；P1 再补侧边栏入口 |
| 3 | 用户与 agent 双向编辑 + **会话内任务同步进列表** | (a) 用户可增删改；(b) agent 有工具可增删改；(c) **自动**把会话内 `todo_write` 的任务落板 | agent 在一次会话里调 `todo_write` 写 3 条 → 面板出现这 3 条并标注来源会话；用户在面板改标题 → agent 工具 `list` 读到新标题 |
| 4 | 子任务 / 周期重复 / 任务分级 / deadline | 四个独立字段能力 | 建父任务+2 子任务，完成子任务不影响父状态；建「每周一 09:00」任务完成一次后自动生成下一次；设置 P0-P3 可按优先级排序；设置 deadline 后列表显示剩余时间 |
| 5 | 条件化提醒：启动后 N 秒 / 定时 / 倒计时 | 三种触发形态；**优先复用原生 `ctx.schedule`**（§5.0） | (a) 设「DSH 启动后 30 秒」提醒，重启 DSH → 30 秒后到达；(b) 设绝对时间 → 到点到达；(c) 设「10 分钟后」→ 到点到达。DSH 关闭期间错过的提醒在下次启动立即补发 |
| 6 | 条件化执行与停止 | 暂停（可原地恢复）与硬停（本轮结束）两种，判据来自子任务状态 | 建 2 个子任务并开「完成一个就暂停」→ 第 1 个子任务完成后，下一次模型请求**被拦住**，面板出现放行按钮，放行后继续；改「完成即停止」→ 第 1 个子任务完成后本轮以 `blocked` 结束回 idle |

---

## 2. 为什么必须自研（前期调研结论，别重复调研）

调研规模：本地 GitHub `dsh-plugin` 主题 + 自建 13620 条插件 catalog（`research/catalog/`）。**六条需求 × 候选插件判定表**（证据等级：`dsh-todo-board` 与 `dsh-pause` 为源码级；其余为 README 级）：

| 需求 | dsh-todo-board 0.12.0 | dsh-task-todo (liuyuguo99) | @dely0/dsh-personal-workbench 1.16.3 | dsh-taskboard (cloader ★57) | DSH-taskboard (shengsheng90 ★330) | dsh-task-center 0.3.0 |
|---|---|---|---|---|---|---|
| 1 跨工作区/会话 | ✅ `~/.dsh/todo-board/board.json` | ✅ `<DSH_HOME>/todo/tasks.json` | ✅ 本机 `~/.dsh/workbench` | ✅ DSH_HOME 台账 | ✗ 默认项目级 | ~ 共用 `~/.dsh/storages` |
| 2 侧边栏/浮窗 | ✅ 浮窗（仅 `shell.overlay`） | ✅ 侧边栏+主页+浮窗 | ✅ 面板 | ✅ 一级侧边栏 | ✅ 侧边栏+overlay | ✅ web 看板 |
| 3 双向编辑 / 同步会话内 | ✅ / **✗ 0 命中 `todo_write`** | ✅ / ? | ✅ / ? | ✅ / ✗ | ✅ / ✗ | ✅ / **✅ fold `todo/write`+`goal/change`** |
| 4 子任务/周期/分级/deadline | ✗✗✗ ~ | ✅任意深度 / ✅日周月+间隔+结束 / ? / ? | ?树 / ✅recurring repo / ? / ✅dueAt | ? / cron 执行 / ? / ? | relations / interval / ? / ? | ~ |
| 5 提醒 | ✅绝对墙钟（分钟精度）/ ✗N秒 / ✗倒计时 / **关机不触发** | ✗ 自陈"不承诺提醒" | ✅截止前 N 分钟+启动补发+系统通知 | ✗ 无通知 | ✗ 无通知 | ✅定时投递 |
| 6 条件执行/停止 | ~回合结束接续 / **✗不能暂停停止** | ✗ | ✗（roadmap 未实现） | ✅cron 只触发 todo / ✗ | ~pause-on-uncertain | ~wake patrol/配额守卫 |

**结论**：需求 3 的"同步"、需求 4 的"周期+子任务+分级"、需求 5 的"启动后 N 秒/倒计时"、需求 6 的"暂停/停止"四处**全生态空白**（其中需求 5 的原生替代见 §5.0）。最接近的 `dsh-todo-board` 可作为**实现参考**（不是依赖）。

**可直接抄的现成实现（本地已解包，见 §11）**：
- 暂停原语：`dsh-pause` v0.1.2（**本机已装** `harness\profiles\web\node_modules\dsh-pause\`），`lib/index.js:328` 注册 `agent/pre-step`、`:332-341` 建 gate、`:338` `registry.armGate(sessionId,{resolve,reject})`、**`:349` `carried = await gate;`**、`:355-359` 把人类补充文字并进 `decision.messages`；控制面 `:140-149` mountRpcChannel + `:327` `webServer.register({kind:"prefix", path:"/dsh-pause"})`，端点 setEnabled/release/status `:300-320`，客户端槽位 `conversation.input.right`。**局限**：`shouldPause(enabled,step){return enabled && step>1}`（`:17-19`）无子任务判据。
- 全局板 + 浮窗 + 绝对定时派发：`research/todoboard/package/`（`dsh-todo-board@0.12.0` 解包，含 `REPORT.md` 六项审计）。
- 会话截止提醒 + 启动补发：`research/workbench/personal-workbench/package/lib/reminder/scheduler.js:182-232`。

---

## 3. 运行时环境真值（已验证）

| 项 | 值 |
|---|---|
| `DSH_HOME` | `C:\Users\A005490\AppData\Roaming\dsh-desktop\harness` |
| `DSH_PROFILE` | `web` |
| node / npm | `v24.9.0` / `11.19.0` |
| `dsh` CLI | `C:\Users\A005490\AppData\Roaming\npm\dsh.cmd` |
| profiles | `harness\profiles\` 下：`desktop-safe-mode`、`web` |
| web GUI | `http://127.0.0.1:43129`（**当前对话就跑在它上面**） |
| 权威 DSH 运行时包位置 | `C:\Users\A005490\AppData\Local\Programs\DSH Desktop\resources\app.asar.unpacked\node_modules\@deepseek-ai\`（**284 个包**；查 `path:LINE` 证据从这里读） |
| 桌面插件 generation 库 | `harness\profiles\.generations\`（`live`/`staging`/`trash`/`desired.json`；`live` 目录名 `<owner>+<pkg>+<ver>+<hash>`） |
| 已装第三方插件（web/node_modules 顶层） | `dsh-pause`、`dsh-notify-me`、`dsh-watcher`、`dsh-worktable`、`dsh-find-plugin`、`dsh-synapse`、`dshmarket`、`dsh-univer-office`、`dsh-vision-router`、`billion-context`、`oss-prompt-optimizer`、`@furongjun1999/dsh-memory`、`@michengai/*`、`@tt-a1i/archify-dsh`、`@wxg-prc-cpg/browser-skill-dsh-plugin`、`whale-persona` |

**模块解析的真相（v1 花了很多时间，结论如下，别再重复）**：profile 的 `node_modules\@deepseek-ai` 只有 `cosmokit`、`schemastery`；`.pnpm` 为空；`DSH_HOME\node_modules` 不存在。但 `dsh-pause` 静态 import 了 profile 里并不存在的 `@deepseek-ai/dsh-llm` 仍正常工作 ⇒ **Harness 装载器自行解析运行时包**，不必手写 `loadPkg` 之类的兜底。`dsh-worktable`（本机唯一 link: 本地插件，SymbolicLink → `..\..\..\..\..\..\..\dsh-worktable\01_content`）自带 `dsh.plugin.json` + `build.mjs` + `src/`，其做法（运行时探测、`createRequire` 逐级向上）**不是必须模仿的**。

**profile 配置结构（`harness\profiles\web\package.json`，158 行）**（仅供参考，v2 起不必手改）：
- `dsh.profile.bundles` = 启用清单（数组）；`dsh.profile.patchReload: "startup"` ⇒ **改动 profile 层后要重启才生效**。
- 本地开发插件先例：`"dsh-worktable": "link:C:/Users/A005490/dsh-worktable/01_content"`（且不在 `generationProjection`/`pnpm.overrides` 里）。
- `harness\profiles\web\cordis.patch.yml` 顶部注释原文："Your patch layer for this dsh profile, applied after every bundle layer: a top-level YAML array of loader patch entries (id-targeted config overrides, disables, and insert lists; `!!js` expressions allowed)"。形态：
```yaml
- id: <entry-id>
  name: "<pkg-or-pkg/subpath>"
  config: { ... }
- id: <entry-id>
  disabled: true
- insert:
    - id: <entry-id>
      name: "<pkg>"
```

---

## 4. 最小插件工程规范（由官方技能 `cordis-plugin-development` 定死，照此执行）

### 4.1 包形态（模板 4 文件，来自 `templates/decoration/`）
```jsonc
// package.json（host + client 双半身）
{
  "name": "@local/dsh-task-lisk", "version": "0.1.0", "private": true, "type": "module",
  "exports": { ".": "./index.js", "./client": "./client.js" },
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" },
    "client": { "platform": "web", "immediately": true,
                "inject": ["@deepseek-ai/dsh-client-ui-conversation"] }
  }
}
```
- **host-only bundle 就删掉 `exports` 的 `./client` 与整个 `dsh.client` 段**（本插件需要面板 ⇒ 保留双半身）。
- `cordis.patch.yml`：`- insert:` / `    - id: dsh-task-lisk` / `      name: '@local/dsh-task-lisk'`。
- `index.js`（Host 半身）两种合法导出形态，**不可混用**：
  1. `export function apply(ctx, config) {}` + 可选 `export const inject = ['tools', ...]` + 可选 `export const Config`（schemastery schema）；
  2. default export 一个服务类。
  所有资源注册写在 `apply` 内，用 `ctx.effect(...)` / `ctx.on(...)` 拿清理函数。
- `client.js`（Client 半身）**唯一合法格式**（动态客户端模块，无构建工具）：
```js
window.__ModuleLoader__.load({
  id: '@local/dsh-task-lisk',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    function Panel() { return h('div', { className: 'dtl-panel' }, '…'); }
    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('shell.overlay', () =>
          ctx.slots.register({ name: 'shell.overlay', id: 'dsh-task-lisk', order: 40, label: '任务板' }, Panel));
      },
    };
  },
});
```
- 显示元数据：标题/描述放 `locale/en.json`（`locale/zh.json` 同字段）；图标为 package.json 顶层 `icon`（目录内相对路径，SVG/PNG/JPEG/WebP ≤256 KiB）。
- 可调参数放 `Config`，用户就能在 `cordis.patch.yml` 改（用户补丁层能跨升级存活）。写 config 前先用 `Config.listConfigs` 查真实 schema 并跟随 `$defs`。

### 4.2 安装（权威路径）
1. 在工作区（不要在任何 `$DSH_HOME` 路径下）用普通文件写完整 bundle 包。
2. `plugin_manager` `action: install_bundle`，`target` = 该包目录（它自己执行包安装与 bundle 选择，**不要用 shell 复现**）。
3. **每次 `plugin_manager` 调用都要审批**（含 `list_plugins`/`list_bundles`），只在结果决定下一步时才调。
4. 读安装结果的 `application` 与 `warnings` 判活；用 `cordis_inspect_query`（免审批）确认新行。状态语义：`failed` 需诊断、`overridden` 被更高优先级层覆盖、`restart-required` 表示未生效（**新装 bundle 可经 HMR 生效；替换已装包需重启才加载新 JS 代**）。

### 4.3 放置平面（v1 的"头号风险"已解除）
官方技能 `editing-cordis-compositions` 的权威判定：
> Host 插件提供共享服务（tools / prompt 注册表、Agent loop、sessions、持久化、settings、sandbox、模型路由、subagent 后端）；preset 插件只贡献**作用域内的** tools / persona / prompt 段 / 策略。"提供服务的 preset 插件必须把 provider 与消费者 isolate 在同一 realm；被 Host 插件消费的服务必须放 Host 配置"。`scope` 控制贡献与事件可见性，`isolate` 控制服务实例。

⇒ 本插件（需要注册工具、监听 `agent/pre-step`、读写 `ctx.schedule`/`ctx.storageDomain`、跑 `webServer` 路由）**按 Host 平面注册**。preset 声明行是 `name: '@deepseek-ai/dsh-agent-preset'` + `config: {id, plugins, name, description, order}`；出厂 Web preset（`standard`/`ptc`/`minimal`/`cordis`）在 `@deepseek-ai/dsh-web-app` bundle 的 `presets/<id>.patch.yml`；按 Loader 行 id `preset-<id>` 覆盖时**必须重述完整 config**。

### 4.4 验证要求（官方技能的验收口径）
- 样式只用主题 token（`--dsw-alias-*`，用 `Theme.listTokens` 取准确名）；明暗两主题都要看；旁边放一个同类宿主页面做对照。
- **不得 `require('@deepseek-ai/dsh-client-ui-primitives')` 或任何 Harness Client 包**（会因 slot entry crash 白屏，console 出现 `slot entry crashed in '<slot>'`）；要复制的控件就照抄其 markup/CSS/行为并把 class 改成自己的前缀。
- 不得读取其它插件的 DOM/样式，不得替换 app root/向 `document.body` 追加第二个应用；React 由浏览器模块表提供（别自装 React/CDN/UMD）；非 baseline 运行时 import 需在 `dsh.client.external` 声明。
- 需要按钮/面板时优先抄宿主同类控件（管理列表参考 Plugin Manager 页）。

---

## 5. 官方 API 真值（均已带证据；未标注的当待核验）

### 5.0 原生定时任务服务 `ctx.schedule`（**已验证，需求 5 首选**）
来自 `cordis_inspect_query` host `Service.listService({service:"schedule"})`。描述原文："Shared management service; reads, deletion, and timing edits never activate a Session. `sessionPersistence` is a load-order requirement rather than a directly called service: a delivery commits only when `ctx.sessions.flush()` reports that a `session/flush` listener participated, and the persistence backend providing this service is the plugin that registers that listener."

- 访问：`ctx.schedule`（hard dependency `inject: ['schedule']`）或 `ctx.get("schedule")`（需 undefined 检查）。
- 方法：
  - `create(sessionId, request, signal?) → Promise<ScheduleRecord>`：「Create a reminder bound to the caller-selected Session without activating it」；`title` 必填（缺失/空白/过长 → `invalid_prompt`）；记录以入队前的时钟读数为锚。
  - `@Remote('list') list({sessionId}) → Promise<ScheduleRecord[]>`：读某会话的活动任务，**不唤醒其 Agent**。
  - `@Remote('catalog') catalog() → Promise<ScheduleCatalogEntry[]>`：**读全部 Host 提醒（active + inactive）及其原始会话绑定**，按 `scheduledAt` 升序；不激活会话、不读会话历史。⇒ 面板可视化提醒列表就用它。
  - `@Remote('history') history({sessionId,id,limit,before?}) → Promise<ScheduleDeliveryHistoryResult>`：读已投递记录（limit 1..100，越界抛 `ScheduleInputError`）；含 `retention: {days, records}`。
  - `@Remote('delete') delete({sessionId,id}, signal?) → Promise<ScheduleDeleteResult>`。
  - `@Remote('update') update({sessionId,id,expected,title?,prompt?,change?}, signal?) → Promise<ScheduleUpdateResult>`；`expected` = 完整观测到的记录（乐观并发），`change` = `ScheduleTimingChange`。
- 请求字段（`ScheduleCreateRequest`）：`{ prompt: string; title: string; after_seconds?: number; at?: string | {date,time,time_zone}; every_seconds?: number; daily?: {time,time_zone}; weekly?: {time,time_zone,weekdays:number[]}; cron?: {expression, time_zone} }`。
- 记录形态：`AtScheduleRecord{id,kind:'at',title,prompt,scheduledAt}`、`AfterScheduleRecord{…,afterSeconds}`、`EveryScheduleRecord{…,everySeconds}`、`DailyScheduleRecord{…,time,timeZone}`、`WeeklyScheduleRecord{…,time,timeZone,weekdays}`、`CronScheduleRecord{…,expression,timeZone}`。
- 错误码：`invalid_prompt`、`invalid_selector`、`invalid_rule`、`invalid_time_zone`、`not_future`、`time_out_of_range`、`frequency_too_high`、`internal_error`；update 还有 `schedule_not_found`/`schedule_ended`/`schedule_conflict`。
- 配套：事件 `schedule/changed(): void`「Durable task set changed; clients refetch global task and Session-active catalogs」；GUI 工具 `schedule_create|schedule_list|schedule_update|schedule_delete`；客户端包 `@deepseek-ai/dsh-client-ui-schedule`（**官方已有 Schedule 界面**）。
- **对本插件的用法**：
  - 「定时提醒」= `at`；「倒计时提醒」= `after_seconds`；「周期提醒」= `every_seconds`/`daily`/`weekly`/`cron`。
  - 「DSH 启动后 xx 秒」= 插件 `apply()`（=宿主启动）时用 `after_seconds: N` 创建一次性提醒（原生语义是"相对创建时刻"，因此这就是等价实现）；若要求"每次启动都触发"，在 apply 时重建/重置该提醒。
  - **约束（必须写进 README）**：`create` 必须绑定一个 `sessionId`；提醒的"投递"是往该会话的 inbox 落一条消息（并触发会话）而非纯弹窗。若用户要"与原会话无关的纯提醒"，要么专门建一个提醒会话（`ctx.agents.create`），要么仍用自写调度器（§6.4 兜底），这是**待决问题 7**。

### 5.1 `agent/pre-step`（需求 6 的核心载体）— 已验证
- 精确契约（inspect `Event.listEvents`）：`'agent/pre-step'(this: Scoped<Agent>, payload: { agent: Agent; messages: UserMessage[]; turn: number; step: number; signal: AbortSignal }, next: () => Promise<PreStepDecision>): Promise<PreStepDecision>` — 描述「Reject a proposed step or replace the messages that enter it」。
- 派发点：`@deepseek-ai/dsh-agent-loop\lib\index.js:902` `async preStep(target, position)`；`:904` 若 `this.phase.kind !== "running"` 抛 `agent "${this.id}": pre-step outside running phase`；`:911-918`
  `const decision = await this.dispatch.waterfall("agent/pre-step", { messages: claimed, ...position, signal }, () => Promise.resolve({ kind: "enter", messages: context === undefined ? claimed : [...claimed, context] }));`
- `:919-920` `if (decision.kind === "reject") return decision;`；`:954-957` 调用点 `this.preStep(target, { turn, step })`；**`:958-961` `if (decision.kind === "reject") { turnEnds = { kind: "blocked" }; return false; }`**。
- **监听器可以 await 任意久再返回**（`dsh-pause` 即如此）⇒ **`await` gate = 真暂停（本轮不关闭、可原地恢复）**；**`return {kind:'reject'}` = 硬停（本轮以 `turn/end {reason:{kind:'blocked'}}` 结束回 idle，需人类再发消息续跑）**。这是"暂停"与"停止"的分水岭。
- 官方已在此做动态判断的先例：`@deepseek-ai/dsh-compaction-basic\lib\index.js:839` `ctx.on("agent/pre-step", async ({agent,signal}, next) => {` … `:851` `return next();`（只压缩、从不 reject）。
- **粒度上限 = step（模型请求）边界**，做不到工具调用中途。

### 5.2 `agent/turn-stopping`（需求 6 的"自然结束前"窗口）— 已验证
- 契约：`'agent/turn-stopping'(this: Scoped<Agent>, payload: { agent: Agent; turn: number; signal: AbortSignal }): Promise<void> | void`（serial）— 描述「The turn is about to close: the model owes no response (no live tool calls, no fresh steering)」。
- 派发点：`dsh-agent-loop\lib\index.js:983-990`：`if (turnEnds && this.inbox.nextStep.length === 0) { await this.dispatch.serial("agent/turn-stopping", { turn, signal }); … }`。
- 文档定调：`dsh-agent\README.zh.md:67`「`agent/pre-step` 可以拒绝拟进入的步骤或替换进入它的消息…`agent/turn-stopping` 在本可完成的轮次关闭前运行，并可通过 steer 使其保持打开」；`dsh-agent-loop\README.zh.md:202`「没有内置轮次预算…限制失控轮次的策略必须从既有生命周期扩展点（如 `agent/turn-stopping`）执行取消」。
- `dsh-todo-board` 用它做"回合结束自动接续下一条"（`research/todoboard/package/lib/index.js:1853-1873`），**该监听器无 `next` 参数、无返回值 ⇒ 事后通知，不能否决回合**。

### 5.3 `tools/pre-execute`（拦单个工具调用）— 已验证
- 契约：`'tools/pre-execute'(this: Scoped<ToolRuntime>, exec: ToolExecution, next: () => Promise<PreToolDecision>): Promise<PreToolDecision>`「Allow, deny, cancel, or ask before dispatch」。
- 先例：`dsh-todo-float-ball` `research/reminders/float-ball/package/lib/index.js:125-149` 返回 `{kind:"deny", reason}` 即拒绝该次调用；`exec.agent.session.snapshotEvents()` 可读会话事件。另有 `{kind:'ask'}` 走审批（`dsh-todo-board` `lib/index.js:2028-2038` 的 `APPROVAL_FREE_ACTIONS=['list','done','reopen']` 先例）。
- 相关：`tools/guard` 是**同步只拒绝**、`tools/restrict` 只移除、`tools/change` 事件、`tools/result` 事件（观测最终结果，别用 `tools/post-execute` 做拦截）。
- **原则（官方 practices）**：非所有者必须 `return next()`；要改写 `agent/pre-step` 决策时**展开原决策**（`{ ...decision, messages }`）以免丢 `startsRequestSeries`。

### 5.4 会话内任务状态读取（需求 3 上行同步 + 需求 6 判据）— 已验证
- `@deepseek-ai/dsh-tool-todo\lib\index.js:80-92`：注册 `key:"todos"` 投影，命中 `event.type === "todo/write"` 返回 `event.data.todos`，**`turn/start` 时重置为 `null`**；`:173` `exec.agent.session.append("todo/write", { todos })`；条目形状 `:104-118` = `content` + `status`（`pending` / `in_progress` / `completed`）。
- 读取 API：`@deepseek-ai/dsh-session-projection\lib\index.js:127` `stateOf(session, key)`（注册在 `:68`）。
- `agent.session` 存在：`dsh-agent-loop\lib\index.js:775` `this.session = session;`。
- **跨轮计数须插件自持**（投影在 `turn/start` 归 null），但 `todo/write` 事件本身留在会话日志里。
- **官方 practices 的更强指引**：跨会话派生状态应做成 `ctx.sessionProjections` 单元（`apply(state,event)` 纯同步、忽略的事件返回同一引用、`stateVersion` 变更时 bump、`view()` 值不变则抑制发布），**不要**在 `session/event` 里重扫 `session.events`。

### 5.5 定时器 — 已验证
`@deepseek-ai/cordis-plugin-timer\src\index.ts`：`:4-7` 暴露 `ctx.interval|timeout|throttle|debounce|setTimeout|setInterval` + `ctx.timer`；`:56-104` `interval`；`:106-118` `_schedule` 经 `ctx.effect` 绑 dispose；`:18`/`:23` 裸 `setTimeout`/`setInterval` 已 `@deprecated`（**禁止**在 Host 代码里用裸定时器）。用法 `ctx.inject(['timer'], …)`。照抄先例：`research/workbench/personal-workbench/package/lib/reminder/scheduler.js:182-232`。

### 5.6 HTTP 路由与浏览器安全栅栏 — 已验证（两处独立先例）
`ctx.webServer.register(route: WebRoute)` + `ctx.connection.requestRejection(request)` 守卫（`dsh-pause` `lib/index.js:327` + `:159`；`@weibaohui/dsh-tasks` `src/index.js:782-795`）。`ctx.connection` 还提供 `rpc`/`fetch`/`admit`/`authenticatedUrl(baseUrl)`/`createSharedFetchHandler(channel:'/api')`。
⚠️ 例外警告：`dsh-todo-board` 自陈其两个路由**不在** DSH 的 `/api` 通道上，因此自己重造了 host/origin 栅栏，并在 0.9.0 出过一个"任意本地进程或 CORS 简单请求 `text/plain` 跨站 POST 即可改板"的漏洞 ⇒ **自研时优先走官方 `/api` 通道**。

### 5.7 客户端槽位 — 已验证（inspect `Slots.listSubTree`）
- **`shell.overlay`**：`kind: list`、`scope: root`、`replaceRisk: none`，描述「Frame-wide floating layer, above every column and outside their scroll containers」；注册 `{id(必), order?, label?}` ⇒ **浮动面板首选**。
- 侧边栏（P1）：`sidebar.panellist`（list，root，「Global panel icons」，`{id,order,label}`）+ `main`（**keyed**，root，「Central panel selected by sidebar entry id」，注册 `{key}`，已被占用：`conversation`）⇒ 图标 + 主面板成对使用。
- 其它可用席位：`sidebar.footer.action`（list）、`sidebar.workspaces.session.row.action`（list，会话行悬停按钮）、`sidebar.workspaces.session.menu.item`（list，会话「…」菜单）、`sidebar.session.row.leading`（list）、`conversation.input.right`（list，「Compact controls before the composer submit action」）、`conversation.composer.dock`（list，session，「Ambient entries below the composer card」）、`conversation.input.dock`（list）、`settings.section`（list，root，一个设置页）、`settings.general.item`（list，单条偏好行）、`settings.plugins.tab`（list）。
- `tool.call.toolview`（**keyed**，session，key = 线上工具名，keyDomain 开放）⇒ 可给自研工具做专属卡片视图（现有已占 key 含 `todo_write`、`create_goal`、`workflow` 等）。
- 注册写法：`ctx.slots.inject(ownerKey, () => ctx.slots.register({name, id, order, label}, Component))`；回调的注册会在 owner 声明塌缩时销毁、恢复时重装。
- 样式只能引 `--dsw-alias-*`（`Theme.listTokens` 取准确名单）；**浮窗几何只能存浏览器 localStorage**（按 origin 隔离）⇒ 要跨端保持须写回宿主存储。

### 5.8 系统提示段 — 已验证
`ctx.systemPrompt.section({ name, order, text }) → () => void`（`dsh-todo-float-ball` 用 `order: 190` 注入待办纪律）。另有 `ctx.systemPrompt.context(...)`、`.variable(name, provider)`、`.tools(provider)`；**不要**监听 `system-prompt/assemble` 来加/删工具或文本；`agent/request` 监听器不能改请求消息。加每-agent 上下文用 `agent.inject()`（记为 `agent/inbox/spliced`）。

### 5.9 其它 Host Service / Event（本插件可能要用的）
- `ctx.agents`：`list()` / `get(id)` / `roots()` / `create(options)` / `resume(options)`（派发/续跑到会话）；`ctx.agentLoop`：`create/createAgent(ownerCtx,options)/resume(ownerCtx,options)`。
- `ctx.goals`：`get(agent)`/`disarm`/`create`/`edit|pause|resume|complete|clear`/`block`；事件 `goal/changed`（emit，payload `{agent, change}`）、`goal/activation-changed`。
- `ctx.commands.register(definition)` ⇒ 可加 `/task` 斜杠命令；事件 `commands/change`。
- `ctx.subagents`：`list()`/`start(name,request)`/`sendMessage(...)`/`listChildren(parentId)`/`listDescendants(rootId)`/`interrupt(targetSessionId, authority)`。
- `ctx.workspaceRegistry`：`list()`/`get(id)`/`resolveByPath(path)`/`create(path,title?)`（判"跨工作区"分组与派发目标）。
- 硬停/取消路径：`agent.cancel({kind:'user'}, {keepInbox:true})` + `jobs.kill` + `terminals.kill` + `subagents.interrupt` + `goals.disarm`（`dsh-interrupt-button` 的完整用法；仅手动按钮触发，README 级证据）。
- 事件补充：`agent/created`（serial，`payload:{agent,source,signal?}`）、`agent/status`（emit，`{agent,status:'idle'|'running'}`）、`agent/disposed`、`agent/error`、`session/event`（emit，`(session,event)=>void`，post-commit 只读回放）、`session/created`/`session/disposed`/`session/flush`（parallel，awaited checkpoint）、`plugin-manager/changed`、`hmr/reload`。

### 5.10 持久化：`ctx.storageDomain`（**优先于自写 JSON**）— 已验证
`ctx.storageDomain.open(spec) → Promise<Domain>` / `get(name)` / `closeAll()`；`ctx.storage` 是 hub（`mount(form, facility)`、`form(form)`）；写入后事件 `domain/changed(change)`「一次写入在后端确认持久化之后严格发射一次」。**不要**给会话追加新 `type` 的事件（读者只接受带 `ignorable:true` 的未知事件，而 `Session.append()` 无法设置该标记 ⇒ 会话将无法重新打开）⇒ 插件自有数据放 storage 服务。

### 5.11 待核验清单（动手前先读权威包或 inspect）
- 模型工具的**注册调用与 `ToolDefinition` 字段**（inspect `Tool.listTools` 可看现有工具 schema；`ctx.tools.register(definition)` 是确认的方法签名，字段形态需读 `@deepseek-ai\dsh-tool-todo\lib\index.js` 的注册段）。
- `ctx.storageDomain.open(spec)` 的 `DomainSpec` 形态（用 `Service.listService({service:"storageDomain"})` 查确切契约）。
- `agent.inject()`、`agent.steer()`、`agent.followup()` 的确切签名（先例：`@weibaohui/dsh-tasks` `src/index.js:465-515`；`dsh-todo-board` `lib/index.js:1614-1627`）。
- Client 侧读宿主态的方式（session 投影经 `wire.view` 送到客户端；面板要自己拉数据就用自己的 HTTP 路由）。

---

## 6. 架构设计（v2）

### 6.1 存储（需求 1）
- **首选**：`ctx.storageDomain.open({ name: 'dsh-task-lisk', ... })`（见 §5.10），获得持久 + `domain/changed` 通知 + 跨会话/跨工作区单一全局库。
- **兜底**（若 DomainSpec 不适合或需要人肉可编辑）：单文件 `$DSH_HOME/task-lisk/board.json`，**原子写**（临时文件 + rename），缺失自动创建；可选 `log.ndjson`（环形上限 256 KiB，写入即脱敏）。
- 目录分组只是视图 + 派发作用域：每条任务自带 `dir`（大小写不敏感、反斜杠归一化）+ `dirPath`（原始）。

### 6.2 数据模型
```ts
type Task = {
  id: string
  title: string
  note?: string
  dir?: string; dirPath?: string
  parentId?: string | null          // 需求4 子任务
  priority?: 0 | 1 | 2 | 3          // 需求4 分级（P0-P3）
  dueAt?: number                    // 需求4 deadline（epoch ms）
  recurrence?: {                    // 需求4 周期（任务自身语义，完成时生成下一实例）
    freq: 'daily' | 'weekly' | 'monthly'
    interval: number                // 每 N 个周期
    byWeekday?: number[]            // weekly 用，0=周日
    until?: number
  }
  status: 'todo' | 'in_progress' | 'blocked' | 'done' | 'canceled'
  aiDone: boolean                   // agent 自评完成（等人类验收）
  verified: boolean                 // 人类验收
  reminder?: {                      // 需求5：映射到 ctx.schedule 的记录
    scheduleId?: string
    sessionId?: string
    kind: 'at' | 'after' | 'every' | 'daily' | 'weekly' | 'cron'
    afterStartSec?: number          // “DSH 启动后 N 秒” → 用 after_seconds 表达
    inMinutes?: number              // 倒计时
    at?: string                     // 绝对本地墙钟 'YYYY-MM-DDTHH:mm'
    cron?: { expression: string; time_zone: string }
  }
  gate?: {                          // 需求6
    onSubtaskDone: 'continue' | 'pause' | 'stop'
    onFailure: 'continue' | 'pause' | 'stop'
    requireVerifyBeforeNext: boolean
  }
  source?: { kind: 'user' | 'agent' | 'session-todo'; sessionId?: string; sessionTitle?: string }
  order: number
  createdAt: number; updatedAt: number
  runSessionId?: string; dispatchedAt?: number
  history?: { at: number; action: string; by: 'user' | 'agent' | 'system' }[]
}
```
常量建议：`SCHEDULE_TICK_MS = 15000`（仅在自写兜底调度器时需要；用原生 `ctx.schedule` 时不需要）、`MAX_BATCH_ITEMS = 20`。

### 6.3 需求 3：上行同步（agent → 板）与下行（板 → 会话）
- **上行（自动）**：`ctx.on('session/event', (session, event) => { if (event.type !== 'todo/write') return; … })`，按 `(sessionId + content)` 幂等 upsert 成 `source.kind='session-todo'` 的行；`turn/start` 的清空只影响官方投影，**不要**据此删除板上的行（板是历史台账）；用户可在面板把某行"提升"为正式任务（清掉 `source.sessionId`，此后不再被同步覆盖）。**更强做法**：注册自己的 `ctx.sessionProjections` 单元。
- **下行（用户给会话规划任务）**：面板把选中任务派发到指定会话 —— `agent.steer(text)`（会话在跑）或 `agent.followup(text)`（空闲），先例 `dsh-todo-board` `lib/index.js:1614-1627`。
- **agent 侧工具**：`task_list` / `task_add`（批量 `items[]`，一次审批整份计划）/ `task_update` / `task_done`（只写 `aiDone`，**不写 `status:'done'`**）/ `task_reopen` / `task_note` / `task_schedule` / `task_dispatch`。删除能力**不给模型**（只给面板）。

### 6.4 需求 5：提醒（**复用原生，不自写调度器**）
- 「定时提醒」→ `ctx.schedule.create(sessionId, {title, prompt, at})`。
- 「倒计时提醒」→ `…{after_seconds}`。
- 「DSH 启动后 xx 秒」→ 插件 `apply()` 时（=宿主启动）`…{after_seconds: N}`；若要"每次启动都提醒"，apply 时重建该提醒（先 `catalog()`/`list()` 去重）。
- 「周期任务提醒」→ `authored` 的 `recurrence` 与提醒解耦：任务周期由插件在"完成一次"时生成下一实例（`monthly` 自写，因为原生只有 daily/weekly/cron/every）；需要原生周期提醒时用 `every_seconds`/`daily`/`weekly`/`cron`。
- 面板可视化：`ctx.schedule.catalog()`（全局 active+inactive 及其会话绑定）+ 事件 `schedule/changed` 驱动刷新。
- **启动补发**：原生服务负责投递持久化；若仍自写兜底调度器，则照抄 `research/workbench/personal-workbench/package/lib/reminder/scheduler.js:182-219` 的 `catchup()`。
- **硬边界（必须写进 README）**：宿主进程不运行 = 不触发；无 OS 级调度；错过的时间只能靠原生持久化 + 下次启动补发。
- 兜底方案（若"提醒不应绑定/唤醒任何会话"是关键需求）：自写 `ctx.inject(['timer'])` + `ctx.interval(..., 15000)` + `ctx.timeout`，面板内横幅 + 浏览器 `Notification`（客户端，需授权；先例 `dsh-todo-board` `client/client.js:1825-1843`）。

### 6.5 需求 6：条件化执行与停止
- 在 `agent/pre-step` 内读判据：`ctx.sessionProjections.stateOf(agent.session, 'todos')` + 本板该会话/该目录的子任务状态；
- 命中 `gate.onSubtaskDone`：
  - `'pause'` → **`await` 一个 gate Promise**（照抄 `dsh-pause` `lib/index.js:332-349` 的 `armGate` + abort 监听），把"放行"入口暴露在面板 + `webServer` 路由（可携带补充文字，放行时并进 `decision.messages`，**记得展开原 decision**）；
  - `'stop'` → `return { kind: 'reject' }`；
  - `'continue'` → `next()`。
- 只在 `step > 1` 生效（`step === 1` 是新一轮的人类请求，永不该拦）。
- 续跑：`agent/turn-stopping` 里挑"同目录、最上面、未派发、非 remind"的一条派发（`steer`/`followup`）。（注意：该事件不能否决回合，只能事后动作。）
- **子 agent 被折叠进根 agent**：要按子任务暂停**父**会话，判据必须落在父会话的 `todos` 上。

### 6.6 需求 2：UI 分期
- **P0**：`shell.overlay` 浮窗（可拖可缩可折叠，几何存 `localStorage`），内含：任务树、四种字段编辑、提醒设置（写 `ctx.schedule`）、门控策略、来源会话跳转、放行按钮。
- **P1**：`sidebar.panellist` 图标 + `main` 主页面（看板/日历/时间线），浮窗退化为快捷入口。
- **P2**：几何写回宿主存储、多端一致。

---

## 7. 需求 → 实现映射速查

| 需求 | 落点 | 主要 API |
|---|---|---|
| 1 全局 | `ctx.storageDomain`（兜底 `$DSH_HOME/task-lisk/board.json` 原子写） | §5.10 / `node:fs` |
| 2 浮窗/侧边栏 | `shell.overlay`（P0）/ `sidebar.panellist`+`main`（P1） | `ctx.slots.inject/register` |
| 3 双向编辑 | 面板 + `task_*` 工具 | `ctx.tools.register`、`ctx.webServer.register` + `ctx.connection.requestRejection` |
| 3 上行同步 | 折叠 `todo/write` | `ctx.on('session/event')`、`ctx.sessionProjections`、`stateOf(session,'todos')` |
| 3 下行派发 | steer/followup | `agent.steer` / `agent.followup` |
| 4 子任务/分级/deadline | 数据模型 + UI + 排序 | 纯插件内 |
| 4 周期 | 完成时按规则生成下一实例 | 纯插件内（daily/weekly/monthly） |
| 5 提醒 | **`ctx.schedule` create/list/catalog/update/delete** | `ctx.schedule` + `schedule/changed` |
| 6 暂停 | `agent/pre-step` await gate | `dispatch.waterfall('agent/pre-step')` |
| 6 停止 | `agent/pre-step` reject | 同上，`reason:{kind:'blocked'}` |
| 6 续跑 | `agent/turn-stopping` | `dispatch.serial('agent/turn-stopping')` |

---

## 8. 分期计划与每期验收

| 期 | 内容 | 验收 |
|---|---|---|
| **P0**（可独立交付） | 存储 + `shell.overlay` 浮窗 + 面板 API 路由 + 四种字段（子任务/优先级/deadline/周期）+ 三种提醒（复用 `ctx.schedule`）+ 启动后 N 秒 + `agent/pre-step` 暂停/停止（gate + reject） | §1.1 的需求 1、2、4、5、6 全部可手工验证通过 |
| **P1** | 模型工具集 + 会话 `todo/write` 上行同步 + turn-end 续跑 + 子任务树 UI + 拖动排序 + 侧边栏/主页面入口 | §1.1 需求 3 的双向验收通过 |
| **P2** | 外部通知通道（IM/webhook）、几何写回宿主、多端一致 | 可选 |

---

## 9. 硬边界、风险与已知坑（务必先读）

1. **关机/未运行不触发**：所有定时都在宿主进程内（原生 `ctx.schedule` 亦然），DSH 不运行 = 不提醒；只能下次启动补发。要"关着也能触发"必须外接 OS 级调度（Windows 计划任务/服务）——超出插件范围。
2. **粒度上限 = step 边界**：`agent/pre-step` 在"下一次模型请求发出前"拦截，做不到工具调用中途打断；"暂停"期间在途请求不会被掐断（这正是它无副作用的原因）。
3. **提示词方案只能"软暂停"**（回答 m00297）：纯提示词 = 模型自愿结束回合 → idle，需人类再发；`ask_user_question` 可做阻塞闸门；**最坑的是与 turn-end 自动化冲突**——若同时开启 `dsh-todo-board` 的自动续跑等自动化，模型"自行停下"会被立刻续上，暂停失效。
4. **安装要审批、可能要重启**：`plugin_manager` 每次调用都需审批；新装 bundle 可经 HMR 生效，**替换已装包需重启**；改 profile 层（`patchReload: "startup"`）要重启，**重启会掐断当前 GUI 会话（本对话就跑在 web GUI 上）**⇒ 与用户约定时机。
5. **原生 `schedule` 必须绑定会话**（§5.0）：提醒的投递语义是往该会话 inbox 落消息，可能触发会话；若要"纯提醒不碰会话"，见待决问题 7。
6. **`engines` 不校验**：装错 DSH 版本不会在安装期告警，只会运行时炸（`dsh-pause` 声明 `node>=26.3.1` 却在 node v24.9.0 上照常安装即为证）。
7. **不要重造安全栅栏**：优先用官方 `/api` 通道 + `ctx.connection.requestRejection`；todo-board 自造栅栏曾出跨站写漏洞。
8. **不要给会话追加新事件类型**（§5.10），否则会话无法重新打开。
9. **不要用裸 `setInterval`/`setTimeout`**（timer 服务已弃用它们）；Host 里一切定时走 `ctx.inject(['timer'])` 或 `ctx.schedule`。
10. **客户端半身不许 import Harness Client 包**（§4.4），否则 slot entry crash 白屏；样式只用 `--dsw-alias-*`。
11. **Windows 通知**：浏览器 `Notification` 需授权且页面打开；桌面原生 toast 需另找通道。
12. **写盘纪律**：必须原子写；日志脱敏；面板只读操作不得触发写。

---

## 10. 待决问题（开工前需用户拍板）

1. **插件名**：暂定 `dsh-task-lisk`（与工作目录名一致，避免 npm 撞名）。是否改用中文语义名？
2. **UI 形态优先**：先浮窗（P0，改动面小）还是直接上侧边栏主页面？
3. **存储**：`ctx.storageDomain`（原生、有变更事件）还是人肉可编辑的 JSON 单文件？建议 Domain 起步、导出 JSON 供人改。
4. **是否复用官方 `todo_write` 作为主列表**（即"板"只是官方列表的持久化镜像），还是自建权威列表 + 同步官方（建议后者：官方投影在 `turn/start` 归 null，不能当持久层）。
5. **外部通知通道**：P0 是否就要 IM/微信/飞书推送？
6. **安装窗口**：何时重启（会断开当前 GUI 会话）？
7. **提醒语义（新增，v2）**：接受"提醒 = 往某个会话投递一条消息/提示词"（原生 `ctx.schedule`，功能全、零自研），还是要求"纯全局提醒、不碰任何会话"（需自写调度器 + 客户端通知）？**这是需求 5 的关键分岔，建议先回答。**

---

## 11. 参考实现与证据索引（本工作区）

| 路径 | 内容 |
|---|---|
| `research/todoboard/REPORT.md` | `dsh-todo-board@0.12.0` 六项需求**源码级**审计（327 行，含全部行号） |
| `research/todoboard/package/` | 该插件 npm tarball 解包（25 文件） |
| `research/autoexec/REPORT.md` | 需求 6 **源码级**审计：四个"事后判定"插件 + `dsh-pause` 唯一可用暂停载体 + 精确自建配方 |
| `research/autoexec/`、`research/reminders/`、`research/workbench/`、`research/stop/` | 相应插件解包（`dsh-personal-workbench` 含 `lib/reminder/scheduler.js` 启动补发实现） |
| `research/catalog/` | 13620 条插件 catalog（关键词过滤出的候选清单） |
| `harness\profiles\web\node_modules\dsh-pause\` | **本机已装的暂停插件**，`lib/index.js` 是 gate 的权威参考实现 |
| `C:\Users\A005490\AppData\Local\Programs\DSH Desktop\resources\app.asar.unpacked\node_modules\@deepseek-ai\` | **284 个官方包**：`dsh-tool-todo`（投影）、`dsh-agent-loop`（pre-step）、`cordis-plugin-timer`、`dsh-client-ui-*`、`dsh-session-projection` 等 |
| `@deepseek-ai\dsh-agent-preset\skills\cordis-plugin-development\` | 插件开发权威技能（含 `templates/decoration/` 四文件骨架、`references/practices.md`、`references/ui-plugin.md`、`host-plugin.md`） |

---

## 12. 新会话第一步（照抄执行）

```powershell
# 0) 落位
cd "C:\Users\A005490\Desktop\old\old AI files\DSH plugins develop\task_lisk"

# 1) 先读权威参考（只读）
#    - <as ar unpacked>\@deepseek-ai\dsh-agent-preset\skills\cordis-plugin-development\SKILL.md + references/practices.md + templates/decoration/*
#    - harness\profiles\web\node_modules\dsh-pause\lib\index.js                (§2 暂停原语，:328/:349)
#    - research\todoboard\package\lib\index.js                                  (§2 全局板+浮窗+定时派发)
#    - <as ar unpacked>\@deepseek-ai\dsh-tool-todo\lib\index.js                (§5.4 投影注册)

# 2) 建工程骨架（照 §4.1 的四文件形态）：package.json / cordis.patch.yml / index.js / client.js

# 3) 用 inspect 补三个待核验契约（免审批）
#    cordis_inspect_query host Service {"service":"storageDomain"}
#    cordis_inspect_query host Service {"service":"tools"}
#    cordis_inspect_query host Tool   {}          # 看现有工具 schema 形态

# 4) 用户拍板 §10（尤其问题 7）→ 实现 P0 → 用 plugin_manager install_bundle 安装（**需用户同意**）

# 5) 装完读安装结果的 application / warnings 判活；再用 cordis_inspect_query 确认新行；
#    最后在 web GUI 上肉眼验证（明暗两主题、console 无 slot entry crash）
```

**验证清单（每期跑一遍）**：见 §1.1 的验收标准表 + §8 的分期验收。

---

## 13. 实施进度（v3 施工日志）

> 本节记录**已完成到哪一步、证据是什么、下一步做什么**。上面 §0–§12 是计划与调研；**本节是实际状态**，冲突时以本节为准。

**一句话状态（2026-10-17 第二轮结束时）**：宿主/客户端两个半身与包清单**已写出**（`dsh-task-lisk/`，5 个交付文件）；**两套冒烟全绿：静态 23/23 + 宿主运行时行为 70/70**；本轮修掉验证链失效与 8 个运行时缺陷（见 §13.8）；**仍未安装**（`install_bundle` 未执行，需用户审批）；**GUI 肉眼验收与需求 1/3/4/6 端到端验收未做**。用户已指示「完成当前任务后停止执行」⇒ 停在「装之前」，等安装窗口。

### 13.1 已落盘交付物（工作区相对路径，行数为实测）

| 文件 | 行数 | 状态 | 内容 |
|---|---|---|---|
| `dsh-task-lisk/package.json` | 51 | 已写 | bundle 清单：`dsh.bundle.patch`、`dsh.client{platform:'web'}`、exports 四入口、peerDeps（cordis ~4.0.4 / dsh ^0.1.7-rc.2 / react ^18.2.0） |
| `dsh-task-lisk/cordis.patch.yml` | 9 | 已写 | `- insert: [{id: dsh-task-lisk, name: dsh-task-lisk}]` |
| `dsh-task-lisk/lib/index.js` | 1007 | 已写·已冒烟（静态+运行时）·`node --check` 0 | 宿主半身（见 13.3，本轮修 8 处见 13.8.3） |
| `dsh-task-lisk/lib/client.js` | 815 | 已写·已冒烟·`node --check` 0 | 浏览器半身（见 13.4；本轮补「放行留言」输入与策略文案） |
| `dsh-task-lisk/README.md` | 74 | 已写 | 需求覆盖表 / 安装 / 端点 / 验证命令 / 已知边界 |
| `smoke-task-lisk.mjs` | 146 | 已写·**23/23 绿** | 工作区级静态冒烟：导入两个半身 + 注册形状 + 纯逻辑 + SSR（**不进包**） |
| `smoke-host-runtime.mjs` | 610 | 已写·**70/70 绿** | **宿主运行时行为冒烟**：伪 ctx 真跑 `apply()`，覆盖工具 5 action / RPC 信封 / todo 折叠 / pre-step 卡门与硬停 / 条件武装（**不进包**） |
| `smoke-loader.mjs` | 65 | 已改·已验证 | ESM 解析钩子，锚点改为 `app.asar/node_modules`（旧锚点已失效，见 §13.8.1） |
| `probe-asar-resolve.mjs` | 52 | 已写 | 取证：`@deepseek-ai/*` 只存在于 `app.asar` 归档内部且可被解析（7/7 OK） |
| `extract-refs.mjs` | 61 | 已写 | 把只读参考源码从 asar/profile 复制到 `research/refs/`（文件工具拒绝 asar 与符号链路径） |
| `probe-config.mjs` / `probe-schemastery.mjs` | 18 / 26 | 已写 | Config 解析语义取证（见 13.5 缺陷 3） |

### 13.1.1 已写文件绝对路径索引（照抄可用）

```text
# A. 插件包（交付/安装用；install_bundle 的 target 就是 dsh-task-lisk 这个目录）
C:\Users\A005490\Desktop\old\old AI files\DSH plugins develop\task_lisk\dsh-task-lisk\package.json       # bundle 清单：dsh.bundle.patch + dsh.client{platform:web}
C:\Users\A005490\Desktop\old\old AI files\DSH plugins develop\task_lisk\dsh-task-lisk\cordis.patch.yml   # profile 组合补丁：- insert: [{id: dsh-task-lisk, name: dsh-task-lisk}]
C:\Users\A005490\Desktop\old\old AI files\DSH plugins develop\task_lisk\dsh-task-lisk\lib\index.js       # 宿主半身 873 行：领域/工具/RPC/会话折叠/pre-step 闸门
C:\Users\A005490\Desktop\old\old AI files\DSH plugins develop\task_lisk\dsh-task-lisk\lib\client.js      # 浏览器半身 782 行：sidebar.panellist 图标 + main 看板
C:\Users\A005490\Desktop\old\old AI files\DSH plugins develop\task_lisk\dsh-task-lisk\README.md          # 需求覆盖表/安装/端点/已知边界

# B. 验证件（工作区级，不要打进包；package.json 的 files 已排除）
C:\Users\A005490\Desktop\old\old AI files\DSH plugins develop\task_lisk\smoke-task-lisk.mjs              # 23 项静态冒烟（导入/注册形状/纯逻辑/SSR）
C:\Users\A005490\Desktop\old\old AI files\DSH plugins develop\task_lisk\smoke-host-runtime.mjs          # 70 项宿主运行时行为冒烟（伪 ctx 真跑 apply()）
C:\Users\A005490\Desktop\old\old AI files\DSH plugins develop\task_lisk\smoke-loader.mjs                 # ESM 解析钩子（锚点 = resources/app.asar/node_modules）
C:\Users\A005490\Desktop\old\old AI files\DSH plugins develop\task_lisk\probe-asar-resolve.mjs           # 取证：官方包在 app.asar 归档内部且可解析
C:\Users\A005490\Desktop\old\old AI files\DSH plugins develop\task_lisk\extract-refs.mjs                 # 提取只读参考源码到 research/refs/（文件工具读不了 asar/符号链）
C:\Users\A005490\Desktop\old\old AI files\DSH plugins develop\task_lisk\research\refs\                   # 35 个只读参考源（1.07 MB）：dsh-tools/dsh-agent/dsh-pause/dsh-storage-domain/dsh-tool-todo 等
C:\Users\A005490\Desktop\old\old AI files\DSH plugins develop\task_lisk\probe-config.mjs                 # Config["~standard"].validate 默认值/覆盖取证

# C. 文档
C:\Users\A005490\Desktop\old\old AI files\DSH plugins develop\task_lisk\HANDOFF.md                       # 交接文档 v3（§13 = 本轮进度）
C:\Users\A005490\Desktop\old\old AI files\DSH plugins develop\task_lisk\DECISIONS.md                     # 决策记录 D1–D9（本轮未改）
```

运行时依赖与只读参考（**本轮均未改动**）：

```text
C:\Users\A005490\AppData\Local\Programs\DSH Desktop\resources\app.asar.unpacked\node_modules\@deepseek-ai\  # 284 个官方包（storageDomain/tools/llm/tool-todo/agent-preset 技能与模板）
C:\Users\A005490\AppData\Roaming\dsh-desktop\harness\profiles\web\node_modules\dsh-pause\lib\index.js       # 本机已装的 pause gate 权威参考实现
C:\Users\A005490\AppData\Roaming\dsh-desktop\harness\profiles\web\node_modules\                             # profile 侧 node_modules（zod、schemastery）
C:\Users\A005490\Desktop\old\old AI files\DSH plugins develop\task_lisk\research\                           # 候选插件解包 + 审计报告（只读）
C:\Users\A005490\AppData\Roaming\dsh-desktop\harness\.desktop-bin\node.cmd                                 # 跑冒烟用的 node（实测 v24.9.0）
```

### 13.2 如何再跑一遍验证（复现环境）

- node：`C:\Users\A005490\AppData\Roaming\dsh-desktop\harness\.desktop-bin\node.cmd`（**2026-10-17 实测 v24.17.0**；上一轮记录的 v24.9.0 已随 Desktop 更新变化）
- **这个 `node.cmd` 其实是 Electron 运行时**：报错栈里出现 `node:electron/js2c/node_init`，它自带 asar 的 fs 垫片（与 `resources/harness-node-entry.mjs` 里 `registerHostModuleFallback` 同一机制）。⇒ 归档内文件能被解析、也能被读取；但**反过来 `fs.openSync("<resources>/app.asar")` 会失败**（asar 路径被当作归档内路径），所以别写「自解包 asar」的工具。
- **工作区没有 `node_modules`**：沙箱拒绝创建 junction（`New-Item -ItemType Junction` → 「拒绝访问」），复制依赖也不可行（官方包互相依赖、体积大）。
  ⇒ 用 `smoke-loader.mjs`：`node:module` 的 `registerHooks` 先按插件自身正常解析，失败后再依次回落到 ① `<resources>/app.asar/node_modules` ② `<resources>/app.asar` 根部 ③ `app.asar.unpacked`（旧布局） ④ web profile。**不改动任何文件**，等价复现 DSH 加载器自己的解析行为。
- 命令（两条都要退出码 0 = 全绿）：
  ```powershell
  cd "C:\Users\A005490\Desktop\old\old AI files\DSH plugins develop\task_lisk"
  $node = "C:\Users\A005490\AppData\Roaming\dsh-desktop\harness\.desktop-bin\node.cmd"
  & $node --import ./smoke-loader.mjs smoke-task-lisk.mjs        # 期望 23/23
  & $node --import ./smoke-loader.mjs smoke-host-runtime.mjs     # 期望 70/70
  ```
- 断言所依赖的真实包：**`…\Programs\DSH Desktop\resources\app.asar\node_modules`（归档内部，官方包都在这里）** + `…\dsh-desktop\harness\profiles\web\node_modules`（`@deepseek-ai/schemastery`、react 等 profile 侧副本）。
- 只读参考源码在归档里读不到（文件工具拒绝 asar 路径与 pnpm 符号链），用 `extract-refs.mjs` 复制到 `research/refs/`（35 个文件 / 1.07 MB，已含本轮全部契约取证所需的实现）。

### 13.3 宿主半身实现要点（`dsh-task-lisk/lib/index.js`）

- 导出：`name="task-lisk"`、`inject=["tools","storageDomain"]`、`Config`、`apply`（另导出 `__internals` 作为测试缝）。
- 领域：`defineDomain({name:"task_lisk", version:1, tables:{tasks:domainTable(taskSchema)}, global:{schema:settingsSchema, initial:{defaultPolicy:"off", sessions:[]}}})`；生命周期照 `@deepseek-ai\dsh-schedule\lib\index.js:2611-2650` 的同步 `apply` 模式：`ready = ctx.storageDomain.open(spec).then(...)`，`ctx.effect(async () => { const domain = await ready; let cleanup; try { cleanup = ctx.effect(() => () => domain.close(), "task-lisk: close domain") } catch (e) { await domain.close(); throw e } return cleanup }, "task-lisk: board")`。
- 工具：`ctx.tools.register(defineTool({name:"task_lisk", ...}))`，action = list/create/update/complete/remove。
- RPC：`ctx.inject(["connection","webServer"], raw => raw.webServer.register({kind:"prefix", path:"/dsh-task-lisk", handler}))`；端点 = list/create/update/toggle/setStatus/remove/policy/release/import/status；信封 `{type:'client-request',method,payload,rpcId}` → `{type:'server-response',rpcId,result:{ok:true,value}|{ok:false,error}}`。
- 会话折叠（需求 3 上行）：`ctx.on("session/event", (session, event) => …)` 折叠 `todo/write`；同名任务只改状态、跳过 `origin === "subagent"`。
- 暂停/停止（需求 6）：`agent/pre-step` await gate（放行文字并进 `decision.messages`）；`policy === "stop"` 时先注入 notice 再 `return {kind:'reject'}`；`tools/result` 对 `task_lisk`/`todo_write` 成功调用 `armed.add(agentId)`；`agent/turn-stopping`/`agent/disposed` 清理。
- 周期：`nextDue(from, repeat)` 原地滚动（daily/weekly/monthly，月末夹取）。

### 13.4 客户端半身要点（`dsh-task-lisk/lib/client.js`）

- 注册（**冒烟实测输出**）：`sidebar.panellist {id:"dsh-task-lisk", label:"任务", order:20, PanelIcon}` + `main {key:"dsh-task-lisk", TaskBoard}`；`inject=["slots","connection"]`；main 槽位 `inject: () => ({rpc: connection.rpc})`。
- **`panellist.id === main.key` 已断言通过**（sidebar README 要求：寻址同名 keyed 页面，否则抛错）。
- 数据：`rpc.call("/dsh-task-lisk", method, payload)`；1.5s 轮询 `list`。
- 视图：看板（新增/编辑/勾选/删除/子任务/优先级/截止/周期）+ 策略卡（默认策略、逐会话覆盖、放行按钮）。
- 样式只用 `--dsw-alias-*`；不 import 任何 Harness Client 包（硬边界 §9.10）。

### 13.5 本轮修掉的 3 个真实缺陷（冒烟当场抓出，均已复验）

| # | 缺陷 | 证据（原文） | 修法 |
|---|---|---|---|
| 1 | 领域名带连字符 → `defineDomain` 直接抛错 | `Error: domain name 'task-lisk' must match /^[a-z][a-z0-9_]*$/`（`dsh-storage-domain/lib/index.js:62`） | 领域名改 `task_lisk`（**插件 id 仍是 `task-lisk`**） |
| 2 | `client.js` 括号错序：`h(key:"filters")` 少一个 `)` 且多一行 `]),` | `SyntaxError: missing ) after argument list` @ `client.js:649` | 补 `)` + 删多余行 → `node --check` exit 1 → **0** |
| 3 | **Config 四个字段全标 `.volatile()` ⇒ 运行时拿到 accessor 对象而非标量** | `Config["~standard"].validate({})` → `{"enabled":{},"autoImportTodos":{},"defaultPolicy":{},"maxDepth":{}}`；单个字段 `typeof=object ctor=Object`；连显式传入的 `maxDepth:3` 也变 `{get:fn, Symbol(cosmokit.volatile.write):fn}` | 去掉 `.volatile()` → 复验 `{"enabled":true,"autoImportTodos":true,"defaultPolicy":"off","maxDepth":2}`，覆盖 `{maxDepth:3, defaultPolicy:'stop'}` 生效 |

### 13.6 本轮新增的运行时契约证据（写代码时可直接引用）

- **cordis 解析插件配置的真正入口是 Standard-Schema**：`@deepseek-ai\cordis\lib\index.js:958` `const result = runtime.Config["~standard"].validate(config)`。
  ⇒ 要判定「默认值是否生效」必须走 `Config["~standard"].validate(...)`；**用 `Config({})` 会误判**（调用形式对 volatile 字段返回 `{}`）。
  ⇒ 推论（本轮已实测）：插件 `Config` **不要用 `.volatile()`**，除非确实想拿到 cosmokit 活代理。
- schemastery volatile 语义：`@deepseek-ai\schemastery\lib\index.mjs:480` `return schema.meta.volatile ? createVolatile(schema.meta.default) : schema.meta.default`；类型侧 `SchemaOutput` 对 volatile 映射为 `Volatile<T>`。
- `defineDomain` 校验（`dsh-storage-domain\lib\index.js:61-76`）：领域名/表名须匹配 `UNIT_NAME_RE`（`/^[a-z][a-z0-9_]*$/`，**不允许连字符**）；`version` 为非负整数；`global.schema` **不得接受 `null`**（null 是后端「从未写入」哨兵，接受 null 会导致重开时静默回退 initial）。
- 冒烟断言已通过的纯逻辑：`nextDue` daily/weekly/monthly（`2024-01-31T09:00` → `02-01` / `02-07` / **`02-29`（月末夹取）**）、`flatten` 树序 `c@0 a@0 b@1`、`fmtDue`（今天/逾期 3 天）、`shortId`（`abcd…klmn`）、主面板 SSR 首屏 4363 bytes。

### 13.7 尚未做（下一步按序执行）

1. **安装**：`plugin_manager(action="install_bundle", target="C:\Users\A005490\Desktop\old\old AI files\DSH plugins develop\task_lisk\dsh-task-lisk")` —— **必须用户审批**；替换已装包需重启，**重启会断当前 GUI 会话**，需与用户约定窗口。
2. **GUI 肉眼验收**：侧边栏「任务」图标 → 主面板打开；明暗两主题；console 无 slot entry crash；新增/编辑/勾选/删除/加子任务各走一遍。
3. **端到端验收（§1.1）**：需求 1 跨工作区/跨会话 + 重启保留；需求 3 上行（agent 调 `todo_write` → 面板出现并标来源会话）与下行（工具 `list` 读到面板改动）；需求 4 子任务/优先级/截止/周期；需求 6 放行闸门与 `stop` 硬停。
4. **待决问题收口**：§10 的问题 1（插件名是否改）、3（是否额外导出人可编辑 JSON）、6（安装窗口）仍需用户拍板；问题 4 已按 `DECISIONS.md` D5 执行（自建权威列表 + 折叠官方 `todo_write`）；问题 5/7 因需求 5 撤回而关闭。
5. **未验项（诚实记录）**：交互态渲染（任务行、子任务缩进、放行按钮点击）只做过 SSR 首屏与注册形状验证，**真实点击路径未验**；`session/event` 折叠与 `agent/pre-step` 闸门已在**伪 ctx 行为测试**里真跑（70/70），但**仍未在真实 DSH 会话里跑过**（要等安装后）。

---

## 13.8 第二轮（2026-10-17）：验证链修复 + 8 个运行时缺陷

> 起因：用户说「继续开发工作」。第一件事是**先复现上一轮记录的绿**——结果复现不了。

### 13.8.1 验证链失效（先修，否则后面所有结论都无证据）

| # | 现象 | 根因（实测） | 修法 |
|---|---|---|---|
| V1 | `--import ./smoke-loader.mjs smoke-task-lisk.mjs` → `ERR_MODULE_NOT_FOUND: Cannot find package '@deepseek-ai/dsh-storage-domain'`（**上一轮的 23/23 已不可复现**） | Desktop 更新后官方包**不再解包**到 `app.asar.unpacked/node_modules`（那里只剩 `libreoffice-kit-win32-x64`），而是只存在于 `resources/app.asar` 归档内部；`.desktop-bin/node.cmd` 从 v24.9.0 升到 v24.17.0 且**实为 Electron**（栈里有 `node:electron/js2c/node_init`） | `smoke-loader.mjs` 的解析锚点改为 `<resources>/app.asar/node_modules/__probe__.mjs`（保留 `app.asar.unpacked` 与 web profile 作后备并告警）。7 个关键说明符实测全部 OK（`probe-asar-resolve.mjs`） |
| V2 | 想自写 asar 解包器绕过 → `fs.openSync("<resources>/app.asar")` 直接报 `ENOENT ... not found in ...app.asar` | Electron 的 asar 垫片把「以 .asar 结尾的路径」当归档内路径，**归档文件本身不能 open** | 方案作废（`asar-lib.mjs` 已删除）。正确认知：**归档内文件可以用普通 fs 读**，所以参考源码用 `extract-refs.mjs` 复制出来即可 |
| V3 | 文件工具读 `app.asar/...`、读 profile 里 pnpm 符号链 → `POLICY_DENIED` | 文件工具不遍历 asar 内路径与 reparse point | 用 Node 复制到 `research/refs/`（35 文件 / 1.07 MB）再读 |

### 13.8.2 新增的宿主运行时行为测试（`smoke-host-runtime.mjs`，70/70 绿）

伪 ctx 按**真实契约**搭：领域用真实 `defineDomain` 产出的 spec + 真实 zod schema 校验每条写入；工具走**真实 `defineTool`**（参数 schema 校验是真的）；RPC 用伪 req/res 直接喂 channel handler；webServer/connection 用最小替身。覆盖：

- 工具 5 个 action（含 maxDepth 拒绝、缺 title 被参数校验拦住、周期滚动、级联删除、`update status=done` 写完成时间）；
- RPC 10 个端点的信封（含 `gateway/bad-request`、404、403 三条错误路径）；
- todo 折叠（新增/改状态/subagent 跳过/缺 sessionId 跳过/同签名去重/**并发不重复**）；
- `agent/pre-step`（step 1 不卡、`every-step` 挂门、release 放行带留言、`stop` 硬停 + 注入 notice、无门 release 返回 false）；
- `tools/result` 条件武装（只读/新建/取消完成/失败/子派发都不武装；complete、update→done、todo_write 新完成项才武装）；
- 健壮性：`agent.id ≠ session.id` 时按 sessionId 也能放行；`agent/disposed` 解开挂起的门（不留悬空 await）；`turn-stopping` 清武装；Config.defaultPolicy 生效且不覆盖用户选择；全程无 `logger.warn`。

### 13.8.3 本轮修掉的 8 个真实缺陷（全部由新测试当场抓出，修后 70/70）

| # | 缺陷 | 证据 | 修法 |
|---|---|---|---|
| 1 | `tools/result` 里**任何** `task_lisk`/`todo_write` 成功调用都武装「完成后暂停」⇒ 只读 `list` 也会让下一步停下 | 测试 `只读 list 不武装` 一开始直接**卡住**（unsettled top-level await） | 只看**真正的完成动作**：`complete`（`status:"todo"` 除外）/`update status=done`/`todo_write` 新变成 `completed` 的条目 |
| 2 | 调用参数读法错误：`dsh-tools` 的执行对象是 **`exec.arguments`**（深冻 JSON 快照），没有 `exec.args` | 读 `research/refs/_deepseek-ai_dsh-tools__._lib_index.js:3165-3168` | 用 `execution.arguments` |
| 3 | `release` 端点忽略 `input.text`，`releaseGate` 固定 `resolve("")` ⇒ 「放行留言」是死代码（客户端也从没发过 text） | 测试 `放行文字并入 decision.messages` → `messages=0` | 宿主 `release` 读 `text`、`releaseGate(key, text)`；客户端补「放行留言（可选）」输入并随请求发送，成功才清空 |
| 4 | todo 折叠改状态时只写 `status`，**不写/不清 `completedAt`** | 测试 → `done completedAt=null` | 折叠路径补 `completedAt`/`lastCompletedAt`（转 done 时写，转回时清） |
| 5 | 工具的 `update` 分支直接 patch `status`，绕过 `completeTask` ⇒ `update status=done` 没有完成时间、周期任务不滚动；RPC `update` 同样有洞 | 顺手核对源码 + 新增断言 `update status=done 也要写 completedAt` | 新增 `setStatusOf()`（done 走 `completeTask`，其余清 `completedAt`），RPC `setStatus`/`update` 与工具 `update` 三处共用 |
| 6 | `importTodos` 并发进入时各自读到旧快照 ⇒ 同一 todo 可能建两条（领域层 `put` 是「先落后端、后改内存」的异步链，事件折叠又是 fire-and-forget） | 把假领域 `put` 改成真实时序后暴露 | 按 `sessionId` 串行化：`runImport()` 维持每会话一条 promise 链，RPC `import` 与事件折叠都走它 |
| 7 | `gates` 只按 agentId 建键，客户端 `release` 只发 sessionId ⇒ 若两者不等就永远放行不了；`armed` 同病；`agent/disposed` 只删表**不解开**挂起的门（那条 pre-step 永远 await） | 测试 `agent.id≠session.id 时按 sessionId 也能放行`、`agent/disposed 解开挂起的门` | 门记录 `{agentId, sessionId}`，放行按任一命中；武装同时放两个标识（`armGate`/`disarm`/`isArmed`）；disposed 时 `reject` 掉挂起的门 |
| 8 | `Config.defaultPolicy` **完全不生效**（领域 global 的 `initial.defaultPolicy` 恒为 `"off"`，代码只读领域值）；若粗暴写回又会在重启后把用户显式选的 `off` 盖回 | 测试 `Config.defaultPolicy 落到领域默认策略` → `off` | global schema 加 `configDefaultApplied` 标记；**只在领域仍处于 initial（默认 off 且无逐会话覆盖）时**落一次 Config 值，之后用户选择永远优先（三段断言：首次生效 / 改 off 不被覆盖 / 重开仍生效） |

### 13.8.4 本轮新增可引用的运行时契约（写/改代码直接照用）

- `dsh-tools`：`tools/result` 观察者签名 `(exec, result)`；`exec` 字段 = `token/callId/rootCallId/name/signal/agent?/parent?/schema?/arguments`（`arguments` 是深冻 JSON 快照）；`defineTool` 返回的 `execute(args, exec)` 会先用参数 schema 校验 args 再调用户实现；派发前 `Object.freeze(exec)`。
- `dsh-agent`：`agentEvents` 把 agent **融合进每个 payload**（`fused = payload => ({...payload, agent})`，emit/serial/waterfall 一致）⇒ `agent/turn-stopping` 的 `{turn, signal}` 实际带 `agent`；`agent/disposed` 显式带 `{agent}`。
- `dsh-agent-loop`：`agent/pre-step` payload = `{messages, turn, step, signal, agent}`；决策 `{kind:'enter'|'reject', messages}`，`reject` 让回合以 `{kind:"blocked"}` 结束。
- `dsh-pause`（官方参考实现）：pre-step 直接用 `payload.agent.id` 当**会话键**（⇒ 根 agent 的 id 通常就是 session id）、`step > 1` 才卡、abort 时 reject 门、放行文字并入 `decision.messages`；RPC 通道要求 `content-type: application/json`（本插件更宽松，未强制）。
- `dsh-storage-domain`：`defineDomain` 返回原样 spec（`tables.<name>.valueSchema` 是 zod、`global.{schema,initial}`）；`KvTableImpl` 的 `get/entries/keys/size` 是同步内存读，`put/delete/update` 走**每域一条写链**且**先 await 后端、后改内存**（⇒ 并发写有可见性窗口）；`global.get()` 同步、`global.set()` 承诺；`global.schema` 必须拒绝 `null`。
- `dsh-tool-todo`：`exec.agent.session.append("todo/write", {todos:[{content,status}]})`（status ∈ pending/in_progress/completed）。

---

## 13.9 第三轮（2026-10-18）：安装前预演 + 实际安装 + 上线实证

> 起因：用户要求「安装前先派 subagent 做静态预演，绿了就装」。预演由 ZCode subagent 产出（`verify-bundle.mjs` + `research/bundle-preflight.md`），本人独立复现并加固后执行安装。

### 13.9.1 安装结果（唯一权威事实）

- 命令：`plugin_manager(action="install_bundle", target="C:\Users\A005490\Desktop\old\old AI files\DSH plugins develop\task_lisk\dsh-task-lisk")` → 返回 `{stage:"enable", changed:true, application:"applied", warnings:[]}` ⇒ **HMR 即时生效，未重启**。
- profile 落点：`%APPDATA%\dsh-desktop\harness\profiles\web\package.json` 的 `dependencies["dsh-task-lisk"]="0.1.0"` + `dsh.profile.bundles` 追加 `dsh-task-lisk`；该 profile 的 `cordis.patch.yml` **未被写入**（bundle 层是独立 overlay，符合预演预测）。
- **机制要点（此前认知错误，务必记住）**：安装走 generation 机制 —— 把包**复制**到 `profiles\.generations\staging\<uuid>\source\dsh-task-lisk` 再 promote 成 `dsh-task-lisk+0.1.0+53fcf83594f9`，**不是**把工作区目录软链进 profile。⇒ **改工作区源码后必须重新 `install_bundle` 才会生效**，改文件不会热更新。
- pnpm 报的 `missing peer @deepseek-ai/cordis|dsh|react` 警告是**预期良性**：宿主侧由 `host-module-fallback.mjs` 回落归档内 `@deepseek-ai/*`，浏览器侧 `react` 由模块表 seed 提供。

### 13.9.2 上线实证（安装后，全部亲手取得）

| 面 | 证据 | 结论 |
|---|---|---|
| 宿主工具注册 | host `Tool.listTools` 名录命中 `task_lisk`（名称+描述逐字一致） | 需求 3 的 agent 通路已注册 |
| 宿主工具实调 | 建父任务(high+due) → 建子任务(parentId+daily) → `list` 读出 `└` 层级+优先级+截止+repeat → `complete` 子任务**自动滚到 2026-10-18** → `remove` 级联删 2 条 → 看板回 0 条 | 需求 3/4 真实往返成功且无残留 |
| 宿主路由 | 未认证 `POST /dsh-task-lisk` → **401**（不是 404）⇒ 前缀路由已注册、handler 已执行、`connection.requestRejection` 凭据门生效 | 补丁行真被 Loader 装载 |
| 客户端槽位 | client `Slots.listSubTree`：`sidebar.panellist` occupants = `{registrant:"task-lisk", id:"dsh-task-lisk", order:20, active:true}` | 需求 2 已在真实浏览器内挂上侧边栏 |
| 客户端 main | `main` 是 keyed 槽（`keyDomain` 开放，已占 `conversation`）；本插件 key = `dsh-task-lisk` 与 panellist id 同名 | 侧边栏点击可切到看板页（互寻址成立） |

### 13.9.3 本轮改动的文件（写者=本人；ZCode subagent 只写了两个新交付物）

| 文件（绝对路径） | 改动 |
|---|---|
| `C:\Users\A005490\Desktop\old\old AI files\DSH plugins develop\task_lisk\dsh-task-lisk\package.json` | `dsh.client.inject` 删 `@deepseek-ai/dsh-client-ui-slots`（既无 `dsh.client` 也无 `./client`，永远不可能成为客户端图一行）；`peerDependencies["@deepseek-ai/dsh"]` `^0.1.7-rc.2` → `^0.2.0-rc.2` |
| `...\task_lisk\verify-bundle.mjs` | 新增 A3/A4/A5；D4 收紧为「必须声明 `dsh.client` 且导出 `./client`」；E 改用运行时真 semver 7.8.5 |
| `...\task_lisk\smoke-loader.mjs` | 回落白名单 +`semver`/`js-yaml`（否则真 semver 不会被解析，只能用手写近似） |
| `...\task_lisk\research\bundle-preflight.md` | 更新计数与结论、§3 缺陷改「已修」、**§4 删掉违反硬规则的「手改 profile + profile 内跑 pnpm」回滚法**、新增 §6 Lead 复核 |
| `C:\Users\A005490\Desktop\old\old AI files\DSH plugins develop\task_lisk\HANDOFF.md` | 本节 |

### 13.9.4 套件状态（本轮末）

`verify-bundle.mjs` 31/31 · `smoke-task-lisk.mjs` 23/23 · `smoke-host-runtime.mjs` 70/70 · `node --check` 退出 0。

### 13.9.5 下一步（按优先级，可直接执行）

1. **GUI 肉眼验收（只剩这一步没做）**：刷新页面 → 侧边栏「任务」图标（order 20，位于「插件」与「mcp-connector」之间）→ 打开看板；明暗两主题各看一眼；console 无 slot entry crash。交互态渲染（任务行、子任务缩进、放行按钮点击）至今只验过 SSR 与注册形状。
2. **端到端真跑需求 6**：在真实会话里触发 `agent/pre-step` 闸门与 `release` 放行（此前只在伪 ctx 行为测试里跑过 70/70）。
3. **需求 1 跨工作区/跨会话**：换工作区、换会话、重启 Desktop 各看一次是否为同一份列表。
4. §10 待用户拍板：插件名、是否额外导出人可编辑 JSON、安装窗口（问题 4 已按 `DECISIONS.md` D5 执行；问题 5/7 因需求 5 撤回而关闭）。

> **⚠ 2026-10-18 02:41 起：需求与开发分为两个会话。**
> 下一次开发请**先读工作区根的 [`SESSION-BRIDGE.md`](SESSION-BRIDGE.md)** —— 那是需求 ↔ 开发的唯一信道：§1 现状与硬约束、§2 已定稿的批 1（F1 浮动看板，含「取代」形态与席位移除）/批 2（F2 按会话分组 + F3 问号帮助）、§3 积压 R7、§4 需求变更流水、§5 开发回执区（**每批完成必须回写**）。本文件（HANDOFF.md）继续作为开发历史与运行时契约账本，不再承载新需求。