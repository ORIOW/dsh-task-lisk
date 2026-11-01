# SESSION-BRIDGE · 需求 ↔ 开发 双会话沟通文档

> 创建：**2026-10-18 02:41 +08:00** ｜ 对象：`dsh-task-lisk` 插件 ｜ 位置：工作区根
> 本文件是**两个会话之间唯一的沟通信道**，不是开发笔记。开发历史与运行时契约在 `HANDOFF.md`，技术决策在 `DECISIONS.md`，安装前预演在 `research/bundle-preflight.md` —— 本文件**只引用路径，不复抄**它们的内容。

## 0. 怎么用（两个会话都必读）

| 项 | 约定 |
|---|---|
| 会话 A（需求与反馈） | 用户在此反馈、拍板设计决策。A **只写**「§2 需求定义」与「§4 需求变更流水」。 |
| 会话 B（开发） | 在此文档读取需求、在「§5 开发回执区」回写。B **不改**需求文本；有疑问写进回执区等 A 转达用户。 |
| 时间戳格式 | `YYYY-MM-DD HH:MM +08:00`（本机真实时间）。注意 harness 记忆系统用 450 分钟日界，凌晨的日期可能显示为前一天 —— **以真实时间为准**。 |
| **新需求写法（用户明确要求）** | 追加「根据用户反馈产生的新需求」时：**只写增量** —— 新点、变更点、以及被替换的旧点编号（如「F2 阈值由 480 改为 360」）；**不得粘贴/重述既有需求原文**；每条必须带时间戳。 |
| 历史文本 | §2 一旦定稿即冻结；后续任何变化都只能以带时间戳的增量出现在 §4，并明确它替换/废止了 §2 的哪几条。 |
| 纪律 | 用户未说「开干」前，B 不得动代码。B 每批完成后必须回写 §5（含验证证据与未完成项）。 |

**给会话 B 的建议 skills**：本机 skill 目录在会话启动时载入 —— 新装的技能需**新会话**才可见。
- `handoff`：写交接文档时调用（`C:\Users\A005490\AppData\Roaming\dsh-desktop\harness\skills\handoff\SKILL.md`，本机是薄壳，正文指向同目录 `grilling` 同级的实现）。
- `grilling`：需求访谈已完成，**批 1/批 2 不要再访谈用户**；若将来有新需求需要访谈，再由会话 A 执行。

---

## 1. 项目现状（截至 2026-10-18 02:41 +08:00）

### 1.1 是什么

`dsh-task-lisk` —— DSH 插件 bundle，含宿主半身与浏览器半身，提供**跨会话、跨工作区**的全局任务看板：

- 宿主半身：注册 `task_lisk` 工具（agent 读写看板）与 `/dsh-task-lisk` RPC 通道；storage 领域名 `task_lisk`；含需求 6 的实现（`agent/pre-step` 闸门：暂停 = 等放行、硬停 = reject）。
- 浏览器半身（批 1 已上线）：`shell.overlay` 浮动看板（id `dsh-task-lisk.float`）+ `sidebar.footer.action` 侧栏底部按钮（id `dsh-task-lisk`，order 20）；旧 `sidebar.panellist` / `main` 两处注册已删除。
- 需求来源与已撤回项：需求 1/2/3/4/6 有效；需求 5（条件化提醒）已撤回 —— **但 2026-10-18 以 R7 的窄化形式复活**（见 §3）。

### 1.2 当前状态：**已安装上线并实证**

| 项 | 事实 |
|---|---|
| 安装结果 | `plugin_manager(action="install_bundle", target="<绝对包目录>")` → `{changed:true, enabled:true, application:"applied", warnings:[]}` ⇒ HMR 即时生效，**未重启** |
| profile 落点 | `C:\Users\A005490\AppData\Roaming\dsh-desktop\harness\profiles\web\package.json`：`dependencies["dsh-task-lisk"]="0.1.0"`、`dsh.profile.bundles` 含 `dsh-task-lisk`；安装期该 profile 的 `cordis.patch.yml` 未写行（bundle 是独立 overlay），但 **2026-10-29 实测存在 `- id: dsh-task-lisk` + `disabled: true` 的显式禁用条目**（来源不明，疑为插件页「禁用」遗留），致装载器条目 `inactive`、两席位与 `task_lisk` 工具全不注册；用 `plugin_manager(action="set_plugin", target="include:dsh-task-lisk", enabled=true)` → `{changed:true, application:"applied"}` 移除后立即生效 |
| generation 标识 | `dsh-task-lisk+0.1.0+53fcf83594f9` |
| 宿主工具 | host Tool 名录命中 `task_lisk`，且**实调往返成功**：建父任务(high+due) → 建子任务(parentId+daily) → `list` 读出 `└` 层级/优先级/截止/repeat → `complete` daily 子任务**自动滚到下一周期** → `remove` 级联清零 |
| 宿主路由 | 未认证 `POST /dsh-task-lisk` → **401**（非 404）⇒ 前缀路由已注册、handler 执行、`connection.requestRejection` 凭据门生效 |
| 客户端席位 | client `Slots.listSubTree`（2026-10-29 17:05 实测）：`sidebar.footer.action` occupant `{registrant:"task-lisk", id:"dsh-task-lisk", order:20, active:true}`；`shell.overlay` 浮动窗 occupant id `dsh-task-lisk.float`（同批上线，用户肉眼确认 UI 出现） |

### 1.3 代码与文件地图（绝对路径）

包目录：`C:\Users\A005490\Desktop\old\old AI files\DSH plugins develop\task_lisk\dsh-task-lisk`

| 文件 | 作用 |
|---|---|
| `package.json` | `dsh.bundle.patch="./cordis.patch.yml"`；`dsh.client{platform:"web", inject:["@deepseek-ai/dsh-client-connection","@deepseek-ai/dsh-client-ui-sidebar"]}`；peerDeps `cordis ~4.0.4` / `dsh ^0.2.0-rc.2` / `react ^18.2.0`；**无 dependencies** |
| `cordis.patch.yml` | 顶层 `- insert:` → `id: dsh-task-lisk` / `name: dsh-task-lisk` |
| `lib/index.js` | 宿主半身：领域 `task_lisk`、工具 `task_lisk`、RPC 10 端点、`agent/pre-step` 闸门、`tools/result` 武装、todo 折叠 |
| `lib/client.js` | 浏览器半身（批 1 后 37,551 B）：`require("react")` **:16**；插件级 `inject=["slots","connection","timer"]`；`shell.overlay` 浮动窗（id `dsh-task-lisk.float`，order 100）+ `sidebar.footer.action` 按钮（id `dsh-task-lisk`，order 20）；几何/开关持久化 `localStorage["dsh.task-lisk.float.v1"]` |
| `README.md` | 需求语义说明 |

工作区根（套件与文档）：

| 文件 | 作用 / 现状 |
|---|---|
| `verify-bundle.mjs` | 安装前静态预演，**31/31**（31 条断言；必须用 Electron node + `--import ./smoke-loader.mjs` 运行） |
| `smoke-task-lisk.mjs` | SSR + 注册形状，**23/23**（批 1 必须同步改写形状断言） |
| `smoke-host-runtime.mjs` | 伪 ctx 行为测试（真实 `defineDomain`/`defineTool`），**70/70** |
| `smoke-loader.mjs` | ESM 解析回落钩子（白名单含 `@deepseek-ai/*`、`zod`、`react*`、`semver`、`js-yaml`） |
| `HANDOFF.md` | 开发历史与运行时契约；**§13.9** 是最近一轮（安装 + 上线实证） |
| `DECISIONS.md` | 技术决策 D1–D12 |
| `research/bundle-preflight.md` | 安装前预演报告（§4 回滚手册、§6 Lead 复核） |
| `research/refs/loadchain/` | 装载链源码副本（app-boot / plugin-manager / client-modules / client-runner 等，取证用） |
| `research/probe-*.mjs` | 只读探针（如 `probe-primitives.mjs`） |

### 1.4 验证命令（Electron node）

```
# node 必须是 Electron 版，PATH 里的 node v26 读不了 app.asar
set NODE="C:\Users\A005490\AppData\Roaming\dsh-desktop\harness\.desktop-bin\node.cmd"
cd "C:\Users\A005490\Desktop\old\old AI files\DSH plugins develop\task_lisk"

%NODE% --check dsh-task-lisk\lib\index.js
%NODE% --check dsh-task-lisk\lib\client.js
%NODE% --import ./smoke-loader.mjs smoke-task-lisk.mjs        # 23/23
%NODE% --import ./smoke-loader.mjs smoke-host-runtime.mjs     # 70/70
%NODE% --import ./smoke-loader.mjs verify-bundle.mjs          # 31/31
```

### 1.5 硬约束（违反会静默失败或破坏 profile）

1. **只针对 DSH Desktop**，不考虑独立 WebUI 部署（用户 2026-10-18 拍板）。
2. **`dsh.client.platform` 必须保持 `"web"`**。证据 `dsh-client-modules/lib/index.js:725-727`：`if (decl === void 0 || decl.platform !== "web") return null` —— 任何非 `web` 值会让客户端半身**静默消失**（不报错）。原因：Desktop 的 GUI 本身就是 web 客户端，本机 Desktop 实际生效的 profile 就是 `profiles/web`。
3. **安装/卸载/启停只走 `plugin_manager`**（`install_bundle` / `set_bundle(enabled=false)` / `remove_bundle`）。**禁止手改 profile 文件，禁止在 profile 目录里跑 pnpm。**
4. **改工作区源码后必须重新 `install_bundle`**：安装是 **generation 复制**（`profiles\.generations\staging\<uuid>\source\dsh-task-lisk` → promote），**不是**软链工作区目录；改文件不会热更新。
5. **路径必须绝对**：`install_bundle` 的 target 用绝对包目录（相对路径会 `invalid-spec`）。
6. **禁止自行调用 ZCode 桥接**（用户硬规则）。
7. **不要派 subagent 走外部模型路由**（本会话历史里路由全失败）；本地执行。
8. **浮层席位只有 `shell.overlay`**（frame-wide，click-through，条目自行 opt-in 指针事件，`replaceRisk: none`）；`sidebar.right.*` 是**会话作用域**，不能用于跨会话看板。
9. **`sidebar.panellist` 的点击不归插件**（catalog：「the sidebar owns the button」）—— 那只是「导航到 `main.<id>`」；**`sidebar.footer.action` 才是插件自绘组件、点击归插件**的席位。
10. `dsh.client.inject` **允许列非客户端包**（运行时静默忽略）—— `dsh-worktable 0.4.0` 就列了 `ui-slots` 与 `ui-primitives`（两者都没有 `dsh.client`）且工作正常。故该字段的相关断言应为 **WARN**，不是 FAIL。

### 1.6 已验证 vs 未验证（诚实记录）

**已验证**：宿主工具注册与读写往返、RPC 路由与凭据门、客户端 `sidebar.panellist` 注册生效、宿主行为 70 项、SSR 与注册形状 23 项、静态预演 31 项。

**未验证**：GUI 真实点击路径（任务行、子任务缩进、放行按钮点击）；真实会话里的 `agent/pre-step` 闸门与 `release` 放行（只在伪 ctx 测试里跑过）；需求 1 的跨工作区/跨会话/重启一致性。

---

## 2. 接下来要开发的需求（定稿时间 **2026-10-18 02:41 +08:00**）

来源：用户在 2026-10-18 提出三条 UI 反馈，经 3 轮访谈全部拍板。**分两批交付，批 1 单独上线验收后才进批 2。**

### 2.1 批 1（P0）· F1 浮动看板

**形态：用户明确选择「取代」——浮动窗取代主面板成为查看方式。**

- **删除**两处旧注册：`sidebar.panellist`（侧边栏图标）与 `main`（看板页）。避免图标导航到已不存在的主面板 key。
- **新增两个席位**：
  - `shell.overlay` 的浮动窗 occupant（id `dsh-task-lisk-float`）；
  - `sidebar.footer.action` 的自绘按钮 occupant（**该席位渲染我们的组件、点击归我们**）。
- **footer 按钮**：`order: 10`；`ownerProps {wide:boolean}`：rail（56px）态只显内联 SVG 图标 + `aria-label`，展开态显「任务」；**带未完成数徽标**（0 时隐藏，>99 显 `99+`，口径与看板列表摘要一致、含子任务）；**点击 = 开/关切换**（窗开着时点击 = 关闭，关着时 = 打开并复现上次位置）。
- **浮动窗**：`position: fixed` + 指针事件自绘；**只认标题栏拖拽**、右下角缩放；最小 320×240；**可在整个 DSH Desktop 窗口任意位置停留**；越界自动夹回可视区；**不做**吸附/最小化/全局快捷键（以后可选）。
- **持久化**：`localStorage["dsh.task-lisk.float.v1"] = {x,y,w,h,open,groupMode}`，**全局一份**（不随会话/工作区）。首次无记录时：**默认开**、右上角内缩 24px、380×520。
- **关闭方式**：仅 footer 按钮或标题栏 `×`；**点击外部不关闭**。
- **标题栏**：`任务` + 刷新 + `?` + `×`。
- **附带的套件维护**：`smoke-task-lisk.mjs` 里针对 `sidebar.panellist` / `main` 的注册形状断言改写为 `shell.overlay` / `sidebar.footer.action`；`verify-bundle.mjs` 的 **D4 断言由 FAIL 降为 WARN**（理由见 §1.5 第 10 条），**不回填** ui-slots。

### 2.2 批 2（P1 + P2）· F2 按会话分组 + F3 问号帮助

**F2（用户选「宽窄自适应」）**

- 容器实测宽 `< 480px` → **按会话分组**；`≥ 480px` → 保持扁平；另给**手动三态覆盖**（自动/扁平/分组）并持久化（存 `groupMode`）。
- 默认宽 380 ⇒ **装完第一眼即分组视图**（用户已确认接受）。
- 组头 = **会话标题**（取不到回退短 id）；无 `sessionId` 的任务归「**未分组**」并**置底且始终显示**；组内沿用 `order` 再按优先级/截止；组**可折叠**且折叠态持久化；**不过滤**，仅把当前会话组用**左侧色条 +「当前」小标签**高亮。
- **数据无需改动**：`sessionId` 已在任务 schema（可空）；UI 建任务写当前会话、agent 导入写该 agent 会话。

**F3 问号帮助**

- 入口 = 浮动窗标题栏 `?`；**点击开**、**点外部或 Esc 关**、首次**不自动弹**。
- 内容 6 节：看板是什么／任务·子任务·周期／优先级·截止／给 agent 用（`task_lisk` 工具）／暂停与放行（含放行留言）／浮动与分组用法。
- 作为**同一 `shell.overlay` 席位内的第二个浮层**渲染，避免被窄容器裁切；浮动窗关闭时不可达。

### 2.3 每批固定交付流程

1. 改源码 → `node --check`（Electron node）。
2. 三套件必须绿（`verify-bundle` / `smoke-task-lisk` / `smoke-host-runtime`）；形状断言随实现同步改写。
3. `plugin_manager(action="install_bundle", target="<绝对包目录>")` → 记下 `application` 字段（`applied` = HMR 生效；`restart-required` = 需重启）。
4. **Inspect 实证**（不依赖肉眼）：`plugin_manager(list_bundles)`、host `cordis_inspect_query(Tool/listTools)`、client `cordis_inspect_query(Slots/listSubTree)` 确认新 occupant 出现且 `active: true`。
5. 回写 §5 开发回执区（改动文件 + 验证证据 + 未完成/阻塞）。
6. 用户肉眼验收（唯一未验的交互路径）。

---

## 3. 积压（本批不做，别提前实现）

### R7 · 每日首次访问时提示未完成任务

- 提出时间 **2026-10-18 02:2x +08:00**（用户原话：「暂时是。未来需要做一个功能：每天用户第一次访问 dsh 时提示未完成的任务。先记着，后面再实现」）。
- 性质：已撤回的需求 5（条件化提醒）的**窄化复活版**；仅「每日首次 + 只提示未完成」。
- 未来开工前必须先回问用户的未定项：① 日界取自然日 00:00 还是 harness 的 450 分钟日界；② 提示形态（`shell.overlay` toast 还是对话框）；③「首次」是否要求当天尚无会话活动；④ 是否给用户开关。

---

## 4. 需求变更流水（append-only，最新在下）

### 2026-10-18 02:41 +08:00 · 文档创建 + 首批开发需求下发

- 创建本文件（双会话信道）。位置由用户指定为工作区根（偏离 `handoff` skill 的「系统临时目录」默认，以用户要求为准）。
- 下发**批 1（F1 浮动看板）** 与**批 2（F2 按会话分组、F3 问号帮助）**，定义见 §2，源自用户 2026-10-18 的三条 UI 反馈与 3 轮访谈结论。
- 记录积压 **R7**（见 §3）。
- 确立写法约定：**新需求只写增量、必带时间戳、不复述既有需求原文**（见 §0）。
- 会话分工确立：**本会话（A）= 需求与反馈**；**开发交由另一会话（B）**，B 必须回写 §5。

### 2026-10-27 11:32 +08:00 · 关闭三项待决（对应 `HANDOFF.md` §10 问题 1 / 3 / 6）

- **问题 1（插件名）→ 关闭，带条件**：批 1 / 批 2 期间**包名保持 `dsh-task-lisk` 不变**。改名时机 = 用户先在 GitHub 建好 repo 之后再改，与仓库发布一并做（届时须同步：包名、`cordis.patch.yml`、profile 的 `dependencies` 与 `dsh.profile.bundles` 记录、已装 generation）。**在用户说「repo 建好了」之前不要动包名，也不要为此做预备性重构。**
- **问题 3（存储）→ 关闭**：**不额外导出人可编辑 JSON**。权威存储只有 `ctx.storageDomain` 的 `task_lisk` 领域；`files` 白名单与核验断言都不为 JSON 导出物预留。
- **问题 6（安装/重启窗口）→ 关闭**：用户已知悉「批 1 属**替换**安装，预计返回 `restart-required`，需重启 DSH Desktop 一次并断开当前 GUI 会话」，并接受该时机。**因此批 1 必须一次做完整**（F1 代码 + D4 降 WARN + `smoke-task-lisk.mjs` 形状断言 + `README` / `DECISIONS` D3 / `HANDOFF` 顶部旧定案同步），避免同一件事重启多次。

---

### 2026-10-30 11:10 +08:00 · 增量：删掉浮动窗标题栏的「刷新」按钮

- 用户反馈（原话）：「怎么有两个刷新按钮，请把标题栏的那个删掉」。
- 变更：浮动窗标题栏**只保留「任务」标题与「关闭 ✕」**，删除其中的「刷新」按钮；`TaskBoard` 内部工具栏的「刷新」保留（它是唯一刷新入口）。
- 连带清理：`boardNonce` / `setBoardNonce` 状态与 `TaskBoard` 的 `key: boardNonce`（原本只服务于该按钮的强制重挂载）；拖拽顶部注释「（刷新/×）」改为「（×）」，防误拖逻辑不动。
- 影响面：`smoke-task-lisk.mjs` 的标题栏断言改为反向断言（不得再含刷新、关闭仍在），用例数仍 26；不涉及宿主半身、`verify-bundle.mjs`、文档。
- 派发：AutoClaw 任务单 `autoclaw_tasks/2026-10-30-001.md`（task_id `2026-10-30-001`）；装机与验收由本会话负责。

---

## 5. 开发回执区（append-only，由开发会话 B 写；A 不修改）

> 回写模板（每批一次，带时间戳）：

```
### YYYY-MM-DD HH:MM +08:00 · 批 N 完成 / 部分完成 / 阻塞
- 批次与范围：
- 改动文件（绝对路径 + 一句话）：
- 验证证据（命令 + 结果数字；Inspect 查到的 occupant 原文）：
- 未完成 / 与需求不符之处（如有，写清差异，不要擅自改需求）：
- 阻塞与需要的决定（等 A 转达用户）：
- 下一步：
```

（待开发会话回写）

### 2026-10-27 14:45 +08:00 · 批 1 完成
- 批次与范围：批 1（F1 浮动看板）全量——删陳 sidebar.panellist / main 两处旧注册，新增 sidebar.footer.action 按钮（id dsh-task-lisk、order 20）与 shell.overlay 浮动看板（id dsh-task-lisk.float、order 100、标题栏=任务/刷新/×）；插件级 inject 增 "timer"；徽标轮询（先立即拉一次再 15s 间隔）+ countPending 统一口径（含子任务、done 不计、0 隐藏、>99 显 99+）；localStorage `dsh.task-lisk.float.v1` 持久化 {x,y,w,h,open,groupMode}（groupMode 只写不读）；smoke/verify 断言与四份文档同步。标题栏未放 `?`（按任务单 §3.6，批 2 与帮助浮层一起出）。
- 改动文件（绝对路径 + 一句话）：
  - C:\Users\A005490\Desktop\old\old AI files\DSH plugins develop\task_lisk\dsh-task-lisk\lib\client.js —— 删旧注册与 PanelIcon；新增 FooterButton/FloatWindow/持久化/徽标 store；inject=["slots","connection","timer"]；countPending 统一口径
  - C:\Users\A005490\Desktop\old\old AI files\DSH plugins develop\task_lisk\smoke-task-lisk.mjs —— 断言改写为新席位形状 + 口径 + SSR 浮动窗/按钮两态（23→26 项）
  - C:\Users\A005490\Desktop\old\old AI files\DSH plugins develop\task_lisk\verify-bundle.mjs —— D4 FAIL→WARN；D6/D7 同步新契约
  - C:\Users\A005490\Desktop\old\old AI files\DSH plugins develop\task_lisk\dsh-task-lisk\README.md —— 4 处形态描述 + 套件计数同步
  - C:\Users\A005490\Desktop\old\old AI files\DSH plugins develop\task_lisk\DECISIONS.md —— D3 作废，改写为 D3′（浮动窗取代主面板）
  - C:\Users\A005490\Desktop\old\old AI files\DSH plugins develop\task_lisk\HANDOFF.md —— 仅顶部 v3 已定案第 2 条改为浮动窗方案
  - C:\Users\A005490\Desktop\old\old AI files\DSH plugins develop\task_lisk\research\bundle-preflight.md —— D4 叙述改「仅告警」
- 验证证据（命令 + 结果数字）：
  - `node --check dsh-task-lisk\lib\client.js` → exit 0
  - `smoke-task-lisk.mjs` → 26/26（含新席位形状、旧席位零残留、countPending 口径、SSR 浮动窗首屏与按钮两态）
  - `smoke-host-runtime.mjs` → 70/70
  - `verify-bundle.mjs` → exit 0，打印 31/31；其中 F1/F2/F3/G 4 行 FAIL 为**既有环境漂移**（asar 已升 0.2.1-rc.2 致行号/字符串取证失效；插件已装机使「未安装」前提失效），这 4 项只读 asar/profile，与本次改动无关；汇总处 r[1] 旧 bug（误以 label 判 FAIL）致 FAIL 不计通过数，属既有缺陷未动、如实上报
  - 全文 grep：`window.setInterval` / `window.addEventListener` / `sidebar.panellist` / `inject("main"` 均 0 命中；lib/index.js、package.json、cordis.patch.yml mtime 依次为 10-17/10-18/10-06（未动）
  - Inspect 查到的 occupant 原文：本会话无 DSH 工具，未做 Inspect；装机后由 DSH 侧用 list_bundles / Slots/listSubTree 核对两处 occupant active:true
- 未完成 / 与需求不符之处（如有，写清差异，不要擅自改需求）：① inject 里的 pending 是首屏快照（渲染机按 entry 永久缓存 inject 结果），实时徽标经模块级 badge store 订阅刷新——对 §3.4/3.5 inject 形状的必要补充，组件注释已注明；② 轮询先立即拉一次再进 15s 间隔（独立评审建议采纳，避免首显 0）；③ verify-bundle 除授权的 D4→WARN 外同步了 D6（inject 含 timer）/D7（新席位）——旧断言随代码必然失效，属断言随契约更新、非放宽；④ footer order 用 20、标题栏无 `?`，与 §2.1 原设计（order 10、含 ?）不一致处均以本批任务单为准。
- 阻塞与需要的决定（等 A 转达用户）：无。
- 下一步：DSH 侧 install_bundle（预期 restart-required，重启一次）+ GUI 验收（重点：标题栏 刷新/× 点击、拖拽/缩放/越界夹回、rail 与展开两态按钮与徽标）；批 2（F2 分组 + F3 问号帮助）待派。

### 2026-10-29 17:05 +08:00 · 批 1 装机后未生效的根因与修复（DSH 侧补记，非代码改动）

- 现象：10-27 替换式装包返回 `restart-required`，用户重启后插件页可见 `dsh-task-lisk` 且显示已启用，但界面无按钮/无浮动窗；`Config.listConfigs(name:"dsh-task-lisk")` 返回 `status: "inactive"`，`shell.overlay` 与 `sidebar.footer.action` 均无本插件 occupant。
- 根因（决定性）：profile `C:\Users\A005490\AppData\Roaming\dsh-desktop\harness\profiles\web\cordis.patch.yml` 中存在 `- id: dsh-task-lisk` + `disabled: true` 的显式禁用条目（该文件 mtime 2026-10-28 17:21，非 10-27 安装期写入；来源不明）。
- 修复：`plugin_manager(action="set_plugin", target="include:dsh-task-lisk", enabled=true)` → `{changed:true, enabled:true, application:"applied", warnings:[]}`。**注意 target 必须用 `include:` 前缀的 entryId**；直接传 `dsh-task-lisk` 报 `{error:{code:"unknown-plugin"}}`。修复后 patch 内该条目已移除（patch mtime 17:03:45，67,005 B）。
- 生效证据：`Config.listConfigs` 的 `status` 由 `inactive` → `schema`（与正常插件 `dsh-web-tools` 同值，属正常态）；`Slots.listSubTree("sidebar.footer.action")` 出现 occupant `{registrant:"task-lisk", id:"dsh-task-lisk", order:20, active:true}`；用户肉眼确认 UI 出现。
- 教训（后续派活任务单必须复述）：替换式安装后 UI 不出现时，排查顺序 = ①`Config.listConfigs` 的 `status` → ②profile `cordis.patch.yml` 是否含 `disabled: true` → ③才怀疑代码或要求重启。另：用户说「已重启」并不等于 Harness 子进程换了，需用 `harness.log` 里新的 `[desktop] projected generations` 行证明。

### 2026-10-30 15:55 +08:00 · 批 2 代码与套件完成 · §3.3 运行时实证交还 DSH 侧（待回传）
- 批次与范围：批 2（F2 按会话分组 + F3 问号帮助）代码、套件、文档全量完成；§3.3「当前会话标识」按来源 A（客户端 sessions 服务）实现为**防御性集成**。浏览器实证本会话未能执行（桌面版 GUI 带认证门且日志 token 已脱敏、浏览器面板无法附着），经用户指示（2026-10-30）把运行时实证交还 DSH 侧在 DSH 内部做，结论待回传。
- 改动文件（绝对路径 + 一句话）：
  - `...\task_lisk\dsh-task-lisk\lib\client.js` —— F2：判定基准=浮动窗实测宽（<480px 自动分组，≥480 扁平），工具栏「分组」三态下拉 auto/flat/grouped 覆盖并持久化在 float.v1 的 groupMode（groupMode 本批起真正被读）；组头=会话标题（displayTitle，回退短 id），组间按首次出现序、组内沿用既有排序；无 sessionId 归「未分组」置底且始终显示；组可点折叠、折叠态持久化到新键 `dsh.task-lisk.float.collapsed.v1`（全局一份）；不过滤只重排；当前会话组左侧色条+「当前」标签。F3：标题栏「任务」与「✕」之间加「?」，点击开、点面板外暗色遮罩或 Esc 或再点 ? 关、首屏不自动弹；6 节中文内容；渲染在 FloatWindow 内部第二浮层（不新开席位）。会话标识：插件 inject 追加 sessions（D6 锚定声明行不动、导出处 `[...inject,"sessions"]` 只增不改），apply 轮询 sessions.list 快照，retainedBy.mainView>0 判主会话、displayTitle 采标题；UI 新建任务/子任务带当前 sessionId；全部防御性，拿不到自动降级（无高亮、不写 sessionId），绝不臆造。
  - `...\task_lisk\smoke-task-lisk.mjs` —— 批 1 断言全部保留；新增 10 用例（三态×宽度含 480 边界、groupBySession 形状、折叠读写+持久化、第二模块实例读盘、会话身份解析三形态+空形不臆造、payloadWithSession、帮助 6 节、SSR 分组视图/折叠/短 id 回退、SSR 标题栏 ? 与首屏不自动弹）；26→36 项，36/36 全绿。
  - `...\task_lisk\dsh-task-lisk\README.md` —— F2/F3 描述同步（分组/阈值/三态/未分组/折叠/高亮降级 + 帮助 6 节）。
- 验证证据（命令 + 结果数字）：`node --check dsh-task-lisk\lib\client.js` → exit 0；`smoke-task-lisk.mjs` → **36/36**；`smoke-host-runtime.mjs` → **70/70**；`verify-bundle.mjs` → **31/31**（exit 0；F1/F2/F3 三行 FAIL 为既有环境漂移，与本批改动前基线逐字一致）；mtime 全量比对：748 个文件中仅上述三个允许文件变化，lib/index.js、package.json、cordis.patch.yml、verify-bundle.mjs、DECISIONS.md、HANDOFF.md mtime 均未动；Inspect 未做（本会话无 DSH 工具，装机后由 DSH 侧复核 occupant）；独立 code-review（审阅子代理）：verdict issues-found（1 必须修 + 3 值得考虑），全部就地修复后复跑四条命令仍全绿（--check exit 0、36/36、70/70、31/31）——修复项：floatState 过时注释（「groupMode 只存不读」→三态判定描述）、groupBySession 与 README 的排序口径表述（实为 order→创建时间，任务单括注「优先级/截止」与现有实现不符）、README 验证计数 26→36、smoke 补渲染级扁平反证（auto+600 无组头标记）。
- 未完成 / 与需求不符之处：① §3.3 浏览器实证未执行（改为 DSH 侧内部实证），代码按「实证通过」形态交付，若实测形状不符会自动降级且不损坏看板；② verify-bundle D6 正则锚定 `const inject = ["slots", "connection", "timer"]` 字面量且该文件本批禁改，故 sessions 采用「声明行不动、导出处追加」，对外门面声明已含 sessions，D6 保持通过；③ 任务单未规定组间顺序，按「会话在既有树序中的首次出现顺序」实现；④「未分组」组仅在有散任务时渲染（无散任务不产出空组头）。
- 阻塞与需要的决定（等 A 转达用户）：等 DSH 侧内部实证 §3.3 三件事：① 装机后插件正常加载（ctx.sessions 门面放行，插件未被 park，看板/按钮照常出现）；② 会话列表快照含 `byId[sid].displayTitle` 与 `retainedBy.mainView`（或旧线 `snapshot.current`）；③ 窄容器下组头显示会话标题、当前会话组显「当前」高亮、UI 新建任务落库带当前 sessionId。若实测形状不符：看板不受影响（自动降级），请把实际打印形状回传，仅需小修 `resolveSessionIdentity`。
- 下一步：DSH 侧 install_bundle + GUI 验收（分组/三态/折叠/帮助交互）+ §3.3 实证；结论回传后本批状态由 needs-input 翻为 done（无代码改动），或按实测形状小修后翻 done。