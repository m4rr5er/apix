import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { formatPercent } from "../src/renderer/src/components/session/TimelineFormat.ts";
import { loadTsCommonJs } from "./helpers/loadTsCommonJs.mjs";

const meterPath = "src/renderer/src/components/session/SessionContextMeter.tsx";
const meterSource = () => readFileSync(meterPath, "utf8");
const bottomBarSource = () => readFileSync("src/renderer/src/components/session/ComposerComponents.tsx", "utf8");
const zh = () => readFileSync("src/renderer/src/i18n/rendererCopy.zh-CN.ts", "utf8");
const en = () => readFileSync("src/renderer/src/i18n/rendererCopy.en-US.ts", "utf8");

function loadMeterHelpers() {
	return loadTsCommonJs(meterPath, {
		stubs: {
			react: {},
			"../../i18n": { t: (key) => key },
			"../../../../shared/compactFeedback": loadTsCommonJs("src/shared/compactFeedback.ts"),
			"../../atoms/app-ui-atoms": {},
			"../ui-shadcn/tooltip": {},
			"../app/ProviderUsageDetails": {},
			"./SurfaceComponents": {},
		},
	});
}

test("formatPercent keeps sub-percent precision for small context usage", () => {
	// 1M 窗口下 408 tokens ≈ 0.04%：整数四舍五入会显示成「0%」，必须保留有效数字
	assert.equal(formatPercent(0.0408), "0.04");
	assert.equal(formatPercent(0), "0");
	assert.equal(formatPercent(0.004), "0"); // 两位小数后仍为 0
	assert.equal(formatPercent(0.996), "1");
	assert.equal(formatPercent(1), "1");
	assert.equal(formatPercent(1.26), "1.3");
	assert.equal(formatPercent(9.94), "9.9");
	assert.equal(formatPercent(10), "10");
	assert.equal(formatPercent(45), "45");
	assert.equal(formatPercent(45.3), "45");
	assert.equal(formatPercent(100), "100");
});

test("meter panel shows the localized reading and ~used/window figures", () => {
	const source = meterSource();
	// 面板 320px：style.width 与定位回退共用 PANEL_WIDTH，避免首帧 offsetWidth=0 时按旧 264 错位
	assert.match(source, /const PANEL_WIDTH = 320/);
	assert.match(source, /width: PANEL_WIDTH/);
	assert.match(source, /panel\.offsetWidth \|\| PANEL_WIDTH/);
	assert.doesNotMatch(source, /w-\[264px\]/);
	assert.match(source, /t\("sessionContext\.used", \{ percent: formatPercent\(percent\) \}\)/);
	assert.match(source, /formatTokens\(context\.usedTokens!\)\} \/ \$\{formatTokens\(context\.contextWindow!\)\}/);
	// 面板占用条：4px 圆角条，宽度按 percent
	assert.match(source, /h-1 overflow-hidden rounded-full bg-muted/);
	assert.match(source, /width: `\$\{percent\}%`/);
	assert.match(source, /data-testid="session-context-meter"/);
});

test("input/output token row drops arrows and keeps values on one line", () => {
	const surface = readFileSync("src/renderer/src/components/session/SurfaceComponents.tsx", "utf8");
	const meter = meterSource();
	// 标签已是「输入/输出 tokens」，数值不再套 ↑/↓（箭头加长字符串，且 `/ ↓` 会在窄面板折行）
	assert.match(surface, /label: t\("ctx\.detail\.tokens"\),\s*value: `\$\{formatCompact\(state\.inputTokens\)\} \/ \$\{formatCompact\(state\.outputTokens\)\}`,/);
	assert.doesNotMatch(surface, /↑ \$\{formatCompact\(state\.inputTokens\)\} \/ ↓/);
	// 详情数值禁止折行：tooltip 与上下文面板共用同一 builder 文案，窄宽下必须 nowrap
	assert.match(surface, /min-w-0 whitespace-nowrap text-right font-mono font-semibold tabular-nums text-popover-foreground/);
	assert.match(meter, /min-w-0 whitespace-nowrap text-right font-mono font-semibold tabular-nums text-foreground/);
});

test("panel re-anchors on scroll instead of closing during streaming", () => {
	const source = meterSource();
	// 定位逻辑抽成 positionPanel 供 layout effect 与滚动/resize 复用
	assert.match(source, /const positionPanel = useCallback\(\(\) => \{\s*const trigger = triggerRef\.current;/);
	// 滚动监听回调不再是「关闭面板」（旧行为：任何滚动/缩放都 setOpen(false)，
	// 流式渲染追底滚动会反复点开即关）
	assert.doesNotMatch(source, /const onViewportChange = \(\): void => setOpen\(false\);/);
	assert.doesNotMatch(source, /addEventListener\("scroll", onViewportChange, true\)/);
	// 改为重新锚定：capture 滚动 + rAF 合并 + 位置未变不重复 setState
	// （流式追底滚动每帧触发 scroll，trigger 固定时避免每帧 re-render）
	assert.match(source, /addEventListener\("scroll", reanchor, true\)/);
	assert.match(source, /requestAnimationFrame\(positionPanel\)/);
	// 格式化后单行且无尾逗号：只锁「位置未变则复用 prev」的比较语义。
	assert.match(source, /setPlacement\(\(prev\) => \(prev !== null && prev\.left === left && prev\.top === top \? prev : \{ left, top \}\)\);/);
	// 外点 / Escape 仍是唯一关闭途径（监听保持）
	assert.match(source, /addEventListener\("pointerdown", onPointerDown\)/);
	assert.match(source, /addEventListener\("keydown", onKeyDown\)/);
});

test("usage block is delegated to the shared ProviderUsageDetails with settings deep-link on failure", () => {
	const source = meterSource();
	// 圆球面板用量区块 = 共享 ProviderUsageDetails（与模型选择器展开区同一份数据源与视觉，
	// 本组件只决定「是否渲染」与「失败跳转」，不再自持 fetch/缓存/展示逻辑）
	assert.match(source, /import \{ ProviderUsageDetails \} from "\.\.\/app\/ProviderUsageDetails"/);
	assert.match(source, /<ProviderUsageDetails provider=\{provider\} backend=\{props\.backend\} onConfigureUsage=\{onConfigureUsage\} \/>/);
	// 失败态入口 = 跳「设置 → 配置管理 → 模型」并定位该供应商（openSettingsAtom 深链）
	assert.match(source, /openSettingsAtom/);
	assert.match(source, /configTab: "models", provider \}/);
	// 旧的「装 skill + 预填输入框」链路已整体删除（配置唯一入口在模型页）
	assert.doesNotMatch(source, /onInsertUsageProbePrompt/);
	assert.doesNotMatch(source, /installUsageSkill/);
	assert.doesNotMatch(source, /usageCache/);
});

test("provider usage inline stays silent when usage is not enabled", () => {
	const source = readFileSync("src/renderer/src/components/app/ProviderUsageInline.tsx", "utf8");
	// 未开启/失败/不支持 → 不渲染任何文案（查不到就不显示），底部行组件已删除、无空占位。
	assert.doesNotMatch(source, /provider-usage-not-enabled/);
	assert.doesNotMatch(source, /provider-usage-footer-configure/);
	assert.doesNotMatch(source, /空占位/);
});

test("recognized usage badge keeps its label separated from the hint", () => {
	const source = readFileSync("src/renderer/src/config/UsageProbeConfigDialog.tsx", "utf8");
	const badgeSection = source.match(/\{hintKey && \([\s\S]*?\n\s*\)\}/)?.[0] ?? "";
	// 徽标文字按单行盒渲染，并与下一行说明保持明确间距，避免高字号/主题切换时叠字。
	assert.match(badgeSection, /text-micro leading-none tracking-wide/);
	// 徽标与说明同行布局：水平 flex + 明确间距，既防叠字又防 flex-col cross-axis stretch
	// 把徽标拉成整行宽的「大灰杠」（用户截图里的视觉 bug）。
	assert.match(badgeSection, /flex items-center gap-2/);
	// 徽标必须显式禁止在 flex 轴上收缩/拉伸，保持内容宽。
	assert.match(badgeSection, /inline-flex shrink-0/);
	assert.doesNotMatch(badgeSection, /flex flex-col/);
});

test("provider usage inline keeps no bottom row footprint", () => {
	const source = readFileSync("src/renderer/src/components/app/ProviderUsageInline.tsx", "utf8");
	// 底部行组件（ProviderUsageRow）已随三处页面迁移删除：无 justify-end/h-9 底栏残留。
	assert.doesNotMatch(source, /export function ProviderUsageRow/);
	assert.doesNotMatch(source, /justify-end/);
	assert.doesNotMatch(source, /h-9/);
});

test("usage probe dialog separates title from enable row", () => {
	const source = readFileSync("src/renderer/src/config/UsageProbeConfigDialog.tsx", "utf8");
	// 标题与启用开关是两个视觉层级，标题下必须保留稳定的呼吸间距。
	assert.match(source, /<DialogHeader className="px-5 pt-4 pb-2">/);
});

test("ProviderUsageDetails renders each usage window as a labeled progress row", () => {
	const source = readFileSync("src/renderer/src/components/app/ProviderUsageDetails.tsx", "utf8");
	// 多窗口分支优先命中（windows.length > 0 在普通 credits 分支之前）
	assert.match(source, /windows\.length > 0 \? \(/);
	// 每个窗口一行：label（5h/周）+ 进度条 + 百分比 + 剩余小字
	// 窗口 label 走 providerUsageDisplay.usageWindowLabelText 统一映射
	// （与 inline 多段行同源；内置 key 统一 i18n，未知 key 原样展示）
	assert.match(source, /usageWindowLabelText\(window\.key, t\)/);
	assert.match(source, /t\("sessionContext\.usageWindowRemaining", \{ n: formatAmount\(remaining\) \}\)/);
	// 用超封顶 100、≥90% 红字警示（与 periods 同判断）
	// 封顶与 used 缺失时 total-remaining 反推都由 providerUsageDisplay.usageWindowPercent 负责（#380），
	// 面板只做四舍五入取整——两处各算一份正是「详情面板恒显示 —」的根因。
	assert.match(source, /usageWindowPercent\(window\)/);
	assert.match(source, /pct != null && pct >= 90/);
});

test("usage windows copy is present in both locale dictionaries", () => {
	for (const locale of [zh(), en()]) {
		assert.match(locale, /"sessionContext\.usageWindowFiveHour":/);
		assert.match(locale, /"sessionContext\.usageWindowWeekly":/);
		assert.match(locale, /"sessionContext\.usageWindowRemaining":/);
	}
	assert.match(zh(), /"sessionContext\.usageWindowFiveHour": "5小时"/);
	assert.match(en(), /"sessionContext\.usageWindowFiveHour": "5h"/);
});

// 圆环常驻：无 capacity 数据（会话未运行/模型切换瞬间）也渲染 0% 占位环，
// 面板内容降级为「暂不可用」，不再整环隐藏（用户要求非激活会话也要常驻）。
test("meter stays visible without capacity: placeholder ring + unavailable panel", () => {
	const source = meterSource();
	// percent 兜底 0：环照画（strokeDasharray 按 percent 计算），不 return null
	assert.match(source, /const percent = context\?\.percent \?\? 0;/);
	assert.doesNotMatch(source, /if \(context === null\) return null/);
	// 面板标题走 reading（占位时显示 unavailable 文案），figures 仅在可用时渲染
	assert.match(source, /<span className="text-text-tertiary" title=\{t\("sessionContext\.usageHint"\)\}>[\s\S]*?\{reading\}[\s\S]*?<\/span>/);
	assert.match(source, /\{available && figures !== undefined && /);
	// 不再因 capacity 消失自动关闭面板
	assert.doesNotMatch(source, /if \(!available && open\) setOpen\(false\)/);
	// 面板定位/外点/滚动监听不再受可用性限制
	assert.doesNotMatch(source, /if \(!open \|\| !available\) return;/);
	// 占用条/图例在无可用时隐藏；压缩按钮无数据时传 undefined → compactUiState not ready（禁用）
	assert.match(source, /\{available && segments !== null && \(/);
	assert.match(source, /t\("sessionContext\.unavailable"\)/);
});

test("placeholder copy is present in both locale dictionaries", () => {
	assert.match(zh(), /"sessionContext\.unavailable": "上下文数据暂不可用"/);
	assert.match(en(), /"sessionContext\.unavailable": "Context data unavailable"/);
});

test("usage provider falls back to session/default model so idle sessions can still probe usage", () => {
	const meterSource = readFileSync(meterPath, "utf8");
	// 非激活会话没有 runtime state，组件用会话记录/默认 model 推导的 provider 兜底查用量
	assert.match(meterSource, /fallbackProvider\?: string/);
	assert.match(meterSource, /const provider = props\.state\?\.provider\?\.trim\(\) \|\| props\.fallbackProvider\?\.trim\(\) \|\| undefined;/);
	// 用量查询不依赖 agent 运行（注释里明示设计意图）
	assert.match(meterSource, /用量查询不依赖 agent 运行/);
});
