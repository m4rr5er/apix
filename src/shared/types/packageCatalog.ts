export type PiPackageCatalogItem = {
	name: string;
	description: string;

	author?: string;

	types: string[];

	downloadsPerMonth?: number;

	publishedAt?: number;

	npmUrl?: string;

	githubUrl?: string;

	searchText: string;

	installSource: string;

	pageUrl: string;
};

export type PiPackageCatalog = {
	generatedAt: number;

	fromCache: boolean;
	items: PiPackageCatalogItem[];

	page: number;

	pageSize: number;

	total: number;

	lastPage: number;
};

export type PiPackageCatalogQuery = {
	page?: number;

	query?: string;

	type?: string;

	sort?: "downloads" | "recent";

	refresh?: boolean;
};
