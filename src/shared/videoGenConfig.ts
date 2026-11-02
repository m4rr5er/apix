export const VIDEO_GEN_PROTOCOLS = ["minimax-v2", "seedance-ark"] as const;
export type VideoGenProtocolFamily = (typeof VIDEO_GEN_PROTOCOLS)[number];

export const VIDEO_GEN_PROTOCOL_LABELS: Record<VideoGenProtocolFamily, string> = {
	"minimax-v2": "MiniMax 视频协议 v2",
	"seedance-ark": "字节 Seedance（Ark）",
};

export const VIDEO_GEN_RESOLUTION_PRESETS: Record<VideoGenProtocolFamily, string[]> = {
	"minimax-v2": ["480P", "768P", "1080P"],

	"seedance-ark": ["480p", "720p", "1080p"],
};

export const VIDEO_GEN_RATIO_PRESETS: Record<VideoGenProtocolFamily, string[]> = {
	"minimax-v2": ["16:9", "9:16", "4:3", "3:4", "1:1"],
	"seedance-ark": ["16:9", "9:16", "4:3", "3:4", "1:1", "adaptive"],
};

export const VIDEO_GEN_DURATION_PRESETS: readonly string[] = ["5", "10"];

export type VideoGenProviderConfig = {
	id: string;
	name: string;

	baseUrl: string;
	apiKey: string;

	protocol: VideoGenProtocolFamily;

	models: string[];

	defaults?: {
		resolution?: string;
		duration?: string;
		ratio?: string;
	};

	priceNote?: string;
};

export type VideoGenConfigFile = {
	providers: VideoGenProviderConfig[];

	activeProviderId: string;

	activeModel: string;

	activeParams: { resolution?: string; duration?: string; ratio?: string };

	costConfirm: boolean;
};

export const EMPTY_VIDEO_GEN_CONFIG: VideoGenConfigFile = {
	providers: [],
	activeProviderId: "",
	activeModel: "",
	activeParams: {},
	costConfirm: true,
};

const MAX_NAME = 64;
const MAX_URL = 512;
const MAX_KEY = 512;
const MAX_MODEL_ID = 128;
const MAX_MODELS = 80;
const MAX_PROVIDERS = 20;
const MAX_PARAM = 32;
const MAX_PRICE_NOTE = 128;
const ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,63}$/;

function sanitizeId(value: unknown, fallback: string): string {
	if (typeof value === "string" && ID_RE.test(value.trim())) return value.trim();
	return fallback;
}

function sanitizeParam(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	const trimmed = value.trim().slice(0, MAX_PARAM);
	return trimmed || undefined;
}

export function sanitizeVideoGenProtocol(value: unknown): VideoGenProtocolFamily {
	if (typeof value === "string" && (VIDEO_GEN_PROTOCOLS as readonly string[]).includes(value)) {
		return value as VideoGenProtocolFamily;
	}
	return "minimax-v2";
}

function uniqueModels(values: unknown): string[] {
	if (!Array.isArray(values)) return [];
	const seen = new Set<string>();
	const models: string[] = [];
	for (const item of values) {
		if (typeof item !== "string") continue;
		const id = item.trim().slice(0, MAX_MODEL_ID);
		if (!id || seen.has(id)) continue;
		seen.add(id);
		models.push(id);
		if (models.length >= MAX_MODELS) break;
	}
	return models;
}

export function sanitizeVideoGenConfig(input: unknown): VideoGenConfigFile {
	if (typeof input !== "object" || input === null || Array.isArray(input)) {
		return { ...EMPTY_VIDEO_GEN_CONFIG };
	}
	const raw = input as Record<string, unknown>;
	const providersIn = Array.isArray(raw.providers) ? raw.providers : [];
	const providers: VideoGenProviderConfig[] = [];
	const seenIds = new Set<string>();
	for (let index = 0; index < providersIn.length && providers.length < MAX_PROVIDERS; index += 1) {
		const item = providersIn[index];
		if (typeof item !== "object" || item === null || Array.isArray(item)) continue;
		const row = item as Record<string, unknown>;
		const fallbackId = `vg-${index + 1}`;
		const id = sanitizeId(row.id, fallbackId);
		if (seenIds.has(id)) continue;
		seenIds.add(id);
		const name = typeof row.name === "string" && row.name.trim() ? row.name.trim().slice(0, MAX_NAME) : "Video";
		const baseUrl = typeof row.baseUrl === "string" && /^https?:\/\/[^\s]+$/i.test(row.baseUrl.trim()) ? row.baseUrl.trim().replace(/\/+$/, "").slice(0, MAX_URL) : "";
		const apiKey = typeof row.apiKey === "string" ? row.apiKey.trim().slice(0, MAX_KEY) : "";
		const defaultsRow = row.defaults && typeof row.defaults === "object" && !Array.isArray(row.defaults) ? (row.defaults as Record<string, unknown>) : {};
		const defaults = {
			resolution: sanitizeParam(defaultsRow.resolution),
			duration: sanitizeParam(defaultsRow.duration),
			ratio: sanitizeParam(defaultsRow.ratio),
		};
		const priceNote = typeof row.priceNote === "string" && row.priceNote.trim() ? row.priceNote.trim().slice(0, MAX_PRICE_NOTE) : undefined;
		providers.push({
			id,
			name,
			baseUrl,
			apiKey,
			protocol: sanitizeVideoGenProtocol(row.protocol),
			models: uniqueModels(row.models),
			defaults: defaults.resolution || defaults.duration || defaults.ratio ? defaults : undefined,
			priceNote,
		});
	}
	const requestedProvider = typeof raw.activeProviderId === "string" ? raw.activeProviderId.trim() : "";

	const activeProvider = requestedProvider ? providers.find((provider) => provider.id === requestedProvider) : undefined;
	const requestedModel = typeof raw.activeModel === "string" ? raw.activeModel.trim().slice(0, MAX_MODEL_ID) : "";
	const activeModel = activeProvider?.models.includes(requestedModel) ? requestedModel : "";
	const paramsRow = raw.activeParams && typeof raw.activeParams === "object" && !Array.isArray(raw.activeParams) ? (raw.activeParams as Record<string, unknown>) : {};
	const activeParams = {
		resolution: sanitizeParam(paramsRow.resolution),
		duration: sanitizeParam(paramsRow.duration),
		ratio: sanitizeParam(paramsRow.ratio),
	};
	return {
		providers,
		activeProviderId: activeProvider?.id ?? "",
		activeModel,
		activeParams,
		costConfirm: raw.costConfirm !== false,
	};
}

export function findVideoGenProvider(config: VideoGenConfigFile, providerId: string): VideoGenProviderConfig | undefined {
	return config.providers.find((provider) => provider.id === providerId);
}

const VIDEO_GEN_SELECTION_SEP = "\u001f";

export function encodeVideoGenSelection(providerId: string, modelId: string): string {
	return `${providerId}${VIDEO_GEN_SELECTION_SEP}${modelId}`;
}

export function decodeVideoGenSelection(value: string): { providerId: string; modelId: string } | null {
	const index = value.indexOf(VIDEO_GEN_SELECTION_SEP);
	if (index <= 0) return null;
	const providerId = value.slice(0, index);
	const modelId = value.slice(index + VIDEO_GEN_SELECTION_SEP.length);
	if (!providerId || !modelId) return null;
	return { providerId, modelId };
}
