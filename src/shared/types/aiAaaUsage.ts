export type AiAaaUsageMetrics = {
	requests: number;
	inputTokens: number;
	outputTokens: number;
	cacheReadTokens: number;
	cacheCreationTokens: number;
	totalTokens: number;

	cost: number;

	actualCost: number;
};

export type AiAaaUsageDay = AiAaaUsageMetrics & {
	date: string;
};

export type AiAaaUsageSnapshot = {
	provider: string;

	baseUrl: string;
	fetchedAt: number;

	currency: string;
	balance?: number;
	planName?: string;
	today: AiAaaUsageMetrics;
	total: AiAaaUsageMetrics;

	daily: AiAaaUsageDay[];
};

export type AiAaaUsageErrorCode = "not-configured" | "unauthorized" | "timeout" | "network" | "http" | "invalid-response";

export type AiAaaUsageResult = { ok: true; snapshot: AiAaaUsageSnapshot } | { ok: false; code: AiAaaUsageErrorCode; status?: number };
