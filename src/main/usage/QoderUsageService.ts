import type { PiAuthFile } from "../config/ConfigManager";
import type { QoderUsageResult, QoderUsageSnapshot } from "../../shared/types/qoderUsage";
import { usageProbeRequest, type UsageProbeHttpResult, type UsageProbeRequestInit } from "../config/usageProbeTransport";
import { parseQoderUsageResponse, qoderPatFromRefresh, selectQoderUsageEndpoint, type QoderUsageEndpoint } from "./qoderUsageParser";

const CACHE_TTL_MS = 60_000;
const ERROR_CACHE_TTL_MS = 10_000;
const REQUEST_TIMEOUT_MS = 12_000;
const MAX_RESPONSE_BYTES = 512 * 1024;
const QODER_COSY_VERSION = "1.0.1";
const QODER_CLIENT_TYPE = "5";

type CacheEntry = { at: number; result: QoderUsageResult };

export type QoderUsageServiceDeps = {
	getAuthConfig: () => Promise<{ parsed: PiAuthFile | undefined }>;

	request?: (url: string, init: UsageProbeRequestInit) => Promise<UsageProbeHttpResult>;
	now?: () => number;
	logger?: { warn: (message: string, detail?: Record<string, unknown>) => void };
};

export class QoderUsageService {
	private cache: CacheEntry | null = null;
	private inFlight: Promise<QoderUsageResult> | null = null;

	constructor(private readonly deps: QoderUsageServiceDeps) {}

	async get(force = false): Promise<QoderUsageResult> {
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

	private async fetch(now: number): Promise<QoderUsageResult> {
		let auth: PiAuthFile | undefined;
		try {
			auth = (await this.deps.getAuthConfig()).parsed;
		} catch (error) {
			this.deps.logger?.warn("Qoder usage config read failed", { error: error instanceof Error ? error.message : String(error) });
			return { ok: false, code: "not-configured" };
		}
		const endpoint = selectQoderUsageEndpoint(auth);
		if (!endpoint) return { ok: false, code: "not-configured" };

		const request = this.deps.request ?? usageProbeRequest;
		let accessToken = endpoint.accessToken;
		if (endpoint.expires !== undefined && endpoint.expires <= now) {
			const refreshed = await this.refreshAccessToken(endpoint, request);
			if (!refreshed) return { ok: false, code: "unauthorized" };
			accessToken = refreshed;
		}

		let response: UsageProbeHttpResult;
		try {
			response = await this.requestUsage(endpoint, accessToken, request);
		} catch (error) {
			this.deps.logger?.warn("Qoder usage request threw", { provider: endpoint.provider, error: error instanceof Error ? error.message : String(error) });
			return { ok: false, code: "network" };
		}
		if ("error" in response) return { ok: false, code: response.error };
		if (response.status === 401 || response.status === 403) {
			// 缓存里的 access token 可能刚过期：用 PAT 续期一次后重试，避免积分面板一直报未登录。
			const refreshed = await this.refreshAccessToken(endpoint, request);
			if (!refreshed) {
				this.deps.logger?.warn("Qoder usage unauthorized", { provider: endpoint.provider, status: response.status });
				return { ok: false, code: "unauthorized", status: response.status };
			}
			try {
				response = await this.requestUsage(endpoint, refreshed, request);
			} catch (error) {
				this.deps.logger?.warn("Qoder usage retry threw", { provider: endpoint.provider, error: error instanceof Error ? error.message : String(error) });
				return { ok: false, code: "network" };
			}
			if ("error" in response) return { ok: false, code: response.error };
			if (response.status === 401 || response.status === 403) {
				this.deps.logger?.warn("Qoder usage unauthorized after refresh", { provider: endpoint.provider, status: response.status });
				return { ok: false, code: "unauthorized", status: response.status };
			}
		}
		if (response.status < 200 || response.status >= 300) {
			this.deps.logger?.warn("Qoder usage HTTP error", { provider: endpoint.provider, status: response.status });
			return { ok: false, code: "http", status: response.status };
		}
		let body: unknown;
		try {
			body = JSON.parse(response.raw);
		} catch {
			return { ok: false, code: "invalid-response" };
		}
		const snapshot: QoderUsageSnapshot | null = parseQoderUsageResponse(body, endpoint.provider, now);
		if (!snapshot) {
			this.deps.logger?.warn("Qoder usage response shape mismatch", { provider: endpoint.provider });
			return { ok: false, code: "invalid-response" };
		}
		return { ok: true, snapshot };
	}

	private requestUsage(endpoint: QoderUsageEndpoint, accessToken: string, request: (url: string, init: UsageProbeRequestInit) => Promise<UsageProbeHttpResult>): Promise<UsageProbeHttpResult> {
		return request(endpoint.url, {
			method: "GET",
			headers: {
				Authorization: `Bearer ${accessToken}`,
				Accept: "application/json",
				"User-Agent": "pi-provider-qoder",
			},
			timeoutMs: REQUEST_TIMEOUT_MS,
			maxBytes: MAX_RESPONSE_BYTES,
		});
	}

	private async refreshAccessToken(endpoint: QoderUsageEndpoint, request: (url: string, init: UsageProbeRequestInit) => Promise<UsageProbeHttpResult>): Promise<string | null> {
		const pat = qoderPatFromRefresh(endpoint.refreshToken);
		if (!pat) return null;
		let response: UsageProbeHttpResult;
		try {
			response = await request(endpoint.exchangeUrl, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Accept: "application/json",
					"User-Agent": "pi-provider-qoder",
					"Cosy-Version": QODER_COSY_VERSION,
					"Cosy-ClientType": QODER_CLIENT_TYPE,
				},
				body: JSON.stringify({ personal_token: pat }),
				timeoutMs: REQUEST_TIMEOUT_MS,
				maxBytes: MAX_RESPONSE_BYTES,
			});
		} catch (error) {
			this.deps.logger?.warn("Qoder token refresh threw", { provider: endpoint.provider, error: error instanceof Error ? error.message : String(error) });
			return null;
		}
		if ("error" in response || response.status < 200 || response.status >= 300) return null;
		try {
			const body: unknown = JSON.parse(response.raw);
			if (body && typeof body === "object" && "token" in body) {
				const token = (body as { token?: unknown }).token;
				return typeof token === "string" && token.trim() ? token : null;
			}
		} catch {
			return null;
		}
		return null;
	}
}
