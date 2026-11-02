import assert from "node:assert/strict";
import test from "node:test";
import { loadTsCommonJs } from "./helpers/loadTsCommonJs.mjs";

const { buildAgentRuntimeState } = loadTsCommonJs("src/main/acp/acpAgentRuntime.ts");

function runtime(overrides = {}) {
	return {
		tool: { id: "q", name: "Qoder CLI", command: "qodercli", args: ["--acp"], enabled: true, contextWindow: 200000 },
		projection: { messages: [{ role: "user", text: "x".repeat(4000) }], usage: undefined },
		turnActive: false,
		...overrides,
	};
}

test("ACP 未上报 usage 时，用户配置了 contextWindow 才用消息估算填补上下文仪表", () => {
	const state = buildAgentRuntimeState(runtime());
	assert.equal(state.contextWindow, 200000);
	assert.ok(state.contextTokens > 0);
	assert.ok(state.contextPercent > 0);
	assert.equal(state.contextMessageTokens, state.contextTokens);
	// 没配置窗口就不伪造容量：保持「暂不可用」，不猜 200k。
	const unknown = buildAgentRuntimeState(runtime({ tool: { id: "q", name: "Qoder CLI", command: "qodercli", args: ["--acp"], enabled: true } }));
	assert.equal(unknown.contextWindow, undefined);
	assert.equal(unknown.contextTokens, undefined);
});

test("ACP 真实 usage_update 优先于消息估算", () => {
	const state = buildAgentRuntimeState(runtime({ projection: { messages: [{ role: "user", text: "很长很长" }], usage: { used: 1234, size: 100000, costAmount: 0.2 } } }));
	assert.equal(state.contextTokens, 1234);
	assert.equal(state.contextWindow, 100000);
	assert.equal(state.cost, 0.2);
	assert.equal(state.contextMessageTokens, undefined);
});
