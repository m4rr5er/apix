import assert from "node:assert/strict";
import test from "node:test";
import { loadTsCommonJs } from "./helpers/loadTsCommonJs.mjs";

const { composeAgentInstruction } = loadTsCommonJs("src/main/agents/agentPersonaInstruction.ts");

/** 生产模块在 vm 沙箱里创建的对象原型属于另一个 realm，深度比较前转成本 realm 的普通对象。 */
function plain(value) {
	return JSON.parse(JSON.stringify(value));
}

test("pi (and unspecified backend) keeps the visible message and prepends the persona to the hidden payload", () => {
	const composed = plain(composeAgentInstruction({ persona: "你是审查员", message: "看看这段代码", backend: "pi" }));
	assert.deepEqual(composed, { message: "看看这段代码", agentMessage: "你是审查员\n\n看看这段代码" });
	// 缺省后端（旧会话记录没有 backend）按 pi 处理：隐藏通道是既有行为。
	assert.deepEqual(plain(composeAgentInstruction({ persona: "你是审查员", message: "看看这段代码", backend: undefined })), composed);
});

test("existing hidden payload is prefixed, not replaced, so plan/goal markers survive", () => {
	const composed = plain(composeAgentInstruction({ persona: "你是审查员", message: "看看这段代码", existingAgentMessage: "PLAN_MODE\n\n看看这段代码", backend: "pi" }));
	assert.equal(composed.message, "看看这段代码");
	assert.equal(composed.agentMessage, "你是审查员\n\nPLAN_MODE\n\n看看这段代码");
});

test("acp keeps the hidden channel (acpTurnSettlement supports agentMessage)", () => {
	assert.deepEqual(plain(composeAgentInstruction({ persona: "你是翻译", message: "hello", backend: "acp" })), { message: "hello", agentMessage: "你是翻译\n\nhello" });
	// 生图/生视频等非对话后端同样按「有隐藏通道」处理，由各自发送链路忽略该字段。
	assert.equal(composeAgentInstruction({ persona: "你是翻译", message: "hello", backend: "imagegen" }).agentMessage, "你是翻译\n\nhello");
});

test("persona is trimmed but internal line structure is preserved", () => {
	const composed = plain(composeAgentInstruction({ persona: "\n  第一行\n第二行  \n\n", message: "正文", backend: "pi" }));
	assert.equal(composed.agentMessage, "第一行\n第二行\n\n正文");
	assert.equal(composed.message, "正文");
});

test("unicode persona and message are concatenated verbatim without rewriting", () => {
	const persona = "你是 PiDeck 的翻译官：只输出译文。";
	const message = "Give me a pen.";
	const composed = composeAgentInstruction({ persona, message, backend: "pi" });
	assert.equal(composed.agentMessage, `${persona}\n\n${message}`);
	assert.equal(composed.message, message);
});
