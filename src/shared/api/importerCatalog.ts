import type { ImporterCatalogEntry } from "./domainTypes";

export const IMPORTER_CATALOG = [
	{ id: "codex", manager: "CodexSessionImporter", ipcFile: ["ipc/sessionIpc.ts"], preloadNamespaces: ["codexSessions"], channelPrefix: ["codex-sessions"], capabilities: ["scan", "import"] },
	{ id: "claude", manager: "ClaudeSessionImporter", ipcFile: ["ipc/sessionIpc.ts"], preloadNamespaces: ["claudeSessions"], channelPrefix: ["claude-sessions"], capabilities: ["scan", "import"] },
	{ id: "qoder", manager: "QoderSessionImporter", ipcFile: ["ipc/sessionIpc.ts"], preloadNamespaces: ["qoderSessions"], channelPrefix: ["qoder-sessions"], capabilities: ["scan", "import"] },
	{ id: "opencode", manager: "OpenCodeSessionImporter", ipcFile: ["ipc/sessionIpc.ts"], preloadNamespaces: ["openCodeSessions"], channelPrefix: ["opencode-sessions"], capabilities: ["scan", "import"] },
	{ id: "zcode", manager: "ZCodeSessionImporter", ipcFile: ["ipc/sessionIpc.ts"], preloadNamespaces: ["zcodeSessions"], channelPrefix: ["zcode-sessions"], capabilities: ["scan", "import"] },
	{ id: "workbuddy", manager: "WorkBuddySessionImporter", ipcFile: ["ipc/sessionIpc.ts"], preloadNamespaces: ["workbuddySessions"], channelPrefix: ["workbuddy-sessions"], capabilities: ["scan", "import"] },
	{ id: "cursor", manager: "CursorSessionImporter", ipcFile: ["ipc/sessionIpc.ts"], preloadNamespaces: ["cursorSessions"], channelPrefix: ["cursor-sessions"], capabilities: ["scan", "import"] },
	{ id: "kimi", manager: "KimiSessionImporter", ipcFile: ["ipc/sessionIpc.ts"], preloadNamespaces: ["kimiSessions"], channelPrefix: ["kimi-sessions"], capabilities: ["scan", "import"] },
	{ id: "kimi-work", manager: "KimiWorkSessionImporter", ipcFile: ["ipc/sessionIpc.ts"], preloadNamespaces: ["kimiWorkSessions"], channelPrefix: ["kimi-work-sessions"], capabilities: ["scan", "import", "describe"] },
	{ id: "minimax", manager: "MiniMaxSessionImporter", ipcFile: ["ipc/sessionIpc.ts"], preloadNamespaces: ["minimaxSessions"], channelPrefix: ["minimax-sessions"], capabilities: ["scan", "import"] },
	{ id: "directory-sessions", manager: "DirectorySessionImporter", ipcFile: ["ipc/sessionIpc.ts"], preloadNamespaces: ["directorySessions"], channelPrefix: ["directory-sessions"], capabilities: ["scan", "import", "listSources"] },
] as const satisfies readonly ImporterCatalogEntry[];

export type ImporterId = (typeof IMPORTER_CATALOG)[number]["id"];

export const IMPORTER_FACADE_METHODS = {
	codex: ["scan", "import"],
	claude: ["scan", "import"],
	qoder: ["scan", "import"],
	opencode: ["scan", "import"],
	zcode: ["scan", "import"],
	workbuddy: ["scan", "import"],
	cursor: ["scan", "import"],
	kimi: ["scan", "import"],
	"kimi-work": ["scan", "import", "describe"],
	minimax: ["scan", "import"],
	"directory-sessions": ["scan", "import", "listSources"],
} as const satisfies Record<ImporterId, readonly string[]>;

export const IMPORTER_NAMESPACES = {
	codex: "codexSessions",
	claude: "claudeSessions",
	qoder: "qoderSessions",
	opencode: "opencodeSessions",
	zcode: "zcodeSessions",
	workbuddy: "workbuddySessions",
	cursor: "cursorSessions",
	kimi: "kimiSessions",
	"kimi-work": "kimiWorkSessions",
	minimax: "minimaxSessions",
	"directory-sessions": "directorySessions",
} as const satisfies Record<ImporterId, string>;
