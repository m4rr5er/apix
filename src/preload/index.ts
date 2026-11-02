import { contextBridge, ipcRenderer, webUtils } from "electron";
import { ipcChannels } from "../shared/ipc";
import type { TokendanceAuthMode, TokendancePaymentSessionResult } from "../shared/tokendance";
import type { SkillHubSearchOptions } from "../shared/types/skills";
import type { AcpToolConfig, AcpToolInput, AcpToolValidation } from "../shared/types/acp";
import type { AnnouncementState } from "../shared/types/announcement";
import type { AiAaaUsageResult } from "../shared/types/aiAaaUsage";
import type { QoderUsageResult } from "../shared/types/qoderUsage";
import type { QoderProviderSetupInput, QoderProviderSetupResult, QoderProviderStatus } from "../shared/types/qoderProvider";
import type { HostPluginContext, HostPluginDesktopApi } from "../shared/types/hostPlugin";
import type { PiDeckMcpDesktopApi } from "../shared/types/piDeckMcp";
import type { RpcLogBatch, RpcLogEntry } from "../shared/types/rpcLog";
import type { ModelTraceRecord } from "../shared/types/modelTrace";
import type { UserDataNameMigrationNotice } from "../shared/types/userDataMigration";
import type { DataEnvChoiceFailure, DataEnvChoiceResult, DataEnvInfo, DataEnvMode, ImportPreviewResult, ImportProgress, ImportStartResult } from "../shared/types/dataEnv";
import type { GitExecutableInfo } from "../shared/types/git";
import type { LocalImageBytes } from "../shared/localImage";
import type { ImageBlobPayload, ImageGenConfigFile, ImageGenRequest, ImageGenResult, ImageGenSaveResult } from "../shared/types/imagegen";
import type { VideoGenConfigFile, VideoGenRequest, VideoGenSaveResult, VideoGenSubmitResult, VideoGenJobSnapshot } from "../shared/types/videogen";
import type { CustomThemeListItem } from "../shared/customThemes";
import type { CatalogCheckResult, CatalogUpdateResult, CatalogUpdateStatus } from "../shared/types/catalog";
import type { WallpaperEngineItem, WallpaperEngineListResult } from "../shared/wallpaperEngine";
import type { BuiltInExtensionsCheckResult, BuiltInExtensionsUpdateResult, BuiltInExtensionsUpdateStatus } from "../shared/types/extensionsUpdate";
import type { BuiltinContentCheckResult, BuiltinContentUpdateResult, BuiltinContentUpdateStatus } from "../shared/types/contentUpdate";
import type {
	VoiceTranscriptionPublicConfig,
	VoiceTranscriptionRequest,
	VoiceTranscriptionResult,
	VoiceTranscriptionSaveInput,
	VoiceTranscriptionSaveResult,
	VoiceTranscriptionSecretField,
	VoiceTranscriptionStreamFrame,
	VoiceTranscriptionStreamPartial,
	VoiceTranscriptionStreamStartInput,
	VoiceTranscriptionStreamStartResult,
	VoiceTranscriptionTestResult,
} from "../shared/types/voiceTranscription";
import type { WhisperInstallProgress, WhisperInstallResult, WhisperRuntimeStatus } from "../shared/types/whisperRuntime";
import type { EnhanceEventPayload, EnhanceRunInput, EnhanceRunResult } from "../shared/types/enhance";
import type { PromptSuggestionRunInput, PromptSuggestionRunResult } from "../shared/types/promptSuggestion";
import type { AgentChangedEvent, AgentInvokeEventPayload, AgentInvokeInput, AgentInvokeResult, AgentMarketSettings, AgentProfile, AgentProfileSnapshot, BindAgentSessionInput, CreateAgentProfileInput, UpdateAgentMarketSettingsInput, UpdateAgentProfileInput } from "../shared/types/agentProfile";
import type { SelectionToolInsertInput, SelectionToolResizeInput, SelectionToolShowPayload, SelectionToolWindowState } from "../shared/types/selectionTool";
import type { QuickMessagesSaveResult, QuickMessagesSnapshot } from "../shared/types/quickMessages";
import type { AddFavoriteInput, FavoriteEntry } from "../shared/types/favorites";
import type { NoticeHistoryFileEntry, NoticeHistoryRecordInput } from "../shared/types/noticeHistory";
import type { ReplyActionRule, ReplyActionsSaveResult, ReplyActionsSnapshot } from "../shared/types/replyActions";
import type {
	YaoPromptListResult,
	YaoPromptDbSnapshot,
	YaoPromptDetailResult,
	AgentRuntimeState,
	AppInfo,
	AppLogEntry,
	AppLogLevel,
	AppLogPage,
	AppLogQuery,
	ProcessMetricsSnapshot,
	DiagnosticsSnapshot,
	ArchStatus,
	AppSettings,
	AppUpdateStatusSnapshot,
	UpdateChannelInfo,
	MirrorHealthResult,
	AvailableModel,
	ModelListFailReason,
	ModelListReport,
	ModelsVerifyResult,
	ChatMessage,
	FetchedModel,
	ModelSpec,
	CodexImportReport,
	CodexSessionSummary,
	ClaudeImportReport,
	ClaudeSessionSummary,
	QoderImportReport,
	QoderSessionSummary,
	OpenCodeImportReport,
	OpenCodeSessionSummary,
	ZCodeImportReport,
	ZCodeSessionSummary,
	WorkBuddyImportReport,
	WorkBuddySessionSummary,
	CursorImportReport,
	CursorSessionSummary,
	KimiImportReport,
	KimiSessionSummary,
	KimiWorkShareRootInfo,
	KimiWorkSessionSummary,
	KimiWorkImportReport,
	MinimaxImportReport,
	MinimaxSessionSummary,
	DirectoryImportReport,
	DirectorySessionScanResult,
	DirectorySessionSourceDir,
	ConfigFileDiagnostic,
	DraftMeta,
	CreateSessionDraftInput,
	AutomationSnapshot,
	AutomationTask,
	AutomationRun,
	AutomationSettings,
	AutomationCronPreview,
	AutomationChangedEvent,
	CreateAutomationTaskInput,
	UpdateAutomationTaskInput,
	UpdateAutomationSettingsInput,
	ResolveLaunchDefaultsInput,
	ResolvedLaunchDefaults,
	CreateAnonymousSessionInput,
	CreateAnonymousSessionResult,
	UpdateSessionRecordInput,
	SessionRecord,
	SessionFactsResult,
	SessionOutlineSnapshot,
	SessionProcessEvent,
	VisionBridgeConfig,
	ProjectInheritedResourceToggleInput,
	ProjectResourceDirectoryKind,
	CreateProjectSkillInput,
	ProjectResourceListResult,
	ProjectResourceDiscoveryResult,
	ProjectResourceOverrides,
	ResourceImportScanInput,
	ResourceImportApplyInput,
	ResourceImportScanResponse,
	ResourceImportApplyResponse,
	PetAggregateState,
	PetManifest,
	PetNotification,
	PetWindowCaps,
	SoundAlertPlayEvent,
	CustomSoundInfo,
	SoundImportResult,
	ExternalEditor,
	ExternalEditorId,
	ExternalEditorSetting,
	FileManagerInfo,
	FocusTargetPayload,
	FeedbackEnvironment,
	FeedbackProjectContext,
	FeishuBotConfig,
	FeishuBridgeStatus,
	FeishuChatBinding,
	FeishuChatMessage,
	FeishuConnectInput,
	FeishuSessionBotResult,
	FeishuTestResult,
	FileContentSearchResult,
	FileSearchResult,
	FileTreeNode,
	GitBranchInfo,
	GitDiscardResource,
	GitRepoInfo,
	ImageContent,
	CommitDetail,
	GitCommitFileDiff,
	GitWorkspaceDiffGroup,
	GitWorkspaceFileDiff,
	CommitEntry,
	GitRef,
	BranchDiffResult,
	WorktreeEntry,
	PiCliUpdateResult,
	PiReleaseNotesPayload,
	PiCommand,
	RuntimePromptTemplate,
	RewindCheckpointPage,
	RewindCheckpointPageParams,
	RewindRestoreResult,
	SessionBranchTree,
	RewindRestoreScope,
	PiExtensionListResult,
	PiInstallStatus,
	PiInstallation,
	PiInstallExecResult,
	WslConnectionValidation,
	NpmAvailabilityResult,
	PiRuntimeNodeStatus,
	PiRuntimeNodeInstallResult,
	PasteFileWriteInput,
	PasteFileWriteResult,
	PiPromptTemplateListResult,
	PiPromptTemplateSummary,
	CreatePiPromptTemplateInput,
	PiProxyTestResult,
	PiUpdateCheckResult,
	PiSkillListResult,
	CreatePiSkillInput,
	PiSkillSummary,
	SkillContentResult,
	Project,
	ProjectFileAccessScope,
	PromptStoreSearchResult,
	PromptStoreItem,
	ScratchPadData,
	SecurityConfig,
	SendSessionPromptInput,
	SendSessionPromptResult,
	SessionCommandResult,
	SessionRuntimeEvent,
	SessionRuntimeInfo,
	SessionRuntimeModelSelection,
	SessionRuntimeReplacement,
	SessionRuntimeTarget,
	SessionSearchResult,
	SessionTargetedValue,
	SessionUiResponseInput,
	SessionSummary,
	TerminalDataEvent,
	TerminalExitEvent,
	TerminalShell,
	TerminalTab,
	TerminalTarget,
	WebNetworkAddress,
	WebServiceStatusInfo,
	HealthExportResult,
	HealthReport,
	HealthReportContext,
	HealthReportFormat,
	WeChatAccountInfo,
	WeChatBindingView,
	WeChatBridgeStatus,
	WeChatIpcResult,
	WeChatLoginState,
	WeChatSettings,
	WeChatSettingsSnapshot,
} from "../shared/types";
import type { ProviderUsageResult, UsageProbeSaveInput, UsageProbeSaveResult, UsageProbeSettingsResult, UsageProbeStatesResult, UsageProbeTestInput } from "../shared/types/providerUsage";

function clipboardSync<T>(channel: string, fallback: T): T {
	try {
		return ipcRenderer.sendSync(channel) as T;
	} catch {
		return fallback;
	}
}

const hostPlugins: HostPluginDesktopApi = {
	list: () => ipcRenderer.invoke(ipcChannels.hostPluginsList),
	rescan: () => ipcRenderer.invoke(ipcChannels.hostPluginsRescan),
	setEnabled: (id, enabled, fingerprint) => ipcRenderer.invoke(ipcChannels.hostPluginsSetEnabled, id, enabled, fingerprint),
	openDirectory: () => ipcRenderer.invoke(ipcChannels.hostPluginsOpenDirectory),
	install: () => ipcRenderer.invoke(ipcChannels.hostPluginsInstall),
	installDirectory: () => ipcRenderer.invoke(ipcChannels.hostPluginsInstallDirectory),
	installGitHub: (url: string) => ipcRenderer.invoke(ipcChannels.hostPluginsInstallGitHub, url),
	scaffold: (input) => ipcRenderer.invoke(ipcChannels.hostPluginsScaffold, input),
	mount: (input) => ipcRenderer.invoke(ipcChannels.hostPluginsMount, input),
	update: (instanceId: string, context: HostPluginContext) => ipcRenderer.invoke(ipcChannels.hostPluginsUpdate, instanceId, context),
	unmount: (id) => ipcRenderer.invoke(ipcChannels.hostPluginsUnmount, id),
	remove: (id) => ipcRenderer.invoke(ipcChannels.hostPluginsRemove, id),
	onChanged: (callback) => subscribe(ipcChannels.hostPluginsChanged, callback),
	onNavigate: (callback) => subscribe(ipcChannels.hostPluginNavigate, callback),
	onOpenBrowser: (callback) => subscribe(ipcChannels.hostPluginOpenBrowser, callback),
};

const piDeckMcp: PiDeckMcpDesktopApi = {
	getState: () => ipcRenderer.invoke(ipcChannels.piDeckMcpState),
	setAccess: (input) => ipcRenderer.invoke(ipcChannels.piDeckMcpSetAccess, input),
	connection: () => ipcRenderer.invoke(ipcChannels.piDeckMcpConnection),
};

const api = {
	piDeckMcp,
	hostPlugins,
	clipboard: {
		readText: () => clipboardSync(ipcChannels.clipboardReadText, ""),
		readHtml: () => clipboardSync(ipcChannels.clipboardReadHtml, ""),
		readImage: () => clipboardSync(ipcChannels.clipboardReadImage, ""),

		writeImage: (dataUrl: string) => ipcRenderer.invoke(ipcChannels.clipboardWriteImage, dataUrl) as Promise<boolean>,

		writeText: (value: string) => ipcRenderer.invoke(ipcChannels.clipboardWriteText, value) as Promise<boolean>,
	},
	quickTask: {
		getState: () => ipcRenderer.invoke(ipcChannels.quickTaskGetState) as Promise<import("../shared/types/quickTask").QuickTaskState>,
		onChanged: (callback: (state: import("../shared/types/quickTask").QuickTaskState) => void) => subscribe(ipcChannels.quickTaskChanged, callback),
		exit: () => ipcRenderer.invoke(ipcChannels.quickTaskExit) as Promise<void>,

		switchToMiniOverlay: () => ipcRenderer.invoke(ipcChannels.quickTaskSwitchToMiniOverlay) as Promise<void>,
	},
	floatingBall: {
		getState: () => ipcRenderer.invoke(ipcChannels.floatingBallGetState) as Promise<import("../main/floating/FloatingController").FloatingBallState>,
		onStateChanged: (callback: (state: import("../main/floating/FloatingController").FloatingBallState) => void) => subscribe(ipcChannels.floatingBallState, callback),
		enter: () => ipcRenderer.invoke(ipcChannels.floatingBallEnter) as Promise<void>,
		exit: () => ipcRenderer.invoke(ipcChannels.floatingBallExit) as Promise<void>,
		setEnabled: (enabled: boolean) => ipcRenderer.invoke(ipcChannels.floatingBallSetEnabled, enabled) as Promise<void>,
		setExpandTarget: (target: "mini" | "compact") => ipcRenderer.invoke(ipcChannels.floatingBallSetExpandTarget, target) as Promise<void>,
		dragStart: () => ipcRenderer.invoke(ipcChannels.floatingBallDragStart) as Promise<void>,
		dragMove: (x: number, y: number) => ipcRenderer.invoke(ipcChannels.floatingBallDragMove, x, y) as Promise<void>,
		dragEnd: () => ipcRenderer.invoke(ipcChannels.floatingBallDragEnd) as Promise<void>,
		contextMenu: () => ipcRenderer.invoke(ipcChannels.floatingBallContextMenu) as Promise<void>,
	},

	miniOverlay: {
		getState: () => ipcRenderer.invoke(ipcChannels.miniOverlayGetState) as Promise<import("../main/floating/MiniOverlayWindow").MiniOverlayState | null>,
		onStateChanged: (callback: (state: import("../main/floating/MiniOverlayWindow").MiniOverlayState) => void) => subscribe(ipcChannels.miniOverlayState, callback),
		jumpToSession: (sessionId: string, projectId: string) => ipcRenderer.invoke(ipcChannels.miniOverlayJumpToSession, sessionId, projectId) as Promise<void>,
		quickPrompt: (projectId: string, text: string) => ipcRenderer.invoke(ipcChannels.miniOverlayQuickPrompt, projectId, text) as Promise<{ ok: boolean; message?: string }>,
		close: () => ipcRenderer.invoke(ipcChannels.miniOverlayClose) as Promise<void>,
		collapse: () => ipcRenderer.invoke(ipcChannels.miniOverlayCollapse) as Promise<void>,

		switchToQuickTask: (projectPath?: string) => ipcRenderer.invoke(ipcChannels.miniOverlaySwitchToQuickTask, projectPath) as Promise<void>,
	},
	piAuth: {
		listProviders: () => ipcRenderer.invoke(ipcChannels.piAuthListProviders) as Promise<{ ok: true; list: import("../shared/types/piAuth").PiAuthProviderList } | { ok: false; errorKind: import("../shared/types/piAuth").PiAuthErrorKind; error: string }>,
		login: (request: import("../shared/types/piAuth").PiAuthLoginRequest) => ipcRenderer.invoke(ipcChannels.piAuthLogin, request) as Promise<import("../shared/types/piAuth").PiAuthLoginResult>,

		answerPrompt: (promptId: string, value: string) => ipcRenderer.invoke(ipcChannels.piAuthAnswerPrompt, { promptId, value }) as Promise<boolean>,
		cancel: () => ipcRenderer.invoke(ipcChannels.piAuthCancel) as Promise<boolean>,
		logout: (providerId: string) => ipcRenderer.invoke(ipcChannels.piAuthLogout, providerId) as Promise<import("../shared/types/piAuth").PiAuthLogoutResult>,
		onFlowUpdate: (callback: (update: import("../shared/types/piAuth").PiAuthFlowUpdate) => void) => subscribe(ipcChannels.piAuthFlowUpdate, callback),
	},

	dataEnv: {
		getInfo: () => ipcRenderer.invoke(ipcChannels.dataEnvGetInfo) as Promise<DataEnvInfo>,
		chooseMode: (mode: DataEnvMode) => ipcRenderer.invoke(ipcChannels.dataEnvChooseMode, mode) as Promise<DataEnvChoiceResult | DataEnvChoiceFailure>,
		restart: () => ipcRenderer.invoke(ipcChannels.dataEnvRestart) as Promise<void>,
		confirmMismatch: (action: "continue" | "quit") => ipcRenderer.invoke(ipcChannels.dataEnvConfirmMismatch, action) as Promise<void>,
		onDecisionRequired: (callback: () => void) => subscribe(ipcChannels.dataEnvDecisionRequired, callback),
		onMismatchDetected: (callback: (payload: { dataModeInDir: DataEnvMode }) => void) => subscribe(ipcChannels.dataEnvMismatchDetected, callback),

		getImportPreview: () => ipcRenderer.invoke(ipcChannels.dataEnvGetImportPreview) as Promise<ImportPreviewResult>,
		importStart: () => ipcRenderer.invoke(ipcChannels.dataEnvImportStart) as Promise<ImportStartResult>,
		importCancel: () => ipcRenderer.invoke(ipcChannels.dataEnvImportCancel) as Promise<void>,
		onImportProgress: (callback: (progress: ImportProgress) => void) => subscribe(ipcChannels.dataEnvImportProgress, callback),
	},

	channelSwitch: {
		query: () => ipcRenderer.invoke(ipcChannels.channelSwitchQuery) as Promise<import("../shared/types/app").ChannelSwitchActionResult>,
		download: (asset: import("../shared/types/app").TargetChannelRelease) => ipcRenderer.invoke(ipcChannels.channelSwitchDownload, asset) as Promise<import("../shared/types/app").ChannelSwitchActionResult>,
		launch: (installerPath: string) => ipcRenderer.invoke(ipcChannels.channelSwitchLaunch, installerPath) as Promise<import("../shared/types/app").ChannelSwitchActionResult>,
		getStatus: () => ipcRenderer.invoke(ipcChannels.channelSwitchGetStatus) as Promise<import("../shared/types/app").ChannelSwitchSnapshot>,
		onStateChanged: (callback: (snapshot: import("../shared/types/app").ChannelSwitchSnapshot) => void) => subscribe(ipcChannels.channelSwitchStateChanged, callback),
	},
	shellMenu: {
		getQuickTaskState: () => ipcRenderer.invoke(ipcChannels.shellMenuQuickTaskGetState) as Promise<{ supported: boolean; registered: boolean }>,
		setQuickTaskEnabled: (enabled: boolean) => ipcRenderer.invoke(ipcChannels.shellMenuQuickTaskSetEnabled, enabled) as Promise<{ supported: boolean; registered: boolean }>,

		getState: () =>
			ipcRenderer.invoke(ipcChannels.shellMenuGetState) as Promise<{
				supported: boolean;
				registered: boolean;
			}>,

		setEnabled: (enabled: boolean) =>
			ipcRenderer.invoke(ipcChannels.shellMenuSetEnabled, enabled) as Promise<{
				supported: boolean;
				registered: boolean;
			}>,
	},
	editors: {
		list: () => ipcRenderer.invoke(ipcChannels.editorsList) as Promise<ExternalEditor[]>,
		redetect: () => ipcRenderer.invoke(ipcChannels.editorsRedetect) as Promise<AppSettings>,
		update: (editorId: ExternalEditorId, patch: Partial<ExternalEditorSetting>) => ipcRenderer.invoke(ipcChannels.editorsUpdate, editorId, patch) as Promise<AppSettings>,
		chooseExecutable: () => ipcRenderer.invoke(ipcChannels.editorsChooseExecutable) as Promise<string | null>,
		openProject: (editor: ExternalEditor, projectPath: string) => ipcRenderer.invoke(ipcChannels.editorsOpenProject, editor, projectPath) as Promise<void>,
	},
	projects: {
		list: () => ipcRenderer.invoke(ipcChannels.projectsList) as Promise<Project[]>,
		add: () => ipcRenderer.invoke(ipcChannels.projectsAdd) as Promise<Project | null>,

		addByPath: (path: string) => ipcRenderer.invoke(ipcChannels.projectsAddByPath, path) as Promise<Project>,
		remove: (id: string) => ipcRenderer.invoke(ipcChannels.projectsRemove, id) as Promise<Project[]>,
		reorder: (projectIds: string[]) => ipcRenderer.invoke(ipcChannels.projectsReorder, projectIds) as Promise<Project[]>,

		setPinned: (projectId: string, pinned: boolean) => ipcRenderer.invoke(ipcChannels.projectsSetPinned, projectId, pinned) as Promise<Project[]>,

		rename: (id: string, name: string) => ipcRenderer.invoke(ipcChannels.projectsRename, id, name) as Promise<Project[]>,
		onChanged: (callback: (projects: Project[]) => void) => subscribe(ipcChannels.projectsChanged, callback),

		listRoot: () => ipcRenderer.invoke(ipcChannels.projectsListRoot) as Promise<Project[]>,

		listWorktreeChildren: (parentId: string) => ipcRenderer.invoke(ipcChannels.projectsListWorktreeChildren, parentId) as Promise<Project[]>,

		toggleWorktreeEnabled: (projectId: string) => ipcRenderer.invoke(ipcChannels.projectsToggleWorktreeEnabled, projectId) as Promise<Project | null>,

		chooseChatPath: () => ipcRenderer.invoke(ipcChannels.projectsChooseChatPath) as Promise<string | null>,

		setChatPath: (path: string) => ipcRenderer.invoke(ipcChannels.projectsSetChatPath, path) as Promise<Project | null>,

		consumeMigrationNotice: () => ipcRenderer.invoke(ipcChannels.userDataMigrationConsumeNotice) as Promise<UserDataNameMigrationNotice | null>,

		listModels: (projectId?: string) => ipcRenderer.invoke(ipcChannels.projectsListModels, projectId) as Promise<AvailableModel[]>,

		listModelsReport: (projectId?: string, force?: boolean) => ipcRenderer.invoke(ipcChannels.projectsListModelsReport, projectId, force) as Promise<ModelListReport>,

		getModelSpec: (providerName: string, modelId: string, modelName?: string) => ipcRenderer.invoke(ipcChannels.projectsGetModelSpec, providerName, modelId, modelName) as Promise<ModelSpec | null>,
		onTrustRequest: (callback: (request: { requestId: string; cwd: string; projectName: string }) => void) => subscribe(ipcChannels.projectsTrustRequest, callback),
		respondTrustRequest: (requestId: string, choice: "trust-remember" | "trust-session" | "deny") => ipcRenderer.invoke(ipcChannels.projectsTrustResponse, requestId, choice) as Promise<void>,
	},
	projectResources: {
		list: (projectId: string) => ipcRenderer.invoke(ipcChannels.projectResourcesList, projectId) as Promise<ProjectResourceListResult>,
		openDirectory: (projectId: string, kind: ProjectResourceDirectoryKind) => ipcRenderer.invoke(ipcChannels.projectResourcesOpenDirectory, projectId, kind) as Promise<void>,
		createSkill: (input: CreateProjectSkillInput) => ipcRenderer.invoke(ipcChannels.projectResourcesCreateSkill, input) as Promise<PiSkillSummary>,
		deleteSkill: (projectId: string, skillPath: string) => ipcRenderer.invoke(ipcChannels.projectResourcesDeleteSkill, projectId, skillPath) as Promise<void>,
		deleteExtension: (projectId: string, extensionPath: string) => ipcRenderer.invoke(ipcChannels.projectResourcesDeleteExtension, projectId, extensionPath) as Promise<void>,
		toggleExtension: (projectId: string, extensionPath: string, enabled: boolean) => ipcRenderer.invoke(ipcChannels.projectResourcesToggleExtension, projectId, extensionPath, enabled) as Promise<void>,
		toggleInherited: (input: ProjectInheritedResourceToggleInput) => ipcRenderer.invoke(ipcChannels.projectResourcesToggleInherited, input) as Promise<ProjectResourceOverrides>,
		toggleSkill: (projectId: string, skillPath: string, enabled: boolean) => ipcRenderer.invoke(ipcChannels.projectResourcesToggleSkill, projectId, skillPath, enabled) as Promise<PiSkillSummary>,
		renameSkill: (projectId: string, skillPath: string, newName: string) => ipcRenderer.invoke(ipcChannels.projectResourcesRenameSkill, projectId, skillPath, newName) as Promise<PiSkillSummary>,
		discovery: (projectId?: string) => ipcRenderer.invoke(ipcChannels.projectResourcesDiscovery, projectId) as Promise<ProjectResourceDiscoveryResult>,
	},
	files: {
		list: (projectId: string, options?: { maxDepth?: number; directory?: string; skipGeneratedDirs?: boolean }) => ipcRenderer.invoke(ipcChannels.filesList, projectId, options) as Promise<FileTreeNode[]>,

		search: (projectId: string, query: string) => ipcRenderer.invoke(ipcChannels.filesSearch, projectId, query) as Promise<FileSearchResult[]>,

		searchContent: (projectId: string, query: string) => ipcRenderer.invoke(ipcChannels.filesSearchContent, projectId, query) as Promise<FileContentSearchResult | null>,
		open: (path: string, scope?: ProjectFileAccessScope) => ipcRenderer.invoke(ipcChannels.filesOpen, path, scope) as Promise<void>,
		showInFolder: (path: string, scope?: ProjectFileAccessScope) => ipcRenderer.invoke(ipcChannels.filesShowInFolder, path, scope) as Promise<void>,

		detectFileManager: () => ipcRenderer.invoke(ipcChannels.filesDetectFileManager) as Promise<FileManagerInfo | null>,

		openFileManager: (path: string) => ipcRenderer.invoke(ipcChannels.filesOpenFileManager, path) as Promise<void>,
		readContent: (path: string, maxBytes?: number, scope?: ProjectFileAccessScope) => ipcRenderer.invoke(ipcChannels.filesReadContent, path, maxBytes, scope) as Promise<string>,

		pathsExist: (paths: string[], scope?: ProjectFileAccessScope) => ipcRenderer.invoke(ipcChannels.filesPathsExist, paths, scope) as Promise<boolean[]>,

		stat: (path: string, scope?: ProjectFileAccessScope) =>
			ipcRenderer.invoke(ipcChannels.filesStat, path, scope) as Promise<{
				exists: boolean;
				isDirectory: boolean;
			}>,

		readBase64: (path: string, maxBytes?: number, scope?: ProjectFileAccessScope) => ipcRenderer.invoke(ipcChannels.filesReadBase64, path, maxBytes, scope) as Promise<string>,

		writeContent: (path: string, content: string, scope?: ProjectFileAccessScope) => ipcRenderer.invoke(ipcChannels.filesWriteContent, path, content, scope) as Promise<void>,
		delete: (path: string, recursive?: boolean) => ipcRenderer.invoke(ipcChannels.filesDelete, path, recursive) as Promise<void>,

		copy: (sourcePaths: string[], targetDir: string) => ipcRenderer.invoke(ipcChannels.filesCopy, sourcePaths, targetDir) as Promise<string[]>,

		move: (sourcePaths: string[], targetDir: string) => ipcRenderer.invoke(ipcChannels.filesMove, sourcePaths, targetDir) as Promise<string[]>,
		create: (parentDir: string, name: string, type: "file" | "directory") => ipcRenderer.invoke(ipcChannels.filesCreate, parentDir, name, type) as Promise<string>,
		rename: (path: string, newName: string) => ipcRenderer.invoke(ipcChannels.filesRename, path, newName) as Promise<string>,

		getPathForFile: (file: File) => {
			try {
				return webUtils.getPathForFile(file) || "";
			} catch {
				return "";
			}
		},

		getClipboardPaths: () => clipboardSync<string[]>(ipcChannels.clipboardReadFilePaths, []),
	},
	pasteFiles: {
		write: (input: PasteFileWriteInput) => ipcRenderer.invoke(ipcChannels.pasteFilesWrite, input) as Promise<PasteFileWriteResult>,

		delete: (path: string) => ipcRenderer.invoke(ipcChannels.pasteFilesDelete, path) as Promise<void>,

		cleanup: () => ipcRenderer.invoke(ipcChannels.pasteFilesCleanup) as Promise<number>,

		getSize: () => ipcRenderer.invoke(ipcChannels.pasteFilesGetSize) as Promise<number>,

		clearAll: () => ipcRenderer.invoke(ipcChannels.pasteFilesClearAll) as Promise<number>,
	},
	noticeHistory: {
		get: () => ipcRenderer.invoke(ipcChannels.noticeHistoryGet) as Promise<NoticeHistoryFileEntry[]>,

		record: (input: NoticeHistoryRecordInput) => ipcRenderer.invoke(ipcChannels.noticeHistoryRecord, input) as Promise<void>,

		clear: () => ipcRenderer.invoke(ipcChannels.noticeHistoryClear) as Promise<void>,

		getSize: () => ipcRenderer.invoke(ipcChannels.noticeHistoryGetSize) as Promise<number>,
	},
	dialog: {
		pickFiles: (options?: { title?: string; includeDirectories?: boolean }) => ipcRenderer.invoke(ipcChannels.dialogPickFiles, options) as Promise<string[]>,

		pickBackgroundImage: () => ipcRenderer.invoke(ipcChannels.pickBackgroundImage) as Promise<string>,

		removeBackgroundImage: (name: string) => ipcRenderer.invoke(ipcChannels.removeBackgroundImage, name) as Promise<void>,

		pickWallpaperEngineDir: () => ipcRenderer.invoke(ipcChannels.wallpaperEnginePickDir) as Promise<string>,
		listWallpaperEngine: (dir?: string) => ipcRenderer.invoke(ipcChannels.wallpaperEngineList, dir) as Promise<WallpaperEngineListResult>,
		selectWallpaperEngine: (dir: string, id: string) => ipcRenderer.invoke(ipcChannels.wallpaperEngineSelect, dir, id) as Promise<WallpaperEngineItem | null>,
	},
	customThemes: {
		list: () => ipcRenderer.invoke(ipcChannels.listCustomThemes) as Promise<{ dir: string; themes: CustomThemeListItem[] }>,

		read: (id: string) => ipcRenderer.invoke(ipcChannels.readCustomTheme, id) as Promise<string | null>,

		save: (raw: string) => ipcRenderer.invoke(ipcChannels.saveCustomTheme, raw) as Promise<{ ok: true; id: string } | { ok: false; errors: string[] }>,

		remove: (id: string) => ipcRenderer.invoke(ipcChannels.deleteCustomTheme, id) as Promise<void>,

		writeGuide: (locale: "zh-CN" | "en-US") => ipcRenderer.invoke(ipcChannels.writeCustomThemeGuide, locale) as Promise<string>,
	},
	sessions: {
		list: (projectId?: string) => ipcRenderer.invoke(ipcChannels.sessionsList, projectId) as Promise<SessionSummary[]>,

		searchContent: (query: string) => ipcRenderer.invoke(ipcChannels.sessionsSearchContent, query) as Promise<SessionSearchResult | null>,

		searchInSession: (sessionId: string, query: string) => ipcRenderer.invoke(ipcChannels.sessionsSearchInSession, sessionId, query) as Promise<SessionSearchResult | null>,
		listCatalog: (projectId: string, options?: { scan?: boolean }) => ipcRenderer.invoke(ipcChannels.sessionsCatalogList, projectId, options) as Promise<SessionRecord[]>,

		onCatalogRefreshed: (listener: (input: { projectId: string }) => void) => {
			const handler = (_event: unknown, payload: { projectId: string }) => listener(payload);
			ipcRenderer.on(ipcChannels.sessionsCatalogRefreshed, handler);
			return () => {
				ipcRenderer.removeListener(ipcChannels.sessionsCatalogRefreshed, handler);
			};
		},
		createDraft: (input: CreateSessionDraftInput) => ipcRenderer.invoke(ipcChannels.sessionsCatalogCreateDraft, input) as Promise<SessionRecord>,

		resolveLaunchDefaults: (input: ResolveLaunchDefaultsInput = {}) => ipcRenderer.invoke(ipcChannels.sessionsResolveLaunchDefaults, input) as Promise<ResolvedLaunchDefaults>,
		createAnonymous: (input: CreateAnonymousSessionInput) => ipcRenderer.invoke(ipcChannels.sessionsCreateAnonymous, input) as Promise<CreateAnonymousSessionResult>,
		updateRecord: (sessionId: string, patch: UpdateSessionRecordInput) => ipcRenderer.invoke(ipcChannels.sessionsCatalogUpdate, sessionId, patch) as Promise<SessionRecord>,
		deleteRecord: (sessionId: string) => ipcRenderer.invoke(ipcChannels.sessionsCatalogDelete, sessionId) as Promise<boolean>,

		archiveRecord: (sessionId: string) => ipcRenderer.invoke(ipcChannels.sessionsCatalogArchive, sessionId) as Promise<boolean>,

		unarchiveRecord: (archivedPath: string) => ipcRenderer.invoke(ipcChannels.sessionsCatalogUnarchive, archivedPath) as Promise<boolean>,

		listArchived: () => ipcRenderer.invoke(ipcChannels.sessionsCatalogListArchived) as Promise<import("../shared/types").ArchivedPiSession[]>,

		deleteArchivedRecord: (archivedPath: string) => ipcRenderer.invoke(ipcChannels.sessionsCatalogDeleteArchived, archivedPath) as Promise<boolean>,
		readRecordMessages: (sessionId: string) => ipcRenderer.invoke(ipcChannels.sessionsCatalogReadMessages, sessionId) as Promise<import("../shared/types").ChatMessage[]>,
		readRecordMessagePage: (sessionId: string, before?: number, pageSize?: number, options?: { beforeEntryId?: string }) => ipcRenderer.invoke(ipcChannels.sessionsCatalogReadMessagePage, sessionId, before, pageSize, options) as Promise<import("../shared/types").SessionMessagePage>,

		editCatalogMessage: (sessionId: string, messageId: string, newText: string, entryId?: string) => ipcRenderer.invoke(ipcChannels.sessionsCatalogEditMessage, sessionId, messageId, newText, entryId) as Promise<SessionCommandResult<void>>,

		removeCatalogMessageImage: (sessionId: string, messageId: string, imageTarget: import("../shared/types").SessionMessageImageTarget, entryId?: string) => ipcRenderer.invoke(ipcChannels.sessionsCatalogRemoveMessageImage, sessionId, messageId, imageTarget, entryId) as Promise<SessionCommandResult<void>>,

		deleteCatalogMessage: (sessionId: string, messageId: string, entryId?: string) => ipcRenderer.invoke(ipcChannels.sessionsCatalogDeleteMessage, sessionId, messageId, entryId) as Promise<SessionCommandResult<void>>,

		prepareCatalogResend: (sessionId: string, messageId: string, entryId?: string) => ipcRenderer.invoke(ipcChannels.sessionsCatalogPrepareResend, sessionId, messageId, entryId) as Promise<SessionCommandResult<{ text: string; images?: ImageContent[] }>>,

		readProcessEvents: (sessionId: string) => ipcRenderer.invoke(ipcChannels.sessionsCatalogReadProcessEvents, sessionId) as Promise<SessionFactsResult>,
		readOutline: (sessionId: string, limit?: number) => ipcRenderer.invoke(ipcChannels.sessionsCatalogReadOutline, sessionId, limit) as Promise<SessionOutlineSnapshot>,

		readMessageFullText: (sessionId: string | undefined, agentId: string, messageId: string, entryId?: string) => ipcRenderer.invoke(ipcChannels.sessionsCatalogReadMessageFullText, sessionId, agentId, messageId, entryId) as Promise<{ text: string }>,
		readReferenceMessages: (sessionId: string) => ipcRenderer.invoke(ipcChannels.sessionsCatalogReadReferenceMessages, sessionId) as Promise<Array<{ role: string; content: string; timestamp: number }>>,
		copyRecord: (sessionId: string) =>
			ipcRenderer.invoke(ipcChannels.sessionsCatalogCopy, sessionId) as Promise<{
				cancelled?: boolean;
				targetSessionId?: string;
			}>,
		exportRecordHtml: (sessionId: string) =>
			ipcRenderer.invoke(ipcChannels.sessionsCatalogExportHtml, sessionId) as Promise<{
				path: string;
			}>,
		listSessionSubagents: (sessionId: string) => ipcRenderer.invoke(ipcChannels.sessionsListSubagents, sessionId) as Promise<import("../shared/types").PiSubagentEntry[]>,

		listSessionTodo: (sessionId: string) => ipcRenderer.invoke(ipcChannels.sessionsListSessionTodo, sessionId) as Promise<import("../shared/types").SessionTodoSnapshot | undefined>,
		sendPrompt: (input: SendSessionPromptInput) => ipcRenderer.invoke(ipcChannels.sessionsSendPrompt, input) as Promise<SendSessionPromptResult>,
		sendUiResponse: (input: SessionUiResponseInput) => ipcRenderer.invoke(ipcChannels.sessionsUiResponse, input) as Promise<void>,
		onRuntimeEvent: (callback: (event: SessionRuntimeEvent) => void) => subscribe(ipcChannels.sessionsRuntimeEvent, callback),
		listRuntimes: () => ipcRenderer.invoke(ipcChannels.sessionsRuntimeList) as Promise<SessionRuntimeInfo[]>,
		activateRuntime: (sessionId: string) => ipcRenderer.invoke(ipcChannels.sessionsRuntimeActivate, sessionId) as Promise<SessionCommandResult<SessionRuntimeInfo>>,
		setFocusedSession: (sessionId?: string) => ipcRenderer.invoke(ipcChannels.sessionsSetFocusedSession, sessionId) as Promise<void>,
		stopRuntime: (target: SessionRuntimeTarget) => ipcRenderer.invoke(ipcChannels.sessionsRuntimeStop, target) as Promise<SessionCommandResult<SessionRuntimeTarget>>,
		abortRuntime: (target: SessionRuntimeTarget) => ipcRenderer.invoke(ipcChannels.sessionsRuntimeAbort, target) as Promise<SessionCommandResult<SessionTargetedValue<void>>>,
		restartRuntime: (target: SessionRuntimeTarget) => ipcRenderer.invoke(ipcChannels.sessionsRuntimeRestart, target) as Promise<SessionCommandResult<SessionRuntimeReplacement>>,
		compactRuntime: (target: SessionRuntimeTarget, prompt?: string) => ipcRenderer.invoke(ipcChannels.sessionsRuntimeCompact, target, prompt) as Promise<SessionCommandResult<SessionTargetedValue<AgentRuntimeState>>>,
		getRuntimeState: (target: SessionRuntimeTarget) => ipcRenderer.invoke(ipcChannels.sessionsRuntimeState, target) as Promise<SessionCommandResult<SessionTargetedValue<AgentRuntimeState>>>,
		listRuntimeCommands: (target: SessionRuntimeTarget) => ipcRenderer.invoke(ipcChannels.sessionsRuntimeCommands, target) as Promise<SessionCommandResult<SessionTargetedValue<PiCommand[]>>>,
		listRuntimePromptTemplates: (target: SessionRuntimeTarget) => ipcRenderer.invoke(ipcChannels.sessionsRuntimePromptTemplates, target) as Promise<SessionCommandResult<SessionTargetedValue<RuntimePromptTemplate[]>>>,

		reloadResources: (target: SessionRuntimeTarget) => ipcRenderer.invoke(ipcChannels.sessionsRuntimeReloadResources, target) as Promise<SessionCommandResult<SessionTargetedValue<PiCommand[]>>>,

		draftCommands: (projectId: string) => ipcRenderer.invoke(ipcChannels.sessionsDraftCommands, projectId) as Promise<PiCommand[] | null>,
		draftPromptTemplates: (projectId: string) => ipcRenderer.invoke(ipcChannels.sessionsDraftPromptTemplates, projectId) as Promise<RuntimePromptTemplate[] | null>,

		listRuntimeModels: (target: SessionRuntimeTarget) => ipcRenderer.invoke(ipcChannels.sessionsRuntimeListModels, target) as Promise<SessionCommandResult<SessionTargetedValue<AvailableModel[]>>>,

		listRuntimeThinkingLevels: (target: SessionRuntimeTarget) => ipcRenderer.invoke(ipcChannels.sessionsRuntimeThinkingLevels, target) as Promise<SessionCommandResult<SessionTargetedValue<string[] | undefined>>>,
		exportRuntimeHtml: (target: SessionRuntimeTarget) => ipcRenderer.invoke(ipcChannels.sessionsRuntimeExportHtml, target) as Promise<SessionCommandResult<SessionTargetedValue<unknown>>>,
		editRuntimeMessage: (target: SessionRuntimeTarget, messageId: string, newText: string) => ipcRenderer.invoke(ipcChannels.sessionsRuntimeEditMessage, target, messageId, newText) as Promise<SessionCommandResult<SessionTargetedValue<void>>>,
		deleteRuntimeMessage: (target: SessionRuntimeTarget, messageId: string) => ipcRenderer.invoke(ipcChannels.sessionsRuntimeDeleteMessage, target, messageId) as Promise<SessionCommandResult<SessionTargetedValue<void>>>,
		listRewindCheckpoints: (target: SessionRuntimeTarget, params?: RewindCheckpointPageParams) => ipcRenderer.invoke(ipcChannels.sessionsRewindList, target, params) as Promise<SessionCommandResult<SessionTargetedValue<RewindCheckpointPage>>>,
		getRewindCheckpointDiff: (target: SessionRuntimeTarget, checkpointId: string) => ipcRenderer.invoke(ipcChannels.sessionsRewindDiff, target, checkpointId) as Promise<SessionCommandResult<SessionTargetedValue<string>>>,
		restoreRewindCheckpoint: (target: SessionRuntimeTarget, checkpointId: string, scope: RewindRestoreScope) => ipcRenderer.invoke(ipcChannels.sessionsRewindRestore, target, checkpointId, scope) as Promise<SessionCommandResult<SessionTargetedValue<RewindRestoreResult>>>,

		getBranchTree: (sessionId: string) => ipcRenderer.invoke(ipcChannels.sessionsGetBranchTree, sessionId) as Promise<SessionBranchTree | null>,
		prepareRuntimeResend: (target: SessionRuntimeTarget, messageId: string) =>
			ipcRenderer.invoke(ipcChannels.sessionsRuntimePrepareResend, target, messageId) as Promise<
				SessionCommandResult<
					SessionTargetedValue<{
						text: string;
						images?: ImageContent[];
					}>
				>
			>,
		setRuntimeModel: (target: SessionRuntimeTarget, provider: string, modelId: string, modelName?: string) => ipcRenderer.invoke(ipcChannels.sessionsRuntimeSetModel, target, provider, modelId, modelName) as Promise<SessionCommandResult<SessionTargetedValue<SessionRuntimeModelSelection>>>,
		setRuntimeThinking: (target: SessionRuntimeTarget, level: string) => ipcRenderer.invoke(ipcChannels.sessionsRuntimeSetThinking, target, level) as Promise<SessionCommandResult<SessionTargetedValue<{ thinkingLevel: string }>>>,
		cloneRuntime: (target: SessionRuntimeTarget) =>
			ipcRenderer.invoke(ipcChannels.sessionsRuntimeClone, target) as Promise<
				SessionCommandResult<{
					cancelled?: boolean;
					targetSessionId?: string;
					[key: string]: unknown;
				}>
			>,

		getRuntimeForkMessages: (target: SessionRuntimeTarget) => ipcRenderer.invoke(ipcChannels.sessionsRuntimeGetForkMessages, target) as Promise<SessionCommandResult<SessionTargetedValue<Array<{ entryId: string; text: string }>>>>,

		forkRuntimeSession: (target: SessionRuntimeTarget, entryId: string, options?: { mutationFork?: boolean; branchMode?: boolean }) =>
			ipcRenderer.invoke(ipcChannels.sessionsRuntimeFork, target, entryId, options) as Promise<
				SessionCommandResult<{
					cancelled?: boolean;
					text?: string;
					targetSessionId?: string;
					[key: string]: unknown;
				}>
			>,
	},
	usageStats: {
		detect: () => ipcRenderer.invoke(ipcChannels.usageStatsDetect) as Promise<import("../shared/types").UsageStatsDetectResult>,
		refresh: () => ipcRenderer.invoke(ipcChannels.usageStatsRefresh) as Promise<import("../shared/types").UsageStatsRefreshResult>,
		get: () => ipcRenderer.invoke(ipcChannels.usageStatsGet) as Promise<import("../shared/types").UsageAggregated>,
	},
	codexSessions: {
		scan: (projectId: string) => ipcRenderer.invoke(ipcChannels.codexSessionsScan, projectId) as Promise<CodexSessionSummary[]>,
		import: (projectId: string, sourcePaths: string[]) => ipcRenderer.invoke(ipcChannels.codexSessionsImport, projectId, sourcePaths) as Promise<CodexImportReport>,
	},
	claudeSessions: {
		scan: (projectId: string) => ipcRenderer.invoke(ipcChannels.claudeSessionsScan, projectId) as Promise<ClaudeSessionSummary[]>,
		import: (projectId: string, sourcePaths: string[]) => ipcRenderer.invoke(ipcChannels.claudeSessionsImport, projectId, sourcePaths) as Promise<ClaudeImportReport>,
	},
	qoderSessions: {
		scan: (projectId: string) => ipcRenderer.invoke(ipcChannels.qoderSessionsScan, projectId) as Promise<QoderSessionSummary[]>,
		import: (projectId: string, sourcePaths: string[]) => ipcRenderer.invoke(ipcChannels.qoderSessionsImport, projectId, sourcePaths) as Promise<QoderImportReport>,
	},
	openCodeSessions: {
		scan: (projectId: string) => ipcRenderer.invoke(ipcChannels.openCodeSessionsScan, projectId) as Promise<OpenCodeSessionSummary[]>,
		import: (projectId: string, sourcePaths: string[]) => ipcRenderer.invoke(ipcChannels.openCodeSessionsImport, projectId, sourcePaths) as Promise<OpenCodeImportReport>,
	},
	zcodeSessions: {
		scan: (projectId: string) => ipcRenderer.invoke(ipcChannels.zcodeSessionsScan, projectId) as Promise<ZCodeSessionSummary[]>,
		import: (projectId: string, sourcePaths: string[]) => ipcRenderer.invoke(ipcChannels.zcodeSessionsImport, projectId, sourcePaths) as Promise<ZCodeImportReport>,
	},
	workbuddySessions: {
		scan: (projectId: string) => ipcRenderer.invoke(ipcChannels.workbuddySessionsScan, projectId) as Promise<WorkBuddySessionSummary[]>,
		import: (projectId: string, sourcePaths: string[]) => ipcRenderer.invoke(ipcChannels.workbuddySessionsImport, projectId, sourcePaths) as Promise<WorkBuddyImportReport>,
	},
	cursorSessions: {
		scan: (projectId: string) => ipcRenderer.invoke(ipcChannels.cursorSessionsScan, projectId) as Promise<CursorSessionSummary[]>,
		import: (projectId: string, sourcePaths: string[]) => ipcRenderer.invoke(ipcChannels.cursorSessionsImport, projectId, sourcePaths) as Promise<CursorImportReport>,
	},
	kimiSessions: {
		scan: (projectId: string) => ipcRenderer.invoke(ipcChannels.kimiSessionsScan, projectId) as Promise<KimiSessionSummary[]>,
		import: (projectId: string, sourcePaths: string[]) => ipcRenderer.invoke(ipcChannels.kimiSessionsImport, projectId, sourcePaths) as Promise<KimiImportReport>,
	},

	kimiWorkSessions: {
		describe: () => ipcRenderer.invoke(ipcChannels.kimiWorkSessionsDescribe) as Promise<KimiWorkShareRootInfo>,
		scan: (projectId: string) => ipcRenderer.invoke(ipcChannels.kimiWorkSessionsScan, projectId) as Promise<KimiWorkSessionSummary[]>,
		import: (projectId: string, sourcePaths: string[]) => ipcRenderer.invoke(ipcChannels.kimiWorkSessionsImport, projectId, sourcePaths) as Promise<KimiWorkImportReport>,
	},

	minimaxSessions: {
		scan: (projectId: string) => ipcRenderer.invoke(ipcChannels.minimaxSessionsScan, projectId) as Promise<MinimaxSessionSummary[]>,
		import: (projectId: string, sourcePaths: string[]) => ipcRenderer.invoke(ipcChannels.minimaxSessionsImport, projectId, sourcePaths) as Promise<MinimaxImportReport>,
	},

	directorySessions: {
		scan: (projectId: string, dir: string) => ipcRenderer.invoke(ipcChannels.directorySessionsScan, projectId, dir) as Promise<DirectorySessionScanResult>,
		listSources: () => ipcRenderer.invoke(ipcChannels.directorySessionsListSources) as Promise<DirectorySessionSourceDir[]>,
		import: (projectId: string, dir: string, sourcePaths: string[]) => ipcRenderer.invoke(ipcChannels.directorySessionsImport, projectId, dir, sourcePaths) as Promise<DirectoryImportReport>,
	},
	git: {
		listRepos: (projectId: string) => ipcRenderer.invoke(ipcChannels.gitListRepos, projectId) as Promise<GitRepoInfo[]>,
		branches: (projectId: string, repoPath?: string) => ipcRenderer.invoke(ipcChannels.gitBranches, projectId, repoPath) as Promise<GitBranchInfo>,
		checkout: (projectId: string, branch: string, repoPath?: string) => ipcRenderer.invoke(ipcChannels.gitCheckout, projectId, branch, repoPath) as Promise<GitBranchInfo>,
		createBranch: (projectId: string, branchName: string, repoPath?: string) => ipcRenderer.invoke(ipcChannels.gitCreateBranch, projectId, branchName, repoPath) as Promise<GitBranchInfo>,

		originalContent: (filePath: string) => ipcRenderer.invoke(ipcChannels.gitOriginalContent, filePath) as Promise<string>,

		worktreeList: (projectId: string) => ipcRenderer.invoke(ipcChannels.gitWorktreeList, projectId) as Promise<WorktreeEntry[]>,

		worktreeCreate: (projectId: string, branchName: string) => ipcRenderer.invoke(ipcChannels.gitWorktreeCreate, projectId, branchName) as Promise<{ path: string; branch: string }>,

		worktreeRemove: (projectId: string, worktreePath: string) => ipcRenderer.invoke(ipcChannels.gitWorktreeRemove, projectId, worktreePath) as Promise<boolean>,

		commitLog: (projectId: string, options?: { maxEntries?: number; ref?: string; path?: string; allBranches?: boolean }, repoPath?: string) => ipcRenderer.invoke(ipcChannels.gitCommitLog, projectId, options, repoPath) as Promise<CommitEntry[]>,

		commitCount: (projectId: string, options?: { ref?: string; path?: string; allBranches?: boolean }, repoPath?: string) => ipcRenderer.invoke(ipcChannels.gitCommitCount, projectId, options, repoPath) as Promise<number>,

		refs: (projectId: string, repoPath?: string) => ipcRenderer.invoke(ipcChannels.gitRefs, projectId, repoPath) as Promise<GitRef[]>,

		branchCompare: (projectId: string, base: string, target: string, repoPath?: string) => ipcRenderer.invoke(ipcChannels.gitBranchCompare, projectId, base, target, repoPath) as Promise<BranchDiffResult>,

		commitDetail: (projectId: string, ref: string, repoPath?: string) => ipcRenderer.invoke(ipcChannels.gitCommitDetail, projectId, ref, repoPath) as Promise<CommitDetail | null>,

		commitFileDiff: (projectId: string, ref: string, filePath: string, originalPath?: string, repoPath?: string) => ipcRenderer.invoke(ipcChannels.gitCommitFileDiff, projectId, ref, filePath, originalPath, repoPath) as Promise<GitCommitFileDiff | null>,

		diffFileBetween: (projectId: string, ref1: string, ref2: string, filePath: string, repoPath?: string) => ipcRenderer.invoke(ipcChannels.gitDiffFileBetween, projectId, ref1, ref2, filePath, repoPath) as Promise<string>,

		status: (projectId: string, repoPath?: string) => ipcRenderer.invoke(ipcChannels.gitStatus, projectId, repoPath) as Promise<import("../shared/types").GitResourceGroups>,

		workspaceFileDiff: (projectId: string, group: GitWorkspaceDiffGroup, filePath: string, repoPath?: string) => ipcRenderer.invoke(ipcChannels.gitWorkspaceFileDiff, projectId, group, filePath, repoPath) as Promise<GitWorkspaceFileDiff | null>,

		stage: (projectId: string, paths: string[], repoPath?: string) => ipcRenderer.invoke(ipcChannels.gitStage, projectId, paths, repoPath) as Promise<void>,

		unstage: (projectId: string, paths: string[], repoPath?: string) => ipcRenderer.invoke(ipcChannels.gitUnstage, projectId, paths, repoPath) as Promise<void>,

		discard: (projectId: string, group: "workingTree" | "untracked", filePath: string, repoPath?: string) => ipcRenderer.invoke(ipcChannels.gitDiscard, projectId, group, filePath, repoPath) as Promise<void>,

		discardFiles: (projectId: string, resources: GitDiscardResource[], repoPath?: string) => ipcRenderer.invoke(ipcChannels.gitDiscardFiles, projectId, resources, repoPath) as Promise<void>,

		commit: (projectId: string, message: string, repoPath?: string) => ipcRenderer.invoke(ipcChannels.gitCommit, projectId, message, repoPath) as Promise<void>,
		cherryPick: (projectId: string, hash: string, repoPath?: string) => ipcRenderer.invoke(ipcChannels.gitCherryPick, projectId, hash, repoPath) as Promise<void>,
		revert: (projectId: string, hash: string, repoPath?: string) => ipcRenderer.invoke(ipcChannels.gitRevert, projectId, hash, repoPath) as Promise<void>,
		reset: (projectId: string, hash: string, mode: "soft" | "mixed" | "hard", repoPath?: string) => ipcRenderer.invoke(ipcChannels.gitReset, projectId, hash, mode, repoPath) as Promise<void>,
		dropCommit: (projectId: string, hash: string, repoPath?: string) => ipcRenderer.invoke(ipcChannels.gitDropCommit, projectId, hash, repoPath) as Promise<void>,

		generateCommitMessage: (projectId: string, repoPath?: string) => ipcRenderer.invoke(ipcChannels.gitGenerateCommitMessage, projectId, repoPath) as Promise<import("../shared/types").GitGenerateCommitMessageResult>,

		init: (projectId: string) => ipcRenderer.invoke(ipcChannels.gitInit, projectId) as Promise<void>,

		push: (projectId: string, repoPath?: string) => ipcRenderer.invoke(ipcChannels.gitPush, projectId, repoPath) as Promise<void>,

		pull: (projectId: string, repoPath?: string) => ipcRenderer.invoke(ipcChannels.gitPull, projectId, repoPath) as Promise<void>,

		fetch: (projectId: string, repoPath?: string) => ipcRenderer.invoke(ipcChannels.gitFetch, projectId, repoPath) as Promise<void>,

		aheadBehind: (projectId: string, repoPath?: string) => ipcRenderer.invoke(ipcChannels.gitAheadBehind, projectId, repoPath) as Promise<import("../shared/types").GitAheadBehind | null>,

		watchRefs: (projectId: string, repoPath?: string) => ipcRenderer.invoke(ipcChannels.gitWatchRefs, projectId, repoPath) as Promise<string>,

		unwatchRefs: (watchId: string) => ipcRenderer.invoke(ipcChannels.gitUnwatchRefs, watchId) as Promise<void>,

		onRefsChanged: (listener: (watchId: string) => void) => {
			const handler = (_event: unknown, watchId: string) => listener(watchId);
			ipcRenderer.on(ipcChannels.gitRefsChanged, handler);
			return () => {
				ipcRenderer.removeListener(ipcChannels.gitRefsChanged, handler);
			};
		},

		deleteFiles: (projectId: string, paths: string[], repoPath?: string) => ipcRenderer.invoke(ipcChannels.gitDeleteFiles, projectId, paths, repoPath) as Promise<void>,

		detectExecutable: (configuredPath?: string) => ipcRenderer.invoke(ipcChannels.gitDetectExecutable, configuredPath) as Promise<GitExecutableInfo>,

		chooseExecutable: () => ipcRenderer.invoke(ipcChannels.gitChooseExecutable) as Promise<string | null>,
	},
	pi: {
		check: (force?: boolean) => ipcRenderer.invoke(ipcChannels.piCheck, force === true) as Promise<PiInstallStatus>,

		checkCustom: (customPath: string, activate?: boolean) => ipcRenderer.invoke(ipcChannels.piCheckCustom, customPath, activate !== false) as Promise<PiInstallStatus>,

		listInstallations: (forceShellProbe?: boolean) => ipcRenderer.invoke(ipcChannels.piInstallations, forceShellProbe === true) as Promise<PiInstallation[]>,

		chooseExecutable: () => ipcRenderer.invoke(ipcChannels.piChooseExecutable) as Promise<string | null>,

		setCustomPaths: (paths: readonly string[]) => ipcRenderer.invoke(ipcChannels.piSetCustomPaths, [...paths]) as Promise<{ paths: string[]; clearedActive: boolean }>,
		checkUpdate: () => ipcRenderer.invoke(ipcChannels.piUpdateCheck) as Promise<PiUpdateCheckResult>,
		update: () => ipcRenderer.invoke(ipcChannels.piUpdate) as Promise<PiCliUpdateResult>,

		releaseNotes: (options: { latestVersion: string; currentVersion?: string }) => ipcRenderer.invoke(ipcChannels.piReleaseNotes, options) as Promise<PiReleaseNotesPayload>,

		execInstall: (command: string) => ipcRenderer.invoke(ipcChannels.piExecInstall, command) as Promise<PiInstallExecResult>,

		checkNpm: () => ipcRenderer.invoke(ipcChannels.piCheckNpm) as Promise<NpmAvailabilityResult>,

		runtimeNodeCheck: () => ipcRenderer.invoke(ipcChannels.piRuntimeNodeCheck) as Promise<PiRuntimeNodeStatus>,

		runtimeNodeInstall: () => ipcRenderer.invoke(ipcChannels.piRuntimeNodeInstall) as Promise<PiRuntimeNodeInstallResult>,

		runtimePiInstall: (useMirror: boolean) => ipcRenderer.invoke(ipcChannels.piRuntimePiInstall, useMirror === true) as Promise<PiInstallExecResult>,
	},

	wsl: {
		listDistros: () => ipcRenderer.invoke(ipcChannels.wslListDistros) as Promise<string[]>,

		validateConnection: (distro: string, user: string) => ipcRenderer.invoke(ipcChannels.wslValidateConnection, distro, user) as Promise<WslConnectionValidation>,
	},
	system: {
		getProcessMetrics: () => ipcRenderer.invoke(ipcChannels.processMetrics) as Promise<ProcessMetricsSnapshot>,

		stopAgent: (agentId: string) => ipcRenderer.invoke(ipcChannels.stopAgent, agentId) as Promise<void>,

		getDiagnosticsSnapshot: () => ipcRenderer.invoke(ipcChannels.diagnosticsSnapshot) as Promise<DiagnosticsSnapshot>,

		getArchStatus: () => ipcRenderer.invoke(ipcChannels.archStatus) as Promise<ArchStatus>,
		openDiagnosticsFolder: () => ipcRenderer.invoke(ipcChannels.diagnosticsOpenFolder) as Promise<void>,

		healthCheck: () => ipcRenderer.invoke(ipcChannels.healthCheck) as Promise<HealthReport>,

		healthExportReport: (markdown: string, reportJson?: string) => ipcRenderer.invoke(ipcChannels.healthExportReport, markdown, reportJson) as Promise<HealthExportResult>,

		healthExportBundle: (markdown: string, reportJson: string) => ipcRenderer.invoke(ipcChannels.healthExportBundle, markdown, reportJson) as Promise<HealthExportResult>,
	},
	logs: {
		list: (query?: AppLogQuery) => ipcRenderer.invoke(ipcChannels.logsList, query ?? {}) as Promise<AppLogEntry[]>,
		listPage: (query?: AppLogQuery) => ipcRenderer.invoke(ipcChannels.logsListPage, query ?? {}) as Promise<AppLogPage>,
		clear: () => ipcRenderer.invoke(ipcChannels.logsClear) as Promise<void>,
		openFolder: () => ipcRenderer.invoke(ipcChannels.logsOpenFolder) as Promise<void>,
		getSize: () => ipcRenderer.invoke(ipcChannels.logsSize) as Promise<number>,
	},
	rpcLogs: {
		getSize: (target?: SessionRuntimeTarget) => ipcRenderer.invoke(ipcChannels.rpcLogsGetSize, target) as Promise<number>,
		get: (options?: { target?: SessionRuntimeTarget; days?: number; limit?: number }) => ipcRenderer.invoke(ipcChannels.rpcLogsGet, options) as Promise<RpcLogEntry[]>,

		getLive: (agentId?: string) => ipcRenderer.invoke(ipcChannels.rpcLogsGetLive, agentId) as Promise<RpcLogEntry[]>,

		getModelTrace: (options: { agentId: string; traceId: string }) => ipcRenderer.invoke(ipcChannels.rpcLogsGetModelTrace, options) as Promise<ModelTraceRecord | null>,

		save: (options: { entries: RpcLogEntry[] }) => ipcRenderer.invoke(ipcChannels.rpcLogsSave, options) as Promise<string[]>,

		onLog: (callback: (batch: RpcLogBatch) => void) => subscribe<{ agentId: string; entries: RpcLogEntry[] }>(ipcChannels.agentsRpcLog, callback),
		clear: (target?: SessionRuntimeTarget) => ipcRenderer.invoke(ipcChannels.rpcLogsClear, target) as Promise<void>,
		setLogging: (target: SessionRuntimeTarget, enabled: boolean) => ipcRenderer.invoke(ipcChannels.rpcLoggingSet, target, enabled) as Promise<boolean>,
		getLogging: (target: SessionRuntimeTarget) => ipcRenderer.invoke(ipcChannels.rpcLoggingGet, target) as Promise<boolean>,

		setWatching: (agentId: string, watching: boolean) => ipcRenderer.invoke(ipcChannels.rpcLogsSetWatching, agentId, watching) as Promise<boolean>,
	},
	app: {
		info: () => ipcRenderer.invoke(ipcChannels.appInfo) as Promise<AppInfo>,
		networkAddresses: () => ipcRenderer.invoke(ipcChannels.appNetworkAddresses) as Promise<WebNetworkAddress[]>,
		preferredSystemLanguages: () => ipcRenderer.invoke(ipcChannels.appPreferredSystemLanguages) as Promise<string[]>,

		checkUpdate: () => ipcRenderer.invoke(ipcChannels.appCheckUpdate) as Promise<void>,

		getChannel: () => ipcRenderer.invoke(ipcChannels.appGetChannel) as Promise<UpdateChannelInfo>,

		downloadUpdate: () => ipcRenderer.invoke(ipcChannels.appDownloadUpdate) as Promise<void>,

		installUpdate: () => ipcRenderer.invoke(ipcChannels.appInstallUpdate) as Promise<void>,

		onUpdateStatus: (callback: (snapshot: AppUpdateStatusSnapshot) => void) => subscribe(ipcChannels.appUpdateStatusChanged, callback),

		getUpdateStatus: () => ipcRenderer.invoke(ipcChannels.appUpdateStatusChanged) as Promise<AppUpdateStatusSnapshot | null>,

		notifyUpdateSeen: (kind: "app" | "pi", version: string) => ipcRenderer.invoke(ipcChannels.appUpdateNotifySeen, kind, version) as Promise<void>,

		skipUpdateVersion: (version: string) => ipcRenderer.invoke(ipcChannels.appUpdateSkipVersion, version) as Promise<void>,

		checkUpdateMirrors: () => ipcRenderer.invoke(ipcChannels.appCheckUpdateMirrors) as Promise<MirrorHealthResult[]>,
		feedbackEnvironment: () => ipcRenderer.invoke(ipcChannels.appFeedbackEnvironment) as Promise<FeedbackEnvironment>,

		getFeedbackProjectContext: (projectId: string) => ipcRenderer.invoke(ipcChannels.appFeedbackProjectContext, projectId) as Promise<FeedbackProjectContext>,
		openExternal: (url: string, forceSystem?: boolean) => ipcRenderer.invoke(ipcChannels.appOpenExternal, url, forceSystem) as Promise<void>,

		getChangelog: (language?: "zh" | "en", forceRefresh?: boolean) => ipcRenderer.invoke(ipcChannels.appGetChangelog, language, forceRefresh) as Promise<import("../shared/types").ChangelogPayload>,
		onOpenInBrowser: (callback: (url: string) => void) => subscribe(ipcChannels.appOpenInBrowser, callback),
		onOpenSettings: (callback: () => void) => subscribe(ipcChannels.appOpenSettings, callback),

		onShortcutTriggered: (callback: (id: import("../shared/shortcuts").ShortcutId) => void) => subscribe(ipcChannels.appShortcutTriggered, callback),
		restart: () => ipcRenderer.invoke(ipcChannels.appRestart) as Promise<void>,
		quit: () => ipcRenderer.invoke(ipcChannels.appQuit) as Promise<void>,

		openDataDir: () => ipcRenderer.invoke(ipcChannels.appOpenDataDir) as Promise<{ ok: boolean; error?: string }>,
		rendererLog: (level: AppLogLevel, scope: string, message: string, detail?: unknown) => ipcRenderer.invoke(ipcChannels.rendererLog, level, scope, message, detail) as Promise<void>,
		minimizeWindow: () => ipcRenderer.invoke(ipcChannels.appWindowMinimize) as Promise<void>,
		toggleMaximizeWindow: () => ipcRenderer.invoke(ipcChannels.appWindowToggleMaximize) as Promise<boolean>,
		isWindowMaximized: () => ipcRenderer.invoke(ipcChannels.appWindowIsMaximized) as Promise<boolean>,
		onWindowMaximizedChange: (callback: (maximized: boolean) => void) => subscribe(ipcChannels.appWindowMaximizedChanged, callback),

		onZoomFactorChange: (callback: (zoomFactor: number) => void) => subscribe(ipcChannels.appZoomFactorChanged, callback),
		toggleAlwaysOnTopWindow: () => ipcRenderer.invoke(ipcChannels.appWindowToggleAlwaysOnTop) as Promise<boolean>,
		isWindowAlwaysOnTop: () => ipcRenderer.invoke(ipcChannels.appWindowIsAlwaysOnTop) as Promise<boolean>,
		closeWindow: () => ipcRenderer.invoke(ipcChannels.appWindowClose) as Promise<void>,
		toggleDevTools: () => ipcRenderer.invoke(ipcChannels.appToggleDevTools) as Promise<boolean>,
	},
	skills: {
		list: () => ipcRenderer.invoke(ipcChannels.skillsList) as Promise<PiSkillListResult>,

		readContent: (path: string) => ipcRenderer.invoke(ipcChannels.skillsReadContent, path) as Promise<SkillContentResult>,
		create: (input: CreatePiSkillInput) => ipcRenderer.invoke(ipcChannels.skillsCreate, input) as Promise<PiSkillSummary>,
		toggle: (path: string, enabled: boolean) => ipcRenderer.invoke(ipcChannels.skillsToggle, path, enabled) as Promise<PiSkillSummary>,
		delete: (path: string) => ipcRenderer.invoke(ipcChannels.skillsDelete, path) as Promise<void>,
		openFolder: (path?: string) => ipcRenderer.invoke(ipcChannels.skillsOpenFolder, path) as Promise<void>,
		rename: (skillPath: string, newName: string) => ipcRenderer.invoke(ipcChannels.skillsRename, skillPath, newName) as Promise<PiSkillSummary>,
	},
	resourceImport: {
		scan: (input: ResourceImportScanInput) => ipcRenderer.invoke(ipcChannels.resourceImportScan, input) as Promise<ResourceImportScanResponse>,
		apply: (input: ResourceImportApplyInput) => ipcRenderer.invoke(ipcChannels.resourceImportApply, input) as Promise<ResourceImportApplyResponse>,
	},
	prompts: {
		list: () => ipcRenderer.invoke(ipcChannels.promptsList) as Promise<PiPromptTemplateListResult>,
		create: (input: CreatePiPromptTemplateInput) => ipcRenderer.invoke(ipcChannels.promptsCreate, input) as Promise<PiPromptTemplateSummary>,
		delete: (filePath: string) => ipcRenderer.invoke(ipcChannels.promptsDelete, filePath) as Promise<void>,
		openFolder: () => ipcRenderer.invoke(ipcChannels.promptsOpenFolder) as Promise<void>,
		edit: (filePath: string, content?: string) => ipcRenderer.invoke(ipcChannels.promptsEdit, filePath, content) as Promise<string | void>,
		listByProject: (projectId: string) => ipcRenderer.invoke(ipcChannels.promptsListByProject, projectId) as Promise<PiPromptTemplateListResult>,
		createInProject: (projectId: string, input: CreatePiPromptTemplateInput) => ipcRenderer.invoke(ipcChannels.promptsCreateInProject, projectId, input) as Promise<PiPromptTemplateSummary>,
		deleteFromProject: (projectId: string, name: string) => ipcRenderer.invoke(ipcChannels.promptsDeleteInProject, projectId, name) as Promise<void>,
		rename: (oldName: string, newName: string) => ipcRenderer.invoke(ipcChannels.promptsRename, oldName, newName) as Promise<PiPromptTemplateSummary>,
		renameInProject: (projectId: string, oldName: string, newName: string) => ipcRenderer.invoke(ipcChannels.promptsRenameInProject, projectId, oldName, newName) as Promise<PiPromptTemplateSummary>,
		toggle: (filePath: string, enabled: boolean) => ipcRenderer.invoke(ipcChannels.promptsToggle, filePath, enabled) as Promise<PiPromptTemplateSummary>,
		toggleInProject: (projectId: string, name: string, enabled: boolean) => ipcRenderer.invoke(ipcChannels.promptsToggleInProject, projectId, name, enabled) as Promise<PiPromptTemplateSummary>,
	},
	promptStore: {
		search: (query: string, options?: { limit?: number; type?: string; category?: string; tag?: string }) => ipcRenderer.invoke(ipcChannels.promptStoreSearch, query, options) as Promise<PromptStoreSearchResult>,
		get: (id: string) => ipcRenderer.invoke(ipcChannels.promptStoreGet, id) as Promise<PromptStoreItem>,
		import: (data: { title: string; description: string; content: string; projectId?: string }) => ipcRenderer.invoke(ipcChannels.promptStoreImport, data) as Promise<PiPromptTemplateSummary>,
	},
	skillStore: {
		search: (query: string) => ipcRenderer.invoke(ipcChannels.skillStoreSearch, query) as Promise<PromptStoreSearchResult>,
		import: (item: PromptStoreItem, locationId?: string, projectId?: string) => ipcRenderer.invoke(ipcChannels.skillStoreImport, item, locationId, projectId) as Promise<PiSkillSummary>,
	},
	skillHub: {
		search: (query: string, limit?: number) => ipcRenderer.invoke(ipcChannels.skillHubSearch, { query, limit } satisfies SkillHubSearchOptions) as Promise<import("../shared/types").SkillHubSearchResult>,
		detail: (slug: string) => ipcRenderer.invoke(ipcChannels.skillHubDetail, slug) as Promise<import("../shared/types").SkillHubDetail | null>,
		install: (slug: string, projectId?: string) => ipcRenderer.invoke(ipcChannels.skillHubInstall, slug, projectId) as Promise<import("../shared/types").SkillHubInstallResult>,

		onInstallProgress: (callback: (progress: import("../shared/types").SkillHubInstallProgress) => void) => subscribe(ipcChannels.skillHubInstallProgress, callback),
	},
	yaoPrompts: {
		list: (opts?: { category?: string; search?: string; page?: number; pageSize?: number; categoriesOnly?: boolean }) => ipcRenderer.invoke(ipcChannels.yaoPromptsList, opts) as Promise<YaoPromptListResult>,
		detail: (slug: string, category: string) => ipcRenderer.invoke(ipcChannels.yaoPromptsDetail, slug, category) as Promise<YaoPromptDetailResult>,
		import: (slug: string, category: string, projectId?: string) => ipcRenderer.invoke(ipcChannels.yaoPromptsImport, slug, category, projectId) as Promise<PiPromptTemplateSummary>,
		onDbStateChange: (callback: (state: YaoPromptDbSnapshot) => void) => subscribe(ipcChannels.yaoPromptsDbState, callback),
		retryDb: () => ipcRenderer.invoke(ipcChannels.yaoPromptsDbRetry) as Promise<YaoPromptDbSnapshot>,
	},
	extensions: {
		list: (forceRefresh?: boolean) => ipcRenderer.invoke(ipcChannels.extensionsList, forceRefresh) as Promise<PiExtensionListResult>,
		uninstall: (source: string, scope?: "user" | "project" | "unknown", projectId?: string) => ipcRenderer.invoke(ipcChannels.extensionsUninstall, source, scope, projectId) as Promise<void>,
		install: (source: string, projectId?: string) => ipcRenderer.invoke(ipcChannels.extensionsInstall, source, projectId) as Promise<string>,
		toggle: (source: string, enabled: boolean, scope?: "user" | "project" | "unknown", path?: string, projectId?: string) => ipcRenderer.invoke(ipcChannels.extensionsToggle, source, enabled, scope, path, projectId) as Promise<void>,
		removeBuiltIn: (source: string) => ipcRenderer.invoke(ipcChannels.extensionsRemoveBuiltIn, source) as Promise<void>,
		restoreBuiltIn: (source: string) => ipcRenderer.invoke(ipcChannels.extensionsRestoreBuiltIn, source) as Promise<void>,
		update: () => ipcRenderer.invoke(ipcChannels.extensionsUpdate) as Promise<PiCliUpdateResult>,
		updateOne: (source: string) => ipcRenderer.invoke(ipcChannels.extensionsUpdateOne, source) as Promise<PiCliUpdateResult>,
		catalog: (query: import("../shared/types").PiPackageCatalogQuery) => ipcRenderer.invoke(ipcChannels.extensionsCatalog, query) as Promise<import("../shared/types").PiPackageCatalog>,

		builtInStatus: () => ipcRenderer.invoke(ipcChannels.extensionsBuiltInUpdateStatus) as Promise<BuiltInExtensionsUpdateStatus>,
		builtInCheck: (branch?: "main" | "dev") => ipcRenderer.invoke(ipcChannels.extensionsBuiltInUpdateCheck, branch) as Promise<BuiltInExtensionsCheckResult>,
		builtInUpdate: (branch?: "main" | "dev") => ipcRenderer.invoke(ipcChannels.extensionsBuiltInUpdateApply, branch) as Promise<BuiltInExtensionsUpdateResult>,
		builtInRestore: () => ipcRenderer.invoke(ipcChannels.extensionsBuiltInUpdateRestore) as Promise<BuiltInExtensionsUpdateResult>,
		builtInRestorePrevious: () => ipcRenderer.invoke(ipcChannels.extensionsBuiltInUpdateRestorePrevious) as Promise<BuiltInExtensionsUpdateResult>,

		builtInOpenDir: () => ipcRenderer.invoke(ipcChannels.extensionsBuiltInOpenDir) as Promise<void>,
	},

	contentStore: {
		promptsStatus: () => ipcRenderer.invoke(ipcChannels.promptsStoreUpdateStatus) as Promise<BuiltinContentUpdateStatus>,
		promptsCheck: (branch?: "main" | "dev") => ipcRenderer.invoke(ipcChannels.promptsStoreUpdateCheck, branch) as Promise<BuiltinContentCheckResult>,
		promptsUpdate: (branch?: "main" | "dev") => ipcRenderer.invoke(ipcChannels.promptsStoreUpdateApply, branch) as Promise<BuiltinContentUpdateResult>,
		promptsRestore: () => ipcRenderer.invoke(ipcChannels.promptsStoreUpdateRestore) as Promise<BuiltinContentUpdateResult>,
		promptsRestorePrevious: () => ipcRenderer.invoke(ipcChannels.promptsStoreUpdateRestorePrevious) as Promise<BuiltinContentUpdateResult>,

		promptsOpenDir: () => ipcRenderer.invoke(ipcChannels.promptsStoreOpenDir) as Promise<void>,
		skillsStatus: () => ipcRenderer.invoke(ipcChannels.skillsStoreUpdateStatus) as Promise<BuiltinContentUpdateStatus>,
		skillsCheck: (branch?: "main" | "dev") => ipcRenderer.invoke(ipcChannels.skillsStoreUpdateCheck, branch) as Promise<BuiltinContentCheckResult>,
		skillsUpdate: (branch?: "main" | "dev") => ipcRenderer.invoke(ipcChannels.skillsStoreUpdateApply, branch) as Promise<BuiltinContentUpdateResult>,
		skillsRestore: () => ipcRenderer.invoke(ipcChannels.skillsStoreUpdateRestore) as Promise<BuiltinContentUpdateResult>,
		skillsRestorePrevious: () => ipcRenderer.invoke(ipcChannels.skillsStoreUpdateRestorePrevious) as Promise<BuiltinContentUpdateResult>,

		skillsOpenDir: () => ipcRenderer.invoke(ipcChannels.skillsStoreOpenDir) as Promise<void>,
	},
	acp: {
		listTools: () => ipcRenderer.invoke(ipcChannels.acpToolsList) as Promise<AcpToolConfig[]>,

		saveTools: (tools: AcpToolInput[]) => ipcRenderer.invoke(ipcChannels.acpToolsSave, tools) as Promise<AcpToolConfig[]>,

		validateTool: (input: AcpToolInput) => ipcRenderer.invoke(ipcChannels.acpToolValidate, input) as Promise<AcpToolValidation>,

		detectTool: (presetId: import("../shared/acpToolPresets").AcpToolPresetId) => ipcRenderer.invoke(ipcChannels.acpToolDetect, presetId) as Promise<import("../shared/types/acp").AcpToolStatus>,

		installTool: (presetId: import("../shared/acpToolPresets").AcpToolPresetId) => ipcRenderer.invoke(ipcChannels.acpToolInstall, presetId) as Promise<{ ok: boolean; output: string }>,

		uninstallTool: (presetId: import("../shared/acpToolPresets").AcpToolPresetId) => ipcRenderer.invoke(ipcChannels.acpToolUninstall, presetId) as Promise<{ ok: boolean; output: string }>,

		onLifecycleEvent: (callback: (event: import("../shared/types/acp").AcpLifecycleEvent) => void) => subscribe(ipcChannels.acpLifecycleEvent, callback),

		getSessionConfig: (agentId: string) => ipcRenderer.invoke(ipcChannels.acpSessionConfigGet, agentId) as Promise<import("../shared/types/acp").AcpSessionConfigOption[] | null>,

		setSessionConfig: (agentId: string, optionId: string, value: string | boolean) => ipcRenderer.invoke(ipcChannels.acpSessionConfigSet, { agentId, optionId, value }) as Promise<import("../shared/types/acp").AcpSessionConfigOption[]>,

		onSessionConfigChanged: (callback: (event: import("../shared/types/acp").AcpSessionConfigChangedEvent) => void) => subscribe(ipcChannels.acpSessionConfigChanged, callback),
	},
	settings: {
		get: () => ipcRenderer.invoke(ipcChannels.settingsGet) as Promise<AppSettings>,
		update: (patch: Partial<AppSettings>) => ipcRenderer.invoke(ipcChannels.settingsUpdate, patch) as Promise<AppSettings>,
		restartWebService: () => ipcRenderer.invoke(ipcChannels.settingsRestartWebService) as Promise<void>,
		webServiceStatus: () => ipcRenderer.invoke(ipcChannels.webServiceStatus) as Promise<WebServiceStatusInfo>,
		rotateWebToken: () => ipcRenderer.invoke(ipcChannels.webServiceRotateToken) as Promise<WebServiceStatusInfo>,
		setWebToken: (input: { token?: string; expiresIn?: number }) => ipcRenderer.invoke(ipcChannels.webServiceSetToken, input) as Promise<WebServiceStatusInfo>,

		webRemoteAccessState: () => ipcRenderer.invoke(ipcChannels.webRemoteAccessState) as Promise<import("../shared/types/remoteAccess").RemoteAccessState>,

		webRemoteAccessStart: (channel: import("../shared/types/remoteAccess").RemoteAccessChannelId) => ipcRenderer.invoke(ipcChannels.webRemoteAccessStart, channel) as Promise<{ ok: true; state: import("../shared/types/remoteAccess").RemoteAccessState } | { ok: false; error: string }>,

		webRemoteAccessStop: (channel: import("../shared/types/remoteAccess").RemoteAccessChannelId) => ipcRenderer.invoke(ipcChannels.webRemoteAccessStop, channel) as Promise<{ ok: true; state: import("../shared/types/remoteAccess").RemoteAccessState } | { ok: false; error: string }>,

		webRemoteAccessRefresh: () => ipcRenderer.invoke(ipcChannels.webRemoteAccessRefresh) as Promise<import("../shared/types/remoteAccess").RemoteAccessState>,

		onWebRemoteAccessChanged: (callback: (state: import("../shared/types/remoteAccess").RemoteAccessState) => void) => subscribe(ipcChannels.webRemoteAccessChanged, callback),
		testPiProxy: () => ipcRenderer.invoke(ipcChannels.settingsTestPiProxy) as Promise<PiProxyTestResult>,
		onApplyWindow: (callback: (settings: AppSettings) => void) => subscribe(ipcChannels.settingsApplyWindow, callback),
	},
	security: {
		getConfig: () => ipcRenderer.invoke(ipcChannels.securityGetConfig) as Promise<SecurityConfig>,
		updateConfig: (patch: Partial<SecurityConfig>) => ipcRenderer.invoke(ipcChannels.securityUpdateConfig, patch) as Promise<{ ok: true; config: SecurityConfig } | { ok: false; error: string }>,
		setSessionLevel: (sessionId: string, levelId: string | null) => ipcRenderer.invoke(ipcChannels.securitySetSessionLevel, sessionId, levelId) as Promise<{ ok: true; config: SecurityConfig } | { ok: false; error: string }>,
	},
	aiAaaUsage: {
		get: (force?: boolean) => ipcRenderer.invoke(ipcChannels.aiAaaUsageGet, force) as Promise<AiAaaUsageResult>,
	},
	qoderUsage: {
		get: (force?: boolean) => ipcRenderer.invoke(ipcChannels.qoderUsageGet, force) as Promise<QoderUsageResult>,
	},
	config: {
		qoderProviderSetup: (input: QoderProviderSetupInput) => ipcRenderer.invoke(ipcChannels.configQoderProviderSetup, input) as Promise<QoderProviderSetupResult>,
		qoderProviderStatus: () => ipcRenderer.invoke(ipcChannels.configQoderProviderStatus) as Promise<QoderProviderStatus>,
		getModels: () =>
			ipcRenderer.invoke(ipcChannels.configGetModels) as Promise<{
				raw: string;
				parsed: { providers: Record<string, unknown> };
				diagnostic?: ConfigFileDiagnostic;
			}>,
		getAuth: () =>
			ipcRenderer.invoke(ipcChannels.configGetAuth) as Promise<{
				raw: string;
				parsed: Record<string, unknown>;
				diagnostic?: ConfigFileDiagnostic;
			}>,
		getSettings: () =>
			ipcRenderer.invoke(ipcChannels.configGetSettings) as Promise<{
				raw: string;
				parsed: Record<string, unknown>;
				diagnostic?: ConfigFileDiagnostic;
			}>,
		getTrust: () =>
			ipcRenderer.invoke(ipcChannels.configGetTrust) as Promise<{
				raw: string;
				parsed: Record<string, unknown>;
				diagnostic?: ConfigFileDiagnostic;
			}>,
		getMcp: (scope?: import("../shared/types/mcp").McpConfigScope) => ipcRenderer.invoke(ipcChannels.configGetMcp, scope) as Promise<import("../shared/types/mcp").McpConfigSnapshot>,
		saveMcp: (data: import("../shared/types/mcp").McpConfigFile, scope?: import("../shared/types/mcp").McpConfigScope, expectedRevision?: string) =>
			ipcRenderer.invoke(ipcChannels.configSaveMcp, data, scope, expectedRevision) as Promise<{
				valid: boolean;
				error?: string;
				conflict?: boolean;
			}>,
		probeMcp: (definition: import("../shared/types/mcp").McpServerDefinition) => ipcRenderer.invoke(ipcChannels.configProbeMcp, definition) as Promise<import("../shared/types/mcp").McpProbeResult>,

		mcpListStatus: (scope?: import("../shared/types/mcp").McpConfigScope) => ipcRenderer.invoke(ipcChannels.mcpListStatus, scope) as Promise<import("../shared/types/mcp").McpCliListResult>,
		mcpLogin: (server: string, timeoutSec?: number, scope?: import("../shared/types/mcp").McpConfigScope, operationId?: string) => ipcRenderer.invoke(ipcChannels.mcpLogin, server, timeoutSec, scope, operationId) as Promise<{ ok: boolean; output: string }>,
		mcpLogout: (server: string, scope?: import("../shared/types/mcp").McpConfigScope) => ipcRenderer.invoke(ipcChannels.mcpLogout, server, scope) as Promise<{ ok: boolean; output: string }>,
		onMcpLoginUrl: (callback: (payload: { server: string; scope?: import("../shared/types/mcp").McpConfigScope; operationId?: string; url: string }) => void) => {
			const listener = (_event: Electron.IpcRendererEvent, payload: { server: string; scope?: import("../shared/types/mcp").McpConfigScope; operationId?: string; url: string }) => callback(payload);
			ipcRenderer.on(ipcChannels.mcpLoginUrl, listener);
			return () => {
				ipcRenderer.removeListener(ipcChannels.mcpLoginUrl, listener);
			};
		},

		getConfigDir: () => ipcRenderer.invoke(ipcChannels.configGetDir) as Promise<string>,

		piResourcesSummary: (scope?: import("../shared/types/mcp").McpConfigScope) => ipcRenderer.invoke(ipcChannels.piResourcesSummary, scope) as Promise<import("../shared/types/piResources").PiResourceConfigSummary>,
		piResourcesSetBuiltin: (input: { scope?: import("../shared/types/mcp").McpConfigScope; name: import("../shared/types/piResources").PiBuiltinExtension; enabled: boolean; expectedRevision?: string }) =>
			ipcRenderer.invoke(ipcChannels.piResourcesSetBuiltin, input) as Promise<import("../shared/types/piResources").PiResourceToggleResult>,
		saveModels: (data: unknown) =>
			ipcRenderer.invoke(ipcChannels.configSaveModels, data) as Promise<{
				valid: boolean;
				error?: string;

				modelLoadOk?: boolean;
				modelCount?: number;
				modelLoadReason?: string | null;
				modelLoadDetail?: string;
			}>,

		onModelsVerifyResult: (callback: (payload: ModelsVerifyResult) => void) => subscribe<ModelsVerifyResult>(ipcChannels.configModelsVerifyResult, callback),
		saveAuth: (data: unknown) =>
			ipcRenderer.invoke(ipcChannels.configSaveAuth, data) as Promise<{
				valid: boolean;
				error?: string;
			}>,
		saveSettings: (settings: Record<string, unknown>) =>
			ipcRenderer.invoke(ipcChannels.configSaveSettings, settings) as Promise<{
				valid: boolean;
				error?: string;
			}>,
		saveRaw: (fileName: string, rawJson: string) => ipcRenderer.invoke(ipcChannels.configSaveRaw, fileName, rawJson) as Promise<{ valid: boolean; error?: string }>,
		export: () => ipcRenderer.invoke(ipcChannels.configExport) as Promise<string>,
		import: (packageJson: string) => ipcRenderer.invoke(ipcChannels.configImport, packageJson) as Promise<{ valid: boolean; error?: string }>,

		discoverExternalAgents: () => ipcRenderer.invoke(ipcChannels.configDiscoverExternalAgents) as Promise<import("../shared/types/externalAgentDiscovery").ExternalAgentDiscoveryResult>,

		resolveExternalAgentKey: (sourceId: string) => ipcRenderer.invoke(ipcChannels.configResolveExternalAgentKey, sourceId) as Promise<{ ok: true; apiKey?: string } | { ok: false; error: string }>,

		fetchModels: (baseUrl: string, apiKey: string, apiType?: string, headers?: Record<string, string>, proxyMode?: "follow" | "pi" | "desktop" | "off") =>
			ipcRenderer.invoke(ipcChannels.configFetchModels, { baseUrl, apiKey, apiType, headers, proxyMode }) as Promise<{
				success: boolean;
				models?: FetchedModel[];
				error?: string;
				suggestedBaseUrl?: string;
			}>,

		getTokendanceModels: (force?: boolean) =>
			ipcRenderer.invoke(ipcChannels.configGetTokendanceModels, force) as Promise<{
				models: AvailableModel[];
				fromCache: boolean;
				at: number;
			}>,

		tokendanceAuthStart: (mode?: TokendanceAuthMode) => ipcRenderer.invoke(ipcChannels.configTokendanceAuthStart, { mode }) as Promise<{ ok: true; flowId: string; authUrl: string; mode: TokendanceAuthMode; fallbackReason?: string } | { ok: false; error: string }>,

		tokendanceAuthAwait: (flowId: string) => ipcRenderer.invoke(ipcChannels.configTokendanceAuthAwait, { flowId }) as Promise<{ ok: true; key: string } | { ok: false; error: string }>,

		tokendanceAuthCancel: (flowId: string) => ipcRenderer.invoke(ipcChannels.configTokendanceAuthCancel, { flowId }) as Promise<{ ok: boolean; error?: string }>,

		tokendanceAuthExchange: (flowId: string, code: string) => ipcRenderer.invoke(ipcChannels.configTokendanceAuthExchange, { flowId, code }) as Promise<{ ok: true; key: string } | { ok: false; error: string }>,

		tokendanceTopUpCreate: (amount: number) => ipcRenderer.invoke(ipcChannels.configTokendanceTopUpCreate, { amount }) as Promise<TokendancePaymentSessionResult>,

		tokendanceTopUpStatus: (statusUrl: string) => ipcRenderer.invoke(ipcChannels.configTokendanceTopUpStatus, { statusUrl }) as Promise<TokendancePaymentSessionResult>,

		tokendanceTopUpOpenAlipay: (url: string) => ipcRenderer.invoke(ipcChannels.configTokendanceTopUpOpenAlipay, { url }) as Promise<{ ok: boolean; error?: string }>,

		installTokendance: (apiKey?: string) =>
			ipcRenderer.invoke(ipcChannels.configInstallTokendance, { apiKey }) as Promise<{
				ok: boolean;
				modelCount: number;
				piSaved: boolean;
				error?: string;
			}>,

		visionGetConfig: () =>
			ipcRenderer.invoke(ipcChannels.visionGetConfig) as Promise<{
				config: VisionBridgeConfig | null;
				configDir: string;
			}>,

		visionSaveConfig: (config: VisionBridgeConfig) =>
			ipcRenderer.invoke(ipcChannels.visionSaveConfig, config) as Promise<{
				ok: boolean;
				error?: string;
			}>,

		visionGetLog: () =>
			ipcRenderer.invoke(ipcChannels.visionGetLog) as Promise<{
				exists: boolean;
				size: number;
				content: string;
				truncated: boolean;
			}>,

		visionClearLog: () => ipcRenderer.invoke(ipcChannels.visionClearLog) as Promise<{ ok: boolean }>,

		visionGetEvents: () =>
			ipcRenderer.invoke(ipcChannels.visionGetEvents) as Promise<{
				exists: boolean;
				size: number;
				events: Array<{
					ts: number;
					kind: "input" | "tool_result" | "request";
					model: string;
					prompt: string;
					totalDurationMs: number;
					items: Array<{
						index: number;
						imageHash?: string;
						mimeType: string;
						ok: boolean;
						error?: string;
						durationMs: number;
						cached: boolean;
						description?: string;
						outputTokens?: number;
					}>;
				}>;
				truncated: boolean;
			}>,

		visionClearEvents: () => ipcRenderer.invoke(ipcChannels.visionClearEvents) as Promise<{ ok: boolean }>,

		testProvider: (providerName: string, modelId: string, provider: unknown, apiKey: string, proxyMode?: "follow" | "pi" | "desktop" | "off") =>
			ipcRenderer.invoke(ipcChannels.configTestProvider, { providerName, modelId, provider, apiKey, proxyMode }) as Promise<import("../shared/types/fetchedModel").PiModelProbeResult>,

		fetchUsage: (provider: string, backend?: "pi") => ipcRenderer.invoke(ipcChannels.configFetchUsage, { provider, backend }) as Promise<ProviderUsageResult>,

		installUsageSkill: () => ipcRenderer.invoke(ipcChannels.configInstallUsageSkill) as Promise<{ success: boolean; path?: string; error?: string }>,

		getUsageProbes: (provider: string, backend?: "pi") => ipcRenderer.invoke(ipcChannels.configGetUsageProbes, { provider, backend }) as Promise<UsageProbeSettingsResult>,

		saveUsageProbes: (payload: UsageProbeSaveInput) => ipcRenderer.invoke(ipcChannels.configSaveUsageProbes, payload) as Promise<UsageProbeSaveResult>,

		listUsageProbeStates: (payload: { providers?: string[]; backend?: "pi" } = {}) => ipcRenderer.invoke(ipcChannels.configListUsageProbeStates, payload) as Promise<UsageProbeStatesResult>,

		testUsageProbe: (payload: UsageProbeTestInput) => ipcRenderer.invoke(ipcChannels.configTestUsageProbe, payload) as Promise<ProviderUsageResult>,

		installImageGenSkill: () => ipcRenderer.invoke(ipcChannels.configInstallImageGenSkill) as Promise<{ success: boolean; path?: string; error?: string }>,

		installMcpSetupSkill: () => ipcRenderer.invoke(ipcChannels.configInstallMcpSetupSkill) as Promise<{ success: boolean; path?: string; error?: string }>,
	},
	configBackups: {
		list: () => ipcRenderer.invoke(ipcChannels.configBackupList) as Promise<import("../shared/types/backup").ConfigBackupListResult>,

		create: (reason?: import("../shared/types/backup").ConfigBackupReason) => ipcRenderer.invoke(ipcChannels.configBackupCreate, reason ?? "manual") as Promise<import("../shared/types/backup").ConfigBackupActionResult>,

		read: (id: string) => ipcRenderer.invoke(ipcChannels.configBackupRead, id) as Promise<import("../shared/types/backup").ConfigBackupDetail | null>,

		restore: (id: string, files?: string[]) => ipcRenderer.invoke(ipcChannels.configBackupRestore, id, files) as Promise<import("../shared/types/backup").ConfigBackupActionResult>,

		delete: (id: string) => ipcRenderer.invoke(ipcChannels.configBackupDelete, id) as Promise<import("../shared/types/backup").ConfigBackupActionResult>,

		deleteMany: (ids: string[]) => ipcRenderer.invoke(ipcChannels.configBackupDeleteMany, ids) as Promise<import("../shared/types/backup").ConfigBackupDeleteManyResult>,

		deleteAll: () => ipcRenderer.invoke(ipcChannels.configBackupDeleteAll) as Promise<import("../shared/types/backup").ConfigBackupActionResult>,
	},
	pet: {
		onState: (callback: (state: PetAggregateState) => void) => subscribe(ipcChannels.petState, callback),

		list: () => ipcRenderer.invoke(ipcChannels.petList) as Promise<PetManifest[]>,

		setEnabled: (value: boolean) => ipcRenderer.invoke(ipcChannels.petSetEnabled, value) as Promise<void>,

		setId: (id: string) => ipcRenderer.invoke(ipcChannels.petSetId, id) as Promise<void>,

		moveWindow: (pos: { x: number; y: number }) => ipcRenderer.invoke(ipcChannels.petMoveWindow, pos) as Promise<void>,

		focusAgent: () => ipcRenderer.invoke(ipcChannels.petFocusAgent) as Promise<void>,
		onFocusTarget: (callback: (target: FocusTargetPayload) => void) => subscribe(ipcChannels.petFocusAgentTarget, callback),

		getPendingFocusTarget: () => ipcRenderer.invoke(ipcChannels.petGetFocusTargetPending) as Promise<FocusTargetPayload | null>,

		onSprite: (callback: (manifest: PetManifest) => void) => subscribe(ipcChannels.petCurrentSprite, callback),

		getCurrent: () => ipcRenderer.invoke(ipcChannels.petGetCurrent) as Promise<PetManifest | null>,

		onNotify: (callback: (n: PetNotification | null) => void) => subscribe(ipcChannels.petNotify, callback),
		setPreviewMode: (mode: string) => ipcRenderer.invoke(ipcChannels.petPreviewMode, mode) as Promise<void>,
		onPreviewMode: (callback: (mode: string) => void) => subscribe(ipcChannels.petPreviewMode, callback),
		onCaps: (callback: (caps: PetWindowCaps) => void) => subscribe(ipcChannels.petCaps, callback),

		testNotify: (type: "error" | "done") => ipcRenderer.invoke(ipcChannels.petTestNotify, type) as Promise<void>,

		tease: () => ipcRenderer.invoke(ipcChannels.petTease) as Promise<void>,

		setDragging: (dragging: boolean) => ipcRenderer.invoke(ipcChannels.petDragState, dragging) as Promise<void>,

		moveBy: (delta: { dx: number; dy: number }) => ipcRenderer.invoke(ipcChannels.petMoveBy, delta) as Promise<void>,

		ready: () => ipcRenderer.send(ipcChannels.petReady),

		contextMenu: () => ipcRenderer.invoke(ipcChannels.petContextMenu) as Promise<void>,
	},
	sounds: {
		onPlay: (callback: (event: SoundAlertPlayEvent) => void) => subscribe(ipcChannels.soundsPlay, callback),

		listCustom: () => ipcRenderer.invoke(ipcChannels.soundsListCustom) as Promise<CustomSoundInfo[]>,

		importCustom: () => ipcRenderer.invoke(ipcChannels.soundsImportCustom) as Promise<SoundImportResult>,

		removeCustom: (name: string) => ipcRenderer.invoke(ipcChannels.soundsRemoveCustom, name) as Promise<boolean>,
	},
	announcements: {
		list: () => ipcRenderer.invoke(ipcChannels.announcementList) as Promise<AnnouncementState>,

		refresh: () => ipcRenderer.invoke(ipcChannels.announcementRefresh) as Promise<AnnouncementState>,

		markRead: (id: string) => ipcRenderer.invoke(ipcChannels.announcementMarkRead, id) as Promise<boolean>,

		markAllRead: () => ipcRenderer.invoke(ipcChannels.announcementMarkAllRead) as Promise<boolean>,

		markNotified: (ids: readonly string[]) => ipcRenderer.invoke(ipcChannels.announcementMarkNotified, ids) as Promise<boolean>,

		onChanged: (callback: (state: AnnouncementState) => void) => subscribe(ipcChannels.announcementChanged, callback),
	},
	terminal: {
		list: (target: TerminalTarget) => ipcRenderer.invoke(ipcChannels.terminalList, target) as Promise<TerminalTab[]>,
		ensure: (target: TerminalTarget) => ipcRenderer.invoke(ipcChannels.terminalEnsure, target) as Promise<TerminalTab[]>,
		create: (target: TerminalTarget, shell?: TerminalShell) => ipcRenderer.invoke(ipcChannels.terminalCreate, target, shell) as Promise<TerminalTab>,
		input: (tabId: string, data: string) => ipcRenderer.invoke(ipcChannels.terminalInput, tabId, data) as Promise<void>,
		resize: (tabId: string, cols: number, rows: number) => ipcRenderer.invoke(ipcChannels.terminalResize, tabId, cols, rows) as Promise<void>,
		close: (tabId: string) => ipcRenderer.invoke(ipcChannels.terminalClose, tabId) as Promise<void>,
		shells: () => ipcRenderer.invoke(ipcChannels.terminalShells) as Promise<{ shell: string; label: string; available: boolean }[]>,
		fonts: () => ipcRenderer.invoke(ipcChannels.terminalFonts) as Promise<string[]>,
		onData: (callback: (payload: TerminalDataEvent) => void) => subscribe(ipcChannels.terminalData, callback),
		onExit: (callback: (payload: TerminalExitEvent) => void) => subscribe(ipcChannels.terminalExit, callback),
	},

	feishu: {
		connect: (input: FeishuConnectInput) =>
			ipcRenderer.invoke(ipcChannels.feishuConnect, input) as Promise<{
				success: boolean;
				message: string;
				detail?: string;
			}>,
		connectTemp: (input: FeishuConnectInput) =>
			ipcRenderer.invoke(ipcChannels.feishuConnectTemp, input) as Promise<{
				success: boolean;
				message: string;
				detail?: string;
				botInfo?: { id: string; name: string };
			}>,
		disconnect: () => ipcRenderer.invoke(ipcChannels.feishuDisconnect) as Promise<{ success: boolean }>,
		connectByBot: (botId: string) =>
			ipcRenderer.invoke(ipcChannels.feishuConnectByBot, botId) as Promise<{
				success: boolean;
				message: string;
				detail?: string;
			}>,
		statusRequest: () => ipcRenderer.invoke(ipcChannels.feishuStatusRequest) as Promise<FeishuBridgeStatus>,
		onStatus: (callback: (status: FeishuBridgeStatus) => void) => subscribe(ipcChannels.feishuStatus, callback),
		botsList: () => ipcRenderer.invoke(ipcChannels.feishuBotsList) as Promise<FeishuBotConfig[]>,
		botAdd: (input: FeishuConnectInput) =>
			ipcRenderer.invoke(ipcChannels.feishuBotAdd, input) as Promise<{
				success: boolean;
				bot?: FeishuBotConfig;
				error?: string;
			}>,
		botRemove: (botId: string) => ipcRenderer.invoke(ipcChannels.feishuBotRemove, botId) as Promise<boolean>,
		botConfig: (botId: string, patch: Partial<FeishuBotConfig>) => ipcRenderer.invoke(ipcChannels.feishuBotConfig, botId, patch) as Promise<FeishuBotConfig | undefined>,
		botSecret: (botId: string) => ipcRenderer.invoke(ipcChannels.feishuBotSecret, botId) as Promise<string>,
		testConnection: (appId: string, appSecret: string) => ipcRenderer.invoke(ipcChannels.feishuTestConnection, appId, appSecret) as Promise<FeishuTestResult>,
		bindingsList: () => ipcRenderer.invoke(ipcChannels.feishuBindingsList) as Promise<FeishuChatBinding[]>,
		bindingRemove: (chatId: string) => ipcRenderer.invoke(ipcChannels.feishuBindingRemove, chatId) as Promise<boolean>,
		bindingUpdate: (chatId: string, patch: Partial<FeishuChatBinding>) => ipcRenderer.invoke(ipcChannels.feishuBindingUpdate, chatId, patch) as Promise<FeishuChatBinding | undefined>,
		onMessages: (callback: (message: FeishuChatMessage) => void) => subscribe(ipcChannels.feishuMessages, callback),
		onBindingsChanged: (callback: (bindings: FeishuChatBinding[]) => void) => subscribe(ipcChannels.feishuBindingsChanged, callback),
		onWhoamiResult: (callback: (openId: string) => void) => subscribe(ipcChannels.feishuWhoamiResult, callback),
		onBotsChanged: (callback: (bots: FeishuBotConfig[]) => void) => subscribe(ipcChannels.feishuBotsChanged, callback),
		sessionBotGet: (sessionId: string) => ipcRenderer.invoke(ipcChannels.feishuSessionBotGet, sessionId) as Promise<string | null>,
		sessionBotSet: (sessionId: string, botId: string | null) => ipcRenderer.invoke(ipcChannels.feishuSessionBotSet, sessionId, botId) as Promise<FeishuSessionBotResult>,
	},

	wechat: {
		snapshot: () => ipcRenderer.invoke(ipcChannels.wechatGetSettings) as Promise<WeChatIpcResult<WeChatSettingsSnapshot>>,
		setEnabled: (enabled: boolean) => ipcRenderer.invoke(ipcChannels.wechatSetEnabled, enabled) as Promise<WeChatIpcResult<{ settings: WeChatSettings }>>,
		updateSettings: (patch: { defaultWorkspaceId?: string; defaultModelId?: string; backend?: "pi"; modelChain?: { provider: string; modelId: string; modelName?: string }[] }) => ipcRenderer.invoke(ipcChannels.wechatUpdateSettings, patch) as Promise<WeChatIpcResult<{ settings: WeChatSettings }>>,
		renameAccount: (displayName: string) => ipcRenderer.invoke(ipcChannels.wechatRenameAccount, displayName) as Promise<WeChatIpcResult<{ settings: WeChatSettings }>>,
		logout: () => ipcRenderer.invoke(ipcChannels.wechatLogout) as Promise<WeChatIpcResult<{ settings: WeChatSettings }>>,

		beginLogin: () => ipcRenderer.invoke(ipcChannels.wechatBeginLogin) as Promise<WeChatIpcResult<{ state: WeChatLoginState }>>,
		cancelLogin: () => ipcRenderer.invoke(ipcChannels.wechatCancelLogin) as Promise<WeChatIpcResult<{ state: WeChatLoginState }>>,
		submitVerifyCode: (code: string) => ipcRenderer.invoke(ipcChannels.wechatSubmitVerifyCode, code) as Promise<WeChatIpcResult<{ state: WeChatLoginState }>>,
		getLoginState: () => ipcRenderer.invoke(ipcChannels.wechatGetLoginState) as Promise<WeChatLoginState>,
		getStatus: () => ipcRenderer.invoke(ipcChannels.wechatGetStatus) as Promise<WeChatBridgeStatus>,
		getBindings: () => ipcRenderer.invoke(ipcChannels.wechatGetBindings) as Promise<WeChatBindingView[]>,
		unbindChat: (chatId: string) => ipcRenderer.invoke(ipcChannels.wechatUnbindChat, chatId) as Promise<WeChatIpcResult<{ removed: boolean; bindings: WeChatBindingView[] }>>,
		onStatus: (callback: (status: WeChatBridgeStatus) => void) => subscribe(ipcChannels.wechatStatus, callback),
		onLoginState: (callback: (state: WeChatLoginState) => void) => subscribe(ipcChannels.wechatLoginState, callback),
		onBindingsChanged: (callback: (bindings: WeChatBindingView[]) => void) => subscribe(ipcChannels.wechatBindingsChanged, callback),
	},

	browser: {
		openExternal: (url: string, forceSystem?: boolean) => ipcRenderer.invoke(ipcChannels.browserOpenExternal, url) as Promise<void>,
	},

	scratchPad: {
		list: () => ipcRenderer.invoke(ipcChannels.scratchPadList) as Promise<DraftMeta[]>,
		create: () => ipcRenderer.invoke(ipcChannels.scratchPadCreate) as Promise<DraftMeta>,
		delete: (draftPath: string) => ipcRenderer.invoke(ipcChannels.scratchPadDelete, draftPath) as Promise<void>,
		load: (draftPath?: string) => ipcRenderer.invoke(ipcChannels.scratchPadLoad, draftPath) as Promise<ScratchPadData>,
		save: (draftPath: string, content: string, cursorPosition: number) => ipcRenderer.invoke(ipcChannels.scratchPadSave, draftPath, content, cursorPosition) as Promise<void>,
		export: (draftPath: string) => ipcRenderer.invoke(ipcChannels.scratchPadExport, draftPath) as Promise<boolean>,
	},

	imagegen: {
		generate: (request: ImageGenRequest) => ipcRenderer.invoke(ipcChannels.imagegenGenerate, request) as Promise<ImageGenResult>,
		getConfig: () => ipcRenderer.invoke(ipcChannels.imagegenGetConfig) as Promise<ImageGenConfigFile>,
		saveConfig: (config: ImageGenConfigFile) => ipcRenderer.invoke(ipcChannels.imagegenSaveConfig, config) as Promise<ImageGenSaveResult>,

		readImageBlob: (ref: string) => ipcRenderer.invoke(ipcChannels.imagegenReadImageBlob, ref) as Promise<ImageBlobPayload | null>,
	},

	localImage: {
		readBytes: (path: string) => ipcRenderer.invoke(ipcChannels.localImageReadBytes, path) as Promise<LocalImageBytes | null>,
	},

	videogen: {
		submit: (request: VideoGenRequest) => ipcRenderer.invoke(ipcChannels.videogenSubmit, request) as Promise<VideoGenSubmitResult>,
		cancel: (jobId: string) => ipcRenderer.invoke(ipcChannels.videogenCancel, jobId) as Promise<{ ok: boolean }>,
		getConfig: () => ipcRenderer.invoke(ipcChannels.videogenGetConfig) as Promise<VideoGenConfigFile>,
		saveConfig: (config: VideoGenConfigFile) => ipcRenderer.invoke(ipcChannels.videogenSaveConfig, config) as Promise<VideoGenSaveResult>,

		listJobs: (sessionId: string) => ipcRenderer.invoke(ipcChannels.videogenListJobs, sessionId) as Promise<VideoGenJobSnapshot[]>,

		onEvent: (callback: (snapshot: VideoGenJobSnapshot) => void) => subscribe(ipcChannels.videogenEvent, callback),
	},

	enhance: {
		run: (input: EnhanceRunInput) => ipcRenderer.invoke(ipcChannels.enhanceRun, input) as Promise<EnhanceRunResult>,
		cancel: () => ipcRenderer.invoke(ipcChannels.enhanceCancel) as Promise<{ ok: boolean }>,
		onEvent: (callback: (payload: EnhanceEventPayload) => void) => subscribe(ipcChannels.enhanceEvent, callback),
	},

	suggestion: {
		run: (input: PromptSuggestionRunInput) => ipcRenderer.invoke(ipcChannels.suggestRun, input) as Promise<PromptSuggestionRunResult>,
		cancel: () => ipcRenderer.invoke(ipcChannels.suggestCancel) as Promise<{ ok: boolean }>,
		onEvent: (callback: (payload: EnhanceEventPayload) => void) => subscribe(ipcChannels.suggestEvent, callback),
	},

	voiceTranscription: {
		getConfig: () => ipcRenderer.invoke(ipcChannels.voiceTranscriptionGetConfig) as Promise<VoiceTranscriptionPublicConfig>,
		saveConfig: (config: VoiceTranscriptionSaveInput) => ipcRenderer.invoke(ipcChannels.voiceTranscriptionSaveConfig, config) as Promise<VoiceTranscriptionSaveResult>,
		transcribe: (request: VoiceTranscriptionRequest) => ipcRenderer.invoke(ipcChannels.voiceTranscriptionTranscribe, request) as Promise<VoiceTranscriptionResult>,
		cancel: (requestId: string) => ipcRenderer.invoke(ipcChannels.voiceTranscriptionCancel, requestId) as Promise<void>,

		startStream: (input: VoiceTranscriptionStreamStartInput) => ipcRenderer.invoke(ipcChannels.voiceTranscriptionStreamStart, input) as Promise<VoiceTranscriptionStreamStartResult>,
		sendStreamFrame: (frame: VoiceTranscriptionStreamFrame) => ipcRenderer.send(ipcChannels.voiceTranscriptionStreamFrame, frame),
		finishStream: (requestId: string) => ipcRenderer.invoke(ipcChannels.voiceTranscriptionStreamFinish, requestId) as Promise<VoiceTranscriptionResult>,
		onStreamPartial: (callback: (partial: VoiceTranscriptionStreamPartial) => void) => subscribe(ipcChannels.voiceTranscriptionStreamPartial, callback),

		test: () => ipcRenderer.invoke(ipcChannels.voiceTranscriptionTest) as Promise<VoiceTranscriptionTestResult>,

		revealSecret: (field: VoiceTranscriptionSecretField) => ipcRenderer.invoke(ipcChannels.voiceTranscriptionRevealSecret, field) as Promise<string | null>,

		runtimeStatus: () => ipcRenderer.invoke(ipcChannels.voiceTranscriptionRuntimeStatus) as Promise<WhisperRuntimeStatus>,

		installRuntime: () => ipcRenderer.invoke(ipcChannels.voiceTranscriptionRuntimeInstall) as Promise<WhisperInstallResult>,

		installModel: (modelId: string) => ipcRenderer.invoke(ipcChannels.voiceTranscriptionModelInstall, modelId) as Promise<WhisperInstallResult>,
		deleteModel: (modelId: string) => ipcRenderer.invoke(ipcChannels.voiceTranscriptionModelDelete, modelId) as Promise<WhisperInstallResult>,

		onRuntimeProgress: (callback: (progress: WhisperInstallProgress) => void) => subscribe(ipcChannels.voiceTranscriptionRuntimeProgress, callback),

		abortInstall: () => ipcRenderer.invoke(ipcChannels.voiceTranscriptionInstallCancel) as Promise<boolean>,
	},

	catalog: {
		status: () => ipcRenderer.invoke(ipcChannels.catalogUpdateStatus) as Promise<CatalogUpdateStatus>,
		check: (branch: "main" | "dev") => ipcRenderer.invoke(ipcChannels.catalogUpdateCheck, branch) as Promise<CatalogCheckResult>,
		updateFromGithub: (branch: "main" | "dev") => ipcRenderer.invoke(ipcChannels.catalogUpdateFromGithub, branch) as Promise<CatalogUpdateResult>,
		restore: () => ipcRenderer.invoke(ipcChannels.catalogUpdateRestore) as Promise<CatalogUpdateResult>,
		restorePrevious: () => ipcRenderer.invoke(ipcChannels.catalogUpdateRestorePrevious) as Promise<CatalogUpdateResult>,

		openFile: () => ipcRenderer.invoke(ipcChannels.catalogOpenFile) as Promise<void>,
	},

	quickMessages: {
		get: () => ipcRenderer.invoke(ipcChannels.quickMessagesGet) as Promise<QuickMessagesSnapshot>,

		save: (items: string[]) => ipcRenderer.invoke(ipcChannels.quickMessagesSave, items) as Promise<QuickMessagesSaveResult>,

		openFile: () => ipcRenderer.invoke(ipcChannels.quickMessagesOpenFile) as Promise<void>,
	},

	replyActions: {
		get: () => ipcRenderer.invoke(ipcChannels.replyActionsGet) as Promise<ReplyActionsSnapshot>,

		save: (items: ReplyActionRule[]) => ipcRenderer.invoke(ipcChannels.replyActionsSave, items) as Promise<ReplyActionsSaveResult>,

		openFile: () => ipcRenderer.invoke(ipcChannels.replyActionsOpenFile) as Promise<void>,
	},

	automation: {
		getSnapshot: () => ipcRenderer.invoke(ipcChannels.automationGetSnapshot) as Promise<AutomationSnapshot>,
		createTask: (input: CreateAutomationTaskInput) => ipcRenderer.invoke(ipcChannels.automationCreateTask, input) as Promise<AutomationTask>,
		updateTask: (taskId: string, patch: UpdateAutomationTaskInput) => ipcRenderer.invoke(ipcChannels.automationUpdateTask, taskId, patch) as Promise<AutomationTask>,
		deleteTask: (taskId: string) => ipcRenderer.invoke(ipcChannels.automationDeleteTask, taskId) as Promise<boolean>,
		runNow: (taskId: string) => ipcRenderer.invoke(ipcChannels.automationRunNow, taskId) as Promise<AutomationRun>,
		abortRun: (runId: string) => ipcRenderer.invoke(ipcChannels.automationAbortRun, runId) as Promise<boolean>,
		deleteRuns: (runIds: string[]) => ipcRenderer.invoke(ipcChannels.automationDeleteRuns, runIds) as Promise<number>,
		clearRuns: () => ipcRenderer.invoke(ipcChannels.automationClearRuns) as Promise<number>,
		updateSettings: (patch: UpdateAutomationSettingsInput) => ipcRenderer.invoke(ipcChannels.automationUpdateSettings, patch) as Promise<AutomationSettings>,
		previewCron: (expression: string, count?: number) => ipcRenderer.invoke(ipcChannels.automationPreviewCron, expression, count) as Promise<AutomationCronPreview>,
		onChanged: (callback: (event: AutomationChangedEvent) => void) => subscribe<AutomationChangedEvent>(ipcChannels.automationChanged, callback),
	},

	agentProfiles: {
		getSnapshot: () => ipcRenderer.invoke(ipcChannels.agentProfilesGetSnapshot) as Promise<AgentProfileSnapshot>,
		create: (input: CreateAgentProfileInput) => ipcRenderer.invoke(ipcChannels.agentProfilesCreate, input) as Promise<AgentProfile>,
		update: (agentId: string, patch: UpdateAgentProfileInput) => ipcRenderer.invoke(ipcChannels.agentProfilesUpdate, agentId, patch) as Promise<AgentProfile>,

		remove: (agentId: string) => ipcRenderer.invoke(ipcChannels.agentProfilesDelete, agentId) as Promise<boolean>,

		resetBuiltin: (agentId: string) => ipcRenderer.invoke(ipcChannels.agentProfilesResetBuiltin, agentId) as Promise<AgentProfile>,
		duplicate: (agentId: string) => ipcRenderer.invoke(ipcChannels.agentProfilesDuplicate, agentId) as Promise<AgentProfile>,
		updateSettings: (patch: UpdateAgentMarketSettingsInput) => ipcRenderer.invoke(ipcChannels.agentProfilesUpdateSettings, patch) as Promise<AgentMarketSettings>,
		onChanged: (callback: (event: AgentChangedEvent) => void) => subscribe<AgentChangedEvent>(ipcChannels.agentProfilesChanged, callback),

		invoke: (input: AgentInvokeInput) => ipcRenderer.invoke(ipcChannels.agentProfilesInvoke, input) as Promise<AgentInvokeResult>,
		cancelInvoke: () => ipcRenderer.invoke(ipcChannels.agentProfilesInvokeCancel) as Promise<{ ok: boolean }>,
		onInvokeEvent: (callback: (payload: AgentInvokeEventPayload) => void) => subscribe<AgentInvokeEventPayload>(ipcChannels.agentProfilesInvokeEvent, callback),

		bindSession: (input: BindAgentSessionInput) => ipcRenderer.invoke(ipcChannels.agentProfilesBindSession, input) as Promise<AgentMarketSettings>,

		reorder: (agentIds: string[]) => ipcRenderer.invoke(ipcChannels.agentProfilesReorder, agentIds) as Promise<string[]>,
	},

	favorites: {
		list: () => ipcRenderer.invoke(ipcChannels.favoritesList) as Promise<FavoriteEntry[]>,
		add: (input: AddFavoriteInput) => ipcRenderer.invoke(ipcChannels.favoritesAdd, input) as Promise<FavoriteEntry>,
		remove: (favoriteId: string) => ipcRenderer.invoke(ipcChannels.favoritesRemove, favoriteId) as Promise<boolean>,

		removeMany: (favoriteIds: string[]) => ipcRenderer.invoke(ipcChannels.favoritesRemoveMany, favoriteIds) as Promise<number>,

		reorder: (favoriteIds: string[]) => ipcRenderer.invoke(ipcChannels.favoritesReorder, favoriteIds) as Promise<FavoriteEntry[]>,
	},

	selectionTool: {
		getState: () => ipcRenderer.invoke(ipcChannels.selectionToolGetState) as Promise<SelectionToolWindowState>,
		hide: () => ipcRenderer.invoke(ipcChannels.selectionToolHide) as Promise<void>,

		resize: (input: SelectionToolResizeInput) => ipcRenderer.invoke(ipcChannels.selectionToolResize, input) as Promise<void>,

		insertToMain: (input: SelectionToolInsertInput) => ipcRenderer.invoke(ipcChannels.selectionToolInsertToMain, input) as Promise<boolean>,

		onCaptured: (callback: (payload: SelectionToolShowPayload) => void) => subscribe<SelectionToolShowPayload>(ipcChannels.selectionToolCaptured, callback),
		onStateChanged: (callback: (state: SelectionToolWindowState) => void) => subscribe<SelectionToolWindowState>(ipcChannels.selectionToolStateChanged, callback),

		onInserted: (callback: (payload: SelectionToolInsertInput) => void) => subscribe<SelectionToolInsertInput>(ipcChannels.selectionToolInserted, callback),
	},

	cua: {
		onApprovalRequest: (callback: (request: { requestId: string; action: string; sessionId: string; detail: unknown; timestampMs: number }) => void) => subscribe(ipcChannels.cuaApprovalRequest, callback),

		sendApprovalResponse: (requestId: string, response: { allowed: boolean; reason?: string }) => ipcRenderer.invoke(ipcChannels.cuaApprovalResponse, requestId, response) as Promise<void>,

		getState: () => ipcRenderer.invoke(ipcChannels.cuaGetState) as Promise<{ enabled: boolean; sessionOverrides: Record<string, boolean> }>,

		setState: (patch: { enabled?: boolean; sessionOverride?: { sessionId: string; enabled: boolean | null } }) => ipcRenderer.invoke(ipcChannels.cuaSetState, patch) as Promise<{ enabled: boolean; sessionOverrides: Record<string, boolean> }>,
	},
};

function subscribe<T>(channel: string, callback: (payload: T) => void) {
	const listener = (_event: Electron.IpcRendererEvent, payload: T) => callback(payload);
	ipcRenderer.on(channel, listener);
	return () => {
		ipcRenderer.removeListener(channel, listener);
	};
}

try {
	contextBridge.exposeInMainWorld("piDesktop", api);
	ipcRenderer.send(ipcChannels.preloadReady);
} catch (error) {
	const detail = error instanceof Error ? { message: error.message, stack: error.stack } : { message: String(error) };
	console.error("[PiDeck preload] Failed to expose desktop API", detail);
	ipcRenderer.send(ipcChannels.preloadError, detail);
}

export type PiDesktopApi = typeof api;
