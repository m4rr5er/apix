import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { loadTsCommonJs } from "./helpers/loadTsCommonJs.mjs";

const { createDefaultAppSettings } = loadTsCommonJs("src/shared/types/settings.ts");

test("首次安装默认暗色主题，不跟随系统浅色", () => {
	assert.equal(createDefaultAppSettings().theme, "dark");
	const store = readFileSync("src/main/settings/SettingsStore.ts", "utf8");
	assert.match(store, /const defaultSettings: AppSettings = \{[\s\S]*?\btheme: "dark",/);
});
