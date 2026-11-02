import assert from "node:assert/strict";
import test from "node:test";
import { loadTsCommonJs } from "./helpers/loadTsCommonJs.mjs";

const { parseQoderUsageResponse, selectQoderUsageEndpoint } = loadTsCommonJs("src/main/usage/qoderUsageParser.ts");

function plain(value) {
	return JSON.parse(JSON.stringify(value));
}

test("parseQoderUsageResponse：归一化个人/加油包/企业包配额，不保留响应里的额外字段", () => {
	const snapshot = parseQoderUsageResponse(
		{
			data: {
				userQuota: { total: 1000, used: 125.5, remaining: 874.5, unit: "credits", secret: "must-not-cross" },
				addOnQuota: { total: 200, used: 0, unit: "credits" },
				orgResourcePackage: { cap: 500, used: 50, unit: "credits" },
				expiresAt: 1800000000000,
			},
		},
		"qoder",
		123,
	);
	assert.deepEqual(plain(snapshot), {
		provider: "qoder",
		title: "Qoder AI Plan",
		fetchedAt: 123,
		expiresAt: 1800000000000,
		userQuota: { total: 1000, used: 125.5, remaining: 874.5, unit: "credits" },
		addOnQuota: { total: 200, used: 0, unit: "credits" },
		orgResourcePackage: { total: 500, used: 50, unit: "credits" },
	});
	assert.equal(JSON.stringify(snapshot).includes("secret"), false);
});

test("parseQoderUsageResponse：没有配额桶时判为无效响应", () => {
	assert.equal(parseQoderUsageResponse({ data: { expiresAt: 1 } }, "qoder", 1), null);
	assert.equal(parseQoderUsageResponse(null, "qoder", 1), null);
});

test("selectQoderUsageEndpoint：CN 优先，但缺少 access 时回退 global", () => {
	const cn = selectQoderUsageEndpoint({ "qoder-cn": { access: "cn-token", expires: 999 } });
	assert.equal(cn.provider, "qoder-cn");
	assert.equal(cn.url, "https://openapi.qoder.com.cn/api/v2/quota/usage");
	assert.equal(cn.expires, 999);
	const global = selectQoderUsageEndpoint({ "qoder-cn": {}, qoder: { access: "global-token" } });
	assert.equal(global.provider, "qoder");
	assert.equal(global.url, "https://openapi.qoder.sh/api/v2/quota/usage");
	assert.equal(selectQoderUsageEndpoint({}), null);
});

test("qoderPatFromRefresh：只接受 pat 前缀并取第二段 PAT", () => {
	const { qoderPatFromRefresh } = loadTsCommonJs("src/main/usage/qoderUsageParser.ts");
	assert.equal(qoderPatFromRefresh("pat|pt_abc|refresh|user|machine"), "pt_abc");
	assert.equal(qoderPatFromRefresh("oauth|access|refresh"), undefined);
	assert.equal(qoderPatFromRefresh(undefined), undefined);
});

test("QoderUsageService：过期 access 用 PAT 续期后查询配额，不把 token 写进结果", async () => {
	const { QoderUsageService } = loadTsCommonJs("src/main/usage/QoderUsageService.ts", {
		stubs: {
			"../config/usageProbeTransport": {
				usageProbeRequest: async () => ({ error: "network" }),
			},
		},
	});
	const now = 1_800_000_000_000;
	const calls = [];
	const service = new QoderUsageService({
		now: () => now,
		getAuthConfig: async () => ({
			parsed: {
				qoder: {
					access: "expired-access",
					refresh: "pat|pt_abc|job-refresh|user|machine",
					expires: now - 1,
				},
			},
		}),
		request: async (url, init) => {
			calls.push({ url, init });
			if (url.endsWith("/api/v1/jobToken/exchange")) {
				return { status: 200, raw: JSON.stringify({ token: "fresh-access" }) };
			}
			return { status: 200, raw: JSON.stringify({ data: { userQuota: { used: 12, total: 3000, remaining: 2988, unit: "credits" } } }) };
		},
	});
	const result = await service.get();
	assert.equal(result.ok, true);
	assert.equal(result.snapshot.userQuota.used, 12);
	assert.equal(calls[0].url, "https://openapi.qoder.sh/api/v1/jobToken/exchange");
	assert.equal(calls[0].init.method, "POST");
	assert.equal(calls[1].init.headers.Authorization, "Bearer fresh-access");
	assert.equal(JSON.stringify(result).includes("pt_abc"), false);
});
