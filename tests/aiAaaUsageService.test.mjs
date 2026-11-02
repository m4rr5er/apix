/**
 * AI-AAA 用量服务：供应商发现、请求、错误归因与缓存。
 * 网络层全部注入，不依赖真实网关或 Electron。
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { loadTsCommonJs } from "./helpers/loadTsCommonJs.mjs";

const { AiAaaUsageService } = loadTsCommonJs("src/main/usage/AiAaaUsageService.ts");

const body = {
	isValid: true,
	balance: 610.69,
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
			cost: 8.17,
			actual_cost: 16.35,
		},
		total: {},
	},
	daily_usage: [{ date: "2026-10-28", requests: 221, total_tokens: 37_279_816, cost: 8.17, actual_cost: 16.35 }],
};

const models = {
	providers: {
		"AI-AAA": { baseUrl: "https://api.aivbv.cn/v1", apiKey: "sk-test", models: [] },
	},
};

function makeService(request) {
	let now = 1_000;
	let calls = 0;
	const service = new AiAaaUsageService({
		getModelsConfig: async () => ({ parsed: models }),
		getAuthConfig: async () => ({ parsed: {} }),
		request: async (...args) => {
			calls += 1;
			return request(...args);
		},
		now: () => now,
	});
	return {
		service,
		calls: () => calls,
		advance: (ms) => {
			now += ms;
		},
	};
}

test("成功查询返回今日 actual_cost、token 与余额", async () => {
	const { service, calls } = makeService(async () => ({ status: 200, raw: JSON.stringify(body) }));
	const result = await service.get(true);
	assert.equal(result.ok, true);
	assert.equal(result.snapshot.today.actualCost, 16.35);
	assert.equal(result.snapshot.today.totalTokens, 37_279_816);
	assert.equal(result.snapshot.balance, 610.69);
	assert.equal(calls(), 1);
});

test("60 秒内复用缓存，force 绕过缓存", async () => {
	const { service, calls, advance } = makeService(async () => ({ status: 200, raw: JSON.stringify(body) }));
	await service.get();
	advance(30_000);
	await service.get();
	assert.equal(calls(), 1, "30s 内应命中缓存");
	advance(31_000);
	await service.get();
	assert.equal(calls(), 2, "超过 60s 应重新请求");
	await service.get(true);
	assert.equal(calls(), 3, "force 必须绕过缓存");
});

test("HTTP 401 归因为 unauthorized；网络错误归因为 network", async () => {
	const unauthorized = makeService(async () => ({ status: 401, raw: "" }));
	assert.deepEqual({ ...(await unauthorized.service.get(true)) }, { ok: false, code: "unauthorized", status: 401 });

	const network = makeService(async () => ({ error: "network" }));
	assert.deepEqual({ ...(await network.service.get(true)) }, { ok: false, code: "network" });
});

test("没有 AI-AAA 配置或缺 key 时返回 not-configured，且不发请求", async () => {
	let calls = 0;
	const service = new AiAaaUsageService({
		getModelsConfig: async () => ({ parsed: { providers: {} } }),
		getAuthConfig: async () => ({ parsed: {} }),
		request: async () => {
			calls += 1;
			return { status: 200, raw: "{}" };
		},
	});
	assert.deepEqual({ ...(await service.get(true)) }, { ok: false, code: "not-configured" });
	assert.equal(calls, 0);
});

test("结构不匹配归因为 invalid-response", async () => {
	const { service } = makeService(async () => ({ status: 200, raw: JSON.stringify({ ok: true }) }));
	assert.deepEqual({ ...(await service.get(true)) }, { ok: false, code: "invalid-response" });
});
