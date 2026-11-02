import type { ThinkingLevelMap } from "./modelSpecs";

export type FetchedModel = {
	id: string;
	name?: string;
	contextWindow?: number;
	maxTokens?: number;

	reasoning?: boolean;

	thinkingLevelMap?: ThinkingLevelMap;

	input?: string[];
};

export type PiModelProbeResult = {
	success: boolean;
	model?: string;
	snippet?: string;
	tokens?: { input?: number; output?: number };
	latencyMs?: number;
	error?: string;
};

export type ConfigProxyMode = "follow" | "pi" | "desktop" | "off";
