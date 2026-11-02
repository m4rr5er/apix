import type { PiSkillSummary, ProjectResourceDiscoveryResult } from "./types";

export type SkillCatalogEntry = {
	name: string;
	description: string;
	whenToUse?: string;

	userOnly?: boolean;
	source?: "project" | "global";

	sourceId?: string;

	sourceLabel?: string;
	path?: string;
};

export type PiSkillCatalogInput = {
	projectSkills: readonly PiSkillSummary[];

	globalSkills: readonly PiSkillSummary[];

	discovery: ProjectResourceDiscoveryResult;
};

export function emptyProjectResourceDiscovery(): ProjectResourceDiscoveryResult {
	return { projectResourcesAllowed: false, overrides: { disabledGlobalExtensions: [], disabledGlobalSkills: [], disabledGlobalPrompts: [] }, skills: [], prompts: [], extensions: [] };
}

export function mergeSkillCatalog<T extends { name: string }>(primary: readonly T[], fallback: readonly T[]): T[] {
	const seen = new Set(primary.map((skill) => skill.name.toLowerCase()));
	const merged = [...primary];
	for (const skill of fallback) {
		const key = skill.name.toLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		merged.push(skill);
	}
	return merged.sort((a, b) => a.name.localeCompare(b.name));
}

function discoveredSkillSource(sourceId: string): "project" | "global" {
	return sourceId === "settings-project" || sourceId === "package-project" || sourceId === "ancestor-agents" ? "project" : "global";
}

function toEntry(skill: PiSkillSummary, source: "project" | "global"): SkillCatalogEntry {
	return {
		name: skill.name,
		description: skill.description,
		userOnly: skill.userOnly,
		source,
		sourceId: skill.sourceId,
		sourceLabel: skill.sourceLabel,
		path: skill.path,
	};
}

export function mergePiSkillCatalog(input: PiSkillCatalogInput): SkillCatalogEntry[] {
	const projectResourcesAllowed = input.discovery.projectResourcesAllowed;
	const disabledInheritedSkills = new Set(input.discovery.overrides.disabledGlobalSkills);
	const visibleProjectSkills = projectResourcesAllowed ? input.projectSkills.filter((skill) => skill.enabled).map((skill) => toEntry(skill, "project")) : [];
	const visibleGlobalSkills = input.globalSkills.filter((skill) => skill.enabled && !disabledInheritedSkills.has(skill.sourceId + ":" + skill.name.toLowerCase())).map((skill) => toEntry(skill, "global"));
	const discoveredSkills: SkillCatalogEntry[] = input.discovery.skills
		.filter((skill) => skill.enabled)
		.map((skill) => ({
			name: skill.name,
			description: skill.description,
			userOnly: skill.userOnly,
			source: discoveredSkillSource(skill.sourceId),
			sourceId: skill.sourceId,
			sourceLabel: skill.sourceLabel,
		}));
	const discoveredProjectSkills = discoveredSkills.filter((skill) => skill.source === "project");
	const discoveredGlobalSkills = discoveredSkills.filter((skill) => skill.source === "global");

	const seen = new Map<string, SkillCatalogEntry>();
	for (const skill of [...visibleProjectSkills, ...discoveredProjectSkills, ...visibleGlobalSkills, ...discoveredGlobalSkills]) {
		const key = skill.name.toLowerCase();
		const previous = seen.get(key);

		if (!previous || (skill.source === "project" && previous.source === "global")) seen.set(key, skill);
	}
	return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
}
