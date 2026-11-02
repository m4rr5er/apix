import type { PiAuthFile, PiAuthItem } from "../config/ConfigManager";
import type { QoderQuotaBucket, QoderUsageSnapshot } from "../../shared/types/qoderUsage";

export type QoderUsageProvider = QoderUsageSnapshot["provider"];

export type QoderUsageEndpoint = {
	provider: QoderUsageProvider;
	title: string;
	url: string;
	accessToken: string;
	refreshToken?: string;
	exchangeUrl: string;

	expires?: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function quotaNumber(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function normalizeBucket(value: unknown, totalKey: "total" | "cap" = "total"): QoderQuotaBucket | undefined {
	const raw = isRecord(value) ? value : null;
	if (!raw) return undefined;
	const total = quotaNumber(raw[totalKey]);
	const used = quotaNumber(raw.used);
	const remaining = quotaNumber(raw.remaining);
	if (total === undefined && used === undefined && remaining === undefined) return undefined;
	const unit = typeof raw.unit === "string" && raw.unit.trim() ? raw.unit.trim() : undefined;
	return {
		...(total !== undefined ? { total } : {}),
		...(used !== undefined ? { used } : {}),
		...(remaining !== undefined ? { remaining } : {}),
		...(unit ? { unit } : {}),
	};
}

export function parseQoderUsageResponse(body: unknown, provider: QoderUsageProvider, fetchedAt: number): QoderUsageSnapshot | null {
	const root = isRecord(body) && isRecord(body.data) ? body.data : isRecord(body) ? body : null;
	if (!root) return null;
	const userQuota = normalizeBucket(root.userQuota);
	const addOnQuota = normalizeBucket(root.addOnQuota);
	const orgRaw = isRecord(root.orgResourcePackage) ? root.orgResourcePackage : undefined;
	const orgResourcePackage = normalizeBucket(orgRaw, orgRaw && "cap" in orgRaw ? "cap" : "total");
	if (!userQuota && !addOnQuota && !orgResourcePackage) return null;
	const expires = quotaNumber(root.expiresAt);
	const expiresAt = expires !== undefined && expires <= 864e13 ? expires : undefined;
	return {
		provider,
		title: provider === "qoder-cn" ? "Qoder CN Plan" : "Qoder AI Plan",
		fetchedAt,
		...(expiresAt !== undefined ? { expiresAt } : {}),
		...(userQuota ? { userQuota } : {}),
		...(addOnQuota ? { addOnQuota } : {}),
		...(orgResourcePackage ? { orgResourcePackage } : {}),
	};
}

function authAccessToken(item: PiAuthItem | undefined): string | undefined {
	const access = item?.access;
	return typeof access === "string" && access.trim() ? access.trim() : undefined;
}

function authExpires(item: PiAuthItem | undefined): number | undefined {
	return typeof item?.expires === "number" && Number.isFinite(item.expires) ? item.expires : undefined;
}

export function selectQoderUsageEndpoint(auth: PiAuthFile | undefined): QoderUsageEndpoint | null {
	const candidates = [
		{ provider: "qoder-cn" as const, item: auth?.["qoder-cn"] },
		{ provider: "qoder" as const, item: auth?.qoder },
	];
	const hit = candidates.find((candidate) => Boolean(authAccessToken(candidate.item)));
	if (!hit) return null;
	const accessToken = authAccessToken(hit.item);
	if (!accessToken) return null;
	const provider: QoderUsageProvider = hit.provider;
	return {
		provider,
		title: provider === "qoder-cn" ? "Qoder CN Plan" : "Qoder AI Plan",
		url: provider === "qoder-cn" ? "https://openapi.qoder.com.cn/api/v2/quota/usage" : "https://openapi.qoder.sh/api/v2/quota/usage",
		accessToken,
		...(typeof hit.item?.refresh === "string" && hit.item.refresh ? { refreshToken: hit.item.refresh } : {}),
		exchangeUrl: provider === "qoder-cn" ? "https://openapi.qoder.com.cn/api/v1/jobToken/exchange" : "https://openapi.qoder.sh/api/v1/jobToken/exchange",
		...(authExpires(hit.item) !== undefined ? { expires: authExpires(hit.item) } : {}),
	};
}

/** Qoder 的 refresh 字段对 PAT 登录形如 `pat|<PAT>|<jobRefresh>|<user>|<machine>`；只取 PAT 做续期。 */
export function qoderPatFromRefresh(refresh: string | undefined): string | undefined {
	if (!refresh?.startsWith("pat|")) return undefined;
	const pat = refresh.split("|")[1]?.trim();
	return pat || undefined;
}
