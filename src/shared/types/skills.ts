import type { PromptStoreItem } from "./prompts";

export type PiSkillLocation = {
	id: "pi-global" | "agents-global" | "project-pi" | "project-agents";
	label: string;
	path: string;
	rootMarkdownEnabled: boolean;
};

export type PiSkillSummary = {
	id: string;
	name: string;
	description: string;
	path: string;
	dir: string;
	sourceId: PiSkillLocation["id"];
	sourceLabel: string;
	type: "directory" | "markdown";

	userOnly?: boolean;
	enabled: boolean;
	valid: boolean;
	warnings: string[];
};

export type PiSkillListResult = {
	locations: PiSkillLocation[];
	skills: PiSkillSummary[];
};

export type SkillContentResult = {
	content: string;
};

export type CreatePiSkillInput = {
	name: string;
	description: string;
	locationId: PiSkillLocation["id"];
};

export interface SkillStoreDetail {
	id: string;
	title: string;
	description: string;
	files: Array<{ filename: string; content: string }>;
}

export interface SkillStoreSearchResult {
	query: string;
	count: number;
	items: PromptStoreItem[];
}

export interface SkillHubItem {
	slug: string;
	name: string;
	description: string;
	description_zh?: string;
	iconUrl?: string;
	stars: number;
	downloads: number;
	installs: number;
	category: string;
	subCategories?: Array<{ key: string; name: string }>;
	version: string;
	ownerName: string;
	namespace?: {
		canonicalName: string;
		displayName: string;
		publicSlug: string;
	};
	labels?: Record<string, string>;
	tags?: Record<string, string>;
	source?: string;
	verified?: boolean;
	updatedAt?: number;
}

export interface SkillHubDetail {
	skill: {
		slug: string;
		displayName: string;
		summary: string;
		summary_zh?: string;
		iconUrl?: string;
		stats: {
			comments: number;
			downloads: number;
			installs: number;
			stars: number;
			versions: number;
		};
		category: string;
		subCategories?: Array<{ key: string; name: string }>;
		labels?: Record<string, string>;
		createdAt: number;
		updatedAt: number;
		source?: string;
		verified?: boolean;
	};
	latestVersion: {
		version: string;
		changelog?: string;
		createdAt: number;
	};
	owner: {
		displayName: string;
		handle: string;
		image?: string | null;
	};
	namespace: {
		canonicalName: string;
		displayName: string;
		handle: string;
		publicSlug: string;
	};
	securityReports?: {
		[key: string]: {
			status: string;
			statusText: string;
			reportUrl?: string;
		};
	};
}

export interface SkillHubSearchOptions {
	query: string;

	limit?: number;
}

export interface SkillHubSearchResult {
	query: string;
	total: number;
	items: SkillHubItem[];
}

export interface SkillHubInstallResult {
	success: boolean;
	slug: string;
	installDir: string;
	message?: string;
	error?: string;
}

export type SkillHubInstallPhase = "preparing" | "downloading" | "installing" | "running";

export interface SkillHubInstallProgress {
	slug: string;
	phase: SkillHubInstallPhase;

	detail: string;

	percent?: number;

	at: number;
}
