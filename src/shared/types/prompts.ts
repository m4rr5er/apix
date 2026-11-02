export type PiPromptTemplateSummary = {
	name: string;
	path: string;
	description: string;
	content: string;
	userCreated: boolean;

	scope?: "global" | "project";

	enabled?: boolean;
};

export type RuntimePromptTemplate = { name: string; content: string; description?: string };

export type PiPromptTemplateListResult = {
	templates: PiPromptTemplateSummary[];
	globalDir: string;
};

export type CreatePiPromptTemplateInput = {
	name: string;
	description: string;
};

export interface PromptStoreRawItem {
	id: string;
	title: string;
	slug: string;
	description: string;
	content: string;
	type: string;
	author: { id: string; name: string; username: string; avatar?: string; verified?: boolean };
	category: { id: string; name: string; slug: string } | null;
	tags: Array<{ promptId: string; tagId: string; tag: { id: string; name: string; slug: string; color?: string } }>;
	voteCount: number;
	viewCount: number;
	createdAt: string;
}

export interface PromptStoreItem {
	id: string;
	title: string;
	description: string;
	content: string;
	type: string;
	author: string;
	category: string;
	tags: string[];
	votes: number;
	createdAt: string;
}

export interface PromptStoreSearchResponse {
	prompts: PromptStoreRawItem[];
	total: number;
	page: number;
	perPage: number;
	totalPages: number;
}

export interface PromptStoreSearchResult {
	query: string;
	count: number;
	prompts: PromptStoreItem[];
}

export type PromptStoreSearchType = "TEXT" | "STRUCTURED" | "IMAGE" | "VIDEO" | "AUDIO";

export type YaoPromptCategory = {
	slug: string;
	name: string;
	count: number;
};

export type YaoPromptItem = {
	slug: string;
	title: string;
	category: string;
	subcategory: string;
	tags: string[];
	description: string;

	path: string;
};

export type YaoPromptDbState = "ready" | "missing" | "downloading" | "failed";

export type YaoPromptDbSnapshot = { state: "ready"; path: string; sha256: string | null; source: "cache" | "repo" } | { state: "downloading"; receivedBytes: number; totalBytes: number | null } | { state: "failed"; message: string } | { state: "missing" };

export type YaoPromptListOptions = {
	category?: string;
	search?: string;
	page?: number;
	pageSize?: number;
	categoriesOnly?: boolean;
};

export type YaoPromptListResult = {
	categories: YaoPromptCategory[];
	prompts: YaoPromptItem[];
	repoPath: string;
	total?: number;
	page?: number;
	pageSize?: number;

	dbState?: YaoPromptDbState;
};

export type YaoPromptDetailResult = {
	title: string;
	description: string;
	promptContent: string;
	fullContent: string;
};
