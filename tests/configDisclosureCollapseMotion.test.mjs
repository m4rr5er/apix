import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * 配置页 / 设置页折叠详情的开合动画契约（2026-10 motion 体验优化，第二批）。
 *
 * 背景：这些卡片原先写的是 `{isExpanded && <div className="... motion-safe:animate-in motion-safe:fade-in">}`：
 * 展开只有淡入，高度 0 → 实测值硬跳，把下面整片表单瞬间顶下去；收起直接卸载无过渡。
 * 现统一走 ui-shadcn/collapsible（Radix Collapsible + tw-animate-css collapsible-down/up：
 * 真高度渐变、Presence 等 exit 动画播完才卸载、reduced-motion 自动回退）。
 *
 * 两种落地形态，都不引入多余盒模型：
 * 1. **直接替换**（DIRECT_SWAP）：原本就有一个无 ref/无拖拽 props 的普通块容器，
 *    直接把它换成 <Collapsible>（Radix 仍渲染 div），DOM 层级与盒子完全不变。
 * 2. **contents 包装**（CONTENTS_WRAPPED）：外层挂着 ref / 拖拽 props / 列表语义（<li>），
 *    不能替换，于是在内部包一层 `className="contents"` 的 Collapsible 根：
 *    display:contents 不生成盒子，折叠态不留空档、展开态布局与改造前一致。
 *
 * 共同硬约束：折叠体不得再挂 motion-safe:animate-in / fade-in —— cn 走 twMerge，
 * 会把 animate-* 判成同一组，consumer 的 animate-in 会静默吃掉原语的高度动画。
 *
 * 同时钉住改造前就存在的对外契约（业务测试依赖它们）：
 * - ModelsTab 的 `config-provider-body`（wallpaperMode.test.mjs）
 * - ImTab 的 `aria-expanded={isExpanded}`（modalKeyboardAccess.test.mjs）
 *
 * 前两个走 contents 包装形态；后两个文件本就在清单里，补钉各自的瞬时挂载不得复活。
 *
 * 正则一律用 \s* 容忍换行缩进，格式化不应打红本契约。
 */

const read = (path) => readFileSync(`src/renderer/src/${path}`, "utf8");

/** 直接替换外层容器为 Collapsible 根（无 ref / 无拖拽 props 的普通块容器）。 */
const DIRECT_SWAP = ["components/workspace/ModelTraceDetail.tsx"];

/** 外层保留（ref / 拖拽 / <li> 语义），内部加 display:contents 包装层。 */
const CONTENTS_WRAPPED = ["components/config/SecuritySection.tsx", "config/ModelsTab.tsx", "config/AuthTab.tsx", "components/app/settings/ImTab.tsx", "components/app/git/GitGraph.tsx", "config/TokenDancePanel.tsx"];

const ALL = [...DIRECT_SWAP, ...CONTENTS_WRAPPED];

for (const path of ALL) {
	test(`${path} 折叠详情走共享折叠原语`, () => {
		const source = read(path);
		assert.match(source, /import \{\s*Collapsible,\s*CollapsibleContent\s*\}\s*from "[^"]*ui-shadcn\/collapsible"/, "must import the shared primitive instead of hand-rolling the disclosure");
		// 根必须受控：open 由既有业务状态驱动，Radix 不另持一份状态
		assert.match(source, /<Collapsible\s+open=\{\w+\}/, "the disclosure root must stay controlled by existing state");
		assert.match(source, /<CollapsibleContent/, "the collapsible body must be wrapped by CollapsibleContent");
	});

	test(`${path} 折叠体不再手绘入场动画`, () => {
		const source = read(path);
		// 自绘 animate-in 会经 twMerge 覆盖掉 animate-collapsible-down
		assert.doesNotMatch(source, /motion-safe:animate-in/, "animate-in on collapsed content silently overrides the height animation (twMerge groups animate-*)");
	});
}

for (const path of CONTENTS_WRAPPED) {
	test(`${path} 包装层不生成盒子（display:contents）`, () => {
		const source = read(path);
		assert.match(source, /<Collapsible\s+open=\{\w+\}\s+className="contents">/, "card is a flex/gap child: a boxing wrapper would add phantom spacing when collapsed");
	});
}

test("ModelsTab 保留 config-provider-body 契约类", () => {
	const source = read("config/ModelsTab.tsx");
	assert.match(source, /className="config-provider-body[^"]*"/, "wallpaperMode 契约依赖这个类名");
	// tag swap 后该类必须仍在折叠体本身，而不是被挪到包装层
	assert.match(source, /<CollapsibleContent\s+className="config-provider-body/, "config-provider-body must stay on the collapsible body");
});

test("ImTab 保留 aria-expanded 契约", () => {
	const source = read("components/app/settings/ImTab.tsx");
	assert.match(source, /aria-expanded=\{isExpanded\}/, "modalKeyboardAccess 契约依赖这个属性");
});

test("ProxyTab 的表格行刻意不迁移（包装 div 会破坏表格结构）", () => {
	const source = read("components/app/settings/ProxyTab.tsx");
	// TableRow 是 <tr>：塞 <div> 进表格会破坏语义与列宽计算，故保留纯淡入
	assert.doesNotMatch(source, /<Collapsible/, "表格行不应引入 Collapsible 包装（会生成 div 嵌套在表格里）");
});

test("LogViewer 的表格行同 ProxyTab 刻意不迁移", () => {
	const source = read("components/app/settings/LogViewer.tsx");
	assert.doesNotMatch(source, /<Collapsible/, "展开行是 <TableRow>：塞 <div> 进表格会破坏语义与列宽计算");
});

test("TokenDancePanel 展开详情不再瞬时挂载", () => {
	const source = read("config/TokenDancePanel.tsx");
	assert.doesNotMatch(source, /\{expanded\s*&&\s*\(/, "详情块必须常驻 CollapsibleContent 受控开合，不得回退条件挂载");
	// 对外契约：整行标题的 aria-expanded 是既有可访问性承诺，迁移不得顺手删
	assert.match(source, /aria-expanded=\{expanded\}/, "标题行必须继续声明 aria-expanded");
});

test("AuthTab 使用引导与选择供应商面板开合不再瞬时挂载", () => {
	const source = read("config/AuthTab.tsx");
	assert.doesNotMatch(source, /\{showGuide\s*&&\s*\(/, "使用引导是可再开的 disclosure，必须走折叠原语高度动画");
	assert.doesNotMatch(source, /\{selectingProvider\s*&&\s*\(/, "选择供应商面板开合把整个供应商列表顶开/收拢，必须走高度动画");
	assert.match(source, /<Collapsible\s+open=\{showGuide\}\s+className="contents">/);
	assert.match(source, /<Collapsible\s+open=\{selectingProvider\}\s+className="contents">/);
});

test("ModelsTab Provider 配置指南开合不再瞬时挂载", () => {
	const source = read("config/ModelsTab.tsx");
	assert.doesNotMatch(source, /\{showGuide\s*&&\s*\(/, "配置指南是可再开的 disclosure，必须走折叠原语高度动画");
	assert.match(source, /<Collapsible\s+open=\{showGuide\}\s+className="contents">/);
});

test("ImTab 添加 Bot 表单开合不再瞬时挂载", () => {
	const source = read("components/app/settings/ImTab.tsx");
	assert.doesNotMatch(source, /\{showAddForm\s*&&\s*\(/, "添加表单必须常驻 CollapsibleContent 受控开合，不得回退条件挂载");
	assert.match(source, /<Collapsible\s+open=\{showAddForm\}\s+className="contents">/);
});
