export type QoderProviderRegion = "global" | "cn";

export type QoderProviderSetupInput = {
	region: QoderProviderRegion;

	pat: string;
};

export type QoderProviderModel = {
	provider: string;
	id: string;
	name?: string;
	contextWindow?: number;
	maxTokens?: number;
	reasoning?: boolean;
	images?: boolean;
};

export type QoderProviderSetupResult = {
	ok: boolean;

	models: QoderProviderModel[];
	error?: string;
};

export type QoderProviderStatus = {
	configured: boolean;
	region: QoderProviderRegion | null;
	models: QoderProviderModel[];
};
