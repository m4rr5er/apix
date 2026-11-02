import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createTsSandbox } from "./helpers/createTsSandbox.mjs";
import { loadTsCommonJs } from "./helpers/loadTsCommonJs.mjs";

/**
 * 本地路径包（pi install <dir>）回归：pi list 对这类包的 source 是不带协议前缀的裸路径。
 * 旧实现只认 npm:/file:/git:/github:/http(s): 前缀，整行被丢弃（扩展页看不到包），
 * 且卸载会把路径当成 ~/.pi/agent/extensions 里的文件名去删。
 *
 * 生产模块走 createTsSandbox（禁止手写 vm 加载器）：相对 import 由 helper 按源文件目录解析，
 * 桌面副作用（回收站 / 日志 / PiProcess / electron.net）按 specifier 打桩，与
 * tests/extensionManager.test.mjs 同一套桩。
 */
const loadProductionTs = createTsSandbox({
	stubs: {
		"../fs/trash": { trashPath: (path) => rm(path, { recursive: true, force: true }) },
		"../logging/sharedLogger": { getAppLogger: () => null },
		"../pi/PiProcess": { PiProcess: { invalidateVersionCache: () => {} } },
		"./PiProcess": { PiProcess: { invalidateVersionCache: () => {} } },
		electron: { net: { fetch: (...args) => globalThis.fetch(...args) } },
	},
	globals: { fetch: (...args) => globalThis.fetch(...args) },
});

/** 共享判据（唯一真值）：测试用它做交叉断言，证明主进程判定与资源层同源。 */
const sharedSources = loadTsCommonJs("src/shared/piPackageSource.ts");

const loadCatalogModule = () => loadProductionTs("src/main/extensions/piExtensionCatalog.ts");
const loadExtensionManagerModule = () => loadProductionTs("src/main/extensions/ExtensionManager.ts");

/** 把 vm 沙箱里的行拷回宿主 realm：跨原型的 deepStrictEqual 必败。 */
const plainRow = (extension) => ({
	id: extension.id,
	source: extension.source,
	path: extension.path ?? null,
	local: extension.local ?? null,
	filtered: extension.filtered ?? null,
	scope: extension.scope,
});

/** 造一个只记录命令的管理器：runPi 全部打桩，不 spawn 真实 pi。 */
function createRecordingManager(commands, options = {}) {
	const version = options.version ?? "1.0.0";
	const { ExtensionManager } = loadExtensionManagerModule();
	const manager = new ExtensionManager(
		{
			check: async () => ({ installed: true, version }),
			createInvocation: (command, args) => ({ command, args, shell: false }),
			createProcessEnv: () => ({}),
			warmWslCommand: async () => undefined,
		},
		() => ({}),
		() => ({}),
		async () => ({}),
		(key) => key,
	);
	manager.runPi = async (args) => {
		commands.push([...args]);
		return "ok";
	};
	return manager;
}

test("parsePiListOutput 覆盖盘符/相对/POSIX 绝对/UNC 四种路径型 source（CRLF 也要容忍）", () => {
	const { parsePiListOutput } = loadCatalogModule();
	const raw = ["Project packages:", "  ./pkg", "    ./pkg", "  ../sibling-pkg", "    ../sibling-pkg", "  /opt/pkg", "    /opt/pkg", "  \\\\srv\\share\\pkg", "    \\\\srv\\share\\pkg", ""].join("\r\n");

	const rows = Array.from(parsePiListOutput(raw), plainRow);
	assert.deepEqual(rows, [
		{ id: "project:./pkg", source: "./pkg", path: "./pkg", local: true, filtered: null, scope: "project" },
		{ id: "project:../sibling-pkg", source: "../sibling-pkg", path: "../sibling-pkg", local: true, filtered: null, scope: "project" },
		{ id: "project:/opt/pkg", source: "/opt/pkg", path: "/opt/pkg", local: true, filtered: null, scope: "project" },
		{ id: "project:\\\\srv\\share\\pkg", source: "\\\\srv\\share\\pkg", path: "\\\\srv\\share\\pkg", local: true, filtered: null, scope: "project" },
	]);
});

test("路径型 source 后紧跟另一个包时，下一行不会被吞成本包的 path", () => {
	const { parsePiListOutput } = loadCatalogModule();
	// 本地包没有落盘路径行时，同缩进的 npm 源行必须是新包，而不是上一个包的 path。
	const raw = ["User packages:", "  F:\\pkg-a", "  npm:bbb", "    C:\\ext\\bbb", ""].join("\n");

	const rows = Array.from(parsePiListOutput(raw), plainRow);
	assert.deepEqual(rows, [
		{ id: "user:F:\\pkg-a", source: "F:\\pkg-a", path: null, local: true, filtered: null, scope: "user" },
		{ id: "user:npm:bbb", source: "npm:bbb", path: "C:\\ext\\bbb", local: null, filtered: null, scope: "user" },
	]);
});

test("npm / git / url 行行为不变：source 原样、不带 local、filtered 标记照旧", () => {
	const { parsePiListOutput } = loadCatalogModule();
	const raw = ["User packages:", "  npm:pi-web-access (filtered)", "    C:\\ext\\pi-web-access", "  github:owner/repo", "    C:\\ext\\repo", "  https://example.invalid/pkg.tgz", "    C:\\ext\\pkg", ""].join("\n");

	const rows = Array.from(parsePiListOutput(raw), plainRow);
	assert.deepEqual(rows, [
		{ id: "user:npm:pi-web-access", source: "npm:pi-web-access", path: "C:\\ext\\pi-web-access", local: null, filtered: true, scope: "user" },
		{ id: "user:github:owner/repo", source: "github:owner/repo", path: "C:\\ext\\repo", local: null, filtered: null, scope: "user" },
		{ id: "user:https://example.invalid/pkg.tgz", source: "https://example.invalid/pkg.tgz", path: "C:\\ext\\pkg", local: null, filtered: null, scope: "user" },
	]);
});

test("isLocalFileExtensionSource 只把裸文件名当 extensions 目录内的本地文件", () => {
	const { isLocalFileExtensionSource } = loadExtensionManagerModule();
	for (const bare of ["pi-deck-demo-plugin.ts", "orca-agent-status.ts", "my-extension", "pi-deck-todo.ts"]) {
		assert.equal(isLocalFileExtensionSource(bare), true, bare + " 是 extensions 目录里的裸文件名");
	}
	for (const notBare of ["F:\\x", "F:/x", "./x", "../x", "/x", "\\\\srv\\x", "npm:pi-tracker", "git:https://example.invalid/x.git", "github:owner/repo", "https://example.invalid/pkg.tgz", "file:./x"]) {
		assert.equal(isLocalFileExtensionSource(notBare), false, notBare + " 是 pi packages 条目，不是本地文件");
	}
	// 与共享判据同源：避免主进程判定和资源层各写一套正则后漂移。
	for (const value of ["F:\\x", "./x", "/x", "\\\\srv\\x", "npm:x", "pi-deck-demo-plugin.ts"]) {
		assert.equal(isLocalFileExtensionSource(value), !sharedSources.isPackageSource(value), value + " 与 shared/piPackageSource 不一致");
	}
});
