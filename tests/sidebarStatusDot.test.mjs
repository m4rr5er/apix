/**
 * 侧栏会话行状态点（#390）：关闭会话后，状态点连同它的占位一起消失。
 *
 * 现象（用户反馈）：会话运行时标题左侧有一个状态小点，关闭后小点没了，
 * 但「点亮的那格 + gap」还留着——最近会话行因此比没有运行过的会话多出一截左内边距。
 * 根因是活动页只判 `runtime && <span …>`：detached/closed 的 runtime 仍在
 * runtimeBySessionId 里（value 有、色点类 undefined），空 span 照样占位。
 *
 * 这里钉行为：没有色点语义的状态整格不渲染；运行态必须是动态点阵；
 * idle 只有在「后台完成且未读」时才由蓝点提示（未读集合默认空，因此不渲染）。
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { loadTsCommonJs } from "./helpers/loadTsCommonJs.mjs";

const { SidebarStatusDot } = loadTsCommonJs("src/renderer/src/components/sidebar/SidebarStatusDot.tsx");

const render = (status) => renderToStaticMarkup(createElement(SidebarStatusDot, { status }));

test("没有色点语义的状态整格不渲染（不留标题左侧占位）", () => {
	for (const status of [undefined, null, "", "detached", "closed", "unknown-status"]) {
		assert.equal(render(status), "", `status=${String(status)} 不应渲染任何节点`);
	}
});

test("运行/启动态渲染动态点阵（CSS 波浪）而非静态色点", () => {
	for (const status of ["starting", "running"]) {
		const html = render(status);
		assert.match(html, /pideck-dot-wave/, `status=${status} 必须是可播放的 CSS 点阵动画`);
		assert.match(html, /text-warning/);
	}
});

test("错误态保留红色圆点", () => {
	assert.match(render("error"), /bg-danger/);
});

test("idle 没有未读标记时不渲染（进程空闲 ≠ 后台完成未读）", () => {
	assert.equal(render("idle"), "");
});
