export type EnhanceModelSelection = { provider: string; modelId: string };

export type EnhanceModelSource = EnhanceModelSelection | undefined | null;

function isUsable(model: EnhanceModelSource): model is EnhanceModelSelection {
	return Boolean(model && typeof model.provider === "string" && model.provider.length > 0 && typeof model.modelId === "string" && model.modelId.length > 0);
}

export function resolveEnhanceTargetModel(input: {
	configured?: EnhanceModelSource;

	recordModel?: EnhanceModelSource;

	welcomeModel?: EnhanceModelSource;
	fallback?: EnhanceModelSource;
}): EnhanceModelSelection | null {
	for (const candidate of [input.configured, input.recordModel, input.welcomeModel, input.fallback]) {
		if (isUsable(candidate)) return { provider: candidate.provider, modelId: candidate.modelId };
	}
	return null;
}

export function normalizeEnhanceModel(value: unknown): EnhanceModelSelection | null {
	if (typeof value !== "object" || value === null) return null;
	const record = value as Record<string, unknown>;
	if (typeof record.provider !== "string" || typeof record.modelId !== "string") return null;
	const provider = record.provider.trim();
	const modelId = record.modelId.trim();
	if (!provider || !modelId) return null;
	return { provider: provider.slice(0, 200), modelId: modelId.slice(0, 200) };
}
