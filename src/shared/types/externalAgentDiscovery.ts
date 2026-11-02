export type ExternalAgentKind = "claude-code" | "codex" | "opencode" | "gemini-cli" | "qwen-code" | "crush" | "goose" | "kimi-code" | "kilo-code" | "minimax-code" | "zcode" | "qoder-cn" | "openclaw";

export type ExternalAgentProviderFound = {
	id: string;
	agent: ExternalAgentKind;

	providerName: string;

	apiType: string;
	baseUrl?: string;

	apiKeyMasked?: string;

	modelIds: string[];

	note?: string;
};

export type ExternalAgentDiscoveryResult = {
	sources: Array<{ agent: ExternalAgentKind; found: boolean; error?: string }>;
	providers: ExternalAgentProviderFound[];
};
