import type { AgentModelRef, AgentProfileBackend, AgentProfileCategory } from "./agentProfile";
import type { AutomationRunStatus, AutomationRunTrigger, AutomationSchedule, AutomationTask, AutomationTaskMode, NormalizedAutomationBudget } from "./automation";
import type { McpConfigFile } from "./mcp";
import type { AppSettings } from "./settings";

export type PiDeckMcpAccess = {
	enabled: boolean;
	projectIds: string[];

	allProjects: boolean;

	allowControl: boolean;

	allowAgentWrite: boolean;

	allowAutomationWrite: boolean;

	allowFavoritesWrite: boolean;
};
export type PiDeckMcpProject = { id: string; name: string };
export type PiDeckMcpState = PiDeckMcpAccess & {
	running: boolean;
	projects: PiDeckMcpProject[];
	endpoint?: string;

	error?: string;
};

export type PiDeckMcpSettingsView = {
	app: { language: AppSettings["language"]; theme: AppSettings["theme"] };
	agent: {
		backend: AppSettings["defaultAgentBackend"];
		offline: boolean;
		noExtensions: boolean;
		noSkills: boolean;
		lastUsedModel: AppSettings["lastUsedModel"] | null;
		favoriteModels: string[];
		showThinking: boolean;
		autoSessionTitle: boolean;
	};
	workspace: {
		gitManagement: boolean;
		cuaEnabled: boolean;
		cuaAutoApprove: boolean;
		wslEnabled: boolean;
		wslDistro: string;
	};
};

export type PiDeckMcpBuiltInExtension = {
	id: string;

	enabled: boolean;

	internal: boolean;
};

export type PiDeckMcpExtensionsView = {
	builtInVersion: string | null;

	injectionDisabled: boolean;
	builtIn: PiDeckMcpBuiltInExtension[];
	removedBuiltInExtensions: string[];
	disabledExtensions: AppSettings["disabledExtensions"];
};

export type PiDeckMcpRuntimeEntry = {
	sessionId: string;
	projectId: string;

	runtimeGeneration: number;

	status: string;
	busy: boolean;
	createdAt: number;
};

export type PiDeckMcpRuntimeView = {
	runtimes: PiDeckMcpRuntimeEntry[];

	runningCount: number;

	activeProjectCount: number;

	authorizedProjectCount: number;
};

export type PiDeckMcpAgentSummary = {
	id: string;
	name: string;
	description: string;
	icon: string;
	category: AgentProfileCategory;

	builtin: boolean;

	model: AgentModelRef | null;

	backend: AgentProfileBackend | null;
	usageCount: number;
	lastUsedAt: number | null;
	createdAt: number;
	updatedAt: number;
};

export type PiDeckMcpAutomationTaskSummary = {
	id: string;
	name: string;
	projectId: string;
	schedule: AutomationSchedule;
	enabled: boolean;
	backend: AutomationTask["backend"] | null;
	model: AgentModelRef | null;
	thinkingLevel: string | null;
	mode: AutomationTaskMode | null;
	budget: NormalizedAutomationBudget;
	createdAt: number;
	updatedAt: number;
	lastScheduledAt: number | null;
	nextRunAt: number | null;
};

export type PiDeckMcpAutomationTaskDetail = PiDeckMcpAutomationTaskSummary & {
	prompt: string;
};

export type PiDeckMcpAutomationRunSummary = {
	id: string;
	taskId: string;
	taskName: string;
	projectId: string;
	trigger: AutomationRunTrigger;
	status: AutomationRunStatus;
	scheduledFor: number | null;
	sessionId: string | null;
	queuedAt: number;
	startedAt: number | null;
	endedAt: number | null;
	durationMs: number | null;
	inputTokens: number;
	outputTokens: number;
	costUsd: number;
	stepCount: number;
	changedFiles: number | null;

	error: string | null;
	skippedReason: string | null;
	budgetReason: string | null;
};

export type PiDeckMcpResult<T> = { ok: true; value: T } | { ok: false; code: string };
export type PiDeckMcpDesktopApi = {
	getState: () => Promise<PiDeckMcpResult<PiDeckMcpState>>;
	setAccess: (input: PiDeckMcpAccess) => Promise<PiDeckMcpResult<PiDeckMcpState>>;
	connection: () => Promise<PiDeckMcpResult<McpConfigFile>>;
};
