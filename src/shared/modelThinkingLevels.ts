import type { ProviderModelIdIndex, ThinkingLevelMap } from "./types/modelSpecs";

export const MODEL_THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;

export type ModelThinkingLevel = (typeof MODEL_THINKING_LEVELS)[number];

const EXPLICIT_MAPPING_LEVELS: readonly ModelThinkingLevel[] = ["xhigh", "max"];

export function modelThinkingLevelsKey(provider: string, modelId: string): string {
	return `${provider}/${modelId}`;
}

export function orderModelThinkingLevels(levels: readonly string[]): string[] {
	const known: string[] = MODEL_THINKING_LEVELS.filter((level) => levels.includes(level));
	const extra = levels.filter((level) => !(MODEL_THINKING_LEVELS as readonly string[]).includes(level));
	return [...known, ...extra];
}

export function parseModelThinkingLevels(settings: unknown): Record<string, string> | undefined {
	if (!isRecord(settings)) return undefined;
	const raw = settings.modelThinkingLevels;
	if (!isRecord(raw)) return undefined;
	const levels: Record<string, string> = {};
	for (const [key, value] of Object.entries(raw)) {
		if (key && typeof value === "string" && value.trim()) levels[key] = value.trim();
	}
	return Object.keys(levels).length > 0 ? levels : undefined;
}

export function modelThinkingLevelOfMap(map: unknown, provider: string | undefined, modelId: string | undefined): string | undefined {
	if (!provider || !modelId) return undefined;
	if (!isRecord(map)) return undefined;
	const value = map[modelThinkingLevelsKey(provider, modelId)];
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function modelThinkingLevelOf(settings: unknown, provider: string | undefined, modelId: string | undefined): string | undefined {
	return modelThinkingLevelOfMap(isRecord(settings) ? settings.modelThinkingLevels : undefined, provider, modelId);
}

export function replaceModelThinkingLevels(settings: Record<string, unknown>, savedProvider: string, finalProvider: string, defaults: Record<string, string>): Record<string, unknown> {
	const table = parseModelThinkingLevels(settings) ?? {};
	const savedPrefix = savedProvider ? `${savedProvider}/` : "";
	const next: Record<string, string> = {};
	for (const [key, level] of Object.entries(table)) {
		if (savedProvider && key.startsWith(savedPrefix)) continue;
		next[key] = level;
	}
	if (finalProvider) {
		for (const [modelId, level] of Object.entries(defaults)) {
			const trimmed = typeof level === "string" ? level.trim() : "";
			if (modelId && trimmed) next[modelThinkingLevelsKey(finalProvider, modelId)] = trimmed;
		}
	}
	if (sameTable(table, next)) return settings;
	const updated: Record<string, unknown> = { ...settings };
	if (Object.keys(next).length > 0) updated.modelThinkingLevels = next;
	else delete updated.modelThinkingLevels;
	return updated;
}

export function pruneModelThinkingLevelOrphans(settings: Record<string, unknown>, modelIdsByProvider: ProviderModelIdIndex): Record<string, unknown> {
	const table = parseModelThinkingLevels(settings);
	if (!table) return settings;
	const next: Record<string, string> = {};
	let dropped = false;
	for (const [key, level] of Object.entries(table)) {
		const slash = key.indexOf("/");
		const modelId = slash > 0 ? key.slice(slash + 1) : "";
		const known = slash > 0 ? modelIdsByProvider.get(key.slice(0, slash)) : undefined;
		if (known && !known.has(modelId)) {
			dropped = true;
			continue;
		}
		next[key] = level;
	}
	if (!dropped) return settings;
	const updated: Record<string, unknown> = { ...settings };
	if (Object.keys(next).length > 0) updated.modelThinkingLevels = next;
	else delete updated.modelThinkingLevels;
	return updated;
}

function sameTable(left: Record<string, string>, right: Record<string, string>): boolean {
	const keys = Object.keys(left);
	if (keys.length !== Object.keys(right).length) return false;
	return keys.every((key) => right[key] === left[key]);
}

export function withModelThinkingLevelDefault(settings: Record<string, unknown>, provider: string, modelId: string, level: string | undefined): Record<string, unknown> {
	const current = isRecord(settings.modelThinkingLevels) ? settings.modelThinkingLevels : {};
	const next = { ...current };
	const trimmed = typeof level === "string" ? level.trim() : "";
	if (trimmed) next[modelThinkingLevelsKey(provider, modelId)] = trimmed;
	else delete next[modelThinkingLevelsKey(provider, modelId)];
	const updated: Record<string, unknown> = { ...settings };
	if (Object.keys(next).length > 0) updated.modelThinkingLevels = next;
	else delete updated.modelThinkingLevels;
	return updated;
}

export type ModelThinkingLevelState = {
	enabled: boolean;
	wireValue: string;
};

export function modelThinkingLevelState(model: { reasoning?: boolean; thinkingLevelMap?: ThinkingLevelMap }, level: ModelThinkingLevel): ModelThinkingLevelState {
	const mapped = model.thinkingLevelMap?.[level];
	if (mapped === null) return { enabled: false, wireValue: "" };
	if (typeof mapped === "string") return { enabled: true, wireValue: mapped === level ? "" : mapped };

	if (EXPLICIT_MAPPING_LEVELS.includes(level)) return { enabled: false, wireValue: "" };
	return { enabled: model.reasoning === true || level === "off", wireValue: "" };
}

export function enabledModelThinkingLevels(model: { reasoning?: boolean; thinkingLevelMap?: ThinkingLevelMap }): ModelThinkingLevel[] {
	return MODEL_THINKING_LEVELS.filter((level) => modelThinkingLevelState(model, level).enabled);
}

export function withModelThinkingLevelEnabled(map: ThinkingLevelMap | undefined, level: ModelThinkingLevel, enabled: boolean): ThinkingLevelMap | undefined {
	const next: ThinkingLevelMap = { ...(map ?? {}) };
	const explicitMapping = EXPLICIT_MAPPING_LEVELS.includes(level);
	if (enabled) {
		if (typeof next[level] !== "string") {
			if (explicitMapping) next[level] = level;
			else delete next[level];
		}
	} else if (explicitMapping) {
		delete next[level];
	} else {
		next[level] = null;
	}
	return Object.keys(next).length > 0 ? next : undefined;
}

export function formatModelThinkingLevelsSummary(levels: readonly string[]): string {
	const canonical: readonly string[] = MODEL_THINKING_LEVELS;
	const positions = levels.map((level) => canonical.indexOf(level));
	const ordered = positions.every((position, index) => position >= 0 && (index === 0 || position > positions[index - 1]));
	if (!ordered) return levels.join(", ");
	if (levels.length <= 1) return levels[0] ?? "";

	const contiguous = positions[positions.length - 1] - positions[0] === levels.length - 1;

	return contiguous ? `${levels[0]} → ${levels[levels.length - 1]}` : `${levels[0]}…${levels[levels.length - 1]}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
