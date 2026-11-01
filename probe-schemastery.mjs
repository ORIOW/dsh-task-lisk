/** 判定 schemastery 的调用形式是否是「解析默认值」的 API（决定 Config 默认值是否真的生效）。 */
import z from "@deepseek-ai/schemastery";
import { Config as hostConfig } from "./dsh-task-lisk/lib/index.js";

const show = (label, fn) => {
	try {
		console.log(label, "=", JSON.stringify(fn()));
	} catch (error) {
		console.log(label, "THROW", error instanceof Error ? error.message : String(error));
	}
};

const s = z.object({
	a: z.boolean().default(true).volatile(),
	b: z.number().default(2),
	c: z.string()
});

show("skeleton s({})", () => s({}));
show("skeleton s({a:false,b:9,c:'x'})", () => s({ a: false, b: 9, c: "x" }));
show("typeof s.resolve", () => typeof s.resolve);
show("s.resolve({})", () => (typeof s.resolve === "function" ? s.resolve({}) : "no resolve"));
show("typeof s.simplify", () => typeof s.simplify);
show("host Config({})", () => hostConfig({}));
show("typeof hostConfig.resolve", () => typeof hostConfig.resolve);
show("hostConfig.resolve({})", () => (typeof hostConfig.resolve === "function" ? hostConfig.resolve({}) : "no resolve"));