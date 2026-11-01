/**
 * dsh-task-lisk / Host 半身。
 *
 * 一个进程级、跨工作区、跨会话的任务看板：
 *  - 权威数据落在 ctx.storageDomain 的 `task_lisk` 领域（全局 KV，重启保留；领域名与表名受
 *    UNIT_NAME_RE `/^[a-z][a-z0-9_]*$/` 约束，**不能带连字符**——这正是插件 id 叫
 *    `task-lisk` 而领域名必须叫 `task_lisk` 的原因）；
 *  - 浏览器半身（lib/client.js）挂在 sidebar.panellist + main，经 /dsh-task-lisk RPC 通道读写；
 *  - `task_lisk` 工具让 agent 自己读写看板（需求 3 下行）；
 *  - 折叠官方 `todo_write` 的 `todo/write` 会话事件，把 agent 会话内清单同步成看板任务（需求 3 上行）；
 *  - `agent/pre-step` 卡门 + `{kind:'reject'}` 硬停 + `tools/result` 条件武装，实现条件化的暂停/停止（需求 6）。
 *
 * @module dsh-task-lisk
 */
import z from "@deepseek-ai/schemastery";
import { z as zod } from "zod";
import { defineDomain, domainTable } from "@deepseek-ai/dsh-storage-domain";
import { defineTool } from "@deepseek-ai/dsh-tools";
import { createUserMessage } from "@deepseek-ai/dsh-llm";

/** 插件名即配置项 id。 */
export const name = "task-lisk";
/** 需要宿主服务：工具注册表 + 领域存储。 */
export const inject = ["tools", "storageDomain"];
/** 宿主侧配置（schemastery）。 */
export const Config = z.object({
	enabled: z.boolean().default(true),
	autoImportTodos: z.boolean().default(true),
	defaultPolicy: z.string().default("off"),
	maxDepth: z.number().step(1).min(0).max(4).default(2)
});

/** 任务状态。 */
const STATUSES = ["todo", "doing", "done"];
/** 任务优先级。 */
const PRIORITIES = ["low", "normal", "high", "urgent"];
/** 周期重复：任务自身状态机，完成即滚到下一周期（需求 4）。 */
const REPEATS = ["none", "daily", "weekly", "monthly"];
/** 暂停策略：off / 每步暂停 / 子任务完成后暂停 / 硬停。 */
const POLICIES = ["off", "every-step", "on-subtask-done", "stop"];
/** 请求体上限（本插件载荷极小）。 */
const MAX_BODY_BYTES = 4 * 1024 * 1024;
/** RPC 通道前缀。 */
const CHANNEL = "/dsh-task-lisk";

/** 任务记录 schema（zod，领域层校验用）。 */
const taskSchema = zod.object({
	id: zod.string(),
	title: zod.string(),
	note: zod.string(),
	status: zod.string(),
	priority: zod.string(),
	parentId: zod.string().nullable(),
	depth: zod.number(),
	order: zod.number(),
	dueAt: zod.number().nullable(),
	repeat: zod.string(),
	tags: zod.array(zod.string()),
	sessionId: zod.string().nullable(),
	agentId: zod.string().nullable(),
	workspace: zod.string().nullable(),
	origin: zod.string().nullable(),
	source: zod.string(),
	rollCount: zod.number(),
	createdAt: zod.number(),
	updatedAt: zod.number(),
	completedAt: zod.number().nullable(),
	lastCompletedAt: zod.number().nullable()
});

/**
 * 领域全局状态：默认暂停策略 + 逐会话覆盖。
 * `configDefaultApplied` 是「本插件 Config.defaultPolicy 是否已落盘过一次」的标记：
 * 没有它就无法区分「领域从没被人写过」与「用户自己选了 off」，会把用户的显式选择
 * 在每次重启后又盖回成 Config 的值。
 */
const settingsSchema = zod.object({
	defaultPolicy: zod.string(),
	sessions: zod.array(zod.object({
		sessionId: zod.string(),
		policy: zod.string()
	})),
	configDefaultApplied: zod.boolean()
});

/** 领域声明：名称、版本、表与全局 schema。 */
const boardDomain = defineDomain({
	name: "task_lisk",
	version: 1,
	tables: { tasks: domainTable(taskSchema) },
	global: {
		schema: settingsSchema,
		initial: {
			defaultPolicy: "off",
			sessions: [],
			configDefaultApplied: false
		}
	}
});

/** 防御式读取会话标识（DSH 既有形态 `id` / `sessionId`）。 */
function sessionIdOf(raw) {
	const v = raw?.id ?? raw?.sessionId;
	return typeof v === "string" ? v.trim() : "";
}
/** 防御式读取会话头（`cwd` 即工作区路径）。 */
function headerOf(session) {
	const header = session?.header ?? {};
	return {
		workspace: typeof header.cwd === "string" ? header.cwd : null,
		origin: typeof header.origin === "string" ? header.origin : null
	};
}
/** 新任务 id。 */
function newId() {
	return `tl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
/** 宽松取字符串。 */
function asString(value, fallback = "") {
	return typeof value === "string" ? value.trim() : fallback;
}
/** 枚举收敛。 */
function oneOf(value, allowed, fallback) {
	return typeof value === "string" && allowed.includes(value) ? value : fallback;
}
/** 归一化截止时间：ISO 字符串或 epoch 毫秒都接受。 */
function normalizeDue(value) {
	if (typeof value === "number" && Number.isFinite(value)) return value;
	if (typeof value === "string" && value.trim() !== "") {
		const parsed = Date.parse(value);
		if (Number.isFinite(parsed)) return parsed;
	}
	return null;
}
/** 下一个周期时间点（monthly 做月末夹取，避免 1/31 → 3/3 漂移）。 */
function nextDue(from, repeat) {
	const base = new Date(from ?? Date.now());
	if (repeat === "daily") base.setDate(base.getDate() + 1);
	else if (repeat === "weekly") base.setDate(base.getDate() + 7);
	else if (repeat === "monthly") {
		const day = base.getDate();
		base.setDate(1);
		base.setMonth(base.getMonth() + 1);
		const lastDay = new Date(base.getFullYear(), base.getMonth() + 1, 0).getDate();
		base.setDate(Math.min(day, lastDay));
	}
	return base.getTime();
}
/** 造一条注入给模型的 notice 消息。 */
function notice(text, summary = "任务看板") {
	return createUserMessage({
		content: [{ type: "text", text }],
		source: {
			kind: "plugin:task-lisk",
			form: "notice",
			summary
		}
	});
}
/** 成功信封。 */
function ok(value) {
	return { ok: true, value };
}
/** 失败信封。 */
function rpcError(message) {
	return {
		ok: false,
		error: {
			code: "internal",
			message,
			details: {}
		}
	};
}
/** 读请求体。 */
async function readBody(req) {
	const chunks = [];
	let size = 0;
	for await (const chunk of req) {
		size += chunk.length;
		if (size > MAX_BODY_BYTES) throw new Error("payload too large");
		chunks.push(chunk);
	}
	return Buffer.concat(chunks).toString("utf8");
}
/** 回写连接层信封。 */
function reply(res, rpcId, result) {
	const body = JSON.stringify({
		type: "server-response",
		rpcId,
		result
	});
	res.writeHead(200, { "content-type": "application/json" });
	res.end(body);
}
/** 处理一次 HTTP 请求：信任判定 → 信封校验 → 端点分发 → 回写。 */
async function serveHttp(connection, handler, req, res) {
	const rejection = connection.requestRejection(req);
	if (rejection !== undefined) {
		res.writeHead(rejection);
		res.end(rejection === 401 ? "unauthorized" : "forbidden");
		return;
	}
	if (req.method !== "POST") {
		res.writeHead(404);
		res.end("not found");
		return;
	}
	const pathname = new URL(req.url ?? "/", "http://localhost").pathname;
	const prefix = `${CHANNEL}/`;
	if (!pathname.startsWith(prefix)) {
		res.writeHead(404);
		res.end("not found");
		return;
	}
	const endpoint = pathname.slice(prefix.length);
	if (!/^[A-Za-z0-9_$.-]+$/.test(endpoint)) {
		res.writeHead(404);
		res.end("not found");
		return;
	}
	let raw;
	try {
		raw = await readBody(req);
	} catch (error) {
		res.writeHead(413);
		res.end("payload too large");
		return;
	}
	let message;
	try {
		message = JSON.parse(raw);
	} catch (error) {
		res.writeHead(400);
		res.end("body is not JSON");
		return;
	}
	const rpcId = typeof message?.rpcId === "string" ? message.rpcId : "invalid-request";
	if (message?.type !== "client-request" || message?.method !== endpoint) {
		reply(res, rpcId, {
			ok: false,
			error: {
				code: "gateway/bad-request",
				message: "invalid client-request message",
				details: {}
			}
		});
		return;
	}
	let result;
	try {
		result = await handler(endpoint, message.payload);
	} catch (error) {
		result = rpcError(error instanceof Error ? error.message : String(error));
	}
	reply(res, rpcId, result);
}
/** 挂载 RPC 通道；webServer 或 connection 缺席时只是不挂载，其余功能不受影响。 */
function mountRpc(ctx, handler) {
	ctx.inject(["connection", "webServer"], (scope) => {
		scope.effect(() => scope.webServer.register({
			kind: "prefix",
			path: CHANNEL,
			handler: (req, res) => serveHttp(scope.connection, handler, req, res)
		}), `${CHANNEL}: rpc channel`);
	});
}

/** 供冒烟测试与后续维护使用的内部函数（非插件公开面）。 */
export const __internals = {
	nextDue,
	normalizeDue,
	sessionIdOf,
	headerOf,
	newId,
	STATUSES,
	PRIORITIES,
	REPEATS,
	POLICIES
};

/**
 * 注册领域、工具、RPC 通道与会话事件折叠。
 * @param ctx - 插件上下文（带 tools 与 storageDomain 服务）。
 * @param config - 宿主侧配置。
 */
export function apply(ctx, config = {}) {
	const cfg = {
		enabled: true,
		autoImportTodos: true,
		defaultPolicy: "off",
		maxDepth: 2,
		...config
	};
	/**
	 * 「等人类放行」的卡门。键是 agent id（DSH 里根 agent 的 id 通常就是会话 id，
	 * 见 dsh-pause 直接用 `payload.agent.id` 当会话键），同时记录 sessionId 以便
	 * 放行请求按任一标识命中 —— 不把「agentId === sessionId」当成必须成立的前提。
	 */
	const gates = new Map();
	/**
	 * 「完成一个任务后暂停」的武装标记。**agentId 与 sessionId 都放**，
	 * 因为武装点（tools/result）与判定点（agent/pre-step）拿到的标识不一定同源。
	 */
	const armed = new Set();
	/** sessionId → 上次已导入的 todo 指纹，避免抖动改写。 */
	const seenTodos = new Map();
	/** sessionId → 该会话上一次已完成的 todo 文本集合（判定「新完成」用）。 */
	const completedTodos = new Map();
	/** sessionId → 该会话的导入串行链（并发折叠不得各自看到旧快照而重复建）。 */
	const importChains = new Map();

	/** 同时按 agent 与会话两个标识武装。 */
	const armGate = (agentId, sessionId) => {
		if (agentId !== "") armed.add(agentId);
		if (sessionId !== "" && sessionId !== agentId) armed.add(sessionId);
	};
	/** 同时清掉两个标识的武装。 */
	const disarm = (agentId, sessionId) => {
		if (agentId !== "") armed.delete(agentId);
		if (sessionId !== "" && sessionId !== agentId) armed.delete(sessionId);
	};
	/** 该标识是否已武装。 */
	const isArmed = (agentId, sessionId) => armed.has(agentId) || (sessionId !== "" && sessionId !== agentId && armed.has(sessionId));
	const ready = ctx.storageDomain.open(boardDomain);

	ctx.effect(async () => {
		const domain = await ready;
		let cleanup;
		try {
			cleanup = ctx.effect(() => () => domain.close(), "task-lisk: close domain");
		} catch (error) {
			await domain.close();
			throw error;
		}
		const tasks = domain.table("tasks");
		const global = domain.global;
		/**
		 * 把 `Config.defaultPolicy` 落到领域默认值上 —— **只在领域还没被人碰过时**。
		 * 判据：默认策略仍是 spec 的 initial（"off"）且没有逐会话覆盖。落一次后写
		 * `configDefaultApplied`，之后用户的显式选择永远优先，重启也不会被 Config 盖回。
		 */
		const applyConfiguredDefault = async () => {
			const state = global.get() ?? {
				defaultPolicy: "off",
				sessions: [],
				configDefaultApplied: false
			};
			if (state.configDefaultApplied === true) return;
			const pristine = state.defaultPolicy === "off" && (state.sessions ?? []).length === 0;
			const desired = pristine ? oneOf(cfg.defaultPolicy, POLICIES, state.defaultPolicy) : state.defaultPolicy;
			await global.set({
				...state,
				defaultPolicy: desired,
				configDefaultApplied: true
			});
		};
		await applyConfiguredDefault();
		const all = () => [...tasks.entries()].map(([, record]) => record);
		const find = (id) => (typeof id === "string" && id !== "" ? tasks.get(id) : undefined);
		const sorted = (list) => list.slice().sort((a, b) => a.depth - b.depth || a.order - b.order || a.createdAt - b.createdAt);
		const toWire = (t) => ({
			id: t.id,
			title: t.title,
			note: t.note,
			status: t.status,
			priority: t.priority,
			parentId: t.parentId,
			depth: t.depth,
			order: t.order,
			dueAt: t.dueAt,
			repeat: t.repeat,
			tags: t.tags,
			sessionId: t.sessionId,
			workspace: t.workspace,
			source: t.source,
			rollCount: t.rollCount,
			createdAt: t.createdAt,
			updatedAt: t.updatedAt,
			completedAt: t.completedAt,
			lastCompletedAt: t.lastCompletedAt
		});
		const put = async (record) => {
			await tasks.put(record.id, record);
			return record;
		};
		const patch = async (record, changes) => put({
			...record,
			...changes,
			updatedAt: Date.now()
		});
		const policyState = () => global.get() ?? {
			defaultPolicy: cfg.defaultPolicy,
			sessions: []
		};
		const policyOf = (sessionId) => {
			const state = policyState();
			const row = (state.sessions ?? []).find((entry) => entry.sessionId === sessionId);
			return oneOf(row?.policy ?? state.defaultPolicy, POLICIES, "off");
		};
		const setPolicyFor = async (sessionId, policy) => {
			const state = policyState();
			const sessions = (state.sessions ?? []).filter((entry) => entry.sessionId !== sessionId);
			sessions.push({
				sessionId,
				policy
			});
			await global.set({
				...state,
				sessions
			});
		};
		const setDefaultPolicy = async (policy) => {
			const state = policyState();
			await global.set({
				...state,
				defaultPolicy: policy
			});
		};

		/** 新建任务（含子任务层级校验）。 */
		const createTask = async (input, actor) => {
			const title = asString(input?.title);
			if (title === "") throw new Error("title is required");
			const parentId = asString(input?.parentId) || null;
			const parent = parentId === null ? undefined : find(parentId);
			if (parentId !== null && parent === undefined) throw new Error(`parent task ${parentId} not found`);
			const depth = parent === undefined ? 0 : parent.depth + 1;
			if (depth > cfg.maxDepth) throw new Error(`subtask depth limit is ${cfg.maxDepth}`);
			const now = Date.now();
			const order = all().filter((t) => t.parentId === parentId).reduce((max, t) => Math.max(max, t.order), 0) + 10;
			return put({
				id: newId(),
				title,
				note: asString(input?.note),
				status: oneOf(input?.status, STATUSES, "todo"),
				priority: oneOf(input?.priority, PRIORITIES, "normal"),
				parentId,
				depth,
				order,
				dueAt: normalizeDue(input?.dueAt),
				repeat: oneOf(input?.repeat, REPEATS, "none"),
				tags: Array.isArray(input?.tags) ? input.tags.filter((tag) => typeof tag === "string") : [],
				sessionId: asString(input?.sessionId) || actor.sessionId || null,
				agentId: asString(input?.agentId) || actor.agentId || null,
				workspace: asString(input?.workspace) || actor.workspace || null,
				origin: actor.origin ?? null,
				source: oneOf(input?.source, ["user", "agent", "import"], actor.source ?? "user"),
				rollCount: 0,
				createdAt: now,
				updatedAt: now,
				completedAt: null,
				lastCompletedAt: null
			});
		};
		/** 勾选/取消勾选；周期任务完成即滚到下一周期。 */
		const completeTask = async (record, done) => {
			const now = Date.now();
			if (!done) return patch(record, {
				status: "todo",
				completedAt: null
			});
			if (record.repeat !== "none") return patch(record, {
				status: "todo",
				completedAt: null,
				lastCompletedAt: now,
				rollCount: record.rollCount + 1,
				dueAt: nextDue(record.dueAt ?? now, record.repeat)
			});
			return patch(record, {
				status: "done",
				completedAt: now,
				lastCompletedAt: now
			});
		};
		/**
		 * 统一的「改状态」语义：`done` 一律走 completeTask（写完成时间、周期任务滚动），
		 * 其余状态清空 completedAt。RPC 与工具必须共用它，否则 `update status=done`
		 * 会把任务标成已完成却不写 completedAt、也不滚动周期。
		 */
		const setStatusOf = async (record, status) => status === "done" ? completeTask(record, true) : patch(record, {
			status,
			completedAt: null
		});
		/** 删除任务；默认连同子孙。 */
		const removeTask = async (id, cascade) => {
			const target = find(id);
			if (target === undefined) throw new Error(`task ${id} not found`);
			const doomed = [target];
			if (cascade !== false) {
				let frontier = [target.id];
				while (frontier.length > 0) {
					const kids = all().filter((t) => t.parentId !== null && frontier.includes(t.parentId));
					frontier = kids.map((t) => t.id);
					doomed.push(...kids);
				}
			}
			for (const record of doomed) await tasks.delete(record.id);
			return doomed.length;
		};
		/** 把会话内 todo 清单合并进看板（同名任务改写状态，不重复建）。 */
		const importTodos = async (sessionId, meta, todos) => {
			let imported = 0;
			let order = all().filter((t) => t.parentId === null && t.sessionId === sessionId).reduce((max, t) => Math.max(max, t.order), 0);
			for (const todo of todos) {
				const content = asString(todo?.content);
				if (content === "") continue;
				const status = todo?.status === "completed" ? "done" : todo?.status === "in_progress" ? "doing" : "todo";
				const existing = all().find((t) => t.sessionId === sessionId && t.title === content && t.parentId === null);
				if (existing !== undefined) {
					if (existing.status !== status) {
						const stampedAt = Date.now();
						await patch(existing, status === "done" ? {
							status,
							completedAt: existing.completedAt ?? stampedAt,
							lastCompletedAt: stampedAt
						} : {
							status,
							completedAt: null
						});
					}
					continue;
				}
				const now = Date.now();
				order += 10;
				await put({
					id: newId(),
					title: content,
					note: "",
					status,
					priority: "normal",
					parentId: null,
					depth: 0,
					order,
					dueAt: null,
					repeat: "none",
					tags: ["todo-sync"],
					sessionId,
					agentId: null,
					workspace: meta.workspace,
					origin: meta.origin,
					source: "import",
					rollCount: 0,
					createdAt: now,
					updatedAt: now,
					completedAt: status === "done" ? now : null,
					lastCompletedAt: null
				});
				imported++;
			}
			return imported;
		};
		/**
		 * 按会话串行执行导入。领域层的 `put` 是「先落后端、后改内存」的异步链，
		 * 若两次导入并发进入，后者会在前者的 put 落内存之前读到旧快照，于是把同一
		 * 条 todo 再建一遍。会话事件折叠是 fire-and-forget，串行化是必需的。
		 */
		const runImport = (sessionId, meta, todos) => {
			const previous = importChains.get(sessionId) ?? Promise.resolve();
			const next = previous.then(() => importTodos(sessionId, meta, todos), () => importTodos(sessionId, meta, todos));
			importChains.set(sessionId, next.then(() => {}, () => {}));
			return next;
		};
		/**
		 * 放行一扇卡门：按 agentId 或 sessionId 任一命中（两个标识不保证相等）。
		 * `text` 是人类随放行留下的补充说明，会由 pre-step 并进本步的 messages。
		 */
		const releaseGate = (key, text = "") => {
			if (key === "") return false;
			let hit = "";
			for (const [agentId, gate] of gates) {
				if (agentId === key || gate.sessionId === key) {
					hit = agentId;
					break;
				}
			}
			if (hit === "") return false;
			const gate = gates.get(hit);
			gates.delete(hit);
			disarm(hit, gate.sessionId);
			try {
				gate.resolve(typeof text === "string" ? text : "");
			} catch (error) {
				ctx.logger.warn(`task-lisk: release failed: ${String(error)}`);
			}
			return true;
		};

		// ---- RPC 端点：浏览器半身的全部读写入口
		const handler = async (endpoint, payload) => {
			const input = payload ?? {};
			try {
				switch (endpoint) {
					case "list": {
						const state = policyState();
						return ok({
							tasks: sorted(all()).map(toWire),
							policy: {
								default: state.defaultPolicy,
								sessions: state.sessions ?? []
							},
							config: {
								maxDepth: cfg.maxDepth,
								autoImportTodos: cfg.autoImportTodos,
								enabled: cfg.enabled
							}
						});
					}
					case "create":
						return ok({ task: toWire(await createTask(input, { source: "user" })) });
					case "update": {
						const record = find(input.id);
						if (record === undefined) throw new Error(`task ${input.id} not found`);
						const want = input.patch ?? {};
						const changes = {};
						if (want.title !== undefined) {
							const title = asString(want.title);
							if (title === "") throw new Error("title must be non-empty");
							changes.title = title;
						}
						if (want.note !== undefined) changes.note = asString(want.note);
						if (want.priority !== undefined) changes.priority = oneOf(want.priority, PRIORITIES, record.priority);
						if (want.status !== undefined) changes.status = oneOf(want.status, STATUSES, record.status);
						if (want.dueAt !== undefined) changes.dueAt = normalizeDue(want.dueAt);
						if (want.repeat !== undefined) changes.repeat = oneOf(want.repeat, REPEATS, record.repeat);
						if (want.tags !== undefined) changes.tags = Array.isArray(want.tags) ? want.tags.filter((tag) => typeof tag === "string") : record.tags;
						if (want.sessionId !== undefined) changes.sessionId = asString(want.sessionId) || null;
						const patched = Object.keys(changes).length > 0 ? await patch(record, changes) : record;
						const finalRecord = want.status === undefined ? patched : await setStatusOf(patched, oneOf(want.status, STATUSES, patched.status));
						return ok({ task: toWire(finalRecord) });
					}
					case "toggle": {
						const record = find(input.id);
						if (record === undefined) throw new Error(`task ${input.id} not found`);
						const done = input.done === undefined ? record.status !== "done" : input.done === true;
						return ok({ task: toWire(await completeTask(record, done)) });
					}
					case "setStatus": {
						const record = find(input.id);
						if (record === undefined) throw new Error(`task ${input.id} not found`);
						const status = oneOf(input.status, STATUSES, record.status);
						return ok({ task: toWire(await setStatusOf(record, status)) });
					}
					case "remove":
						return ok({ removed: await removeTask(input.id, input.cascade) });
					case "policy": {
						if (asString(input.sessionId) !== "") await setPolicyFor(asString(input.sessionId), oneOf(input.policy, POLICIES, "off"));
						else await setDefaultPolicy(oneOf(input.policy, POLICIES, "off"));
						const state = policyState();
						return ok({
							default: state.defaultPolicy,
							sessions: state.sessions ?? []
						});
					}
					case "release": {
						const key = asString(input.sessionId) || asString(input.agentId);
						return ok({
							released: releaseGate(key, asString(input.text)),
							armed: [...armed]
						});
					}
					case "import": {
						const sessionId = asString(input.sessionId);
						if (sessionId === "") throw new Error("sessionId is required");
						const meta = {
							workspace: asString(input.workspace) || null,
							origin: asString(input.origin) || null
						};
						return ok({ imported: await runImport(sessionId, meta, Array.isArray(input.todos) ? input.todos : []) });
					}
					case "status": {
						const counts = {
							total: tasks.size,
							open: all().filter((t) => t.status !== "done").length,
							done: all().filter((t) => t.status === "done").length
						};
						return ok({
							counts,
							gates: [...gates.keys()],
							armed: [...armed],
							...policyState()
						});
					}
					default: return rpcError(`unknown endpoint ${endpoint}`);
				}
			} catch (error) {
				return rpcError(error instanceof Error ? error.message : String(error));
			}
		};
		mountRpc(ctx, handler);

		// ---- 需求 3（agent 侧读写）：task_lisk 工具
		ctx.tools.register(defineTool({
			name: "task_lisk",
			description: "读写跨会话的全局任务看板（dsh-task-lisk）。action=list 列任务（含子任务与周期）；create 新建，带 parentId 即建子任务；update 改标题/优先级/状态/截止时间/周期；complete 勾选完成（daily/weekly/monthly 任务完成后自动滚到下一周期）；remove 删除（默认连同子任务）。用户在侧边栏「任务」面板中看到的就是这份列表。",
			parameters: {
				action: {
					type: "string",
					required: true,
					enum: ["list", "create", "update", "complete", "remove"],
					description: "要执行的动作。"
				},
				id: {
					type: "string",
					description: "任务 id（update/complete/remove 必填）。"
				},
				title: {
					type: "string",
					description: "任务标题（create 必填，update 可改）。"
				},
				parentId: {
					type: "string",
					description: "父任务 id，给出即建子任务（create）。"
				},
				priority: {
					type: "string",
					enum: [...PRIORITIES],
					description: "优先级：low | normal | high | urgent。"
				},
				status: {
					type: "string",
					enum: [...STATUSES],
					description: "状态：todo | doing | done。"
				},
				dueAt: {
					type: "string",
					description: "截止时间，ISO 8601 字符串或 epoch 毫秒。"
				},
				repeat: {
					type: "string",
					enum: [...REPEATS],
					description: "周期重复：none | daily | weekly | monthly。"
				},
				note: {
					type: "string",
					description: "备注。"
				},
				includeDone: {
					type: "boolean",
					description: "list 时是否包含已完成任务（默认 true）。"
				},
				cascade: {
					type: "boolean",
					description: "remove 时是否连同子任务（默认 true）。"
				}
			},
			output: {
				schema: {
					type: "object",
					additionalProperties: false,
					properties: {
						summary: {
							type: "string",
							required: true
						},
						tasks: {
							type: "array",
							required: true,
							items: {
								type: "object",
								additionalProperties: false,
								properties: {
									id: {
										type: "string",
										required: true
									},
									title: {
										type: "string",
										required: true
									},
									status: {
										type: "string",
										required: true
									},
									priority: {
										type: "string",
										required: true
									},
									parentId: {
										type: "string",
										required: true
									},
									dueAt: {
										type: "string",
										required: true
									},
									repeat: {
										type: "string",
										required: true
									},
									sessionId: {
										type: "string",
										required: true
									}
								}
							}
						}
					}
				},
				render: (_args, value) => [{
					type: "text",
					text: value.summary
				}]
			},
			async execute(args, exec) {
				const actor = {
					sessionId: sessionIdOf(exec.agent?.session),
					agentId: exec.agent === undefined ? "" : String(exec.agent.id ?? ""),
					workspace: headerOf(exec.agent?.session).workspace,
					origin: headerOf(exec.agent?.session).origin,
					source: "agent"
				};
				const render = (records) => records.map((t) => ({
					id: t.id,
					title: t.title,
					status: t.status,
					priority: t.priority,
					parentId: t.parentId ?? "",
					dueAt: t.dueAt === null ? "" : new Date(t.dueAt).toISOString(),
					repeat: t.repeat,
					sessionId: t.sessionId ?? ""
				}));
				if (args.action === "list") {
					const includeDone = args.includeDone !== false;
					const records = sorted(all()).filter((t) => includeDone || t.status !== "done");
					const open = records.filter((t) => t.status !== "done").length;
					return {
						summary: `任务看板共 ${records.length} 条（未完成 ${open} 条）：\n${records.map((t) => `- [${t.status}] ${t.parentId === null ? "" : "└ "}${t.title} (${t.id}) ${t.priority}${t.dueAt === null ? "" : ` due=${new Date(t.dueAt).toISOString().slice(0, 10)}`}${t.repeat === "none" ? "" : ` repeat=${t.repeat}`}${typeof t.sessionId === "string" && t.sessionId !== "" ? ` sid=${t.sessionId.slice(0, 8)}` : ""}`).join("\n") || "（空）"}`,
						tasks: render(records)
					};
				}
				if (args.action === "create") {
					const record = await createTask(args, actor);
					return {
						summary: `已创建任务 ${record.id}：${record.title}（parent=${record.parentId ?? "root"}, priority=${record.priority}, repeat=${record.repeat}）`,
						tasks: render([record])
					};
				}
				const target = find(args.id);
				if (target === undefined) throw new Error(`task ${args.id} not found`);
				if (args.action === "update") {
					const changes = {};
					if (args.title !== undefined) {
						const title = asString(args.title);
						if (title === "") throw new Error("title must be non-empty");
						changes.title = title;
					}
					if (args.priority !== undefined) changes.priority = oneOf(args.priority, PRIORITIES, target.priority);
					if (args.dueAt !== undefined) changes.dueAt = normalizeDue(args.dueAt);
					if (args.repeat !== undefined) changes.repeat = oneOf(args.repeat, REPEATS, target.repeat);
					if (args.note !== undefined) changes.note = asString(args.note);
					const patched = Object.keys(changes).length > 0 ? await patch(target, changes) : target;
					const record = args.status === undefined ? patched : await setStatusOf(patched, oneOf(args.status, STATUSES, patched.status));
					return {
						summary: `已更新任务 ${record.id}：${record.title}（status=${record.status}, priority=${record.priority}, repeat=${record.repeat}）`,
						tasks: render([record])
					};
				}
				if (args.action === "complete") {
					const done = args.status === undefined ? true : args.status === "done";
					const record = await completeTask(target, done);
					return {
						summary: done ? `已完成任务 ${record.id}：${record.title}${record.repeat === "none" ? "" : `；周期 ${record.repeat} 已滚到 ${record.dueAt === null ? "无截止" : new Date(record.dueAt).toISOString().slice(0, 10)}`}` : `已取消完成 ${record.id}：${record.title}`,
						tasks: render([record])
					};
				}
				if (args.action === "remove") {
					const removed = await removeTask(target.id, args.cascade);
					return {
						summary: `已删除任务 ${target.id}：${target.title}（共删除 ${removed} 条）`,
						tasks: []
					};
				}
				throw new Error(`unknown action ${args.action}`);
			},
			presentCall: (args) => ({
				card: "generic",
				title: `任务看板：${args.action}`,
				kind: "other",
				rawInput: args
			})
		}));

		// ---- 需求 3（上行同步）：折叠官方 todo_write 的快照事件
		if (cfg.autoImportTodos) {
			ctx.on("session/event", (session, event) => {
				if (event?.type !== "todo/write") return;
				const todos = Array.isArray(event?.data?.todos) ? event.data.todos : [];
				const sessionId = sessionIdOf(session);
				if (sessionId === "") return;
				const meta = headerOf(session);
				if (meta.origin === "subagent") return;
				const signature = todos.map((todo) => `${todo?.status ?? ""}:${todo?.content ?? ""}`).join("|");
				if (seenTodos.get(sessionId) === signature) return;
				seenTodos.set(sessionId, signature);
				void runImport(sessionId, meta, todos).catch((error) => {
					ctx.logger.warn(`task-lisk: todo import failed: ${String(error)}`);
				});
			});
		}

		// ---- 需求 6（条件化执行/停止）
		ctx.on("agent/pre-step", async (payload, next) => {
			if (!cfg.enabled) return next();
			const agentId = payload.agent === undefined ? "" : String(payload.agent.id ?? "");
			const sessionId = sessionIdOf(payload.agent?.session);
			const gateKey = agentId !== "" ? agentId : sessionId;
			const policy = policyOf(sessionId || agentId);
			if (payload.step <= 1 || policy === "off" || gateKey === "") return next();
			if (policy === "stop") {
				try {
					payload.agent.inject?.(notice("任务看板按会话策略硬停了本回合（policy=stop）。请直接向用户说明当前进度与剩余任务，不要继续调用工具。", "任务看板已硬停本回合"));
				} catch (error) {
					ctx.logger.warn(`task-lisk: inject stop notice failed: ${String(error)}`);
				}
				return { kind: "reject" };
			}
			const shouldGate = policy === "every-step" || policy === "on-subtask-done" && isArmed(agentId, sessionId);
			if (!shouldGate) return next();
			let resolveGate = () => {};
			let rejectGate = () => {};
			const gate = new Promise((resolve, reject) => {
				resolveGate = resolve;
				rejectGate = reject;
			});
			gates.set(gateKey, {
				agentId,
				sessionId,
				resolve: resolveGate,
				reject: rejectGate
			});
			disarm(agentId, sessionId);
			const onAbort = () => {
				const pending = gates.get(gateKey);
				gates.delete(gateKey);
				try {
					pending?.reject(payload.signal?.reason);
				} catch (error) {
					ctx.logger.warn(`task-lisk: abort gate failed: ${String(error)}`);
				}
			};
			if (payload.signal?.aborted) onAbort();
			else payload.signal?.addEventListener("abort", onAbort, { once: true });
			let carried = "";
			try {
				carried = await gate;
			} catch (error) {} finally {
				payload.signal?.removeEventListener("abort", onAbort);
			}
			const decision = await next();
			if (decision?.kind !== "enter") return decision;
			if (asString(carried) === "") return decision;
			return {
				...decision,
				messages: [notice(carried, "人类在任务看板放行并留言"), ...decision.messages]
			};
		});
		/**
		 * 完成一个任务/子任务后武装「下一步暂停」。只认**真正的完成动作**：
		 *   - `task_lisk complete`（`status:"todo"` 是取消完成，不算）；
		 *   - `task_lisk update status:"done"`；
		 *   - `todo_write` 里出现「新变成 completed」的条目。
		 * 只读的 `list`、新建 `create`、改标题都不武装 —— 否则 `on-subtask-done`
		 * 会退化成「每次调用工具都停」。
		 *
		 * 调用参数在 `exec.arguments`（`dsh-tools` 的深冻 JSON 快照），**不是 `exec.args`**。
		 */
		ctx.on("tools/result", (execution, result) => {
			if (!cfg.enabled) return;
			if (execution?.agent === undefined || execution?.parent !== undefined) return;
			if (result?.isError === true) return;
			const agentId = String(execution.agent.id ?? "");
			const sessionId = sessionIdOf(execution.agent.session);
			const args = execution.arguments ?? {};
			if (execution.name === "task_lisk") {
				const finished = args.action === "complete" && args.status !== "todo" || args.action === "update" && args.status === "done";
				if (finished) armGate(agentId, sessionId);
				return;
			}
			if (execution.name === "todo_write") {
				const todos = Array.isArray(args.todos) ? args.todos : [];
				const key = agentId !== "" ? agentId : sessionId;
				const before = completedTodos.get(key) ?? new Set();
				const after = new Set(todos.filter((todo) => todo?.status === "completed" && typeof todo.content === "string").map((todo) => todo.content));
				completedTodos.set(key, after);
				if (key !== "" && [...after].some((content) => !before.has(content))) armGate(agentId, sessionId);
			}
		});
		ctx.on("agent/turn-stopping", ({ agent }) => {
			disarm(String(agent?.id ?? ""), sessionIdOf(agent?.session));
		});
		ctx.on("agent/disposed", ({ agent }) => {
			const agentId = String(agent?.id ?? "");
			const sessionId = sessionIdOf(agent?.session);
			disarm(agentId, sessionId);
			if (agentId !== "") completedTodos.delete(agentId);
			if (sessionId !== "") completedTodos.delete(sessionId);
			// 挂起的门必须解开：只删表会让那条 pre-step 永远 await 在那里。
			for (const [gateKey, gate] of [...gates]) {
				if (gateKey !== agentId && gate.sessionId !== sessionId) continue;
				gates.delete(gateKey);
				try {
					gate.reject(new Error("agent disposed"));
				} catch (error) {
					ctx.logger.warn(`task-lisk: dispose gate failed: ${String(error)}`);
				}
			}
		});

		return cleanup;
	}, "task-lisk: board");
}