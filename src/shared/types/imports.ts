export type CodexImportStatus = "new" | "current" | "outdated";

export type CodexSessionSummary = {
	id: string;
	sourcePath: string;
	targetPath: string;
	cwd: string;
	title: string;
	preview: string;
	createdAt: number;
	updatedAt: number;
	messageCount: number;
	status: CodexImportStatus;
	sourceSize: number;
	importedSourceMtime?: number;
	threadSource?: "user" | "subagent";
	parentThreadId?: string;
	agentRole?: string;
	agentNickname?: string;
};

export type CodexImportResult = {
	id: string;
	sourcePath: string;
	targetPath?: string;
	title?: string;
	success: boolean;
	overwritten?: boolean;
	messageCount?: number;
	error?: string;
};

export type CodexImportReport = {
	results: CodexImportResult[];
	imported: number;
	failed: number;
};

export type ClaudeImportStatus = "new" | "current" | "outdated";

export type ClaudeSessionSummary = {
	id: string;
	sourcePath: string;
	targetPath: string;
	cwd: string;
	title: string;
	preview: string;
	createdAt: number;
	updatedAt: number;
	messageCount: number;
	status: ClaudeImportStatus;
	sourceSize: number;
	importedSourceMtime?: number;
};

export type ClaudeImportResult = {
	id: string;
	sourcePath: string;
	targetPath?: string;
	title?: string;
	success: boolean;
	overwritten?: boolean;
	messageCount?: number;
	error?: string;
};

export type ClaudeImportReport = {
	results: ClaudeImportResult[];
	imported: number;
	failed: number;
};

export type QoderImportStatus = "new" | "current" | "outdated";

export type QoderSessionSummary = {
	id: string;
	sourcePath: string;
	targetPath: string;
	cwd: string;
	title: string;
	preview: string;
	createdAt: number;
	updatedAt: number;
	messageCount: number;
	status: QoderImportStatus;
	sourceSize: number;
	importedSourceMtime?: number;
};

export type QoderImportResult = {
	id: string;
	sourcePath: string;
	targetPath?: string;
	title?: string;
	success: boolean;
	overwritten?: boolean;
	messageCount?: number;
	error?: string;
};

export type QoderImportReport = {
	results: QoderImportResult[];
	imported: number;
	failed: number;
};

export type OpenCodeImportStatus = "new" | "current" | "outdated";

export type OpenCodeSessionSummary = {
	id: string;
	sourcePath: string;
	targetPath: string;
	cwd: string;
	title: string;
	preview: string;
	createdAt: number;
	updatedAt: number;
	messageCount: number;
	status: OpenCodeImportStatus;
	sourceSize: number;
	importedSourceMtime?: number;
};

export type OpenCodeImportResult = {
	id: string;
	sourcePath: string;
	targetPath?: string;
	title?: string;
	success: boolean;
	overwritten?: boolean;
	messageCount?: number;
	error?: string;
};

export type OpenCodeImportReport = {
	results: OpenCodeImportResult[];
	imported: number;
	failed: number;
};

export type ZCodeImportStatus = "new" | "current" | "outdated";

export type ZCodeSessionSummary = {
	id: string;
	sourcePath: string;
	targetPath: string;
	cwd: string;
	title: string;
	preview: string;
	createdAt: number;
	updatedAt: number;
	messageCount: number;
	status: ZCodeImportStatus;
	sourceSize: number;
	importedSourceMtime?: number;
};

export type ZCodeImportResult = {
	id: string;
	sourcePath: string;
	targetPath?: string;
	title?: string;
	success: boolean;
	overwritten?: boolean;
	messageCount?: number;
	error?: string;
};

export type ZCodeImportReport = {
	results: ZCodeImportResult[];
	imported: number;
	failed: number;
};

export type WorkBuddyImportStatus = "new" | "current" | "outdated";

export type WorkBuddySessionSummary = {
	id: string;
	sourcePath: string;
	targetPath: string;
	cwd: string;
	title: string;
	preview: string;
	createdAt: number;
	updatedAt: number;
	messageCount: number;
	status: WorkBuddyImportStatus;
	sourceSize: number;
	importedSourceMtime?: number;
};

export type WorkBuddyImportResult = {
	id: string;
	sourcePath: string;
	targetPath?: string;
	title?: string;
	success: boolean;
	overwritten?: boolean;
	messageCount?: number;
	error?: string;
};

export type WorkBuddyImportReport = {
	results: WorkBuddyImportResult[];
	imported: number;
	failed: number;
};

export type CursorImportStatus = "new" | "current" | "outdated";

export type CursorSessionSummary = {
	id: string;
	sourcePath: string;
	targetPath: string;
	cwd: string;
	title: string;
	preview: string;
	createdAt: number;
	updatedAt: number;
	messageCount: number;
	status: CursorImportStatus;
	sourceSize: number;
	importedSourceMtime?: number;
};

export type CursorImportResult = {
	id: string;
	sourcePath: string;
	targetPath?: string;
	title?: string;
	success: boolean;
	overwritten?: boolean;
	messageCount?: number;
	error?: string;
};

export type CursorImportReport = {
	results: CursorImportResult[];
	imported: number;
	failed: number;
};

export type KimiImportStatus = "new" | "current" | "outdated";

export type KimiSessionSummary = {
	id: string;
	sourcePath: string;
	targetPath: string;
	cwd: string;
	title: string;
	preview: string;
	createdAt: number;
	updatedAt: number;
	messageCount: number;
	status: KimiImportStatus;
	sourceSize: number;
	importedSourceMtime?: number;
};

export type KimiImportResult = {
	id: string;
	sourcePath: string;
	targetPath?: string;
	title?: string;
	success: boolean;
	overwritten?: boolean;
	messageCount?: number;
	error?: string;
};

export type KimiImportReport = {
	results: KimiImportResult[];
	imported: number;
	failed: number;
};

export type KimiWorkImportStatus = "new" | "current" | "outdated";

export type KimiWorkShareRootOrigin = "settings" | "app-config" | "default";

export type KimiWorkShareRootInfo = {
	root: string | null;
	origin: KimiWorkShareRootOrigin | null;

	sessionsFound: boolean;
};

export type KimiWorkSessionSummary = {
	id: string;
	sourcePath: string;
	targetPath: string;
	title: string;
	preview: string;
	createdAt: number;
	updatedAt: number;
	messageCount: number;
	status: KimiWorkImportStatus;
	sourceSize: number;
	importedSourceMtime?: number;
};

export type KimiWorkImportResult = {
	id: string;
	sourcePath: string;
	targetPath?: string;
	title?: string;
	success: boolean;
	overwritten?: boolean;
	messageCount?: number;
	error?: string;
};

export type KimiWorkImportReport = {
	results: KimiWorkImportResult[];
	imported: number;
	failed: number;
};

export type MinimaxImportStatus = "new" | "current" | "outdated";

export type MinimaxSessionSummary = {
	id: string;
	sourcePath: string;
	targetPath: string;
	cwd: string;
	title: string;
	preview: string;
	createdAt: number;
	updatedAt: number;
	messageCount: number;
	status: MinimaxImportStatus;
	sourceSize: number;
	importedSourceMtime?: number;
};

export type MinimaxImportResult = {
	id: string;
	sourcePath: string;
	targetPath?: string;
	title?: string;
	success: boolean;
	overwritten?: boolean;
	messageCount?: number;
	error?: string;
};

export type MinimaxImportReport = {
	results: MinimaxImportResult[];
	imported: number;
	failed: number;
};

export type DirectoryImportStatus = "new" | "current";

export type DirectorySessionSummary = {
	id: string;

	sourcePath: string;
	title: string;
	preview: string;

	projectPath?: string;

	projectPathExists: boolean;
	updatedAt: number;
	messageCount: number;

	sourceSize?: number;
	status: DirectoryImportStatus;
};

export type DirectoryImportResult = {
	id: string;
	sourcePath: string;
	success: boolean;
	title?: string;
	error?: string;
};

export type DirectoryImportReport = {
	results: DirectoryImportResult[];
	imported: number;
	failed: number;
};

export type DirectorySourceKind = "sessions-root" | "group" | "project" | "ancestor" | "none";

export type DirectorySessionScanResult = {
	sessions: DirectorySessionSummary[];
	kind: DirectorySourceKind;
};

export type DirectorySessionSourceDir = {
	dir: string;

	projectPath?: string;

	sessionCount: number;

	lastUsedAt: number;

	projectPathExists: boolean;
};
