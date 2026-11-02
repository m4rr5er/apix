import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import vm from "node:vm";

// 导致用户 pi 配置里的 defaultProvider/defaultModel 不出现在切回后的会话

function loadResolver() {
	const source = readFileSync("src/renderer/src/utils/backendSwitchDefaults.ts", "utf8");
	const output = ts.transpileModule(source, {
		compilerOptions: {
			module: ts.ModuleKind.CommonJS,
			target: ts.ScriptTarget.ES2022,
			esModuleInterop: true,
		},
		fileName: "backendSwitchDefaults.ts",
	}).outputText;
	const module = { exports: {} };
	vm.runInNewContext(
		output,
		{
			module,
			exports: module.exports,
			require: () => ({}),
		},
		{ filename: "backendSwitchDefaults.ts" },
	);
	return module.exports.resolveBackendSwitchDefaults;
}

const resolve = loadResolver();

// vm 独立 realm 里创建的对象原型不同，deepEqual 会误报；JSON 往返归一到宿主 realm。
const plain = (value) => (value && typeof value === "object" ? JSON.parse(JSON.stringify(value)) : value);

test("切到 imagegen：独立生图配置，record 同样清空", () => {
	assert.deepEqual(
		plain(
			resolve("imagegen", {
				model: { provider: "thetoken", modelId: "deepseek-v4-flash-0731" },
				thinkingLevel: "max",
			}),
		),
		{ model: null, thinkingLevel: null },
	);
});

test("切到 acp：模型由 agent CLI 自决（ACP session/config options），record 清空", () => {
	assert.deepEqual(
		plain(
			resolve("acp", {
				model: { provider: "thetoken", modelId: "deepseek-v4-flash-0731" },
				thinkingLevel: "max",
			}),
		),
		{ model: null, thinkingLevel: null },
	);
});
