import type { AgentBackend } from "./agent";
import type { EnhanceErrorKind } from "./enhance";

export type AgentProfileCategory = "general" | "translation" | "writing" | "coding" | "analysis";

export const AGENT_PROFILE_CATEGORIES: readonly AgentProfileCategory[] = ["general", "translation", "writing", "coding", "analysis"];

export type AgentInvokeAction = "translate" | "chat";

export type AgentTranslateTarget = "auto" | "zh-CN" | "en-US" | "ja-JP" | "ko-KR" | "fr-FR" | "de-DE" | "es-ES" | "ru-RU";

export const AGENT_TRANSLATE_TARGETS: readonly AgentTranslateTarget[] = ["auto", "zh-CN", "en-US", "ja-JP", "ko-KR", "fr-FR", "de-DE", "es-ES", "ru-RU"];

export type AgentModelRef = { provider: string; modelId: string };

export type AgentProfileBackend = "pi";

export const AGENT_PROFILE_BACKENDS: readonly AgentProfileBackend[] = ["pi"];

export type AgentProfile = {
	id: string;
	name: string;

	description: string;

	icon: string;

	systemPrompt: string;

	model?: AgentModelRef;

	backend?: AgentProfileBackend;
	category: AgentProfileCategory;

	builtin?: boolean;
	createdAt: number;
	updatedAt: number;

	usageCount: number;
	lastUsedAt?: number;
};

export const BUILTIN_TRANSLATE_AGENT_ID = "builtin-translate";

export const BUILTIN_PIDECK_HELPER_AGENT_ID = "builtin-pideck-helper";
export const BUILTIN_PIDECK_DIAGNOSTIC_AGENT_ID = "builtin-pideck-diagnostic";
export const BUILTIN_PIDECK_PLUGIN_DEV_AGENT_ID = "builtin-pideck-plugin-dev";

export const AGENT_PROFILE_NAME_MAX_CHARS = 60;
export const AGENT_PROFILE_DESCRIPTION_MAX_CHARS = 300;
export const AGENT_PROFILE_ICON_MAX_CHARS = 16;
export const AGENT_PROFILE_SYSTEM_PROMPT_MAX_CHARS = 16_000;
export const AGENT_INVOKE_TEXT_MAX_CHARS = 16_000;
export const AGENT_INVOKE_INSTRUCTION_MAX_CHARS = 500;

export type AgentMarketSettings = {
	selectionToolEnabled: boolean;

	systemSelectionEnabled: boolean;

	selectionToolAgentId: string | null;

	sessionAgentBindings: Record<string, string>;
};

export type BindAgentSessionInput = { sessionId: string; agentId: string | null };

export type AgentProfileSnapshot = {
	revision: number;
	agents: AgentProfile[];
	settings: AgentMarketSettings;

	agentOrder: string[];
};

export type CreateAgentProfileInput = {
	name: string;
	description?: string;
	icon?: string;
	systemPrompt: string;
	category?: AgentProfileCategory;
	model?: AgentModelRef;
	backend?: AgentProfileBackend;
};

export type UpdateAgentProfileInput = Partial<CreateAgentProfileInput>;

export type UpdateAgentMarketSettingsInput = Partial<Omit<AgentMarketSettings, "sessionAgentBindings">>;
export type AgentChangedEvent = { revision: number };

export type AgentInvokeInput = {
	agentId: string;

	text: string;
	action?: AgentInvokeAction;

	targetLanguage?: AgentTranslateTarget;

	instruction?: string;
	model: AgentModelRef;
};

export type AgentInvokeEventPayload = { runId: string; phase: "started" } | { runId: string; phase: "delta"; text: string } | { runId: string; phase: "done"; text: string } | { runId: string; phase: "aborted" } | { runId: string; phase: "error"; errorKind: EnhanceErrorKind; message: string };

export type AgentInvokeResult = { ok: true; runId: string } | { ok: false; errorKind: EnhanceErrorKind; message: string };

export function isBuiltinAgent(profile: AgentProfile): boolean {
	return profile.builtin === true;
}
