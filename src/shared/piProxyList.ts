export function hasPiProxyListFilter(piProxyProviders: ReadonlyArray<string> | undefined, piProxyModels: ReadonlyArray<string> | undefined): boolean {
	return (piProxyProviders?.length ?? 0) > 0 || (piProxyModels?.length ?? 0) > 0;
}

export type ConfiguredProviderSummary = { name: string; modelCount: number };

export function configuredProviderSummariesFromModelsConfig(modelsFile: unknown): ConfiguredProviderSummary[] {
	if (!modelsFile || typeof modelsFile !== "object" || Array.isArray(modelsFile)) return [];
	const providers = (modelsFile as { providers?: unknown }).providers;
	if (!providers || typeof providers !== "object" || Array.isArray(providers)) return [];
	const summaries: ConfiguredProviderSummary[] = [];
	for (const [name, config] of Object.entries(providers)) {
		if (!name) continue;
		const models = config && typeof config === "object" && !Array.isArray(config) ? (config as { models?: unknown }).models : undefined;
		summaries.push({ name, modelCount: Array.isArray(models) ? models.length : 0 });
	}
	return summaries.sort((a, b) => a.name.localeCompare(b.name));
}

export function splitUnlistedProviders(configured: ReadonlyArray<ConfiguredProviderSummary>, reported: ReadonlyArray<string>): { withModels: string[]; withoutModels: string[] } {
	const reportedSet = new Set(reported);
	const withModels: string[] = [];
	const withoutModels: string[] = [];
	for (const provider of configured) {
		if (!provider.name || reportedSet.has(provider.name)) continue;
		if (provider.modelCount > 0) withModels.push(provider.name);
		else withoutModels.push(provider.name);
	}
	const byName = (a: string, b: string) => a.localeCompare(b);
	return { withModels: withModels.sort(byName), withoutModels: withoutModels.sort(byName) };
}
