import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const stripPath = "src/renderer/src/components/session/SessionGoalStrip.tsx";
const stripSource = () => readFileSync(stripPath, "utf8");
const viewSource = () => readFileSync("src/renderer/src/components/session/SessionView.tsx", "utf8");
const startSource = () => readFileSync("src/renderer/src/components/session/SessionStartSurface.tsx", "utf8");
const zh = () => readFileSync("src/renderer/src/i18n/rendererCopy.zh-CN.ts", "utf8");
const en = () => readFileSync("src/renderer/src/i18n/rendererCopy.en-US.ts", "utf8");

test("session view and start surface mount the strips then goal", () => {
	const view = viewSource();
	const start = startSource();
	assert.match(view, /<SessionTodoStrip sessionId=\{sessionId\} \/>/);
	assert.match(view, /<SessionSubagentsStrip[\s\S]*?onOpenChildSession=\{onOpenBranchSession\}/);
	assert.match(view, /<SessionGoalStrip sessionId=\{sessionId\} \/>/);
	assert.ok(view.indexOf("<SessionTodoStrip") < view.indexOf("<SessionSubagentsStrip") && view.indexOf("<SessionSubagentsStrip") < view.indexOf("<SessionGoalStrip"), "strip order must be todo → subagents → goal in SessionView widgets");
	// 「修改的文件」已改为每轮末尾的 chip 行（turn/TurnFileChanges），不再占 composer 槽位
	assert.doesNotMatch(view, /SessionFilesStrip/);
	assert.match(start, /<SessionTodoStrip sessionId=\{props\.sessionId\} \/>/);
	assert.match(start, /<SessionSubagentsStrip sessionId=\{props\.sessionId\} \/>/);
	assert.match(start, /<SessionGoalStrip sessionId=\{props\.sessionId\} \/>/);
	assert.doesNotMatch(start, /SessionFilesStrip/);
});

test("goal and queue copy is present in both locale dictionaries", () => {
	for (const locale of [zh(), en()]) {
		assert.match(locale, /"sessionGoal\.aria"/);
		assert.match(locale, /"sessionQueue\.count": "\{n\}/);
	}
});
