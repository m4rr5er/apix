export type AcpToolConfig = {
	id: string;

	name: string;

	command: string;

	args: string[];

	env?: Record<string, string>;

	contextWindow?: number;

	enabled: boolean;
};

export type AcpToolInput = {
	id?: string;
	name: string;
	command: string;
	args: string[];
	env?: Record<string, string>;
	contextWindow?: number;
};

export type AcpToolsSettings = {
	tools: AcpToolConfig[];
};

export type AcpToolValidation = {
	ok: boolean;

	reasonKey?: "acp.toolNameRequired" | "acp.toolCommandRequired" | "acp.toolDuplicateName" | "acp.toolInvalidCharacters" | "acp.toolContextWindowInvalid";
};

export type AcpToolStatus = {
	presetId: import("../acpToolPresets").AcpToolPresetId;

	state: "installed" | "missing" | "npx-ready" | "unknown";

	version?: string;
};

export type AcpLifecycleEvent = { presetId: import("../acpToolPresets").AcpToolPresetId; phase: "line"; line: string } | { presetId: import("../acpToolPresets").AcpToolPresetId; phase: "done"; ok: boolean; output: string };

export type AcpSessionConfigOption = {
	id: string;
	name: string;
	description?: string;
	type?: "select" | "boolean";
	currentValue?: string | boolean;
	options?: Array<{ value: string; name: string; description?: string } | { group: string; name: string; options: Array<{ value: string; name: string; description?: string }> }>;

	category?: string;
};

export type AcpSessionConfigChangedEvent = { agentId: string; options: AcpSessionConfigOption[] };

export type AcpAgentInfo = {
	name?: string;

	capabilities: {
		loadSession: boolean;
		agentThought: boolean;
		sessionList: boolean;

		promptImage: boolean;
	};

	protocolVersion: number;
};
