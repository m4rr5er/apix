import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * 底栏动作（设置/备忘录/今日用量/主题切换）迁移为 beUI Dock（motion/dock）：
 * 浮动卡片容器铺满底栏宽度（w-full + justify-between 均匀分布四个动作）；
 * 按钮本体仍是 shadcn ghost Button，aria-label 与 onClick 回调保持原契约；
 * hover 提示统一 styled Tooltip（side="right"/delay 300），原生 title 全部退场；
 * 主题按钮的图标/文案反映当前模式，翻转规则由 themeAppearance.toggleThemeMode 承担。
 */

const sidebar = readFileSync("src/renderer/src/components/sidebar/SidebarContent.tsx", "utf8");

test("v3 sidebar bottom actions render inside a full-width beUI Dock", () => {
	assert.match(sidebar, /import \{ Dock, DockItem \} from "\.\.\/motion\/dock";/);
	assert.match(sidebar, /<Dock size=\{32\} className="w-full justify-between">/);
	// 4 项 = 设置 / 备忘录 / 今日用量 / 主题。官网按钮已并入侧栏顶部的 AboutPopover。
	assert.equal((sidebar.match(/<DockItem>/g) || []).length, 4);
});

test("dock replaces the old feedback entry with today's AI-AAA usage", () => {
	const dockBlock = sidebar.slice(sidebar.indexOf("<Dock size={32}"));
	assert.match(sidebar, /import \{ AiAaaUsageButton \} from "\.\/AiAaaUsageButton";/);
	assert.match(dockBlock, /<AiAaaUsageButton \/>/);
	// 旧反馈入口必须从底栏消失（反馈 UI 本身仍在，只是不再占用 dock）。
	assert.doesNotMatch(dockBlock, /feedback\.title/);
	assert.doesNotMatch(dockBlock, /onOpenFeedback/);
	// 设置按钮：更新角标场景的文案进 aria-label（读屏/键盘），可见解释由 Tooltip 清单承担；
	// 首次解释气泡改挂 dock 行容器（与 Dock 同级），不再寄生在 DockItem 内。
	assert.match(sidebar, /<UpdateDotHint hasPendingUpdate=\{hasPendingUpdate\}/);
	assert.match(dockBlock, /aria-label=\{hasPendingUpdate \? t\("settings.titleWithUpdate"\) : t\("settings.title"\)\}["\s\S]*?onClick=\{props\.onOpenSettings\}/);
	// 直接写在 SidebarContent 里的 Tooltip 只剩设置与主题两处；备忘录/今日用量的 Tooltip 在各自组件内部。
	assert.equal((dockBlock.match(/<Tooltip delayDuration=\{300\}>/g) || []).length, 2);
	// 主题按钮：aria 用当前模式的完整文案，Tooltip 内容同源，回调走 onToggleTheme
	assert.match(dockBlock, /aria-label=\{themeToggleTitle\} onClick=\{props\.onToggleTheme\}/);
	assert.match(dockBlock, /<TooltipContent side="right" sideOffset=\{6\}>\s*\{themeToggleTitle\}/);
	// 回归：原生 title 不得回潮（与 styled Tooltip 双弹且样式割裂）
	assert.doesNotMatch(dockBlock, /title=\{themeToggleTitle\}/);
	// 关于弹框只保留版本/运行时信息：官网、GitHub、更新日志、版本发布入口均已移除。
	const about = readFileSync("src/renderer/src/components/app/AboutPopover.tsx", "utf8");
	assert.doesNotMatch(about, /WEBSITE_URL|about\.website|about\.github|about\.releases|ChangelogDialog/);
	assert.match(about, /v\{info\.version\}/);
});

test("legacy toolbar/icon-button bottom bar classes are gone", () => {
	assert.doesNotMatch(sidebar, /icon-button/);
	assert.doesNotMatch(sidebar, /toolbar-actions/);
	assert.doesNotMatch(sidebar, /sidebar-bottom-primary-actions/);
	assert.doesNotMatch(sidebar, /settings-icon|feedback-icon|homepage-icon/);
});
