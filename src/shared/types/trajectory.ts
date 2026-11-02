export type SessionProcessEventKind = "session" | "sessionInfo" | "modelChange" | "thinkingChange" | "compaction" | "custom" | "import" | "retry" | "usage" | "systemPrompt";

export type SessionPromptSnapshot = {
	kind: "initial" | "update" | "snapshot";

	text: string;

	tools: string[];

	toolsAdded?: string[];
	toolsRemoved?: string[];
	sectionsAdded?: string[];
	sectionsUpdated?: string[];
	sectionsRemoved?: string[];

	truncated?: boolean;
};

export type SessionProcessEvent = {
	id: string;
	kind: SessionProcessEventKind;
	timestamp: number;
	summary: string;
	detail?: string;
	cwd?: string;
	parentSession?: string;
	provider?: string;
	modelId?: string;
	thinkingLevel?: string;
	customType?: string;
	tokensBefore?: number;

	seq?: number;

	retry?: number;
	maxRetries?: number;
	retryDelayMs?: number;

	prompt?: SessionPromptSnapshot;

	usageKind?: string;
};

export type SessionFactsCoverage = {
	fromStart: boolean;

	chainComplete: boolean;

	readComplete: boolean;

	eventsTrimmed: boolean;

	reason?: "history-window" | "ancestor-missing" | "budget" | "unsupported" | "unavailable";
};

export type SessionFactsResult = {
	events: SessionProcessEvent[];

	version: string;
	coverage: SessionFactsCoverage;
};
