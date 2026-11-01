/**
 * 取证：官方 `@deepseek-ai/*` 包现在只在 `resources/app.asar` 归档内部，
 * 而 `.desktop-bin/node.cmd` 实测是 Electron（自带 asar fs 垫片）。
 * 这里验证「把解析锚点放到 app.asar/node_modules/ 之下」能否让纯 Node 侧
 * 的 ESM 解析读到归档内的包（等价 DSH 自己的 host-module-fallback 行为）。
 */
import { registerHooks } from "node:module";
import { pathToFileURL } from "node:url";

const RESOURCES = "C:/Users/A005490/AppData/Local/Programs/DSH Desktop/resources";
const BASES = [
	`${RESOURCES}/app.asar/node_modules/__probe__.mjs`,
	`${RESOURCES}/app.asar.unpacked/node_modules/__probe__.mjs`,
	`${RESOURCES}/app.asar/__probe__.mjs`,
	"C:/Users/A005490/AppData/Roaming/dsh-desktop/harness/profiles/web/__probe__.mjs"
].map((entry) => pathToFileURL(entry).href);

const PROBES = [
	"@deepseek-ai/dsh-storage-domain",
	"@deepseek-ai/dsh-tools",
	"@deepseek-ai/dsh-llm",
	"@deepseek-ai/schemastery",
	"zod",
	"react",
	"react-dom/server"
];

registerHooks({
	resolve(specifier, context, nextResolve) {
		try {
			return nextResolve(specifier, context);
		} catch (first) {
			for (const parentURL of BASES) {
				try {
					return nextResolve(specifier, { ...context, parentURL });
				} catch (error) {
					// 继续试下一个锚点
				}
			}
			throw first;
		}
	}
});

for (const specifier of PROBES) {
	try {
		const resolved = import.meta.resolve(specifier);
		console.log(`OK   ${specifier} → ${resolved}`);
	} catch (error) {
		console.log(`FAIL ${specifier} → ${error.code ?? error.message}`);
	}
}