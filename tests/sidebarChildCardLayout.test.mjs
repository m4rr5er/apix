import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { readRendererStyles } from "./helpers/rendererStyles.mjs";

/**
 * pure official P2-2：子行尺寸/hover 由组件 Tailwind 承担。
 * 仍保留 session-card 透明容器与状态徽标契约。
 */

const styles = readRendererStyles();
const titleScrollText = readFileSync("src/renderer/src/components/sidebar/TitleScrollText.tsx", "utf8");
const sessionTree = readFileSync("src/renderer/src/components/sidebar/SessionTree.tsx", "utf8");
const activeSessionsTree = readFileSync("src/renderer/src/components/sidebar/ActiveSessionsTree.tsx", "utf8");
const recentSessionSection = readFileSync("src/renderer/src/components/sidebar/RecentSessionsSection.tsx", "utf8");
const projectTree = readFileSync("src/renderer/src/components/sidebar/ProjectTree.tsx", "utf8");
const agentListDisplay = readFileSync("src/renderer/src/agentListDisplay.ts", "utf8");
const tabBar = readFileSync("src/renderer/src/components/session/SessionTabsBar.tsx", "utf8");
const sessionView = readFileSync("src/renderer/src/components/session/SessionView.tsx", "utf8");
const sourceBadge = readFileSync("src/renderer/src/components/session/SessionSourceBadge.tsx", "utf8");

test("sidebar workspace wrapper stays transparent", () => {
	const workspaceCard = styles.match(/\.chat-list-pane\.v3-braun \.sidebar-body \.session-card \{([\s\S]*?)\n\}/)?.[1];
	assert.ok(workspaceCard, "sidebar workspace card styles must exist");
	assert.match(workspaceCard, /background:\s*transparent;/);
	assert.match(workspaceCard, /border:\s*0;/);
	assert.match(workspaceCard, /overflow:\s*visible;/);
});

test("session status indicators stay on the concrete session row", () => {
	// Tab 与侧栏会话行共享蓝/黄/红状态点语义。
	assert.match(agentListDisplay, /export function sessionStatusDotClass/);
	assert.match(agentListDisplay, /case "idle"/);
	assert.match(agentListDisplay, /return "bg-info"/);
	assert.match(agentListDisplay, /case "error"/);
	assert.match(agentListDisplay, /return "bg-danger"/);
	assert.match(agentListDisplay, /case "running"/);
	assert.match(agentListDisplay, /return "bg-warning"/);
	// 未启动/无 runtime（含 detached）不渲染色点。
	assert.match(agentListDisplay, /if \(!status \|\| status === "detached"\) return undefined/);
	// SessionTree 不再渲染带文本的状态徽标；无 runtime 的历史记录不显示状态点。
	assert.doesNotMatch(sessionTree, /\/agent-status-indicator/);
	assert.match(sessionTree, /function renderRuntimeStatusDot/);
	assert.match(sessionTree, /<SessionActivityIndicator status=\{status\} sessionId=\{sessionId\} \/>/);
	assert.match(sessionTree, /renderRuntimeStatusDot\(child\.agent\.status, agentSession\?\.id\)/);
	assert.match(sessionTree, /renderRuntimeStatusDot\(runtimeSnapshot\?\.status, child\.session\.id\)/);
	// Tab 同样未启动不显示徽章，已启动按状态映射渲染（beui AnimatedBadge 替换裸圆点）。
	assert.match(tabBar, /import \{ sessionStatusBadge \} from "\.\.\/\.\.\/utils\/sessionStatusBadge"/);
	assert.match(tabBar, /const badge = sessionStatusBadge\(status, \{/);
	assert.match(tabBar, /AnimatedBadge/);
	assert.match(tabBar, /badge &&/);
	assert.doesNotMatch(tabBar, /dotClass &&/);
});

test("project children use spacing without connector lines and chat uses the shared row", () => {
	assert.doesNotMatch(projectTree, /border-l/);
	assert.match(styles, /\.worktree-children \{[\s\S]*?border-left:\s*0;/);
	assert.doesNotMatch(projectTree, /chat-project-guide/);
	assert.doesNotMatch(styles, /\.project-group\.chat-project-group/);
});

test("session tabs stay outside SessionView; header is standalone in pane", () => {
	assert.match(tabBar, /actions\?: ReactNode/);
	assert.match(tabBar, /props\.onToggleDrawer \? \(/);
	// Tab 栏外置后，SessionView 只渲染独立 Header，不再把操作嵌入 Tab 的 actions 槽。
	assert.doesNotMatch(sessionView, /SessionTabsBar/);
	// header 不再接收 widget chips（2026-08 移除：待办统一走输入框上方常驻条）
	assert.doesNotMatch(sessionView, /widgetChips/);
	assert.doesNotMatch(sessionView, /embedded/);
});

/**
 * 身份标位置契约（用户反馈）：会话列表里 agent/backend logo 原先在标题右侧，
 * 要求与顶部 Tab 一致放在标题左侧。源码顺序断言（空白容忍），防止后续重排又挪回去。
 */
test("sidebar session rows put backend/source marks left of the title (like tabs)", () => {
	const indexOf = (source, pattern, label) => {
		const index = source.search(pattern);
		assert.ok(index >= 0, label);
		return index;
	};
	const assertMarkBeforeTitle = (source, markPattern, titlePattern, label) => {
		const mark = indexOf(source, markPattern, label + "：缺少身份标");
		const title = indexOf(source, titlePattern, label + "：缺少标题组件");
		assert.ok(mark < title, label + "：agent logo 必须在标题左侧（与顶部 Tab 一致）");
	};

	// 项目树：运行中 Agent 行 / 历史会话行 / 草稿行 / 子会话行
	assertMarkBeforeTitle(sessionTree, /<AcpBackendMark acpToolId=\{agentSession\?\.acpToolId\}/, /<TitleScrollText text=\{displayTitle\}/, "SessionTree 运行中 Agent 行");
	assertMarkBeforeTitle(sessionTree, /<AcpBackendMark acpToolId=\{child\.session\.acpToolId\}/, /<TitleScrollText text=\{child\.session\.name/, "SessionTree 历史会话行");
	assertMarkBeforeTitle(sessionTree, /<AcpBackendMark acpToolId=\{session\.acpToolId\}/, /<TitleScrollText text=\{session\.title/, "SessionTree 草稿行");
	assertMarkBeforeTitle(sessionTree, /\{badge\}/, /<TitleScrollText text=\{title\} \/>/, "SessionTree 子会话行");
	// 历史会话行的来源徽标（codex 等）同样在标题左侧
	assertMarkBeforeTitle(sessionTree, /<SessionSourceBadge source=\{child\.session\.source\}/, /<TitleScrollText text=\{child\.session\.name/, "SessionTree 历史会话来源标");
	// 活动树与最近会话区
	assertMarkBeforeTitle(activeSessionsTree, /<AcpBackendMark acpToolId=\{record\?\.acpToolId\}/, /<TitleScrollText text=\{displayTitle\}/, "ActiveSessionsTree 活动行");
	assertMarkBeforeTitle(recentSessionSection, /<AcpBackendMark acpToolId=\{row\.session\.acpToolId\}/, /<TitleScrollText text=\{displayTitle\}/, "RecentSessionsSection 最近会话行");
});
