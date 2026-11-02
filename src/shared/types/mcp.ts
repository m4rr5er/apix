export type McpServerTransport = "stdio" | "http";

export type McpExposure = "codemode" | "codemode-deferred" | "deferred" | "direct" | "hidden";

export type McpOAuth = {
	clientId?: string;

	clientSecret?: string;

	callbackPort?: number;

	callbackUrl?: string;

	scope?: string;

	clientName?: string;

	authServerMetadataUrl?: string;

	clientRegistration?: "dcr" | "cimd";
	[key: string]: unknown;
};

export type McpServerDefinition = {
	exposure?: McpExposure;

	toolExposure?: Record<string, McpExposure>;

	enabled?: boolean;

	timeout?: number;

	description?: string;

	command?: string;
	args?: string[];
	env?: Record<string, string>;
	cwd?: string;
	url?: string;
	headers?: Record<string, string>;
	oauth?: McpOAuth;

	auth?: { provider?: string; [key: string]: unknown };
	[key: string]: unknown;
};

export type McpConfigFile = {
	mcpServers?: Record<string, McpServerDefinition>;

	autoEnableCodemode?: boolean;
	[key: string]: unknown;
};

export type McpConfigLayerKind = "pi-agent" | "project-pi";

export type McpConfigScope = { scope: "global" } | { scope: "project"; projectId: string };

export type McpConfigLayer = {
	kind: McpConfigLayerKind;
	path: string;
	exists: boolean;
	writable: boolean;
};

export function mcpNamespaceKey(name: string): string {
	return name.replace(/-/g, "_");
}

export type McpServerListItem = {
	name: string;
	definition: McpServerDefinition;

	originPath: string;

	originScope: McpConfigLayerKind;

	ownedByWritable: boolean;

	pendingDelete?: boolean;

	revertsToInherited?: boolean;
};

export type McpConfigSnapshot = {
	writablePath: string;
	writableFile: McpConfigFile;

	writableRaw: string;

	writableError?: string;

	revision: string;
	layers: McpConfigLayer[];
	servers: McpServerListItem[];

	invalidServers: Array<{ name: string; path: string; error: string; raw: unknown }>;

	lowerLayerNames: string[];

	oauthCredentialNames: string[];
};

export type McpProbeOk = {
	ok: true;
	transport: McpServerTransport;
	detail: string;
};

export type McpProbeFail = {
	ok: false;
	transport?: McpServerTransport;
	error: string;
};

export type McpProbeResult = McpProbeOk | McpProbeFail;

export type McpCliServerReport = {
	name: string;
	scope: string;
	source: string;
	enabled: boolean;
	exposure: string;
	transport: string;

	state: string;
	tools: string[];
	toolExposure?: Record<string, string>;

	resources?: number | boolean;

	resourceTemplates?: number;
	error?: string;
};

export type McpCliListResult = {
	servers: McpCliServerReport[];

	errors: string[];

	note?: string;
};
