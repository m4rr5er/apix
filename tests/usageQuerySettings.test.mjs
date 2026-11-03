import assert from "node:assert/strict";
import test from "node:test";
import { loadTsCommonJs } from "./helpers/loadTsCommonJs.mjs";

const { normalizeUsageQueryProviders } = loadTsCommonJs("src/shared/types/usageQuery.ts");
const { resolveUsageQueryProviderStatus } = loadTsCommonJs("src/main/usage/usageQueryStatus.ts");
const { SETTINGS_TAB_IDS } = loadTsCommonJs("src/renderer/src/components/app/settings/settingsTabLayout.ts");

function plain(value) {
	return JSON.parse(JSON.stringify(value));
}

test("normalizeUsageQueryProviders: 只保留两个已知供应商并去重", () => {
	assert.deepEqual(plain(normalizeUsageQueryProviders(["qoder", "aibvv", "qoder", "unknown", 42])), ["qoder", "aibvv"]);
	assert.deepEqual(plain(normalizeUsageQueryProviders(undefined)), []);
	assert.deepEqual(plain(normalizeUsageQueryProviders("aibvv")), []);
});

test("用量查询设置页位于常用设置之后（系统设置导航）", () => {
	const common = SETTINGS_TAB_IDS.indexOf("common");
	const usageQuery = SETTINGS_TAB_IDS.indexOf("usageQuery");
	assert.ok(common >= 0);
	assert.equal(usageQuery, common + 1);
});

test("供应商状态：aibvv 需要 models+key，qoder 需要 auth 凭据", async () => {
	const empty = await resolveUsageQueryProviderStatus({
		getModelsConfig: async () => ({ parsed: { providers: {} } }),
		getAuthConfig: async () => ({ parsed: {} }),
	});
	assert.deepEqual(plain(empty), { aibvv: false, qoder: false });

	const ready = await resolveUsageQueryProviderStatus({
		getModelsConfig: async () => ({
			parsed: {
				providers: {
					"AI-AAA": { baseUrl: "https://api.aibvv.cn/v1", apiKey: "sk-test", models: [] },
				},
			},
		}),
		getAuthConfig: async () => ({ parsed: { qoder: { type: "oauth", access: "qoder-access", refresh: "pat|pat-token" } } }),
	});
	assert.deepEqual(plain(ready), { aibvv: true, qoder: true });
});

test("状态探测失败时 fail-closed 为未配置，不把设置页开关放出来", async () => {
	const result = await resolveUsageQueryProviderStatus({
		getModelsConfig: async () => {
			throw new Error("disk error");
		},
		getAuthConfig: async () => ({ parsed: {} }),
	});
	assert.deepEqual(plain(result), { aibvv: false, qoder: false });
});
