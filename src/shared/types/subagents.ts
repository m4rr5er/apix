export type PiSubagentStatus = "queued" | "running" | "completed" | "steered" | "aborted" | "stopped" | "error";

export interface PiSubagentEntry {
	id: string;

	type: string;

	description: string;

	status: PiSubagentStatus;

	result?: string;

	error?: string;

	startedAt?: number;

	completedAt?: number;

	toolUses?: number;

	tokens?: number;

	source: "record" | "bridge" | "toolcall";

	via?: "acp-delegate" | "pi-subagents-tool";

	childSessionPath?: string;

	childSessionId?: string;
}
