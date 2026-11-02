import type { PiAuthFile, PiModelsFile } from "../config/ConfigManager";
import { resolvePiApiKey } from "../config/piProviderConfig";
import type { AiAaaUsageDay, AiAaaUsageMetrics, AiAaaUsageSnapshot } from "../../shared/types/aiAaaUsage";

const AI_AAA_DOMAIN_HINTS = ["aibvv.cn", "aivbv.cn"];

export type ResolvedAiAaaEndpoint = {
	provider: string;
	baseUrl: string;
	apiKey: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function toFiniteNumber(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function selectAiAaaProvider(models: PiModelsFile | undefined, auth: PiAuthFile | undefined): ResolvedAiAaaEndpoint | null {
	const entries = Object.entries(models?.providers ?? {});
	const exact = entries.find(([name, config]) => name.trim().toLowerCase() === "ai-aaa" && Boolean(config.baseUrl?.trim()));
	const byDomain = entries.find(([, config]) => AI_AAA_DOMAIN_HINTS.some((hint) => (config.baseUrl ?? "").toLowerCase().includes(hint)));
	const hit = exact ?? byDomain;
	if (!hit) return null;
	const [name, config] = hit;
	const baseUrl = config.baseUrl?.trim();
	const apiKey = resolvePiApiKey(config, auth?.[name]);
	if (!baseUrl || !apiKey) return null;
	return { provider: name, baseUrl, apiKey };
}

export function aiAaaUsageEndpoint(baseUrl: string): string | null {
	let url: URL;
	try {
		url = new URL(baseUrl.trim());
	} catch {
		return null;
	}
	if (url.protocol !== "http:" && url.protocol !== "https:") return null;
	const path = url.pathname.replace(/\/+$/, "");
	url.pathname = /\/v1$/i.test(path) ? `${path}/usage` : `${path}/v1/usage`;
	url.search = "";
	url.hash = "";
	return url.toString();
}

function parseMetrics(raw: unknown): AiAaaUsageMetrics | null {
	if (!isRecord(raw)) return null;
	const requests = toFiniteNumber(raw.requests);
	const inputTokens = toFiniteNumber(raw.input_tokens);
	const outputTokens = toFiniteNumber(raw.output_tokens);
	const cacheReadTokens = toFiniteNumber(raw.cache_read_tokens);
	const cacheCreationTokens = toFiniteNumber(raw.cache_creation_tokens);
	const totalTokens = toFiniteNumber(raw.total_tokens);
	const cost = toFiniteNumber(raw.cost);
	const actualCost = toFiniteNumber(raw.actual_cost) ?? cost;
	if (requests === undefined && totalTokens === undefined && cost === undefined && actualCost === undefined) return null;
	return {
		requests: Math.max(0, requests ?? 0),
		inputTokens: Math.max(0, inputTokens ?? 0),
		outputTokens: Math.max(0, outputTokens ?? 0),
		cacheReadTokens: Math.max(0, cacheReadTokens ?? 0),
		cacheCreationTokens: Math.max(0, cacheCreationTokens ?? 0),
		totalTokens: Math.max(0, totalTokens ?? (inputTokens ?? 0) + (outputTokens ?? 0) + (cacheReadTokens ?? 0) + (cacheCreationTokens ?? 0)),
		cost: Math.max(0, cost ?? 0),
		actualCost: Math.max(0, actualCost ?? 0),
	};
}

function parseDaily(raw: unknown): AiAaaUsageDay[] {
	if (!Array.isArray(raw)) return [];
	const days: AiAaaUsageDay[] = [];
	for (const item of raw) {
		if (!isRecord(item) || typeof item.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(item.date)) continue;
		const metrics = parseMetrics(item);
		if (metrics) days.push({ date: item.date, ...metrics });
	}

	days.sort((a, b) => a.date.localeCompare(b.date));
	return days.slice(-14);
}

export function parseAiAaaUsageResponse(body: unknown, provider: string, baseUrl: string, fetchedAt: number): AiAaaUsageSnapshot | null {
	const root = isRecord(body) ? (isRecord(body.data) ? body.data : body) : null;
	if (!root) return null;
	const usage = isRecord(root.usage) ? root.usage : null;
	if (!usage) return null;
	const today = parseMetrics(usage.today);
	if (!today) return null;
	const total = parseMetrics(usage.total) ?? { requests: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, totalTokens: 0, cost: 0, actualCost: 0 };
	const balance = toFiniteNumber(root.balance);
	const currency = typeof root.unit === "string" && root.unit.trim() ? root.unit.trim().toUpperCase() : "USD";
	const planName = typeof root.planName === "string" && root.planName.trim() ? root.planName.trim() : undefined;
	return {
		provider,
		baseUrl,
		fetchedAt,
		currency,
		...(balance !== undefined && balance >= 0 ? { balance } : {}),
		...(planName ? { planName } : {}),
		today,
		total,
		daily: parseDaily(root.daily_usage),
	};
}
