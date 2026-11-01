/**
 * dsh-task-lisk 宿主半身「运行时行为」冒烟：用一个按真实契约搭出来的假 ctx
 * 把 `apply()` 真跑起来，覆盖静态导入测不到的三块：
 *   ① 工具 `task_lisk` 的 5 个 action 与真实参数校验（`defineTool` 的校验是真的）；
 *   ② RPC 通道 `/dsh-task-lisk` 的 HTTP 信封收发（伪 req/res 直接喂 channel handler）；
 *   ③ `session/event` 的 todo 折叠、`agent/pre-step` 卡门/硬停、`tools/result` 条件武装。
 *
 * 契约来源（全部读取自本机真实实现，见 research/refs/）：
 *   - `dsh-storage-domain`：`defineDomain` 返回原样 spec；`table().{get,put,delete,entries,size}`、
 *     `global.{get,set}`、`close()`；写操作在按域串行的链上，读是内存同步读。
 *   - `dsh-tools`：`ctx.tools.register(defineTool(...))`；`defineTool` 包装的 `execute(args, exec)`
 *     会先用参数 schema 校验 args；`tools/result` 观察者签名 `(exec, result)`，且 `exec` 上的
 *     调用参数叫 **`exec.arguments`**（深冻 JSON 快照），不是 `exec.args`。
 *   - `dsh-agent`：`agentEvents` 把 `agent` 融合进每个 payload（`{...payload, agent}`），
 *     所以 `agent/turn-stopping` 的 `{turn, signal}` 实际也带 `agent`。
 *   - `dsh-pause`：pre-step 门用 `payload.agent.id` 当会话键、`payload.step > 1` 才卡、
 *     abort 时 reject 门、放行文字经 `decision.messages` 并入。
 *
 * 运行：node --import ./smoke-loader.mjs smoke-host-runtime.mjs
 */
import { apply, name as pluginName } from "./dsh-task-lisk/lib/index.js";

let passed = 0;
const failures = [];

function check(label, ok, detail = "") {
	if (ok) {
		passed++;
		console.log(`  ok  ${label}${detail === "" ? "" : ` :: ${detail}`}`);
	} else {
		failures.push(`${label}${detail === "" ? "" : ` :: ${detail}`}`);
		console.log(`  FAIL ${label}${detail === "" ? "" : ` :: ${detail}`}`);
	}
}

const delay = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------- 假领域（按真实契约）
/** 用 spec 里的真实 zod schema 校验每条写入 —— 比真实层更严，用来抓「写进去会炸下次加载」的脏记录。 */
function openFakeDomain(spec) {
	const parsedInitial = spec.global === undefined ? undefined : spec.global.schema.parse(spec.global.initial);
	const globalValue = parsedInitial === undefined ? undefined : JSON.parse(JSON.stringify(parsedInitial));
	const tables = new Map();
	for (const [tableName, declaration] of Object.entries(spec.tables)) tables.set(tableName, makeTable(tableName, declaration.valueSchema));
	return {
		name: spec.name,
		table(tableName) {
			const table = tables.get(tableName);
			if (table === undefined) throw new Error(`domain '${spec.name}' declares no table '${tableName}'`);
			return table;
		},
		get global() {
			if (globalValue === undefined) throw new Error(`domain '${spec.name}' declares no global`);
			return {
				get: () => globalValue,
				set: async (value) => {
					spec.global.schema.parse(value);
					for (const key of Object.keys(globalValue)) delete globalValue[key];
					Object.assign(globalValue, JSON.parse(JSON.stringify(value)));
				}
			};
		},
		async close() {}
	};
}

function makeTable(tableName, schema) {
	const records = new Map();
	return {
		get: (key) => records.get(key),
		entries: () => [...records.entries()][Symbol.iterator](),
		keys: () => [...records.keys()][Symbol.iterator](),
		get size() {
			return records.size;
		},
		async put(key, value) {
			schema.parse(value); // 脏记录当场炸，不等到下次加载
			await delay(0); // 真实层是「先 await 后端落盘、再改内存」，异步窗口必须保留
			records.set(key, value);
		},
		async delete(key) {
			await delay(0);
			return records.delete(key);
		},
		async update(key, fn) {
			if (!records.has(key)) throw new Error(`table '${tableName}' has no record '${key}'`);
			const next = fn(records.get(key));
			schema.parse(next);
			records.set(key, next);
			return next;
		}
	};
}

// ---------------------------------------------------------------- 假 ctx
function createHarness() {
	const listeners = new Map();
	const warnings = [];
	const tools = [];
	const channels = [];
	const disposers = [];
	const pending = [];
	let domainSpec = null;
	let domain = null;
	let requestRejection;

	const services = {
		tools: {
			register(tool) {
				tools.push(tool);
				return () => {};
			}
		},
		storageDomain: {
			open(spec) {
				domainSpec = spec;
				domain = openFakeDomain(spec);
				return Promise.resolve(domain);
			}
		},
		connection: {
			requestRejection: () => requestRejection
		},
		webServer: {
			register(entry) {
				channels.push(entry);
				return () => {};
			}
		}
	};

	const ctx = {
		logger: {
			warn: (...args) => warnings.push(args.map(String).join(" ")),
			info: () => {},
			error: (...args) => warnings.push(`error: ${args.map(String).join(" ")}`)
		},
		effect(fn, label) {
			let result;
			try {
				result = fn();
			} catch (error) {
				throw error;
			}
			if (result !== null && typeof result === "object" && typeof result.then === "function") {
				pending.push(result.then((cleanup) => {
					if (typeof cleanup === "function") disposers.push(cleanup);
				}));
			} else if (typeof result === "function") {
				disposers.push(result);
			}
			return () => {};
		},
		inject(names, callback) {
			const missing = names.filter((serviceName) => services[serviceName] === undefined);
			if (missing.length === 0) callback(ctx);
			return () => {};
		},
		on(eventName, handler) {
			const bucket = listeners.get(eventName) ?? [];
			bucket.push(handler);
			listeners.set(eventName, bucket);
			return () => {
				listeners.set(eventName, (listeners.get(eventName) ?? []).filter((entry) => entry !== handler));
			};
		},
		...services
	};

	return {
		ctx,
		warnings,
		tools,
		channels,
		pending,
		disposers,
		get domainSpec() {
			return domainSpec;
		},
		get domain() {
			return domain;
		},
		setRequestRejection(value) {
			requestRejection = value;
		},
		/** 同步调用监听器，返回返回的 promise 数组（供「门是否挂起」这类断言）。 */
		emitSync(eventName, ...args) {
			return (listeners.get(eventName) ?? []).map((handler) => handler(...args));
		},
		async emit(eventName, ...args) {
			const returned = this.emitSync(eventName, ...args);
			await Promise.allSettled(returned);
			await this.settle();
			return returned;
		},
		/** 等所有 effect/异步副作用落地。 */
		async settle(rounds = 6) {
			for (let index = 0; index < rounds; index++) {
				await Promise.allSettled([...pending]);
				await delay(0);
			}
		},
		listenerCount: (eventName) => (listeners.get(eventName) ?? []).length
	};
}

// ---------------------------------------------------------------- 假 HTTP / agent
function makeRequest({ method = "POST", url = "/", body = null, headers = {} } = {}) {
	const chunks = body === null ? [] : [Buffer.from(body, "utf8")];
	return {
		method,
		url,
		headers,
		async *[Symbol.asyncIterator]() {
			for (const chunk of chunks) yield chunk;
		}
	};
}

function makeResponse() {
	return {
		statusCode: 0,
		headers: null,
		body: "",
		writeHead(code, headers) {
			this.statusCode = code;
			this.headers = headers ?? null;
			return this;
		},
		end(chunk) {
			if (typeof chunk === "string") this.body += chunk;
			else if (chunk !== undefined) this.body += String(chunk);
		},
		on() {},
		off() {},
		destroy() {}
	};
}

let rpcCounter = 0;
async function rpc(harness, endpoint, payload) {
	const channel = harness.channels.find((entry) => entry.path === "/dsh-task-lisk");
	if (channel === undefined) throw new Error("RPC 通道未注册");
	const request = makeRequest({
		method: "POST",
		url: `/dsh-task-lisk/${endpoint}`,
		body: JSON.stringify({
			type: "client-request",
			method: endpoint,
			payload,
			rpcId: `r${++rpcCounter}`
		}),
		headers: { "content-type": "application/json" }
	});
	const response = makeResponse();
	await channel.handler(request, response);
	let parsed = null;
	try {
		parsed = response.body === "" ? null : JSON.parse(response.body);
	} catch (error) {
		parsed = null;
	}
	return { status: response.statusCode, parsed, raw: response.body, response };
}

function makeAgent(id, sessionId = id, workspace = "C:/ws/a", origin = null) {
	return {
		id,
		session: {
			id: sessionId,
			header: {
				cwd: workspace,
				...(origin === null ? {} : { origin })
			},
			append: () => {}
		}
	};
}

function makeSignal() {
	const listeners = new Set();
	return {
		aborted: false,
		reason: undefined,
		addEventListener: (eventName, handler) => listeners.add(handler),
		removeEventListener: (eventName, handler) => listeners.delete(handler),
		abort(reason) {
			this.aborted = true;
			this.reason = reason;
			for (const handler of [...listeners]) handler();
		}
	};
}

const t = (agent, args) => agent.execute(args, {
	agent: agent.__agent,
	callId: "call_1",
	rootCallId: "call_1",
	arguments: args,
	signal: { aborted: false }
});

/** 给注册好的工具挂上 agent 执行上下文。 */
function runTool(harness, agentId, sessionId, args, workspace = "C:/ws/a", origin = null) {
	const tool = harness.tools.find((entry) => entry.name === "task_lisk");
	if (tool === undefined) throw new Error("task_lisk 工具未注册");
	const exec = {
		name: "task_lisk",
		callId: "call_1",
		rootCallId: "call_1",
		agent: makeAgent(agentId, sessionId, workspace, origin),
		arguments: args,
		signal: { aborted: false }
	};
	return tool.execute(args, exec);
}

function fireToolResult(harness, { agentId, sessionId, argv, result = { isError: false }, parent }) {
	const exec = {
		name: "task_lisk",
		callId: "call_x",
		rootCallId: "call_x",
		agent: agentId === null ? undefined : makeAgent(agentId, sessionId ?? agentId),
		arguments: argv,
		...(parent === undefined ? {} : { parent })
	};
	return harness.emit("tools/result", exec, result);
}

// ---------------------------------------------------------------- 开跑
console.log("== dsh-task-lisk 宿主运行时行为冒烟 ==\n");

// ---- A. 领域与注册形状
const harness = createHarness();
apply(harness.ctx, {});
await harness.settle();

check("插件名", pluginName === "task-lisk", pluginName);
check("领域 spec 名", harness.domainSpec?.name === "task_lisk", harness.domainSpec?.name);
check("领域表集合", JSON.stringify(Object.keys(harness.domainSpec?.tables ?? {})) === '["tasks"]', Object.keys(harness.domainSpec?.tables ?? {}).join(","));
check("领域 global 非 null 且含 sessions", harness.domainSpec?.global?.schema?.safeParse(null).success === false && Array.isArray(harness.domainSpec?.global?.initial?.sessions), JSON.stringify(harness.domainSpec?.global?.initial));
check("工具已注册", harness.tools.filter((entry) => entry.name === "task_lisk").length === 1, harness.tools.map((entry) => entry.name).join(","));
const registeredTool = harness.tools.find((entry) => entry.name === "task_lisk");
check("工具参数已编译成 JSON schema", registeredTool?.parameters?.properties?.action?.enum?.length === 5, JSON.stringify(registeredTool?.parameters?.properties?.action?.enum));
check("RPC 通道已注册", harness.channels.length === 1 && harness.channels[0].path === "/dsh-task-lisk" && harness.channels[0].kind === "prefix", JSON.stringify(harness.channels.map((entry) => `${entry.kind}:${entry.path}`)));
for (const eventName of ["session/event", "agent/pre-step", "tools/result", "agent/turn-stopping", "agent/disposed"]) {
	check(`监听 ${eventName}`, harness.listenerCount(eventName) === 1, String(harness.listenerCount(eventName)));
}

// ---- B. 工具 action（走真实 defineTool 参数校验）
const root = await runTool(harness, "s1", "s1", { action: "create", title: "根任务", priority: "high", dueAt: "2024-06-01T00:00:00Z" });
check("create 根任务", root.tasks[0].parentId === "" && root.tasks[0].priority === "high" && root.tasks[0].dueAt === "2024-06-01T00:00:00.000Z", JSON.stringify(root.tasks[0]));
const rootId = root.tasks[0].id;
const child = await runTool(harness, "s1", "s1", { action: "create", title: "子任务", parentId: rootId });
check("create 子任务 depth=1", harness.domain.table("tasks").get(child.tasks[0].id).depth === 1, String(harness.domain.table("tasks").get(child.tasks[0].id).depth));
const grandChild = await runTool(harness, "s1", "s1", { action: "create", title: "孙任务", parentId: child.tasks[0].id });
check("create 孙任务 depth=2（maxDepth 默认 2）", harness.domain.table("tasks").get(grandChild.tasks[0].id).depth === 2, String(harness.domain.table("tasks").get(grandChild.tasks[0].id).depth));
let depthError = "";
try {
	await runTool(harness, "s1", "s1", { action: "create", title: "曾孙", parentId: grandChild.tasks[0].id });
} catch (error) {
	depthError = String(error.message ?? error);
}
check("超出 maxDepth 被拒", depthError.includes("subtask depth limit is 2"), depthError);
let titleError = "";
try {
	await runTool(harness, "s1", "s1", { action: "create" });
} catch (error) {
	titleError = String(error.message ?? error);
}
check("缺 title 被 defineTool 参数校验拦下", titleError !== "" && !titleError.includes("subtask depth"), titleError.slice(0, 120));

const listed = await runTool(harness, "s1", "s1", { action: "list" });
check("list 汇总", listed.tasks.length === 3 && listed.summary.includes("共 3 条"), listed.summary.split("\n")[0]);
const updated = await runTool(harness, "s1", "s1", { action: "update", id: child.tasks[0].id, priority: "urgent", note: "改过" });
check("update 优先级/备注", updated.tasks[0].priority === "urgent", JSON.stringify(updated.tasks[0].priority));
const markedDone = await runTool(harness, "s1", "s1", { action: "update", id: child.tasks[0].id, status: "done" });
const markedRecord = harness.domain.table("tasks").get(child.tasks[0].id);
check("update status=done 也要写 completedAt", markedDone.tasks[0].status === "done" && markedRecord.completedAt !== null, `${markedRecord.status} completedAt=${markedRecord.completedAt}`);
const reopened = await runTool(harness, "s1", "s1", { action: "update", id: child.tasks[0].id, status: "todo" });
check("update status=todo 清 completedAt", reopened.tasks[0].status === "todo" && harness.domain.table("tasks").get(child.tasks[0].id).completedAt === null, String(harness.domain.table("tasks").get(child.tasks[0].id).completedAt));
const completed = await runTool(harness, "s1", "s1", { action: "complete", id: child.tasks[0].id });
check("complete 非周期任务 → done", completed.tasks[0].status === "done", completed.tasks[0].status);
const repeating = await runTool(harness, "s1", "s1", { action: "create", title: "每日站会", repeat: "daily", dueAt: "2024-06-01T00:00:00Z" });
const rolled = await runTool(harness, "s1", "s1", { action: "complete", id: repeating.tasks[0].id });
const rolledRecord = harness.domain.table("tasks").get(repeating.tasks[0].id);
check("complete 周期任务 → 滚动到下一周期", rolledRecord.status === "todo" && rolledRecord.rollCount === 1 && rolledRecord.dueAt === Date.parse("2024-06-02T00:00:00Z"), `${rolledRecord.status} roll=${rolledRecord.rollCount} due=${new Date(rolledRecord.dueAt).toISOString()}`);
check("complete 周期任务摘要带滚动日期", rolled.summary.includes("2024-06-02"), rolled.summary);
const cancelled = await runTool(harness, "s1", "s1", { action: "complete", id: repeating.tasks[0].id, status: "todo" });
check("complete 带 status=todo 是取消完成", cancelled.tasks[0].status === "todo", cancelled.tasks[0].status);
const removed = await runTool(harness, "s1", "s1", { action: "remove", id: rootId });
check("remove 级联删除子孙", removed.tasks.length === 0 && harness.domain.table("tasks").size === 1, `size=${harness.domain.table("tasks").size}`);

// ---- B2. 工具输出带 sessionId（schema / render / list summary）
const owned = await runTool(harness, "s1", "s1", { action: "create", title: "归属断言" });
check("create 输出 tasks[0].sessionId === 会话 id", owned.tasks[0].sessionId === "s1", JSON.stringify(owned.tasks[0].sessionId));
check("create 输出 sessionId 是字符串", typeof owned.tasks[0].sessionId === "string", typeof owned.tasks[0].sessionId);
const noSidTask = await runTool(harness, "", "", { action: "create", title: "无会话任务" });
const sidListed = await runTool(harness, "s1", "s1", { action: "list" });
const orphanRow = sidListed.tasks.find((task) => task.id === noSidTask.tasks[0].id);
check("list 输出里 null sessionId 归一成空串", harness.domain.table("tasks").get(noSidTask.tasks[0].id).sessionId === null && orphanRow !== undefined && orphanRow.sessionId === "", JSON.stringify(orphanRow?.sessionId));
check("list summary 出现 sid= 片段", sidListed.summary.includes("sid=") && sidListed.summary.split("\n").some((line) => line.includes(` sid=${owned.tasks[0].sessionId.slice(0, 8)}`)), sidListed.summary.split("\n").find((line) => line.includes("归属断言")) ?? "");

// ---- C. RPC 信封
const rpcList = await rpc(harness, "list", {});
check("RPC list 信封", rpcList.status === 200 && rpcList.parsed?.type === "server-response" && rpcList.parsed?.result?.ok === true, `${rpcList.status} ${rpcList.raw.slice(0, 80)}`);
check("RPC list 回带 policy 与 config", rpcList.parsed?.result?.value?.policy?.default === "off" && rpcList.parsed?.result?.value?.config?.maxDepth === 2, JSON.stringify(rpcList.parsed?.result?.value?.policy));
const rpcCreate = await rpc(harness, "create", { title: "面板新建" });
check("RPC create source=user", rpcCreate.parsed?.result?.value?.task?.source === "user", rpcCreate.parsed?.result?.value?.task?.source);
const rpcTaskId = rpcCreate.parsed?.result?.value?.task?.id;
await rpc(harness, "update", { id: rpcTaskId, patch: { title: "面板改名", priority: "low" } });
const rpcToggled = await rpc(harness, "toggle", { id: rpcTaskId, done: true });
check("RPC toggle → done", rpcToggled.parsed?.result?.value?.task?.status === "done", rpcToggled.parsed?.result?.value?.task?.status);
const rpcStatus = await rpc(harness, "status", {});
check("RPC status 计数", rpcStatus.parsed?.result?.value?.counts?.done >= 1, JSON.stringify(rpcStatus.parsed?.result?.value?.counts));
const rpcPolicy = await rpc(harness, "policy", { policy: "every-step" });
check("RPC policy 设默认", rpcPolicy.parsed?.result?.value?.default === "every-step", JSON.stringify(rpcPolicy.parsed?.result?.value));
const rpcSessionPolicy = await rpc(harness, "policy", { sessionId: "s1", policy: "stop" });
check("RPC policy 设逐会话", rpcSessionPolicy.parsed?.result?.value?.sessions?.[0]?.policy === "stop", JSON.stringify(rpcSessionPolicy.parsed?.result?.value?.sessions));
const rpcUnknown = await rpc(harness, "nope", {});
check("未知端点 → ok:false", rpcUnknown.parsed?.result?.ok === false && String(rpcUnknown.parsed?.result?.error?.message).includes("unknown endpoint"), JSON.stringify(rpcUnknown.parsed?.result?.error));
const rpcMismatch = await (async () => {
	const channel = harness.channels[0];
	const request = makeRequest({ method: "POST", url: "/dsh-task-lisk/list", body: JSON.stringify({ type: "client-request", method: "create", payload: {} }), headers: { "content-type": "application/json" } });
	const response = makeResponse();
	await channel.handler(request, response);
	return JSON.parse(response.body);
})();
check("method 与端点不符 → gateway/bad-request", rpcMismatch?.result?.error?.code === "gateway/bad-request", JSON.stringify(rpcMismatch?.result?.error?.code));
const notFound = await (async () => {
	const channel = harness.channels[0];
	const request = makeRequest({ method: "GET", url: "/dsh-task-lisk/list" });
	const response = makeResponse();
	await channel.handler(request, response);
	return response.statusCode;
})();
check("非 POST → 404", notFound === 404, String(notFound));
harness.setRequestRejection(403);
const rejected = await rpc(harness, "list", {});
check("connection 拒绝 → 403", rejected.status === 403, String(rejected.status));
harness.setRequestRejection(undefined);

// ---- D. todo_write 折叠（需求 3 上行）
const foldSession = { id: "s-fold", header: { cwd: "C:/ws/b" } };
await harness.emit("session/event", foldSession, { type: "todo/write", data: { todos: [{ content: "甲", status: "pending" }, { content: "乙", status: "in_progress" }] } });
const afterFold = await rpc(harness, "list", {});
const folded = afterFold.parsed.result.value.tasks.filter((task) => task.sessionId === "s-fold");
check("折叠出新任务并标来源会话", folded.length === 2 && folded.every((task) => task.source === "import" && task.tags.includes("todo-sync")), JSON.stringify(folded.map((task) => [task.title, task.status])));
check("折叠带工作区", folded.every((task) => task.workspace === "C:/ws/b"), JSON.stringify(folded.map((task) => task.workspace)));
await harness.emit("session/event", foldSession, { type: "todo/write", data: { todos: [{ content: "甲", status: "pending" }, { content: "乙", status: "in_progress" }] } });
const afterDuplicate = await rpc(harness, "list", {});
check("同签名重复事件不重复建", afterDuplicate.parsed.result.value.tasks.filter((task) => task.sessionId === "s-fold").length === 2, String(afterDuplicate.parsed.result.value.tasks.filter((task) => task.sessionId === "s-fold").length));
await harness.emit("session/event", foldSession, { type: "todo/write", data: { todos: [{ content: "甲", status: "completed" }, { content: "乙", status: "in_progress" }] } });
const afterStatus = await rpc(harness, "list", {});
const jia = afterStatus.parsed.result.value.tasks.find((task) => task.sessionId === "s-fold" && task.title === "甲");
check("折叠按同名改状态", jia?.status === "done" && jia?.completedAt !== null, `${jia?.status} completedAt=${jia?.completedAt}`);
await harness.emit("session/event", { id: "s-sub", header: { cwd: "C:/ws/b", origin: "subagent" } }, { type: "todo/write", data: { todos: [{ content: "子代理清单", status: "pending" }] } });
const afterSubagent = await rpc(harness, "list", {});
check("subagent 会话不折叠", afterSubagent.parsed.result.value.tasks.every((task) => task.title !== "子代理清单"), "应无「子代理清单」");
await harness.emit("session/event", { header: {} }, { type: "todo/write", data: { todos: [{ content: "无会话", status: "pending" }] } });
const afterNoSession = await rpc(harness, "list", {});
check("缺 sessionId 不折叠", afterNoSession.parsed.result.value.tasks.every((task) => task.title !== "无会话"), "应无「无会话」");

// 并发的两个不同签名：同一会话的导入必须串行，否则会看到同一份旧快照而重复建
const concurrentSession = { id: "s-race", header: { cwd: "C:/ws/c" } };
const firstFold = harness.emitSync("session/event", concurrentSession, { type: "todo/write", data: { todos: [{ content: "并发甲", status: "pending" }] } });
const secondFold = harness.emitSync("session/event", concurrentSession, { type: "todo/write", data: { todos: [{ content: "并发甲", status: "pending" }, { content: "并发乙", status: "pending" }] } });
await Promise.allSettled([...firstFold, ...secondFold]);
await harness.settle();
const afterRace = await rpc(harness, "list", {});
const raceRows = afterRace.parsed.result.value.tasks.filter((task) => task.sessionId === "s-race");
check("并发折叠不产生重复（同会话导入串行）", raceRows.length === 2 && raceRows.filter((task) => task.title === "并发甲").length === 1, JSON.stringify(raceRows.map((task) => task.title)));

// ---- E. pre-step 卡门 / 硬停（需求 6）
const gateAgent = makeAgent("g1", "g1");
const enterDecision = await (async () => {
	const [returned] = harness.emitSync("agent/pre-step", { agent: gateAgent, messages: [], turn: 1, step: 1, signal: makeSignal() }, async () => ({ kind: "enter", messages: [] }));
	return returned;
})();
check("step 1 永不卡门", enterDecision?.kind === "enter", JSON.stringify(enterDecision));
await rpc(harness, "policy", { sessionId: "g1", policy: "every-step" });
let nextCalled = false;
const parked = harness.emitSync("agent/pre-step", { agent: gateAgent, messages: [], turn: 1, step: 2, signal: makeSignal() }, async () => {
	nextCalled = true;
	return { kind: "enter", messages: [] };
});
await delay(5);
const gateStatus = await rpc(harness, "status", {});
check("every-step 在 step 2 挂起门", gateStatus.parsed.result.value.gates.includes("g1") && nextCalled === false, JSON.stringify(gateStatus.parsed.result.value.gates));
const releaseResult = await rpc(harness, "release", { sessionId: "g1", text: "先停一下，我要补充需求" });
const released = await parked[0];
check("release 放行挂起的门", releaseResult.parsed.result.value.released === true && nextCalled === true, JSON.stringify(releaseResult.parsed.result.value));
check("放行文字并入 decision.messages", released?.kind === "enter" && released.messages?.length === 1 && JSON.stringify(released.messages[0]).includes("先停一下"), `messages=${released?.messages?.length}`);
const idleRelease = await rpc(harness, "release", { sessionId: "g1" });
check("无门时 release → released:false", idleRelease.parsed.result.value.released === false, JSON.stringify(idleRelease.parsed.result.value));

// 硬停
await rpc(harness, "policy", { sessionId: "g2", policy: "stop" });
const stopAgent = makeAgent("g2", "g2");
const injected = [];
stopAgent.inject = (message) => injected.push(message);
const [stopReturned] = harness.emitSync("agent/pre-step", { agent: stopAgent, messages: [], turn: 1, step: 2, signal: makeSignal() }, async () => ({ kind: "enter", messages: [] }));
const stopDecision = await stopReturned;
check("policy=stop → {kind:'reject'}", stopDecision?.kind === "reject", JSON.stringify(stopDecision));
check("硬停前注入一条 notice", injected.length === 1 && JSON.stringify(injected[0]).includes("硬停"), `injected=${injected.length}`);
check("硬停不留下门", (await rpc(harness, "status", {})).parsed.result.value.gates.length === 0, JSON.stringify((await rpc(harness, "status", {})).parsed.result.value.gates));

// ---- F. tools/result 条件武装（「完成一个任务后暂停」）
await rpc(harness, "policy", { sessionId: "g3", policy: "on-subtask-done" });
const armAgent = makeAgent("g3", "g3");
const probeArm = async (label) => {
	const [returned] = harness.emitSync("agent/pre-step", { agent: armAgent, messages: [], turn: 1, step: 2, signal: makeSignal() }, async () => ({ kind: "enter", messages: [] }));
	await delay(5);
	const status = await rpc(harness, "status", {});
	const gated = status.parsed.result.value.gates.includes("g3");
	if (gated) await rpc(harness, "release", { sessionId: "g3" });
	await Promise.race([returned, delay(30)]);
	check(label, gated === true, `gated=${gated}`);
};
const probeNoArm = async (label) => {
	let nextCalled = false;
	const [returned] = harness.emitSync("agent/pre-step", { agent: armAgent, messages: [], turn: 1, step: 2, signal: makeSignal() }, async () => {
		nextCalled = true;
		return { kind: "enter", messages: [] };
	});
	await delay(5);
	const outcome = await Promise.race([returned.then(() => "settled"), delay(30).then(() => "hung")]);
	if (outcome === "hung") {
		// 卡住了说明被错误武装：放行以免后续断言连环悬空，但仍判 FAIL。
		await rpc(harness, "release", { sessionId: "g3" });
		await Promise.race([returned, delay(30)]);
	}
	check(label, nextCalled === true && outcome === "settled", `nextCalled=${nextCalled} outcome=${outcome}`);
};

await fireToolResult(harness, { agentId: "g3", argv: { action: "list" } });
await probeNoArm("只读 list 不武装「完成后暂停」");
await fireToolResult(harness, { agentId: "g3", argv: { action: "create", title: "无关任务" } });
await probeNoArm("create 不武装「完成后暂停」");
await fireToolResult(harness, { agentId: "g3", argv: { action: "complete", id: "whatever" } });
await probeArm("complete 后武装「完成后暂停」");
await fireToolResult(harness, { agentId: "g3", argv: { action: "complete", id: "whatever", status: "todo" } });
await probeNoArm("取消完成不武装");
await fireToolResult(harness, { agentId: "g3", argv: { action: "update", id: "x", status: "done" } });
await probeArm("update status=done 后武装");
await fireToolResult(harness, { agentId: "g3", argv: { action: "complete", id: "x" }, result: { isError: true } });
await probeNoArm("失败结果不武装");
await fireToolResult(harness, { agentId: "g3", argv: { action: "complete", id: "x" }, parent: { callId: "p" } });
await probeNoArm("子派发（parent）不武装");

// todo_write：只有「新变成 completed」才武装
const todoExec = (todos) => ({
	name: "todo_write",
	callId: "call_t",
	rootCallId: "call_t",
	agent: armAgent,
	arguments: { todos },
	signal: { aborted: false }
});
await harness.emit("tools/result", todoExec([{ content: "甲", status: "in_progress" }]), { isError: false });
await probeNoArm("todo_write 无完成项不武装");
await harness.emit("tools/result", todoExec([{ content: "甲", status: "completed" }]), { isError: false });
await probeArm("todo_write 新完成项后武装");
await harness.emit("tools/result", todoExec([{ content: "甲", status: "completed" }]), { isError: false });
await probeNoArm("todo_write 重复同一完成态不武装");

// agent.id 与 session.id 不同时，release 仍要能放行（键不能只认 agentId）
const splitAgent = makeAgent("agent-A", "session-B");
await rpc(harness, "policy", { sessionId: "session-B", policy: "every-step" });
const splitParked = harness.emitSync("agent/pre-step", { agent: splitAgent, messages: [], turn: 1, step: 2, signal: makeSignal() }, async () => ({ kind: "enter", messages: [] }));
await delay(5);
const splitRelease = await rpc(harness, "release", { sessionId: "session-B" });
const splitDecision = await splitParked[0];
check("agent.id≠session.id 时按 sessionId 也能放行", splitRelease.parsed.result.value.released === true && splitDecision?.kind === "enter", `released=${splitRelease.parsed.result.value.released} decision=${splitDecision?.kind}`);

// agent/disposed 必须把挂起的门解开，不能永远悬着
const disposeAgent = makeAgent("g9", "g9");
await rpc(harness, "policy", { sessionId: "g9", policy: "every-step" });
const orphan = harness.emitSync("agent/pre-step", { agent: disposeAgent, messages: [], turn: 1, step: 2, signal: makeSignal() }, async () => ({ kind: "enter", messages: [] }));
await delay(5);
await harness.emit("agent/disposed", { agent: disposeAgent });
const orphanSettled = await Promise.race([orphan[0].then(() => "settled"), delay(50).then(() => "hung")]);
check("agent/disposed 解开挂起的门（不留悬空 await）", orphanSettled === "settled", orphanSettled);
check("disposed 后门已清空", (await rpc(harness, "status", {})).parsed.result.value.gates.length === 0, JSON.stringify((await rpc(harness, "status", {})).parsed.result.value.gates));

// turn-stopping 清掉武装标记（payload 融合了 agent）
await rpc(harness, "policy", { sessionId: "g4", policy: "on-subtask-done" });
const stoppingAgent = makeAgent("g4", "g4");
await fireToolResult(harness, { agentId: "g4", argv: { action: "complete", id: "x" } });
await harness.emit("agent/turn-stopping", { turn: 1, signal: makeSignal(), agent: stoppingAgent });
let stoppingNext = false;
await harness.emit("agent/pre-step", { agent: stoppingAgent, messages: [], turn: 2, step: 2, signal: makeSignal() }, async () => {
	stoppingNext = true;
	return { kind: "enter", messages: [] };
});
check("turn-stopping 清掉武装（下一回合 step2 不再卡）", stoppingNext === true, `nextCalled=${stoppingNext}`);

// ---- G. Config.defaultPolicy 真的生效
const configHarness = createHarness();
apply(configHarness.ctx, { defaultPolicy: "every-step" });
await configHarness.settle();
const configList = await rpc(configHarness, "list", {});
check("Config.defaultPolicy 落到领域默认策略", configList.parsed.result.value.policy.default === "every-step", configList.parsed.result.value.policy.default);
await rpc(configHarness, "policy", { policy: "off" });
await configHarness.settle();
const afterUserOff = await rpc(configHarness, "list", {});
check("用户改成 off 后不被 Config 覆盖", afterUserOff.parsed.result.value.policy.default === "off", afterUserOff.parsed.result.value.policy.default);
const reopenHarness = createHarness();
apply(reopenHarness.ctx, { defaultPolicy: "every-step" });
await reopenHarness.settle();
const reopenList = await rpc(reopenHarness, "list", {});
check("重开新领域仍应用 Config 默认", reopenList.parsed.result.value.policy.default === "every-step", reopenList.parsed.result.value.policy.default);
check("全程无 logger.warn", harness.warnings.length === 0 && configHarness.warnings.length === 0 && reopenHarness.warnings.length === 0, [...harness.warnings, ...configHarness.warnings, ...reopenHarness.warnings].slice(0, 3).join(" | "));

console.log(`\n${passed}/${passed + failures.length} 通过`);
if (failures.length > 0) {
	console.log("\n失败项：");
	for (const failure of failures) console.log(`  - ${failure}`);
	process.exitCode = 1;
}