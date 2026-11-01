/**
 * 只读 ESM 解析钩子：让工作区里的插件源码**不改动任何文件**就能解析到
 * DSH 运行时真正会用的那些裸包（`@deepseek-ai/*`、`zod`、`react*`）。
 *
 * 2026-10-17 更新（旧版已失效）：DSH Desktop 更新后，官方包**不再**解包到
 * `resources/app.asar.unpacked/node_modules`，而是只存在于 `resources/app.asar`
 * **归档内部**；同时 `.desktop-bin/node.cmd` 实测是 Electron 运行时
 * （报错栈里出现 `node:electron/js2c/node_init`），它自带 asar 的 fs 垫片，
 * 因此「把解析锚点放到 `<resources>/app.asar/node_modules/` 之下」就能让 ESM
 * 解析读出归档内的包 —— 这正是 DSH 自己的 `resources/host-module-fallback.mjs`
 * 对插件做的事（把 `@deepseek-ai/*` 回落到 installation anchor）。
 *
 * 顺序：先按插件自身的正常解析；失败后再依次回落到
 *   ① app.asar/node_modules  ② app.asar 根部  ③ app.asar.unpacked（旧布局）
 *   ④ web profile（react / schemastery 等 profile 侧副本）
 * 顺序即优先级：优先命中 DSH 运行时真正加载的那一份，避免版本漂移误判。
 */
import { registerHooks } from "node:module";
import { pathToFileURL } from "node:url";

const RESOURCES = "C:/Users/A005490/AppData/Local/Programs/DSH Desktop/resources";

/** 解析回落锚点（文件不必存在，只用来确定 node_modules 搜索链）。 */
export const RESOLUTION_BASES = [
	`${RESOURCES}/app.asar/node_modules/__probe__.mjs`,
	`${RESOURCES}/app.asar/__probe__.mjs`,
	`${RESOURCES}/app.asar.unpacked/node_modules/__probe__.mjs`,
	"C:/Users/A005490/AppData/Roaming/dsh-desktop/harness/profiles/web/__probe__.mjs"
].map((entry) => pathToFileURL(entry).href);

const BARE = /^(@deepseek-ai\/|zod$|zod\/|schemastery$|react$|react-dom(\/|$)|semver$|js-yaml$)/;

/** 可回落的解析失败：包不存在，或找到的那份比导入方需要的子路径旧。 */
const RETRYABLE = new Set(["ERR_MODULE_NOT_FOUND", "ERR_PACKAGE_PATH_NOT_EXPORTED"]);

registerHooks({
	resolve(specifier, context, nextResolve) {
		let firstError;
		try {
			return nextResolve(specifier, context);
		} catch (error) {
			firstError = error;
			if (!BARE.test(specifier) || !RETRYABLE.has(error?.code)) throw error;
		}
		const attempts = [];
		for (const parentURL of RESOLUTION_BASES) {
			try {
				const resolved = nextResolve(specifier, {
					...context,
					parentURL
				});
				if (attempts.length > 0) {
					process.emitWarning(`[smoke-loader] ${specifier} 由回落锚点 ${parentURL} 解析（前 ${attempts.length} 个锚点未命中）`, {
						code: "DSH_SMOKE_FALLBACK"
					});
				}
				return resolved;
			} catch (error) {
				attempts.push(`${parentURL} → ${error?.code ?? error?.message}`);
			}
		}
		firstError.message += `\n  smoke-loader 回落全部未命中:\n    ${attempts.join("\n    ")}`;
		throw firstError;
	}
});