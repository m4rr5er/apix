import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

/**
 * 不推送——侧栏只认 catalog-refreshed 推送（useProjectSync），不推就要等手动刷新。
 * 2027-04 fork/clone 已收口到 src/main/sessions/sessionForkCommands.ts（桌面/Web 共用命令层），
 * 契约断言同步改读新模块（空白容忍，改格式不炸）。
 */

const source = readFileSync("src/main/sessions/sessionForkCommands.ts", "utf8");

test("尾部重发/编辑 fork 化（mutationFork 且非 branchMode）走 markSuperseded 隐藏旧会话", () => {
	// 与桌面端语义一致：mutationFork && !branchMode → { markForked: false, markSuperseded: true }
	assert.match(source, /mutationFork && !branchMode \? \{ markForked: false, markSuperseded: true \} : \{ markForked: true \}/);
});
