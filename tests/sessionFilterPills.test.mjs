import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import vm from "node:vm";

function transpile(filePath) {
	return ts.transpileModule(readFileSync(filePath, "utf8"), {
		compilerOptions: {
			module: ts.ModuleKind.CommonJS,
			target: ts.ScriptTarget.ES2022,
		},
	}).outputText;
}

function loadModule() {
	const sandbox = {
		exports: {},
		require: (specifier) => {
			// 本模块只有类型导入，编译后应无运行时 require；出现即测试装载失败。
			throw new Error(`Unexpected import: ${specifier}`);
		},
	};
	vm.runInNewContext(transpile("src/renderer/src/sessionFilterPills.ts"), sandbox, {
		filename: "sessionFilterPills.ts",
	});
	return sandbox.exports;
}

const { sessionPillOf, filterSessionsByPills, pillsPresentIn, isSessionFilterPill, parseSessionFilterState, serializeSessionFilterState, SESSION_FILTER_PILLS } = loadModule();

test("sessionPillOf: imagegen 会话按 backend 归属，不落入 Pi 类别（source 恒为 pi）", () => {
	assert.equal(sessionPillOf({ source: "pi", backend: "imagegen" }), "imagegen");
	assert.equal(sessionPillOf({ source: undefined, backend: "imagegen" }), "imagegen");
});

test("sessionPillOf: 导入来源按 source 归属", () => {
	assert.equal(sessionPillOf({ source: "codex", backend: "pi" }), "codex");
	assert.equal(sessionPillOf({ source: "claude", backend: "pi" }), "claude");
	assert.equal(sessionPillOf({ source: "opencode", backend: "pi" }), "opencode");
	assert.equal(sessionPillOf({ source: "cursor", backend: "pi" }), "cursor");
});

test("v1 旧格式：null 项目保持全部显示", () => {
	const state = parseSessionFilterState(JSON.stringify({ project: null }));
	assert.equal(state.project, null);
});

test("损坏输入返回空配置（全部显示）", () => {
	assert.deepEqual(Object.keys(parseSessionFilterState("{bad json")), []);
	assert.deepEqual(Object.keys(parseSessionFilterState("")), []);
	assert.deepEqual(Object.keys(parseSessionFilterState(null)), []);
});

test("pillsPresentIn: 空会话列表返回空数组（不摆任何 pill）", () => {
	assert.equal(pillsPresentIn([]).length, 0);
});

test("pillsPresentIn: 导入来源按 sessionPillOf 去重，无重复 pill", () => {
	const sessions = [
		{ id: "c1", source: "codex", backend: "pi" },
		{ id: "c2", source: "codex", backend: "pi" },
		{ id: "ig1", source: "pi", backend: "imagegen" },
	];
	assert.equal(pillsPresentIn(sessions).join(","), "codex,imagegen");
});
