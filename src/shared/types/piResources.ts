export type PiResourceScope = { scope: "global" } | { scope: "project"; projectId: string };

export type PiResourceKind = "extensions" | "skills" | "prompts" | "themes";

export const PI_RESOURCE_KINDS: readonly PiResourceKind[] = ["extensions", "skills", "prompts", "themes"];

export const PI_BUILTIN_EXTENSIONS = ["mcp", "llama.cpp", "codemode", "tool-search"] as const;
export type PiBuiltinExtension = (typeof PI_BUILTIN_EXTENSIONS)[number];

export function builtinSpecifier(name: PiBuiltinExtension): string {
	return `builtin:${name}`;
}

export type PiResourceOverrideState = "inherit" | "explicit-enabled" | "explicit-disabled";

export type PiResourceEffectiveState = "enabled" | "disabled" | "unavailable";

export type PiBuiltinExtensionState = {
	name: PiBuiltinExtension;

	enabled: boolean;

	toolEnabled?: boolean;

	explicitInLayer: boolean;

	state: PiResourceOverrideState;
};

export type PiBuiltinToggleRequest = {
	scope: PiResourceScope;
	name: PiBuiltinExtension;
	enabled: boolean;
};

export type PiResourceToggleResult = {
	ok: boolean;
	error?: string;

	revision?: string;
};

export type PiFileResourceToggleRequest = {
	scope: PiResourceScope;
	kind: Exclude<PiResourceKind, "themes">;
	resourceId: string;
	enabled: boolean;
};

export type PiPackageToggleRequest = {
	scope: PiResourceScope;
	resourceId: string;
	enabled: boolean;
};

export type PiResourceOverrideRequest = {
	scope: { scope: "project"; projectId: string };
	kind: PiResourceKind;

	matchValue: string;
	state: PiResourceOverrideState;
};

export type PiResourceConfigSummary = {
	settingsPath: string;

	exists: boolean;

	error?: string;

	revision: string;
	builtins: PiBuiltinExtensionState[];

	entries: Record<PiResourceKind, string[]>;
};
