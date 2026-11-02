export type EnhanceEventPayload = { runId: string; phase: "started" } | { runId: string; phase: "delta"; text: string } | { runId: string; phase: "done"; text: string } | { runId: string; phase: "aborted" } | { runId: string; phase: "error"; errorKind: EnhanceErrorKind; message: string };

export type EnhanceErrorKind = "invalid-request" | "helper-missing" | "wsl" | "no-pi-entry" | "spawn-failed" | "sdk-unavailable" | "model-not-found" | "no-provider" | "busy" | "aborted" | "timeout" | "protocol" | "model-error";

export type EnhanceRunResult = { ok: true; runId: string } | { ok: false; errorKind: EnhanceErrorKind; message: string };

export const ENHANCE_CONTEXT_MAX_MESSAGES = 12;
export const ENHANCE_CONTEXT_MAX_CHARS = 16_000;

export type EnhanceContextMessage = { role: "user" | "assistant"; text: string };

export type EnhanceRunInput = {
	provider: string;
	modelId: string;

	userText: string;

	context?: EnhanceContextMessage[];
};

export type EnhanceHostRecord = { type: "ready"; protocolVersion: number } | { type: "started"; id: string } | { type: "delta"; id: string; text: string } | { type: "done"; id: string; text: string } | { type: "error"; id: string; errorKind: EnhanceErrorKind; message: string };
