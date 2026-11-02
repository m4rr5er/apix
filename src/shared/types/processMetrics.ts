export type ProcessMetricKind = "pi";

export type AgentProcessMetric = {
	agentId: string;

	kind?: ProcessMetricKind;

	sessionId?: string;

	sessionTitle?: string;

	pid: number;

	memoryBytes?: number;

	error?: string;
};

export type ProcessMetricsSnapshot = {
	agents: AgentProcessMetric[];

	totalAgentBytes: number;

	sampledAt: number;
};
