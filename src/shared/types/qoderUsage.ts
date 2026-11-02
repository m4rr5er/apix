import type { AiAaaUsageErrorCode } from "./aiAaaUsage";

export type QoderQuotaBucket = {
	total?: number;
	used?: number;
	remaining?: number;
	unit?: string;
};

export type QoderUsageSnapshot = {
	provider: "qoder" | "qoder-cn";

	title: string;
	fetchedAt: number;
	expiresAt?: number;
	userQuota?: QoderQuotaBucket;
	addOnQuota?: QoderQuotaBucket;
	orgResourcePackage?: QoderQuotaBucket;
};

export type QoderUsageResult = { ok: true; snapshot: QoderUsageSnapshot } | { ok: false; code: AiAaaUsageErrorCode; status?: number };
