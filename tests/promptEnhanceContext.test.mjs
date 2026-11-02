import assert from "node:assert/strict";
import test from "node:test";
import { loadTsCommonJs } from "./helpers/loadTsCommonJs.mjs";

const { collectPromptEnhanceContext } = loadTsCommonJs("src/renderer/src/utils/promptEnhanceContext.ts");
const plain = (value) => JSON.parse(JSON.stringify(value));
const message = (role, text, extra = {}) => ({ id: "message", agentId: "agent", role, text, timestamp: 1, ...extra });

test("仅保留最近 12 条正文并保持时间顺序，不修改缓存对象", () => {
	const messages = Array.from({ length: 20 }, (_, i) => message(i % 2 ? "assistant" : "user", `message-${i}`));
	const before = JSON.stringify(messages);
	assert.deepEqual(
		plain(collectPromptEnhanceContext(messages)),
		messages.slice(-12).map(({ role, text }) => ({ role, text })),
	);
	assert.equal(JSON.stringify(messages), before);
});

test("16,000 字符预算优先最近内容，截断较旧正文且不拆 Unicode 代理对", () => {
	const context = collectPromptEnhanceContext([message("user", "A😀B"), message("assistant", "x".repeat(15_998))]);
	assert.equal(context.at(-1).text.length, 15_998);
	assert.ok(context.reduce((n, item) => n + item.text.length, 0) <= 16_000);
	assert.ok(context.every(({ text }) => !/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/.test(text)));
});

test("没有正文或没有当前会话消息时不生成上下文", () => {
	assert.deepEqual(plain(collectPromptEnhanceContext([])), []);
	assert.deepEqual(plain(collectPromptEnhanceContext([message("tool", "private")])), []);
});
