import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadTsCommonJs } from "./helpers/loadTsCommonJs.mjs";

const { parseQoderModels, qoderModelsFromCatalog, hasQoderProviderAuth, getQoderProviderStatus } = loadTsCommonJs("src/main/config/qoderProviderSetup.ts");

function plain(value) {
	return JSON.parse(JSON.stringify(value));
}

test("parseQoderModels：只取 Qoder provider 行并解析能力列", () => {
	const output = ["provider  model                     context  max-out  thinking  images", "AI-AAA    deepseek-v4.1-flash-1017  1.0M     384K     yes       yes", "qoder     Auto                      1M       128K     yes       yes", "qoder-cn  Qwen3.7-Plus              1M       128K     no        yes"].join("\n");
	assert.deepEqual(plain(parseQoderModels(output)), [
		{ provider: "qoder", id: "Auto", contextWindow: 1_000_000, maxTokens: 128_000, reasoning: true, images: true },
		{ provider: "qoder-cn", id: "Qwen3.7-Plus", contextWindow: 1_000_000, maxTokens: 128_000, reasoning: false, images: true },
	]);
});

test("parseQoderModels：无 Qoder 行或 ANSI 颜色时保持稳定", () => {
	assert.deepEqual(plain(parseQoderModels("\u001b[32mqoder Auto 1M 128K yes yes\u001b[0m")), [{ provider: "qoder", id: "Auto", contextWindow: 1_000_000, maxTokens: 128_000, reasoning: true, images: true }]);
	assert.deepEqual(plain(parseQoderModels("provider model\nAI-AAA model 1M")), []);
});

test("qoderModelsFromCatalog：从 capability 快照提取 Qoder 模型，保留能力字段", () => {
	const models = qoderModelsFromCatalog([
		{ provider: "qoder", id: "Ultimate", name: "Ultimate", contextWindow: 1_000_000, maxTokens: 131_100, reasoning: true, images: true },
		{ provider: "AI-AAA", id: "deepseek", contextWindow: 1_000_000 },
	]);
	assert.deepEqual(plain(models), [{ provider: "qoder", id: "Ultimate", contextWindow: 1_000_000, maxTokens: 131_100, reasoning: true, images: true }]);
});

test("hasQoderProviderAuth：只认 auth.json 里的 qoder 键，损坏文件按未配置", () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "apix-qoder-auth-"));
	try {
		fs.writeFileSync(path.join(dir, "auth.json"), JSON.stringify({ qoder: { type: "oauth" } }));
		assert.equal(hasQoderProviderAuth(dir), true);
		fs.writeFileSync(path.join(dir, "auth.json"), JSON.stringify({ "qoder-cn": { type: "oauth" } }));
		assert.equal(hasQoderProviderAuth(dir), true);
		fs.writeFileSync(path.join(dir, "auth.json"), JSON.stringify({ openai: { type: "api_key" } }));
		assert.equal(hasQoderProviderAuth(dir), false);
		fs.writeFileSync(path.join(dir, "auth.json"), "{not-json");
		assert.equal(hasQoderProviderAuth(dir), false);
		// 多账号池里存在 Qoder 账号也算已配置（扩展支持 multiprovider-auth.json）。
		fs.writeFileSync(path.join(dir, "auth.json"), JSON.stringify({ openai: { type: "api_key" } }));
		fs.writeFileSync(path.join(dir, "multiprovider-auth.json"), JSON.stringify({ providers: { qoder: { accounts: [{ credential: { access: "x" } }] } } }));
		assert.equal(hasQoderProviderAuth(dir), true);
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
	}
});

test("getQoderProviderStatus：只返回配置状态与模型，不回传任何 auth 字段", async () => {
	const status = await getQoderProviderStatus({
		readAuth: async () => ({ parsed: { qoder: { type: "oauth", access: "secret-token", refresh: "secret-refresh" } } }),
		models: () => [{ provider: "qoder", id: "Ultimate" }],
	});
	assert.equal(status.configured, true);
	assert.equal(status.region, "global");
	assert.deepEqual(plain(status.models), [{ provider: "qoder", id: "Ultimate" }]);
	assert.equal(JSON.stringify(status).includes("secret"), false);
});

test("登录后的模型快照接线：Qoder 模型会被发布，空 capability 快照不再挡住 CLI 缓存", () => {
	const indexSource = fs.readFileSync("src/main/index.ts", "utf8");
	assert.match(indexSource, /afterLogin: async \(models\) =>/);
	assert.match(indexSource, /piModelCapabilityCache\?\.publishModels\(/);
	assert.match(indexSource, /qoderModelsFromCatalog\(snapshot\?\.models\)\.length > 0/);

	const systemIpc = fs.readFileSync("src/main/ipc/systemIpc.ts", "utf8");
	assert.match(systemIpc, /snapshot && snapshot\.models\.length > 0 \? snapshot\.models : await fetchModelList/);
});
