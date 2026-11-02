export type RewindCheckpointTrigger = "turn" | "tool" | "resume" | "before-restore";

export type RewindRestoreScope = "files" | "conversation" | "all";

export type RewindRestoreResult = {
	filesRestored: boolean;

	forkedSessionId?: string;
};

export type RewindCheckpointSummary = {
	id: string;

	sessionId: string;
	trigger: RewindCheckpointTrigger;
	turnIndex: number;

	toolName?: string;

	description?: string;

	branch: string;

	timestamp: number;

	skippedLargeFiles?: string[];

	skippedLargeDirs?: string[];

	skippedOverBudgetFiles?: string[];
};

export function isRewindRestoreScope(value: unknown): value is RewindRestoreScope {
	return value === "files" || value === "conversation" || value === "all";
}

export type RewindCheckpointPageParams = {
	limit?: number;

	beforeTimestamp?: number;
};

export type RewindCheckpointHealth = {
	lastSuccessAt?: number;

	lastErrorAt?: number;

	lastError?: string;

	lastErrorKind?: "no-git" | "other";

	consecutiveFailures: number;
};

export type RewindCheckpointPage = {
	items: RewindCheckpointSummary[];

	hasMore: boolean;

	health?: RewindCheckpointHealth;
};

export function isRewindCheckpointId(value: unknown): value is string {
	return typeof value === "string" && /^[\w-]+$/.test(value);
}
