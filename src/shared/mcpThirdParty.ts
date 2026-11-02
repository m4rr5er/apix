export type ThirdPartyMcpExtensionInput = {
	source?: string;
	id?: string;
	scope?: string;
	enabled?: boolean;
	builtIn?: boolean;
};

export const MCP_PROXY_EXTENSION_RULES: Array<{ id: string; matchSource: RegExp }> = [{ id: "pi-mcp-adapter", matchSource: /pi-mcp-adapter/i }];

export type ThirdPartyMcpExtension = {
	source: string;
	scope: string;
	enabled: boolean;

	uninstallCommand: string;
	isLocalFile: boolean;
};

export function detectThirdPartyMcpExtensions(extensions: readonly ThirdPartyMcpExtensionInput[]): ThirdPartyMcpExtension[] {
	const hits: ThirdPartyMcpExtension[] = [];
	for (const ext of extensions) {
		if (ext.builtIn) continue;
		const source = ext.source ?? "";
		if (!source) continue;
		const matched = MCP_PROXY_EXTENSION_RULES.some((rule) => (ext.id ? rule.id === ext.id : false) || rule.matchSource.test(source));
		if (!matched) continue;
		const isLocalFile = !/^(?:npm|file|github|git|https?):/i.test(source);
		hits.push({
			source,
			scope: ext.scope ?? "unknown",
			enabled: ext.enabled !== false,
			isLocalFile,
			uninstallCommand: isLocalFile ? "" : `pi remove ${source}${ext.scope === "project" ? " -l" : ""}`,
		});
	}
	return hits;
}
