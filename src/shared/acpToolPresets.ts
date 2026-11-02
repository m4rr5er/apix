export type AcpToolPresetId = "gemini" | "claude-agent" | "codex" | "kimi" | "qwen" | "opencode" | "cursor-agent" | "codebuddy" | "minimax";

export type AcpToolInstall = { kind: "npm"; package: string } | { kind: "manual" };

export interface AcpToolPreset {
	id: AcpToolPresetId;

	name: string;

	command: string;

	args: string[];

	homepage: string;

	versionArgs?: string[];

	install?: AcpToolInstall;
}

export const ACP_TOOL_PRESETS: readonly AcpToolPreset[] = [
	{ id: "gemini", name: "Gemini CLI", command: "gemini", args: ["--acp"], homepage: "https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/acp-mode.md", install: { kind: "npm", package: "@google/gemini-cli" } },
	{ id: "claude-agent", name: "Claude Agent", command: "npx", args: ["-y", "@agentclientprotocol/claude-agent-acp"], homepage: "https://github.com/agentclientprotocol/claude-agent-acp" },
	{ id: "codex", name: "Codex CLI", command: "npx", args: ["-y", "@agentclientprotocol/codex-acp"], homepage: "https://github.com/agentclientprotocol/codex-acp" },
	{ id: "kimi", name: "Kimi CLI", command: "kimi", args: ["acp"], homepage: "https://github.com/moonshotai/kimi-code", install: { kind: "npm", package: "@moonshot-ai/kimi-code" } },
	{ id: "qwen", name: "Qwen Code", command: "qwen", args: ["--acp"], homepage: "https://github.com/QwenLM/qwen-code", install: { kind: "npm", package: "@qwen-code/qwen-code" } },
	{ id: "opencode", name: "OpenCode", command: "opencode", args: ["acp"], homepage: "https://opencode.ai/docs/cli/acp", install: { kind: "npm", package: "opencode-ai" } },
	{ id: "cursor-agent", name: "Cursor Agent", command: "agent", args: ["acp"], homepage: "https://cursor.com/docs/cli/acp", install: { kind: "manual" } },
	{ id: "codebuddy", name: "CodeBuddy", command: "npx", args: ["-y", "@tencent-ai/codebuddy-code", "--acp"], homepage: "https://codebuddy.ai/docs/cli/acp" },
	{ id: "minimax", name: "MiniMax Code", command: "npx", args: ["-y", "@minimax-ai/code", "acp"], homepage: "https://agent.minimax.io/docs/cli/integrations" },
];
