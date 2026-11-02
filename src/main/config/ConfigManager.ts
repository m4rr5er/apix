import { readFile, writeFile, mkdir, rename, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { normalize, join, dirname } from "node:path";
import { dirname as posixDirname, normalize as posixNormalize } from "node:path/posix";
import { homedir } from "node:os";
import { net, session } from "electron";
import type { Session } from "electron";
import type { ConfigFileDiagnostic, ConfigFileReadResult } from "../../shared/types";
import type { McpConfigFile, McpConfigSnapshot, McpProbeResult, McpServerDefinition } from "../../shared/types/mcp";
import { loadMcpConfigSnapshot, mcpDocsUrl, probeMcpServer, saveMcpConfigFile, validateMcpConfigFile } from "./mcpConfig";
import { ensureOpenAiVersionPath, needsSessionBaseUrlVersionHint, suggestNormalizedBaseUrl } from "./baseUrlPath";
import type { WslEnvironment } from "../wsl/WslPaths";
import { mainProcessT, type MainProcessTranslationKey } from "../../shared/i18n/mainProcessCopy";
import type { FetchedModel } from "../../shared/types/fetchedModel";
import type { ProviderUsageResult, UsageProbeBackend, UsageProbeProviderConfig, UsageProbeRecognition, UsageProbeSettingsResult, UsageProbeProviderState, UsageProbeStatesResult, UsageProbeTestInput } from "../../shared/types/providerUsage";
import { parseProviderModelsResponse } from "./parseProviderModels";
import { isSafeProviderName, piBuiltinSnapshotFromCatalog, resolvePiApiKey } from "./piProviderConfig";
import { stripBom, writePiConfigFile } from "./piConfigFileStore";
import { mergeSettingsFormPayload } from "./settingsFormPayload";
import { ensureTokendanceAttribution } from "./tokendanceAttribution";
import { getAppLogger } from "../logging/sharedLogger";
import { buildProbeFailureDetail, buildProbeHeaders, candidateApplies, getByPath, parseUsageResponseBody, USAGE_PROBE_CANDIDATES, usageProbeUrls } from "./providerUsageProbe";
import { fetchSub2ApiPanelBalanceWithRefresh, type Sub2ApiPanelTokens } from "./sub2apiPanelSession";
import type { UsageProbeAttempt, UsageProbeCandidate } from "./providerUsageProbe";
import { resolveProviderUsageEndpoint } from "./providerUsageResolver";
import { buildDeclarativeUsageProbeTemplate, isDeclarativeTemplateId, USAGE_PROBE_CATEGORY_BY_TEMPLATE_ID } from "./usageProbeTemplates";
import { loadUsageProbeProviderConfigs, loadUsageProbeSettings, loadUserUsageProbes, loadUserUsageProbesDetailed, updateUsageProbeSub2ApiTokens } from "./userUsageProbes";
import type { UserUsageProbe, UsageProbeSettingsLoadResult } from "./userUsageProbes";
import { usageProbeRequest } from "./usageProbeTransport";
import { getPiAiCatalogIndex } from "../pi/piAiBuiltinCatalog";
import type { ConfigProxyTarget } from "../sessions/sessionProxyPolicy";

const PI_AGENT_DIR = join(homedir(), ".pi", "agent");

const PROVIDER_TEST_TIMEOUT_MS = 45_000;

type Sub2ApiPanelContext = {
	provider: string;
	configDir: string;
	refreshToken?: string;
	persist: boolean;
};

let modelListProxySession: Session | null = null;
async function getModelListProxySession(): Promise<Session> {
	if (!modelListProxySession) {
		modelListProxySession = session.fromPartition("pideck-config-proxy", { cache: false });
	}
	return modelListProxySession;
}

async function modelListFetch(url: string, init: { method?: string; headers?: Record<string, string>; signal: AbortSignal }, proxyTarget?: ConfigProxyTarget): Promise<Response | null> {
	if (proxyTarget?.mode !== "on" && proxyTarget?.mode !== "off") {
		return null;
	}
	const proxySession = await getModelListProxySession();
	const proxyMode =
		proxyTarget.mode === "on"
			? {
					mode: "fixed_servers" as const,
					proxyRules: proxyTarget.url,
					proxyBypassRules: proxyTarget.bypass,
				}
			: { mode: "direct" as const };
	await proxySession.setProxy(proxyMode);
	return proxySession.fetch(url, init);
}

const USAGE_PROBE_DEFAULT_TIMEOUT_MS = 10_000;

const USAGE_PROBE_DEFAULT_INTERVAL_MINUTES = 5;

const MAX_USAGE_RESPONSE_BYTES = 64 * 1024;

const MODEL_ID_MAX_LENGTH = 256;

const NO_MODEL_LIST_APIS = new Set(["azure-openai-responses", "google-vertex", "bedrock-converse-stream", "pi-messages"]);

function hasControlChar(value: string): boolean {
	return /[\x00-\x1f\x7f]/.test(value);
}

function describeNetworkFailure(detail: string, translate: (key: MainProcessTranslationKey) => string): string | undefined {
	if (/ERR_SSL|ERR_CERT|SSL_ERROR/i.test(detail)) {
		return translate("mainConfig.fetchTlsBlocked");
	}
	if (/ERR_CONNECTION_TIMED_OUT|ERR_TIMED_OUT|ETIMEDOUT|ERR_CONNECTION_REFUSED|ERR_CONNECTION_RESET|ENOTFOUND|EAI_AGAIN|ERR_NAME_NOT_RESOLVED/i.test(detail)) {
		return translate("mainConfig.fetchUnreachable");
	}
	return undefined;
}

export type PiModelItem = {
	id: string;
	name?: string;
	reasoning?: boolean;
	input?: string[];
	contextWindow?: number;
	maxTokens?: number;
	cost?: {
		input?: number;
		output?: number;
		cacheRead?: number;
		cacheWrite?: number;
	};
	[key: string]: unknown;
};

export type PiProviderConfig = {
	baseUrl?: string;
	api?: string;
	apiKey?: string;
	models: PiModelItem[];
	[key: string]: unknown;
};

export type PiModelsFile = {
	providers: Record<string, PiProviderConfig>;
};

export type PiAuthItem = {
	type?: string;
	key?: string;
	[key: string]: unknown;
};

export type PiAuthFile = Record<string, PiAuthItem>;

export type PiSettings = Record<string, unknown>;

export type ConfigValidationResult = {
	valid: boolean;
	error?: string;
	debugDetails?: string;

	conflict?: boolean;

	revision?: string;
};

type ConfigCopy = (key: MainProcessTranslationKey, params?: Record<string, string | number>) => string;

type TestRequest = {
	url: string;
	headers: Record<string, string>;
	body?: string;
	method?: "GET" | "POST";
};

export class ConfigManager {
	private configDir: string;

	constructor(
		configDir?: string,
		private readonly translate: ConfigCopy = (key, params) => mainProcessT("zh-CN", key, params),
	) {
		this.configDir = configDir ?? PI_AGENT_DIR;
	}

	configureWsl(environment: WslEnvironment | null) {
		this.configDir = environment ? join(environment.windowsHome, ".pi", "agent") : PI_AGENT_DIR;
	}

	getConfigDir(): string {
		return this.configDir;
	}

	async getModelsConfig(): Promise<ConfigFileReadResult<PiModelsFile>> {
		return this.readJsonFile<PiModelsFile>("models.json", { providers: {} });
	}

	async getAuthConfig(): Promise<ConfigFileReadResult<PiAuthFile>> {
		return this.readJsonFile<PiAuthFile>("auth.json", {});
	}

	async getSettingsConfig(): Promise<ConfigFileReadResult<PiSettings>> {
		return this.readJsonFile<PiSettings>("settings.json", {});
	}

	async getTrustConfig(): Promise<ConfigFileReadResult<Record<string, boolean>>> {
		return this.readJsonFile<Record<string, boolean>>("trust.json", {});
	}

	async getMcpConfig(projectPath?: string, options: { writableScope?: "pi-agent" | "project-pi"; projectTrusted?: boolean } = {}): Promise<McpConfigSnapshot> {
		return loadMcpConfigSnapshot(this.configDir, projectPath, undefined, options);
	}

	async saveMcpConfig(file: McpConfigFile, options: { expectedRevision?: string } = {}): Promise<ConfigValidationResult> {
		const error = validateMcpConfigFile(file);
		if (error) return { valid: false, error };

		const result = await saveMcpConfigFile(join(this.configDir, "mcp.json"), file, { expectedRevision: options.expectedRevision });
		return result.ok ? { valid: true, revision: result.revision } : { valid: false, error: result.error, conflict: result.conflict };
	}
	async probeMcpServer(definition: McpServerDefinition): Promise<McpProbeResult> {
		return probeMcpServer(definition);
	}

	async ensureTrustedDirectory(directoryPath: string): Promise<void> {
		const normalizedPath = this.normalizeTrustPath(directoryPath);
		const trustConfig = await this.getTrustConfig();
		if (trustConfig.diagnostic) return;

		const existingEntry = Object.entries(trustConfig.parsed).find(([path]) => this.normalizeTrustPathKey(path) === this.normalizeTrustPathKey(normalizedPath));
		if (existingEntry) return;

		await this.writeJsonFile("trust.json", {
			...trustConfig.parsed,
			[normalizedPath]: true,
		});

		getAppLogger()?.info("config", "Directory auto-trusted (trust.json)", { path: normalizedPath });
	}

	async getProjectTrustDecision(cwd: string): Promise<boolean | null> {
		const trustConfig = await this.getTrustConfig();
		if (trustConfig.diagnostic) return null;
		return this.findNearestTrustEntry(trustConfig.parsed, cwd);
	}

	async setProjectTrustDecision(cwd: string, decision: boolean): Promise<void> {
		const trustConfig = await this.getTrustConfig();
		if (trustConfig.diagnostic) return;
		const key = this.normalizeTrustPath(cwd);
		await this.writeJsonFile("trust.json", {
			...trustConfig.parsed,
			[key]: decision,
		});
	}

	private findNearestTrustEntry(data: Record<string, boolean>, cwd: string): boolean | null {
		const normalized = new Map<string, boolean>();
		for (const [key, value] of Object.entries(data)) {
			normalized.set(this.normalizeTrustPathKey(key), value);
		}
		let current = this.normalizeTrustPathKey(cwd);
		while (true) {
			const value = normalized.get(current);
			if (value === true || value === false) return value;
			const parent = current.startsWith("/") ? posixDirname(current) : dirname(current);
			if (parent === current) return null;
			current = parent;
		}
	}

	private normalizeTrustPathKey(path: string) {
		const normalized = this.normalizeTrustPath(path).replace(/[\\/]+$/, "");
		return process.platform === "win32" && !normalized.startsWith("/") ? normalized.toLowerCase() : normalized;
	}

	private normalizeTrustPath(path: string) {
		if (!path.startsWith("/")) return normalize(path);
		const normalized = posixNormalize(path);
		return normalized === "/" ? normalized : normalized.replace(/\/+$/, "");
	}

	async saveModelsConfig(data: PiModelsFile): Promise<ConfigValidationResult> {
		const validation = this.validateModels(data);
		if (!validation.valid) return validation;

		await this.writeJsonFile("models.json", ensureTokendanceAttribution(this.normalizeModelsForPi(data)));
		return { valid: true };
	}

	async saveAuthConfig(data: PiAuthFile): Promise<ConfigValidationResult> {
		await this.writeJsonFile("auth.json", data);
		return { valid: true };
	}

	async saveSettingsConfig(settings: PiSettings): Promise<ConfigValidationResult> {
		const filePath = join(this.configDir, "settings.json");
		const result = await writePiConfigFile(filePath, (current) => mergeSettingsFormPayload(current, settings));
		if (!result.ok) return { valid: false, error: result.error };
		getAppLogger()?.info("config", "Config file written", { file: filePath, bytes: JSON.stringify(result.data, null, 2).length });
		return { valid: true };
	}

	async saveRawConfig(fileName: string, rawJson: string): Promise<ConfigValidationResult> {
		try {
			JSON.parse(rawJson);
		} catch (e) {
			const debugDetails = e instanceof Error ? e.message : String(e);
			void getAppLogger()?.error("config", "Invalid JSON input", { error: e instanceof Error ? e.message : String(e) });
			return {
				valid: false,
				error: this.translate("mainConfig.invalidJson"),
				debugDetails,
			};
		}

		const allowed = ["models.json", "auth.json", "settings.json", "trust.json", "mcp.json"];
		if (fileName === "mcp.json") {
			const parsed = JSON.parse(rawJson) as McpConfigFile;
			const mcpError = validateMcpConfigFile(parsed);
			if (mcpError) return { valid: false, error: mcpError };
		}
		if (!allowed.includes(fileName)) {
			return {
				valid: false,
				error: this.translate("mainConfig.fileNotEditable", { fileName }),
			};
		}

		await this.writeJsonFile(fileName, rawJson);
		return { valid: true };
	}

	private validateModels(data: PiModelsFile): ConfigValidationResult {
		if (!data.providers || typeof data.providers !== "object") {
			return { valid: false, error: this.translate("mainConfig.modelsProvidersRequired") };
		}
		for (const [providerName, config] of Object.entries(data.providers)) {
			if (!isSafeProviderName(providerName) || hasControlChar(providerName)) {
				return {
					valid: false,
					error: this.translate("mainConfig.providerNameInvalid", { provider: providerName }),
				};
			}
			if (!config.models || !Array.isArray(config.models)) {
				return {
					valid: false,
					error: this.translate("mainConfig.providerModelsRequired", { provider: providerName }),
				};
			}

			if (typeof config.baseUrl === "string" && hasControlChar(config.baseUrl)) {
				return {
					valid: false,
					error: this.translate("mainConfig.baseUrlInvalid", { provider: providerName }),
				};
			}
			for (let i = 0; i < config.models.length; i++) {
				const m = config.models[i];
				if (!m.id || typeof m.id !== "string") {
					return {
						valid: false,
						error: this.translate("mainConfig.modelIdRequired", { provider: providerName, index: i + 1 }),
					};
				}

				if (hasControlChar(m.id) || m.id.length > MODEL_ID_MAX_LENGTH) {
					return {
						valid: false,
						error: this.translate("mainConfig.modelIdInvalid", { provider: providerName, index: i + 1 }),
					};
				}
			}
		}
		return { valid: true };
	}

	private async readJsonFile<T>(fileName: string, fallback: T): Promise<ConfigFileReadResult<T>> {
		const filePath = join(this.configDir, fileName);
		try {
			const raw = await readFile(filePath, "utf8");
			try {
				const parsed = JSON.parse(stripBom(raw)) as T;
				return { raw, parsed };
			} catch (error) {
				return {
					raw,
					parsed: fallback,
					diagnostic: this.createJsonDiagnostic(fileName, raw, error),
				};
			}
		} catch {
			return { raw: JSON.stringify(fallback, null, 2), parsed: fallback };
		}
	}

	private createJsonDiagnostic(fileName: string, raw: string, error: unknown): ConfigFileDiagnostic {
		const message = error instanceof Error ? error.message : String(error);
		const positionMatch = message.match(/position\s+(\d+)/i);
		const position = positionMatch ? Number(positionMatch[1]) : undefined;
		let line: number | undefined;
		let column: number | undefined;
		let snippet: string | undefined;
		if (Number.isFinite(position)) {
			const before = raw.slice(0, position);
			const lines = before.split(/\r?\n/);
			line = lines.length;
			column = lines[lines.length - 1].length + 1;
			const rawLines = raw.split(/\r?\n/);
			const start = Math.max(0, line - 2);
			const end = Math.min(rawLines.length, line + 1);
			snippet = rawLines
				.slice(start, end)
				.map((text, index) => `${start + index + 1}: ${text}`)
				.join("\n");
		}
		return {
			fileName,
			message,
			line,
			column,
			snippet,
			docsUrl: this.docsUrlForFile(fileName),
		};
	}

	private docsUrlForFile(fileName: string) {
		if (fileName === "models.json") return "https://pi.dev/docs/latest/models";
		if (fileName === "settings.json") return "https://pi.dev/docs/latest/settings";
		if (fileName === "mcp.json") return mcpDocsUrl();
		return "https://pi.dev/docs/latest/providers";
	}

	private async writeJsonFile(fileName: string, content: unknown): Promise<void> {
		await mkdir(this.configDir, { recursive: true });
		const filePath = join(this.configDir, fileName);
		const json = typeof content === "string" ? content : JSON.stringify(content, null, 2);
		await writeFile(filePath, json, "utf8");

		getAppLogger()?.info("config", "Config file written", { file: filePath, bytes: json.length });
	}

	private async writeJsonFileAtomic(fileName: string, content: unknown): Promise<void> {
		await mkdir(this.configDir, { recursive: true });
		const filePath = join(this.configDir, fileName);
		const temporaryPath = join(this.configDir, `.${fileName}.${randomUUID()}.tmp`);
		const json = typeof content === "string" ? content : JSON.stringify(content, null, 2);
		try {
			await writeFile(temporaryPath, json, { encoding: "utf8", flag: "wx" });
			await rename(temporaryPath, filePath);
			getAppLogger()?.info("config", "Config file written (atomic)", { file: filePath, bytes: json.length });
		} finally {
			await rm(temporaryPath, { force: true }).catch(() => undefined);
		}
	}

	async fetchProviderModels(
		baseUrl: string,
		apiKey: string,
		apiType?: string,
		headers?: Record<string, string>,
		proxyTarget?: ConfigProxyTarget,
	): Promise<{
		success: boolean;
		models?: FetchedModel[];
		error?: string;
		debugDetails?: string;

		requestUrl?: string;

		sessionBaseUrlNeedsVersion?: boolean;

		suggestedBaseUrl?: string;
	}> {
		const requestedApi = typeof apiType === "string" ? apiType.trim() : "";
		if (NO_MODEL_LIST_APIS.has(requestedApi)) {
			return {
				success: false,
				error: this.translate("mainConfig.fetchModelsUnsupportedApi", { api: requestedApi }),
				debugDetails: `api "${requestedApi}" has no generic model listing endpoint`,
			};
		}
		const requests = this.buildModelsRequest(baseUrl, apiKey, apiType, headers);
		let lastError: string | undefined;
		let lastDebugDetails: string | undefined;
		let lastRequestUrl: string | undefined;

		for (const request of requests) {
			lastRequestUrl = this.redactSecret(request.url, apiKey);
			try {
				const controller = new AbortController();

				const timeout = setTimeout(() => controller.abort(), 10_000);

				try {
					const response = await modelListFetch(
						request.url,
						{
							method: request.method ?? "GET",
							headers: request.headers,
							signal: controller.signal,
						},
						proxyTarget,
					);
					const res =
						response ??
						(await net.fetch(request.url, {
							method: request.method ?? "GET",
							headers: request.headers,
							signal: controller.signal,
						}));

					if (!res.ok) {
						lastDebugDetails = `HTTP ${res.status}: ${res.statusText}`;
						void getAppLogger()?.warn("config", "Provider model list request failed", { status: res.status, requestUrl: lastRequestUrl });
						lastError = this.translate("mainConfig.fetchModelsFailed");
						continue;
					}

					const contentType = res.headers?.get?.("content-type") ?? "";
					if (/text\/html/i.test(contentType)) {
						lastDebugDetails = `HTTP ${res.status} text/html (WAF/anti-bot page)`;
						void getAppLogger()?.warn("config", "Provider returned an HTML page instead of JSON", { requestUrl: lastRequestUrl, contentType });
						lastError = this.translate("mainConfig.fetchBlockedByHtml");
						continue;
					}

					let body: Record<string, unknown>;
					try {
						body = (await res.json()) as Record<string, unknown>;
					} catch {
						lastDebugDetails = `HTTP ${res.status} non-JSON body`;
						lastError = this.translate("mainConfig.fetchBlockedByHtml");
						continue;
					}

					const models = this.parseModelsResponse(body, apiType);

					if (models.length === 0) {
						lastError = this.translate("mainConfig.emptyModelList");
						continue;
					}

					const sessionBaseUrlNeedsVersion = needsSessionBaseUrlVersionHint(baseUrl, request.url, apiType);
					const suggestedBaseUrl = suggestNormalizedBaseUrl(baseUrl, request.url, apiType) ?? undefined;
					return {
						success: true,
						models,
						requestUrl: lastRequestUrl,
						sessionBaseUrlNeedsVersion,
						suggestedBaseUrl,
					};
				} finally {
					clearTimeout(timeout);
				}
			} catch (e) {
				if (e instanceof Error && e.name === "AbortError") {
					lastError = this.translate("mainConfig.fetchTimeout");
				} else {
					const detail = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
					void getAppLogger()?.error("config", "Provider model list request failed", { error: detail });
					lastError = describeNetworkFailure(detail, (key) => this.translate(key)) ?? this.translate("mainConfig.fetchModelsFailed");
				}
			}
		}

		return {
			success: false,
			error: lastError ?? this.translate("mainConfig.fetchModelsFailed"),
			...(lastDebugDetails ? { debugDetails: lastDebugDetails } : {}),
			requestUrl: lastRequestUrl,
			sessionBaseUrlNeedsVersion: needsSessionBaseUrlVersionHint(baseUrl, lastRequestUrl, apiType),
		};
	}

	private normalizeApiForSave(apiType: unknown): string | undefined {
		if (typeof apiType !== "string") return undefined;
		const trimmed = apiType.trim();
		if (!trimmed) return undefined;
		switch (trimmed) {
			case "anthropic":
				return "anthropic-messages";
			case "openai-chat-completions":
				return "openai-completions";
			default:
				return trimmed;
		}
	}

	private normalizeApiType(apiType?: string) {
		switch (apiType) {
			case "anthropic":
			case "anthropic-messages":
				return "anthropic-messages";
			case "openai-codex-responses":
				return "openai-codex-responses";
			case "openai-chat-completions":
				return "openai-completions";
			case "openai-completions":
			case "openai-responses":
			case "google-generative-ai":
			case "mistral-conversations":
				return apiType;
			default:
				return "openai-completions";
		}
	}

	private buildModelsRequest(baseUrl: string, apiKey: string, apiType?: string, requestHeaders?: Record<string, string>): TestRequest[] {
		const api = this.normalizeApiType(apiType);
		// 与真实会话一致：允许 provider 配置的自定义 headers（含 User-Agent）
		// 覆盖 SDK 默认 UA，保证「获取模型」与「真实会话」走同一套网络形象。
		const extraHeaders = this.normalizeRequestHeaders(requestHeaders);
		if (api === "google-generative-ai") {
			// Google Gemini：使用独立的 v1beta 路径
			const u = baseUrl.replace(/\/+$/, "");
			const needsPrefix = !/[\/]v\d+(alpha|beta)?$/.test(u);
			const versioned = needsPrefix ? `${u}/v1beta` : u;
			return [
				{
					url: `${versioned}/models?key=${encodeURIComponent(apiKey)}`,
					headers: { "Content-Type": "application/json", ...extraHeaders },
				},
			];
		}

		if (api === "anthropic-messages") {
			// Anthropic：优先尝试 /v1/models（兼容大部分第三方网关），
			// 再回退到 /models（原生 Anthropic API 或旧实现）
			const u = baseUrl.replace(/\/+$/, "").replace(/\/v1$/, "");
			const headers = this.withAnthropicSdkUserAgent({
				"x-api-key": apiKey,
				"anthropic-version": "2023-06-01",
				"Content-Type": "application/json",
				...extraHeaders,
			});
			const primaryUrl = `${u}/v1/models`;
			const fallbackUrl = `${u}/models`;
			return primaryUrl === fallbackUrl
				? [{ url: primaryUrl, headers }]
				: [
						{ url: primaryUrl, headers },
						{ url: fallbackUrl, headers },
					];
		}

		// OpenAI 兼容 API（Chat Completions / Responses / Codex / Mistral）：
		// 优先尝试 ensureVersionPath 补齐后的路径，再回退到原始 baseUrl + /models
		const headers = this.withOpenAiSdkUserAgent({
			Authorization: `Bearer ${apiKey}`,
			"Content-Type": "application/json",
			...extraHeaders,
		});
		const u = baseUrl.replace(/\/+$/, "");
		const primaryUrl = `${this.ensureVersionPath(baseUrl)}/models`;
		const fallbackUrl = `${u}/models`;

		return primaryUrl === fallbackUrl
			? [{ url: primaryUrl, headers }]
			: [
					{ url: primaryUrl, headers },
					{ url: fallbackUrl, headers },
				];
	}

	private parseModelsResponse(body: Record<string, unknown>, apiType?: string): FetchedModel[] {
		const listing = parseProviderModelsResponse(body, this.normalizeApiType(apiType));
		// 只返回 endpoint 实报字段，不做 bundled catalog 预填：
		// 预填会让「拉取后新增」与「手动新增」走两套模板优先级，且用户手改字段难以区分来源。
		// catalog 补空统一由渲染层保存/重置流程经 projects:get-model-spec 完成（endpoint 实报优先）。
		return listing;
	}

	private normalizeModelsForPi(data: PiModelsFile): PiModelsFile {
		return {
			...data,
			providers: Object.fromEntries(
				Object.entries(data.providers).map(([name, provider]) => {
					const normalizedProvider: PiProviderConfig = { ...provider };
					// 空/纯空白 api 会让 pi 整文件校验失败（schema minLength 1），删键即回到
					// 「继承默认」的合法形态；不发明 openai-completions，见 normalizeApiForSave。
					const providerApi = this.normalizeApiForSave(provider.api);
					if (providerApi !== undefined) normalizedProvider.api = providerApi;
					else delete normalizedProvider.api;
					normalizedProvider.models = provider.models.map((model) => {
						const normalized: PiModelItem = { ...model };
						const modelApi = this.normalizeApiForSave(model.api);
						if (modelApi !== undefined) normalized.api = modelApi;
						else delete normalized.api;
						// pi schema 中 name 可选但需 minLength:1，空 name 会让 pi 整文件拒绝。
						// 与拉取供应商列表的 parseProviderModelsResponse 行为对齐：name 为空
						// 就删掉该键（可选字段缺省反而合法），避免手动新增模型留空时写坏文件。
						if (typeof normalized.name === "string" && normalized.name.length === 0) {
							delete normalized.name;
						}
						return normalized;
					});
					return [name, normalizedProvider];
				}),
			),
		};
	}

	/**
	 * 保存路径的 api 归一化：只把已知历史别名改写成 pi 官方 registry 名称，
	 * **不**发明默认值。
	 *
	 * 为什么不能复用 normalizeApiType：那个函数服务「拉取模型列表 / 用量探针」的
	 * 网络路径，未知值兜底成 openai-completions 是为了「用最通用的协议试一试」；
	 * 一旦用在写盘路径，就等于把用户的 azure-openai-responses / google-vertex /
	 * bedrock-converse-stream / pi-messages 静默改写成 openai-completions，保存一次
	 * 即损坏配置（pi 1.0.4 registry 里这些 id 都真实存在）。
	 *
	 * 保留未知值的理由：pi 允许自定义 provider 扩展注册任意 api id（schema 只要求
	 * 非空字符串），PiDeck 无法穷举；宁可原样保留，也不篡改用户配置。
	 * 返回 undefined 表示「没有可写值」（缺省或空白），调用方据此删键。
	 * 入参是 unknown：PiModelItem 的 api 只能经索引签名取到 unknown，在函数内一次收窄，
	 * 避免调用方各自写 typeof 判断而漏掉一处。
	 */
	private ensureVersionPath(baseUrl: string): string {
		return ensureOpenAiVersionPath(baseUrl);
	}

	private normalizeRequestHeaders(headers?: Record<string, string>) {
		if (!headers) return {};
		return Object.fromEntries(Object.entries(headers).filter(([key, value]) => key.trim().length > 0 && typeof value === "string"));
	}

	private withOpenAiSdkUserAgent(headers: Record<string, string>) {
		const hasUserAgent = Object.keys(headers).some((key) => key.toLowerCase() === "user-agent");

		return hasUserAgent ? headers : { ...headers, "User-Agent": "OpenAI/JS 6.26.0" };
	}

	private withAnthropicSdkUserAgent(headers: Record<string, string>) {
		const hasUserAgent = Object.keys(headers).some((key) => key.toLowerCase() === "user-agent");

		return hasUserAgent ? headers : { ...headers, "User-Agent": "anthropic-sdk-typescript/0.27.3" };
	}

	private redactSecret(value: string, apiKey: string) {
		if (!apiKey) return value;
		return value.split(apiKey).join("***");
	}

	async exportConfig(): Promise<string> {
		const [models, auth, settings, mcp] = await Promise.all([this.readJsonFile<PiModelsFile>("models.json", { providers: {} }), this.readJsonFile<PiAuthFile>("auth.json", {}), this.readJsonFile<PiSettings>("settings.json", {}), this.readJsonFile<McpConfigFile>("mcp.json", { mcpServers: {} })]);
		return JSON.stringify(
			{
				version: 1,
				exportedAt: new Date().toISOString(),
				files: {
					"models.json": models.parsed,
					"auth.json": auth.parsed,
					"settings.json": settings.parsed,
					"mcp.json": mcp.parsed,
				},
			},
			null,
			2,
		);
	}

	async importConfig(packageJson: string): Promise<ConfigValidationResult> {
		let pkg: unknown;
		try {
			pkg = JSON.parse(packageJson);
		} catch (e) {
			const debugDetails = e instanceof Error ? e.message : String(e);
			void getAppLogger()?.error("config", "Invalid configuration import JSON", { error: e instanceof Error ? e.message : String(e) });
			return {
				valid: false,
				error: this.translate("mainConfig.invalidJson"),
				debugDetails,
			};
		}
		const data = pkg as Record<string, unknown>;
		const files = data.files as Record<string, unknown> | undefined;
		if (!files || typeof files !== "object") {
			return { valid: false, error: this.translate("mainConfig.importFilesRequired") };
		}

		const allowed: Array<[string, string]> = [
			["models.json", "models.json"],
			["auth.json", "auth.json"],
			["settings.json", "settings.json"],
		];
		for (const [key, fileName] of allowed) {
			if (files[key] != null) {
				await this.writeJsonFile(fileName, files[key]);
			}
		}
		if (files["mcp.json"] != null) {
			const mcpFile = files["mcp.json"] as McpConfigFile;
			const mcpError = validateMcpConfigFile(mcpFile);
			if (mcpError) return { valid: false, error: mcpError };
			await this.writeJsonFile("mcp.json", mcpFile);
		}
		return { valid: true };
	}

	async resolveProviderEndpoint(provider: string, backend: UsageProbeBackend = "pi") {
		return this.resolveUsageEndpoint(provider, backend);
	}

	async fetchProviderUsage(provider: string, backend: UsageProbeBackend = "pi"): Promise<ProviderUsageResult> {
		const settingsDir = this.usageProbeSettingsDir(backend);

		const { settings, effectiveDir } = await this.loadUsageSettingsWithFallback(backend, provider, settingsDir);
		for (const error of settings.errors) {
			void getAppLogger()?.warn("config", "Usage probe config ignored", { error });
		}
		if (settings.config?.enabled !== true) {
			return {
				success: false,
				disabled: true,
				error: this.translate("mainConfig.providerUsageDisabled"),
			};
		}

		const resolved = await this.resolveUsageEndpoint(provider, backend);
		if (!resolved.matched || !resolved.baseUrl) {
			return { success: false, error: this.translate("mainConfig.providerUsageUnsupported") };
		}

		const resolvedBaseUrl = resolved.baseUrl;
		const resolvedApiKey = resolved.apiKey ?? "";
		const api = this.normalizeApiType(resolved.apiType);
		const timeoutMs = (settings.config?.timeoutSecs ?? 10) * 1000;
		const intervalMinutes = settings.config?.intervalMinutes ?? USAGE_PROBE_DEFAULT_INTERVAL_MINUTES;

		const panelContext: Sub2ApiPanelContext = {
			provider,
			configDir: effectiveDir,
			...(settings.config?.panelRefreshToken ? { refreshToken: settings.config.panelRefreshToken } : {}),
			persist: true,
		};

		const template = settings.config?.template;
		if (template !== undefined && isDeclarativeTemplateId(template)) {
			const built = buildDeclarativeUsageProbeTemplate(template, settings.config ?? {}, {
				baseUrl: resolvedBaseUrl,
				apiKey: resolvedApiKey,
			});
			if ("error" in built) {
				return { success: false, error: built.error };
			}

			return this.runProviderUsageProbes(built.baseUrl, built.apiKey, resolved.headers, built.candidates, timeoutMs, intervalMinutes, panelContext);
		}

		const userProbes = await loadUserUsageProbes(effectiveDir);
		for (const error of userProbes.errors) {
			void getAppLogger()?.warn("config", "User usage probe config ignored", { error });
		}
		const applicable = [...USAGE_PROBE_CANDIDATES, ...userProbes.candidates].filter((c) => candidateApplies(c, resolvedBaseUrl, api));
		if (applicable.length === 0) {
			return { success: false, error: this.translate("mainConfig.providerUsageUnsupported") };
		}
		return this.runProviderUsageProbes(resolvedBaseUrl, resolvedApiKey, resolved.headers, applicable, timeoutMs, intervalMinutes, panelContext);
	}

	async getUsageProbeSettings(provider: string, backend: UsageProbeBackend = "pi"): Promise<UsageProbeSettingsResult> {
		const { settings: loaded, effectiveDir } = await this.loadUsageSettingsWithFallback(backend, provider, this.usageProbeSettingsDir(backend));

		const legacyProbes = await this.matchLegacyProbesForProvider(provider, backend, effectiveDir);
		return {
			...(loaded.config ? { config: loaded.config } : {}),
			recognized: await this.recognizeUsageTemplate(provider, backend),
			templates: [],
			errors: loaded.errors,
			...(legacyProbes.length > 0 ? { legacyProbes } : {}),
		};
	}

	private async matchLegacyProbesForProvider(provider: string, backend: UsageProbeBackend = "pi", dir = this.usageProbeSettingsDir(backend)): Promise<UserUsageProbe[]> {
		const resolved = await this.resolveUsageEndpoint(provider, backend);
		if (!resolved.matched || !resolved.baseUrl) return [];
		const api = this.normalizeApiType(resolved.apiType);
		const loaded = await loadUserUsageProbesDetailed(dir);
		const hits: UserUsageProbe[] = [];
		for (let index = 0; index < loaded.candidates.length; index += 1) {
			const probe = loaded.probes[index];
			const candidate = loaded.candidates[index];
			if (probe && candidate && candidateApplies(candidate, resolved.baseUrl, api)) {
				hits.push(probe);
			}
		}
		return hits;
	}

	async recognizeUsageTemplate(provider: string, backend: UsageProbeBackend = "pi"): Promise<UsageProbeRecognition | null> {
		const resolved = await this.resolveUsageEndpoint(provider, backend);
		if (!resolved.matched || !resolved.baseUrl) return null;
		return this.matchBuiltinRecognition(resolved.baseUrl, resolved.apiType);
	}

	private matchBuiltinRecognition(baseUrl: string, apiType: string | undefined): UsageProbeRecognition | null {
		const api = this.normalizeApiType(apiType);
		for (const candidate of USAGE_PROBE_CANDIDATES) {
			if (!candidate.templateId) continue;
			if (candidateApplies(candidate, baseUrl, api)) {
				const category = USAGE_PROBE_CATEGORY_BY_TEMPLATE_ID[candidate.templateId];
				return { templateId: candidate.templateId, category: category ?? "balance" };
			}
		}
		return null;
	}

	async listUsageProbeStates(backend: UsageProbeBackend = "pi", providers: string[] = []): Promise<UsageProbeStatesResult> {
		const settingsDir = this.usageProbeSettingsDir(backend);
		const [saved, modelsRes, authRes] = await Promise.all([loadUsageProbeProviderConfigs(settingsDir), this.getModelsConfig(), this.getAuthConfig()]);
		const names = new Set<string>();

		for (const name of Object.keys(modelsRes.parsed?.providers ?? {})) names.add(name);
		for (const name of Object.keys(authRes.parsed ?? {})) names.add(name);
		for (const name of Object.keys(saved.providers)) names.add(name);
		for (const name of providers) {
			const trimmed = name.trim();
			if (trimmed) names.add(trimmed);
		}

		const catalog = getPiAiCatalogIndex();
		const lookup = {
			getModelsConfig: async () => modelsRes,
			getAuthConfig: async () => authRes,
			catalogProvider: (name: string) => piBuiltinSnapshotFromCatalog(name, undefined, catalog),
		};

		const states: Record<string, UsageProbeProviderState> = {};
		for (const name of names) {
			const config = saved.providers[name];
			const resolved = await resolveProviderUsageEndpoint(lookup, name);
			const recognized: UsageProbeRecognition | null = resolved.matched && resolved.baseUrl ? this.matchBuiltinRecognition(resolved.baseUrl, resolved.apiType) : null;
			const template = config?.template ?? recognized?.templateId;
			states[name] = {
				enabled: config?.enabled ?? false,
				configured: config != null,
				recognized: recognized != null,
				...(template ? { template } : {}),
				intervalMinutes: config?.intervalMinutes ?? USAGE_PROBE_DEFAULT_INTERVAL_MINUTES,
			};
		}
		return { providers: states, errors: saved.errors };
	}

	async testUsageProbe(input: UsageProbeTestInput): Promise<ProviderUsageResult> {
		const backend = input.backend ?? "pi";
		const resolved = await this.resolveUsageEndpoint(input.provider, backend);
		if (!resolved.matched || !resolved.baseUrl) {
			return { success: false, error: this.translate("mainConfig.providerUsageUnsupported") };
		}

		const resolvedBaseUrl = resolved.baseUrl;
		const resolvedApiKey = resolved.apiKey ?? "";
		const timeoutMs = (input.timeoutSecs ?? 10) * 1000;

		const template = input.template?.trim() || (await this.recognizeUsageTemplate(input.provider, backend))?.templateId;
		if (!template) {
			return { success: false, error: this.translate("mainConfig.providerUsageUnsupported") };
		}

		if (template !== undefined && isDeclarativeTemplateId(template)) {
			const built = buildDeclarativeUsageProbeTemplate(
				template,
				{
					apiKey: input.apiKey,
					baseUrl: input.baseUrl,
					accessToken: input.accessToken,
					userId: input.userId,
					cookie: input.cookie,
					cookiePath: input.cookiePath,
					valuePath: input.valuePath,
					currencyPath: input.currencyPath,
					accessKeyId: input.accessKeyId,
					secretAccessKey: input.secretAccessKey,

					panelJwt: input.panelJwt,
				},
				{ baseUrl: resolvedBaseUrl, apiKey: resolvedApiKey },
			);
			if ("error" in built) {
				return { success: false, error: built.error };
			}

			const panelContext: Sub2ApiPanelContext = {
				provider: input.provider,
				configDir: "",
				...(input.panelRefreshToken ? { refreshToken: input.panelRefreshToken } : {}),
				persist: false,
			};
			return this.runProviderUsageProbes(built.baseUrl, built.apiKey, resolved.headers, built.candidates, timeoutMs, 0, panelContext);
		}

		const candidate = USAGE_PROBE_CANDIDATES.find((c) => c.templateId === template);
		if (!candidate) {
			return { success: false, error: this.translate("mainConfig.providerUsageUnsupported") };
		}
		return this.runProviderUsageProbes(resolvedBaseUrl, resolvedApiKey, resolved.headers, [candidate], timeoutMs, 0);
	}

	private usageProbeSettingsDir(_backend: UsageProbeBackend): string {
		return this.configDir;
	}

	getUsageProbeConfigDir(_backend: UsageProbeBackend = "pi"): string {
		return this.usageProbeSettingsDir(_backend);
	}

	private async loadUsageSettingsWithFallback(_backend: UsageProbeBackend, provider: string, settingsDir: string): Promise<{ settings: UsageProbeSettingsLoadResult; effectiveDir: string }> {
		return { settings: await loadUsageProbeSettings(settingsDir, provider), effectiveDir: settingsDir };
	}

	private async resolveUsageEndpoint(provider: string, _backend: UsageProbeBackend = "pi") {
		const catalog = getPiAiCatalogIndex();
		const lookup = {
			getModelsConfig: () => this.getModelsConfig(),
			getAuthConfig: () => this.getAuthConfig(),
			catalogProvider: (name: string) => piBuiltinSnapshotFromCatalog(name, undefined, catalog),
		};
		return resolveProviderUsageEndpoint(lookup, provider);
	}

	private async runProviderUsageProbes(baseUrl: string, apiKey: string, requestHeaders: Record<string, string> | undefined, candidates: UsageProbeCandidate[], timeoutMs: number, intervalMinutes: number, panel?: Sub2ApiPanelContext): Promise<ProviderUsageResult> {
		if (!apiKey) {
			return { success: false, error: this.translate("mainConfig.providerUsageNoKey") };
		}
		const result = (await this.runUsageProbes(baseUrl, apiKey, this.normalizeRequestHeaders(requestHeaders), candidates, timeoutMs, panel)) ?? {
			success: false,
			error: this.translate("mainConfig.providerUsageFailed"),
		};
		return result.success ? { ...result, intervalMinutes } : result;
	}

	private async runUsageProbes(baseUrl: string, apiKey: string, extraHeaders: Record<string, string>, candidates: UsageProbeCandidate[], timeoutMs: number, panel?: Sub2ApiPanelContext): Promise<ProviderUsageResult | undefined> {
		const startedAt = Date.now();

		const attempts: UsageProbeAttempt[] = [];

		for (const candidate of candidates) {
			const preflightHeaders: Record<string, string> = {};
			if (candidate.preflight) {
				const preflightUrls = usageProbeUrls({ path: candidate.preflight.path, absoluteUrl: candidate.preflight.absoluteUrl, rootPath: false }, baseUrl, (url) => this.ensureVersionPath(url));
				let captured: unknown;
				for (const preflightUrl of preflightUrls) {
					const preflightResult = await usageProbeRequest(preflightUrl, {
						method: "GET",
						headers: this.withOpenAiSdkUserAgent(buildProbeHeaders(candidate.preflight.headers, apiKey)),
						timeoutMs,
						maxBytes: MAX_USAGE_RESPONSE_BYTES,
					});
					if ("error" in preflightResult) continue;
					if (preflightResult.status < 200 || preflightResult.status >= 300) continue;
					let preflightBody: unknown = null;
					try {
						preflightBody = JSON.parse(preflightResult.raw);
					} catch {}
					captured = getByPath(preflightBody, candidate.preflight.capture.path);
					if (typeof captured === "string" && captured.trim() !== "") break;
				}
				if (typeof captured !== "string" || captured.trim() === "") continue;
				preflightHeaders[candidate.preflight.capture.header] = captured.trim();
			}

			const urls = usageProbeUrls(candidate, baseUrl, (url) => this.ensureVersionPath(url));
			for (const requestUrl of urls) {
				const result = await usageProbeRequest(requestUrl, {
					method: candidate.method ?? "GET",
					headers: this.withOpenAiSdkUserAgent({
						...buildProbeHeaders(candidate.headers, apiKey, {
							noBearer: candidate.noBearer === true,
						}),
						...preflightHeaders,
						...extraHeaders,
					}),
					...(candidate.method === "POST" && candidate.body !== undefined ? { body: JSON.stringify(candidate.body) } : {}),
					timeoutMs,
					maxBytes: MAX_USAGE_RESPONSE_BYTES,
				});
				if ("error" in result) {
					attempts.push({
						url: requestUrl,
						method: candidate.method ?? "GET",
						error: result.error,
					});
					continue;
				}
				const safeRaw = this.redactSecret(result.raw, apiKey);
				if (result.status < 200 || result.status >= 300) {
					attempts.push({
						url: requestUrl,
						method: candidate.method ?? "GET",
						status: result.status,

						...(safeRaw ? { body: safeRaw.slice(0, 240) } : {}),
					});
					continue;
				}
				let body: unknown;
				try {
					body = JSON.parse(result.raw);
				} catch {
					body = null;
				}
				const parsed = parseUsageResponseBody(body, safeRaw, candidate.parse);
				if (parsed.matched) {
					const result: ProviderUsageResult = {
						success: true,
						kind: parsed.kind,
						periods: parsed.periods,
						balance: parsed.balance,
						credits: parsed.credits,
						booster: parsed.booster,
						at: startedAt,
					};

					if (candidate.panelBalance && parsed.kind !== "balance" && !parsed.balance) {
						const merged = await this.fetchSub2ApiPanelBalance(baseUrl, { accessToken: candidate.panelBalance.token, ...(panel?.refreshToken ? { refreshToken: panel.refreshToken } : {}) }, timeoutMs, panel);
						if (merged.ok) result.balance = merged.balance;
						else result.panelBalanceError = merged.reason;
					}
					return result;
				}

				attempts.push({ url: requestUrl, method: candidate.method ?? "GET", kind: "shape" });
			}
		}

		if (attempts.length === 0) {
			return undefined;
		}
		return {
			success: false,
			error: this.translate("mainConfig.providerUsageFailed"),
			detail: buildProbeFailureDetail(attempts, (key) => this.translate(key)),
		};
	}

	private async fetchSub2ApiPanelBalance(baseUrl: string, tokens: Sub2ApiPanelTokens, timeoutMs: number, panel?: Sub2ApiPanelContext): Promise<{ ok: true; balance: ProviderUsageResult["balance"] } | { ok: false; reason: "unauthorized" | "failed" }> {
		const balanceUrls = usageProbeUrls({ path: "/api/v1/auth/me", rootPath: true }, baseUrl, (url) => this.ensureVersionPath(url));
		const refreshUrls = usageProbeUrls({ path: "/api/v1/auth/refresh", rootPath: true }, baseUrl, (url) => this.ensureVersionPath(url));
		const outcome = await fetchSub2ApiPanelBalanceWithRefresh({
			balanceUrls,
			refreshUrls,
			tokens,
			timeoutMs,
			maxBytes: MAX_USAGE_RESPONSE_BYTES,
			request: usageProbeRequest,

			buildAuthHeaders: (accessToken) => this.withOpenAiSdkUserAgent(buildProbeHeaders(undefined, accessToken)),
			refreshHeaders: () => this.withOpenAiSdkUserAgent({}),
			...(panel?.persist
				? {
						onTokensRefreshed: async (pair) => {
							const saved = await updateUsageProbeSub2ApiTokens(panel.configDir, panel.provider, {
								panelJwt: pair.accessToken,
								...(pair.refreshToken ? { panelRefreshToken: pair.refreshToken } : {}),
							});
							if (!saved.ok) void getAppLogger()?.warn("config", "Sub2API panel token refresh not persisted", { provider: panel.provider, error: saved.error });
							else void getAppLogger()?.info("config", "Sub2API panel token refreshed", { provider: panel.provider });
						},
					}
				: {}),
		});
		if (outcome.ok) return { ok: true, balance: outcome.balance };
		return { ok: false, reason: outcome.reason };
	}
}
