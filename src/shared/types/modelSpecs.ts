export type ThinkingLevelMap = Partial<Record<"off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", string | null>>;

export type ProviderModelIdIndex = ReadonlyMap<string, ReadonlySet<string>>;

export type ModelSpecSource = "listing" | "pi-ai" | "pi-runtime";
export type ModelSpecMatchKind = "provider-id" | "model-id" | "id-tail" | "name-alias";

export type ModelSpec = {
	contextWindow?: number;

	maxTokens?: number;

	reasoning?: boolean;

	input?: Array<"text" | "image">;

	images?: boolean;

	thinkingLevelMap?: ThinkingLevelMap;

	source: ModelSpecSource;

	matchKind?: ModelSpecMatchKind;

	matchedId?: string;
};
