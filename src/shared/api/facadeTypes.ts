import type { CONFIG_SUBSTORES, SESSIONS_SUBDOMAINS } from "./consolidations";
import type { IMPORTER_FACADE_METHODS, IMPORTER_NAMESPACES } from "./importerCatalog";

type SubPick<TSource, TMethods extends readonly string[]> = TSource extends object ? Pick<TSource, Extract<TMethods[number], keyof TSource>> : Record<string, never>;

type NamespaceOf<TSource, TKey extends string> = TSource extends { [K in TKey]: infer TNamespace } ? (TNamespace extends object ? TNamespace : undefined) : undefined;

export type SessionsDomainView<TSessions> = {
	catalog: SubPick<TSessions, typeof SESSIONS_SUBDOMAINS.catalog>;
	runtime: SubPick<TSessions, typeof SESSIONS_SUBDOMAINS.runtime>;
	rewind: SubPick<TSessions, typeof SESSIONS_SUBDOMAINS.rewind>;
};

export type ConfigDomainView<TConfig> = {
	models: SubPick<TConfig, typeof CONFIG_SUBSTORES.models>;
	auth: SubPick<TConfig, typeof CONFIG_SUBSTORES.auth>;
	settings: SubPick<TConfig, typeof CONFIG_SUBSTORES.settings>;
	mcp: SubPick<TConfig, typeof CONFIG_SUBSTORES.mcp>;
	trust: SubPick<TConfig, typeof CONFIG_SUBSTORES.trust>;
	tokendance: SubPick<TConfig, typeof CONFIG_SUBSTORES.tokendance>;
	usageProbes: SubPick<TConfig, typeof CONFIG_SUBSTORES.usageProbes>;
	resources: SubPick<TConfig, typeof CONFIG_SUBSTORES.resources>;
	vision: SubPick<TConfig, typeof CONFIG_SUBSTORES.vision>;
	maintenance: SubPick<TConfig, typeof CONFIG_SUBSTORES.maintenance>;
};

export type ImporterViews<TSource> = {
	readonly [TImporter in keyof typeof IMPORTER_FACADE_METHODS]: SubPick<NamespaceOf<TSource, (typeof IMPORTER_NAMESPACES)[TImporter]>, (typeof IMPORTER_FACADE_METHODS)[TImporter]>;
};

export type UnifiedApiView<TSource> = {
	projects: NamespaceOf<TSource, "projects">;
	git: NamespaceOf<TSource, "git">;
	terminal: NamespaceOf<TSource, "terminal">;
	prompts: NamespaceOf<TSource, "prompts">;
	skills: NamespaceOf<TSource, "skills">;
	extensions: NamespaceOf<TSource, "extensions">;
	settings: NamespaceOf<TSource, "settings">;
	feishu: NamespaceOf<TSource, "feishu">;
	pet: NamespaceOf<TSource, "pet">;
	sounds: NamespaceOf<TSource, "sounds">;
	announcements: NamespaceOf<TSource, "announcements">;
	automation: NamespaceOf<TSource, "automation">;
	usageStats: NamespaceOf<TSource, "usageStats">;
	imagegen: NamespaceOf<TSource, "imagegen">;
	voiceTranscription: NamespaceOf<TSource, "voiceTranscription">;
	scratchPad: NamespaceOf<TSource, "scratchPad">;
	cua: NamespaceOf<TSource, "cua">;
	security: NamespaceOf<TSource, "security">;
	web: NamespaceOf<TSource, "settings">;
	dataEnv: NamespaceOf<TSource, "dataEnv">;
	sessions: SessionsDomainView<NamespaceOf<TSource, "sessions">>;
	config: ConfigDomainView<NamespaceOf<TSource, "config">>;
	importers: TSource extends object ? ImporterViews<TSource> : undefined;
};
