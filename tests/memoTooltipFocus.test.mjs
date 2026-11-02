import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("备忘录 Tooltip 受 hover/focus-visible 控制，关闭弹窗不因焦点回归残留", () => {
	const source = readFileSync("src/renderer/src/components/sidebar/MemoEditor.tsx", "utf8");
	assert.match(source, /const \[tooltipOpen, setTooltipOpen\] = useState\(false\)/);
	assert.match(source, /open=\{tooltipOpen\}/);
	assert.match(source, /pointerInsideRef\.current/);
	assert.doesNotMatch(source, /keyboardFocusRef/);
	assert.match(source, /onPointerLeave[\s\S]*?pointerInsideRef\.current = false;[\s\S]*?setTooltipOpen\(false\)/);
});
