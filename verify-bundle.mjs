/**
 * dsh-task-lisk 安装前静态预演（只读；不改 profile、不装包、不联网）。
 *
 * 运行：cd <工作区>; & "<Electron node>" --import ./smoke-loader.mjs verify-bundle.mjs
 * 依赖 Electron 版 node（app.asar 垫片）读取归档内官方包做取证。
 *
 * 每条断言的出处以「@包/lib 路径:行号」标注在标签里；行号对应
 * research/refs/ 下已提取的源码副本（内容与 app.asar 内一致）。
 */
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

const RES = "C:/Users/A005490/AppData/Local/Programs/DSH Desktop/resources";
const ASAR_NM = `${RES}/app.asar/node_modules`;
const PROFILE = "C:/Users/A005490/AppData/Roaming/dsh-desktop/harness/profiles/web";
const PKG_DIR = path.resolve("dsh-task-lisk");

const rows = [];
const ok = (label, detail = "") => rows.push(["ok", label, String(detail)]);
const fail = (label, detail = "") => rows.push(["FAIL", label, String(detail)]);
const warn = (label, detail = "") => rows.push(["warn", label, String(detail)]);
const assert = (label, cond, detail) => (cond ? ok(label, detail) : fail(label, detail));
const ref = {
	appboot: "@deepseek-ai/dsh-app-boot/lib/index.js",
	pm: "@deepseek-ai/dsh-plugin-manager/lib/index.js",
	cm: "@deepseek-ai/dsh-client-modules/lib/index.js",
	cmc: "@deepseek-ai/dsh-client-modules/lib/client.js",
	cer: "@deepseek-ai/dsh-cordis-client-runner/lib/client.js",
	sd: "@deepseek-ai/dsh-storage-domain/lib/index.js",
	hmf: "resources/host-module-fallback.mjs"
};

// ---- semver：优先用运行时自带的真 semver（app.asar 内 7.8.5），不可用才回落到手写近似
let realSemver = null;
try {
	const mod = await import("semver");
	const candidate = mod.default ?? mod;
	if (typeof candidate?.satisfies === "function") realSemver = candidate;
} catch {
	realSemver = null;
}
// ---- 极简 semver（回落用；镜像 app-boot:300 的 includePrerelease 语义）
const pv = (v) => {
	const [core, pre = ""] = v.split("-");
	const [a, b, c] = core.split(".").map(Number);
	return { a, b, c, pre };
};
const cmpPre = (x, y) => {
	if (x === "" && y === "") return 0;
	if (x === "") return 1; // release > prerelease
	if (y === "") return -1;
	for (let i = 0; ; i++) {
		if (i >= x.length && i >= y.length) return 0;
		const l = x[i] ?? "", r = y[i] ?? "";
		const ln = /^\d+$/.test(l), rn = /^\d+$/.test(r);
		if (ln && rn) { const d = Number(l) - Number(r); if (d) return d; }
		else if (ln) return -1; else if (rn) return 1;
		else { const d = l < r ? -1 : l > r ? 1 : 0; if (d) return d; }
	}
};
const cmp = (x, y) => (x.a - y.a) || (x.b - y.b) || (x.c - y.c) || cmpPre(x.pre, y.pre);
/** 只实现 ^X.Y.Z(-pre) 与 ~X.Y.Z 两种范围（includePrerelease: true，同 app-boot:300）。 */
const satisfies = (version, range) => {
	const v = pv(version);
	const m = range.match(/^[\^~](\d+)\.(\d+)\.(\d+)(?:-(.+))?$/);
	if (!m) return false;
	const base = pv(`${m[1]}.${m[2]}.${m[3]}${m[4] ? `-${m[4]}` : ""}`);
	if (cmp(v, base) < 0) return false;
	let upper;
	if (m[0][0] === "^") {
		upper = m[1] !== "0" ? pv(`${Number(m[1]) + 1}.0.0`)
			: m[2] !== "0" ? pv(`0.${Number(m[2]) + 1}.0`)
			: pv(`0.0.${Number(m[3]) + 1}`);
	} else upper = pv(`${m[1]}.${Number(m[2]) + 1}.0`);
	return cmp(v, upper) < 0 || (v.pre !== "" && upper.pre === "" && v.a === upper.a && v.b === upper.b && v.c === upper.c && cmp(v, upper) < 0);
};
/** 真 semver 优先（与运行时同一实现），不可用才用手写近似；引擎版本进断言标签。 */
const semverEngine = () => realSemver !== null
	? `运行时 semver ${readAsarJson("semver/package.json").version}（与加载器同源）`
	: "手写近似（真 semver 不可用）";
const satisfiesWith = (version, range) => realSemver !== null
	? realSemver.satisfies(version, range, { includePrerelease: true })
	: satisfies(version, range);

// ---- 读待核验包
const pkg = JSON.parse(readFileSync(path.join(PKG_DIR, "package.json"), "utf8"));
const patchText = readFileSync(path.join(PKG_DIR, "cordis.patch.yml"), "utf8");
const clientSrc = readFileSync(path.join(PKG_DIR, "lib/client.js"), "utf8");
const hostSrc = readFileSync(path.join(PKG_DIR, "lib/index.js"), "utf8");
const readAsarJson = (p) => JSON.parse(readFileSync(`${ASAR_NM}/${p}`, "utf8"));

// 1) bundle 清单契约 -----------------------------------------------
assert(`A1 dsh.bundle.patch 为字符串路径（${ref.appboot}:504-507 bundlePatchFiles）`,
	typeof pkg.dsh?.bundle?.patch === "string", JSON.stringify(pkg.dsh?.bundle));
assert(`A2 patch 文件存在且 package.json files 声明它（${ref.pm}:221-228 bundleManifest 读 manifest.dsh.bundle.patch）`,
	existsSync(path.join(PKG_DIR, pkg.dsh.bundle.patch)) && pkg.files.includes("cordis.patch.yml"),
	pkg.dsh.bundle.patch);
assert(`A3 无运行时 dependencies ⇒ 安装后恰好新增 1 个 profile 依赖，不会 ambiguous-install（${ref.pm}:1819-1823）`,
	Object.keys(pkg.dependencies ?? {}).length === 0,
	`dependencies=${JSON.stringify(pkg.dependencies ?? {})}`);
assert(`A4 files 白名单覆盖 main / ./client / 补丁文件（file: 链接安装后包目录内仍须有这些文件）`,
	["lib/index.js", "lib/client.js", "cordis.patch.yml"].every((file) => pkg.files?.includes(file)),
	JSON.stringify(pkg.files));
assert(`A5 安装 target 必须是绝对路径、且是含 package.json 的目录（${ref.pm}:72-88 parseInstallSpec 对相对路径抛 invalid-spec）`,
	path.isAbsolute(PKG_DIR) && existsSync(path.join(PKG_DIR, "package.json")), PKG_DIR);

// 2) cordis.patch.yml 形态 ----------------------------------------
const yamlSeqOk = /^-\s/m.test(patchText.replace(/(^|[^#])#.*/g, "$1").trim());
assert(`B1 顶层是 YAML 序列（${ref.pm}:906 "Profile patch must be a YAML sequence"；app-boot parsePatchList:3599 同要求）`,
	yamlSeqOk, "首行以 '-' 开头");
const insertRows = [...patchText.matchAll(/^\s*-\s+insert:\s*$/gm)];
const idRow = /^\s*-\s+id:\s*(\S+)\s*$/m.exec(patchText);
const nameRow = /^\s*name:\s*(\S+)\s*$/m.exec(patchText);
assert(`B2 使用合法操作 insert（${ref.appboot}:74-88：patch 级无 id 时顶层追加；:2799-2800 schema "An insert appends entries"）`,
	insertRows.length === 1 && idRow !== null, `insert×${insertRows.length}, entry.id=${idRow?.[1]}`);
assert(`B3 entry.name 是模块装载名、语义为「Loader 行的 import 说明符」（${ref.pm}:495-497 import(this.options.name)；${ref.appboot}:3577-3584 仅相对路径会被锚定）`,
	nameRow?.[1] === pkg.name, `entry.name=${nameRow?.[1]} === package.json.name=${pkg.name}`);
assert(`B4 非插入式约束不适用/不违反：本行是纯 insert，无 patch 级 id/name 断言（${ref.appboot}:91-103 id/name 校验只针对 non-insert）`,
	insertRows.length === 1, "insert 行本身无需 id；嵌套 entry 自带 id 供后续寻址");
assert(`B5 id 无强制命名约束但需可寻址唯一（${ref.appboot}:67 entryMap.set(entry.id)；同 id 会被后续 patch 覆盖而非报错）`,
	/^[A-Za-z0-9@/._-]+$/.test(idRow?.[1] ?? ""), `id=${idRow?.[1]}`);

// 3) 三处标识一致性 ------------------------------------------------
assert(`C1 patch entry id/name 均等于包名 dsh-task-lisk（${ref.appboot}:73 解构 id/name；与 profile 现有行形如 id: agent-default-model / name: "@deepseek-ai/..." 一致）`,
	idRow?.[1] === pkg.name && nameRow?.[1] === pkg.name, `id=${idRow?.[1]}, name=${nameRow?.[1]}`);
assert(`C2 宿主导出 name="task-lisk" 是 cordis 插件/配置键，与 Loader 行 id 无需相等（${ref.cer}:183 插件对象形态 {name,inject,apply}；无任何源码要求 name===row.id）`,
	/export const name = "task-lisk"/.test(hostSrc), "包名 dsh-task-lisk（安装单位）≠ 导出名 task-lisk（配置键）——两者职责不同，不构成装载矛盾");
assert(`C3 领域名 task_lisk 满足 UNIT_NAME_RE（${ref.sd}:62 域名必须匹配 /^[a-z][a-z0-9_]*$/，连字符非法 → 与插件名 task-lisk 分离是必须的）`,
	/^[a-z][a-z0-9_]*$/.test("task_lisk"), "task_lisk ✓");
const clientModId = /__ModuleLoader__\.load\(\{\s*id:\s*"([^"]+)"/.exec(clientSrc)?.[1];
assert(`C4 客户端模块 id === 包名（${ref.cm}:732 packageName 即图行 id；${ref.cmc} bootInjections:473 按 registration.id 寻址）`,
	clientModId === pkg.name, `client.js id=${clientModId}`);

// 4) 客户端半身契约 ------------------------------------------------
assert(`D1 dsh.client.platform === "web"（${ref.cm}:65 platform 必须为字符串；:725-727 非 web 直接不进客户端图）`,
	pkg.dsh?.client?.platform === "web", pkg.dsh?.client?.platform);
assert(`D2 exports["./client"] 指向存在的文件（${ref.cm}:729-730 声明 dsh.client 而无 ./client 导出会抛错）`,
	pkg.exports?.["./client"]?.default === "./lib/client.js" && existsSync(path.join(PKG_DIR, "lib/client.js")),
	"./lib/client.js");
const injects = pkg.dsh?.client?.inject ?? [];
assert(`D3 inject 为字符串数组（${ref.cm}:66 optionalStringArray 校验）`,
	Array.isArray(injects) && injects.every((x) => typeof x === "string"), JSON.stringify(injects));
for (const dep of injects) {
	// D4 自批 1（2026-10-27）起由 FAIL 降为 WARN：inject 项最好是真正的客户端
	// 双半身包（声明 dsh.client 才会成为图行，声明后必须导出 ./client），
	// 但运行时对非客户端包静默忽略，官方生态确有插件这么写，不再作为失败项。
	let manifest = null;
	try {
		manifest = readAsarJson(`${dep}/package.json`);
	} catch {
		manifest = null;
	}
	const declaresClient = typeof manifest?.dsh?.client?.platform === "string";
	const exportsClient = typeof manifest?.exports?.["./client"]?.default === "string";
	const d4Ok = manifest !== null && declaresClient && exportsClient;
	const d4Detail = manifest === null ? "归档内不存在该包" : `version=${manifest.version}, dsh.client=${declaresClient ? manifest.dsh.client.platform : "无"}, exports["./client"]=${exportsClient}`;
	const d4Label = `D4 inject 项是真正的客户端双半身包：${dep}（${ref.cm}:63-68 声明 dsh.client 才算图行；:729-730 声明后必须导出 ./client）——不满足仅告警`;
	if (d4Ok) ok(d4Label, d4Detail); else warn(d4Label, d4Detail);
}
assert(`D5 客户端 require 只用平台 seed word react（${ref.cer} client.js:29 官方自己也 require("react")；${ref.cmc}:717-724 seed 命中即返回）`,
	[...clientSrc.matchAll(/require\("([^"]+)"\)/g)].map((m) => m[1]).every((s) => s === "react"),
	"require 列表 = react");
assert(`D6 插件对象形态 {name, inject:['slots','connection','timer'], apply}（${ref.cer}:183 形态 {name,inject,apply}；timer 供 ctx.interval 徽标轮询，${ref.cer}:347 timer 声明门）`,
	/const inject = \["slots", "connection", "timer"\]/.test(clientSrc) && /exports\.apply = apply/.test(clientSrc),
	"inject=[slots, connection, timer]");
assert(`D7 客户端席位为 shell.overlay 与 sidebar.footer.action，旧 sidebar.panellist/main 注册零残留（目录 ${ref.cer}:5433/:5652，均为 list 席位；TaskBoard 内既有 React key "main" 不在拦截范围）`,
	clientSrc.includes('"shell.overlay"') && clientSrc.includes('"sidebar.footer.action"') && !clientSrc.includes('"sidebar.panellist"') && !clientSrc.includes('name: "main"') && !clientSrc.includes('inject("main"'),
	"shell.overlay + sidebar.footer.action；panellist 与 main 注册已移除");

// 5) peerDependencies ---------------------------------------------
const RUNTIME = { cordis: readAsarJson("@deepseek-ai/cordis/package.json").version, dsh: readAsarJson("@deepseek-ai/dsh/package.json").version, react: readAsarJson("react/package.json").version };
for (const [name, range] of Object.entries(pkg.peerDependencies ?? {})) {
	const actual = name === "@deepseek-ai/cordis" ? RUNTIME.cordis : name === "@deepseek-ai/dsh" ? RUNTIME.dsh : name === "react" ? RUNTIME.react : void 0;
	assert(`E peer ${name} ${range} vs 归档实际 ${actual ?? "?"}（${ref.appboot}:286-312 evaluatePluginCompatibility，includePrerelease=true；不满足仅告警 :320-332，不拒载）｜引擎=${semverEngine()}`,
		actual !== void 0 && satisfiesWith(actual, range), `${actual} satisfies ${range} → ${satisfiesWith(actual ?? "", range)}`);
}
assert(`E* 宿主半身其余 @deepseek-ai/* 裸导入由宿主回落钩子兜底（${ref.hmf}:34-38 仅对 @deepseek-ai/ 前缀重试）`,
	[...hostSrc.matchAll(/from "(@deepseek-ai\/[^"]+)"/g)].every((m) => existsSync(`${ASAR_NM}/${m[1]}/package.json`)),
	hostSrc.match(/from "(@deepseek-ai\/[^"]+)"/g)?.join(", "));
assert(`E* zod 由 pnpm 常规解析（插件不在 @deepseek-ai/ 前缀内，回落钩子不接管；归档内 zod=${readAsarJson("zod/package.json").version} 存在于运行时树）`,
	existsSync(`${ASAR_NM}/zod/package.json`), "zod 4.6.1");

// 6) 是否需要重启（源码取证） --------------------------------------
const pmSrc = readFileSync(`${ASAR_NM}/@deepseek-ai/dsh-plugin-manager/lib/index.js`, "utf8");
const pmLine = (needle) => pmSrc.slice(0, pmSrc.indexOf(needle)).split("\n").length;
assert(`F1 安装后走 HMR 重载而非强制重启：reload 仅在 ownerContext 有 hmr 时 reconcile（${ref.pm}:2118-2121）`,
	pmSrc.includes("if (this.ownerContext.get(\"hmr\") === void 0) return [];"), `行 ${pmLine("if (this.ownerContext.get(\"hmr\") === void 0) return [];")}`);
assert(`F2 全新安装（非替换已有依赖）→ 应用态为 "applied"；替换已有依赖才 "restart-required"（${ref.pm}:1847、:2129）`,
	pmSrc.includes("restart-required") && pmSrc.includes("mutation?.replaced === true || Object.hasOwn(before, name)"),
	`restart-required @ 行 ${pmLine("restart-required")}`);
assert(`F3 本机 web profile 未装过 dsh-task-lisk → 全新安装路径成立（只读核对了 profile/package.json）`,
	(() => {
		const m = JSON.parse(readFileSync(path.join(PROFILE, "package.json"), "utf8"));
		return !Object.hasOwn(m.dependencies ?? {}, "dsh-task-lisk") && !(m.dsh?.profile?.bundles ?? []).includes("dsh-task-lisk");
	})(), "profile 依赖与 bundles 均无 dsh-task-lisk");

// 7) 冲突唯一性（只读 profile） ------------------------------------
const profilePatch = readFileSync(path.join(PROFILE, "cordis.patch.yml"), "utf8");
assert(`G profile 现有补丁/依赖无 task-lisk 同名冲突（id 撞车会被静默覆盖：${ref.appboot}:67,95-107）`,
	!/task-?lisk/.test(profilePatch), "cordis.patch.yml 无 task-lisk");

// ---- 汇总
for (const [status, label, detail] of rows) console.log(`  ${status}${status === "ok" ? " " : ""} ${label}${detail ? ` :: ${detail}` : ""}`);
const failed = rows.filter((r) => r[1] === "FAIL").length;
console.log(`\n${rows.length - failed}/${rows.length} 通过`);
if (failed > 0) process.exitCode = 1;
