import type { DomainCatalogEntry } from "./domainTypes";

export const DOMAIN_CATALOG = [
	{ id: "pi", group: "core", manager: "AgentManager（pi RPC 运行时宿主；pi 安装/路径检查面注册在 systemIpc.ts）", ipcFile: ["systemIpc.ts"], preloadNamespaces: ["pi"], channelPrefix: ["pi"], aggregation: "redline" },

	{
		id: "sessions",
		group: "core",
		subdomains: ["catalog", "runtime", "rewind"],
		manager: "SessionCatalog + SessionScanner + SessionRuntimeCoordinator + SessionFileEditor/SessionHistoryReader/RewindCheckpointCoordinator",
		ipcFile: ["ipc/sessionIpc.ts", "index.ts"],
		preloadNamespaces: ["sessions"],
		channelPrefix: ["sessions", "agents"],
		aggregation: "consolidate",
	},

	{ id: "security", group: "core", manager: "SecurityStore", ipcFile: ["ipc/securityIpc.ts"], preloadNamespaces: ["security"], channelPrefix: ["security"], aggregation: "aggregate" },
	{ id: "system", group: "core", manager: "系统信息与运行时检查（systemIpc 汇聚面）", ipcFile: ["ipc/systemIpc.ts"], preloadNamespaces: ["system"], channelPrefix: ["system"], aggregation: "aggregate" },

	{ id: "app", group: "core", manager: "应用生命周期（systemIpc 汇聚面）", ipcFile: ["ipc/systemIpc.ts"], preloadNamespaces: ["app"], channelPrefix: ["app", "update", "renderer", "preload"], aggregation: "aggregate" },
	{ id: "logs", group: "core", manager: "AppLogger", ipcFile: ["ipc/systemIpc.ts"], preloadNamespaces: ["logs"], channelPrefix: ["logs"], aggregation: "aggregate" },
	{ id: "rpc-logs", group: "core", manager: "RpcLogger + ModelTraceStore + RpcLogLiveBroadcaster", ipcFile: ["ipc/systemIpc.ts"], preloadNamespaces: ["rpcLogs"], channelPrefix: ["rpc-logs"], aggregation: "aggregate" },

	{ id: "projects", group: "workspace", manager: "ProjectStore", ipcFile: ["ipc/projectsIpc.ts", "ipc/systemIpc.ts"], preloadNamespaces: ["projects"], channelPrefix: ["projects", "user-data-migration"], aggregation: "aggregate" },
	{ id: "project-resources", group: "workspace", manager: "ProjectResourceManager", ipcFile: ["ipc/projectResourceIpc.ts"], preloadNamespaces: ["projectResources"], channelPrefix: ["project-resources"], aggregation: "aggregate" },
	{ id: "git", group: "workspace", manager: "GitService + WorktreeService + GitRefsWatcher", ipcFile: ["ipc/gitIpc.ts"], preloadNamespaces: ["git"], channelPrefix: ["git"], aggregation: "aggregate" },
	{ id: "terminal", group: "workspace", manager: "TerminalSessionManager", ipcFile: ["ipc/terminalIpc.ts"], preloadNamespaces: ["terminal"], channelPrefix: ["terminal"], aggregation: "aggregate" },
	{ id: "editors", group: "workspace", manager: "外部编辑器检测", ipcFile: ["ipc/editorsIpc.ts"], preloadNamespaces: ["editors"], channelPrefix: ["editors"], aggregation: "aggregate" },
	{ id: "browser", group: "workspace", manager: "main/browser/（webview 宿主与导航白名单）", ipcFile: ["ipc/filesIpc.ts"], preloadNamespaces: ["browser"], channelPrefix: ["browser"], aggregation: "aggregate" },
	{ id: "files", group: "workspace", manager: "文件抽屉读写", ipcFile: ["ipc/filesIpc.ts"], preloadNamespaces: ["files"], channelPrefix: ["files"], aggregation: "aggregate" },

	{ id: "local-image", group: "workspace", manager: "本地图片字节读取（Markdown 图片保存/复制）", ipcFile: ["ipc/localImageIpc.ts"], preloadNamespaces: ["localImage"], channelPrefix: ["local-image"], aggregation: "aggregate" },
	{ id: "clipboard", group: "workspace", manager: "剪贴板（sendSync 同步读）", ipcFile: ["ipc/clipboardIpc.ts"], preloadNamespaces: ["clipboard"], channelPrefix: ["clipboard"], aggregation: "aggregate" },
	{ id: "paste-files", group: "workspace", manager: "粘贴文件收集", ipcFile: ["ipc/pasteFilesIpc.ts"], preloadNamespaces: ["pasteFiles"], channelPrefix: ["paste-files"], aggregation: "aggregate" },
	{ id: "wsl", group: "workspace", manager: "WslPaths", ipcFile: ["ipc/systemIpc.ts"], preloadNamespaces: ["wsl"], channelPrefix: ["wsl"], aggregation: "aggregate" },
	{ id: "data-env", group: "workspace", manager: "数据环境（userData 目录切换）", ipcFile: ["ipc/dataEnvIpc.ts"], preloadNamespaces: ["dataEnv"], channelPrefix: ["data-env"], aggregation: "aggregate" },
	{ id: "resource-import", group: "workspace", manager: "资源导入", ipcFile: ["ipc/resourceImportIpc.ts"], preloadNamespaces: ["resourceImport"], channelPrefix: ["resource-import"], aggregation: "aggregate" },
	{ id: "quick-task", group: "workspace", manager: "QuickTaskController", ipcFile: ["ipc/quickTaskIpc.ts"], preloadNamespaces: ["quickTask"], channelPrefix: ["quick-task"], aggregation: "aggregate" },
	{ id: "scratch-pad", group: "workspace", manager: "便签（ScratchPadStore）", ipcFile: ["ipc/scratchPadIpc.ts"], preloadNamespaces: ["scratchPad"], channelPrefix: ["scratch-pad"], aggregation: "aggregate" },
	{ id: "shell-menu", group: "workspace", manager: "Shell 上下文菜单", ipcFile: ["ipc/shellMenuIpc.ts"], preloadNamespaces: ["shellMenu"], channelPrefix: ["shell-menu"], aggregation: "aggregate" },

	{ id: "dialog", group: "workspace", manager: "系统文件选择器（无独立 Manager，dialog 命名空间消费）", ipcFile: ["ipc/filesIpc.ts", "ipc/backgroundsIpc.ts", "ipc/wallpaperEngineIpc.ts"], preloadNamespaces: ["dialog"], channelPrefix: ["dialog", "backgrounds", "wallpaper-engine"], aggregation: "aggregate" },
	{ id: "reply-actions", group: "workspace", manager: "快捷回复动作", ipcFile: ["ipc/replyActionsIpc.ts"], preloadNamespaces: ["replyActions"], channelPrefix: ["reply-actions"], aggregation: "aggregate" },

	{ id: "prompts", group: "content", manager: "PromptManager + XuePromptManager", ipcFile: ["ipc/storeIpc.ts"], preloadNamespaces: ["prompts"], channelPrefix: ["prompts"], aggregation: "aggregate" },
	{ id: "prompt-store", group: "content", manager: "promptStoreUpdater（提示词模板检索与导入）", ipcFile: ["ipc/storeIpc.ts"], preloadNamespaces: ["promptStore"], channelPrefix: ["prompt-store"], aggregation: "aggregate" },
	{ id: "yao-prompts", group: "content", manager: "YaoPromptsService", ipcFile: ["ipc/storeIpc.ts"], preloadNamespaces: ["yaoPrompts"], channelPrefix: ["yao-prompts"], aggregation: "aggregate" },
	{ id: "skills", group: "content", manager: "SkillManager + skillStoreUpdater", ipcFile: ["ipc/systemIpc.ts"], preloadNamespaces: ["skills"], channelPrefix: ["skills"], aggregation: "aggregate" },

	{ id: "skill-store", group: "content", manager: "skillStoreUpdater（技能商店条目检索与导入）", ipcFile: ["ipc/storeIpc.ts"], preloadNamespaces: ["skillStore"], channelPrefix: ["skill-store"], aggregation: "aggregate" },
	{ id: "skill-hub", group: "content", manager: "SkillHub 检索与安装", ipcFile: ["ipc/storeIpc.ts"], preloadNamespaces: ["skillHub"], channelPrefix: ["skill-hub"], aggregation: "aggregate" },
	{ id: "content-store", group: "content", manager: "BuiltinContentUpdater（prompts-store/skills-store 两通道域共用同一更新器）", ipcFile: ["ipc/contentStoreIpc.ts"], preloadNamespaces: ["contentStore"], channelPrefix: ["prompts-store", "skills-store"], aggregation: "aggregate" },
	{ id: "extensions", group: "content", manager: "ExtensionManager + BuiltInExtensionsUpdater", ipcFile: ["ipc/storeIpc.ts", "ipc/builtInExtensionIpc.ts"], preloadNamespaces: ["extensions"], channelPrefix: ["extensions"], aggregation: "aggregate" },

	{ id: "favorites", group: "content", manager: "FavoritesStore（<userData>/favorites.json）", ipcFile: ["ipc/favoritesIpc.ts"], preloadNamespaces: ["favorites"], channelPrefix: ["favorites"], aggregation: "aggregate" },
	{ id: "imagegen", group: "content", manager: "ImagegenService + 三个图存储 Store", ipcFile: ["ipc/imagegenIpc.ts"], preloadNamespaces: ["imagegen"], channelPrefix: ["imagegen"], aggregation: "aggregate" },
	{ id: "videogen", group: "content", manager: "VideoJobRunner + IlinkClient + VideoJobStore/VideoBlobStore/VideoSessionStore/VideoGenConfigStore", ipcFile: ["ipc/videogenIpc.ts"], preloadNamespaces: ["videogen"], channelPrefix: ["videogen"], aggregation: "aggregate" },

	{ id: "settings", group: "config", manager: "SettingsStore + VisionBridgeConfigManager", ipcFile: ["ipc/systemIpc.ts"], preloadNamespaces: ["settings"], channelPrefix: ["settings"], aggregation: "aggregate" },

	{
		id: "config",
		group: "config",
		manager: "ConfigManager + ConfigBackupManager + PiResourceConfigService + TokenDance 三 Store",
		ipcFile: ["ipc/systemIpc.ts", "ipc/backupIpc.ts", "ipc/visionIpc.ts"],
		preloadNamespaces: ["config"],
		channelPrefix: ["config", "mcp", "pi-resources", "vision"],
		aggregation: "consolidate",
	},
	{ id: "config-backup", group: "config", manager: "ConfigBackupManager", ipcFile: ["ipc/backupIpc.ts"], preloadNamespaces: ["configBackups"], channelPrefix: ["config-backup"], aggregation: "aggregate" },
	{ id: "custom-themes", group: "config", manager: "自定义主题包读写", ipcFile: ["ipc/themesIpc.ts"], preloadNamespaces: ["customThemes"], channelPrefix: ["themes"], aggregation: "aggregate" },
	{ id: "catalog", group: "config", manager: "PiAiCatalogUpdater（模型目录更新，分支白名单 main/dev）", ipcFile: ["ipc/catalogIpc.ts"], preloadNamespaces: ["catalog"], channelPrefix: ["catalog"], aggregation: "aggregate" },
	{ id: "pi-auth", group: "config", manager: "PiAuthService（NDJSON 子进程 pi-auth-host.mjs）", ipcFile: ["ipc/piAuthIpc.ts"], preloadNamespaces: ["piAuth"], channelPrefix: ["pi-auth"], aggregation: "redline" },

	{ id: "feishu", group: "integration", manager: "FeishuBridge/FeishuConnection/CardStream", ipcFile: ["ipc/feishuIpc.ts"], preloadNamespaces: ["feishu"], channelPrefix: ["feishu"], aggregation: "aggregate" },

	{ id: "web", group: "integration", manager: "WebServiceManager + WebEventStream/WebWorkspaceRoutes/WebI18n/WebNetwork", ipcFile: ["ipc/systemIpc.ts"], preloadNamespaces: ["settings"], channelPrefix: ["web"], aggregation: "aggregate" },
	{ id: "enhance", group: "integration", manager: "EnhancePromptService（常驻 sidecar pi-enhance-host.mjs）", ipcFile: ["ipc/enhanceIpc.ts"], preloadNamespaces: ["enhance"], channelPrefix: ["enhance"], aggregation: "redline" },

	{ id: "prompt-suggestion", group: "integration", manager: "EnhancePromptService（prompt-suggestion 独立实例，systemPrompt 由主进程常量注入）", ipcFile: ["ipc/promptSuggestionIpc.ts"], preloadNamespaces: ["suggestion"], channelPrefix: ["suggest"], aggregation: "redline" },

	{
		id: "agent-profiles",
		group: "integration",
		manager: "AgentProfileStore + AgentInvokeService（划词工具一次性调用，复用 pi-enhance-host sidecar 独立实例）",
		ipcFile: ["ipc/agentProfileIpc.ts", "ipc/agentInvokeIpc.ts"],
		preloadNamespaces: ["agentProfiles"],
		channelPrefix: ["agent-profiles"],
		aggregation: "aggregate",
	},

	{ id: "selection-tool", group: "integration", manager: "SelectionToolService + SelectionToolWindow（全局快捷键 + 系统级划词浮窗）", ipcFile: ["ipc/selectionToolIpc.ts"], preloadNamespaces: ["selectionTool"], channelPrefix: ["selection-tool"], aggregation: "aggregate" },
	{ id: "channel-switch", group: "integration", manager: "ChannelSwitchService + UpdateService（更新通道切换）", ipcFile: ["ipc/channelSwitchIpc.ts"], preloadNamespaces: ["channelSwitch"], channelPrefix: ["channel-switch"], aggregation: "aggregate" },
	{ id: "cua", group: "integration", manager: "CuaEngine + CuaGate + McpHttpHost + CuaService", ipcFile: ["ipc/cuaIpc.ts"], preloadNamespaces: ["cua"], channelPrefix: ["cua"], aggregation: "aggregate" },
	{ id: "usage-stats", group: "integration", manager: "用量统计", ipcFile: ["ipc/usageStatsIpc.ts"], preloadNamespaces: ["usageStats"], channelPrefix: ["usage-stats"], aggregation: "aggregate" },
	{ id: "voice-transcription", group: "integration", manager: "语音转写（5 类协作组件）", ipcFile: ["ipc/voiceTranscriptionIpc.ts"], preloadNamespaces: ["voiceTranscription"], channelPrefix: ["voice-transcription"], aggregation: "aggregate" },
	{ id: "automation", group: "integration", manager: "AutomationStore + AutomationScheduler + RunCoordinator", ipcFile: ["ipc/automationIpc.ts"], preloadNamespaces: ["automation"], channelPrefix: ["automation"], aggregation: "aggregate" },
	{ id: "acp", group: "integration", manager: "AcpAgentManager + AcpConnection/AcpProcessHost + AcpMessageSnapshotStore（外部 ACP CLI agent 接入）", ipcFile: ["ipc/acpIpc.ts"], preloadNamespaces: ["acp"], channelPrefix: ["acp"], aggregation: "aggregate" },
	{ id: "wechat", group: "integration", manager: "WeChatBridge + WeChatService/WeChatLogin", ipcFile: ["ipc/wechatIpc.ts"], preloadNamespaces: ["wechat"], channelPrefix: ["wechat"], aggregation: "aggregate" },
	{ id: "host-plugins", group: "integration", manager: "HostPluginManager + HostPluginService + HostPluginWebviewBridge", ipcFile: ["ipc/hostPluginsIpc.ts"], preloadNamespaces: ["hostPlugins"], channelPrefix: ["host-plugin", "host-plugins"], aggregation: "aggregate" },
	{ id: "pideck-mcp", group: "integration", manager: "PiDeckMcpService（PiDeck 对外 MCP 服务）", ipcFile: ["ipc/piDeckMcpIpc.ts"], preloadNamespaces: ["piDeckMcp"], channelPrefix: ["pideck-mcp"], aggregation: "aggregate" },

	{ id: "pet", group: "shell", manager: "PetSystem + PetWindow/PetPackageManager/PetPatrol/PetStateBridge", ipcFile: ["pet/index.ts", "index.ts"], preloadNamespaces: ["pet"], channelPrefix: ["pet"], aggregation: "aggregate" },
	{ id: "floating-ball", group: "shell", manager: "FloatingController", ipcFile: ["ipc/floatingIpc.ts"], preloadNamespaces: ["floatingBall"], channelPrefix: ["floating-ball"], aggregation: "aggregate" },
	{ id: "mini-overlay", group: "shell", manager: "MiniOverlayWindow", ipcFile: ["floating/MiniOverlayWindow.ts"], preloadNamespaces: ["miniOverlay"], channelPrefix: ["mini-overlay"], aggregation: "aggregate" },
	{ id: "sounds", group: "shell", manager: "音效（自定义音效导入/删除）", ipcFile: ["ipc/soundIpc.ts"], preloadNamespaces: ["sounds"], channelPrefix: ["sounds"], aggregation: "aggregate" },
	{ id: "announcements", group: "shell", manager: "AnnouncementService", ipcFile: ["ipc/announcementIpc.ts"], preloadNamespaces: ["announcements"], channelPrefix: ["announcement"], aggregation: "aggregate" },
	{ id: "quick-messages", group: "shell", manager: "快捷消息", ipcFile: ["ipc/quickMessagesIpc.ts"], preloadNamespaces: ["quickMessages"], channelPrefix: ["quick-messages"], aggregation: "aggregate" },
	{ id: "notice-history", group: "shell", manager: "NoticeHistoryStore（公告已读历史）", ipcFile: ["ipc/noticeHistoryIpc.ts"], preloadNamespaces: ["noticeHistory"], channelPrefix: ["notice-history"], aggregation: "aggregate" },
] as const satisfies readonly DomainCatalogEntry[];

export type DomainId = (typeof DOMAIN_CATALOG)[number]["id"];
