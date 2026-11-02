export const ipcChannels = {
	projectsList: "projects:list",
	projectsAdd: "projects:add",

	projectsAddByPath: "projects:add-by-path",
	projectsRemove: "projects:remove",
	projectsReorder: "projects:reorder",

	projectsRename: "projects:rename",

	projectsSetPinned: "projects:set-pinned",
	projectsChanged: "projects:changed",
	projectResourcesList: "project-resources:list",
	projectResourcesOpenDirectory: "project-resources:open-directory",
	projectResourcesCreateSkill: "project-resources:create-skill",
	projectResourcesDeleteSkill: "project-resources:delete-skill",
	projectResourcesToggleSkill: "project-resources:toggle-skill",
	projectResourcesDeleteExtension: "project-resources:delete-extension",
	projectResourcesToggleExtension: "project-resources:toggle-extension",
	projectResourcesToggleInherited: "project-resources:toggle-inherited",
	projectResourcesRenameSkill: "project-resources:rename-skill",
	projectResourcesDiscovery: "project-resources:discovery",
	projectsListRoot: "projects:list-root",
	projectsListWorktreeChildren: "projects:list-worktree-children",
	projectsToggleWorktreeEnabled: "projects:toggle-worktree-enabled",

	projectsChooseChatPath: "projects:choose-chat-path",

	projectsSetChatPath: "projects:set-chat-path",

	userDataMigrationConsumeNotice: "user-data-migration:consume-notice",
	editorsList: "editors:list",
	editorsRedetect: "editors:redetect",
	editorsUpdate: "editors:update",
	editorsChooseExecutable: "editors:choose-executable",
	editorsOpenProject: "editors:open-project",
	filesList: "files:list",

	filesSearch: "files:search",

	filesSearchContent: "files:search-content",
	filesOpen: "files:open",
	filesShowInFolder: "files:show-in-folder",

	filesDetectFileManager: "files:detect-file-manager",

	filesOpenFileManager: "files:open-file-manager",
	filesReadContent: "files:read-content",

	filesPathsExist: "files:paths-exist",

	filesStat: "files:stat",
	filesWriteContent: "files:write-content",
	filesCreate: "files:create",
	filesDelete: "files:delete",
	filesRename: "files:rename",

	filesCopy: "files:copy",

	filesMove: "files:move",

	filesReadBase64: "files:read-base64",

	pasteFilesWrite: "paste-files:write",

	pasteFilesDelete: "paste-files:delete",

	pasteFilesCleanup: "paste-files:cleanup",

	pasteFilesGetSize: "paste-files:get-size",

	pasteFilesClearAll: "paste-files:clear-all",

	noticeHistoryGet: "notice-history:get",

	noticeHistoryRecord: "notice-history:record",

	noticeHistoryClear: "notice-history:clear",

	noticeHistoryGetSize: "notice-history:get-size",

	catalogUpdateStatus: "catalog:update-status",

	catalogUpdateCheck: "catalog:update-check",

	catalogUpdateFromGithub: "catalog:update-from-github",

	catalogUpdateRestore: "catalog:update-restore",

	catalogUpdateRestorePrevious: "catalog:update-restore-previous",

	catalogOpenFile: "catalog:open-file",

	quickMessagesGet: "quick-messages:get",

	quickMessagesSave: "quick-messages:save",

	quickMessagesOpenFile: "quick-messages:open-file",

	replyActionsGet: "reply-actions:get",

	replyActionsSave: "reply-actions:save",

	replyActionsOpenFile: "reply-actions:open-file",
	sessionsList: "sessions:list",

	sessionsCatalogList: "sessions:catalog-list",

	sessionsCatalogRefreshed: "sessions:catalog-refreshed",
	sessionsCatalogCreateDraft: "sessions:catalog-create-draft",

	sessionsResolveLaunchDefaults: "sessions:resolve-launch-defaults",

	sessionsCreateAnonymous: "sessions:create-anonymous",
	sessionsCatalogUpdate: "sessions:catalog-update",
	sessionsCatalogDelete: "sessions:catalog-delete",

	sessionsCatalogArchive: "sessions:catalog-archive",

	sessionsCatalogUnarchive: "sessions:catalog-unarchive",

	sessionsCatalogListArchived: "sessions:catalog-list-archived",

	sessionsCatalogDeleteArchived: "sessions:catalog-delete-archived",
	sessionsCatalogReadMessages: "sessions:catalog-read-messages",
	sessionsCatalogReadMessagePage: "sessions:catalog-read-message-page",

	sessionsCatalogReadProcessEvents: "sessions:catalog-read-process-events",
	sessionsCatalogReadOutline: "sessions:catalog-read-outline",

	sessionsListSubagents: "sessions:list-subagents",

	sessionsListSessionTodo: "sessions:list-session-todo",
	sessionsCatalogReadReferenceMessages: "sessions:catalog-read-reference-messages",

	sessionsCatalogReadMessageFullText: "sessions:catalog-read-message-full-text",
	sessionsCatalogCopy: "sessions:catalog-copy",
	sessionsCatalogExportHtml: "sessions:catalog-export-html",

	sessionsCatalogEditMessage: "sessions:catalog-edit-message",

	sessionsCatalogRemoveMessageImage: "sessions:catalog-remove-message-image",

	sessionsCatalogDeleteMessage: "sessions:catalog-delete-message",

	sessionsCatalogPrepareResend: "sessions:catalog-prepare-resend",
	sessionsSendPrompt: "sessions:send-prompt",
	sessionsRuntimeEvent: "sessions:runtime-event",
	sessionsUiResponse: "sessions:ui-response",
	sessionsRuntimeList: "sessions:runtime-list",
	sessionsRuntimeActivate: "sessions:runtime-activate",
	sessionsRuntimeStop: "sessions:runtime-stop",
	sessionsRuntimeAbort: "sessions:runtime-abort",
	sessionsRuntimeRestart: "sessions:runtime-restart",
	sessionsRuntimeCompact: "sessions:runtime-compact",
	sessionsRuntimeState: "sessions:runtime-state",
	sessionsRuntimeCommands: "sessions:runtime-commands",
	sessionsRuntimePromptTemplates: "sessions:runtime-prompt-templates",
	sessionsDraftPromptTemplates: "sessions:draft-prompt-templates",

	sessionsRuntimeReloadResources: "sessions:runtime-reload-resources",

	sessionsDraftCommands: "sessions:draft-commands",

	sessionsRewindList: "sessions:rewind-list",
	sessionsRewindDiff: "sessions:rewind-diff",
	sessionsRewindRestore: "sessions:rewind-restore",

	sessionsRuntimeListModels: "sessions:runtime-list-models",

	sessionsRuntimeThinkingLevels: "sessions:runtime-thinking-levels",

	sessionsGetBranchTree: "sessions:get-branch-tree",
	sessionsRuntimeExportHtml: "sessions:runtime-export-html",
	sessionsRuntimeEditMessage: "sessions:runtime-edit-message",
	sessionsRuntimeDeleteMessage: "sessions:runtime-delete-message",
	sessionsRuntimePrepareResend: "sessions:runtime-prepare-resend",
	sessionsRuntimeSetModel: "sessions:runtime-set-model",
	sessionsRuntimeSetThinking: "sessions:runtime-set-thinking",
	sessionsRuntimeClone: "sessions:runtime-clone",

	sessionsRuntimeGetForkMessages: "sessions:runtime-get-fork-messages",
	sessionsRuntimeFork: "sessions:runtime-fork",

	sessionsSetFocusedSession: "sessions:set-focused-session",
	sessionsSearchContent: "sessions:search-content",
	sessionsSearchInSession: "sessions:search-in-session",

	automationGetSnapshot: "automation:get-snapshot",
	automationCreateTask: "automation:create-task",
	automationUpdateTask: "automation:update-task",
	automationDeleteTask: "automation:delete-task",
	automationRunNow: "automation:run-now",
	automationAbortRun: "automation:abort-run",
	automationDeleteRuns: "automation:delete-runs",
	automationClearRuns: "automation:clear-runs",
	automationUpdateSettings: "automation:update-settings",
	automationPreviewCron: "automation:preview-cron",
	automationChanged: "automation:changed",

	agentProfilesGetSnapshot: "agent-profiles:get-snapshot",
	agentProfilesCreate: "agent-profiles:create",
	agentProfilesUpdate: "agent-profiles:update",
	agentProfilesDelete: "agent-profiles:delete",
	agentProfilesResetBuiltin: "agent-profiles:reset-builtin",
	agentProfilesDuplicate: "agent-profiles:duplicate",
	agentProfilesUpdateSettings: "agent-profiles:update-settings",
	agentProfilesChanged: "agent-profiles:changed",

	agentProfilesInvoke: "agent-profiles:invoke",
	agentProfilesInvokeCancel: "agent-profiles:invoke-cancel",
	agentProfilesInvokeEvent: "agent-profiles:invoke-event",

	agentProfilesBindSession: "agent-profiles:bind-session",

	agentProfilesReorder: "agent-profiles:reorder",

	favoritesList: "favorites:list",
	favoritesAdd: "favorites:add",
	favoritesRemove: "favorites:remove",
	favoritesRemoveMany: "favorites:remove-many",
	favoritesReorder: "favorites:reorder",

	selectionToolGetState: "selection-tool:get-state",
	selectionToolHide: "selection-tool:hide",
	selectionToolResize: "selection-tool:resize",
	selectionToolInsertToMain: "selection-tool:insert-to-main",
	selectionToolCaptured: "selection-tool:captured",
	selectionToolStateChanged: "selection-tool:state-changed",

	selectionToolInserted: "selection-tool:inserted",

	codexSessionsScan: "codex-sessions:scan",
	codexSessionsImport: "codex-sessions:import",
	claudeSessionsScan: "claude-sessions:scan",
	claudeSessionsImport: "claude-sessions:import",
	qoderSessionsScan: "qoder-sessions:scan",
	qoderSessionsImport: "qoder-sessions:import",
	openCodeSessionsScan: "opencode-sessions:scan",
	openCodeSessionsImport: "opencode-sessions:import",
	zcodeSessionsScan: "zcode-sessions:scan",
	zcodeSessionsImport: "zcode-sessions:import",
	workbuddySessionsScan: "workbuddy-sessions:scan",
	workbuddySessionsImport: "workbuddy-sessions:import",
	cursorSessionsScan: "cursor-sessions:scan",
	cursorSessionsImport: "cursor-sessions:import",
	kimiSessionsScan: "kimi-sessions:scan",
	kimiSessionsImport: "kimi-sessions:import",

	kimiWorkSessionsDescribe: "kimi-work-sessions:describe",
	kimiWorkSessionsScan: "kimi-work-sessions:scan",
	kimiWorkSessionsImport: "kimi-work-sessions:import",

	minimaxSessionsScan: "minimax-sessions:scan",
	minimaxSessionsImport: "minimax-sessions:import",

	directorySessionsScan: "directory-sessions:scan",

	directorySessionsListSources: "directory-sessions:list-sources",

	directorySessionsImport: "directory-sessions:import",
	settingsGet: "settings:get",
	settingsUpdate: "settings:update",

	settingsRestartWebService: "settings:restart-web-service",

	webServiceStatus: "web:status",

	webServiceRotateToken: "web:rotate-token",

	webServiceSetToken: "web:set-token",

	webRemoteAccessState: "web:remote-access-state",

	webRemoteAccessChanged: "web:remote-access-changed",

	webRemoteAccessStart: "web:remote-access-start",

	webRemoteAccessStop: "web:remote-access-stop",

	webRemoteAccessRefresh: "web:remote-access-refresh",
	settingsTestPiProxy: "settings:test-pi-proxy",
	settingsApplyWindow: "settings:apply-window",
	skillsList: "skills:list",
	skillsReadContent: "skills:read-content",
	skillsCreate: "skills:create",
	skillsToggle: "skills:toggle",
	skillsDelete: "skills:delete",
	skillsOpenFolder: "skills:open-folder",
	skillsRename: "skills:rename",
	promptsList: "prompts:list",
	promptsCreate: "prompts:create",
	promptsDelete: "prompts:delete",
	promptsOpenFolder: "prompts:open-folder",
	promptsEdit: "prompts:edit",
	promptsListByProject: "prompts:list-by-project",
	promptsCreateInProject: "prompts:create-in-project",
	promptsDeleteInProject: "prompts:delete-in-project",
	promptsRename: "prompts:rename",
	promptsRenameInProject: "prompts:rename-in-project",
	promptsToggle: "prompts:toggle",
	promptsToggleInProject: "prompts:toggle-in-project",
	promptStoreSearch: "prompt-store:search",
	promptStoreGet: "prompt-store:get",
	promptStoreImport: "prompt-store:import",
	yaoPromptsList: "yao-prompts:list",
	yaoPromptsDetail: "yao-prompts:detail",
	yaoPromptsImport: "yao-prompts:import",

	yaoPromptsDbState: "yao-prompts:db-state",

	yaoPromptsDbRetry: "yao-prompts:db-retry",
	skillStoreSearch: "skill-store:search",
	skillStoreImport: "skill-store:import",

	skillHubSearch: "skill-hub:search",
	skillHubDetail: "skill-hub:detail",
	skillHubInstall: "skill-hub:install",

	skillHubInstallProgress: "skill-hub:install-progress",
	extensionsList: "extensions:list",
	extensionsUninstall: "extensions:uninstall",
	extensionsInstall: "extensions:install",
	extensionsToggle: "extensions:toggle",
	extensionsRemoveBuiltIn: "extensions:remove-built-in",
	extensionsRestoreBuiltIn: "extensions:restore-built-in",
	extensionsUpdate: "extensions:update",
	extensionsUpdateOne: "extensions:update-one",
	extensionsCatalog: "extensions:catalog",

	extensionsBuiltInUpdateStatus: "extensions:builtin-update-status",

	extensionsBuiltInUpdateCheck: "extensions:builtin-update-check",

	extensionsBuiltInUpdateApply: "extensions:builtin-update-apply",

	extensionsBuiltInUpdateRestore: "extensions:builtin-update-restore",

	extensionsBuiltInUpdateRestorePrevious: "extensions:builtin-update-restore-previous",

	extensionsBuiltInOpenDir: "extensions:builtin-open-dir",

	promptsStoreUpdateStatus: "prompts-store:update-status",

	promptsStoreUpdateCheck: "prompts-store:update-check",

	promptsStoreUpdateApply: "prompts-store:update-apply",

	promptsStoreUpdateRestore: "prompts-store:update-restore",

	promptsStoreUpdateRestorePrevious: "prompts-store:update-restore-previous",

	promptsStoreOpenDir: "prompts-store:open-dir",

	skillsStoreUpdateStatus: "skills-store:update-status",

	skillsStoreUpdateCheck: "skills-store:update-check",

	skillsStoreUpdateApply: "skills-store:update-apply",

	skillsStoreUpdateRestore: "skills-store:update-restore",

	skillsStoreUpdateRestorePrevious: "skills-store:update-restore-previous",

	skillsStoreOpenDir: "skills-store:open-dir",

	gitListRepos: "git:list-repos",
	gitBranches: "git:branches",
	gitCheckout: "git:checkout",
	gitCreateBranch: "git:create-branch",
	gitOriginalContent: "git:original-content",
	gitWorktreeList: "git:worktree-list",
	gitWorktreeCreate: "git:worktree-create",
	gitWorktreeRemove: "git:worktree-remove",
	gitCommitLog: "git:commit-log",

	gitCommitCount: "git:commit-count",
	gitRefs: "git:refs",
	gitBranchCompare: "git:branch-compare",
	gitCommitDetail: "git:commit-detail",
	gitCommitFileDiff: "git:commit-file-diff",
	gitDiffFileBetween: "git:diff-file-between",
	gitStatus: "git:status",
	gitWorkspaceFileDiff: "git:workspace-file-diff",
	gitStage: "git:stage",
	gitUnstage: "git:unstage",
	gitDiscard: "git:discard",

	gitDiscardFiles: "git:discard-files",
	gitCommit: "git:commit",
	gitCherryPick: "git:cherry-pick",
	gitRevert: "git:revert",
	gitPush: "git:push",
	gitPull: "git:pull",
	gitReset: "git:reset",
	gitDropCommit: "git:drop-commit",
	gitGenerateCommitMessage: "git:generate-commit-message",
	gitInit: "git:init",
	gitFetch: "git:fetch",

	gitAheadBehind: "git:ahead-behind",

	gitWatchRefs: "git:watch-refs",

	gitUnwatchRefs: "git:unwatch-refs",

	gitRefsChanged: "git:refs-changed",

	gitDeleteFiles: "git:delete-files",

	gitDetectExecutable: "git:detect-executable",

	gitChooseExecutable: "git:choose-executable",
	piCheck: "pi:check",
	piCheckCustom: "pi:check-custom",

	piInstallations: "pi:installations",

	piChooseExecutable: "pi:choose-executable",

	piSetCustomPaths: "pi:set-custom-paths",

	wslListDistros: "wsl:list-distros",

	wslValidateConnection: "wsl:validate-connection",
	piUpdateCheck: "pi:update-check",
	piReleaseNotes: "pi:release-notes",
	piUpdate: "pi:update",

	piExecInstall: "pi:exec-install",

	piCheckNpm: "pi:check-npm",

	piRuntimeNodeCheck: "pi:runtime-node-check",

	piRuntimeNodeInstall: "pi:runtime-node-install",

	piRuntimePiInstall: "pi:runtime-pi-install",
	appInfo: "app:info",

	appNetworkAddresses: "app:network-addresses",
	appPreferredSystemLanguages: "app:preferred-system-languages",
	appCheckUpdate: "app:check-update",

	appGetChannel: "update:get-channel",

	appDownloadUpdate: "app:download-update",

	appInstallUpdate: "app:install-update",

	appUpdateStatusChanged: "app:update-status-changed",

	appUpdateNotifySeen: "app:update-notify-seen",

	appUpdateSkipVersion: "app:update-skip-version",

	appCheckUpdateMirrors: "app:check-update-mirrors",
	appFeedbackEnvironment: "app:feedback-environment",

	appFeedbackProjectContext: "app:feedback-project-context",
	appOpenExternal: "app:open-external",

	appGetChangelog: "app:get-changelog",
	appOpenInBrowser: "app:open-in-browser",

	appOpenSettings: "app:open-settings",

	appShortcutTriggered: "app:shortcut-triggered",
	appRestart: "app:restart",

	appQuit: "app:quit",

	appOpenDataDir: "app:open-data-dir",

	processMetrics: "system:process-metrics",

	diagnosticsSnapshot: "system:diagnostics-snapshot",

	archStatus: "system:arch-status",

	diagnosticsOpenFolder: "system:diagnostics-open-folder",

	stopAgent: "system:stop-agent",

	healthCheck: "system:health-check",

	healthExportReport: "system:health-export-report",

	healthExportBundle: "system:health-export-bundle",
	preloadReady: "preload:ready",
	preloadError: "preload:error",
	rendererLog: "renderer:log",
	logsList: "logs:list",
	logsListPage: "logs:list-page",
	logsClear: "logs:clear",
	logsOpenFolder: "logs:open-folder",

	logsSize: "logs:get-size",

	rpcLogsGetSize: "rpc-logs:get-size",

	rpcLogsGet: "rpc-logs:get",

	rpcLogsGetLive: "rpc-logs:get-live",

	rpcLogsGetModelTrace: "rpc-logs:get-model-trace",

	rpcLogsSave: "rpc-logs:save",

	rpcLogsClear: "rpc-logs:clear",
	rpcLoggingSet: "rpc-logs:logging-set",
	rpcLoggingGet: "rpc-logs:logging-get",

	rpcLogsSetWatching: "rpc-logs:set-watching",

	appWindowMinimize: "app:window-minimize",
	appWindowToggleMaximize: "app:window-toggle-maximize",
	appWindowIsMaximized: "app:window-is-maximized",

	appWindowMaximizedChanged: "app:window-maximized-changed",

	appZoomFactorChanged: "app:zoom-factor-changed",
	appWindowToggleAlwaysOnTop: "app:window-toggle-always-on-top",

	appWindowIsAlwaysOnTop: "app:window-is-always-on-top",
	appWindowClose: "app:window-close",
	agentsRuntimeState: "agents:runtime-state",
	agentsState: "agents:state",
	projectsListModels: "projects:list-models",

	projectsListModelsReport: "projects:list-models-report",

	projectsGetModelSpec: "projects:get-model-spec",
	agentsMessage: "agents:message",
	agentsLog: "agents:log",

	agentsThinking: "agents:thinking",

	agentsTextStream: "agents:text-stream",

	agentsNotice: "agents:notice",

	agentsUiRequest: "agents:ui-request",

	projectsTrustRequest: "projects:trust-request",

	projectsTrustResponse: "projects:trust-response",

	configGetModels: "config:get-models",
	configGetAuth: "config:get-auth",
	configGetSettings: "config:get-settings",
	configGetTrust: "config:get-trust",

	configGetMcp: "config:get-mcp",

	configSaveMcp: "config:save-mcp",

	configProbeMcp: "config:probe-mcp",

	mcpListStatus: "mcp:list-status",

	mcpLogin: "mcp:login",

	mcpLogout: "mcp:logout",

	mcpLoginUrl: "mcp:login-url",
	resourceImportScan: "resource-import:scan",
	resourceImportApply: "resource-import:apply",

	piResourcesSummary: "pi-resources:summary",

	piResourcesSetBuiltin: "pi-resources:set-builtin",

	configGetDir: "config:get-dir",
	configSaveModels: "config:save-models",

	configModelsVerifyResult: "config:models-verify-result",
	configSaveAuth: "config:save-auth",
	configSaveSettings: "config:save-settings",
	configSaveRaw: "config:save-raw",
	configExport: "config:export",
	configImport: "config:import",

	configDiscoverExternalAgents: "config:discover-external-agents",

	configResolveExternalAgentKey: "config:resolve-external-agent-key",

	configFetchModels: "config:fetch-models",
	configQoderProviderSetup: "config:qoder-provider-setup",
	configQoderProviderStatus: "config:qoder-provider-status",

	configGetTokendanceModels: "config:get-tokendance-models",
	configInstallTokendance: "config:install-tokendance",

	configTokendanceAuthStart: "config:tokendance-auth-start",

	configTokendanceAuthAwait: "config:tokendance-auth-await",

	configTokendanceAuthCancel: "config:tokendance-auth-cancel",

	configTokendanceAuthExchange: "config:tokendance-auth-exchange",

	configTokendanceTopUpCreate: "config:tokendance-topup-create",

	configTokendanceTopUpStatus: "config:tokendance-topup-status",

	configTokendanceTopUpOpenAlipay: "config:tokendance-topup-open-alipay",

	configTestProvider: "config:test-provider",

	configFetchUsage: "config:fetch-usage",

	configGetUsageProbes: "config:get-usage-probes",

	configSaveUsageProbes: "config:save-usage-probes",

	configListUsageProbeStates: "config:list-usage-probe-states",

	configTestUsageProbe: "config:test-usage-probe",

	configInstallUsageSkill: "config:install-usage-skill",

	configInstallImageGenSkill: "config:install-image-gen-skill",

	configInstallMcpSetupSkill: "config:install-mcp-setup-skill",

	configBackupList: "config-backup:list",

	configBackupCreate: "config-backup:create",

	configBackupRead: "config-backup:read",

	configBackupRestore: "config-backup:restore",

	configBackupDelete: "config-backup:delete",

	configBackupDeleteMany: "config-backup:delete-many",

	configBackupDeleteAll: "config-backup:delete-all",

	securityGetConfig: "security:get-config",

	securityUpdateConfig: "security:update-config",

	securitySetSessionLevel: "security:set-session-level",

	visionGetConfig: "vision:get-config",

	visionSaveConfig: "vision:save-config",

	visionGetLog: "vision:get-log",

	visionGetEvents: "vision:get-events",

	visionClearEvents: "vision:clear-events",

	visionClearLog: "vision:clear-log",

	appToggleDevTools: "app:toggle-devtools",

	agentsRpcLog: "agents:rpc-log",

	terminalList: "terminal:list",
	terminalEnsure: "terminal:ensure",
	terminalCreate: "terminal:create",
	terminalInput: "terminal:input",
	terminalResize: "terminal:resize",
	terminalClose: "terminal:close",
	terminalData: "terminal:data",
	terminalExit: "terminal:exit",
	terminalShells: "terminal:shells",
	terminalFonts: "terminal:fonts",

	feishuConnect: "feishu:connect",

	feishuConnectTemp: "feishu:connect-temp",
	feishuDisconnect: "feishu:disconnect",
	feishuStatus: "feishu:status",
	feishuStatusRequest: "feishu:status-request",
	feishuBotsList: "feishu:bots-list",
	feishuBotAdd: "feishu:bot-add",
	feishuBotRemove: "feishu:bot-remove",
	feishuBotConfig: "feishu:bot-config",
	feishuBotSecret: "feishu:bot-secret",
	feishuTestConnection: "feishu:test-connection",
	feishuBindingsList: "feishu:bindings-list",
	feishuBindingRemove: "feishu:binding-remove",
	feishuBindingUpdate: "feishu:binding-update",
	feishuBindingsChanged: "feishu:bindings-changed",
	feishuBotsChanged: "feishu:bots-changed",
	feishuMessages: "feishu:messages",
	feishuConnectByBot: "feishu:connect-by-bot",

	feishuSessionBotGet: "feishu:session-bot-get",

	feishuSessionBotSet: "feishu:session-bot-set",

	feishuWhoamiResult: "feishu:whoami-result",

	wechatGetSettings: "wechat:get-settings",
	wechatSetEnabled: "wechat:set-enabled",
	wechatUpdateSettings: "wechat:update-settings",
	wechatRenameAccount: "wechat:rename-account",
	wechatLogout: "wechat:logout",

	wechatBeginLogin: "wechat:begin-login",
	wechatCancelLogin: "wechat:cancel-login",
	wechatSubmitVerifyCode: "wechat:submit-verify-code",
	wechatGetLoginState: "wechat:get-login-state",
	wechatGetStatus: "wechat:get-status",
	wechatGetBindings: "wechat:get-bindings",
	wechatUnbindChat: "wechat:unbind-chat",

	wechatStatus: "wechat:status",

	wechatLoginState: "wechat:login-state",

	wechatBindingsChanged: "wechat:bindings-changed",

	petState: "pet:state",

	petList: "pet:list",

	petSetEnabled: "pet:set-enabled",

	petSetId: "pet:set-id",

	petMoveWindow: "pet:move-window",

	petMoveBy: "pet:move-by",

	petFocusAgent: "pet:focus-agent",

	petFocusAgentTarget: "pet:focus-agent-target",

	petGetFocusTargetPending: "pet:get-focus-target-pending",

	petCurrentSprite: "pet:current-sprite",

	petGetCurrent: "pet:get-current",

	petNotify: "pet:notify",

	petPreviewMode: "pet:preview-mode",

	petCaps: "pet:caps",

	petTease: "pet:tease",

	petDragState: "pet:drag-state",

	petReady: "pet:ready",

	petContextMenu: "pet:context-menu",

	soundsPlay: "sounds:play",

	soundsListCustom: "sounds:list-custom",

	soundsImportCustom: "sounds:import-custom",

	soundsRemoveCustom: "sounds:remove-custom",

	scratchPadList: "scratch-pad:list",
	scratchPadCreate: "scratch-pad:create",
	scratchPadDelete: "scratch-pad:delete",
	scratchPadLoad: "scratch-pad:load",
	scratchPadSave: "scratch-pad:save",
	scratchPadExport: "scratch-pad:export",

	petTestNotify: "pet:test-notify",

	dialogPickFiles: "dialog:pick-files",

	pickBackgroundImage: "backgrounds:pick",

	removeBackgroundImage: "backgrounds:remove",

	wallpaperEnginePickDir: "wallpaper-engine:pick-dir",

	wallpaperEngineList: "wallpaper-engine:list",

	wallpaperEngineSelect: "wallpaper-engine:select",

	listCustomThemes: "themes:list",

	readCustomTheme: "themes:read",

	saveCustomTheme: "themes:save",

	deleteCustomTheme: "themes:delete",

	writeCustomThemeGuide: "themes:write-guide",

	piDeckMcpState: "pideck-mcp:state",
	piDeckMcpSetAccess: "pideck-mcp:set-access",
	piDeckMcpConnection: "pideck-mcp:connection",
	hostPluginsList: "host-plugins:list",
	hostPluginsRescan: "host-plugins:rescan",
	hostPluginsInstall: "host-plugins:install",

	hostPluginsInstallDirectory: "host-plugins:install-directory",

	hostPluginsInstallGitHub: "host-plugins:install-github",

	hostPluginsScaffold: "host-plugins:scaffold",
	hostPluginsSetEnabled: "host-plugins:set-enabled",
	hostPluginsOpenDirectory: "host-plugins:open-directory",
	hostPluginsMount: "host-plugins:mount",
	hostPluginsUpdate: "host-plugins:update",
	hostPluginsUnmount: "host-plugins:unmount",

	hostPluginsRemove: "host-plugins:remove",
	hostPluginsChanged: "host-plugins:changed",
	hostPluginRequest: "host-plugin:request",
	hostPluginEvent: "host-plugin:event",

	hostPluginNavigate: "host-plugin:navigate",

	hostPluginOpenBrowser: "host-plugin:open-browser",

	browserOpenExternal: "browser:open-external",

	usageStatsDetect: "usage-stats:detect",
	usageStatsRefresh: "usage-stats:refresh",
	usageStatsGet: "usage-stats:get",

	aiAaaUsageGet: "ai-aaa-usage:get",

	qoderUsageGet: "qoder-usage:get",

	imagegenGenerate: "imagegen:generate",

	imagegenGetConfig: "imagegen:get-config",

	imagegenSaveConfig: "imagegen:save-config",

	imagegenReadImageBlob: "imagegen:read-image-blob",

	localImageReadBytes: "local-image:read-bytes",

	videogenSubmit: "videogen:submit",

	videogenCancel: "videogen:cancel",

	videogenGetConfig: "videogen:get-config",

	videogenSaveConfig: "videogen:save-config",

	videogenListJobs: "videogen:list-jobs",

	videogenEvent: "videogen:event",

	enhanceRun: "enhance:run",

	enhanceCancel: "enhance:cancel",

	enhanceEvent: "enhance:event",

	suggestRun: "suggest:run",

	suggestCancel: "suggest:cancel",

	suggestEvent: "suggest:event",

	voiceTranscriptionGetConfig: "voice-transcription:get-config",
	voiceTranscriptionSaveConfig: "voice-transcription:save-config",
	voiceTranscriptionTranscribe: "voice-transcription:transcribe",

	voiceTranscriptionTest: "voice-transcription:test",

	voiceTranscriptionRevealSecret: "voice-transcription:reveal-secret",
	voiceTranscriptionCancel: "voice-transcription:cancel",

	voiceTranscriptionStreamStart: "voice-transcription:stream-start",
	voiceTranscriptionStreamFrame: "voice-transcription:stream-frame",
	voiceTranscriptionStreamFinish: "voice-transcription:stream-finish",

	voiceTranscriptionStreamPartial: "voice-transcription:stream-partial",

	voiceTranscriptionRuntimeStatus: "voice-transcription:runtime-status",

	voiceTranscriptionRuntimeInstall: "voice-transcription:runtime-install",

	voiceTranscriptionModelInstall: "voice-transcription:model-install",

	voiceTranscriptionModelDelete: "voice-transcription:model-delete",

	voiceTranscriptionRuntimeProgress: "voice-transcription:runtime-progress",

	voiceTranscriptionInstallCancel: "voice-transcription:install-cancel",

	announcementList: "announcement:list",

	announcementRefresh: "announcement:refresh",

	announcementMarkRead: "announcement:mark-read",

	announcementMarkAllRead: "announcement:mark-all-read",

	announcementMarkNotified: "announcement:mark-notified",

	announcementChanged: "announcement:changed",

	clipboardReadText: "clipboard:read-text",
	clipboardReadHtml: "clipboard:read-html",
	clipboardReadImage: "clipboard:read-image",
	clipboardReadFilePaths: "clipboard:read-file-paths",
	clipboardWriteImage: "clipboard:write-image",

	clipboardWriteText: "clipboard:write-text",

	shellMenuGetState: "shell-menu:get-state",
	quickTaskGetState: "quick-task:get-state",
	quickTaskChanged: "quick-task:changed",
	quickTaskExit: "quick-task:exit",
	shellMenuQuickTaskGetState: "shell-menu:quick-task-get-state",
	shellMenuQuickTaskSetEnabled: "shell-menu:quick-task-set-enabled",

	floatingBallGetState: "floating-ball:get-state",
	floatingBallState: "floating-ball:state",
	floatingBallEnter: "floating-ball:enter",
	floatingBallExit: "floating-ball:exit",
	floatingBallDragStart: "floating-ball:drag-start",
	floatingBallDragMove: "floating-ball:drag-move",
	floatingBallDragEnd: "floating-ball:drag-end",
	floatingBallContextMenu: "floating-ball:context-menu",
	floatingBallSetExpandTarget: "floating-ball:set-expand-target",

	miniOverlayState: "mini-overlay:state",
	miniOverlayGetState: "mini-overlay:get-state",
	miniOverlayJumpToSession: "mini-overlay:jump-to-session",
	miniOverlayQuickPrompt: "mini-overlay:quick-prompt",
	miniOverlayClose: "mini-overlay:close",
	miniOverlayCollapse: "mini-overlay:collapse",

	miniOverlaySwitchToQuickTask: "mini-overlay:switch-to-quick-task",

	quickTaskSwitchToMiniOverlay: "quick-task:switch-to-mini-overlay",
	floatingBallSetEnabled: "floating-ball:set-enabled",

	shellMenuSetEnabled: "shell-menu:set-enabled",

	piAuthListProviders: "pi-auth:list-providers",
	piAuthLogin: "pi-auth:login",
	piAuthAnswerPrompt: "pi-auth:answer-prompt",
	piAuthCancel: "pi-auth:cancel",
	piAuthLogout: "pi-auth:logout",

	piAuthFlowUpdate: "pi-auth:flow-update",

	dataEnvGetInfo: "data-env:get-info",

	dataEnvChooseMode: "data-env:choose-mode",

	dataEnvRestart: "data-env:restart",

	dataEnvConfirmMismatch: "data-env:confirm-mismatch",

	dataEnvDecisionRequired: "data-env:decision-required",

	dataEnvMismatchDetected: "data-env:mismatch-detected",

	dataEnvImportStart: "data-env:import-start",

	dataEnvImportCancel: "data-env:import-cancel",

	dataEnvImportProgress: "data-env:import-progress",

	dataEnvGetImportPreview: "data-env:get-import-preview",

	channelSwitchQuery: "channel-switch:query",

	channelSwitchDownload: "channel-switch:download",

	channelSwitchLaunch: "channel-switch:launch",

	channelSwitchGetStatus: "channel-switch:get-status",

	channelSwitchStateChanged: "channel-switch:state-changed",

	cuaApprovalRequest: "cua:approval-request",

	cuaApprovalResponse: "cua:approval-response",

	cuaGetState: "cua:get-state",

	cuaSetState: "cua:set-state",

	acpToolsList: "acp:tools-list",

	acpToolsSave: "acp:tools-save",

	acpToolValidate: "acp:tool-validate",

	acpToolDetect: "acp:tool-detect",

	acpToolInstall: "acp:tool-install",

	acpToolUninstall: "acp:tool-uninstall",

	acpLifecycleEvent: "acp:lifecycle-event",

	acpSessionConfigGet: "acp:session-config-get",

	acpSessionConfigSet: "acp:session-config-set",

	acpSessionConfigChanged: "acp:session-config-changed",
} as const;
