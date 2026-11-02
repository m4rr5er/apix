import assert from "node:assert/strict";
import test from "node:test";
import { loadTsCommonJs } from "./helpers/loadTsCommonJs.mjs";

const { CompositeAgentGateway } = loadTsCommonJs("src/main/agents/CompositeAgentGateway.ts");

/**
 * 假后端网关：按 SessionAgentGateway 形状构造，记录调用轨迹。
 * supportsOptional=false 时故意不实现 getCommands/exportHtml/editMessage/deleteMessage
 */
function makeFakeGateway(backend, { supportsOptional = true } = {}) {
	const tabs = [];
	const calls = [];
	const listeners = new Set();
	const gateway = {
		backend,
		capabilities: new Set(["compact", "fork", "getForkMessages", ...(supportsOptional ? ["editMessage", "deleteMessage", "getCommands", "exportHtml", "rewind"] : [])]),
		list() {
			return [...tabs];
		},
		async create(input) {
			calls.push(["create", backend, input]);
			const tab = { id: `${backend}:${tabs.length + 1}`, projectId: input.projectId, cwd: "/fake", title: input.title ?? "", status: "idle", backend, createdAt: Date.now() };
			tabs.push(tab);
			return tab;
		},
		async restart(agentId) {
			calls.push(["restart", backend, agentId]);
			const tab = tabs.find((item) => item.id === agentId);
			return tab ?? { ...tabs[0], id: agentId };
		},
		async sendPrompt(input) {
			calls.push(["sendPrompt", backend, input.agentId]);
			return { accepted: true };
		},
		getMessages(agentId) {
			calls.push(["getMessages", backend, agentId]);
			return [];
		},
		async stop(agentId) {
			calls.push(["stop", backend, agentId]);
			const index = tabs.findIndex((item) => item.id === agentId);
			if (index >= 0) tabs.splice(index, 1);
		},
		async rename(agentId, name) {
			calls.push(["rename", backend, agentId, name]);
			return tabs.find((item) => item.id === agentId);
		},
		async abort(agentId) {
			calls.push(["abort", backend, agentId]);
		},
		async compact(agentId) {
			calls.push(["compact", backend, agentId]);
			return { isStreaming: false };
		},
		async getRuntimeState(agentId) {
			calls.push(["getRuntimeState", backend, agentId]);
			return { isStreaming: false };
		},
		async getAvailableModels(agentId) {
			calls.push(["getAvailableModels", backend, agentId]);
			return [];
		},
		async prepareResendFromMessage(agentId, messageId) {
			calls.push(["prepareResendFromMessage", backend, agentId, messageId]);
			return { text: "" };
		},
		async setModel(agentId, provider, modelId) {
			calls.push(["setModel", backend, agentId, provider, modelId]);
			return {};
		},
		async setThinking(agentId, level) {
			calls.push(["setThinking", backend, agentId, level]);
			return {};
		},
		async publishRuntimeState(agentId) {
			calls.push(["publishRuntimeState", backend, agentId]);
		},
		async getForkMessages(agentId) {
			calls.push(["getForkMessages", backend, agentId]);
			return [];
		},
		async forkSession(agentId, entryId) {
			calls.push(["forkSession", backend, agentId, entryId]);
			return {};
		},
		async sendUIResponse(agentId, requestId, response) {
			calls.push(["sendUIResponse", backend, agentId, requestId, response]);
			return { accepted: true };
		},
		notifyAskPending(agentId, sessionId, sessionTitle, question) {
			calls.push(["notifyAskPending", backend, agentId, sessionId, sessionTitle, question]);
		},
		onOutput(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		...(supportsOptional
			? {
					async getCommands(agentId) {
						calls.push(["getCommands", backend, agentId]);
						return [];
					},
					async exportHtml(agentId) {
						calls.push(["exportHtml", backend, agentId]);
						return "<html />";
					},
					async editMessage(agentId, messageId, newText) {
						calls.push(["editMessage", backend, agentId, messageId, newText]);
					},
					async deleteMessage(agentId, messageId) {
						calls.push(["deleteMessage", backend, agentId, messageId]);
					},
					async listCheckpoints(agentId) {
						calls.push(["listCheckpoints", backend, agentId]);
						return [];
					},
					async getCheckpointDiff(agentId, checkpointId) {
						calls.push(["getCheckpointDiff", backend, agentId, checkpointId]);
						return "diff";
					},
					async restoreCheckpoint(agentId, checkpointId, scope) {
						calls.push(["restoreCheckpoint", backend, agentId, checkpointId, scope]);
					},
					async mutatePersistedSessionMessage(sessionPath, messageId, operation, extra) {
						calls.push(["mutatePersistedSessionMessage", backend, sessionPath, messageId, operation, extra]);
						return operation === "resend" ? { text: "hello" } : undefined;
					},
					reviveIfProcessAlive(agentId) {
						calls.push(["reviveIfProcessAlive", backend, agentId]);
						return backend === "pi";
					},
					async draftCommands(projectId) {
						calls.push(["draftCommands", backend, projectId]);
						return [{ name: `preview:${backend}`, description: "", source: "skill" }];
					},
				}
			: {}),
	};
	gateway.calls = calls;
	gateway.listeners = listeners;
	return gateway;
}

function makeComposite() {
	const pi = makeFakeGateway("pi");
}

test("未知 backend 抛错（装配层应保证注册完整）", async () => {
	const { composite } = makeComposite();
	await assert.rejects(composite.create({ projectId: "p1", backend: "codex" }), /no gateway for backend "codex"/);
});

test("未知 agent 抛错（Coordinator 转 SESSION_COMMAND_FAILED）", async () => {
	const { composite } = makeComposite();
	await assert.rejects(composite.sendPrompt({ agentId: "ghost", message: "hi" }), /no gateway owns agent "ghost"/);
});

test("capabilities 取所有子网关并集（含可选能力项）", async () => {
	const { composite } = makeComposite();
	assert.deepEqual([...composite.capabilities].sort(), ["compact", "deleteMessage", "editMessage", "exportHtml", "fork", "getCommands", "getForkMessages", "rewind"].sort());
});

test("可选能力存在：转发到所属网关并透传参数", async () => {
	const { pi, composite } = makeComposite();
	const tab = await composite.create({ projectId: "p1", backend: "pi" });
	await composite.getCommands(tab.id);
	await composite.editMessage(tab.id, "m1", "新文本");
	await composite.deleteMessage(tab.id, "m1");
	await composite.exportHtml(tab.id);
	await composite.listCheckpoints(tab.id);
	await composite.getCheckpointDiff(tab.id, "cp-1");
	await composite.restoreCheckpoint(tab.id, "cp-1", "files");
	assert.deepEqual(pi.calls.filter(([name]) => name === "getCommands").at(-1), ["getCommands", "pi", tab.id]);
	assert.deepEqual(pi.calls.filter(([name]) => name === "editMessage").at(-1), ["editMessage", "pi", tab.id, "m1", "新文本"]);
	assert.deepEqual(pi.calls.filter(([name]) => name === "deleteMessage").at(-1), ["deleteMessage", "pi", tab.id, "m1"]);
	assert.deepEqual(pi.calls.filter(([name]) => name === "exportHtml").at(-1), ["exportHtml", "pi", tab.id]);
	assert.deepEqual(pi.calls.filter(([name]) => name === "listCheckpoints").at(-1), ["listCheckpoints", "pi", tab.id]);
	assert.deepEqual(pi.calls.filter(([name]) => name === "getCheckpointDiff").at(-1), ["getCheckpointDiff", "pi", tab.id, "cp-1"]);
	assert.deepEqual(pi.calls.filter(([name]) => name === "restoreCheckpoint").at(-1), ["restoreCheckpoint", "pi", tab.id, "cp-1", "files"]);
});

test("getMessageWindow：pi 网关的窗口协议原样透传（窗口段 + windowStart/fileVersion）", async () => {
	const pi = makeFakeGateway("pi");
	const expected = { messages: [{ id: "m2", role: "assistant" }], windowStart: 1, totalLength: 2, fileVersion: "v3" };
	pi.getMessageWindow = () => expected;
	const composite = new CompositeAgentGateway([pi]);
	const tab = await composite.create({ projectId: "p1", backend: "pi" });
	assert.equal(composite.getMessageWindow(tab.id), expected, "对象调用透传，不得丢 this 或复制错窗口");
});
