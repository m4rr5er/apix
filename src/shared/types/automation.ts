import type { AgentBackend, ComposerAgentMode } from "./agent";

export type AutomationTaskMode = Extract<ComposerAgentMode, "normal" | "plan" | "goal">;

export type AutomationSchedule = { type: "cron"; expression: string } | { type: "manual" };

export type AutomationRunTrigger = "manual" | "schedule" | "catch-up";

export type AutomationRunStatus = "queued" | "starting" | "running" | "succeeded" | "failed" | "aborted" | "timed-out" | "budget-exhausted" | "skipped" | "interrupted";

export type AutomationBudget = {
	timeoutMs?: number | null;

	maxTokens?: number | null;

	maxCostUsd?: number | null;

	maxSteps?: number | null;
};

export type NormalizedAutomationBudget = {
	timeoutMs?: number;
	maxTokens?: number;
	maxCostUsd?: number;
	maxSteps?: number;
};

export type AutomationTask = {
	id: string;
	name: string;
	projectId: string;
	prompt: string;
	schedule: AutomationSchedule;
	enabled: boolean;

	backend?: Exclude<AgentBackend, "imagegen">;
	model?: { provider: string; modelId: string };
	thinkingLevel?: string;

	mode?: AutomationTaskMode;

	budget: NormalizedAutomationBudget;
	createdAt: number;
	updatedAt: number;

	lastScheduledAt?: number;
};

export type AutomationTaskSummary = AutomationTask & {
	nextRunAt?: number;
};

export type AutomationRunEventType = "queued" | "starting" | "session-created" | "prompt-accepted" | "metrics" | "completed" | "failed" | "aborted" | "skipped" | "interrupted" | "budget-exhausted" | "timed-out";

export type AutomationRunEvent = {
	id: string;
	type: AutomationRunEventType;
	at: number;
	message?: string;
};

export type AutomationRun = {
	id: string;
	taskId: string;

	taskName: string;
	projectId: string;
	trigger: AutomationRunTrigger;
	status: AutomationRunStatus;
	scheduledFor?: number;
	sessionId?: string;
	agentId?: string;
	runtimeGeneration?: number;
	queuedAt: number;
	startedAt?: number;
	endedAt?: number;
	durationMs?: number;
	updatedAt: number;
	inputTokens: number;
	outputTokens: number;
	costUsd: number;
	stepCount: number;
	changedFiles?: number;
	error?: string;
	skippedReason?: "task-already-running" | "task-disabled";
	budgetReason?: "tokens" | "cost" | "steps";
	events: AutomationRunEvent[];
};

export type AutomationSettings = {
	maxConcurrentRuns: number;

	historyLimit: number;
};

export type AutomationSnapshot = {
	revision: number;
	settings: AutomationSettings;
	tasks: AutomationTaskSummary[];
	runs: AutomationRun[];
};

export type CreateAutomationTaskInput = {
	name: string;
	projectId: string;
	prompt: string;
	schedule: AutomationSchedule;
	enabled?: boolean;
	backend?: Exclude<AgentBackend, "imagegen">;
	model?: { provider: string; modelId: string };
	thinkingLevel?: string;

	mode?: AutomationTaskMode;
	permissionPreset?: string;
	budget?: Partial<AutomationBudget>;
};

export type UpdateAutomationTaskInput = Partial<CreateAutomationTaskInput>;
export type UpdateAutomationSettingsInput = Partial<AutomationSettings>;

export type AutomationCronPreview = { valid: true; nextRuns: number[] } | { valid: false; error: string };

export type AutomationChangedEvent = {
	revision: number;
};

export function isAutomationRunTerminal(status: AutomationRunStatus): boolean {
	return status !== "queued" && status !== "starting" && status !== "running";
}
