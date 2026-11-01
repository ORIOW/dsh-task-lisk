/**
 * dsh-task-lisk / 浏览器半身。
 *
 * 在 sidebar.footer.action 注册侧栏底部「任务」按钮（窄栏只显图标、宽栏显文字
 * 与未完成数徽标），并在 shell.overlay 注册可拖拽/缩放的浮动看板（内容为既有
 * TaskBoard）。数据全部来自宿主半身的 /dsh-task-lisk RPC 通道；浮动窗的位置、
 * 尺寸与开关持久化在 localStorage（key: dsh.task-lisk.float.v1，全局一份），
 * 分组三态同存其 groupMode 字段，组折叠另存 dsh.task-lisk.float.collapsed.v1。
 * 批 2 起：窄容器（实测宽 < 480px）自动按会话分组（可手动三态覆盖），
 * 标题栏带 ? 帮助浮层（渲染在浮动窗内部第二浮层）。
 *
 * @module dsh-task-lisk/client
 */
window.__ModuleLoader__.load({
	id: "dsh-task-lisk",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		const React = require("react");
		const h = React.createElement;
		const { useState, useEffect, useRef, useCallback, useMemo } = React;
		/** 宿主 RPC 通道前缀。 */
		const CHANNEL = "/dsh-task-lisk";
		/** 席位 id 根：footer 按钮用 PANEL_ID，浮动窗用 `${PANEL_ID}.float`。 */
		const PANEL_ID = "dsh-task-lisk";

		const PRIORITIES = ["low", "normal", "high", "urgent"];
		const PRIORITY_LABEL = {
			urgent: "紧急",
			high: "高",
			normal: "中",
			low: "低"
		};
		const PRIORITY_COLOR = {
			urgent: "var(--dsw-alias-state-error-primary)",
			high: "var(--dsw-alias-state-warn-primary)",
			normal: "var(--dsw-alias-label-secondary)",
			low: "var(--dsw-alias-state-idle-primary)"
		};
		const STATUS_LABEL = {
			todo: "待办",
			doing: "进行中",
			done: "已完成"
		};
		const REPEAT_LABEL = {
			none: "不重复",
			daily: "每天",
			weekly: "每周",
			monthly: "每月"
		};
		const POLICY_LABEL = {
			off: "不干预",
			"every-step": "每步暂停",
			"on-subtask-done": "完成一个任务后暂停",
			stop: "硬停"
		};
		const POLICIES = ["off", "every-step", "on-subtask-done", "stop"];

		/** 主题令牌驱动的样式表（跟随明暗主题）。 */
		const S = {
			page: {
				height: "100%",
				overflow: "auto",
				background: "var(--dsw-alias-bg-base)",
				color: "var(--dsw-alias-label-primary)",
				fontSize: "13px",
				lineHeight: "20px"
			},
			inner: {
				padding: "14px 16px 40px",
				maxWidth: "900px"
			},
			head: {
				display: "flex",
				alignItems: "baseline",
				gap: "10px",
				marginBottom: "10px"
			},
			title: {
				fontSize: "15px",
				fontWeight: 600,
				margin: 0
			},
			muted: {
				color: "var(--dsw-alias-label-secondary)",
				fontSize: "12px"
			},
			card: {
				border: "1px solid var(--dsw-alias-border-l1)",
				borderRadius: "8px",
				background: "var(--dsw-alias-bg-layer-1)",
				padding: "10px 12px",
				marginBottom: "12px"
			},
			row: {
				display: "flex",
				alignItems: "center",
				gap: "8px"
			},
			input: {
				flex: "1 1 auto",
				minWidth: 0,
				padding: "5px 8px",
				border: "1px solid var(--dsw-alias-border-l2)",
				borderRadius: "6px",
				background: "var(--dsw-alias-bg-layer-2)",
				color: "var(--dsw-alias-label-primary)",
				fontSize: "13px",
				outline: "none"
			},
			select: {
				padding: "4px 6px",
				border: "1px solid var(--dsw-alias-border-l2)",
				borderRadius: "6px",
				background: "var(--dsw-alias-bg-layer-2)",
				color: "var(--dsw-alias-label-primary)",
				fontSize: "12px"
			},
			btn: {
				cursor: "pointer",
				border: "1px solid var(--dsw-alias-border-l2)",
				borderRadius: "6px",
				background: "transparent",
				color: "var(--dsw-alias-label-secondary)",
				fontSize: "12px",
				padding: "3px 8px",
				whiteSpace: "nowrap"
			},
			btnPrimary: {
				cursor: "pointer",
				border: "1px solid var(--dsw-alias-brand-primary)",
				borderRadius: "6px",
				background: "transparent",
				color: "var(--dsw-alias-brand-primary)",
				fontSize: "12px",
				padding: "3px 10px",
				whiteSpace: "nowrap"
			},
			btnIcon: {
				cursor: "pointer",
				border: "none",
				background: "transparent",
				color: "var(--dsw-alias-label-secondary)",
				fontSize: "13px",
				padding: "2px 5px",
				borderRadius: "4px"
			},
			item: {
				display: "flex",
				alignItems: "flex-start",
				gap: "8px",
				padding: "5px 6px",
				borderRadius: "6px"
			},
			itemMain: {
				flex: "1 1 auto",
				minWidth: 0
			},
			itemTitle: {
				wordBreak: "break-word"
			},
			itemMeta: {
				display: "flex",
				flexWrap: "wrap",
				alignItems: "center",
				gap: "6px",
				marginTop: "2px",
				fontSize: "11px",
				color: "var(--dsw-alias-label-secondary)"
			},
			done: {
				textDecoration: "line-through",
				color: "var(--dsw-alias-label-secondary)"
			},
			empty: {
				padding: "18px 4px",
				textAlign: "center",
				color: "var(--dsw-alias-label-secondary)",
				fontSize: "12px"
			}
		};

		/** 调用宿主端点，任何异常都收敛成 {ok:false}。 */
		async function call(rpc, method, payload) {
			try {
				return await rpc.call(CHANNEL, method, payload);
			} catch (error) {
				return {
					ok: false,
					error: { message: String(error) }
				};
			}
		}
		/** 截止时间显示：今天/明天/逾期用文字，其余用日期。 */
		function fmtDue(ms) {
			if (typeof ms !== "number") return "";
			const date = new Date(ms);
			const day = 86400000;
			const startOfToday = new Date();
			startOfToday.setHours(0, 0, 0, 0);
			const diff = Math.round((date.getTime() - startOfToday.getTime()) / day);
			if (diff < 0) return `逾期 ${-diff} 天`;
			if (diff === 0) return "今天";
			if (diff === 1) return "明天";
			return `${date.getMonth() + 1}/${date.getDate()}`;
		}
		/** 会话短标识，够区分即可。 */
		function shortId(id) {
			if (typeof id !== "string" || id === "") return "";
			return id.length <= 10 ? id : `${id.slice(0, 4)}…${id.slice(-4)}`;
		}
		/** 按 parentId 组装两层的可见顺序。 */
		function flatten(tasks) {
			const byParent = new Map();
			for (const task of tasks) {
				const key = task.parentId ?? "";
				if (!byParent.has(key)) byParent.set(key, []);
				byParent.get(key).push(task);
			}
			for (const list of byParent.values()) list.sort((a, b) => a.order - b.order || a.createdAt - b.createdAt);
			const out = [];
			const walk = (key, depth) => {
				for (const task of byParent.get(key) ?? []) {
					out.push({
						task,
						depth
					});
					walk(task.id, depth + 1);
				}
			};
			walk("", 0);
			return out;
		}
		/** 未完成数口径：与看板头部摘要同一份（list 全量含子任务，status !== "done"）。 */
		function countPending(tasks) {
			return Array.isArray(tasks) ? tasks.filter((task) => task?.status !== "done").length : 0;
		}

		// ==== 批 2 · F2：按会话分组（判定/折叠/当前会话标识） ====

		/** 分组阈值：浮动窗实测宽 < 480 ⇒ 按会话分组（auto 态判定基准，非 window.innerWidth）。 */
		const GROUP_BREAKPOINT = 480;
		/** 组折叠持久化 key：值形如 { [sessionId]: true }，全局一份（与 float.v1 同口径）。 */
		const COLLAPSED_STORAGE_KEY = "dsh.task-lisk.float.collapsed.v1";
		/** 每日首访提示持久化 key：值形如 { date: "YYYY-MM-DD" }，全局一份（批 3 P2）。 */
		const NUDGE_STORAGE_KEY = "dsh.task-lisk.nudge.v1";
		const GROUP_MODES = ["auto", "flat", "grouped"];
		const GROUP_MODE_LABEL = {
			auto: "自动",
			flat: "扁平",
			grouped: "分组"
		};
		/** 三态判定：显式选择覆盖宽度判定，只有 auto 回到「实测宽 < 480」。 */
		function effectiveGrouped() {
			const mode = GROUP_MODES.includes(floatState.groupMode) ? floatState.groupMode : "auto";
			if (mode === "grouped") return true;
			if (mode === "flat") return false;
			return floatState.w < GROUP_BREAKPOINT;
		}
		/**
		 * 按 sessionId 分组：组间保持各会话在既有树序里的首次出现顺序（不另造排序口径），
		 * 组内沿用入参顺序（flatten 的 order → 创建时间既有口径）；
		 * 无 sessionId 的任务归「未分组」（sessionId 为 null）置底，没有则不产出空组。
		 * @param entries - flatten 产出的 {task, depth} 数组（分组只是视觉重排，不增删任务）。
		 */
		function groupBySession(entries) {
			const grouped = [];
			const loose = [];
			const index = new Map();
			for (const entry of entries) {
				const sid = entry && entry.task && typeof entry.task.sessionId === "string" && entry.task.sessionId !== "" ? entry.task.sessionId : null;
				if (sid === null) {
					loose.push(entry);
					continue;
				}
				if (!index.has(sid)) {
					const group = {
						sessionId: sid,
						tasks: []
					};
					index.set(sid, group);
					grouped.push(group);
				}
				index.get(sid).tasks.push(entry);
			}
			if (loose.length > 0) grouped.push({
				sessionId: null,
				tasks: loose
			});
			return grouped;
		}
		/** 读折叠表：损坏/无 localStorage（SSR、测试）时回退空表；只认 string→true 的平面对象。 */
		function loadCollapsedMap() {
			try {
				if (typeof localStorage === "undefined") return {};
				const raw = localStorage.getItem(COLLAPSED_STORAGE_KEY);
				if (typeof raw !== "string" || raw === "") return {};
				const parsed = JSON.parse(raw);
				if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
				const out = {};
				for (const [key, value] of Object.entries(parsed)) if (typeof key === "string" && key !== "" && value === true) out[key] = true;
				return out;
			} catch {
				return {};
			}
		}
		const collapsedMap = loadCollapsedMap();
		const collapsedListeners = new Set();
		/** 折叠表写盘（与 float.v1 同策略：操作即写，隐私模式失败不影响使用）。 */
		function persistCollapsedMap() {
			try {
				if (typeof localStorage === "undefined") return;
				localStorage.setItem(COLLAPSED_STORAGE_KEY, JSON.stringify(collapsedMap));
			} catch {
				// 写盘失败不影响本次使用。
			}
		}
		function toggleCollapsed(sessionId) {
			if (typeof sessionId !== "string" || sessionId === "") return;
			if (collapsedMap[sessionId] === true) delete collapsedMap[sessionId];
			else collapsedMap[sessionId] = true;
			persistCollapsedMap();
			for (const fn of [...collapsedListeners]) fn();
		}
		/** 订阅折叠表（组头点击折叠/展开后重渲染）。 */
		function useCollapsedMap() {
			const [map, setMap] = useState(() => ({ ...collapsedMap }));
			useEffect(() => {
				const sync = () => setMap({ ...collapsedMap });
				collapsedListeners.add(sync);
				sync();
				return () => {
					collapsedListeners.delete(sync);
				};
			}, []);
			return map;
		}

		// ==== 批 3 · P2：每日首访未完成任务提示（横幅，无定时器/无 RPC） ====

		/**
		 * 本地日历日 key（YYYY-MM-DD）：用本地时区的年月日拼接；
		 * 禁用 toISOString——它按 UTC 取日期，深夜会被拨到前一天/后一天。
		 */
		function todayKey(now = new Date()) {
			const month = String(now.getMonth() + 1).padStart(2, "0");
			const day = String(now.getDate()).padStart(2, "0");
			return `${now.getFullYear()}-${month}-${day}`;
		}
		/** 是否需要每日提示：当天还没提示过 且 有未完成任务。 */
		function nudgeNeed(saved, today, pendingCount) {
			return saved?.date !== today && pendingCount > 0;
		}
		/** 横幅文案：基础句 + 逾期追加句。 */
		function nudgeText(pendingCount, overdueCount) {
			const base = `今天还有 ${pendingCount} 个未完成任务`;
			return overdueCount > 0 ? `${base}，其中 ${overdueCount} 个已逾期` : base;
		}
		/** 读每日提示记录：无记录/损坏/无 localStorage（SSR、测试）时返回 null。 */
		function loadNudge() {
			try {
				if (typeof localStorage === "undefined") return null;
				const raw = localStorage.getItem(NUDGE_STORAGE_KEY);
				if (typeof raw !== "string" || raw === "") return null;
				const parsed = JSON.parse(raw);
				if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
				return typeof parsed.date === "string" ? parsed : null;
			} catch {
				return null;
			}
		}
		/** 展示即记：写当天日期；隐私模式写失败视为从未提示（次日照常提示），不影响渲染。 */
		function markNudge(today) {
			try {
				if (typeof localStorage === "undefined") return;
				localStorage.setItem(NUDGE_STORAGE_KEY, JSON.stringify({
					date: today
				}));
			} catch {
				// 写盘失败不影响本次使用。
			}
		}
		/**
		 * 当前会话标识（§3.3 来源 A：客户端 sessions 服务）。
		 * apply() 里的轮询写入，组件经 hook 订阅；拿不到时 currentId 为 null，
		 * 高亮与「UI 建任务写当前会话」自动关闭，绝不臆造 sessionId。
		 */
		const sessionInfo = {
			currentId: null,
			titles: {},
			listeners: new Set()
		};
		function setSessionInfo(next) {
			let changed = false;
			if (next.currentId !== undefined && sessionInfo.currentId !== next.currentId) {
				sessionInfo.currentId = next.currentId;
				changed = true;
			}
			if (next.titles !== undefined) {
				sessionInfo.titles = next.titles;
				changed = true;
			}
			if (changed) for (const fn of [...sessionInfo.listeners]) fn();
		}
		/**
		 * 从 sessions.list 快照解析「当前会话 id + 标题表」：
		 * 主会话判据 = retainedBy.mainView > 0（rc.2 起官方口径，与 dsh-client-ui-session publishMain 同源）；
		 * 旧内核线的 snapshot.current 仍在则优先；都没有再逐行 retainInfo 防御性探测。
		 * 任何异常/缺形状都收敛为 { currentId: null, titles }，绝不抛错、绝不臆造。
		 */
		function resolveSessionIdentity(snap, sessions) {
			const titles = {};
			const byId = snap !== null && typeof snap === "object" && snap.byId !== null && typeof snap.byId === "object" ? snap.byId : null;
			if (byId === null) return {
				currentId: null,
				titles
			};
			const mains = [];
			for (const sid of Object.keys(byId)) {
				const row = byId[sid];
				if (row === null || typeof row !== "object") continue;
				if (typeof row.displayTitle === "string" && row.displayTitle !== "") titles[sid] = row.displayTitle;
				const mainView = row.retainedBy !== null && typeof row.retainedBy === "object" && typeof row.retainedBy.mainView === "number" ? row.retainedBy.mainView : 0;
				if (mainView > 0) mains.push([mainView, sid]);
			}
			let currentId = null;
			if (typeof snap.current === "string" && snap.current !== "") currentId = snap.current;
			else if (mains.length > 0) {
				mains.sort((a, b) => b[0] - a[0]);
				currentId = mains[0][1];
			} else if (sessions !== null && typeof sessions.retainInfo === "function") {
				for (const sid of Object.keys(byId)) {
					try {
						const info = sessions.retainInfo(sid).getSnapshot();
						if (info !== null && typeof info === "object" && info.retainedBy !== null && typeof info.retainedBy === "object" && (info.retainedBy.mainView ?? 0) > 0) {
							currentId = sid;
							break;
						}
					} catch {
						// 单行探测失败继续下一行。
					}
				}
			}
			return {
				currentId,
				titles
			};
		}
		/** 把一轮会话身份解析结果写进模块级 store（apply 轮询与冒烟共用）。 */
		function syncSessionIdentity(snap, sessions) {
			const resolved = resolveSessionIdentity(snap, sessions);
			setSessionInfo({
				currentId: resolved.currentId,
				titles: resolved.titles
			});
			return resolved;
		}
		/** 订阅当前会话标识（组头标题/「当前」高亮用）。 */
		function useSessionInfo() {
			const [info, setInfo] = useState(() => ({
				currentId: sessionInfo.currentId,
				titles: sessionInfo.titles
			}));
			useEffect(() => {
				const sync = () => setInfo({
					currentId: sessionInfo.currentId,
					titles: { ...sessionInfo.titles }
				});
				sessionInfo.listeners.add(sync);
				sync();
				return () => {
					sessionInfo.listeners.delete(sync);
				};
			}, []);
			return info;
		}
		/** 订阅浮动窗几何/三态（工具栏下拉与分组判定共用，不在 TaskBoard 里另开状态源）。 */
		function useFloatGeom() {
			const [geom, setGeom] = useState(() => ({
				w: floatState.w,
				groupMode: floatState.groupMode
			}));
			useEffect(() => {
				const sync = () => setGeom({
					w: floatState.w,
					groupMode: floatState.groupMode
				});
				floatListeners.add(sync);
				sync();
				return () => {
					floatListeners.delete(sync);
				};
			}, []);
			return geom;
		}
		/** UI 建任务带当前会话：拿得到 currentId 才写（宿主 create 已支持 payload.sessionId），拿不到保持原样。 */
		function payloadWithSession(payload) {
			return typeof sessionInfo.currentId === "string" && sessionInfo.currentId !== "" ? {
				...payload,
				sessionId: sessionInfo.currentId
			} : payload;
		}
		/** 防御性读取 ctx.sessions：门面未放行/形状不符时返回 null（含冒烟伪 ctx），绝不抛错。 */
		function readSessionsFace(ctx) {
			try {
				const face = ctx?.sessions;
				if (face !== null && typeof face === "object" && face.list !== null && typeof face.list === "object" && typeof face.list.getSnapshot === "function") return face;
			} catch {
				// 运行时门面守卫可能直接抛错（未声明/服务缺失），一律降级为无会话标识。
			}
			return null;
		}
		/**
		 * 分组视图渲染（纯函数，供 TaskBoard 与冒烟复用）：
		 * 组头 = 会话标题（取不到回退 shortId）+ 折叠指示 + 当前会话「当前」标签 + 条数；
		 * 「未分组」组头无折叠交互、始终展示；折叠组只渲染组头。
		 * @param entries - flatten 产出的 {task, depth} 数组。
		 * @param identity - { currentId, titles }（当前会话 id 与标题表）。
		 * @param folded - 折叠表 { [sessionId]: true }。		 * @param renderItem - 单任务行渲染函数（沿用扁平视图同一份）。
		 */
		function renderSessionGroups(entries, identity, folded, renderItem) {
			const currentId = identity && typeof identity.currentId === "string" ? identity.currentId : null;
			const titles = identity && typeof identity.titles === "object" && identity.titles !== null ? identity.titles : {};
			return groupBySession(entries).map((group) => {
				const key = group.sessionId === null ? "ungrouped" : group.sessionId;
				const isLoose = group.sessionId === null;
				const isCurrent = !isLoose && group.sessionId === currentId;
				const storedTitle = !isLoose ? titles[group.sessionId] : undefined;
				const title = isLoose ? "未分组" : typeof storedTitle === "string" && storedTitle !== "" ? storedTitle : shortId(group.sessionId) || "（空会话）";
				const isFolded = !isLoose && folded[key] === true;
				return h("div", {
					key: `g:${key}`
				}, [
					h("div", {
						key: "head",
						"data-role": "session-group",
						"data-session": key,
						...(isCurrent ? { "data-current": "true" } : {}),
						onClick: isLoose ? undefined : () => toggleCollapsed(key),
						style: {
							display: "flex",
							alignItems: "center",
							gap: "6px",
							padding: "4px 6px",
							marginBottom: "2px",
							borderLeft: isCurrent ? "3px solid var(--dsw-alias-brand-primary)" : "3px solid transparent",
							borderRadius: "4px",
							background: "var(--dsw-alias-bg-layer-2)",
							cursor: isLoose ? "default" : "pointer",
							userSelect: "none"
						}
					}, [
						h("span", {
							key: "caret",
							"aria-hidden": "true",
							style: {
								...S.muted,
								width: "10px",
								textAlign: "center"
							}
						}, isLoose ? "" : isFolded ? "▸" : "▾"),
						h("span", {
							key: "t",
							style: {
								flex: "1 1 auto",
								minWidth: 0,
								overflow: "hidden",
								textOverflow: "ellipsis",
								whiteSpace: "nowrap",
								fontWeight: 600,
								fontSize: "12px"
							},
							title: isLoose ? "没有归属会话的任务" : group.sessionId
						}, title),
						isCurrent ? h("span", {
							key: "cur",
							style: {
								padding: "0 5px",
								borderRadius: "7px",
								background: "var(--dsw-alias-brand-primary)",
								color: "#fff",
								fontSize: "10px",
								lineHeight: "14px"
							}
						}, "当前") : null,
						h("span", {
							key: "n",
							style: S.muted
						}, `${group.tasks.length}`)
					]),
					isFolded ? null : h("div", {
						key: "tasks"
					}, group.tasks.map(renderItem))
				]);
			});
		}

		/**
		 * 任务看板（批 1 起渲染在 shell.overlay 浮动窗内）。
		 * 所有写操作都走 RPC，再以宿主返回值刷新本地视图。
		 * @param props.rpc - 客户端连接服务的 RPC 客户端。
		 */
		function TaskBoard({ rpc }) {
			const geom = useFloatGeom();
			const session = useSessionInfo();
			const collapsed = useCollapsedMap();
			const [nudge, setNudge] = useState(null);
			const nudgeChecked = useRef(false);
			const [tasks, setTasks] = useState([]);
			const [policy, setPolicy] = useState({
				default: "off",
				sessions: []
			});
			const [config, setConfig] = useState(null);
			const [error, setError] = useState(null);
			const [loaded, setLoaded] = useState(false);
			const [filter, setFilter] = useState("open");
			const [draft, setDraft] = useState("");
			const [draftPriority, setDraftPriority] = useState("normal");
			const [draftDue, setDraftDue] = useState("");
			const [draftRepeat, setDraftRepeat] = useState("none");
			const [editingId, setEditingId] = useState("");
			const [editingTitle, setEditingTitle] = useState("");
			const [busy, setBusy] = useState(false);
			/** sessionId → 放行时随行带给 agent 的补充说明（可空）。 */
			const [releaseNotes, setReleaseNotes] = useState({});
			const aliveRef = useRef(true);

			const applyList = useCallback((value) => {
				setTasks(Array.isArray(value.tasks) ? value.tasks : []);
				setPolicy(value.policy ?? {
					default: "off",
					sessions: []
				});
				setConfig(value.config ?? null);
				setLoaded(true);
				setError(null);
			}, []);
			const refresh = useCallback(async () => {
				if (rpc === undefined) {
					setError("客户端连接服务不可用");
					return null;
				}
				const result = await call(rpc, "list", {});
				if (!aliveRef.current) return null;
				if (result?.ok) {
					applyList(result.value);
					return result.value;
				}
				setError(result?.error?.message ?? "读取任务失败");
				setLoaded(true);
				return null;
			}, [applyList, rpc]);
			/** 写操作：串行执行，避免并发点击交错。 */
			const act = useCallback(async (method, payload) => {
				if (rpc === undefined) return null;
				setBusy(true);
				try {
					const result = await call(rpc, method, payload);
					if (!aliveRef.current) return null;
					if (!result?.ok) {
						setError(result?.error?.message ?? `${method} 失败`);
						return null;
					}
					setError(null);
					if (result.value?.policy !== undefined && result.value?.sessions !== undefined) setPolicy(result.value);
					const value = await refresh();
					return value ?? result.value;
				} finally {
					if (aliveRef.current) setBusy(false);
				}
			}, [refresh, rpc]);

			useEffect(() => {
				aliveRef.current = true;
				void refresh();
				const timer = setInterval(() => void refresh(), 1500);
				return () => {
					aliveRef.current = false;
					clearInterval(timer);
				};
			}, [refresh]);
			/** 每日首访提示（批 3 P2）：首次 loaded 后判定一次；展示即记，跨天重置；不发 RPC、无定时器。 */
			useEffect(() => {
				if (!loaded || nudgeChecked.current) return;
				nudgeChecked.current = true;
				const pendingCount = countPending(tasks);
				const overdueCount = tasks.filter((t) => t.status !== "done" && t.dueAt !== null && isFinite(Number(t.dueAt)) && Number(t.dueAt) < Date.now()).length;
				const today = todayKey();
				if (nudgeNeed(loadNudge(), today, pendingCount)) {
					markNudge(today);
					setNudge({
						pending: pendingCount,
						overdue: overdueCount
					});
				}
			}, [loaded, tasks]);

			const counts = useMemo(() => ({
				total: tasks.length,
				open: countPending(tasks),
				done: tasks.filter((t) => t.status === "done").length
			}), [tasks]);
			const visible = useMemo(() => {
				const filtered = tasks.filter((t) => filter === "all" ? true : filter === "done" ? t.status === "done" : t.status !== "done");
				const withChildren = new Set(filtered.map((t) => t.id));
				const extra = tasks.filter((t) => t.parentId !== null && filter === "all");
				for (const task of extra) withChildren.add(task.id);
				return flatten(tasks.filter((t) => withChildren.has(t.id) && (filtered.includes(t) || filter === "all")));
			}, [filter, tasks]);
			const sessions = useMemo(() => {
				const ids = new Set();
				for (const task of tasks) if (typeof task.sessionId === "string" && task.sessionId !== "") ids.add(task.sessionId);
				for (const row of policy.sessions ?? []) ids.add(row.sessionId);
				return [...ids];
			}, [policy, tasks]);
			const overdue = tasks.filter((t) => t.status !== "done" && typeof t.dueAt === "number" && t.dueAt < Date.now()).length;

			const create = async () => {
				const title = draft.trim();
				if (title === "") return;
				await act("create", payloadWithSession({
					title,
					priority: draftPriority,
					dueAt: draftDue === "" ? null : Date.parse(`${draftDue}T09:00:00`),
					repeat: draftRepeat
				}));
				setDraft("");
				setDraftDue("");
			};
			const cycleStatus = (task) => {
				const next = task.status === "todo" ? "doing" : task.status === "doing" ? "done" : "todo";
				void act("setStatus", {
					id: task.id,
					status: next
				});
			};
			const cyclePriority = (task) => {
				const index = PRIORITIES.indexOf(task.priority);
				const next = PRIORITIES[(index + 1) % PRIORITIES.length];
				void act("update", {
					id: task.id,
					patch: { priority: next }
				});
			};
			const saveTitle = async (task) => {
				const title = editingTitle.trim();
				setEditingId("");
				if (title === "" || title === task.title) return;
				await act("update", {
					id: task.id,
					patch: { title }
				});
			};
			const addSubtask = async (task) => {
				const title = window.prompt(`在「${task.title}」下新增子任务：`);
				if (title === null || title.trim() === "") return;
				await act("create", payloadWithSession({
					title: title.trim(),
					parentId: task.id
				}));
			};
			const remove = async (task) => {
				if (!window.confirm(`删除「${task.title}」及其子任务？`)) return;
				await act("remove", {
					id: task.id,
					cascade: true
				});
			};
			const setSessionPolicy = (sessionId, next) => void act("policy", {
				sessionId,
				policy: next
			});
			const release = async (sessionId) => {
				const text = releaseNotes[sessionId] ?? "";
				const result = await act("release", {
					sessionId,
					text
				});
				if (result === null) return;
				if (result.released === false) {
					setError("该会话当前没有等待放行的暂停");
					return;
				}
				// 放行成功才清掉输入，失败时保留人类刚写的内容。
				setReleaseNotes((previous) => ({
					...previous,
					[sessionId]: ""
				}));
			};

			const statusMark = (status) => status === "done" ? "●" : status === "doing" ? "◐" : "○";
			const statusColor = (status) => status === "done" ? "var(--dsw-alias-state-success-primary)" : status === "doing" ? "var(--dsw-alias-brand-primary)" : "var(--dsw-alias-label-secondary)";

			const renderItem = ({ task, depth }) => {
				const children = tasks.filter((t) => t.parentId === task.id).length;
				const isOverdue = task.status !== "done" && typeof task.dueAt === "number" && task.dueAt < Date.now();
				return h("div", {
					key: task.id,
					style: {
						...S.item,
						marginLeft: `${depth * 16}px`,
						borderTop: depth === 0 ? "1px solid var(--dsw-alias-border-l1)" : "none"
					}
				}, [
					h("button", {
						key: "status",
						type: "button",
						title: `${STATUS_LABEL[task.status] ?? task.status} → 点击切换`,
						onClick: () => cycleStatus(task),
						style: {
							...S.btnIcon,
							color: statusColor(task.status),
							fontSize: "15px",
							lineHeight: "18px"
						}
					}, statusMark(task.status)),
					h("div", {
						key: "main",
						style: S.itemMain
					}, [
						editingId === task.id ? h("input", {
							key: "edit",
							autoFocus: true,
							value: editingTitle,
							onChange: (event) => setEditingTitle(event.target.value),
							onBlur: () => void saveTitle(task),
							onKeyDown: (event) => {
								if (event.key === "Enter") void saveTitle(task);
								if (event.key === "Escape") setEditingId("");
							},
							style: {
								...S.input,
								width: "100%"
							}
						}) : h("div", {
							key: "title",
							style: {
								...S.itemTitle,
								...task.status === "done" ? S.done : {},
								cursor: "text"
							},
							title: task.note === "" ? "点击改写标题" : task.note,
							onClick: () => {
								setEditingId(task.id);
								setEditingTitle(task.title);
							}
						}, task.title),
						h("div", {
							key: "meta",
							style: S.itemMeta
						}, [
							h("button", {
								key: "priority",
								type: "button",
								title: "点击切换优先级",
								onClick: () => cyclePriority(task),
								style: {
									...S.btnIcon,
									color: PRIORITY_COLOR[task.priority] ?? "inherit",
									fontSize: "11px",
									border: `1px solid ${PRIORITY_COLOR[task.priority] ?? "var(--dsw-alias-border-l2)"}`,
									padding: "0 5px",
									borderRadius: "8px"
								}
							}, PRIORITY_LABEL[task.priority] ?? task.priority),
							typeof task.dueAt === "number" ? h("span", {
								key: "due",
								style: isOverdue ? { color: "var(--dsw-alias-state-error-primary)" } : undefined
							}, fmtDue(task.dueAt)) : null,
							task.repeat !== "none" ? h("span", {
								key: "repeat"
							}, `↻ ${REPEAT_LABEL[task.repeat] ?? task.repeat}${task.rollCount > 0 ? ` ×${task.rollCount}` : ""}`) : null,
							children > 0 ? h("span", { key: "kids" }, `子任务 ${children}`) : null,
							task.sessionId !== null && task.sessionId !== "" ? h("span", { key: "sess" }, `会话 ${shortId(task.sessionId)}`) : null,
							task.source === "import" ? h("span", { key: "src" }, "来自 agent") : null,
							task.source === "agent" ? h("span", { key: "src2" }, "agent 创建") : null
						])
					]),
					h("div", {
						key: "actions",
						style: {
							display: "flex",
							gap: "2px",
							alignItems: "center"
						}
					}, [
						h("button", {
							key: "add",
							type: "button",
							title: "新增子任务",
							style: S.btnIcon,
							onClick: () => void addSubtask(task)
						}, "＋"),
						h("button", {
							key: "del",
							type: "button",
							title: "删除（连同子任务）",
							style: S.btnIcon,
							onClick: () => void remove(task)
						}, "✕")
					])
				]);
			};

			return h("div", {
				style: S.page
			}, h("div", {
				style: S.inner
			}, [
				nudge === null ? null : h("div", {
					key: "nudge",
					role: "status",
					"aria-live": "polite",
					style: {
						display: "flex",
						alignItems: "center",
						gap: "8px",
						padding: "7px 10px",
						marginBottom: "10px",
						border: "1px solid var(--dsw-alias-border-l1)",
						borderLeft: "3px solid var(--dsw-alias-brand-primary)",
						borderRadius: "8px",
						background: "var(--dsw-alias-bg-layer-1)"
					}
				}, [
					h("span", {
						key: "t",
						style: {
							flex: "1 1 auto",
							minWidth: 0
						}
					}, nudgeText(nudge.pending, nudge.overdue)),
					h("button", {
						key: "ok",
						type: "button",
						title: "知道了",
						"aria-label": "关闭每日提示",
						style: S.btn,
						onClick: () => setNudge(null)
					}, "知道了")
				]),
				h("div", {
					key: "head",
					style: S.head
				}, [
					h("h2", {
						key: "t",
						style: S.title
					}, "任务看板"),
					h("span", {
						key: "c",
						style: S.muted
					}, `未完成 ${counts.open} · 已完成 ${counts.done} · 共 ${counts.total}${overdue > 0 ? ` · 逾期 ${overdue}` : ""}`),
					h("span", {
						key: "spacer",
						style: { flex: "1 1 auto" }
					}),
					busy ? h("span", {
						key: "busy",
						style: S.muted
					}, "同步中…") : null,
					h("button", {
						key: "refresh",
						type: "button",
						style: S.btn,
						onClick: () => void refresh()
					}, "刷新")
				]),
				error !== null ? h("div", {
					key: "err",
					style: {
						...S.card,
						borderColor: "var(--dsw-alias-state-error-primary)",
						color: "var(--dsw-alias-state-error-primary)"
					}
				}, error) : null,
				h("div", {
					key: "new",
					style: S.card
				}, [
					h("div", {
						key: "row",
						style: S.row
					}, [
						h("input", {
							key: "title",
							value: draft,
							placeholder: "新增任务（回车提交）…",
							onChange: (event) => setDraft(event.target.value),
							onKeyDown: (event) => {
								if (event.key === "Enter") void create();
							},
							style: S.input
						}),
						h("select", {
							key: "pri",
							value: draftPriority,
							onChange: (event) => setDraftPriority(event.target.value),
							style: S.select
						}, PRIORITIES.map((p) => h("option", {
							key: p,
							value: p
						}, PRIORITY_LABEL[p]))),
						h("input", {
							key: "due",
							type: "date",
							value: draftDue,
							onChange: (event) => setDraftDue(event.target.value),
							style: S.select
						}),
						h("select", {
							key: "rep",
							value: draftRepeat,
							onChange: (event) => setDraftRepeat(event.target.value),
							style: S.select
						}, Object.keys(REPEAT_LABEL).map((r) => h("option", {
							key: r,
							value: r
						}, REPEAT_LABEL[r]))),
						h("button", {
							key: "add",
							type: "button",
							style: S.btnPrimary,
							disabled: draft.trim() === "",
							onClick: () => void create()
						}, "添加")
					])
				]),
				h("div", {
					key: "list",
					style: S.card
				}, [
					h("div", {
						key: "filters",
						style: {
							...S.row,
							marginBottom: "6px"
						}
					}, [
						["open", "未完成"],
						["all", "全部"],
						["done", "已完成"]
					].map(([value, label]) => h("button", {
						key: value,
						type: "button",
						style: filter === value ? {
							...S.btnPrimary,
							borderColor: "var(--dsw-alias-brand-primary)"
						} : S.btn,
						onClick: () => setFilter(value)
					}, label)),
						h("span", {
							key: "gmLabel",
							style: S.muted
						}, "分组"),
						h("select", {
							key: "groupMode",
							"aria-label": "分组方式",
							title: "容器实测宽小于 480px 自动分组；选「扁平/分组」手动覆盖",
							value: GROUP_MODES.includes(geom.groupMode) ? geom.groupMode : "auto",
							onChange: (event) => {
								setFloatState({ groupMode: event.target.value });
								persistFloatState();
							},
							style: S.select
						}, GROUP_MODES.map((mode) => h("option", {
							key: mode,
							value: mode
						}, GROUP_MODE_LABEL[mode])))),
					!loaded ? h("div", { key: "loading", style: S.empty }, "载入中…") : visible.length === 0 ? h("div", {
						key: "empty",
						style: S.empty
					}, filter === "done" ? "还没有已完成的任务" : "没有任务。添加一条，或让 agent 用 task_lisk 工具创建。") : h("div", {
						key: "items"
					}, effectiveGrouped() ? renderSessionGroups(visible, session, collapsed, renderItem) : visible.map(renderItem))
				]),
				h("div", {
					key: "gate",
					style: S.card
				}, [
					h("div", {
						key: "h",
						style: {
							...S.row,
							marginBottom: "6px"
						}
					}, [
						h("strong", { key: "t" }, "条件化执行 / 停止"),
						h("span", {
							key: "spacer",
							style: { flex: "1 1 auto" }
						}),
						h("span", {
							key: "l",
							style: S.muted
						}, "默认策略"),
						h("select", {
							key: "d",
							value: policy.default ?? "off",
							onChange: (event) => void act("policy", { policy: event.target.value }),
							style: S.select
						}, POLICIES.map((p) => h("option", {
							key: p,
							value: p
						}, POLICY_LABEL[p])))
					]),
					h("div", {
						key: "desc",
						style: S.muted
					}, "「每步暂停」= 每次模型请求前卡门等人放行；「完成一个任务后暂停」= agent 真正完成/勾选一个任务后，下一步之前卡门；「硬停」= 直接拒绝本回合（模型会转为总结说明）。"),
					sessions.length === 0 ? h("div", {
						key: "nosess",
						style: S.muted
					}, "（暂无绑定会话的任务）") : h("div", {
						key: "sessions",
						style: { marginTop: "8px" }
					}, sessions.map((sessionId) => {
						const row = (policy.sessions ?? []).find((entry) => entry.sessionId === sessionId);
						return h("div", {
							key: sessionId,
							style: {
								...S.row,
								padding: "3px 0"
							}
						}, [
							h("span", {
								key: "id",
								style: {
									...S.muted,
									flex: "1 1 auto",
									wordBreak: "break-all"
								}
							}, `会话 ${sessionId}`),
							h("select", {
								key: "p",
								value: row?.policy ?? "",
								onChange: (event) => setSessionPolicy(sessionId, event.target.value === "" ? policy.default ?? "off" : event.target.value),
								style: S.select
							}, [h("option", {
								key: "inherit",
								value: ""
							}, `跟随默认（${POLICY_LABEL[policy.default] ?? policy.default}）`), ...POLICIES.map((p) => h("option", {
								key: p,
								value: p
							}, POLICY_LABEL[p]))]),
							h("input", {
								key: "note",
								type: "text",
								placeholder: "放行留言（可选）…",
								value: releaseNotes[sessionId] ?? "",
								onChange: (event) => {
									const next = event.target.value;
									setReleaseNotes((previous) => ({
										...previous,
										[sessionId]: next
									}));
								},
								style: {
									...S.input,
									flex: "1 1 110px",
									minWidth: "0"
								}
							}),
							h("button", {
								key: "rel",
								type: "button",
								style: S.btnPrimary,
								onClick: () => void release(sessionId)
							}, "放行")
						]);
					}))
				]),
				config !== null ? h("div", {
					key: "cfg",
					style: S.muted
				}, `子任务层级上限 ${config.maxDepth} · 会话待办自动同步 ${config.autoImportTodos ? "已开启" : "已关闭"} · 宿主开关 ${config.enabled ? "已启用" : "已停用"}`) : null
			]));
		}

		// ==== 批 1：浮动看板（shell.overlay）与侧栏底部开关（sidebar.footer.action）====

		/** 浮动窗持久化 key：全局一份，不随会话/工作区。 */
		const FLOAT_STORAGE_KEY = "dsh.task-lisk.float.v1";
		/** 浮动窗边界：最小 320×240；拖出视口时夹回，至少露出 48px。 */
		const FLOAT_MIN_W = 320;
		const FLOAT_MIN_H = 240;
		const FLOAT_VISIBLE = 48;
		/** 缺省状态：右上角内缩 24px，380×520，首次打开。 */
		function defaultFloatState() {
			const vw = typeof window === "object" && typeof window.innerWidth === "number" ? window.innerWidth : 1024;
			return {
				x: Math.max(24, vw - 380 - 24),
				y: 24,
				w: 380,
				h: 520,
				open: true,
				groupMode: "auto"
			};
		}
		/** 读取持久化状态；无记录/损坏/无 localStorage（SSR、测试环境）时回退缺省。 */
		function loadFloatState() {
			const fallback = defaultFloatState();
			try {
				if (typeof localStorage === "undefined") return fallback;
				const raw = localStorage.getItem(FLOAT_STORAGE_KEY);
				if (typeof raw !== "string" || raw === "") return fallback;
				const parsed = JSON.parse(raw);
				if (typeof parsed !== "object" || parsed === null) return fallback;
				const num = (value, fb) => typeof value === "number" && Number.isFinite(value) ? value : fb;
				return {
					x: num(parsed.x, fallback.x),
					y: num(parsed.y, fallback.y),
					w: num(parsed.w, fallback.w),
					h: num(parsed.h, fallback.h),
					open: typeof parsed.open === "boolean" ? parsed.open : fallback.open,
					groupMode: typeof parsed.groupMode === "string" ? parsed.groupMode : "auto"
				};
			} catch {
				return fallback;
			}
		}
		/** 浮动窗状态（模块级单例，按钮与窗口共享）；groupMode 三态持久化，effectiveGrouped 按其判定，仅 auto 回落实测宽 < 480 的宽度判定。 */
		const floatState = loadFloatState();
		const floatListeners = new Set();
		function setFloatState(patch) {
			Object.assign(floatState, patch);
			for (const fn of [...floatListeners]) fn();
		}
		/** 拖动/缩放结束、开关切换时写盘（不是每帧写）。 */
		function persistFloatState() {
			try {
				if (typeof localStorage === "undefined") return;
				const { x, y, w, h, open, groupMode } = floatState;
				localStorage.setItem(FLOAT_STORAGE_KEY, JSON.stringify({
					x,
					y,
					w,
					h,
					open,
					groupMode
				}));
			} catch {
				// 写盘失败（隐私模式等）不影响本次使用。
			}
		}
		/** 开/关浮动窗（footer 按钮与标题栏 × 共用）；开关即写盘以保住 open 字段。 */
		function toggleFloat() {
			setFloatState({
				open: !floatState.open
			});
			persistFloatState();
		}
		/** 把几何夹回当前视口（至少露出 FLOAT_VISIBLE；先夹尺寸再夹位置）。 */
		function clampFloatState() {
			const vw = typeof window === "object" && typeof window.innerWidth === "number" ? window.innerWidth : 1024;
			const vh = typeof window === "object" && typeof window.innerHeight === "number" ? window.innerHeight : 768;
			floatState.w = Math.min(Math.max(floatState.w, FLOAT_MIN_W), Math.max(FLOAT_MIN_W, vw - 16));
			floatState.h = Math.min(Math.max(floatState.h, FLOAT_MIN_H), Math.max(FLOAT_MIN_H, vh - 16));
			floatState.x = Math.min(Math.max(floatState.x, FLOAT_VISIBLE - floatState.w), Math.max(FLOAT_VISIBLE - floatState.w, vw - FLOAT_VISIBLE));
			floatState.y = Math.min(Math.max(floatState.y, FLOAT_VISIBLE - floatState.h), Math.max(FLOAT_VISIBLE - floatState.h, vh - FLOAT_VISIBLE));
		}
		/** 未完成数徽标（模块级）：apply 里的轮询写入，按钮订阅刷新。 */
		const badge = {
			count: 0,
			listeners: new Set()
		};
		function setBadgeCount(next) {
			if (badge.count === next) return;
			badge.count = next;
			for (const fn of [...badge.listeners]) fn();
		}
		/** 订阅浮动窗开关。 */
		function useFloatOpen() {
			const [open, setOpen] = useState(floatState.open);
			useEffect(() => {
				const sync = () => setOpen(floatState.open);
				floatListeners.add(sync);
				sync();
				return () => {
					floatListeners.delete(sync);
				};
			}, []);
			return open;
		}
		/** 「任务」图标：清单 + 勾（沿用原面板图标造型）；key 供数组子元素使用。 */
		function TaskGlyph(size, key) {
			return h("svg", {
				key,
				viewBox: "0 0 16 16",
				width: size,
				height: size,
				fill: "none",
				stroke: "currentColor",
				strokeWidth: 1.3,
				strokeLinecap: "round",
				strokeLinejoin: "round",
				"aria-hidden": "true"
			}, [
				h("rect", {
					key: "frame",
					x: 2,
					y: 2.5,
					width: 12,
					height: 11,
					rx: 2
				}),
				h("path", {
					key: "check",
					d: "M4.8 7.4l1.3 1.3L9 5.9"
				}),
				h("path", {
					key: "line",
					d: "M4.8 11.4h6.4"
				})
			]);
		}
		/** 徽标样式：窄栏 = 图标右上角圆点；宽栏 = 文本后的计数片。 */
		const BADGE_DOT = {
			position: "absolute",
			top: "-2px",
			right: "-4px",
			minWidth: "14px",
			height: "14px",
			padding: "0 3px",
			borderRadius: "7px",
			background: "var(--dsw-alias-state-error-primary)",
			color: "#fff",
			fontSize: "10px",
			lineHeight: "14px",
			textAlign: "center",
			fontWeight: 600
		};
		const BADGE_CHIP = {
			minWidth: "16px",
			padding: "0 4px",
			borderRadius: "8px",
			background: "var(--dsw-alias-state-error-primary)",
			color: "#fff",
			fontSize: "10px",
			lineHeight: "16px",
			textAlign: "center"
		};
		const badgeText = (count) => count > 99 ? "99+" : String(count);
		/**
		 * 侧栏底部按钮：窄栏只显图标，宽栏显「任务」+ 未完成数；点击开关浮动窗。
		 * 注：per-entry inject 的结果被渲染机按 entry 永久缓存，pending 只作首屏
		 * 快照，实时值经 badge 订阅刷新。
		 * @param props.pending - 注册时的未完成数快照（inject 形状见任务单 §3.4）。
		 * @param props.wide - 侧边栏宽/窄两态（ownerProps，false = 56px rail）。
		 */
		function FooterButton({ pending, wide }) {
			const open = useFloatOpen();
			const [count, setCount] = useState(typeof pending === "number" ? pending : badge.count);
			useEffect(() => {
				const sync = () => setCount(badge.count);
				badge.listeners.add(sync);
				sync();
				return () => {
					badge.listeners.delete(sync);
				};
			}, []);
			const label = `任务（${count} 未完成）`;
			const mark = count > 0 ? badgeText(count) : null;
			if (wide) {
				return h("button", {
					type: "button",
					"aria-label": label,
					title: label,
					onClick: toggleFloat,
					style: {
						display: "flex",
						alignItems: "center",
						gap: "6px",
						border: "none",
						background: "transparent",
						color: "inherit",
						cursor: "pointer",
						padding: "4px 10px",
						borderRadius: "6px",
						fontSize: "12px"
					}
				}, [
					TaskGlyph(16, "icon"),
					h("span", {
						key: "t"
					}, "任务"),
					mark !== null ? h("span", {
						key: "badge",
						style: BADGE_CHIP
					}, mark) : null
				]);
			}
			return h("button", {
				type: "button",
				"aria-label": label,
				title: label,
				onClick: toggleFloat,
				style: {
					position: "relative",
					display: "flex",
					alignItems: "center",
					justifyContent: "center",
					width: "32px",
					height: "32px",
					padding: "0",
					border: "none",
					background: "transparent",
					color: "inherit",
					cursor: "pointer",
					borderRadius: "6px"
				}
			}, [
				TaskGlyph(18, "icon"),
				mark !== null ? h("span", {
					key: "badge",
					style: BADGE_DOT
				}, mark) : null
			]);
		}
		/** F3 帮助内容（6 节，纯静态中文文案）。 */
		const HELP_SECTIONS = [
			{
				title: "① 看板是什么",
				body: "跨会话、跨工作区的全局任务清单：你在面板里建的任务和 agent 用 task_lisk 工具写的是同一份数据，列表每 1.5 秒自动刷新，也可点「刷新」立即拉取。"
			},
			{
				title: "② 任务·子任务·周期",
				body: "输入框回车或点「添加」新建；行内「＋」给任务加子任务（层级上限默认 2，可配）；点行首圆圈在 待办→进行中→完成 间切换；设了每天/每周/每月的任务完成后会自动滚到下一周期。"
			},
			{
				title: "③ 优先级·截止",
				body: "点任务行里的小徽章循环切换 低→中→高→紧急；设了截止时间的任务显示 今天/明天/具体日期，逾期会红字标注「逾期 N 天」。"
			},
			{
				title: "④ 给 agent 用（task_lisk 工具）",
				body: "agent 可以用 task_lisk 工具（list / create / update / complete / remove）读写这份看板；agent 会话内产生的 todo 清单也会自动折叠同步成看板任务，不会重复建同名任务。"
			},
			{
				title: "⑤ 暂停与放行",
				body: "会话可设「每步暂停」「完成一个任务后暂停」或「硬停」；被卡住时在底部对应会话行点「放行」继续，可先填一句放行留言——它会作为补充说明并入该步消息。"
			},
			{
				title: "⑥ 浮动与分组用法",
				body: "标题栏可拖动、右下角可缩放；容器实测宽小于 480px 自动按会话分组、不小于则保持扁平；工具栏「分组」下拉可手动选 自动/扁平/分组 覆盖判定；点组头可折叠/展开该会话；「未分组」始终显示在最后。"
			}
		];
		/**
		 * F3 帮助浮层面板：渲染在 FloatWindow 内部的绝对定位层（不新开席位），
		 * 覆盖看板本体以避免被窄容器裁切；点遮罩、Esc、关闭按钮或再点 ? 均关闭。
		 * @param props.onClose - 关闭回调（遮罩点击 / Esc / 关闭按钮共用）。
		 */
		function HelpPanel({ onClose }) {
			return [
				h("div", {
					key: "backdrop",
					"aria-hidden": "true",
					onClick: onClose,
					style: {
						position: "absolute",
						inset: 0,
						zIndex: 40,
						background: "rgba(0, 0, 0, 0.25)"
					}
				}),
				h("div", {
					key: "panel",
					role: "dialog",
					"aria-label": "任务看板帮助",
					tabIndex: -1,
					autoFocus: true,
					onKeyDown: (event) => {
						if (event.key === "Escape") onClose();
					},
					style: {
						position: "absolute",
						left: "14px",
						right: "14px",
						top: "42px",
						bottom: "14px",
						zIndex: 41,
						overflow: "auto",
						background: "var(--dsw-alias-bg-base)",
						color: "var(--dsw-alias-label-primary)",
						border: "1px solid var(--dsw-alias-border-l1)",
						borderRadius: "10px",
						boxShadow: "0 12px 36px rgba(0, 0, 0, 0.35)",
						padding: "12px 14px",
						fontSize: "12px",
						lineHeight: "19px"
					}
				}, [
					h("div", {
						key: "head",
						style: {
							...S.row,
							marginBottom: "8px"
						}
					}, [
						h("strong", {
							key: "t",
							style: {
								fontSize: "13px"
							}
						}, "任务看板帮助"),
						h("span", {
							key: "spacer",
							style: {
								flex: "1 1 auto"
							}
						}),
						h("button", {
							key: "close",
							type: "button",
							title: "关闭帮助",
							"aria-label": "关闭帮助",
							style: S.btnIcon,
							onClick: onClose
						}, "✕")
					]),
					...HELP_SECTIONS.map((section) => h("div", {
						key: section.title,
						style: {
							marginBottom: "8px"
						}
					}, [
						h("strong", {
							key: "t"
						}, section.title),
						h("div", {
							key: "b",
							style: S.muted
						}, section.body)
					])),
					h("div", {
						key: "hint",
						style: S.muted
					}, "提示：点面板外的暗色区域或按 Esc 也能关闭本帮助。")
				])
			];
		}

		/**
		 * shell.overlay 浮动看板：fixed 定位、标题栏拖拽、右下角缩放；内容为既有 TaskBoard。
		 * 根元素只占窗口本身（overlay 层自身点击穿透，根元素铺满全屏会重新挡住整个 app）。
		 * 指针交互用元素级 setPointerCapture + 元素自身 pointermove/pointerup，
		 * 不用 window 级事件监听（与 window 级定时器同属动态包扣留风险面）。
		 * @param props.rpc - 客户端连接服务的 RPC 客户端。
		 */
		function FloatWindow({ rpc }) {
			const open = useFloatOpen();
			const [, setTick] = useState(0);
			const repaint = useCallback(() => setTick((n) => n + 1), []);
			const [helpOpen, setHelpOpen] = useState(false);
			useEffect(() => {
				if (!open) return;
				clampFloatState();
				repaint();
			}, [open, repaint]);
			if (!open || rpc === undefined) return null;
			const { x, y, w: boxW, h: boxH } = floatState;
			/** 按下后把后续指针事件捕获到当前元素（元素级，不碰 window）。 */
			const trackPointer = (event, onMove) => {
				const target = event.currentTarget;
				target.setPointerCapture(event.pointerId);
				const move = (ev) => {
					onMove(ev);
					clampFloatState();
					repaint();
				};
				const up = () => {
					target.removeEventListener("pointermove", move);
					target.removeEventListener("pointerup", up);
					target.removeEventListener("pointercancel", up);
					persistFloatState();
				};
				target.addEventListener("pointermove", move);
				target.addEventListener("pointerup", up);
				target.addEventListener("pointercancel", up);
			};
			const beginDrag = (event) => {
				if (event.button !== 0) return;
				// 标题栏内的按钮（×）不进入拖拽：pointer capture 会把后续指针
				// 事件重定向到标题栏，吞掉按钮自身的 click。
				if (event.target.closest?.("button")) return;
				const startX = event.clientX - x;
				const startY = event.clientY - y;
				trackPointer(event, (ev) => {
					floatState.x = ev.clientX - startX;
					floatState.y = ev.clientY - startY;
				});
			};
			const beginResize = (event) => {
				if (event.button !== 0) return;
				const startW = boxW;
				const startH = boxH;
				const startX = event.clientX;
				const startY = event.clientY;
				trackPointer(event, (ev) => {
					floatState.w = startW + (ev.clientX - startX);
					floatState.h = startH + (ev.clientY - startY);
				});
			};
			return h("div", {
				role: "dialog",
				"aria-label": "任务看板",
				style: {
					position: "fixed",
					left: `${x}px`,
					top: `${y}px`,
					width: `${boxW}px`,
					height: `${boxH}px`,
					zIndex: 30,
					display: "flex",
					flexDirection: "column",
					background: "var(--dsw-alias-bg-base)",
					color: "var(--dsw-alias-label-primary)",
					border: "1px solid var(--dsw-alias-border-l1)",
					borderRadius: "10px",
					boxShadow: "0 12px 36px rgba(0, 0, 0, 0.35)",
					overflow: "hidden"
				}
			}, [
				h("div", {
					key: "titlebar",
					onPointerDown: beginDrag,
					style: {
						display: "flex",
						alignItems: "center",
						gap: "8px",
						padding: "6px 8px 6px 12px",
						cursor: "move",
						userSelect: "none",
						touchAction: "none",
						background: "var(--dsw-alias-bg-layer-1)",
						borderBottom: "1px solid var(--dsw-alias-border-l1)"
					}
				}, [
					h("span", {
						key: "title",
						style: {
							flex: "1 1 auto",
							fontSize: "13px",
							fontWeight: 600
						}
					}, "任务"),
					h("button", {
						key: "help",
						type: "button",
						title: "帮助",
						"aria-label": "看板帮助",
						"aria-expanded": helpOpen ? "true" : "false",
						style: S.btnIcon,
						onKeyDown: (event) => {
							if (event.key === "Escape") setHelpOpen(false);
						},
						onClick: () => setHelpOpen((v) => !v)
					}, "?"),
					h("button", {
						key: "close",
						type: "button",
						title: "关闭",
						"aria-label": "关闭任务看板",
						style: S.btnIcon,
						onClick: toggleFloat
					}, "✕")
				]),
				h("div", {
					key: "body",
					style: {
						flex: "1 1 auto",
						minHeight: "0",
						display: "flex",
						flexDirection: "column"
					}
				}, h(TaskBoard, {
					rpc
				})),
				h("div", {
					key: "resize",
					onPointerDown: beginResize,
					"aria-hidden": "true",
					style: {
						position: "absolute",
						right: 0,
						bottom: 0,
						width: "16px",
						height: "16px",
						cursor: "nwse-resize",
						touchAction: "none",
						background: "linear-gradient(135deg, transparent 50%, var(--dsw-alias-border-l2) 50%)"
					}
				}),
				...(helpOpen ? HelpPanel({ onClose: () => setHelpOpen(false) }) : [])
			]);
		}

		/** 供冒烟测试与后续维护使用的内部函数（非插件公开面）。 */
		const __internals = {
			flatten,
			fmtDue,
			shortId,
			countPending,
			PRIORITY_LABEL,
			POLICY_LABEL,
			REPEAT_LABEL,
			GROUP_BREAKPOINT,
			COLLAPSED_STORAGE_KEY,
			GROUP_MODES,
			GROUP_MODE_LABEL,
			effectiveGrouped,
			groupBySession,
			renderSessionGroups,
			floatState,
			setFloatState,
			persistFloatState,
			collapsedMap,
			toggleCollapsed,
			sessionInfo,
			setSessionInfo,
			syncSessionIdentity,
			resolveSessionIdentity,
			payloadWithSession,
			HELP_SECTIONS,
			HelpPanel,
			NUDGE_STORAGE_KEY,
			todayKey,
			nudgeNeed,
			nudgeText
		};
		/** 插件名即配置项 id。 */
		const name = "task-lisk";
		/** 客户端需要的服务：槽位注册表 + 连接（RPC）+ 定时器（徽标轮询）。 */
		const inject = ["slots", "connection", "timer"];
		/** 批 2 追加 sessions（当前会话标识，§3.3 来源 A）；timer 声明门保留（verify-bundle D6 锚定此声明行），只增不改。 */
		const clientInject = [...inject, "sessions"];
		/**
		 * 注册浮动看板（shell.overlay）与侧栏底部开关（sidebar.footer.action）。
		 * @param ctx - 客户端根上下文。
		 */
		function apply(ctx) {
			const connection = ctx.connection;
			/** 未完成数轮询：经 timer 服务驱动（动态包内 window 级定时器被扣留，禁用）；先立即拉一次，避免首轮询前徽标长时间显 0。 */
			ctx.effect(() => {
				const poll = () => {
					void call(connection.rpc, "list", {}).then((result) => {
						if (result?.ok) setBadgeCount(countPending(result.value?.tasks));
					}).catch(() => {});
				};
				poll();
				return ctx.interval(poll, 15000);
			}, "task-lisk: badge polling");
			/** 当前会话标识轮询（§3.3 来源 A）：sessions 门面存在才订阅；任何异常都不得影响看板。 */
			const sessionsFace = readSessionsFace(ctx);
			if (sessionsFace !== null) {
				ctx.effect(() => {
					const syncSessions = () => {
						try {
							syncSessionIdentity(sessionsFace.list.getSnapshot(), sessionsFace);
						} catch {
							// 会话服务形状异常不影响看板主功能。
						}
					};
					syncSessions();
					return ctx.interval(syncSessions, 15000);
				}, "task-lisk: session identity polling");
			}
			ctx.slots.inject("sidebar.footer.action", () => ctx.slots.register({
				name: "sidebar.footer.action",
				id: PANEL_ID,
				order: 20,
				label: "任务",
				inject: () => ({ rpc: connection.rpc, pending: badge.count })
			}, FooterButton));
			ctx.slots.inject("shell.overlay", () => ctx.slots.register({
				name: "shell.overlay",
				id: `${PANEL_ID}.float`,
				order: 100,
				label: "任务看板",
				inject: () => ({ rpc: connection.rpc, pending: badge.count })
			}, FloatWindow));
		}

		exports.TaskBoard = TaskBoard;
		exports.apply = apply;
		exports.inject = clientInject;
		exports.name = name;
		exports.__internals = __internals;
		return module.exports;
	}
});
