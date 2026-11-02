import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { loadTsCommonJs } from "./helpers/loadTsCommonJs.mjs";

const { createDefaultAppSettings } = loadTsCommonJs("src/shared/types/settings.ts");

/** 隔离目录加载设置，避免默认值测试读写真实桌面配置。 */
function makeStore(t) {
	const root = mkdtempSync(join(tmpdir(), "pideck-auto-backend-"));
	const userData = join(root, "userData");
	const home = join(root, "home");
	mkdirSync(userData);
	mkdirSync(home);
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const { SettingsStore } = loadTsCommonJs("src/main/settings/SettingsStore.ts", {
		stubs: {
			electron: {
				app: { getPath: (key) => (key === "userData" ? userData : home) },
				BrowserWindow: class {},
				Menu: { setApplicationMenu: () => undefined },
			},
			"../logging/sharedLogger": { getAppLogger: () => undefined },
			"../git/gitExecutable": { setConfiguredGitPath: () => undefined },
		},
	});
	return { SettingsStore, filePath: join(userData, "settings.json") };
}

test("默认后端初始为自动模式：manual=false，默认值仍是 pi", () => {
	const settings = createDefaultAppSettings();
	assert.equal(settings.defaultAgentBackend, "pi");
	assert.equal(settings.defaultAgentBackendManual, false);
});

test("manual 只接受布尔值：非法入参不写盘（避免自动选择被意外锁死）", async (t) => {
	const { SettingsStore } = makeStore(t);
	const store = new SettingsStore();
	await store.load();
	await store.update({ defaultAgentBackendManual: "yes" });
	assert.equal(store.get().defaultAgentBackendManual, false);
});

test("设置页手选后端会同时置 manual，保住用户的选择", () => {
	const commonTab = readFileSync("src/renderer/src/components/app/settings/CommonTab.tsx", "utf8");
	assert.match(commonTab, /defaultAgentBackend:\s*value as AppSettings\["defaultAgentBackend"\],\s*defaultAgentBackendManual:\s*true/);
});
