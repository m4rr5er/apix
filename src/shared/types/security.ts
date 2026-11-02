export type SecurityToolName = "read" | "write" | "edit" | "bash" | "grep" | "find" | "ls" | "ask_question";

export const SECURITY_TOOLS: readonly SecurityToolName[] = ["read", "write", "edit", "bash", "grep", "find", "ls", "ask_question"];

export type SecurityPathPolicy = "unrestricted" | "workspace" | "custom";

export type SecurityAction = "allow" | "ask" | "deny";

export type BuiltinSecurityLevelId = "off" | "standard" | "strict";

export type SecurityLevelConfig = {
	id: string;
	name: string;
	description: string;

	builtin?: boolean;

	toolActions: Partial<Record<SecurityToolName, SecurityAction>>;

	denyBashPatterns: string[];

	pathPolicy: SecurityPathPolicy;

	customAllowDirs: string[];

	denyDirs: string[];

	protectSensitivePaths: boolean;

	defaultAction: SecurityAction;
};

export type SecurityConfig = {
	enabled: boolean;

	defaultLevelId: string;

	levels: SecurityLevelConfig[];

	sessionOverrides: Record<string, string>;
};

export function createDefaultSecurityLevels(): SecurityLevelConfig[] {
	return [
		{
			id: "off",
			name: "关闭",
			description: "完全放行所有工具调用，等同未启用安全管理。",
			builtin: true,
			toolActions: {},
			denyBashPatterns: [],
			pathPolicy: "unrestricted",
			customAllowDirs: [],
			denyDirs: [],
			protectSensitivePaths: false,
			defaultAction: "allow",
		},
		{
			id: "standard",
			name: "标准",
			description: "危险命令先确认，敏感文件受保护，目录不限制。",
			builtin: true,
			toolActions: { bash: "ask" },
			denyBashPatterns: DEFAULT_DENY_BASH_PATTERNS,
			pathPolicy: "unrestricted",
			customAllowDirs: [],
			denyDirs: [],
			protectSensitivePaths: true,
			defaultAction: "allow",
		},
		{
			id: "strict",
			name: "严格",
			description: "只读为主，写操作逐一确认；危险命令直接拒绝；文件访问仅限工作目录。",
			builtin: true,
			toolActions: {
				read: "allow",
				grep: "allow",
				find: "allow",
				ls: "allow",
				write: "ask",
				edit: "ask",
				bash: "ask",
				ask_question: "allow",
			},
			denyBashPatterns: DEFAULT_DENY_BASH_PATTERNS,
			pathPolicy: "workspace",
			customAllowDirs: [],
			denyDirs: [],
			protectSensitivePaths: true,
			defaultAction: "deny",
		},
	];
}

export const DEFAULT_DENY_BASH_PATTERNS: string[] = [
	"\\brm\\s+-[a-z]*[rf]",
	"\\brmdir\\b",
	"\\bmv\\b",
	"\\bcp\\b",
	"\\bchmod\\b",
	"\\bchown\\b",
	"\\btee\\b",
	"\\btruncate\\b",
	"(^|[^<])>(?!>)",
	">>",
	"\\bnpm\\s+(install|uninstall|update|ci|link|publish)",
	"\\byarn\\s+(add|remove|install|publish)",
	"\\bpnpm\\s+(add|remove|install|publish)",
	"\\bpip\\s+(install|uninstall)",
	"\\bgit\\s+(add|commit|push|pull|merge|rebase|reset|checkout|branch\\s+-[dD]|stash|cherry-pick|revert|tag|init|clone)",
	"\\bsudo\\b",
	"\\bkill\\b",
	"(vim|nano|emacs|code|subl)\\b",
];

export const DEFAULT_SENSITIVE_PATH_PATTERNS: string[] = ["(^|[\\\\/])\\.env([.$]|$)", "(^|[\\\\/])\\.git([\\\\/]|$)", "(^|[\\\\/])(id_rsa|id_ed25519|id_ecdsa)(\\.pub)?$", "(^|[\\\\/])\\.(npmrc|yarnrc|pnpm-workspace)([.$]|$)", "(\\.pem|\\.key|\\.p12)$"];

export function createDefaultSecurityConfig(): SecurityConfig {
	return {
		enabled: true,
		defaultLevelId: "off",
		levels: createDefaultSecurityLevels(),
		sessionOverrides: {},
	};
}

export type SecurityPolicySnapshot = {
	schemaVersion: 1;
	enabled: boolean;
	defaultLevelId: string;
	levels: SecurityLevelConfig[];

	sessionLevels: Record<string, string>;
};

export const SECURITY_ENV_CONFIG_PATH = "PIDECK_SECURITY_CONFIG";
export const SECURITY_ENV_SESSION_ID = "PIDECK_SESSION_ID";

export const SECURITY_TOOL_LABELS: Record<SecurityToolName, string> = {
	read: "读取文件",
	write: "写入文件",
	edit: "编辑文件",
	bash: "执行命令",
	grep: "搜索内容",
	find: "查找文件",
	ls: "列目录",
	ask_question: "提问用户",
};
