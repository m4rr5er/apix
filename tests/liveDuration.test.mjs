import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { createTsSandbox } from "./helpers/createTsSandbox.mjs";

/**
 * 编译 .ts 模块并在 vm 中加载（相对 import 按源文件目录解析，见 helper 注释）。
 * LiveDuration 只用到 formatDuration，用固定值桩替身（`${ms}ms`）观察 tick 行为。
 */
const loadTsModule = createTsSandbox({
	stubs: { "./TimelineFormat": { formatDuration: (ms) => `${ms}ms` } },
});

test("formatDuration: ms / seconds / minutes / hours buckets", () => {
	const { formatDuration } = loadTsModule("src/renderer/src/components/session/TimelineFormat.ts");
	assert.equal(formatDuration(850), "850ms");
	assert.equal(formatDuration(3200), "3.2s");
	assert.equal(formatDuration(64000), "1m4s");
	assert.equal(formatDuration(120000), "2m");
	// 小时档：长任务（挂机跑几小时）不能只显示分钟（「3120m」读不出来）
	assert.equal(formatDuration(3_600_000), "1h");
	assert.equal(formatDuration(3_720_000), "1h2m");
	assert.equal(formatDuration(3_723_000), "1h2m3s");
	// 分钟为 0 时省略该档位（1h0m3s → 1h3s）
	assert.equal(formatDuration(3_603_000), "1h3s");
	assert.equal(formatDuration(47_000_000), "13h3m20s");
});

test("LiveDuration: live tick only while streaming, fixed after end", () => {
	const source = readFileSync("src/renderer/src/components/session/LiveDuration.tsx", "utf8");
	// 100ms tick：仅 isStreaming 时启动 interval，结束/卸载清理
	assert.match(source, /setInterval\(\(\) => setNow\(Date\.now\(\)\), 100\)/);
	assert.match(source, /if \(!props\.isStreaming\) return;/);
	assert.match(source, /clearInterval\(timer\)/);
	// 结束截止：endedAt > 0 时用固定差值，不再依赖 now
	assert.match(source, /ended \?\? now\) - started/);
	// 无 startedAt 不渲染
	assert.match(source, /if \(started == null \|\| started <= 0\) return null;/);
});

test("three duration call sites reuse LiveDuration", () => {
	const turnRow = readFileSync("src/renderer/src/components/session/turn/TurnRow.tsx", "utf8");
	const toolCard = readFileSync("src/renderer/src/components/session/ToolCallComponents.tsx", "utf8");
	const thinking = readFileSync("src/renderer/src/components/session/TimelineEventCards.tsx", "utf8");
	// TurnRow run 耗时：流式中实时（agentRunning 驱动，不依赖 endedAt）、结束截止。
	// 起点为 effectiveStart（run.startedAt + askWaitMs，询问等待不计数）。
	assert.match(turnRow, /<LiveDuration[\s\S]*?startedAt=\{effectiveStart\}/);
	assert.match(turnRow, /isRunLive \?/);
	// ThinkingBlock 思考耗时（新架构在 TimelineEventCards.tsx）
	assert.match(thinking, /<LiveDuration[\s\S]*?startedAt=\{props\.startedAt\}/);
	// 思考流式中即带「思考了」前缀（结束时不蹦文案）
	assert.match(thinking, /thinking\.durationPrefix/);
	// ToolCard 工具耗时：running 时以 meta.startedAt 为秒表起点（消息 timestamp 会被
	// 主进程在每次 update/end 时刷新，直接用会导致流式期间反复归零）
	assert.match(toolCard, /<LiveDuration[\s\S]*?startedAt=\{getToolLiveStartTimestamp\(props\.message\)\}/);
});
