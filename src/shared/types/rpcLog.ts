export interface RpcLogEntry {
	id: string;
	agentId: string;
	direction: string;
	summary: string;
	time: number;
	data?: unknown;
}

export interface RpcLogBatch {
	agentId: string;
	entries: RpcLogEntry[];
}

export interface ModelTraceLogData {
	kind: "request" | "response";
	traceId: string;
	model?: string;
	provider?: string;
	messageCount?: number;
	toolCount?: number;
	payloadBytes?: number;
	truncated?: boolean;
	status?: number;
	durationMs?: number;
}

export function isModelTraceLogData(value: unknown): value is ModelTraceLogData {
	if (typeof value !== "object" || value === null) return false;
	const data = value as Record<string, unknown>;
	return (data.kind === "request" || data.kind === "response") && typeof data.traceId === "string";
}
