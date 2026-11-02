import type { PiAuthFile, PiModelsFile } from "../config/ConfigManager";
import type { AiAaaUsageResult } from "../../shared/types/aiAaaUsage";
import { usageProbeRequest, type UsageProbeHttpResult, type UsageProbeRequestInit } from "../config/usageProbeTransport";
import { aiAaaUsageEndpoint, parseAiAaaUsageResponse, selectAiAaaProvider } from "./aiAaaUsageParser";

const CACHE_TTL_MS = 60_000;
const ERROR_CACHE_TTL_MS = 10_000;
const REQUEST_TIMEOUT_MS = 12_000;
const MAX_RESPONSE_BYTES = 1_048_576;

export type AiAaaUsageServiceDeps = {
	getModelsConfig: () => Promise<{ parsed: PiModelsFile | undefined }>;
	getAuthConfig: () => Promise<{ parsed: PiAuthFile | undefined }>;

	request?: (url: string, init: UsageProbeRequestInit) => Promise<UsageProbeHttpResult>;
	now?: () => number;
	logger?: { warn: (message: string, detail?: Record<string, unknown>) => void };
};

type CacheEntry = { at: number; result: AiAaaUsageResult };

export class AiAaaUsageService {
	private cache: CacheEntry | null = null;
	private inFlight: Promise<AiAaaUsageResult> | null = null;

	constructor(private readonly deps: AiAaaUsageServiceDeps) {}

	async get(force = false): Promise<AiAaaUsageResult> {
		const now = this.deps.now?.() ?? Date.now();
		if (!force && this.cache) {
			const ttl = this.cache.result.ok ? CACHE_TTL_MS : ERROR_CACHE_TTL_MS;
			if (now - this.cache.at < ttl) return this.cache.result;
		}
		if (this.inFlight) return this.inFlight;
		const task = this.fetch(now).then((result) => {
			this.cache = { at: now, result };
			return result;
		});
		this.inFlight = task;
		try {
			return await task;
		} finally {
			if (this.inFlight === task) this.inFlight = null;
		}
	}

	private async fetch(now: number): Promise<AiAaaUsageResult> {
		let models: PiModelsFile | undefined;
		let auth: PiAuthFile | undefined;
		try {
			const [modelsResult, authResult] = await Promise.all([this.deps.getModelsConfig(), this.deps.getAuthConfig()]);
			models = modelsResult.parsed;
			auth = authResult.parsed;
		} catch (error) {
			this.deps.logger?.warn("AI-AAA usage config read failed", { error: error instanceof Error ? error.message : String(error) });
			return { ok: false, code: "not-configured" };
		}

		const endpoint = selectAiAaaProvider(models, auth);
		if (!endpoint) return { ok: false, code: "not-configured" };
		const url = aiAaaUsageEndpoint(endpoint.baseUrl);
		if (!url) return { ok: false, code: "not-configured" };

		const request = this.deps.request ?? usageProbeRequest;
		let response: UsageProbeHttpResult;
		try {
			response = await request(url, {
				method: "GET",
				headers: {
					Authorization: `Bearer ${endpoint.apiKey}`,
					Accept: "application/json",
				},
				timeoutMs: REQUEST_TIMEOUT_MS,
				maxBytes: MAX_RESPONSE_BYTES,
			});
		} catch (error) {
			this.deps.logger?.warn("AI-AAA usage request threw", { provider: endpoint.provider, error: error instanceof Error ? error.message : String(error) });
			return { ok: false, code: "network" };
		}

		if ("error" in response) {
			return { ok: false, code: response.error };
		}
		if (response.status === 401 || response.status === 403) {
			this.deps.logger?.warn("AI-AAA usage unauthorized", { provider: endpoint.provider, status: response.status });
			return { ok: false, code: "unauthorized", status: response.status };
		}
		if (response.status < 200 || response.status >= 300) {
			this.deps.logger?.warn("AI-AAA usage HTTP error", { provider: endpoint.provider, status: response.status });
			return { ok: false, code: "http", status: response.status };
		}

		let body: unknown;
		try {
			body = JSON.parse(response.raw);
		} catch {
			this.deps.logger?.warn("AI-AAA usage response is not JSON", { provider: endpoint.provider });
			return { ok: false, code: "invalid-response" };
		}
		const snapshot = parseAiAaaUsageResponse(body, endpoint.provider, endpoint.baseUrl, now);
		if (!snapshot) {
			this.deps.logger?.warn("AI-AAA usage response shape mismatch", { provider: endpoint.provider });
			return { ok: false, code: "invalid-response" };
		}
		return { ok: true, snapshot };
	}
}
