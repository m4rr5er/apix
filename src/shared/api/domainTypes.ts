export type DomainGroup = "core" | "workspace" | "content" | "config" | "integration" | "shell";

export type DomainAggregation = "aggregate" | "consolidate" | "redline";

export type DomainApiVersion = "proposed" | "stable";

export interface DomainCatalogEntry {
	readonly id: string;
	readonly group: DomainGroup;

	readonly subdomains?: readonly string[];

	readonly manager: string;

	readonly ipcFile: readonly string[];

	readonly preloadNamespaces: readonly string[];

	readonly channelPrefix: readonly string[];
	readonly aggregation: DomainAggregation;
	readonly apiVersion?: DomainApiVersion;
}

export type ImporterCapability = "scan" | "import" | "describe" | "listSources";

export interface ImporterCatalogEntry {
	readonly id: string;
	readonly manager: string;
	readonly ipcFile: readonly string[];
	readonly preloadNamespaces: readonly string[];
	readonly channelPrefix: readonly string[];
	readonly capabilities: readonly ImporterCapability[];
}

export const PIDECK_API_ERROR_CODES = {
	duplicateDomain: "PIDECK_API_DUPLICATE_DOMAIN",
	registryFrozen: "PIDECK_API_REGISTRY_FROZEN",
	invalidDomainEntry: "PIDECK_API_INVALID_DOMAIN_ENTRY",
} as const;

export type PiDeckApiErrorCode = (typeof PIDECK_API_ERROR_CODES)[keyof typeof PIDECK_API_ERROR_CODES];

export interface PiDeckApiRegistryErrorData {
	readonly code: PiDeckApiErrorCode;
	readonly domain?: string;
	readonly reason: string;
}

export type SessionSubdomainId = "catalog" | "runtime" | "rewind";

export type ConfigSubstoreId = "models" | "auth" | "settings" | "mcp" | "trust" | "tokendance" | "usageProbes" | "resources" | "vision" | "maintenance";

export type DomainFacadeHandle = Readonly<Record<string, unknown>>;

export type DomainFacadeFactory = () => DomainFacadeHandle;

export interface DomainRegistrationEntry {
	readonly id: string;
	readonly group: DomainGroup;
	readonly aggregation: DomainAggregation;
	readonly manager: string;
	readonly factory: DomainFacadeFactory;
}

export interface ResolvedDomain {
	readonly id: string;
	readonly group: DomainGroup;
	readonly aggregation: DomainAggregation;
	readonly manager: string;

	readonly methodGroups?: Readonly<Record<string, readonly string[]>>;
}

export type MethodGroupsDescriptor = Readonly<Record<string, readonly string[]>>;
