export const HIDEABLE_SETTINGS_TAB_IDS = ["im", "pet", "vision", "imagegen", "videogen", "acp", "hostplugins", "web", "git", "usage", "process"] as const;

export const HIDEABLE_MODULE_IDS = [...HIDEABLE_SETTINGS_TAB_IDS, "respondingTips", "automation", "agents", "favorites"] as const;

export type HideableSettingsTabId = (typeof HIDEABLE_SETTINGS_TAB_IDS)[number];
export type HideableModuleId = (typeof HIDEABLE_MODULE_IDS)[number];

export const MAX_HIDDEN_MODULES = 64;

export function normalizeHiddenModules(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	const ids = new Set<string>();
	for (const candidate of value) {
		if (typeof candidate !== "string") continue;
		const id = candidate.trim();
		if (!id) continue;
		ids.add(id);
		if (ids.size >= MAX_HIDDEN_MODULES) break;
	}
	return [...ids];
}

export function isModuleHidden(hiddenModules: readonly string[], moduleId: HideableModuleId): boolean {
	return hiddenModules.includes(moduleId);
}

export function toggleHiddenModule(hiddenModules: readonly string[], moduleId: HideableModuleId, hidden: boolean): string[] {
	const without = hiddenModules.filter((id) => id !== moduleId);
	return hidden ? [...without, moduleId] : without;
}
