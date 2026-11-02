import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const coordinator = readFileSync("src/main/sessions/SessionRuntimeCoordinator.ts", "utf8");
const main = readFileSync("src/main/index.ts", "utf8");
const agentManager = readFileSync("src/main/pi/AgentManager.ts", "utf8");
// 扩展 UI 请求闸已迁入 extensionUiGate.ts（AgentManager 拆分 Wave 4B）
const uiGate = readFileSync("src/main/pi/extensionUiGate.ts", "utf8");
const sessionIpc = readFileSync("src/main/ipc/sessionIpc.ts", "utf8");
const app = readFileSync("src/renderer/src/App.tsx", "utf8");
const runtimeInjector = readFileSync("src/renderer/src/components/session/SessionRuntimeInjector.tsx", "utf8");
const runtimeUi = readFileSync("src/renderer/src/components/overlays/SessionRuntimeUiOverlay.tsx", "utf8");
const composer = readFileSync("src/renderer/src/components/session/ComposerArea.tsx", "utf8");
const timeline = readFileSync("src/renderer/src/components/session/SessionMessageTimeline.tsx", "utf8");
const toolCards = readFileSync("src/renderer/src/components/session/ToolCallComponents.tsx", "utf8");

test("catalog scans attach matching existing runtimes in the main process", () => {
	assert.match(coordinator, /attachCatalogRuntimes\(/);
	assert.match(main, /attachCatalogRuntimes\(records\)/);
	assert.match(sessionIpc, /sessionsCatalogList[\s\S]*mergeScanned[\s\S]*attachCatalogRuntimes/);
});

test("sessions:send-prompt is registered in main and forwards to the runtime coordinator", () => {
	// preload invokes ipcChannels.sessionsSendPrompt；主进程漏注册时 renderer 只拿到
	// 「No handler registered」，消息发不出、上下文占用也不会出现。
	assert.match(sessionIpc, /ipcMain\.handle\(ipcChannels\.sessionsSendPrompt[\s\S]*?sessionRuntimeCoordinator\.send\(/);
	assert.match(sessionIpc, /emitSessionRuntimeEvent\(tab\.id, ipcChannels\.agentsState, tab\)/);
});

test("session runtime IPC surface is complete for browser/preload calls", () => {
	for (const channel of ["sessionsRuntimeList", "sessionsRuntimeActivate", "sessionsSetFocusedSession", "sessionsUiResponse", "sessionsCatalogCopy", "sessionsCatalogEditMessage", "sessionsCatalogDeleteMessage", "sessionsCatalogPrepareResend"]) {
		assert.ok(sessionIpc.includes(`ipcMain.handle(ipcChannels.${channel}`), `missing ${channel}`);
	}
});

test("historical sessions warm the runtime so context metrics are available on open", () => {
	const composer = readFileSync("src/renderer/src/components/session/ComposerArea.tsx", "utf8");
	assert.match(composer, /const hasHistory = \(props\.turnCount \?\? 0\) > 0/);
	assert.match(composer, /!hasHistory && !composer\.draft\.trim\(\)/);
});

test("unbound interactive UI is cancelled and cannot be surfaced as Session UI", () => {
	assert.match(main, /cancelUnboundUiRequest/);
	assert.match(main, /"batch_ask"/);
	assert.match(main, /sendUIResponse\([^,]+,[^,]+, \{ cancelled: true \}\)/);
	assert.doesNotMatch(app, /bindSessionRuntimeAtom|bindSessionRuntime\(/);
	assert.doesNotMatch(app, /api\.agents\.onUiRequest\(/);
});

test("Ask Question keeps normalized batch requests pending for the session responder", () => {
	assert.match(coordinator, /method === "batch_ask"/);
	assert.match(uiGate, /hasCustomOption/);
	assert.match(uiGate, /option\.startsWith\("✎"\)/);
	assert.match(uiGate, /allowOther: typed\.allowOther === true \|\| hasCustomOption/);
	assert.match(agentManager, /questions: batchQuestions/);
	assert.match(agentManager, /uiGate\.handleUIRequest\(agentId, typed\)/);
});

test("session UI requests remain generation-bound and render in the timeline footer", () => {
	assert.match(runtimeInjector, /createSessionRuntimeUiResponder\(/);
	assert.match(runtimeInjector, /sessionId: currentSessionId/);
	assert.match(runtimeInjector, /runtimeGeneration: latest\.runtimeGeneration/);
	assert.match(runtimeInjector, /<SessionRuntimeUiOverlay/);
	assert.match(runtimeUi, /ask-inline-bar(?:\s+ask-inline-bar--active)?/); // Ask 继续使用稳定的布局锚点类
	assert.match(runtimeUi, /ApprovalCard/);
	assert.doesNotMatch(runtimeUi, /className="modal-backdrop ask-dialog-backdrop"/);
	assert.doesNotMatch(composer, /runtimeUi/);
	assert.match(timeline, /className="session-runtime-ui mx-auto w-full/);
	assert.doesNotMatch(timeline, /session-runtime-ui sticky bottom-0/);
	assert.match(toolCards, /ask-question-card-result-list/);
	assert.match(toolCards, /askCard\.questions/);
});

test("Web wiring is Session-first and exposes no Agent compatibility creation", () => {
	assert.match(main, /createSessionDraft: async \(input\)[\s\S]*sessionCatalog\.createDraft/);
	assert.match(main, /sendSessionPrompt: async \(input\)[\s\S]*sessionRuntimeCoordinator\.send\(input\)/);
	// stopSessionRuntime is now a shared helper called from both IPC and the web deps.
	assert.match(main, /async function stopSessionRuntime\(target[^)]*\)[\s\S]*sessionRuntimeCoordinator\.stopRuntime\(target\)/);
	assert.doesNotMatch(main, /createAgent:/);
	assert.doesNotMatch(main, /LEGACY_EXTERNAL_RUNTIME|ipcChannels\.agentsCreate/);
});

test("replacement restore is gated by full origin identity in main", () => {
	assert.match(main, /const originKey = originEntry\?\.filePath[\s\S]*buildSessionOriginKey/);
	assert.match(main, /canRestoreOrigin: \(\) => \{[\s\S]*?buildSessionOriginKey[\s\S]*?originKey/);
	assert.match(coordinator, /failClosedRuntimeReplacement/);
	assert.match(coordinator, /replacementBySession/);
});
