export type VisionApiKind = "openai-completions" | "anthropic-messages" | "google-generative-ai";

export type VisionBridgeConfig = {
	enabled: boolean;

	provider: string;

	model: string;

	api?: VisionApiKind;

	baseUrl?: string;

	apiKey?: string;

	maxTokens?: number;

	timeoutMs?: number;

	concurrency?: number;

	promptTemplate?: string;
};

export type VisionSaveResult = {
	ok: boolean;
	error?: string;
};

export type VisionBridgeState = {
	config: VisionBridgeConfig | null;

	configDir: string;
};

export type VisionLogInfo = {
	exists: boolean;

	size: number;

	content: string;
	truncated: boolean;
};

export type VisionEventItem = {
	index: number;

	imageHash?: string;
	mimeType: string;
	ok: boolean;

	error?: string;

	durationMs: number;

	cached: boolean;

	description?: string;

	outputTokens?: number;
};

export type VisionBridgeEvent = {
	ts: number;

	kind: "input" | "tool_result" | "request";

	model: string;

	prompt: string;

	totalDurationMs: number;
	items: VisionEventItem[];
};

export type VisionEventsInfo = {
	exists: boolean;
	size: number;
	events: VisionBridgeEvent[];
	truncated: boolean;
};
