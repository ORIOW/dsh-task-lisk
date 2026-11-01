/**
 * 把只读参考源码从 app.asar / profile 里复制进工作区 `research/refs/`，
 * 以便用文件工具直接阅读（文件工具拒绝 asar 内路径与 pnpm 符号链路径）。
 * 纯只读源目录提取，不修改任何安装位置。
 */
import fs from "node:fs";
import path from "node:path";

const RESOURCES = "C:/Users/A005490/AppData/Local/Programs/DSH Desktop/resources";
const ASAR_NODE_MODULES = `${RESOURCES}/app.asar/node_modules`;
const PROFILE_NODE_MODULES = "C:/Users/A005490/AppData/Roaming/dsh-desktop/harness/profiles/web/node_modules";
const OUT = path.resolve("research/refs");

fs.mkdirSync(OUT, { recursive: true });

/** 列出归档内 @deepseek-ai 包名。 */
let scopeNames = [];
try {
	scopeNames = fs.readdirSync(`${ASAR_NODE_MODULES}/@deepseek-ai`);
} catch (error) {
	console.log(`readdir @deepseek-ai failed: ${String(error)}`);
}
fs.writeFileSync(path.join(OUT, "_deepseek-ai-packages.txt"), `${scopeNames.sort().join("\n")}\n`);
console.log(`@deepseek-ai 包数：${scopeNames.length}`);

const SHORTLIST = scopeNames.filter((name) => /storage-domain|(^|-)tools$|tool-todo|dsh-llm|agent|guard|pause|schedule/.test(name));
console.log(`关注包：${SHORTLIST.join(", ")}`);

const CANDIDATES = [
	...SHORTLIST.map((name) => [`@deepseek-ai/${name}`, ASAR_NODE_MODULES]),
	["dsh-pause", PROFILE_NODE_MODULES],
	["dsh-pause", ASAR_NODE_MODULES]
];

const written = [];
for (const [packageName, root] of CANDIDATES) {
	const packageDir = path.join(root, ...packageName.split("/"));
	let entry;
	try {
		const manifest = JSON.parse(fs.readFileSync(path.join(packageDir, "package.json"), "utf8"));
		entry = typeof manifest.main === "string" ? manifest.main : "lib/index.js";
		const exportRoot = manifest.exports?.["."];
		if (typeof exportRoot === "string") entry = exportRoot;
		else if (typeof exportRoot === "object" && typeof exportRoot.default === "string") entry = exportRoot.default;
		else if (typeof exportRoot === "object" && typeof exportRoot.import === "string") entry = exportRoot.import;
	} catch (error) {
		console.log(`跳过 ${packageName}（${root.includes("profiles") ? "profile" : "asar"}）：${String(error.code ?? error)}`);
		continue;
	}
	const source = path.join(packageDir, entry);
	const label = `${packageName.replace(/[@/]/g, "_")}__${entry.replace(/[\\/]/g, "_")}`;
	try {
		const text = fs.readFileSync(source, "utf8");
		fs.writeFileSync(path.join(OUT, label), text);
		written.push(`${label} (${text.length} B) ← ${source}`);
	} catch (error) {
		console.log(`读取失败 ${packageName}/${entry}：${String(error.code ?? error)}`);
	}
}
console.log(`\n已复制 ${written.length} 个参考文件到 research/refs/：`);
for (const line of written) console.log(`  ${line}`);