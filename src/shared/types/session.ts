export type ChatRole = "user" | "assistant" | "tool" | "system" | "error";

import type { VideoContent } from "./videogen";

export type I18nParams = Record<string, string | number | boolean | null | undefined>;

export type I18nDescriptor = {
	i18nKey?: string;
	i18nParams?: I18nParams;

	debugDetails?: string;
};

export type ChatMessage = {
	id: string;
	agentId: string;
	role: ChatRole;
	text: string;
	timestamp: number;
	meta?: Record<string, unknown> & I18nDescriptor;
	images?: ImageContent[];

	videos?: VideoContent[];

	thinking?: string;

	thinkingStartedAt?: number;

	thinkingEndedAt?: number;

	stopReason?: string;

	model?: { provider: string; modelId: string };
};

export type SessionHistoryUnavailableReason = "file-missing";

export type SessionMessagePage = {
	messages: ChatMessage[];
	total: number;

	totalTurns?: number;
	nextBefore: number | null;

	unavailable?: SessionHistoryUnavailableReason;

	model?: { provider: string; modelId: string };

	thinkingLevel?: string;

	nextBeforeEntryId?: string;

	indexVersion?: string;
};

export type FileTreeNode = {
	name: string;
	path: string;
	relativePath: string;
	type: "file" | "directory";
	children?: FileTreeNode[];

	hasChildren?: boolean;

	mtimeMs?: number;
	ctimeMs?: number;
	size?: number;
};

export type FileSearchResult = {
	name: string;
	path: string;
	relativePath: string;
	type: "file" | "directory";
};

export type FileContentSearchHit = {
	name: string;
	path: string;
	relativePath: string;
	line: number;
	column: number;
	snippet: string;
};

export type FileContentSearchResult = {
	hits: FileContentSearchHit[];
	matchedFiles: number;
	scannedFiles: number;
	scannedBytes: number;
	truncated: boolean;
};

export type SessionSource = "pi" | "codex" | "claude" | "opencode" | "zcode" | "workbuddy" | "cursor" | "qoder" | "kimi" | "kimiwork" | "minimax";
export type SessionEnvironment = "native" | "wsl";

export type SessionChannel = "wechat" | "feishu";

export type SessionProxyMode = "follow" | "on" | "off";

export type SessionProxyOverride = {
	mode: SessionProxyMode;
};

export type SessionModelPreference = {
	provider: string;
	modelId: string;
	modelName?: string;
};

export type SessionRuntimeModelSelection = SessionModelPreference & {
	thinkingLevel?: string;
};

export type SessionSortModeId = "updatedAt" | "createdAt" | "title";

export type SessionSummary = {
	id: string;
	filePath: string;

	projectId?: string;
	projectPath?: string;
	name?: string;

	nameFromSessionInfo?: boolean;

	parentSessionPath?: string;

	forked?: boolean;

	supersededBy?: string;
	preview: string;
	updatedAt: number;

	createdAt?: number;
	messageCount: number;

	source?: SessionSource;

	backend?: import("./agent").AgentBackend;

	channel?: SessionChannel;

	sideTask?: boolean;

	wsl?: boolean;

	model?: { provider: string; modelId: string };
	thinkingLevel?: string;

	hasImageGen?: boolean;
	qoderSessionId?: string;

	acpToolId?: string;
	codexSessionId?: string;
	codexThreadSource?: "user" | "subagent";
	codexParentThreadId?: string;
	codexAgentRole?: string;
	codexAgentNickname?: string;
};

export type ArchivedPiSession = {
	summary: SessionSummary;
	originalPath?: string;
};

export type SessionRecord = {
	id: string;
	projectId: string;
	title: string;

	noSession?: boolean;
	source: SessionSource;
	environment: SessionEnvironment;

	channel?: SessionChannel;

	sideTask?: boolean;

	backend?: import("./agent").AgentBackend;
	filePath?: string;
	wslDistro?: string;
	wslUser?: string;
	importedSourceId?: string;
	parentSessionId?: string;
	parentSessionPath?: string;

	forked?: boolean;

	supersededBy?: string;

	mergedSessionIds?: string[];
	projectPath?: string;
	preview: string;
	messageCount: number;
	status: "draft" | "active";
	model?: SessionModelPreference;
	thinkingLevel?: string;
	qoderSessionId?: string;

	acpSessionId?: string;

	acpToolId?: string;

	proxy?: SessionProxyOverride;
	createdAt: number;
	updatedAt: number;
	wsl?: boolean;
	codexSessionId?: string;
	codexThreadSource?: "user" | "subagent";
	codexParentThreadId?: string;
	codexAgentRole?: string;
	codexAgentNickname?: string;
};

export type CreateSessionDraftInput = {
	projectId: string;
	title?: string;
	model?: SessionModelPreference;

	welcomeModel?: SessionModelPreference;
	thinkingLevel?: string;

	backend?: import("./agent").AgentBackend;

	acpToolId?: string;

	sideTask?: boolean;
};

export type SessionLaunchPreferences = {
	model?: SessionModelPreference;
	thinkingLevel?: string;
};

export type ResolvedLaunchDefaults = {
	model?: SessionModelPreference;
	thinkingLevel?: string;

	defaultModelConfigured?: boolean;

	modelThinkingLevels?: Record<string, string>;
};

export type ResolveLaunchDefaultsInput = {
	backend?: import("./agent").AgentBackend;
};

export type CreateAnonymousSessionInput = {
	projectId: string;
	title?: string;

	backend?: import("./agent").AgentBackend;
} & SessionLaunchPreferences;

export type CreateAnonymousSessionResult = {
	session: SessionRecord;

	runtime?: SessionRuntimeInfo;
};

export type UpdateSessionRecordInput = {
	title?: string;

	model?: SessionModelPreference | null;
	thinkingLevel?: string | null;

	backend?: import("./agent").AgentBackend;

	acpToolId?: string | null;

	proxy?: SessionProxyOverride | null;

	sideTask?: boolean | null;
};

export type ForkMessage = {
	entryId: string;
	text: string;
};

export type SessionMessageImageTarget = {
	index: number;
	expectedImageCount: number;
	expectedHash: string;
};

export type ImageContent = {
	type: "image";

	data?: string;
	mimeType: string;

	ref?: string;
};

export type SendPromptInput = {
	agentId: string;
	message: string;
	images?: ImageContent[];
	streamingBehavior?: "steer" | "followUp";

	agentMessage?: string;

	description?: string;

	requestId?: string;
};

export type SendPromptResult = { accepted: true } | ({ accepted: false; error: string; delivery?: "rejected" } & I18nDescriptor) | ({ accepted: false; error: string; delivery: "unknown" } & I18nDescriptor);

export type SendSessionPromptInput = Omit<SendPromptInput, "agentId"> & {
	sessionId: string;
	requestId: string;

	requireAppliedModel?: boolean;
};

export type SendSessionPromptResult = SendPromptResult & {
	sessionId: string;
	requestId: string;
	agentId?: string;
	sessionPath?: string;
	runtimeGeneration?: number;
};

import type { AgentStatus, AgentUiResponse } from "./agent";

export type SessionRuntimeEvent = {
	kind?: "event" | "detach";
	sessionId: string;
	agentId: string;
	runtimeGeneration: number;
	sourceChannel: string;
	payload: unknown;
};

export type SessionRuntimeTarget = {
	sessionId: string;
	agentId: string;
	runtimeGeneration: number;
};

export type SessionRuntimeInfo = SessionRuntimeTarget & {
	projectId: string;
	cwd: string;
	status: AgentStatus;
	sessionPath?: string;
	createdAt: number;
	compactionCount?: number;
	noSession?: boolean;

	deckSessionId?: string;
};

export type SessionCommandErrorCode = "SESSION_NOT_FOUND" | "MESSAGE_NOT_FOUND" | "SESSION_RUNTIME_UNAVAILABLE" | "SESSION_RUNTIME_CHANGED" | "SESSION_RUNTIME_BUSY" | "SESSION_COMMAND_FAILED" | "SESSION_MODEL_NOT_FOUND" | "SESSION_FILE_TOO_LARGE";

export type SessionCommandError = {
	code: SessionCommandErrorCode;
	params?: Record<string, string | number>;
	debugDetails?: string;

	needsRestart?: boolean;
};

export type SessionCommandResult<T> = { ok: true; value: T } | { ok: false; error: SessionCommandError };

export type SessionTargetedValue<T> = {
	target: SessionRuntimeTarget;
	value: T;
};

export type SessionRuntimeReplacement = {
	previousTarget: SessionRuntimeTarget;
	runtime: SessionRuntimeInfo;
	session: SessionRecord;
};

export type SessionUiResponseInput = {
	sessionId: string;
	requestId: string;
	agentId: string;
	runtimeGeneration: number;
	response: AgentUiResponse;
};

export type SessionBranchNode = {
	id: string;
	parentId: string | null;

	role: "user" | "assistant" | "system" | "other";

	entryType: string;
	preview: string;
	timestamp: string;

	label?: string;
	children: SessionBranchNode[];
};

export type SessionBranchTree = {
	roots: SessionBranchNode[];

	leafId: string | null;
};

export type SessionSearchMatch = {
	messageId: string;
	role: "user" | "assistant";
	timestampMs: number;

	snippet: string;
};

export type SessionSearchSessionHit = {
	filePath: string;
	updatedAtMs: number;
	matches: SessionSearchMatch[];

	hitCount?: number;
};

export type SessionSearchResult = {
	sessions: SessionSearchSessionHit[];

	totalHitSessions: number;
	truncated: boolean;
};
