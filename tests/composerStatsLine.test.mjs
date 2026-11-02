import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { loadTsCommonJs } from "./helpers/loadTsCommonJs.mjs";

function loadStats() {
	const t = (key, params = {}) => {
		const table = {
			"composerStats.counts": "{turns} 轮 · {steps} 步",
			"composerStats.turns": "{turns} 轮",
			"composerStats.llm": "LLM {duration}",
			"composerStats.toolCall": "工具调用 {duration}",
			"composerStats.ttftAverage": "首 token 平均 {duration}",
			"composerStats.streamingTps": "流式 {throughput} tok/s",
			"composerStats.endToEndTps": "端到端 {throughput} tok/s",
			"composerStats.sessionStreamingTps": "均速 {throughput} tok/s",
			"composerStats.sessionEndToEndTps": "端到端均速 {throughput} tok/s",
			"composerStats.cacheHit": "缓存命中 {percent}%",
			"composerStats.tokens": "输入 {input} tok · 输出 {output} tok",
			"composerStats.ttft": "首 token {duration}",
			"composerStats.reply": "回复 {duration}",
		};
		return (table[key] ?? key).replace(/\{(\w+)\}/g, (_, name) => String(params[name] ?? ""));
	};
	return loadTsCommonJs("src/renderer/src/components/session/ComposerStatsLine.tsx", {
		stubs: {
			react: { Fragment: "Fragment", memo: (fn) => fn, useLayoutEffect: () => undefined, useRef: () => ({ current: null }), useState: (v) => [v, () => undefined] },
			"../../i18n": { t },
			"../i18n": { t },
			"./TimelineFormat": { formatDuration: (ms) => `${ms}ms` },
			"./SessionContextMeter": { formatTokens: (n) => String(n) },
		},
	});
}

test("pi last-reply metrics fill the strip when sessionStats is absent", () => {
	const { buildComposerStatsGroups } = loadStats();
	const groups = buildComposerStatsGroups({
		ttftMs: 210,
		totalMs: 4300,
		tps: 31,
		inputTokens: 800,
		outputTokens: 90,
	});
	assert.equal(groups[0], "首 token 210ms · 回复 4300ms · 流式 31 tok/s");
	assert.equal(groups[1], "输入 800 tok · 输出 90 tok");
});

test("turn count stays visible before a runtime state exists", () => {
	const { buildComposerStatsGroups } = loadStats();
	assert.equal(buildComposerStatsGroups(undefined, 12).join("|"), "12 轮");
	assert.equal(buildComposerStatsGroups(undefined, 0).length, 0);
});

test("composer area mounts the stats strip under the input card", () => {
	const area = readFileSync("src/renderer/src/components/session/ComposerArea.tsx", "utf8");
	const stats = readFileSync("src/renderer/src/components/session/ComposerStatsLine.tsx", "utf8");
	assert.match(area, /import \{ ComposerStatsLine \} from "\.\/ComposerStatsLine"/);
	assert.match(area, /statsLine=\{\s*<ComposerStatsLine\s+state=\{composer\.runtime\?\.state\}\s+turnCount=\{props\.turnCount\}\s+contextMeter=/);
	assert.match(area, /\{props\.statsLine\}/);
	// footer 固定保留 8px 底部留白；ComposerMeasuredExtras 会把它计入总高度，
	// StatsLine 自身仍只在有数字时渲染。
	assert.match(area, /className="composer[^\"]*px-0 pb-2"/);
	assert.match(stats, /if \(segments\.length === 0\) return null/);
	assert.match(stats, /px-1 pb-0 pt-1/);
	assert.match(stats, /min-w-0 truncate text-center/);
});

test("stats copy exists in both locales", () => {
	const zh = readFileSync("src/renderer/src/i18n/rendererCopy.zh-CN.ts", "utf8");
	const en = readFileSync("src/renderer/src/i18n/rendererCopy.en-US.ts", "utf8");
	for (const key of [
		"composerStats.counts",
		"composerStats.llm",
		"composerStats.toolCall",
		"composerStats.ttftAverage",
		"composerStats.streamingTps",
		"composerStats.endToEndTps",
		"composerStats.sessionStreamingTps",
		"composerStats.sessionEndToEndTps",
		"composerStats.cacheHit",
		"composerStats.tokens",
		"composerStats.ttft",
		"composerStats.reply",
		"composerStats.turnsHint",
	]) {
		assert.match(zh, new RegExp(`"${key.replace(".", "\\.")}"`));
		assert.match(en, new RegExp(`"${key.replace(".", "\\.")}"`));
	}
});

test("pi stats line displays session average tps when available", () => {
	const { buildComposerStatsGroups } = loadStats();
	const groups = buildComposerStatsGroups({
		ttftMs: 210,
		totalMs: 4300,
		tps: 31,
		sessionTps: 45,
		inputTokens: 800,
		outputTokens: 90,
	});
	assert.equal(groups[0], "首 token 210ms · 回复 4300ms · 流式 31 tok/s · 均速 45 tok/s");
	assert.equal(groups[1], "输入 800 tok · 输出 90 tok");

	const e2eGroups = buildComposerStatsGroups(
		{
			ttftMs: 210,
			totalMs: 4300,
			endToEndTps: 20.9,
			sessionEndToEndTps: 28.4,
		},
		0,
		"endToEnd",
	);
	assert.equal(e2eGroups[0], "首 token 210ms · 回复 4300ms · 端到端 21 tok/s · 端到端均速 28 tok/s");
});
