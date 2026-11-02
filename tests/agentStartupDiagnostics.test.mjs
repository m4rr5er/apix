import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const mainSource = readFileSync("src/main/pi/AgentManager.ts", "utf8");
// 信任闸已迁出 AgentManager（Wave 3/4 拆分，见 docs/agent-manager-split-plan.md）：
// 启动诊断文案随实现落在 projectTrustGate.ts，契约测试跟随新性所。
const trustGateSource = readFileSync("src/main/pi/projectTrustGate.ts", "utf8");
const indexSource = readFileSync("src/main/index.ts", "utf8");
const systemIpcSource = readFileSync("src/main/ipc/systemIpc.ts", "utf8");
const sessionIpcSource = readFileSync("src/main/ipc/sessionIpc.ts", "utf8");
const preloadSource = readFileSync("src/preload/index.ts", "utf8");
const ipcSource = readFileSync("src/shared/ipc.ts", "utf8");
const appSource = readFileSync("src/renderer/src/App.tsx", "utf8");
const rendererMainSource = readFileSync("src/renderer/src/main.tsx", "utf8");
// 遮罩撤除实现/时机已收口到独立模块（启动交接：内容就绪再撤，见
// tests/bootOverlayDismissal.test.mjs），main.tsx 只留硬兼底超时。
const bootOverlaySource = readFileSync("src/renderer/src/utils/bootOverlay.ts", "utf8");

test("renderer startup reports bootstrap mount and global errors", () => {
	assert.match(rendererMainSource, /Renderer bootstrap started/);
	assert.match(rendererMainSource, /Renderer React tree mounted/);
	// main.tsx 文案已从 "Renderer startup ..." 收敛为更通用的 runtime 前缀
	assert.match(rendererMainSource, /Renderer uncaught error/);
	assert.match(rendererMainSource, /Renderer React update depth diagnostic/);
	assert.match(rendererMainSource, /Maximum update depth exceeded/);
	assert.match(rendererMainSource, /lastUpdateDepthDiagnosticAt/);
	assert.match(rendererMainSource, /Renderer root element missing/);
	// 良性 ResizeObserver loop 不按 error 上报（否则也进「最近 7 天报错」顶掉真实信号）
	assert.match(rendererMainSource, /isBenignResizeObserverLoop \? "info" : "error"/);
	// issue #376：良性噪音判定与聚合复用 shared 口径（main 侧镜像据此跳过，避免双写）
	assert.match(rendererMainSource, /classifyRendererNoise\(/);
	assert.match(rendererMainSource, /new RendererNoiseAggregator\(\)/);
	assert.match(bootOverlaySource, /export function dismissBootOverlay\(\)/);
	// 挂载帧不得撤遮罩（会露出无会话空态那一帧）；硬兼底必须保留
	assert.doesNotMatch(rendererMainSource, /requestAnimationFrame\(\s*dismissBootOverlay\s*\)/);
	assert.match(rendererMainSource, /window\.setTimeout\(dismissBootOverlay, 1500\)/);
});

test("agent create IPC and process handlers keep structured crash diagnostics", () => {
	assert.match(indexSource, /Agent create IPC failed/);
	assert.match(indexSource, /Child process gone/);
	assert.match(indexSource, /platform: process\.platform/);
	assert.match(mainSource, /attachPiProcessLifecycle/);
	assert.match(mainSource, /buildStartupFailureMessage/);
	assert.match(mainSource, /handlePiEvent failed/);
	// spawn error 必须在 start 前可被业务侧接住，避免 mac 上闪退难排查
	assert.match(mainSource, /监听器必须在 process\.start\(\) 之前挂上/);
});
