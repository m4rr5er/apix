import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { atom } from "jotai/vanilla";
import { atomFamily, selectAtom } from "jotai/vanilla/utils";
import { createTsSandbox } from "./helpers/createTsSandbox.mjs";

/**
 *
 * 根因链：
 * 1. 渲染层发送时先插入乐观用户气泡（id = requestId，meta.pendingUserMessage）；
 * 3. 模型配置错误（pi-ai provider … has no configured model）让回合直接 turn/end(error)，
 *    用户消息从未写进会话日志；
 * 4. 运行时快照整段替换窗口 → 乐观气泡被替换掉，界面上只剩一条错误诊断。
 *
 * 修复：快照合并时把「尚未被宿主记录」的气泡按锚点接回原位；宿主记录后（同文本）
 * 或投递被拒时撤掉。逻辑住在 session-atoms（它被大量手写 vm 加载器编译，
 * 新增相对 import 会整片 MODULE_NOT_FOUND）。
 */

const load = createTsSandbox({
	stubs: {
		jotai: { atom, useStore: () => ({}), useSetAtom: () => () => {}, useAtomValue: () => undefined },
		"jotai/utils": { atomFamily, selectAtom, atomWithStorage: (_key, initial) => atom(initial) },
	},
});
const { PENDING_USER_MESSAGE_META, carryPendingUserMessages, isPendingUserMessage, removePendingUserMessages } = load("src/renderer/src/atoms/session-atoms.ts");

function user(id, text, meta) {
	return { id, role: "user", text, timestamp: 1, ...(meta ? { meta } : {}) };
}
function pending(id, text, requestId = id) {
	return user(id, text, { [PENDING_USER_MESSAGE_META]: true, requestId });
}
function assistant(id, text) {
	return { id, role: "assistant", text, timestamp: 2, stopReason: "stop" };
}
function errorMessage(id, text) {
	return { id, role: "error", text, timestamp: 3 };
}
function ids(messages) {
	// 生产模块在 vm 沙箱里加载，返回沙箱 realm 数组；Array.from 转宿主数组后才能深比较。
	return Array.from(messages, (message) => message.id);
}

test("投递被拒：按 requestId 撤掉乐观气泡（文字已回填草稿）", () => {
	const messages = [user("u1", "旧"), pending("req-1", "新问题"), assistant("a1", "答")];
	assert.deepEqual(ids(removePendingUserMessages(messages, "req-1")), ["u1", "a1"]);
	assert.deepEqual(ids(removePendingUserMessages(messages, "req-2")), ["u1", "req-1", "a1"]);
});

test("接线：快照两条路径都接管；发送路径写标记并在拒绝时撤销", () => {
	const sessionAtoms = readFileSync("src/renderer/src/atoms/session-atoms.ts", "utf8");
	const send = readFileSync("src/renderer/src/hooks/useSessionSend.ts", "utf8");
	// 全量窗口段替换 + 增量 flush 合并都必须走同一套接管逻辑
	assert.equal((sessionAtoms.match(/carryPendingUserMessages\(/gu) ?? []).length, 3, "函数定义 + 两条快照路径");
	// 乐观气泡带标记（两处发布点）
	assert.equal((send.match(/pendingUserMessage: true, requestId/gu) ?? []).length, 2);
	// 拒绝路径撤气泡（ensureSessionId 失败 / prepareMessage 失败 / 空模板 / 宿主拒绝）
	assert.ok((send.match(/dropPendingUserMessage\(/gu) ?? []).length >= 4);
});
