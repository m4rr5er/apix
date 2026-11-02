import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import test from "node:test";
import { loadTsCommonJs } from "./helpers/loadTsCommonJs.mjs";

test("ACP 启动参数追加 --context-window（数组形式，不重复）", () => {
	const calls = [];
	const fakeProc = Object.assign(new EventEmitter(), {
		stdin: new PassThrough(),
		stdout: new PassThrough(),
		stderr: new PassThrough(),
		pid: 1,
		exitCode: null,
		signalCode: null,
		kill() {},
	});
	const { spawnAcpProcess } = loadTsCommonJs("src/main/acp/AcpProcessHost.ts", {
		stubs: {
			"node:child_process": {
				spawn: (command, args) => {
					calls.push({ command, args });
					return fakeProc;
				},
			},
		},
	});
	const deps = { piLocator: { createInvocation: (command, args) => ({ command, args, shell: false }), createProcessEnv: () => ({}) } };
	const tool = { id: "q", name: "Qoder CLI", command: "qodercli", args: ["--acp"], contextWindow: 200000, enabled: true };
	spawnAcpProcess(tool, "C:/proj", deps);
	assert.equal(JSON.stringify(calls[0].args), JSON.stringify(["--acp", "--context-window", "200000"]));
	spawnAcpProcess({ ...tool, args: ["--acp", "--context-window", "100000"] }, "C:/proj", deps);
	assert.equal(JSON.stringify(calls[1].args), JSON.stringify(["--acp", "--context-window", "100000"]), "用户显式写的 flag 不能再追加一份");
});
