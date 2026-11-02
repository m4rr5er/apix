import type { PiAiCatalogEntry } from "../pi/piAiBuiltinCatalog";
import type { PiAuthItem, PiModelItem, PiProviderConfig } from "./ConfigManager";

export type PiProviderSnapshot = {
	name: string;
	baseUrl?: string;
	api?: string;
	apiKey?: string;
	headers?: Record<string, string>;
	compat?: Record<string, unknown>;
	models: PiModelItem[];
	catalogOnly?: boolean;
};

export type PiBuiltinCatalogView = {
	byProviderId: Map<string, Map<string, PiAiCatalogEntry>>;
};

export function isSafeProviderName(name: unknown): name is string {
	return typeof name === "string" && name.trim().length > 0 && name.trim().length <= 80 && !/[\/]/.test(name) && !name.includes("..");
}

export function resolvePiApiKey(provider: PiProviderConfig | undefined, auth: PiAuthItem | undefined): string | undefined {
	const inline = typeof provider?.apiKey === "string" ? provider.apiKey.trim() : "";
	if (inline) return inline;
	const fromAuth = typeof auth?.key === "string" ? auth.key.trim() : "";
	if (fromAuth) return fromAuth;
	if (auth && typeof auth === "object" && auth.type === "oauth") {
		const access = typeof auth.access === "string" ? auth.access.trim() : "";
		if (access) return access;
	}
	return undefined;
}

export function piBuiltinSnapshotFromCatalog(name: string, apiKey: string | undefined, catalog: PiBuiltinCatalogView): PiProviderSnapshot | undefined {
	const inner = catalog.byProviderId.get(name);
	if (!inner || inner.size === 0) return undefined;
	const entries = [...inner.values()];
	const first = entries[0];
	if (!first) return undefined;
	const models: PiModelItem[] = [];
	for (const entry of entries) {
		const row: PiModelItem = { id: entry.id.trim() };
		if (typeof entry.name === "string" && entry.name.trim()) row.name = entry.name.trim();
		if (entry.contextWindow != null) row.contextWindow = entry.contextWindow;
		if (entry.maxTokens != null) row.maxTokens = entry.maxTokens;
		if (entry.reasoning === true) row.reasoning = true;
		if (entry.input && entry.input.length > 0) row.input = entry.input;
		models.push(row);
	}
	return {
		name: name.trim(),
		baseUrl: typeof first.baseUrl === "string" ? first.baseUrl.trim() : undefined,
		api: typeof first.api === "string" ? first.api.trim() : "openai-completions",
		apiKey: apiKey?.trim() || undefined,
		models,
		catalogOnly: true,
	};
}

function asCompatRecord(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) return {};
	return { ...(value as Record<string, unknown>) };
}

export function mergePiProvider(models: { providers: Record<string, PiProviderConfig> }, auth: Record<string, PiAuthItem>, snapshot: PiProviderSnapshot): { models: { providers: Record<string, PiProviderConfig> }; auth: Record<string, PiAuthItem> } {
	const existing = models.providers[snapshot.name];
	const mergedCompat = snapshot.compat ? { ...asCompatRecord(existing?.compat), ...snapshot.compat } : undefined;
	const nextModels = {
		providers: {
			...models.providers,
			[snapshot.name]: {
				...(existing ?? { models: [] }),
				baseUrl: snapshot.baseUrl,
				api: snapshot.api,
				models: snapshot.models,
				...(snapshot.headers ? { headers: snapshot.headers } : {}),
				...(mergedCompat ? { compat: mergedCompat } : {}),
			},
		},
	};
	if (snapshot.apiKey) {
		nextModels.providers[snapshot.name] = {
			...nextModels.providers[snapshot.name],
			apiKey: snapshot.apiKey,
		};
	}
	return { models: nextModels, auth: { ...auth } };
}
