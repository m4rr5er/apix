import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * 低成本体验包（借鉴 Vercel AI Elements）：
 * 1. Shimmer 微光文本——RespondingIndicator 进行态标签用渐变扫光提示活动进行中；
 * 2. 思考耗时人性化——ThinkingBlock 展示「思考了 Xs / Thought for Xs」，不再裸显工程化数字。
 */

const shimmerSource = readFileSync("src/renderer/src/components/session/ShimmerText.tsx", "utf8");
const cardsSource = readFileSync("src/renderer/src/components/session/TimelineEventCards.tsx", "utf8");
const webTimeline = readFileSync("src/renderer/src/web/WebTimeline.tsx", "utf8");
const timelineCss = readFileSync("src/renderer/src/styles/timeline.css", "utf8");
const zhCN = readFileSync("src/renderer/src/i18n/rendererCopy.zh-CN.ts", "utf8");
const enUS = readFileSync("src/renderer/src/i18n/rendererCopy.en-US.ts", "utf8");

test("ShimmerText 零依赖 CSS 实现：bg-clip-text + Tailwind 动画，不新增手写 CSS class", () => {
	assert.match(shimmerSource, /export function ShimmerText/);
	assert.match(shimmerSource, /bg-clip-text text-transparent/);
	// 动画走 Tailwind 工具类 + motion-safe（reduced-motion 退化为静态文本）
	assert.match(shimmerSource, /motion-safe:animate-\[shimmer-sweep/);
	// 明暗取语义 token，暗色模式自适应
	assert.match(shimmerSource, /--color-text-tertiary/);
	assert.match(shimmerSource, /--color-text-primary/);
	assert.match(shimmerSource, /--color-warning/);
	// 不引第三方动画库（零依赖约束）
	assert.doesNotMatch(shimmerSource, /from "(framer-motion|motion|gsap)/);
});

test("shimmer-sweep keyframes 定义在 timeline.css（规则允许 keyframes）", () => {
	assert.match(timelineCss, /@keyframes shimmer-sweep/);
});

test("RespondingIndicator 短语文案中英同步", () => {
	// 只列状态条真正会渲染的 key。executing2/3、responding2 已随「猜测轮播」下线，
	// 不再断言它们存在（key 仍保留在 i18n，删掉会制造两个大文件的无效 diff）。
	for (const suffix of ["starting1", "starting2", "starting3", "executing1", "responding1", "responding3", "compacting", "waiting"]) {
		const key = `agent.loading.${suffix}`;
		assert.match(zhCN, new RegExp(`"${key}":`));
		assert.match(enUS, new RegExp(`"${key}":`));
	}
});

test("状态条只在观测不到子阶段的 starting 轮播，其余状态单条不轮播", () => {
	// 轮播每 1.8s 换一句与后台无关的猜测文案（思考中 → 组织回答 → 撰写回复），
	// 用户反馈「经常轮询展示、不能真实反映后台」。契约：只有 starting 允许多条。
	const start = cardsSource.indexOf("const RESPONDING_PHRASES");
	const table = cardsSource.slice(start, cardsSource.indexOf("\n};", start) + 3);
	const multi = [...table.matchAll(/^\s*(\w+):\s*\[([^\]]*)\],/gm)].filter(([, , body]) => body.split("t(").length - 1 > 1).map(([, kind]) => kind);
	assert.deepEqual(multi, ["starting"], "只有 starting 可以轮播；其余状态必须单条，否则文案会与后台脱节");
	// 已下线的猜测短语不得回到表里
	assert.doesNotMatch(table, /executing2|executing3|responding2/);
	// 思考与正文是两个独立条目，各自对应真实阶段
	assert.match(table, /thinking:\s*\[t\("agent\.loading\.responding1"\)\]/);
	assert.match(table, /responding:\s*\[t\("agent\.loading\.responding3"\)\]/);
});

test("ThinkingBlock 耗时改人性化 i18n 文案，不再裸显数字", () => {
	const block = cardsSource.match(/function ThinkingBlock[\s\S]*?\n\t\},\n/)?.[0] ?? "";
	assert.ok(block, "ThinkingBlock must exist");
	assert.match(block, /thinking\.duration/);
	// 耗时仍由 startedAt/endedAt 计算（c73f05c7 重构后变量名 durationMs → durationText）
	assert.match(block, /formatDuration\(props\.endedAt - props\.startedAt\)/);
});

test("thinking.duration 文案中英同步", () => {
	assert.match(zhCN, /"thinking\.duration": "思考了 \{duration\}"/);
	assert.match(enUS, /"thinking\.duration": "Thought for \{duration\}"/);
});

test("WebThinkingBlock stays collapsed by default and does not auto-expand while streaming", () => {
	const block = webTimeline.match(/function WebThinkingBlock[\s\S]*?^\}\);/m)?.[0] ?? "";
	assert.ok(block, "WebThinkingBlock must exist");
	assert.match(block, /useState\(false\)/);
	assert.doesNotMatch(block, /Boolean\(props\.running\)/);
	assert.doesNotMatch(block, /if \(props\.running\) setExpanded\(true\)/);
	assert.match(block, /<SingleLinePreview/);
});

test("thinking Brain logo uses thinking-row-icon instead of gray text utilities", () => {
	const block = cardsSource.match(/function ThinkingBlock[\s\S]*?\n\t\},\n/)?.[0] ?? "";
	assert.ok(block, "ThinkingBlock must exist");
	assert.match(block, /<Brain size=\{16\} className="thinking-row-icon shrink-0"/);
	assert.doesNotMatch(block, /<Brain[^>]*text-text-secondary/);
});

test("thinking markdown is one size smaller than chat body", () => {
	assert.match(timelineCss, /\[data-marker-kind="thinking"\] \.markdown-body[\s\S]*?font-size:\s*var\(--font-size-control\)/);
	assert.doesNotMatch(timelineCss, /\[data-marker-kind="thinking"\] \.markdown-body[\s\S]*?font-size:\s*var\(--font-size-chat\)/);
});

test("interim answers share chat body size; process variant only adds spacing from tool/thinking rows", () => {
	assert.match(timelineCss, /\.execution-interim \{[\s\S]*?font-size:\s*var\(--font-size-chat\)/);
	assert.doesNotMatch(timelineCss, /\.execution-interim\[data-variant="process"\]/);
	const answer = readFileSync("src/renderer/src/components/session/AnswerOutput.tsx", "utf8");
	// 中间回复：段前段后各 20px（my-5，与行数无关）；行高仍走 --line-height-chat，不额外加 leading-*
	assert.match(answer, /execution-interim markdown-body my-5 text-chat/);
	assert.doesNotMatch(answer, /execution-interim markdown-body my-5 text-chat[^"]*leading-/);
	assert.match(answer, /execution-interim markdown-body text-chat text-text-primary/);
	assert.doesNotMatch(answer, /mt-3 text-chat/);
});
