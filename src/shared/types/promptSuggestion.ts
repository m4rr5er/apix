import type { EnhanceContextMessage } from "./enhance";

export const PROMPT_SUGGESTION_MAX_CHARS = 200;

export type PromptSuggestionRunInput = {
	provider: string;
	modelId: string;

	context: EnhanceContextMessage[];
};

export type PromptSuggestionRunResult = { ok: true; runId: string } | { ok: false; errorKind: import("./enhance").EnhanceErrorKind; message: string };
