import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { twMerge } from "tailwind-merge";

// 侧栏行操作按钮防重叠契约（2027-01 用户反馈）：
// 三个树（ProjectTree/SessionTree/WorktreeTree）的行操作按钮是 absolute 浮层，
// hover 显现时会盖住行文本。修复策略：行文本用 group-hover:pr-* 在 hover 时压出
// 按钮宽度的右侧留白，文本截断让位但保持可见。所有宽度统一让位（不止窄侧栏）——
// 中等宽度下长项目名/长会话名同样会延伸到按钮下方（“+ 号叠在项目名上”反馈）。
// 注意：v1 曾用 opacity-0 整行淡出，用户反馈「文字变白不可读、须点击激活才能看到」，
// 已弃用（见本文件 doesNotMatch 断言防回退）。
// 本测试锁定：三棵树的行 hover 让位宽度与按钮浮层模式不被破坏。
// 注：WorktreeTree 用命名组 /workspace-row（主/子行共用 workspaceActionPaddingClass
// 裁剪出入 52px 让位）；SidebarContent 的 aside 已不再需要 @container 容器查询锚点。

const read = (p) => readFileSync(p, "utf8");

const prVariant = /@max-\[255px\]:group-hover(?:\/row)?:pr-/;

test("sidebar host needs no container query anchor", () => {
	const src = read("src/renderer/src/components/sidebar/SidebarContent.tsx");
	// 各树统一用 group-hover:pr-* 让位，不再按侧栏宽度用 @max-[255px] 分断点，
	// aside 上的 @container 锚点因此没有消费者，禁止回退到容器查询门控。
	assert.doesNotMatch(src, /chat-list-pane v3-braun @container/);
});

test("project menu pins text clearance with the same state that keeps its actions visible", () => {
	const src = read("src/renderer/src/components/sidebar/ProjectTree.tsx");
	assert.match(src, /const\s+menuOpen\s*=\s*props\.controller\.menu\?\.kind\s*===\s*"project"\s*&&\s*props\.controller\.menu\.projectId\s*===\s*project\.id/);
	assert.match(src, /menuOpen\s*&&\s*"pr-\[88px\]"/);
	assert.match(src, /menuOpen\s*&&\s*"pointer-events-auto opacity-100"/);
});

test("session rows yield to hover actions on narrow sidebar", () => {
	const src = read("src/renderer/src/components/sidebar/SessionTree.tsx");
	// agent 行、运行中会话行、历史会话行、普通会话行共 4 处 conversation-body 全部接入
	// （一个 size-6 更多按钮 → 28px 留白）
	const matches = src.match(/conversation-body min-w-0 flex-1 transition-\[padding-right\] group-hover\/row:pr-7 group-focus-within\/row:pr-7/g);
	assert.ok(matches && matches.length === 4, `expected 4 row bodies, got ${matches?.length ?? 0}`);
	// 浮层模式不变
	assert.match(src, /row-more-actions pointer-events-none absolute top-1\/2 right-1/);
	assert.doesNotMatch(src, /conversation-body[^\n]*opacity-0/);
});

test("hover yield classes survive tailwind-merge", () => {
	// 防回归：cn() 的 tailwind-merge 不得吞掉 group-hover/group-focus-within 的 pr 让位类
	// （不同修饰键的 pr 互不冲突，均应保留）
	const merged = twMerge("min-w-0 flex-1 truncate transition-[padding-right] group-hover:pr-16 group-focus-within:pr-16");
	assert.match(merged, /group-hover:pr-16/);
	assert.match(merged, /group-focus-within:pr-16/);
	assert.match(merged, /transition-\[padding-right\]/);
	// 项目行筛选按钮出现时：同修饰键同组冲突，88px 版本应胜出（让位加宽）
	const filtered = twMerge("transition-[padding-right] group-hover:pr-16 group-focus-within:pr-16", "group-hover:pr-[88px] group-focus-within:pr-[88px]");
	assert.match(filtered, /group-hover:pr-\[88px\]/);
	assert.match(filtered, /group-focus-within:pr-\[88px\]/);
	assert.doesNotMatch(filtered, /pr-16/);
	// 子行同一规则：与 52px 让位类合并时同样保留
	const rowMerged = twMerge("min-w-0 flex-1 truncate transition-[padding-right] group-hover/workspace-row:pr-[52px] group-focus-within/workspace-row:pr-[52px]");
	assert.match(rowMerged, /group-hover\/workspace-row:pr-\[52px\]/);
	assert.match(rowMerged, /group-focus-within\/workspace-row:pr-\[52px\]/);
});

test("subagent pill never lands on the row ⋯ while the timestamp yields", () => {
	const src = read("src/renderer/src/components/sidebar/SessionTree.tsx");
	// 2027-02 用户反馈：胶囊右移到时间戳旁边后，hover 时行尾的「⋯」看不到/被压住。
	// 实测成因（真实 Chromium + 编译后 CSS 量测）：时间戳 display:none 是瞬时生效的，
	// 而 hover 让位 padding 要走 150ms，中间那段胶囊正落在「⋯」的 28px 槽位上（重叠 19px，
	// 「⋯」字符被压在胶囊盒内）。修复两半，缺一不可：
	//   ① 胶囊后面没有时间戳时（运行中 Agent 行）由胶囊自己 last:mr-7 预留槽位——它本来就是行内最后一个元素；
	//   ② 有时间戳时把「消失」换成与 padding 同步的宽度收拢，胶囊缓慢滑过去而不是跳过去。
	// 量测结论：会话行全程胶囊右缘 ≤ 1360（「⋯」盒左缘 1372），Agent 行恒 ≥ 9px 间距，任意帧都不重叠。
	assert.match(src, /subagent-inline-toggle\s+px-1\s+py-0\.5\s+last:mr-7/);
	assert.match(src, /w-max\s+shrink-0\s+overflow-hidden\s+whitespace-nowrap[^"]*transition-\[width,opacity\][^"]*\[interpolate-size:allow-keywords\]/);
	assert.match(src, /group-hover\/row:w-0[^"]*group-hover\/row:opacity-0/);
	// 时间戳不得回退成 display:none：瞬时消失 = 胶囊一步跳到行尾压在「⋯」上
	assert.doesNotMatch(src, /text-muted-foreground group-hover\/row:hidden/);
});
