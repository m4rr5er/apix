export const IMAGE_GEN_EXTRA_PARAMS = ["size", "output_format", "watermark"] as const;
export type ImageGenExtraParam = (typeof IMAGE_GEN_EXTRA_PARAMS)[number];

export const IMAGE_GEN_API_STYLES = ["openai", "siliconflow"] as const;
export type ImageGenApiStyle = (typeof IMAGE_GEN_API_STYLES)[number];

export const IMAGE_GEN_REFERENCE_MODES = ["none", "edits", "image-field"] as const;
export type ImageGenReferenceMode = (typeof IMAGE_GEN_REFERENCE_MODES)[number];

export type ImageGenProviderExtraParams = {
	size: boolean;
	output_format: boolean;
	watermark: boolean;
};

export const DEFAULT_IMAGE_GEN_EXTRA_PARAMS: ImageGenProviderExtraParams = {
	size: false,
	output_format: false,
	watermark: false,
};

export type ImageGenProviderConfig = {
	id: string;
	name: string;
	baseUrl: string;
	apiKey: string;

	models: string[];

	extraParams: ImageGenProviderExtraParams;

	referenceMode?: ImageGenReferenceMode;

	apiStyle?: ImageGenApiStyle;
};

export type ImageGenConfigFile = {
	providers: ImageGenProviderConfig[];

	activeProviderId: string;

	activeModel: string;
};

export const EMPTY_IMAGE_GEN_CONFIG: ImageGenConfigFile = {
	providers: [],
	activeProviderId: "",
	activeModel: "",
};

const MAX_NAME = 64;
const MAX_URL = 512;
const MAX_KEY = 512;
const MAX_MODEL_ID = 128;
const MAX_MODELS = 80;
const MAX_PROVIDERS = 20;
const ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,63}$/;

function sanitizeId(value: unknown, fallback: string): string {
	if (typeof value === "string" && ID_RE.test(value.trim())) return value.trim();
	return fallback;
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

export function sanitizeImageGenReferenceMode(value: unknown): ImageGenReferenceMode | undefined {
	if (typeof value !== "string") return undefined;
	return (IMAGE_GEN_REFERENCE_MODES as readonly string[]).includes(value) ? (value as ImageGenReferenceMode) : undefined;
}

export function sanitizeImageGenApiStyle(value: unknown): ImageGenApiStyle | undefined {
	if (typeof value !== "string") return undefined;
	return (IMAGE_GEN_API_STYLES as readonly string[]).includes(value) ? (value as ImageGenApiStyle) : undefined;
}

export function sanitizeImageGenExtraParams(value: unknown, legacyKind?: unknown): ImageGenProviderExtraParams {
	if (value && typeof value === "object" && !Array.isArray(value)) {
		const raw = value as Record<string, unknown>;
		return {
			size: raw.size === true,
			output_format: raw.output_format === true,
			watermark: raw.watermark === true,
		};
	}
	if (legacyKind === "ark") {
		return { size: true, output_format: true, watermark: true };
	}
	return { ...DEFAULT_IMAGE_GEN_EXTRA_PARAMS };
}

export function sanitizeImageGenConfig(input: unknown): ImageGenConfigFile {
	if (typeof input !== "object" || input === null || Array.isArray(input)) {
		return { ...EMPTY_IMAGE_GEN_CONFIG };
	}
	const raw = input as Record<string, unknown>;
	const providersIn = Array.isArray(raw.providers) ? raw.providers : [];
	const providers: ImageGenProviderConfig[] = [];
	const seenIds = new Set<string>();
	for (let index = 0; index < providersIn.length && providers.length < MAX_PROVIDERS; index += 1) {
		const item = providersIn[index];
		if (typeof item !== "object" || item === null || Array.isArray(item)) continue;
		const row = item as Record<string, unknown>;
		const fallbackId = `ig-${index + 1}`;
		const id = sanitizeId(row.id, fallbackId);
		if (seenIds.has(id)) continue;
		seenIds.add(id);
		const name = typeof row.name === "string" && row.name.trim() ? row.name.trim().slice(0, MAX_NAME) : "Image";
		const baseUrl = typeof row.baseUrl === "string" && /^https?:\/\/[^\s]+$/i.test(row.baseUrl.trim()) ? row.baseUrl.trim().replace(/\/+$/, "").slice(0, MAX_URL) : "";
		const apiKey = typeof row.apiKey === "string" ? row.apiKey.trim().slice(0, MAX_KEY) : "";
		providers.push({
			id,
			name,
			baseUrl,
			apiKey,
			models: uniqueModels(row.models),
			extraParams: sanitizeImageGenExtraParams(row.extraParams, row.kind),

			referenceMode: sanitizeImageGenReferenceMode(row.referenceMode),

			apiStyle: sanitizeImageGenApiStyle(row.apiStyle),
		});
	}
	const requestedProvider = typeof raw.activeProviderId === "string" ? raw.activeProviderId.trim() : "";

	const activeProvider = requestedProvider ? providers.find((provider) => provider.id === requestedProvider) : undefined;
	const requestedModel = typeof raw.activeModel === "string" ? raw.activeModel.trim().slice(0, MAX_MODEL_ID) : "";
	const activeModel = activeProvider?.models.includes(requestedModel) ? requestedModel : "";
	return {
		providers,
		activeProviderId: activeProvider?.id ?? "",
		activeModel,
	};
}

export function findImageGenProvider(config: ImageGenConfigFile, providerId: string): ImageGenProviderConfig | undefined {
	return config.providers.find((provider) => provider.id === providerId);
}

const IMAGE_GEN_SELECTION_SEP = "\u001f";

export function encodeImageGenSelection(providerId: string, modelId: string): string {
	return `${providerId}${IMAGE_GEN_SELECTION_SEP}${modelId}`;
}

export function decodeImageGenSelection(value: string): { providerId: string; modelId: string } | null {
	const index = value.indexOf(IMAGE_GEN_SELECTION_SEP);
	if (index <= 0) return null;
	const providerId = value.slice(0, index);
	const modelId = value.slice(index + 1);
	if (!providerId || !modelId) return null;
	return { providerId, modelId };
}
