/**
 * 用量查询供应商（应用设置 → 用量查询）。
 *
 * 目前只有两个内置入口：
 * - aibvv：AI-AAA / aibvv.cn 网关，凭据来自 models.json 的 provider API Key；
 * - qoder：Qoder Provider 的 OAuth 凭据（auth.json）。
 *
 * 这里只定义「开关」身份，不承载任何供应商业务字段；真正的请求与解析仍在
 * main/usage 的 AiAaaUsageService / QoderUsageService 中，避免设置层和网络层耦合。
 */
export const USAGE_QUERY_PROVIDER_IDS = ["aibvv", "qoder"] as const;

export type UsageQueryProviderId = (typeof USAGE_QUERY_PROVIDER_IDS)[number];

export type UsageQueryProviderStatus = {
	aibvv: boolean;
	qoder: boolean;
};

export function isUsageQueryProviderId(value: unknown): value is UsageQueryProviderId {
	return typeof value === "string" && (USAGE_QUERY_PROVIDER_IDS as readonly string[]).includes(value);
}

/** 设置落盘/草稿归一化：去重、只保留已知 id，避免旧值或脏数据让开关状态漂移。 */
export function normalizeUsageQueryProviders(value: unknown): UsageQueryProviderId[] {
	if (!Array.isArray(value)) return [];
	const seen = new Set<UsageQueryProviderId>();
	for (const candidate of value) {
		if (!isUsageQueryProviderId(candidate)) continue;
		seen.add(candidate);
	}
	return [...seen];
}
