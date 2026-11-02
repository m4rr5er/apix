import assert from "node:assert/strict";
import test from "node:test";
import { createRequire, syncBuiltinESMExports } from "node:module";
import * as esmChildProcess from "node:child_process";
import { loadTsCommonJs } from "./helpers/loadTsCommonJs.mjs";

// ESM `import * as` 命名空间只读，无法在上面做补丁/还原断言；
// 走 CJS exports 对象（与 hideChildConsoles.ts 编译后 require 到的是同一实例）。
const require = createRequire(import.meta.url);
const childProcess = require("node:child_process");

/** 构造假 koffi：getResults 依次返回 GetConsoleWindow 结果（单元素则恒定返回）。 */
function makeFfi({ getResults = [0], allocResult = 1, lastErrorResult } = {}) {
	const calls = { load: [], getConsoleWindow: [], allocConsole: 0, showWindow: [], lastError: 0 };
	const koffi = {
		load(name) {
			calls.load.push(name);
			return {
				func(signature) {
					if (signature.includes("GetConsoleWindow")) {
						return () => {
							const value = getResults.length === 1 ? getResults[0] : getResults.shift();
							calls.getConsoleWindow.push(value);
							return value;
						};
					}
					if (signature.includes("AllocConsole")) {
						return () => {
							calls.allocConsole += 1;
							return allocResult;
						};
					}
					if (signature.includes("GetLastError")) {
						return () => {
							calls.lastError += 1;
							return lastErrorResult ?? 0;
						};
					}
					if (signature.includes("ShowWindow")) {
						return (hWnd, nCmdShow) => {
							calls.showWindow.push([hWnd, nCmdShow]);
							return 1;
						};
					}
					throw new Error(`unexpected func signature: ${signature}`);
				},
			};
		},
	};
	return { koffi, calls };
}

test("hiddenConsoleOptions：未指定 windowsHide 时注入 true，已指定则尊重原值", () => {
	// loadTsCommonJs 在独立 vm realm 执行 TS：产物对象原型不同，deepStrictEqual 恒失败，
	// 逐字段断言（行为等价）。
	const injected = hiddenConsoleOptions({ stdio: "pipe" });
	assert.equal(injected.stdio, "pipe");
	assert.equal(injected.windowsHide, true);
	assert.equal(hiddenConsoleOptions({ windowsHide: false }).windowsHide, false);
	assert.equal(hiddenConsoleOptions({ windowsHide: true }).windowsHide, true);
	assert.equal(hiddenConsoleOptions(undefined), undefined);
});

test("installHostHiddenConsole：非 win32 不治理、不触碰 ffi", () => {
	const { koffi, calls } = makeFfi();
	assert.equal(installHostHiddenConsole("linux", koffi), false);
	assert.equal(getHiddenConsoleMode(), "off");
	assert.equal(calls.load.length, 0);
	assert.equal(calls.allocConsole, 0);
});

test("installHostHiddenConsole：win32 不再 AllocConsole（CREATE_NO_WINDOW 策略）", () => {
	const { koffi, calls } = makeFfi({ getResults: [0, 0xabc], allocResult: 1 });
	assert.equal(installHostHiddenConsole("win32", koffi), false, "没有已分配的隐藏控制台");
	assert.equal(getHiddenConsoleMode(), "create-no-window");
	assert.equal(calls.load.length, 0, "现行路径不得加载 koffi");
	assert.equal(calls.allocConsole, 0, "AllocConsole 会异步弹出 conhost");
	assert.equal(calls.showWindow.length, 0);
});

test("installRunnerPreloadEnv：win32 把 preload 写进 NODE_OPTIONS（append + 幂等 + 可还原），非 win32 不动", () => {
	// 黑窗口根治：第二级 ACL runner 的 env 来自 host 进程环境（经 scrubbedParentEnv
	// → IPC request.env），spawn 补丁的 preload 注入够不着它——必须由 host env 携带。
	const preloadPath = "C:\\app\\out\\main\\runnerConsolePreload.js";
	const env = { PATH: "x" };
	const restore = installRunnerPreloadEnv(env, "win32", preloadPath);
	assert.equal(env.NODE_OPTIONS, `--require="C:\\\\app\\\\out\\\\main\\\\runnerConsolePreload.js"`, "写入 preload（Windows NODE_OPTIONS 反斜杠必须翻倍）");
	assert.equal(env.PATH, "x", "其余 env 不动");
	// 幂等：已含同一 preload 时不重复 append（第一级 runner 的 options.env 由 host env
	// 派生，withRunnerPreload 也不能叠第二份，否则 Node 加载两遍）。
	const restore2 = installRunnerPreloadEnv(env, "win32", preloadPath);
	assert.equal(env.NODE_OPTIONS, `--require="C:\\\\app\\\\out\\\\main\\\\runnerConsolePreload.js"`, "重复安装不叠加");
	restore2();
	// append 语义：已有 NODE_OPTIONS 时拼接。
	const withExisting = { NODE_OPTIONS: "--no-warnings" };
	const restore3 = installRunnerPreloadEnv(withExisting, "win32", preloadPath);
	assert.equal(withExisting.NODE_OPTIONS, `--no-warnings --require="C:\\\\app\\\\out\\\\main\\\\runnerConsolePreload.js"`);
	restore3();
	assert.equal(withExisting.NODE_OPTIONS, "--no-warnings", "还原为原值");
	restore();
	assert.equal("NODE_OPTIONS" in env, false, "还原时删除原本不存在的键");

	const linuxEnv = {};
	const restoreLinux = installRunnerPreloadEnv(linuxEnv, "linux", preloadPath);
	assert.equal("NODE_OPTIONS" in linuxEnv, false, "非 win32 不置位");
	restoreLinux();
});

test("installHiddenConsolePatch：非 win32 不安装，win32 安装且可还原", () => {
	const originalSpawn = childProcess.spawn;

	const restoreLinux = installHiddenConsolePatch("linux");
	assert.equal(childProcess.spawn, originalSpawn, "linux 不应安装补丁");
	restoreLinux();

	const restoreWin = installHiddenConsolePatch("win32");
	try {
		assert.notEqual(childProcess.spawn, originalSpawn, "win32 应安装补丁");
	} finally {
		restoreWin();
	}
	assert.equal(childProcess.spawn, originalSpawn, "还原后 spawn 应恢复原引用");
});

/** 在补丁安装前加载的 ESM 消费者也必须拿到 sidecar/preload，而非 Electron 原始 spawn。 */

/** runner preload 的补丁同样要覆盖 ESM，保证嵌套 runner 不丢失无窗口策略。 */

test("win32 普通 spawn：恒注入 windowsHide（CREATE_NO_WINDOW 无窗口可继承控制台）", () => {
	installHostHiddenConsole("win32", makeFfi({ getResults: [0], allocResult: 0 }).koffi);
	const originalSpawn = childProcess.spawn;
	const calls = [];
	childProcess.spawn = (...args) => {
		calls.push(args);
		return {};
	};
	const restore = installHiddenConsolePatch("win32");
	try {
		childProcess.spawn("pwsh", ["-Command", "Get-Location"]);
		childProcess.spawn("pwsh", ["-Command", "x"], { cwd: "C:\\work" });
		childProcess.spawn("pwsh", { cwd: "C:\\work" });
		childProcess.spawn("pwsh", ["-Command", "x"], { windowsHide: false });
	} finally {
		restore();
		childProcess.spawn = originalSpawn;
	}
	assert.equal(calls.length, 4);
	assert.equal(calls[0][2].windowsHide, true, "无 options 时补 { windowsHide: true }");
	assert.equal(calls[1][2].cwd, "C:\\work");
	assert.equal(calls[1][2].windowsHide, true);
	assert.equal(calls[2][1].cwd, "C:\\work");
	assert.equal(calls[2][1].windowsHide, true);
	assert.equal(calls[3][2].windowsHide, false, "显式 windowsHide:false 尊重原值");
});

test("pwsh spawn：注入启动优化环境变量（冷启动提速），非 pwsh 不注入", () => {
	installHostHiddenConsole("win32", makeFfi({ getResults: [0, 0xabc] }).koffi);
	const originalSpawn = childProcess.spawn;
	const calls = [];
	childProcess.spawn = (...args) => {
		calls.push(args);
		return {};
	};
	const restore = installHiddenConsolePatch("win32");
	try {
		// 本地 pwsh spawn：env 注入 POWERSHELL_*/DOTNET_* 启动优化
		childProcess.spawn("C:\\Program Files\\PowerShell\\7\\pwsh.exe", ["-NoProfile", "-Command", "x"], { env: { PATH: "p" } });
		// PATH 裸名 pwsh
		childProcess.spawn("pwsh", ["-c", "x"], { env: { PATH: "p" } });
		// 非 pwsh（node/git/cmd）：不注入
		childProcess.spawn("git", ["status"], { env: { PATH: "g" } });
	} finally {
		restore();
		childProcess.spawn = originalSpawn;
	}
	assert.equal(calls[0][2].env.POWERSHELL_TELEMETRY_OPTOUT, "1");
	assert.equal(calls[0][2].env.POWERSHELL_UPDATECHECK, "Off");
	assert.equal(calls[0][2].env.DOTNET_NOLOGO, "1");
	assert.equal(calls[0][2].env.PATH, "p", "其余 env 保留");
	assert.equal(calls[1][2].env.POWERSHELL_TELEMETRY_OPTOUT, "1", "PATH 裸名 pwsh 同样注入");
	assert.equal("POWERSHELL_TELEMETRY_OPTOUT" in calls[2][2].env, false, "非 pwsh 不注入");
});

test("pwsh spawn：追加 exit 兜底 + stdin 改 ignore（挂起止血）", () => {
	installHostHiddenConsole("win32", makeFfi({ getResults: [0, 0xabc] }).koffi);
	const originalSpawn = childProcess.spawn;
	const calls = [];
	childProcess.spawn = (...args) => {
		calls.push(args);
		return {};
	};
	const restore = installHiddenConsolePatch("win32");
	try {
		// 本地 pwsh spawn：-Command 命令追加换行 + exit；stdin pipe → ignore
		childProcess.spawn("C:\\Program Files\\PowerShell\\7\\pwsh.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", "Write-Output hi"], { stdio: ["pipe", "pipe", "pipe"], env: { PATH: "p" } });
		// 非 pwsh 不受影响
		childProcess.spawn("git", ["status"], { stdio: ["pipe", "pipe", "pipe"], env: { PATH: "g" } });
	} finally {
		restore();
		childProcess.spawn = originalSpawn;
	}
	assert.equal(calls[0][1][4], "Write-Output hi\nexit $LASTEXITCODE", "命令末尾追加 exit 兜底");
	assert.equal(calls[0][2].stdio[0], "ignore", "stdin 改 ignore（不等管道 EOF）");
	assert.equal(calls[0][2].stdio[1], "pipe", "stdout 保持 pipe");
	assert.equal(calls[0][2].env.POWERSHELL_TELEMETRY_OPTOUT, "1", "启动环境注入不受影响");
	assert.deepEqual(calls[1][1], ["status"], "非 pwsh 不追加 exit");
	assert.equal(calls[1][2].stdio[0], "pipe", "非 pwsh 的 stdin 不动");
});

/** runner 负责超时和进程回收；追加 exit 会丢失 Get-Location 等命令的延迟格式化输出。 */

test("win32 补丁：execFile（带 callback）与 exec 恒注入 windowsHide", () => {
	const originalSpawn = childProcess.spawn;
	const originalExecFile = childProcess.execFile;
	const originalExec = childProcess.exec;
	const calls = [];
	childProcess.spawn = () => ({});
	childProcess.execFile = (...args) => {
		calls.push(["execFile", args]);
		return {};
	};
	childProcess.exec = (...args) => {
		calls.push(["exec", args]);
		return {};
	};

	installHostHiddenConsole("win32");
	const restore = installHiddenConsolePatch("win32");
	try {
		childProcess.execFile("taskkill", ["/PID", "123"], () => undefined);
		childProcess.execFile("pwsh.exe", ["-c", "x"], { encoding: "utf8" });
		childProcess.exec("where pwsh", { encoding: "utf8" });
	} finally {
		restore();
		childProcess.spawn = originalSpawn;
		childProcess.execFile = originalExecFile;
		childProcess.exec = originalExec;
	}
	assert.equal(calls.length, 3);
	assert.equal(calls[0][1][2].windowsHide, true, "callback 形态：options 插入 callback 前");
	assert.equal(typeof calls[0][1][3], "function");
	assert.equal(calls[1][1][2].encoding, "utf8");
	assert.equal(calls[1][1][2].windowsHide, true);
	assert.equal(calls[2][1][1].encoding, "utf8");
	assert.equal(calls[2][1][1].windowsHide, true);
});
