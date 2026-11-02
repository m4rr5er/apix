import type { SessionModelPreference } from "./types/session";

export function resolveModelDisplayName(name: unknown, modelId: string): string {
	return typeof name === "string" && name.trim() ? name.trim() : modelId;
}

export type NormalizedSessionModelPreference = SessionModelPreference & {
	modelName: string;
};

export function createSessionModelPreference(provider: string, modelId: string, modelName: unknown): NormalizedSessionModelPreference {
	return {
		provider,
		modelId,
		modelName: resolveModelDisplayName(modelName, modelId),
	};
}
