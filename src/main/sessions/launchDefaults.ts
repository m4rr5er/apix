import type { ResolveLaunchDefaultsInput, ResolvedLaunchDefaults } from "../../shared/types";
import { createSessionModelPreference } from "../../shared/modelDisplayName";
import { modelThinkingLevelOf, parseModelThinkingLevels } from "../../shared/modelThinkingLevels";

export function resolveLaunchDefaultOptions(input: {
	backend?: ResolveLaunchDefaultsInput["backend"];
	settings: unknown;
	models: unknown;

	catalogModels?: unknown;

	lastUsedModel?: unknown;

	welcomeModel?: unknown;
}): ResolvedLaunchDefaults {
	const defaults: ResolvedLaunchDefaults = {};
	{
		const explicit = strictModelPair(input.settings, input.models, input.catalogModels);
		if (explicit) defaults.defaultModelConfigured = true;

		const model = welcomeModelOfModelsConfig(input.welcomeModel, input.models, input.catalogModels) ?? explicit ?? enabledModelsOfModelsConfig(input.settings, input.models, input.catalogModels) ?? lastUsedModelOfModelsConfig(input.lastUsedModel, input.models, input.catalogModels);
		if (model) defaults.model = model;

		const modelThinkingLevels = parseModelThinkingLevels(input.settings);
		if (modelThinkingLevels) defaults.modelThinkingLevels = modelThinkingLevels;
	}

	const thinkingLevel = (defaults.model ? modelThinkingLevelOf(input.settings, defaults.model.provider, defaults.model.modelId) : undefined) ?? optionalString(input.settings, "defaultThinkingLevel");
	if (thinkingLevel) defaults.thinkingLevel = thinkingLevel;
	return defaults;
}

function strictModelPair(settings: unknown, models: unknown, catalogModels?: unknown): ResolvedLaunchDefaults["model"] {
	const provider = optionalString(settings, "defaultProvider");
	const modelId = optionalString(settings, "defaultModel");
	if (!provider || !modelId) return undefined;
	return modelPreferenceFromSources(models, catalogModels, provider, modelId);
}

export function isModelInModelsConfig(models: unknown, model: { provider: string; modelId: string }, catalogModels?: unknown): boolean {
	return modelPreferenceFromSources(models, catalogModels, model.provider, model.modelId) !== undefined;
}

function lastUsedModelOfModelsConfig(lastUsed: unknown, models: unknown, catalogModels?: unknown): ResolvedLaunchDefaults["model"] {
	if (!isRecord(lastUsed)) return undefined;
	const provider = lastUsed.provider;
	const modelId = lastUsed.modelId;
	if (typeof provider !== "string" || typeof modelId !== "string") return undefined;
	if (!provider || !modelId) return undefined;
	return modelPreferenceFromSources(models, catalogModels, provider, modelId);
}

function modelPreferenceFromSources(models: unknown, catalogModels: unknown, provider: string, modelId: string): ResolvedLaunchDefaults["model"] {
	return modelPreferenceFromModelsConfig(models, provider, modelId) ?? modelPreferenceFromCatalogList(catalogModels, provider, modelId);
}

function modelPreferenceFromCatalogList(catalogModels: unknown, provider: string, modelId: string): ResolvedLaunchDefaults["model"] {
	if (!Array.isArray(catalogModels)) return undefined;
	for (const entry of catalogModels) {
		if (!isRecord(entry)) continue;
		if (entry.provider !== provider || entry.id !== modelId) continue;
		return createSessionModelPreference(provider, modelId, typeof entry.name === "string" ? entry.name : undefined);
	}
	return undefined;
}

function modelPreferenceFromModelsConfig(models: unknown, provider: string, modelId: string): ResolvedLaunchDefaults["model"] {
	if (!isRecord(models)) return undefined;
	const providers = models.providers;
	if (!isRecord(providers)) return undefined;
	const providerEntry = providers[provider];
	if (!isRecord(providerEntry) || !Array.isArray(providerEntry.models)) return undefined;
	const model = providerEntry.models.find((candidate) => isRecord(candidate) && candidate.id === modelId);
	if (!isRecord(model)) return undefined;
	return createSessionModelPreference(provider, modelId, model.name);
}

function modelExistsInModelsConfig(models: unknown, provider: string, modelId: string): boolean {
	if (!isRecord(models)) return false;
	const providers = models.providers;
	if (!isRecord(providers)) return false;
	const providerEntry = providers[provider];
	if (!isRecord(providerEntry) || !Array.isArray(providerEntry.models)) return false;
	return providerEntry.models.some((model) => isRecord(model) && model.id === modelId);
}

function welcomeModelOfModelsConfig(welcome: unknown, models: unknown, catalogModels?: unknown): ResolvedLaunchDefaults["model"] {
	if (!isRecord(welcome)) return undefined;
	const provider = welcome.provider;
	const modelId = welcome.modelId;
	if (typeof provider !== "string" || typeof modelId !== "string") return undefined;
	if (!provider || !modelId) return undefined;
	if (!modelExistsInModelsConfig(models, provider, modelId) && !modelPreferenceFromCatalogList(catalogModels, provider, modelId)) return undefined;

	return createSessionModelPreference(provider, modelId, welcome.modelName);
}

function enabledModelsOfModelsConfig(settings: unknown, models: unknown, catalogModels?: unknown): ResolvedLaunchDefaults["model"] {
	if (!isRecord(settings)) return undefined;
	const enabled = settings.enabledModels;
	if (!Array.isArray(enabled)) return undefined;
	for (const pattern of enabled) {
		if (typeof pattern !== "string" || !pattern) continue;
		const matched = matchEnabledModelPattern(pattern, models, catalogModels);
		if (matched) return matched;
	}
	return undefined;
}

function matchEnabledModelPattern(pattern: string, models: unknown, catalogModels?: unknown): ResolvedLaunchDefaults["model"] {
	const [patternProvider, patternModelId] = pattern.includes("/") ? pattern.split("/") : [undefined, pattern];
	const localMatch = matchEnabledModelPatternInModelsConfig(patternProvider, patternModelId, models);
	if (localMatch) return localMatch;
	if (!Array.isArray(catalogModels)) return undefined;
	for (const entry of catalogModels) {
		if (!isRecord(entry)) continue;
		const { provider: entryProvider, id: entryId } = entry;
		if (typeof entryProvider !== "string" || typeof entryId !== "string" || !entryProvider || !entryId) continue;
		if (patternProvider && !globMatch(patternProvider, entryProvider)) continue;
		if (globMatch(patternModelId, entryId)) {
			return createSessionModelPreference(entryProvider, entryId, typeof entry.name === "string" ? entry.name : undefined);
		}
	}
	return undefined;
}

function matchEnabledModelPatternInModelsConfig(patternProvider: string | undefined, patternModelId: string, models: unknown): ResolvedLaunchDefaults["model"] {
	if (!isRecord(models)) return undefined;
	const providers = models.providers;
	if (!isRecord(providers)) return undefined;
	for (const [providerName, provider] of Object.entries(providers)) {
		if (patternProvider && !globMatch(patternProvider, providerName)) continue;
		if (!isRecord(provider) || !Array.isArray(provider.models)) continue;
		for (const model of provider.models) {
			if (!isRecord(model) || typeof model.id !== "string") continue;
			if (globMatch(patternModelId, model.id)) {
				return createSessionModelPreference(providerName, model.id, model.name);
			}
		}
	}
	return undefined;
}

function globMatch(pattern: string, value: string): boolean {
	let regex = "^";
	for (const char of pattern) {
		if (char === "*") regex += "[^/]*";
		else if (char === "?") regex += "[^/]";
		else regex += char.replace(/[.+^${}()[\]\\|]/g, "\\$&");
	}
	regex += "$";
	return new RegExp(regex).test(value);
}

function optionalString(source: unknown, key: string): string | undefined {
	if (!isRecord(source)) return undefined;
	const value = source[key];
	return typeof value === "string" ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
