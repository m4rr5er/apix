import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const turnRow = readFileSync("src/renderer/src/components/session/turn/TurnRow.tsx", "utf8");
const header = readFileSync("src/renderer/src/components/session/turn/TurnAuthorHeader.tsx", "utf8");
const backendMark = readFileSync("src/renderer/src/components/session/SessionSourceBadge.tsx", "utf8");
const timeline = readFileSync("src/renderer/src/components/session/SessionMessageTimeline.tsx", "utf8");

test("TurnRow shows the turn model after the duration in the footer once the turn ends (data-only, no dictionary copy)", () => {
	// 同一会话内用户会频繁换模型，模型名逐轮显示在回复底部耗时行（跟在耗时之后）；
	// provider/model 是数据，不进词典；缺省时不占位。
	assert.match(turnRow, /data-turn-model=\{turnModel\.modelId\}/);
	assert.match(turnRow, /\{turnModel\.modelId\}/);
	// 只在本轮结束后显示：流式期间模型名跟着正文一起长出来会干扰阅读
	assert.match(turnRow, /const showTurnModel = !isRunLive && Boolean\(turnModel\)/);
	// 模型名长短不一，必须限宽截断 + title 给全量 provider/model
	assert.match(turnRow, /min-w-0 max-w-\[16rem\] truncate[^"]*"/);
	assert.match(turnRow, /title=\{`\$\{turnModel\.provider\}\/\$\{turnModel\.modelId\}`\}/);
	// 落点是底部耗时行，不是行头：行头不再接收 model 字段
	assert.doesNotMatch(header, /model\?: \{ provider: string; modelId: string \}/);
	assert.doesNotMatch(header, /data-turn-model/);
	// 模型分支必须排在耗时分支之后，且与耗时/操作栏同一行（同一层透明度）
	const footerStart = turnRow.indexOf("操作栏 + 尾部耗时");
	const durationAt = turnRow.indexOf("{showDuration && (", footerStart);
	const modelAt = turnRow.indexOf("{showTurnModel && turnModel && (", footerStart);
	assert.ok(footerStart > -1 && durationAt > -1 && modelAt > -1, "底部行必须同时含耗时与模型分支");
	assert.ok(modelAt > durationAt, "模型必须排在耗时之后");
	// 既无文本又无耗时的轮也要能看到模型，否则该轮完全丢失模型信息
	assert.match(turnRow, /\(mergedText && !editing\) \|\| showDuration \|\| showTurnModel/);
});
