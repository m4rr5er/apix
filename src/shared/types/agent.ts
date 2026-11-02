import type { ThinkingLevelMap } from "./modelSpecs";
import type { SessionEnvironment, SessionSource } from "./session";
import type { TodoItem } from "./todo";

export type AgentStatus = "starting" | "idle" | "running" | "error" | "closed";

export type AgentBackend = "pi" | "imagegen" | "videogen" | "acp" | "qoder";

export type ImChannelBackend = "pi";

export function parseImChannelBackend(value: unknown): ImChannelBackend | undefined {
	return value === "pi" ? value : undefined;
}

export type AgentGatewayCapability = "compact" | "fork" | "getForkMessages" | "editMessage" | "deleteMessage" | "getCommands" | "reloadResources" | "exportHtml" | "rewind";

export type AgentTab = {
	id: string;
	projectId: string;
	cwd: string;
	title: string;
	status: AgentStatus;
	sessionId?: string;

	deckSessionId?: string;
	sessionPath?: string;

	sessionEnvironment?: SessionEnvironment;
	sessionSource?: SessionSource;

	backend?: AgentBackend;

	agentPreset?: string;
	wslDistro?: string;
	wslUser?: string;
	importedSourceId?: string;
	noSession?: boolean;

	standby?: boolean;

	runtimeGeneration?: number;
	createdAt: number;

	compactionCount?: number;
};

export type AgentRuntimeState = {
	modelName?: string;
	provider?: string;
	modelId?: string;
	thinkingLevel?: string;

	todos?: TodoItem[] | null;
	isStreaming?: boolean;

	isTurnActive?: boolean;
	isCompacting?: boolean;

	isExecutingTool?: boolean;

	executingToolName?: string;

	toolStateSequence?: number;
	contextTokens?: number | null;
	contextWindow?: number | null;
	contextPercent?: number | null;

	contextOverflow?: boolean;

	contextMessageTokens?: number;

	contextSystemTokens?: number;

	contextToolsTokens?: number;
	inputTokens?: number;
	outputTokens?: number;
	cacheRead?: number;
	cacheWrite?: number;
	cacheTotal?: number;
	cacheHitPercent?: number | null;

	cacheHitAveragePercent?: number | null;

	cacheHitSampleCount?: number;
	cost?: number;

	ttftMs?: number;

	totalMs?: number;

	tps?: number;

	endToEndTps?: number;

	sessionTps?: number;

	sessionEndToEndTps?: number;

	perfAt?: number;
};

export type AvailableModel = {
	id: string;
	name?: string;
	provider: string;

	contextWindow?: number;

	maxTokens?: number;
	reasoning?: boolean;

	input?: Array<"text" | "image">;

	images?: boolean;

	thinkingLevels?: string[];

	thinkingLevelMap?: ThinkingLevelMap;

	reasoningEfforts?: Array<{ id: string; name?: string; description?: string }>;

	defaultEffort?: string;
};

export type ModelListFailReason = "pi-not-found" | "version-too-old" | "config-invalid" | "cli-failed" | "waf-blocked" | "empty";

export type ModelListReport = {
	models: AvailableModel[];

	ok: boolean;
	reason: ModelListFailReason | null;

	version: string | null;

	detail: string;

	source: "cache" | "cli" | "config-fallback" | "none";

	at: number;
};

export type ModelsVerifyResult = {
	ok: boolean;
	modelCount: number;
	reason: ModelListFailReason | "config-fallback" | null;

	detail: string;

	savedAt: number;
};

export type CreateAgentInput = {
	projectId: string;
	title?: string;
	sessionPath?: string;

	backend?: AgentBackend;

	agentPreset?: string;

	acpSessionId?: string;

	qoderSessionId?: string;

	deckSessionId?: string;

	standby?: boolean;
	environment?: SessionEnvironment;
	source?: SessionSource;
	wslDistro?: string;
	wslUser?: string;
	importedSourceId?: string;
	noSession?: boolean;
};

export type AgentUiResponse = {
	value?: string | boolean | string[];
	cancelled?: boolean;
	confirmed?: boolean;
};

export type AgentUiBatchQuestion = {
	id: string;
	type: "select" | "multi_select" | "confirm" | "input" | "editor";
	question: string;
	options?: Array<string | { label: string; value?: string; description?: string }>;
	allowOther?: boolean;
	placeholder?: string;
	prefill?: string;
};

export type AgentUiRequest = {
	agentId: string;
	requestId: string;
	method: string;
	title: string;
	options?: string[];
	placeholder?: string;
	prefill?: string;
	allowOther?: boolean;
	completed?: boolean;
	value?: string | boolean;
	confirmed?: boolean;
	cancelled?: boolean;
	message?: string;
	notifyType?: "info" | "warning" | "error";
	text?: string;
	widgetKey?: string;
	widgetLines?: string[];
	widgetPlacement?: "aboveEditor" | "belowEditor";

	batchQuestions?: AgentUiBatchQuestion[];
	batchReview?: boolean;
};

export type ThinkingUpdate = {
	agentId: string;

	id: string;

	text?: string;

	delta?: string;
	startedAt: number;

	endedAt: number;

	done: boolean;
};

export type ComposerAgentMode = "normal" | "plan" | "imagegen" | "videogen" | "goal";
