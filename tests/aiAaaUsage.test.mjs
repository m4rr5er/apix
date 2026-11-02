/**
 * AI-AAA 今日用量解析（纯函数）契约。
 *
 * 上游是 Sub2API 网关 `GET /v1/usage`：today.actual_cost 是网关按分组倍率
 * 结算后的真实扣费，daily_usage 是每日趋势；解析必须保留这个口径，不能拿
 * token 自己乘价格。
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { loadTsCommonJs } from "./helpers/loadTsCommonJs.mjs";

const { selectAiAaaProvider, aiAaaUsageEndpoint, parseAiAaaUsageResponse } = loadTsCommonJs("src/main/usage/aiAaaUsageParser.ts");

const models = {
	providers: {
		"AI-AAA": { baseUrl: "https://api.aivbv.cn/v1", apiKey: "sk-test", models: [] },
		other: { baseUrl: "https://api.orangecc.cc/v1", apiKey: "sk-other", models: [] },
	},
};

const usageBody = {
	isValid: true,
	balance: 610.69500132,
	unit: "USD",
	planName: "钱包余额",
	usage: {
		today: {
			requests: 221,
			input_tokens: 1_641_632,
			output_tokens: 159_144,
			cache_read_tokens: 35_479_040,
			cache_creation_tokens: 0,
			total_tokens: 37_279_816,
			cost: 8.1727956,
			actual_cost: 16.3455912,
		},
		total: {
			requests: 6895,
			input_tokens: 70_766_691,
			output_tokens: 6_637_112,
			cache_read_tokens: 2_217_794_299,
			cache_creation_tokens: 0,
			total_tokens: 2_295_198_102,
			cost: 423.98322596,
			actual_cost: 847.96645192,
		},
	},
	daily_usage: [
		{ date: "2026-10-27", requests: 221, total_tokens: 34_002_024, cost: 10.14, actual_cost: 20.28 },
		{ date: "2026-10-28", requests: 221, total_tokens: 37_279_816, cost: 8.17, actual_cost: 16.35 },
	],
};

test("按 AI-AAA 名字优先发现供应商，并保留内联 API Key", () => {
	const endpoint = selectAiAaaProvider(models, {});
	assert.deepEqual({ ...endpoint }, { provider: "AI-AAA", baseUrl: "https://api.aivbv.cn/v1", apiKey: "sk-test" });
});

test("供应商改名后仍按 aibvv/aivbv 域名发现，auth.json 的 key 作兜底", () => {
	const renamed = { providers: { custom: { baseUrl: "https://aibvv.cn/v1", models: [] } } };
	const endpoint = selectAiAaaProvider(renamed, { custom: { type: "api_key", key: "sk-auth" } });
	assert.deepEqual({ ...endpoint }, { provider: "custom", baseUrl: "https://aibvv.cn/v1", apiKey: "sk-auth" });
});

test("没有 AI-AAA 或没有 key 时返回 null", () => {
	assert.equal(selectAiAaaProvider({ providers: { other: { baseUrl: "https://api.orangecc.cc/v1", apiKey: "x", models: [] } } }, {}), null);
	assert.equal(selectAiAaaProvider({ providers: { "AI-AAA": { baseUrl: "https://api.aivbv.cn/v1", models: [] } } }, {}), null);
});

test("baseUrl 带 /v1 与不带 /v1 都拼成 /v1/usage", () => {
	assert.equal(aiAaaUsageEndpoint("https://api.aivbv.cn/v1"), "https://api.aivbv.cn/v1/usage");
	assert.equal(aiAaaUsageEndpoint("https://aibvv.cn/"), "https://aibvv.cn/v1/usage");
	assert.equal(aiAaaUsageEndpoint("ftp://example.com"), null);
	assert.equal(aiAaaUsageEndpoint("not a url"), null);
});

test("解析今日真实扣费、token、余额和每日趋势", () => {
	const snapshot = parseAiAaaUsageResponse(usageBody, "AI-AAA", "https://api.aivbv.cn/v1", 1_700_000_000_000);
	assert.ok(snapshot);
	assert.equal(snapshot.today.requests, 221);
	assert.equal(snapshot.today.totalTokens, 37_279_816);
	assert.equal(snapshot.today.cost, 8.1727956);
	assert.equal(snapshot.today.actualCost, 16.3455912);
	assert.equal(snapshot.balance, 610.69500132);
	assert.equal(snapshot.currency, "USD");
	assert.equal(snapshot.planName, "钱包余额");
	assert.equal(snapshot.daily.length, 2);
	assert.equal(snapshot.daily[1].actualCost, 16.35);
});

test("兼容 {data: ...} 包裹；缺 usage.today 时判为结构不匹配", () => {
	const wrapped = parseAiAaaUsageResponse({ data: usageBody }, "AI-AAA", "https://api.aivbv.cn/v1", 1);
	assert.ok(wrapped);
	assert.equal(wrapped.today.actualCost, 16.3455912);
	assert.equal(parseAiAaaUsageResponse({ usage: {} }, "AI-AAA", "https://api.aivbv.cn/v1", 1), null);
	assert.equal(parseAiAaaUsageResponse(null, "AI-AAA", "https://api.aivbv.cn/v1", 1), null);
});

test("actual_cost 缺失时回落到 cost，非法/负数被安全收敛", () => {
	const snapshot = parseAiAaaUsageResponse(
		{
			usage: {
				today: { requests: -3, total_tokens: "invalid", cost: 1.5 },
			},
		},
		"AI-AAA",
		"https://api.aivbv.cn/v1",
		1,
	);
	assert.ok(snapshot);
	assert.equal(snapshot.today.requests, 0);
	assert.equal(snapshot.today.totalTokens, 0);
	assert.equal(snapshot.today.cost, 1.5);
	assert.equal(snapshot.today.actualCost, 1.5);
});
