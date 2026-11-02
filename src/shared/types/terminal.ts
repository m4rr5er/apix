export type TerminalShell = "pwsh" | "powershell" | "cmd" | "zsh" | "bash" | "fish" | "sh" | "git-bash" | "wsl";

export type TerminalShellCandidate = {
	shell: TerminalShell;
	label: string;
	available: boolean;
	path?: string;
};

export type TerminalTab = {
	id: string;
	agentId: string;

	ownerKey: string;
	title: string;
	cwd: string;
	shell: TerminalShell;
	createdAt: number;
	exited?: boolean;
	exitCode?: number;
	buffer?: string;

	frontProcess?: string;
};

export type TerminalAgentTarget = {
	kind: "agent";
	sessionId: string;
	agentId: string;
	runtimeGeneration: number;
};

export type TerminalProjectTarget = {
	kind: "project";
	projectId: string;
	cwd: string;
};

export type TerminalTarget = TerminalAgentTarget | TerminalProjectTarget;

export type TerminalDataEvent = {
	tabId: string;
	data: string;
};

export type TerminalExitEvent = {
	tabId: string;
	exitCode?: number;
};
