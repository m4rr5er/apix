import type { McpServerDefinition } from "./types/mcp";

export function resolveExposureAlias(value: unknown): unknown {
	return value === "codemode-deferred" ? "codemode" : value;
}

export function resolveExposureAliases(def: McpServerDefinition): McpServerDefinition {
	const resolved: McpServerDefinition = { ...def };
	if (def.exposure !== undefined) resolved.exposure = resolveExposureAlias(def.exposure) as McpServerDefinition["exposure"];
	if (def.toolExposure && isRecord(def.toolExposure)) {
		resolved.toolExposure = Object.fromEntries(Object.entries(def.toolExposure).map(([tool, exposure]) => [tool, resolveExposureAlias(exposure)])) as McpServerDefinition["toolExposure"];
	}
	return resolved;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
