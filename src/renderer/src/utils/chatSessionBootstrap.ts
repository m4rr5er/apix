import type { AgentBackend, AvailableModel } from "../../../shared/types";
import { createSessionModelPreference } from "../../../shared/modelDisplayName";

export type ChatSessionBootstrapAction = { kind: "none" } | { kind: "load" } | { kind: "wait" };

export const GUIDE_BOOTSTRAP_SESSION_ID = "renderer:guide-bootstrap";

export const WELCOME_MODEL_KEY = "pideck:welcome-model";

export const WELCOME_THINKING_KEY = "pideck:welcome-thinking";

export const WELCOME_BACKEND_KEY = "pideck:welcome-backend";

export function readWelcomeBackendPreference(): AgentBackend | undefined {
	try {
		const raw = localStorage.getItem(WELCOME_BACKEND_KEY);

		if (raw === "pi") return raw;
		if (raw !== null && raw.startsWith("acp:")) return "acp";
	} catch {}
	return undefined;
}

export function readWelcomeAcpToolPreference(): string | undefined {
	try {
		const raw = localStorage.getItem(WELCOME_BACKEND_KEY);
		if (raw === null || !raw.startsWith("acp:")) return undefined;
		const toolId = raw.slice("acp:".length);
		return toolId || undefined;
	} catch {
		return undefined;
	}
}

export function resolveGuidePageBackend(input: {
	override?: AgentBackend;

	acpToolId?: string;

	effectiveDefault: AgentBackend;
}): AgentBackend {
	if (input.override === "acp" && !input.acpToolId) return "pi";
	return input.override ?? input.effectiveDefault;
}

export function readWelcomeModelPreference():
	| {
			model: { provider: string; modelId: string; modelName?: string };
	  }
	| undefined {
	return readStoredModelPreference(WELCOME_MODEL_KEY);
}

function readStoredModelPreference(storageKey: string):
	| {
			model: { provider: string; modelId: string; modelName?: string };
	  }
	| undefined {
	try {
		const raw = localStorage.getItem(storageKey);
		if (!raw) return undefined;
		const parsed = JSON.parse(raw) as { provider?: string; modelId?: string; modelName?: unknown };
		if (typeof parsed.provider === "string" && typeof parsed.modelId === "string") {
			return {
				model: createSessionModelPreference(parsed.provider, parsed.modelId, parsed.modelName),
			};
		}
	} catch {}
	return undefined;
}

export function readWelcomeThinkingPreference(): { thinkingLevel: string } | undefined {
	try {
		const level = localStorage.getItem(WELCOME_THINKING_KEY);
		if (level) return { thinkingLevel: level };
	} catch {}
	return undefined;
}

export function isWelcomeModelLost(welcomeModel: { provider: string; modelId: string } | undefined, models: AvailableModel[]): boolean {
	if (!welcomeModel) return false;
	if (models.length === 0) return false;
	return !models.some((model) => model.provider === welcomeModel.provider && model.id === welcomeModel.modelId);
}

export function shouldClearWelcomePreference(input: {
	welcomeModel: { provider: string; modelId: string } | undefined;
	models: AvailableModel[];

	catalogLoaded: boolean;

	catalogIsGlobal: boolean;
}): boolean {
	const { welcomeModel, models, catalogLoaded, catalogIsGlobal } = input;
	if (!welcomeModel) return false;
	if (!catalogLoaded || !catalogIsGlobal) return false;
	return isWelcomeModelLost(welcomeModel, models);
}

export function resolveChatSessionBootstrap(input: { isChatProject: boolean; currentSessionId?: string; catalogStatus?: "idle" | "loading" | "ready" | "error" }): ChatSessionBootstrapAction {
	if (!input.isChatProject || input.currentSessionId) return { kind: "none" };

	if (input.catalogStatus === "idle" || input.catalogStatus === "error" || !input.catalogStatus) {
		return { kind: "load" };
	}
	if (input.catalogStatus !== "ready") return { kind: "wait" };

	return { kind: "none" };
}

export const LAST_SESSION_KEY = "pideck:last-session:v1";

export type LastSessionPreference = { sessionId: string; projectId: string };

export function parseLastSessionPreference(raw: string | null | undefined): LastSessionPreference | undefined {
	if (!raw) return undefined;
	try {
		const parsed = JSON.parse(raw) as { sessionId?: unknown; projectId?: unknown };
		if (typeof parsed.sessionId !== "string" || !parsed.sessionId.trim()) return undefined;
		if (typeof parsed.projectId !== "string" || !parsed.projectId.trim()) return undefined;
		return { sessionId: parsed.sessionId, projectId: parsed.projectId };
	} catch {
		return undefined;
	}
}

export function readLastSessionPreference(): LastSessionPreference | undefined {
	try {
		return parseLastSessionPreference(localStorage.getItem(LAST_SESSION_KEY));
	} catch {
		return undefined;
	}
}

export function writeLastSessionPreference(preference: LastSessionPreference): void {
	try {
		localStorage.setItem(LAST_SESSION_KEY, JSON.stringify(preference));
	} catch {}
}
