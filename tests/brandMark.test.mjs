import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const mark = readFileSync("src/renderer/src/components/app/LogoMark.tsx", "utf8");
const lockup = readFileSync("src/renderer/src/components/app/AppParts.tsx", "utf8");
const canvas = readFileSync("src/renderer/src/components/app/PiLogoCanvas.tsx", "utf8");
const about = readFileSync("src/renderer/src/components/app/AboutPopover.tsx", "utf8");
const shimmer = readFileSync("src/renderer/src/components/motion/text-shimmer.tsx", "utf8");
const app = readFileSync("src/renderer/src/App.tsx", "utf8");
const boot = readFileSync("src/renderer/index.html", "utf8");
const webBrand = readFileSync("src/renderer/src/web/WebBrandLockup.tsx", "utf8");
const webTimeline = readFileSync("src/renderer/src/web/WebTimeline.tsx", "utf8");

const PI_GLYPH = /M165\.29 165\.29H517\.36V400/;

test("in-app brand surfaces use the Pi glyph, not the spider mark", () => {
	assert.match(mark, /export function LogoMark/);
	assert.match(mark, PI_GLYPH);
	assert.doesNotMatch(mark, /brandMarkSrc/);
	// 侧栏品牌位是单独一个白色 APIX 字标 SVG，不再叠加 π logo + 文本。
	assert.match(lockup, /import apixWordmark from "\.\.\/\.\.\/assets\/apix-wordmark\.svg"/);
	assert.match(lockup, /<img src=\{apixWordmark\} alt=\{displayName\}/);
	assert.doesNotMatch(lockup, /<PiLogoCanvas/);
	assert.doesNotMatch(lockup, /<TextShimmer/);
	assert.doesNotMatch(app, /brandLogoReplayToken/);
	assert.doesNotMatch(app, /triggerBrandLogoReplay/);
	// 引擎默认不自播：只有显式 autoPlay 才挂载播放；点击必须 stopPropagation，避免侧栏打开关于弹窗。
	assert.match(canvas, /if \(props\.autoPlay\)/);
	assert.doesNotMatch(canvas, /autoPlay !== false/);
	assert.doesNotMatch(canvas, /replayToken/);
	assert.match(canvas, /event\?\.stopPropagation\(\)/);
	assert.match(about, /<PiLogoCanvas size=\{40\} playOnClick \/>/);
	assert.doesNotMatch(about, /autoPlay/);
	// About 仍保留应用显示名称与动画 logo；侧栏改成纯字标后不再有扫光定时器。
	assert.match(lockup, /const displayName = useAppDisplayName\(\)/);
	assert.match(about, /\{displayName\}\s*<\/div>/);
	assert.doesNotMatch(lockup, /TextShimmer/);
	// 休息态必须卸掉 clip 渐变；只关 animation 仍会留合成层。
	assert.match(shimmer, /enabled \? TEXT_SHIMMER_CLASS_NAME : "text-foreground"/);
	assert.match(shimmer, /enabled \? <style>\{TEXT_SHIMMER_KEYFRAMES\}<\/style> : null/);
	assert.match(shimmer, /enabled \? textShimmerStyle\(duration\) : undefined/);
	assert.match(app, PI_GLYPH);
	// 开屏已改为 APIX 蓝色字标；Pi glyph 只保留在应用内品牌/启动组件中。
	assert.match(boot, /class="boot-logo-apix"/);
	assert.match(boot, /fill: rgb\(0,91,249\)/);
	// Web 品牌位与桌面同构：按 logoStyle 分支（Web 无人写入 → 恒取默认 pi-tui 三色像素标）。
	assert.match(webBrand, /logoStyle === "pi-tui"\s*\?\s*<PiTuiLogoCanvas size=\{18\} playOnClick \/>\s*:\s*<PiLogoCanvas size=\{18\} playOnClick \/>/);
	assert.doesNotMatch(webBrand, /autoPlay/);
	assert.match(webBrand, />\s*APIX\s*</);
	assert.match(webTimeline, /<LogoMark size=\{66\} \/>/);
	for (const source of [mark, lockup, app, boot, webBrand, webTimeline]) {
		assert.doesNotMatch(source, /M7\.5 15\.5C3\.5 14/);
		assert.doesNotMatch(source, /<ellipse cx="60" cy="50"/);
	}
});
