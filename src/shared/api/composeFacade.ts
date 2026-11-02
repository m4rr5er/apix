import { CONFIG_SUBSTORES, SESSIONS_SUBDOMAINS } from "./consolidations";
import { DOMAIN_CATALOG } from "./domainCatalog";
import type { UnifiedApiView } from "./facadeTypes";
import { IMPORTER_CATALOG, IMPORTER_FACADE_METHODS, IMPORTER_NAMESPACES } from "./importerCatalog";

export type UnifiedApiSource = Record<string, unknown>;

type SourceNamespace<TSource extends UnifiedApiSource, TKey extends string> = TSource extends {
	[K in TKey]: infer TNamespace;
}
	? TNamespace extends object
		? TNamespace
		: undefined
	: undefined;

type CatalogPassthroughNamespace = Exclude<Extract<(typeof DOMAIN_CATALOG)[number], { aggregation: "aggregate" | "redline" }>["preloadNamespaces"][number], keyof UnifiedApiView<UnifiedApiSource> | "sessions" | "config">;

export type ComposedUnifiedApi<TSource extends UnifiedApiSource> = UnifiedApiView<TSource> & {
	readonly [TNamespace in CatalogPassthroughNamespace]: SourceNamespace<TSource, TNamespace>;
};

function isNamespaceRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function pickPresentMethods(namespace: Record<string, unknown> | undefined, methods: readonly string[]): Record<string, unknown> {
	const picked: Record<string, unknown> = {};
	if (namespace === undefined) return picked;
	for (const method of methods) {
		if (method in namespace) picked[method] = namespace[method];
	}
	return picked;
}

function consolidateGroups(source: UnifiedApiSource, namespaceKey: string, groups: Readonly<Record<string, readonly string[]>>): Record<string, Record<string, unknown>> {
	const rawNamespace: unknown = source[namespaceKey];
	const namespace = isNamespaceRecord(rawNamespace) ? rawNamespace : undefined;
	const view: Record<string, Record<string, unknown>> = {};
	for (const groupId of Object.keys(groups)) {
		view[groupId] = pickPresentMethods(namespace, groups[groupId]);
	}
	return view;
}

function consolidateImporters(source: UnifiedApiSource): Record<string, Record<string, unknown>> {
	const view: Record<string, Record<string, unknown>> = {};
	for (const row of IMPORTER_CATALOG) {
		const rawNamespace: unknown = source[IMPORTER_NAMESPACES[row.id]];
		view[row.id] = pickPresentMethods(isNamespaceRecord(rawNamespace) ? rawNamespace : undefined, IMPORTER_FACADE_METHODS[row.id]);
	}
	return view;
}

export function composeUnifiedApi<TSource extends UnifiedApiSource>(source: TSource): ComposedUnifiedApi<TSource> {
	const api: Record<string, unknown> = {};
	for (const row of DOMAIN_CATALOG) {
		if (row.aggregation === "consolidate") continue;
		for (const namespace of row.preloadNamespaces) {
			api[namespace] = source[namespace];
		}
	}
	api.web = source.settings;
	api.sessions = consolidateGroups(source, "sessions", SESSIONS_SUBDOMAINS);
	api.config = consolidateGroups(source, "config", CONFIG_SUBSTORES);
	api.importers = consolidateImporters(source);
	return api as ComposedUnifiedApi<TSource>;
}
