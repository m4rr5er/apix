import assert from "node:assert/strict";
import test from "node:test";
import { loadTsCommonJs } from "./helpers/loadTsCommonJs.mjs";

// 加载真实 TS 依赖图（installer 经动态 import 复用 providerMigrationService 的写盘策略）
const installer = loadTsCommonJs("src/main/config/tokendanceInstaller.ts");

/** 目录 store 替身：getModels/refresh 返回固定目录（免真实网络）；refresh 默认成功。 */
function makeCatalog(models = [{ id: "glm-4.7" }, { id: "deepseek-v4-flash", contextWindow: 128000 }]) {
	let refreshCount = 0;
	return {
		getModels: async () => ({ models, fromCache: false, at: 1700000000000 }),
		refresh: async () => {
			refreshCount += 1;
			return { models, fromCache: false, at: 1700000000000 };
		},
		_refreshCount: () => refreshCount,
	};
}

/** 按 id 取模型行：保存列表已按名称排序，断言不再依赖入参顺序。 */
function byId(models, id) {
	const found = models.find((model) => model.id === id);
	assert.ok(found, `model ${id} missing from ${JSON.stringify(models.map((m) => m.id))}`);
	return found;
}

/** ConfigManager 替身：内存版 models.json（save 后可从 _dump 读回断言）。 */
function makeConfigManager(initialProviders = {}) {
	let providers = { ...initialProviders };
	return {
		getModelsConfig: async () => ({ parsed: { providers } }),
		getAuthConfig: async () => ({ parsed: {} }),
		saveModelsConfig: async (next) => {
			providers = { ...(next?.providers ?? {}) };
			return { valid: true };
		},
		_dump: () => providers,
	};
}

/** Pi host 替身：ready 时走官方 settings API（记录调用），否则磁盘直写（读临时目录文件）。 */
function makePiost({ ready = true, home = undefined } = {}) {
	const calls = { updateSettings: [], setCredential: [] };
	return {
		isHostReady: () => ready,
		getHomeDir: () => home ?? "/tmp/pi-home",
		describeSettings: async () => ({
			namespaces: [{ ns: "llm-pi-ai", value: { providers: {} }, revision: 1 }],
		}),
		updateSettings: async (ns, patch, revision) => {
			calls.updateSettings.push({ ns, patch, revision });
		},
		setCredential: async (ref, value) => {
			calls.setCredential.push({ ref, value });
		},
		readCredentialValue: async () => undefined,
		_calls: calls,
	};
}
