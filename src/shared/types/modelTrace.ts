export type ModelTraceRequestInput = {
	kind: "request";

	traceId: string;
	ts: number;

	model?: string;
	provider?: string;

	sessionId?: string;

	payloadJson: string;

	payloadBytes: number;
	truncated: boolean;
	messageCount?: number;
	toolCount?: number;
};

export type ModelTraceResponseInput = {
	kind: "response";
	traceId: string;
	ts: number;
	status: number;
	durationMs?: number;
};

export type ModelTraceInput = ModelTraceRequestInput | ModelTraceResponseInput;

export type ModelTraceRecord = ModelTraceRequestInput & { agentId: string };
