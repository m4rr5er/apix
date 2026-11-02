import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const ipc = readFileSync("src/shared/ipc.ts", "utf8");
const sessionIpc = readFileSync("src/main/ipc/sessionIpc.ts", "utf8");
const preload = readFileSync("src/preload/index.ts", "utf8");
const injector = readFileSync("src/renderer/src/components/session/SessionRuntimeInjector.tsx", "utf8");

test("catalog message mutation IPC is wired in shared, main and preload", () => {
	assert.match(ipc, /sessionsCatalogEditMessage: "sessions:catalog-edit-message"/);
	assert.match(ipc, /sessionsCatalogDeleteMessage: "sessions:catalog-delete-message"/);
	assert.match(ipc, /sessionsCatalogPrepareResend: "sessions:catalog-prepare-resend"/);
	assert.match(sessionIpc, /ipcChannels\.sessionsCatalogEditMessage/);
	assert.match(sessionIpc, /ipcChannels\.sessionsCatalogDeleteMessage/);
	assert.match(sessionIpc, /ipcChannels\.sessionsCatalogPrepareResend/);
	assert.match(preload, /editCatalogMessage:/);
	assert.match(preload, /deleteCatalogMessage:/);
	assert.match(preload, /prepareCatalogResend:/);
});
