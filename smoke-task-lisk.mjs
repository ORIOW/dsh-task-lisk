/**
 * dsh-task-lisk 冒烟测试（工作区一次性校验，不属于插件包）。
 *
 * 需要工作区下存在 node_modules 链接（指向 DSH 运行时 checkout 的 node_modules），
 * 否则裸说明符 `@deepseek-ai/*` / `zod` / `react` 无法解析。
 *
 * 校验：宿主模块可加载（含顶层 defineDomain spec）、Config 默认值与覆盖、
 * 客户端槽位注册形状（shell.overlay 浮动看板 + sidebar.footer.action 按钮，
 * 旧 sidebar.panellist / main 席位零残留）、未完成数口径、树/日期纯函数、
 * SSR 首屏渲染浮动窗与按钮两态。
 */
import { pathToFileURL } from "node:url";
import path from "node:path";
import fs from "node:fs";

const root = path.resolve("dsh-task-lisk");
const rows = [];
const check = (label, fn) => {
	try {
		rows.push([label, "ok", String(fn() ?? "")]);
	} catch (error) {
		rows.push([label, "FAIL", error instanceof Error ? error.message : String(error)]);
	}
};
const checkAsync = async (label, fn) => {
	try {
		rows.push([label, "ok", String((await fn()) ?? "")]);
	} catch (error) {
		rows.push([label, "FAIL", error instanceof Error ? error.message : String(error)]);
	}
};

// ---- 宿主半身
const host = await import(pathToFileURL(path.join(root, "lib/index.js")).href);
check("host exports", () => Object.keys(host).sort().join(","));
check("host name/inject", () => `${host.name} inject=${JSON.stringify(host.inject)}`);
check("host Config defaults", () => JSON.stringify(host.Config({})));
check("host Config override", () => JSON.stringify(host.Config({ defaultPolicy: "every-step", maxDepth: 3, enabled: false })));
check("host apply", () => typeof host.apply);
check("nextDue daily", () => new Date(host.__internals.nextDue(Date.parse("2024-01-31T09:00:00"), "daily")).toISOString());
check("nextDue weekly", () => new Date(host.__internals.nextDue(Date.parse("2024-01-31T09:00:00"), "weekly")).toISOString());
check("nextDue monthly(月末夹取)", () => new Date(host.__internals.nextDue(Date.parse("2024-01-31T09:00:00"), "monthly")).toISOString());
check("normalizeDue ISO", () => host.__internals.normalizeDue("2024-02-01T00:00:00"));
check("normalizeDue garbage", () => host.__internals.normalizeDue("不在"));
check("sessionIdOf", () => `${host.__internals.sessionIdOf({ id: "s1" })}|${host.__internals.sessionIdOf({ sessionId: " s2 " })}|${host.__internals.sessionIdOf(undefined)}`);
check("headerOf cwd", () => JSON.stringify(host.__internals.headerOf({ header: { cwd: "C:/w", origin: "subagent" } })));

// ---- 客户端半身
let spec;
globalThis.window = { __ModuleLoader__: { load: (value) => { spec = value; } } };
/** 伪 localStorage：client.js 的 float.v1 / collapsed.v1 读写走它（键值存内存）。 */
const fakeStorage = new Map();
globalThis.localStorage = {
	getItem: (key) => (fakeStorage.has(key) ? fakeStorage.get(key) : null),
	setItem: (key, value) => {
		fakeStorage.set(key, String(value));
	},
	removeItem: (key) => {
		fakeStorage.delete(key);
	}
};
await import(pathToFileURL(path.join(root, "lib/client.js")).href);
check("client module id", () => spec?.id);
let react = null;
try {
	react = await import("react");
} catch (error) {
	react = null;
}
const React = react === null ? null : react.default ?? react;
const client = spec.factory((id) => {
	if (id === "react") {
		if (React === null) throw new Error("react is not resolvable");
		return React;
	}
	throw new Error(`unexpected require(${id})`);
});
check("client exports", () => Object.keys(client).sort().join(","));
check("client name/inject", () => `${client.name} inject=${JSON.stringify(client.inject)}`);
check("client inject 含 timer+sessions", () => {
	const expected = ["slots", "connection", "timer", "sessions"];
	if (JSON.stringify(client.inject) !== JSON.stringify(expected)) throw new Error(`inject=${JSON.stringify(client.inject)}`);
	if (!client.inject.includes("timer")) throw new Error("timer 声明门不能删（verify-bundle D6）");
	return expected.join("+");
});
const regs = [];
const fakeCtx = {
	connection: { rpc: {} },
	// 伪 sessions 门面（§3.3 来源 A）：验证 apply 会把当前会话身份同步进模块 store。
	sessions: {
		list: {
			getSnapshot: () => ({
				byId: {
					s1: { displayTitle: "会话甲", retainedBy: { mainView: 1 } },
					s2: { displayTitle: "会话乙", retainedBy: { mainView: 0 } }
				}
			})
		},
		retainInfo: () => ({ getSnapshot: () => ({ retainedBy: { mainView: 0 } }) })
	},
	effect: (fn) => fn(),
	interval: (fn) => {
		// 与真实 timer 服务不同：这里同步执行一次以证明轮询回调可安全跑在无 RPC 环境。
		fn();
		return () => {};
	},
	slots: {
		inject: (slotName, callback) => {
			callback();
			return () => {};
		},
		register: (options, component) => {
			regs.push({ options, component });
			return () => {};
		}
	}
};
check("client apply", () => {
	client.apply(fakeCtx);
	return `${regs.length} registrations`;
});
check("client apply 会话身份同步（伪 sessions 门面）", () => {
	if (client.__internals.sessionInfo.currentId !== "s1") throw new Error(`currentId=${client.__internals.sessionInfo.currentId}`);
	if (client.__internals.sessionInfo.titles.s2 !== "会话乙") throw new Error("titles 未采集");
	return `currentId=${client.__internals.sessionInfo.currentId}, titles=会话甲/会话乙`;
});
check("client slots", () => JSON.stringify(regs.map((r) => ({
	slot: r.options.name,
	id: r.options.id,
	order: r.options.order,
	label: r.options.label,
	component: r.component?.name
}))));
check("旧席位已移除", () => {
	const stale = regs.filter((r) => r.options.name === "sidebar.panellist" || r.options.name === "main");
	if (stale.length > 0) throw new Error(`仍注册了 ${stale.map((r) => r.options.name).join(",")}`);
	if (client.PanelIcon !== undefined) throw new Error("exports.PanelIcon 应已删除");
	return "panellist/main/PanelIcon 均无";
});
check("footer.action 注册形状", () => {
	const reg = regs.find((r) => r.options.name === "sidebar.footer.action");
	if (reg === undefined) throw new Error("missing sidebar.footer.action registration");
	if (reg.options.id !== "dsh-task-lisk") throw new Error(`id=${reg.options.id}`);
	if (reg.options.order !== 20) throw new Error(`order=${reg.options.order}`);
	if (typeof reg.options.inject !== "function") throw new Error("inject 应为函数");
	if (typeof reg.component !== "function") throw new Error("component 应为函数");
	const injected = reg.options.inject();
	if (injected.rpc === undefined) throw new Error("footer.action did not inject rpc");
	if (typeof injected.pending !== "number") throw new Error("footer.action did not inject pending");
	return `id=${reg.options.id} order=20 inject→{${Object.keys(injected).join(",")}}`;
});
check("shell.overlay 注册形状", () => {
	const reg = regs.find((r) => r.options.name === "shell.overlay");
	if (reg === undefined) throw new Error("missing shell.overlay registration");
	if (reg.options.id !== "dsh-task-lisk.float") throw new Error(`id=${reg.options.id}`);
	if (reg.options.order !== 100) throw new Error(`order=${reg.options.order}`);
	if (typeof reg.options.inject !== "function") throw new Error("inject 应为函数");
	if (typeof reg.component !== "function") throw new Error("component 应为函数");
	const injected = reg.options.inject();
	if (injected.rpc === undefined) throw new Error("shell.overlay did not inject rpc");
	if (typeof injected.pending !== "number") throw new Error("shell.overlay did not inject pending");
	return `id=${reg.options.id} order=100 inject→{${Object.keys(injected).join(",")}}`;
});
check("countPending 口径(含子任务)", () => {
	const n = client.__internals.countPending([
		{ id: "a", parentId: null, status: "todo" },
		{ id: "b", parentId: null, status: "done" },
		{ id: "a1", parentId: "a", status: "doing" },
		{ id: "a2", parentId: "a", status: "todo" }
	]);
	if (n !== 3) throw new Error(`countPending=${n}, 期望 3（a/a1/a2，排除已完成的 b）`);
	return "3 = 2 顶层未完成 + 1 子任务，done 不计";
});
check("flatten 树序", () => {
	const tree = client.__internals.flatten([
		{ id: "b", parentId: "a", order: 10, createdAt: 2 },
		{ id: "a", parentId: null, order: 20, createdAt: 1 },
		{ id: "c", parentId: null, order: 10, createdAt: 3 }
	]);
	return tree.map((entry) => `${entry.task.id}@${entry.depth}`).join(" ");
});
check("fmtDue 语义", () => {
	const today = new Date();
	today.setHours(9, 0, 0, 0);
	return `${client.__internals.fmtDue(today.getTime())}|${client.__internals.fmtDue(today.getTime() - 3 * 86400000)}|${client.__internals.shortId("abcdefghijklmn")}`;
});

// ---- 批 2 · F2/F3 纯逻辑 ----
check("F2 分组判定 三态×宽度", () => {
	const g = client.__internals;
	g.setFloatState({ groupMode: "auto", w: 380 });
	if (g.effectiveGrouped() !== true) throw new Error("auto+380 应分组");
	g.setFloatState({ w: 600 });
	if (g.effectiveGrouped() !== false) throw new Error("auto+600 应扁平");
	g.setFloatState({ w: 480 });
	if (g.effectiveGrouped() !== false) throw new Error("480 应视为宽（扁平）");
	g.setFloatState({ w: 479 });
	if (g.effectiveGrouped() !== true) throw new Error("479 应视为窄（分组）");
	g.setFloatState({ groupMode: "flat", w: 380 });
	if (g.effectiveGrouped() !== false) throw new Error("手动扁平应覆盖窄宽度");
	g.setFloatState({ groupMode: "grouped", w: 600 });
	if (g.effectiveGrouped() !== true) throw new Error("手动分组应覆盖宽宽度");
	g.setFloatState({ groupMode: "auto", w: 380 });
	return "auto: 380/479→分组, 480/600→扁平; 手动三态覆盖自动判定";
});
check("F2 groupBySession 形状", () => {
	const g = client.__internals;
	const tasks = [
		{ id: "l1", parentId: null, order: 1, createdAt: 1, sessionId: null },
		{ id: "a1", parentId: null, order: 2, createdAt: 2, sessionId: "s1" },
		{ id: "b1", parentId: null, order: 3, createdAt: 3, sessionId: "s2" },
		{ id: "a2", parentId: null, order: 4, createdAt: 4, sessionId: "s1" },
		{ id: "l2", parentId: null, order: 5, createdAt: 5, sessionId: null }
	];
	const groups = g.groupBySession(g.flatten(tasks));
	const shape = groups.map((grp) => `${grp.sessionId ?? "null"}:${grp.tasks.map((e) => e.task.id).join("")}`).join(" ");
	if (shape !== "s1:a1a2 s2:b1 null:l1l2") throw new Error(`groups=${shape}`);
	return shape;
});
check("F2 折叠表读写与持久化形状", () => {
	const g = client.__internals;
	if (g.COLLAPSED_STORAGE_KEY !== "dsh.task-lisk.float.collapsed.v1") throw new Error(`key=${g.COLLAPSED_STORAGE_KEY}`);
	g.toggleCollapsed("s1");
	if (g.collapsedMap.s1 !== true) throw new Error("toggle 后应折叠");
	if (JSON.parse(fakeStorage.get(g.COLLAPSED_STORAGE_KEY)).s1 !== true) throw new Error("持久化缺失");
	g.toggleCollapsed("s1");
	if (g.collapsedMap.s1 !== undefined) throw new Error("二次 toggle 应展开");
	if (JSON.parse(fakeStorage.get(g.COLLAPSED_STORAGE_KEY)).s1 !== undefined) throw new Error("持久化未同步");
	g.toggleCollapsed("");
	if (JSON.stringify(g.collapsedMap) !== "{}") throw new Error("空 id 应为 no-op");
	return "toggle 写盘+回删清盘，键=dsh.task-lisk.float.collapsed.v1";
});
check("F2 折叠与三态从存盘读取（第二模块实例）", () => {
	const g = client.__internals;
	const floatKey = "dsh.task-lisk.float.v1";
	fakeStorage.set(g.COLLAPSED_STORAGE_KEY, JSON.stringify({ s9: true }));
	fakeStorage.set(floatKey, JSON.stringify({ x: 12, y: 20, w: 600, h: 400, open: true, groupMode: "grouped" }));
	const client2 = spec.factory((id) => {
		if (id === "react") return React;
		throw new Error(`unexpected require(${id})`);
	});
	try {
		if (client2.__internals.floatState.groupMode !== "grouped") throw new Error(`groupMode=${client2.__internals.floatState.groupMode}`);
		if (client2.__internals.effectiveGrouped() !== true) throw new Error("grouped 覆盖应分组（w=600）");
		if (client2.__internals.collapsedMap.s9 !== true) throw new Error("折叠表未从盘读取");
		return "第二实例读盘：groupMode=grouped 生效、collapsed.s9=true";
	} finally {
		fakeStorage.delete(g.COLLAPSED_STORAGE_KEY);
		fakeStorage.delete(floatKey);
	}
});
check("F2 会话身份解析（三种来源形态）", () => {
	const g = client.__internals;
	const rc2 = { byId: { sa: { displayTitle: "甲", retainedBy: { mainView: 2 } }, sb: { displayTitle: "乙", retainedBy: { mainView: 0 } } } };
	let r = g.resolveSessionIdentity(rc2, null);
	if (r.currentId !== "sa" || r.titles.sb !== "乙") throw new Error(`rc2=${JSON.stringify(r)}`);
	const legacy = { current: "sL", byId: { sL: { displayTitle: "旧线" } } };
	r = g.resolveSessionIdentity(legacy, null);
	if (r.currentId !== "sL") throw new Error("旧线 snapshot.current 应优先");
	const dim = { byId: { sf: { displayTitle: "兜" } } };
	const face = { retainInfo: (id) => ({ getSnapshot: () => ({ retainedBy: { mainView: id === "sf" ? 1 : 0 } }) }) };
	r = g.resolveSessionIdentity(dim, face);
	if (r.currentId !== "sf") throw new Error(`retainInfo 兜底失败 ${JSON.stringify(r)}`);
	r = g.resolveSessionIdentity(null, null);
	if (r.currentId !== null) throw new Error("空快照不得臆造 id");
	r = g.resolveSessionIdentity({ byId: { sx: {} } }, null);
	if (r.currentId !== null) throw new Error("无主行不得臆造 id");
	return "rc.2 mainView / 旧线 current / retainInfo 兜底 / 空形不臆造";
});
check("F2 payloadWithSession", () => {
	const g = client.__internals;
	g.setSessionInfo({ currentId: "s1" });
	const withId = g.payloadWithSession({ title: "x" });
	if (withId.sessionId !== "s1") throw new Error("应带当前会话");
	g.setSessionInfo({ currentId: null });
	const plain = g.payloadWithSession({ title: "x" });
	if ("sessionId" in plain) throw new Error("拿不到会话不得写 sessionId");
	return "有 currentId 带 sessionId，拿不到保持 null 不写";
});
check("F3 帮助内容 6 节", () => {
	const sections = client.__internals.HELP_SECTIONS;
	if (sections.length !== 6) throw new Error(`节数=${sections.length}`);
	const all = sections.map((s) => `${s.title} ${s.body}`).join("\n");
	for (const needle of ["task_lisk", "放行", "480px", "子任务", "优先级", "拖动"]) if (!all.includes(needle)) throw new Error(`缺 ${needle}`);
	return `6 节齐全（${sections.map((s) => s.title.slice(0, 2)).join("")}…）`;
});

// ---- 批 3 · P2 每日首访未完成提示 ----
check("P2 todayKey 本地日期（跨 UTC 零点不漂）", () => {
	const g = client.__internals;
	if (g.todayKey(new Date(2026, 0, 5, 23, 30)) !== "2026-01-05") throw new Error(`23:30 → ${g.todayKey(new Date(2026, 0, 5, 23, 30))}`);
	if (g.todayKey(new Date(2026, 0, 5, 0, 30)) !== "2026-01-05") throw new Error(`00:30 → ${g.todayKey(new Date(2026, 0, 5, 0, 30))}`);
	return "2026-01-05 当天 23:30 与 00:30 均为 2026-01-05";
});
check("P2 nudgeNeed 四态", () => {
	const g = client.__internals;
	if (g.nudgeNeed({ date: "2026-11-01" }, "2026-11-01", 3) !== false) throw new Error("当天已提示应 false");
	if (g.nudgeNeed({ date: "2026-10-31" }, "2026-11-01", 3) !== true) throw new Error("隔天应 true");
	if (g.nudgeNeed(null, "2026-11-01", 3) !== true) throw new Error("无记录应 true");
	if (g.nudgeNeed({ date: "2026-10-31" }, "2026-11-01", 0) !== false) throw new Error("零未完成应 false");
	return "同日 false / 隔日 true / 无记录 true / 零未完成 false";
});
check("P2 nudgeText 文案", () => {
	const g = client.__internals;
	const plain = g.nudgeText(3, 0);
	const due = g.nudgeText(3, 1);
	if (!plain.includes("3") || plain.includes("逾期")) throw new Error(`plain=${plain}`);
	if (!due.includes("1 个已逾期")) throw new Error(`due=${due}`);
	return `${plain} | ${due}`;
});
check("P2 键名与 todayKey 源码静态断言", () => {
	const g = client.__internals;
	if (g.NUDGE_STORAGE_KEY !== "dsh.task-lisk.nudge.v1") throw new Error(`key=${g.NUDGE_STORAGE_KEY}`);
	const src = fs.readFileSync(path.join(root, "lib/client.js"), "utf8");
	if (!src.includes("dsh.task-lisk.nudge.v1")) throw new Error("client.js 缺键名");
	const start = src.indexOf("function todayKey");
	const end = src.indexOf("function nudgeNeed");
	if (start < 0 || end <= start) throw new Error("todayKey 切片失败");
	if (src.slice(start, end).includes("toISOString")) throw new Error("todayKey 内不得出现 toISOString");
	return "键名正确；todayKey 为本地日期拼接，切片内无 toISOString";
});

// ---- SSR 首屏（无 DOM，仅证明组件树在无数据态可渲染）
const SSR_RPC = {
	call: async () => ({
		ok: true,
		value: {
			tasks: [],
			policy: { default: "on-subtask-done", sessions: [] },
			config: { maxDepth: 2, autoImportTodos: true, enabled: true }
		}
	})
};
await checkAsync("ssr 浮动窗首屏", async () => {
	if (React === null) return "skipped: react unavailable";
	const server = await import("react-dom/server");
	const floatComp = regs.find((r) => r.options.name === "shell.overlay").component;
	const html = server.renderToStaticMarkup(React.createElement(floatComp, { rpc: SSR_RPC }));
	if (!html.includes("任务看板")) throw new Error("markup missing board title");
	const hasTitlebarRefresh = html.includes("title=\"刷新\"") || html.includes("title: \"刷新\"");
	if (hasTitlebarRefresh) throw new Error("titlebar still renders a refresh button");
	if (!html.includes("关闭任务看板")) throw new Error("markup missing titlebar close");
	return `${html.length} bytes, 含标题/关闭（标题栏无刷新）`;
});
await checkAsync("ssr 按钮两态", async () => {
	if (React === null) return "skipped: react unavailable";
	const server = await import("react-dom/server");
	const btn = regs.find((r) => r.options.name === "sidebar.footer.action").component;
	const wide = server.renderToStaticMarkup(React.createElement(btn, { rpc: {}, pending: 3, wide: true }));
	const narrow = server.renderToStaticMarkup(React.createElement(btn, { rpc: {}, pending: 3, wide: false }));
	if (!wide.includes("任务") || !wide.includes(">3</span>")) throw new Error("wide markup missing label/badge");
	if (!narrow.includes(`aria-label="任务（3 未完成）"`)) throw new Error("narrow markup missing aria-label");
	if (!narrow.includes(">3</span>")) throw new Error("narrow markup missing badge");
	return `wide ${wide.length}B + narrow ${narrow.length}B, 两态均带徽标`;
});
await checkAsync("F2 SSR 分组视图（组头/未分组置底/当前高亮/折叠）", async () => {
	if (React === null) return "skipped: react unavailable";
	const server = await import("react-dom/server");
	const g = client.__internals;
	const tasks = [
		{ id: "a1", parentId: null, title: "任务A1", status: "todo", priority: "high", sessionId: "s1", order: 10, createdAt: 1 },
		{ id: "a2", parentId: null, title: "任务A2", status: "todo", priority: "normal", sessionId: "s1", order: 20, createdAt: 2 },
		{ id: "b1", parentId: null, title: "任务B1", status: "todo", priority: "normal", sessionId: "s2", order: 30, createdAt: 3 },
		{ id: "c1", parentId: null, title: "散任务C1", status: "todo", priority: "low", sessionId: null, order: 40, createdAt: 4 }
	];
	const identity = { currentId: "s1", titles: { s1: "会话甲", s2: "会话乙" } };
	const item = (entry) => React.createElement("div", { key: entry.task.id }, entry.task.title);
	const html = server.renderToStaticMarkup(React.createElement("div", {}, g.renderSessionGroups(g.flatten(tasks), identity, {}, item)));
	if (!html.includes("data-role=\"session-group\"")) throw new Error("缺组头标记");
	for (const needle of ["会话甲", "会话乙", "未分组", "任务A1", "任务B1", "散任务C1", "当前"]) if (!html.includes(needle)) throw new Error(`缺 ${needle}`);
	if (!(html.indexOf("会话甲") < html.indexOf("会话乙") && html.indexOf("会话乙") < html.indexOf("未分组"))) throw new Error("组序应为 甲→乙→未分组置底");
	if (!(html.indexOf("data-current=\"true\"") < html.indexOf("会话甲"))) throw new Error("当前高亮应在会话甲组头");
	const folded = server.renderToStaticMarkup(React.createElement("div", {}, g.renderSessionGroups(g.flatten(tasks), identity, { s2: true }, item)));
	if (!folded.includes("会话乙")) throw new Error("折叠组头应仍在");
	if (folded.includes("任务B1")) throw new Error("折叠组任务应隐藏");
	const fallback = server.renderToStaticMarkup(React.createElement("div", {}, g.renderSessionGroups(g.flatten(tasks), { currentId: null, titles: {} }, {}, item)));
	if (!fallback.includes(">s1</span>")) throw new Error("取不到标题应回退 shortId");
	g.setFloatState({ w: 600 });
	const flatBranch = g.effectiveGrouped() ? "grouped" : "flat";
	const flatHtml = server.renderToStaticMarkup(React.createElement("div", {}, flatBranch === "grouped" ? g.renderSessionGroups(g.flatten(tasks), identity, {}, item) : tasks.map((t) => ({ task: t, depth: 0 })).map(item)));
	g.setFloatState({ w: 380 });
	if (flatBranch !== "flat") throw new Error("auto+600 应回到扁平分支");
	if (flatHtml.includes("data-role=\"session-group\"")) throw new Error("扁平视图不得含组头标记");
	return `分组 ${html.length}B + 折叠 ${folded.length}B + 扁平 ${flatHtml.length}B + 回退 ${fallback.length}B`;
});
await checkAsync("F3 SSR 标题栏?与帮助面板", async () => {
	if (React === null) return "skipped: react unavailable";
	const server = await import("react-dom/server");
	const floatComp = regs.find((r) => r.options.name === "shell.overlay").component;
	const html = server.renderToStaticMarkup(React.createElement(floatComp, { rpc: SSR_RPC }));
	if (!html.includes("aria-label=\"看板帮助\"")) throw new Error("标题栏缺 ? 按钮");
	if (!html.includes("aria-expanded=\"false\"")) throw new Error("帮助初始应为收起");
	if (html.includes("任务看板帮助")) throw new Error("首屏不得自动弹帮助");
	const panel = server.renderToStaticMarkup(React.createElement(client.__internals.HelpPanel, { onClose: () => {} }));
	if (!panel.includes("任务看板帮助")) throw new Error("面板 aria-label 缺失");
	for (const needle of ["① 看板是什么", "② 任务·子任务·周期", "③ 优先级·截止", "④ 给 agent 用", "⑤ 暂停与放行", "⑥ 浮动与分组用法"]) if (!panel.includes(needle)) throw new Error(`缺节 ${needle}`);
	if (!panel.includes("aria-label=\"关闭帮助\"")) throw new Error("缺关闭按钮");
	return `首屏无面板（${html.length}B），展开面板 ${panel.length}B 含 6 节`;
});

let failed = 0;
for (const [label, status, detail] of rows) {
	if (status === "FAIL") failed++;
	console.log(`${status === "ok" ? "  ok" : "FAIL"}  ${label}${detail === "" ? "" : ` :: ${detail}`}`);
}
console.log(`\n${rows.length - failed}/${rows.length} 通过`);
process.exit(failed === 0 ? 0 : 1);
