/**
 * 用 cordis 真正使用的解析入口（config schema 的 Standard-Schema `~standard.validate`，
 * 见 @deepseek-ai/cordis/lib/index.js:958 `runtime.Config["~standard"].validate(config)`）
 * 判定插件 Config 的默认值在运行时到底是标量还是 volatile 代理。
 */
import { Config } from "./dsh-task-lisk/lib/index.js";

const std = Config["~standard"];
console.log("has ~standard:", Boolean(std), "keys:", Object.keys(std ?? {}).join(","));
const result = std.validate({});
const value = result.value ?? result;
console.log("validate({}) ->", JSON.stringify(value));
for (const key of ["enabled", "autoImportTodos", "defaultPolicy", "maxDepth"]) {
	const raw = value[key];
	console.log(`  ${key}: typeof=${typeof raw} ctor=${raw?.constructor?.name} str=${String(raw)} ===true:${raw === true} valueOf=${typeof raw?.valueOf === "function" ? String(raw.valueOf()) : "n/a"}`);
}
const overridden = (std.validate({ maxDepth: 3, defaultPolicy: "stop" }).value ?? {});
console.log("override -> maxDepth:", overridden.maxDepth, "typeof:", typeof overridden.maxDepth, "===3:", overridden.maxDepth === 3, "| defaultPolicy:", String(overridden.defaultPolicy));