import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, nativeImage, nativeTheme, net, protocol, safeStorage, screen, session, shell, Tray, Notification, webContents } from "electron";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { basename, dirname, isAbsolute, join } from "node:path";
import { release as osRelease } from "node:os";
import { createWriteStream, existsSync } from "node:fs";
import { copyFile, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { is } from "@electron-toolkit/utils";
import { PetSystem, type PetSystemDeps } from "./pet";
import { downgradeRunningStartedBefore, downgradeStaleRunning } from "./pi/derivedSubagents";
import { SoundAlertService } from "./sounds/SoundAlertService";
import { registerSoundIpc } from "./ipc/soundIpc";
import { registerSoundProtocol } from "./sounds/soundProtocol";
import { registerHtmlPreviewProtocol } from "./htmlPreviewProtocol";
import { AnnouncementService } from "./announcements/AnnouncementService";
import { registerAnnouncementIpc } from "./ipc/announcementIpc";
import { CuaService } from "./cua/CuaService";
import { BrowserAgentService } from "./browser/BrowserAgentService";
import { AutomationStore } from "./automation/AutomationStore";
import { AgentProfileStore } from "./agents/AgentProfileStore";
import { FavoritesStore } from "./favorites/FavoritesStore";
import { AgentInvokeService } from "./agents/AgentInvokeService";
import { AutomationScheduler } from "./automation/AutomationScheduler";
import { AutomationRunCoordinator } from "./automation/AutomationRunCoordinator";
import { registerAutomationIpc } from "./ipc/automationIpc";
import { registerAgentProfileIpc } from "./ipc/agentProfileIpc";
import { registerFavoritesIpc } from "./ipc/favoritesIpc";
import { registerAgentInvokeIpc } from "./ipc/agentInvokeIpc";
import { registerSelectionToolIpc } from "./ipc/selectionToolIpc";
import { SelectionToolService } from "./selection/SelectionToolService";
import { SelectionToolWindow } from "./selection/SelectionToolWindow";
import { ClipboardSelectionWatcher } from "./selection/clipboardSelectionWatcher";
import { WindowsSelectionCapture } from "./selection/windowsSelectionCapture";
import { resolveShortcutBindings } from "../shared/shortcuts";
import { SYSTEM_SELECTION_TOOL_ENABLED } from "../shared/types/selectionTool";
import { registerFeishuIpc } from "./ipc/feishuIpc";
import { registerWeChatIpc } from "./ipc/wechatIpc";
import { applyLinuxDisplayBackendWorkaround, isUsingLinuxXWaylandWorkaround } from "./linuxDisplayBackend";
import { readBootPreferences } from "./settings/SettingsStore";
import { acquireVersionSingleInstance, type FocusPayload } from "./singleInstance";
import { mainProcessJsFlags, rendererHeapAdditionalArguments } from "./v8HeapLimits";
import { isDevToolsShortcut, toggleMainWindowDevTools } from "./devTools";
import { isShortcutInput, refreshShortcutBindings } from "./appShortcuts";

import { detectThirdPartyMcpExtensions } from "../shared/mcpThirdParty";
import { composeAppTitle } from "../shared/appTitle";
import { PiResourceConfigService } from "./config/PiResourceConfigService";
import { isPackageSource, projectExtensionEnabled, projectExtensionFiltered } from "./config/PiResourceConfigService";
import { runPackageRootRuleRepair, type PackageRootRuleRepairDeps } from "./config/piPackageRootRuleRepair";
import { projectResourceEnabled } from "./config/piResourceRules";
import { PiResourceStateStore } from "./config/PiResourceStateStore";
import { readPiConfigFile } from "./config/piConfigFileStore";
import { ensurePiSettingsDefaults } from "./config/piSettingsDefaults";
import { runGlobalResourceMigration, runProjectResourceMigration } from "./config/piResourceMigrationRunner";
import type { ResolvedMigrationResource } from "./config/piResourceMigration";
import type { PiResourceScope } from "../shared/types/piResources";
import { createWindowZoomShortcutHandler } from "./windowZoom";
import { DEFAULT_DEV_USER_DATA_NAME, isSharedDevBranch, readDevGitBranch, resolveDevUserDataDirName } from "./devIsolation";
import { KEEP_DEV_HTTP_CACHE_ENV, clearDevRendererCache } from "./devRendererCache";
import { isPortablePackagedEnv, resolveAppUserDataDir, resolvePackagedUserDataDir } from "./portableUserData";
import { readDataEnvDecision, validateStartupDataEnv, writeDataEnvDecision } from "./dataEnv/dataEnvMarker";
import { registerDataEnvIpc } from "./ipc/dataEnvIpc";
import { ChannelSwitchService } from "./update/ChannelSwitchService";
import { registerChannelSwitchIpc } from "./ipc/channelSwitchIpc";
import { resolveUpdateChannel } from "./update/channelIdentity";
import { APP_DEEP_LINK_SCHEME } from "./utils/deepLinkScheme";
import { APP_DISPLAY_NAME, initializeAppBrand } from "./utils/appBrand";
import { migrateDevUserData } from "./projects/devUserDataMigration";
import { isMainWindowFocused, shouldAlertNow } from "./notifications/alertFocusGate";
import { buildToastXml, notificationLaunchUrl, resolveNotificationLogoUri } from "./notifications/notificationToast";
import { extractFocusTargetFromArgv } from "./utils/focusTarget";
import type { Project, StartupWindowMode } from "../shared/types";
import type { DataEnvMode } from "../shared/types/dataEnv";

import iconPath from "../../build/icon.png?asset";
import { applyTrayLogoStyle, applyWindowLogoStyle, resolveLogoImage } from "./appWindowLogo";
import { applyTaskbarIcon, registerTaskbarIdentityAumid, resolveAppUserModelId, syncTaskbarShortcutIcon } from "./appTaskbarIdentity";

declare const __PIDECK_DEV_BUILD__: boolean;

const isDevBuild = !app.isPackaged || __PIDECK_DEV_BUILD__;

initializeAppBrand(app, app.isPackaged && __PIDECK_DEV_BUILD__ ? "APIX Dev" : APP_DISPLAY_NAME);

const isE2E = process.env.PIDECK_E2E === "1";

const e2eWindowPlacement = resolveE2EWindowPlacement(isE2E, process.env.PIDECK_E2E_WINDOW_MODE);
if (isE2E) {
	for (const switchName of E2E_RENDERING_SWITCHES) app.commandLine.appendSwitch(switchName);
}

applyChromiumFeatureFlags(app.commandLine, isE2E ? ["CalculateNativeWinOcclusion"] : []);

const bootAnchorMs = Date.now();

let userDataNameMigrationResult: UserDataNameMigration | null = null;
const isolateDevByGitBranch = !app.isPackaged;
const devGitBranch = isolateDevByGitBranch ? readDevGitBranch() : undefined;
const devUserDataDirName = isolateDevByGitBranch ? resolveDevUserDataDirName(devGitBranch) : DEFAULT_DEV_USER_DATA_NAME;
const explicitUserDataDir = (isE2E ? process.env.PIDECK_E2E_USER_DATA_DIR?.trim() : undefined) || app.commandLine.getSwitchValue("user-data-dir") || process.argv.find((arg) => arg.startsWith("--user-data-dir="))?.slice("--user-data-dir=".length);

const gatedExplicitUserDataDir = explicitUserDataDir && (isDevBuild || isE2E) ? explicitUserDataDir : undefined;

const updateChannel = resolveUpdateChannel();
const devDirectoryMigration = migrateDevUserData({
	appDataDir: app.getPath("appData"),
	homeDir: app.getPath("home"),
	devDirectoryName: devUserDataDirName,
	isPackaged: app.isPackaged,
	channel: updateChannel,
	portableExeDir: process.platform === "win32" ? process.env.PORTABLE_EXECUTABLE_DIR?.trim() : undefined,
	explicitDir: gatedExplicitUserDataDir,
});
const channelDevDataDir = updateChannel === "dev" ? devDirectoryMigration.channelDevDataDir : "";
const devDataMode: DataEnvMode | null = updateChannel === "dev" ? (readDataEnvDecision(channelDevDataDir)?.dataMode ?? null) : null;

const packagedAppDataDir = app.getPath("appData");
const fallbackSharedDataDir = resolvePackagedUserDataDir({ appData: packagedAppDataDir });
if (app.isPackaged && !gatedExplicitUserDataDir) {
	userDataNameMigrationResult = runUserDataNameMigration({
		appDataDir: packagedAppDataDir,
		homeDir: app.getPath("home"),
		portableOrExplicit: isPortablePackagedEnv(),
	});
	recordUserDataNameMigrationNotice(userDataNameMigrationResult);
}
app.setPath(
	"userData",
	resolveAppUserDataDir({
		explicitDir: gatedExplicitUserDataDir,
		unpackagedDevDir: devDirectoryMigration.unpackagedDevDir,
		isPackaged: app.isPackaged,
		channel: updateChannel,
		devDataMode,
		channelDevDataDir,
		fallbackSharedDir: userDataNameMigrationResult?.userDataPath ?? fallbackSharedDataDir,
	}),
);

const bootPreferences = readBootPreferences();
const petEnabledAtLaunch = bootPreferences.petEnabled;
applyLinuxDisplayBackendWorkaround(petEnabledAtLaunch);

const electronChromiumSandboxEnabled = bootPreferences.electronChromiumSandbox;
if (!electronChromiumSandboxEnabled) {
	app.commandLine.appendSwitch("no-sandbox");
}

app.commandLine.appendSwitch("js-flags", mainProcessJsFlags());

if (process.platform === "win32") {
	const appUserModelId = resolveAppUserModelId({ isDevBuild, devUserDataDirName, devGitBranch });
	app.setAppUserModelId(appUserModelId);

	registerTaskbarIdentityAumid(appUserModelId);
}

if (app.isPackaged) {
	app.setAsDefaultProtocolClient(APP_DEEP_LINK_SCHEME);
}

let focusExistingWindow: ((payload?: FocusPayload) => void) | null = null;
const singleInstanceEnabled = bootPreferences.singleInstance;
const versionSingleInstance = acquireVersionSingleInstance(singleInstanceEnabled, app.getVersion(), (payload) => {
	focusExistingWindow?.(payload);
});
const gotSingleInstanceLock = versionSingleInstance.isPrimary;
if (singleInstanceEnabled && !gotSingleInstanceLock) {
	app.exit(0);
}

process.stdout.on("error", (err: NodeJS.ErrnoException) => {
	if (err.code === "EPIPE") return;
	throw err;
});
process.stderr.on("error", (err: NodeJS.ErrnoException) => {
	if (err.code === "EPIPE") return;
	throw err;
});

process.on("uncaughtException", (error) => {
	void appLogger?.error("process", "Uncaught exception", error);
	console.error("Uncaught exception:", error);
});
process.on("unhandledRejection", (reason) => {
	void appLogger?.error("process", "Unhandled rejection", reason);
	console.error("Unhandled rejection:", reason);
});
import { ipcChannels } from "../shared/ipc";
import { RendererNoiseAggregator, classifyRendererNoise, toRendererNoiseLog } from "../shared/rendererNoise";
import { mainProcessT, normalizeMainProcessLocale, type MainProcessLocale, type MainProcessTranslationKey } from "../shared/i18n/mainProcessCopy";
import { buildSessionOriginKey, canonicalizeSessionPath, toAbsoluteSessionPath } from "../shared/sessionIdentity";
import type {
	AgentTab,
	AgentUiRequest,
	AppSettings,
	AppLogLevel,
	AppLogQuery,
	AvailableModel,
	ExternalEditor,
	ExternalEditorId,
	ExternalEditorSetting,
	CreateSessionDraftInput,
	CreateAnonymousSessionInput,
	CreateAnonymousSessionResult,
	UpdateSessionRecordInput,
	FeishuBotConfig,
	FeishuBridgeStatus,
	FeishuConnectInput,
	FeishuTestResult,
	SendPromptInput,
	SendPromptResult,
	SendSessionPromptInput,
	SessionRecord,
	SessionCommandError,
	SessionCommandResult,
	SessionSearchResult,
	SessionRuntimeEvent,
	SessionRuntimeTarget,
	SessionUiResponseInput,
	PiPromptTemplateSummary,
	PromptStoreSearchResult,
	PromptStoreSearchResponse,
	PromptStoreRawItem,
	PromptStoreItem,
	YaoPromptListResult,
	YaoPromptDetailResult,
} from "../shared/types";
import { msUntilNextThemeBoundary, resolveAppColorScheme } from "../shared/themeSchedule";
import { ProjectStore } from "./projects/ProjectStore";
import { runUserDataNameMigration, recordUserDataNameMigrationNotice, type UserDataNameMigration } from "./projects/userDataNameMigration";
import { shouldAutoRegisterForeignCwd } from "./projects/projectPathPolicy";
import { defaultPathCheck } from "./projects/projectPresence";
import { FileSystemService } from "./fs/FileSystemService";
import { openSystemPath } from "./fs/openPath";
import { AgentManager } from "./pi/AgentManager";
import { PiProcess } from "./pi/PiProcess";
import { getModelTraceServer, stopModelTraceServer } from "./pi/modelTrace/ModelTraceServer";
import { PiModelCapabilityCache, watchPiConfigDirectory } from "./pi/PiModelCapabilityCache";

import { isDefaultAgentTitle } from "./pi/agentUtils";
import { CompositeAgentGateway } from "./agents/CompositeAgentGateway";
import { AcpAgentManager } from "./acp/AcpAgentManager";
import { registerAcpIpc } from "./ipc/acpIpc";
import { registerQoderProviderIpc } from "./ipc/qoderProviderIpc";
import { getQoderProviderStatus, hasQoderProviderAuth, qoderModelsFromCatalog, setupQoderProvider } from "./config/qoderProviderSetup";
import { desktopRelaunchOptions } from "./appRelaunch";
import { PiLocator } from "./pi/PiLocator";
import { PiAuthService } from "./pi/auth/PiAuthService";
import { resolvePiAuthHostLaunch } from "./pi/auth/piAuthHostLaunch";
import { EnhancePromptService, PI_ENHANCE_HOST_FILENAME } from "./pi/enhance/EnhancePromptService";
import { testPiProxy } from "./pi/PiProxyTester";
import { SessionScanner } from "./sessions/SessionScanner";
import { resolveLaunchDefaultOptions, isModelInModelsConfig } from "./sessions/launchDefaults";
import { mergeCatalogModels } from "./pi/catalogModelsForValidation";
import { pickStandbyWarmupProject } from "./pi/standbyWarmupTarget";
import { createSessionModelPreference } from "../shared/modelDisplayName";
import { modelThinkingLevelOf } from "../shared/modelThinkingLevels";
import { SessionCatalog, canAttachRuntimeMetadata } from "./sessions/SessionCatalog";
import { waitForSessionRunEnd } from "./sessions/sessionRunWaiter";
import { resolveEffectiveSessionProxyMode } from "./sessions/sessionProxyPolicy";
import { SessionRuntimeCoordinator, type SessionRuntimeBinding } from "./sessions/SessionRuntimeCoordinator";
import { migrateMergedSessionPinnedIds } from "./sessions/sessionPinnedIdsMigration";
import { IdleAgentReleaser } from "./sessions/IdleAgentReleaser";
import { StaleDraftReaper } from "./sessions/StaleDraftReaper";
import { SessionCommandIpcError } from "./sessions/SessionCommandIpcError";
import { appendSessionForkSuffix } from "./sessions/sessionForkTitle";
import { sanitizeAutomaticTitle } from "./sessions/sessionTitleSanitize";
import { renderSessionHtml as renderSessionHtmlForExport, sanitizeExportFileName } from "./sessions/sessionHtmlExport";
import { createNetDownloader, createTarExtractor } from "./pi/runtimeNodeIo";
import { createSessionForkCommands } from "./sessions/sessionForkCommands";
import { registerAllDomains } from "./api/domainAssembly";
import { CodexSessionImporter } from "./sessions/CodexSessionImporter";
import { ClaudeSessionImporter } from "./sessions/ClaudeSessionImporter";
import { QoderSessionImporter } from "./sessions/QoderSessionImporter";
import { OpenCodeSessionImporter } from "./sessions/OpenCodeSessionImporter";
import { ZCodeSessionImporter } from "./sessions/ZCodeSessionImporter";
import { WorkBuddySessionImporter } from "./sessions/WorkBuddySessionImporter";
import { CursorSessionImporter } from "./sessions/CursorSessionImporter";
import { KimiSessionImporter } from "./sessions/KimiSessionImporter";
import { KimiWorkSessionImporter } from "./sessions/KimiWorkSessionImporter";
import { MinimaxSessionImporter } from "./sessions/MinimaxSessionImporter";
import { DirectorySessionImporter } from "./sessions/DirectorySessionImporter";
import { normalizeSessionPathKey } from "./sessions/directorySessionImport";
import { SettingsStore } from "./settings/SettingsStore";
import { SecurityStore } from "./security/SecurityStore";
import { applyDesktopProxy } from "./settings/DesktopProxy";
import { GitService } from "./git/GitService";
import { GitRefsWatcher } from "./git/GitRefsWatcher";
import { WorktreeService } from "./git/WorktreeService";
import { ConfigManager } from "./config/ConfigManager";
import { ConfigBackupManager } from "./config/ConfigBackupManager";
import { TokendanceCatalogStore } from "./config/tokendanceCatalog";
import { installTokendanceProvider } from "./config/tokendanceInstaller";
import { TokendanceAuthStore } from "./config/tokendanceAuth";
import { TokendancePaymentStore } from "./config/tokendancePayment";
import { usageProbeRequest } from "./config/usageProbeTransport";
import { TOKENDANCE_PROVIDER } from "../shared/tokendance";
import { TerminalSessionManager } from "./terminal/TerminalSessionManager";
import { startTrayRegistrationVerify, type TrayRegistrationVerify } from "./tray/trayRegistrationVerify";
import { buildTrayMenuTemplate, TRAY_RECENT_PROJECTS_LIMIT } from "./tray/trayMenuTemplate";
import { TelemetryService } from "./telemetry/TelemetryService";
import { collectTelemetrySnapshot } from "./telemetry/telemetrySnapshot";
import { PromptManager } from "./prompts/PromptManager";
import { XuePromptManager } from "./prompts/XuePromptManager";
import { XueIndexService } from "./prompts/XueIndexService";
import { SessionIndexService } from "./sessions/SessionIndexService";
import { XuePromptDbStore } from "./prompts/XuePromptDbStore";
import { SkillManager } from "./skills/SkillManager";
import { readSkillContent } from "./skills/readSkillContent";
import { buildSkillInstallProxyEnv } from "./skills/skillHubInstallProxy";
import { ExtensionManager } from "./extensions/ExtensionManager";
import { BuiltInExtensionsUpdater } from "./extensions/builtInExtensionsUpdater";
import { readEffectiveBuiltInExtensionsVersion, resolveBuiltInExtensionsDir, resolveBuiltInExtensionsOverlayDir, resolveVendorNodeModulesDir, type BuiltInExtensionPathRoots } from "./extensions/builtInExtensions";
import { createPiProcessExtensionResolvers } from "./extensions/piProcessExtensionResolvers";
import { registerBuiltInExtensionIpc } from "./ipc/builtInExtensionIpc";
import { PROMPTS_STORE_CHANNELS, SKILLS_STORE_CHANNELS, registerContentStoreIpc } from "./ipc/contentStoreIpc";
import { PromptStoreUpdater } from "./prompts/promptStoreUpdater";
import { SkillStoreUpdater } from "./skills/skillStoreUpdater";
import { ProjectResourceManager } from "./projects/ProjectResourceManager";
import { ResourceImportManager } from "./resourceImport/ResourceImportManager";
import { toWslLinuxPath, toWindowsHostPath } from "./wsl/WslPaths";
import { registerProjectsIpc } from "./ipc/projectsIpc";
import { registerUsageStatsIpc } from "./ipc/usageStatsIpc";
import { UsageStatsService } from "./usageStats/UsageStatsService";
import { registerAiAaaUsageIpc } from "./ipc/aiAaaUsageIpc";
import { registerQoderUsageIpc } from "./ipc/qoderUsageIpc";
import { registerUsageQueryIpc } from "./ipc/usageQueryIpc";
import { QoderUsageService } from "./usage/QoderUsageService";
import { AiAaaUsageService } from "./usage/AiAaaUsageService";
import { constrainWindowBoundsToWorkArea, type LastWindowBounds, MIN_WINDOW_HEIGHT, MIN_WINDOW_WIDTH, readLastWindowBounds, saveLastWindowBounds } from "./windowState";
import { applyE2EWindowPlacement, E2E_RENDERING_SWITCHES, resolveE2EWindowPlacement } from "./e2eWindowMode";
import { applyChromiumFeatureFlags } from "./chromiumFeatureFlags";
import { createRendererCrashRecoveryGuard } from "./window/rendererCrashRecovery";
import { registerBackgroundImageProtocol, registerBackgroundsIpc } from "./ipc/backgroundsIpc";
import { registerWallpaperEngineIpc, registerWallpaperEngineProtocol } from "./ipc/wallpaperEngineIpc";
import { registerThemesIpc } from "./ipc/themesIpc";
import { registerHostPluginsIpc } from "./ipc/hostPluginsIpc";
import { registerPiDeckMcpIpc } from "./ipc/piDeckMcpIpc";
import { PiDeckMcpService } from "./mcp/PiDeckMcpService";
import { HostPluginSessions } from "./plugins/HostPluginSessions";
import { HostPluginService } from "./plugins/HostPluginService";
import { resolveBuiltinHostPluginDirectory } from "./plugins/builtinHostPlugins";
import { BillionContextService } from "./localServices/billionContextService";
import { LocalServiceRegistry } from "./localServices/LocalServiceRegistry";
import { createLocalServiceCli, killLocalServiceProcess } from "./localServices/localServiceCli";
import { HOST_PLUGIN_SCHEME } from "./plugins/hostPluginPolicy";
import { hostPluginPartitionId, hostPluginWebviewBridge } from "./plugins/hostPluginWebviewPolicy";
import { registerGitIpc } from "./ipc/gitIpc";
import { registerStoreIpc } from "./ipc/storeIpc";
import { registerTerminalIpc } from "./ipc/terminalIpc";
import { registerScratchPadIpc } from "./ipc/scratchPadIpc";
import { registerPasteFilesIpc } from "./ipc/pasteFilesIpc";
import { registerSecurityIpc } from "./ipc/securityIpc";
import { registerVisionIpc } from "./ipc/visionIpc";
import { registerImageGenIpc } from "./ipc/imagegenIpc";
import { ImageGenService } from "./imagegen/ImageGenService";
import { ImageSessionStore } from "./imagegen/ImageSessionStore";
import { ImageBlobStore } from "./imagegen/ImageBlobStore";
import { registerImageGenImageProtocol } from "./imagegen/ImageGenImageProtocol";
import { registerLocalImageProtocol } from "./media/LocalImageProtocol";
import { registerLocalImageIpc } from "./ipc/localImageIpc";
import { createCanonicalRootsProvider } from "./media/localImageRoots";
import { ImageGenConfigStore } from "./imagegen/ImageGenConfigStore";
import { registerVideoGenIpc } from "./ipc/videogenIpc";
import { VideoGenConfigStore } from "./videogen/VideoGenConfigStore";
import { VideoBlobStore } from "./videogen/VideoBlobStore";
import { VideoSessionStore } from "./videogen/VideoSessionStore";
import { VideoJobStore } from "./videogen/VideoJobStore";
import { VideoJobRunner } from "./videogen/VideoJobRunner";
import { registerVideoGenProtocol } from "./videogen/VideoGenProtocol";
import type { VideoGenJobSnapshot } from "../shared/types/videogen";
import { registerVoiceTranscriptionIpc } from "./ipc/voiceTranscriptionIpc";
import { VoiceTranscriptionConfigStore } from "./voice/VoiceTranscriptionConfigStore";
import { VoiceTranscriptionService } from "./voice/VoiceTranscriptionService";
import { createVolcStreamSocket } from "./voice/volcStreamSocket";
import { fetchWhisperReleaseDigests, WhisperRuntimeManager } from "./voice/WhisperRuntimeManager";
import { getWhisperModelDef } from "../shared/types/whisperRuntime";
import { WhisperTranscriber } from "./voice/WhisperTranscriber";
import { WhisperServerPool } from "./voice/WhisperServerPool";
import { VisionBridgeConfigManager } from "./settings/visionBridgeConfig";
import { registerSessionIpc, scheduleCatalogBackgroundScan } from "./ipc/sessionIpc";
import { registerWebRemoteAccessIpc } from "./ipc/webRemoteAccessIpc";
import { RemoteAccessManager } from "./web/remoteAccess/RemoteAccessManager";
import { registerSystemIpc } from "./ipc/systemIpc";
import { registerResourceImportIpc } from "./ipc/resourceImportIpc";
import { registerBackupIpc } from "./ipc/backupIpc";
import { registerCatalogIpc } from "./ipc/catalogIpc";
import { registerQuickMessagesIpc } from "./ipc/quickMessagesIpc";
import { registerNoticeHistoryIpc } from "./ipc/noticeHistoryIpc";
import { NoticeHistoryStore } from "./notices/NoticeHistoryStore";
import { registerReplyActionsIpc } from "./ipc/replyActionsIpc";
import { QuickMessageStore } from "./quickmessages/QuickMessageStore";
import { ReplyActionRuleStore } from "./replyactions/ReplyActionRuleStore";
import { QUICK_MESSAGES_DEFAULT_RESOURCE_NAME, QUICK_MESSAGES_FILE_NAME, REPLY_ACTIONS_DEFAULT_RESOURCE_NAME, REPLY_ACTIONS_FILE_NAME } from "../shared/quickMessages";
import { getPiAiCatalogIndex, lookupPiAiCatalogEntry, setPiAiCatalogUserDataDir } from "./pi/piAiBuiltinCatalog";
import { PiAiCatalogUpdater } from "./pi/PiAiCatalogUpdater";
import { fetchModelList, invalidateModelListCache, refreshModelCatalogIfStale, refreshModelList, getCachedModelList } from "./pi/modelListCache";
import { registerFilesIpc } from "./ipc/filesIpc";
import { FileIndexService } from "./files/FileIndexService";
import { SessionStoreService } from "./sessions/SessionStoreService";
import { registerClipboardIpc } from "./ipc/clipboardIpc";
import { registerShellMenuIpc } from "./ipc/shellMenuIpc";
import { QuickTaskWindowChrome } from "./quickTask/quickTaskWindowChrome";
import { registerQuickTaskIpc } from "./ipc/quickTaskIpc";
import { registerFloatingIpc } from "./ipc/floatingIpc";
import { FloatingController } from "./floating/FloatingController";
import { MiniOverlayWindow } from "./floating/MiniOverlayWindow";
import { BROWSER_PANEL_PARTITION as BROWSER_PANEL_PARTITION_SHARED, isAllowedBrowserPanelUrl as isAllowedBrowserPanelUrlShared } from "./browser/browserSecurity";
import { WebServiceManager } from "./web/WebServiceManager";
import { WebWorkspaceRoutes } from "./web/WebWorkspaceRoutes";
import { preparePreloadPath } from "./preloadPath";
import { AppLogger } from "./logging/AppLogger";
import { setAppLogger } from "./logging/sharedLogger";
import { RpcLogger } from "./logging/RpcLogger";
import { registerEditorsIpc } from "./ipc/editorsIpc";
import { registerPiAuthIpc } from "./ipc/piAuthIpc";
import { registerEnhanceIpc } from "./ipc/enhanceIpc";
import { registerPromptSuggestionIpc } from "./ipc/promptSuggestionIpc";
import { detectExternalEditors, listConfiguredExternalEditors, mergeDetectedExternalEditors, openProjectInEditor, validateExternalEditorCommand } from "./editors/EditorDetector";
import { FeishuBridge, type SessionRuntimeBindingGateway } from "./feishu/FeishuBridge";
import { feishuT, normalizeFeishuLocale, type FeishuLocale } from "./feishu/FeishuI18n";
import { wantsFeishuDoc } from "./feishu/docActions";
import { resolveFeishuFileSendIntent } from "./feishu/fileIntent";
import { listBots, getBot, addBot as addFeishuBot, removeBot as removeFeishuBot, updateBot as updateFeishuBot, getDecryptedBotAppSecret, getSessionBotId, setSessionBotId, setFeishuConfigDefaultBotName } from "./feishu/FeishuConfig";
import { WeChatService } from "./wechat/WeChatService";
import { startMemoryProfile, isMemoryProfileEnabled, type MemoryProfileHandle } from "./memory/MemoryMonitor";
import { DiagnosticsMonitor } from "./diagnostics/DiagnosticsMonitor";
import { EnvironmentDoctor } from "./health/EnvironmentDoctor";
import { LogBundleExporter } from "./health/LogBundleExporter";
import { QuitCleanupRegistry } from "./lifecycle/QuitCleanupRegistry";
import type { FeishuChatBinding } from "../shared/types";
import { createRealAutoUpdater } from "./update/createAutoUpdater";
import { installAtomgitNoCacheBypass, UPDATER_PARTITION_NAME } from "./update/atomgitNoCacheBypass";
import { createManualUpdateChecker } from "./update/macManualUpdate";
import { resolveAppUpdateDeliveryPlan } from "./update/deliveryPlan";
import { resolveManualUpdateTarget } from "./update/manualUpdateSelection";
import { downloadInstallerAsset, type InstallerDownloadProgress } from "./update/installerDownload";
import { UpdateService } from "./update/UpdateService";
import type { AppManualUpdateRelease } from "../shared/types/app";

let mainWindow: BrowserWindow | null = null;

const quickTaskChrome = new QuickTaskWindowChrome({
	getWindow: () => mainWindow,
	saveWorkbenchBounds: (bounds) => saveLastWindowBounds(app.getPath("userData"), bounds),
});
let floatingController: FloatingController | null = null;
let miniOverlayWindow: MiniOverlayWindow | null = null;
let tray: Tray | null = null;

let trayRegistrationVerify: TrayRegistrationVerify | null = null;

let isQuitting = false;

const rendererCrashGuard = createRendererCrashRecoveryGuard();
let projectStore: ProjectStore;
let fileSystemService: FileSystemService;

function projectPathsForContentSearch(): string[] {
	return projectStore
		.list()
		.filter((project) => project.environment !== "wsl")
		.map((project) => project.path);
}

function sessionMessageSearchInFile(sessionPath: string, query: string): Promise<SessionSearchResult | null> {
	const service = sessionIndexService;
	if (!service) return Promise.resolve(null);
	return (async () => {
		const roots = await sessionScanner.resolveContentSearchRoots(projectPathsForContentSearch());
		if (roots.length === 0) return null;
		if (!service.isReady(roots)) {
			service.warmup(roots);
			return null;
		}
		const refreshed = await service.refresh(roots);
		if (!refreshed.ok && !service.isReady(roots)) return null;
		const result = await service.searchInSession(roots, sessionPath, query);
		return result.ok ? result.value : null;
	})();
}
let sessionScanner: SessionScanner;
let sessionCatalog: SessionCatalog;
let sessionRuntimeCoordinator: SessionRuntimeCoordinator;

let idleAgentReleaser: IdleAgentReleaser | null = null;
let staleDraftReaper: StaleDraftReaper | null = null;
let codexSessionImporter: CodexSessionImporter;
let claudeSessionImporter: ClaudeSessionImporter;
let qoderSessionImporter: QoderSessionImporter;
let openCodeSessionImporter: OpenCodeSessionImporter;
let zcodeSessionImporter: ZCodeSessionImporter;
let workbuddySessionImporter: WorkBuddySessionImporter;
let cursorSessionImporter: CursorSessionImporter;
let kimiSessionImporter: KimiSessionImporter;

let kimiWorkSessionImporter: KimiWorkSessionImporter;

let minimaxSessionImporter: MinimaxSessionImporter;

let directorySessionImporter: DirectorySessionImporter;
let settingsStore: SettingsStore;
let securityStore: SecurityStore;
let worktreeService: WorktreeService;
let gitService: GitService;

let gitRefsWatcher: GitRefsWatcher;
let piLocator: PiLocator;
let agentManager: AgentManager;

let piModelCapabilityCache: PiModelCapabilityCache | undefined;
let acpAgentManager: AcpAgentManager;

let acpImageBlobStore: ImageBlobStore | null = null;

let compositeAgentGateway: CompositeAgentGateway | undefined;
let configManager: ConfigManager;

let piResourceConfigService: PiResourceConfigService | undefined;
let piResourceStateStore: PiResourceStateStore | undefined;

let ensurePiResourceMigration: ((projectId?: string) => Promise<void>) | undefined;

let skillManagerNativeEntries: string[] | null = null;
let promptManagerNativeEntries: string[] | null = null;
let extensionManagerNativeEntries: string[] | null = null;

let extensionManagerNativePackages: unknown[] | null = null;
let configBackupManager: ConfigBackupManager | undefined;
let promptManager: PromptManager;
let xuePromptManager: XuePromptManager;

let xueIndexService: XueIndexService | null = null;
let sessionIndexService: SessionIndexService | null = null;

let fileIndexService: FileIndexService | null = null;

let sessionStoreService: SessionStoreService | null = null;

let xuePromptDbStore: XuePromptDbStore | null = null;
let skillManager: SkillManager;
let extensionManager: ExtensionManager;

let updateService: UpdateService | null = null;
let projectResourceManager: ProjectResourceManager;
let resourceImportManager: ResourceImportManager;
let webServiceManager: WebServiceManager;
let remoteAccessManager: RemoteAccessManager;
let terminalManager: TerminalSessionManager;
let petSystem: PetSystem | null = null;

let soundAlertService: SoundAlertService | null = null;

let announcementService: AnnouncementService | null = null;

let cuaService: CuaService | null = null;

let browserAgentService: BrowserAgentService | null = null;

let automationStore: AutomationStore | null = null;
let automationScheduler: AutomationScheduler | null = null;
let automationRunCoordinator: AutomationRunCoordinator | null = null;
let appLogger: AppLogger;
let rpcLogger: RpcLogger;

let memoryProfileHandle: MemoryProfileHandle | null = null;

let diagnosticsMonitor: DiagnosticsMonitor | null = null;

let environmentDoctor: EnvironmentDoctor | null = null;

let logBundleExporter: LogBundleExporter | null = null;

const feishuBridgeRef: { current: FeishuBridge | null } = { current: null };

const wechatServiceRef: { current: WeChatService | null } = { current: null };

let usageStatsService: UsageStatsService | null = null;

let piAuthService: PiAuthService | null = null;

let enhancePromptService: EnhancePromptService | null = null;

let agentProfileStore: AgentProfileStore | null = null;

let favoritesStore: FavoritesStore | null = null;

let agentInvokeService: AgentInvokeService | null = null;

let promptSuggestionService: EnhancePromptService | null = null;

let agentInvokeCompletionService: EnhancePromptService | null = null;

let selectionToolWindow: SelectionToolWindow | null = null;

let selectionToolService: SelectionToolService | null = null;

let selectionClipboardWatcher: ClipboardSelectionWatcher | null = null;

let windowsSelectionCapture: WindowsSelectionCapture | null = null;

let selectionShortcutConflict: string | null = null;
let selectionShortcutConflictNotified: string | null = null;

function notifySelectionShortcutConflict(accelerator: string): void {
	selectionShortcutConflict = accelerator;
	if (selectionShortcutConflictNotified === accelerator) return;
	if (!mainWindow || mainWindow.isDestroyed()) return;
	emitAgentsNotice({
		message: `System selection shortcut ${accelerator} is unavailable`,
		i18nKey: "selectionTool.shortcutConflict",
		i18nParams: { accelerator },
		kind: "warning",
	});
	selectionShortcutConflictNotified = accelerator;
}

function clearSelectionShortcutConflict(): void {
	selectionShortcutConflict = null;
	selectionShortcutConflictNotified = null;
}

function flushSelectionShortcutConflictNotice(): void {
	if (selectionShortcutConflict) notifySelectionShortcutConflict(selectionShortcutConflict);
}

function syncSelectionToolShortcut(): void {
	const service = selectionToolService;
	if (!service) return;
	if (!SYSTEM_SELECTION_TOOL_ENABLED) {
		selectionClipboardWatcher?.setEnabled(false);
		windowsSelectionCapture?.setEnabled(false);
		service.unregisterShortcut();
		clearSelectionShortcutConflict();
		return;
	}
	const systemEnabled = agentProfileStore?.getSnapshot().settings.systemSelectionEnabled === true;

	selectionClipboardWatcher?.setEnabled(systemEnabled);

	windowsSelectionCapture?.setEnabled(systemEnabled);
	if (!systemEnabled) {
		service.unregisterShortcut();
		clearSelectionShortcutConflict();
		return;
	}
	const accelerator = resolveShortcutBindings(settingsStore.get().shortcuts ?? {}, process.platform).openSelectionTool;
	if (!accelerator) {
		service.unregisterShortcut();
		clearSelectionShortcutConflict();
		return;
	}
	if (service.getRegisteredShortcut() === accelerator) {
		clearSelectionShortcutConflict();
		return;
	}
	const registered = service.setShortcut(accelerator);
	if (!registered) {
		void appLogger.warn("selection-tool", "Global shortcut registration failed", { accelerator });
		notifySelectionShortcutConflict(accelerator);
		return;
	}
	clearSelectionShortcutConflict();
}

let cleanupPasteFiles: (() => Promise<number>) | undefined;

const quitCleanup = new QuitCleanupRegistry();

quitCleanup.register("feishu-bridge", () => {
	feishuBridgeRef.current?.stop();
	feishuBridgeRef.current = null;
});
quitCleanup.register("wechat-bridge", () => {
	void wechatServiceRef.current?.stop();
	wechatServiceRef.current = null;
});

const handleWindowZoomShortcut = createWindowZoomShortcutHandler({
	getWindow: () => mainWindow,
	getZoomFactor: () => settingsStore.get().zoomFactor,

	persistZoomFactor: (value) => {
		void settingsStore.update({ zoomFactor: value }).catch((error) => {
			void appLogger.warn("settings", "Failed to persist zoom factor", { error: error instanceof Error ? error.message : String(error) });
		});
	},

	notifyZoomFactor: (value) => {
		if (!mainWindow || mainWindow.isDestroyed()) return;
		mainWindow.webContents.send(ipcChannels.appZoomFactorChanged, value);
	},
});

function broadcastVisibleProjects(): void {
	const window = mainWindow;
	if (!window || window.isDestroyed()) return;
	const s = settingsStore.get();
	const visible = s.wslEnabled ? projectStore.list().filter((p) => p.kind === "chat" || p.environment === "wsl") : projectStore.list().filter((p) => p.kind === "chat" || !p.environment || p.environment === "windows");

	window.webContents.send(ipcChannels.projectsChanged, visible);

	refreshTrayContextMenu();
}

function emitSessionActivationFailed(sessionId: string): void {
	sendSessionRuntimeEnvelope({
		kind: "event",
		sessionId,
		agentId: "",
		runtimeGeneration: sessionRuntimeCoordinator.currentRuntimeGeneration(sessionId),
		sourceChannel: ipcChannels.agentsState,
		payload: { status: "error" },
	});
}

function sendSessionRuntimeEnvelope(event: SessionRuntimeEvent): void {
	const window = mainWindow;
	if (window && !window.isDestroyed()) {
		window.webContents.send(ipcChannels.sessionsRuntimeEvent, event);
	}

	miniOverlayWindow?.sendRuntimeEvent(event);
}

function emitAgentsNotice(payload: { message: string; i18nKey: string; i18nParams?: Record<string, string | number>; kind: "info" | "warning" | "error"; sessionId?: string }): void {
	const event: SessionRuntimeEvent = {
		kind: "event",
		sessionId: payload.sessionId ?? "",
		agentId: "system",
		runtimeGeneration: 0,
		sourceChannel: ipcChannels.agentsNotice,
		payload: {
			message: payload.message,
			i18nKey: payload.i18nKey,
			i18nParams: payload.i18nParams,
			kind: payload.kind,
		},
	};
	sendSessionRuntimeEnvelope(event);
}

const runtimeEventListeners = new Set<(event: SessionRuntimeEvent) => void>();

function emitSessionRuntimeEvent(agentId: string, sourceChannel: string, payload: unknown): boolean {
	const runtimeBinding = sessionRuntimeCoordinator.getRuntimeBinding(agentId);
	if (!runtimeBinding) return false;
	const event: SessionRuntimeEvent = {
		kind: "event",
		sessionId: runtimeBinding.sessionId,
		agentId,
		runtimeGeneration: runtimeBinding.runtimeGeneration,
		sourceChannel,
		payload,
	};
	for (const listener of runtimeEventListeners) {
		try {
			listener(event);
		} catch (error) {
			void appLogger.warn("session", "Runtime event listener failed", { agentId, sourceChannel, error: error instanceof Error ? error.message : String(error) });
		}
	}
	sessionRuntimeCoordinator.observeRuntimeEvent(event);
	automationRunCoordinator?.observeRuntimeEvent(event);
	if (payload && typeof payload === "object" && !Array.isArray(payload)) {
		const tab = payload as Partial<AgentTab>;
		if (typeof tab.sessionPath === "string" && tab.sessionPath) {
			const entry = sessionCatalog.get(runtimeBinding.sessionId);

			const sessionPathUnchanged = entry?.filePath !== undefined && canonicalizeSessionPath(entry.filePath, entry.environment) === canonicalizeSessionPath(tab.sessionPath, entry.environment);
			if (canAttachRuntimeMetadata(entry, tab) && (!sessionPathUnchanged || entry.piSessionId !== tab.sessionId)) {
				void sessionCatalog
					.attachRuntime({
						sessionId: runtimeBinding.sessionId,
						filePath: tab.sessionPath,
						piSessionId: tab.sessionId,
					})
					.catch(() => undefined);
			}
		}
	}
	sendSessionRuntimeEnvelope(event);
	const tab = payload && typeof payload === "object" && !Array.isArray(payload) ? (payload as Partial<AgentTab>) : undefined;

	if (tab?.noSession && tab.status === "closed") {
		sessionRuntimeCoordinator.unbindTerminalAgent(agentId);
		discardAnonymousSession({ ...runtimeBinding, agentId });
	}
	return true;
}

function emitSessionRuntimeDetach(binding: SessionRuntimeBinding): void {
	sendSessionRuntimeEnvelope({
		kind: "detach",
		sessionId: binding.sessionId,
		agentId: binding.agentId,
		runtimeGeneration: binding.runtimeGeneration,
		sourceChannel: "sessions:runtime-detach",
		payload: null,
	});
}

function discardAnonymousSession(binding: SessionRuntimeBinding): void {
	if (!sessionCatalog.get(binding.sessionId)?.noSession) return;
	sessionCatalog.removeTransient(binding.sessionId);
	emitSessionRuntimeDetach(binding);
}

function validationCatalogModels(): AvailableModel[] | undefined {
	return mergeCatalogModels(piModelCapabilityCache?.getSnapshot(), getCachedModelList());
}

async function createAnonymousSession(input: CreateAnonymousSessionInput): Promise<CreateAnonymousSessionResult> {
	const project = projectStore.get(input.projectId);
	if (!project) throw new Error(mainCopy("project.notFound"));

	let model: CreateAnonymousSessionInput["model"] = input.model ? createSessionModelPreference(input.model.provider, input.model.modelId, input.model.modelName) : undefined;
	let thinkingLevel = input.thinkingLevel;
	try {
		const [settingsResult, modelsResult] = await Promise.all([configManager.getSettingsConfig(), configManager.getModelsConfig()]);

		if (model && !isModelInModelsConfig(modelsResult.parsed, model, validationCatalogModels())) {
			model = undefined;
		}

		const defaults = resolveLaunchDefaultOptions({
			backend: "pi",
			settings: settingsResult.parsed,
			models: modelsResult.parsed,

			catalogModels: validationCatalogModels(),
			lastUsedModel: settingsStore.get().lastUsedModel,
		});
		if (!model) {
			model = defaults.model;
		}
		if (!thinkingLevel) {
			const perModelThinkingLevel = model && typeof model.provider === "string" && typeof model.modelId === "string" ? modelThinkingLevelOf(settingsResult.parsed, model.provider, model.modelId) : undefined;
			thinkingLevel = perModelThinkingLevel ?? defaults.thinkingLevel;
		}
	} catch {}

	const session = sessionCatalog.createAnonymous({
		projectId: project.id,
		title: input.title?.trim() || mainCopy("session.anonymousTitle", { project: project.name }),
		environment: settingsStore.get().wslEnabled ? "wsl" : "native",
		model,
		thinkingLevel,
	});

	const activation = activateAnonymousRuntime(session, project, input);
	sessionRuntimeCoordinator.registerPendingRuntime(session.id, activation);
	void activation.catch(() => undefined);
	return { session };
}

async function activateAnonymousRuntime(session: SessionRecord, project: Project, input: CreateAnonymousSessionInput): Promise<AgentTab> {
	let agentId: string | undefined;
	try {
		const tab = await agentManager.create({
			projectId: project.id,
			title: session.title,
			environment: session.environment,
			source: "pi",
			wslDistro: session.wslDistro,
			wslUser: session.wslUser,
			noSession: true,
		});
		agentId = tab.id;
		const runtime = sessionRuntimeCoordinator.bindAnonymousRuntime(session.id, tab.id);

		if (session.model) {
			const result = await sessionRuntimeCoordinator.setRuntimeModel(runtime, session.model.provider, session.model.modelId, session.model.modelName);
			if (!result.ok) throw new Error(result.error.code);
		}
		if (session.thinkingLevel) {
			const result = await sessionRuntimeCoordinator.setRuntimeThinking(runtime, session.thinkingLevel);
			if (!result.ok) throw new Error(result.error.code);
		}
		emitReplacementState(runtime, true);
		return tab;
	} catch (error) {
		if (agentId) await agentManager.stop(agentId).catch(() => undefined);
		sessionCatalog.removeTransient(session.id);

		void appLogger.error("agent", "Agent create IPC failed", {
			projectId: project.id,
			title: input.title,
			error: error instanceof Error ? error.message : String(error),
			stack: error instanceof Error ? error.stack : undefined,
			platform: process.platform,
			arch: process.arch,
		});
		throw error;
	}
}

async function stopSessionRuntime(target: SessionRuntimeTarget) {
	const anonymous = sessionCatalog.get(target.sessionId)?.noSession === true;
	const result = await sessionRuntimeCoordinator.stopRuntime(target);
	if (result.ok) {
		terminalManager.closeAgent(target.agentId);
		if (anonymous) discardAnonymousSession(target);
		else emitSessionRuntimeDetach(target);
	}
	return result;
}

async function stopAgentFromMonitor(agentId: string): Promise<SessionCommandResult<SessionRuntimeTarget | undefined>> {
	const result = await sessionRuntimeCoordinator.stopAgentById(agentId);
	if (!result.ok) return result;
	terminalManager.closeAgent(agentId);
	if (result.value) emitSessionRuntimeDetach(result.value);
	return result;
}

function findRuntimeTab(agentId: string): AgentTab | undefined {
	return compositeAgentGateway?.list().find((candidate) => candidate.id === agentId) ?? agentManager.list().find((candidate) => candidate.id === agentId);
}

function emitReplacementState(binding: SessionRuntimeBinding, includeMessages: boolean): void {
	const tab = findRuntimeTab(binding.agentId);
	if (!tab) return;
	emitSessionRuntimeEvent(binding.agentId, ipcChannels.agentsState, tab);
	if (includeMessages) {
		const messageWindow = compositeAgentGateway?.getMessageWindow(binding.agentId) ?? agentManager.getMessageWindow(binding.agentId);
		emitSessionRuntimeEvent(binding.agentId, ipcChannels.agentsMessage, {
			agentId: binding.agentId,
			...messageWindow,
		});
	}
}

function emitSessionActivating(sessionId: string): void {
	sendSessionRuntimeEnvelope({
		kind: "event",
		sessionId,
		agentId: "",
		runtimeGeneration: sessionRuntimeCoordinator.currentRuntimeGeneration(sessionId),
		sourceChannel: ipcChannels.agentsState,
		payload: { status: "starting" },
	});
}

async function readCatalogSessionReferenceMessages(sessionId: string) {
	const entry = sessionCatalog.get(sessionId);
	if (!entry?.filePath) return [];
	return sessionScanner.readMessages(entry.filePath);
}

async function copyCatalogSession(sessionId: string) {
	const entry = sessionCatalog.get(sessionId);
	if (!entry?.filePath) throw new Error(mainCopy("session.fileNotFound"));
	const result = (await agentManager.cloneSessionFile(entry.projectId, entry.filePath, entry.environment)) as {
		cancelled?: boolean;
		sessionPath?: string;
	};
	if (result.cancelled || !result.sessionPath) return { cancelled: true };

	let title = entry.title;
	const forkedTitle = appendSessionForkSuffix(title, mainCopy("session.forkedSuffix"));
	if (forkedTitle !== title) {
		try {
			await sessionScanner.rename(result.sessionPath, forkedTitle);
			title = forkedTitle;
		} catch (error) {
			void appLogger.warn("session", "Copy session suffix rename failed", {
				sessionId,
				sessionPath: result.sessionPath,
				error: error instanceof Error ? error.message : String(error),
			});
			emitAgentsNotice({
				message: mainCopy("notice.sessionSuffixRenameFailed"),
				i18nKey: "notice.sessionSuffixRenameFailed",
				i18nParams: { mode: mainCopy("session.forkedSuffix") },
				kind: "warning",
			});
		}
	}
	const copied = await sessionCatalog.ensureRuntimeTarget({
		projectId: entry.projectId,
		title,
		source: entry.source,
		environment: entry.environment,
		filePath: result.sessionPath,
		wslDistro: entry.wslDistro,
		wslUser: entry.wslUser,
		importedSourceId: entry.importedSourceId,

		forked: true,

		titleAuthority: "command",

		model: entry.model,
		thinkingLevel: entry.thinkingLevel,
	});
	return { cancelled: false, targetSessionId: copied.id };
}

function resolveImageGenStorageRoots(): { sessions: string; blobs: string } {
	const root = join(app.getPath("userData"), "imagegen");
	return { sessions: join(root, "sessions"), blobs: join(root, "blobs") };
}

function resolveVideoGenStorageRoots(): { sessions: string; blobs: string; jobs: string } {
	const root = join(app.getPath("userData"), "videogen");
	return { sessions: join(root, "sessions"), blobs: join(root, "blobs"), jobs: join(root, "jobs.json") };
}

async function exportCatalogSessionHtml(sessionId: string): Promise<{ path: string }> {
	const entry = sessionCatalog.get(sessionId);
	if (!entry?.filePath) throw new Error(mainCopy("session.fileNotFound"));
	const result = await agentManager.exportSessionHtml(entry.projectId, entry.filePath);
	if (!result || typeof result !== "object" || !("path" in result) || typeof result.path !== "string") {
		throw new Error(mainCopy("session.exportFailed"));
	}

	const rawPath = result.path;
	const projectRoot = projectStore.get(entry.projectId)?.path ?? "";
	const absolutePath = isAbsolute(rawPath) ? rawPath : join(projectRoot, rawPath);
	if (existsSync(absolutePath)) return { path: absolutePath };

	const loadWindow = await agentManager.readSessionLoadWindow(entry.filePath, sessionId, { projectId: entry.projectId });
	const html = renderSessionHtmlForExport(loadWindow.messages, { title: entry.title, cwd: projectRoot, exportedAt: Date.now() });
	const exportDir = join(app.getPath("userData"), "exports");
	await mkdir(exportDir, { recursive: true });
	const outPath = join(exportDir, sanitizeExportFileName(entry.title || sessionId, sessionId));
	await writeFile(outPath, html, "utf8");
	return { path: outPath };
}

type AgentSessionReplacementResult = {
	cancelled?: boolean;
	[key: string]: unknown;
};

async function replaceAgentSession(agentId: string, replace: () => Promise<unknown>, options?: { markForked?: boolean; markSuperseded?: boolean }): Promise<AgentSessionReplacementResult & { targetSessionId?: string }> {
	const originBinding = sessionRuntimeCoordinator.getRuntimeBinding(agentId);
	const originEntry = originBinding ? sessionCatalog.get(originBinding.sessionId) : undefined;
	const originKey = originEntry?.filePath
		? buildSessionOriginKey({
				source: originEntry.source,
				environment: originEntry.environment,
				filePath: originEntry.filePath,
				wslDistro: originEntry.wslDistro,
				wslUser: originEntry.wslUser,
				importedSourceId: originEntry.importedSourceId,
			})
		: undefined;
	return sessionRuntimeCoordinator.replaceBoundRuntime({
		agentId,
		replace: async () => {
			const result = await replace();
			return result && typeof result === "object" && !Array.isArray(result) ? (result as AgentSessionReplacementResult) : {};
		},
		resolveTargetSessionId: async () => {
			const tab = agentManager.list().find((candidate) => candidate.id === agentId);
			if (!tab?.sessionPath) {
				throw new Error(`Replacement runtime has no session path: ${agentId}`);
			}
			const environment = tab.sessionEnvironment ?? originEntry?.environment ?? "native";

			let title = tab.title;
			if (options?.markForked) {
				const forkedTitle = appendSessionForkSuffix(title, mainCopy("session.forkedSuffix"));
				if (forkedTitle !== title) {
					try {
						await agentManager.rename(agentId, forkedTitle);
						title = forkedTitle;
					} catch (error) {
						void appLogger.warn("session", "Fork session suffix rename failed", {
							agentId,
							title,
							error: error instanceof Error ? error.message : String(error),
						});
						emitAgentsNotice({
							message: mainCopy("notice.sessionSuffixRenameFailed"),
							i18nKey: "notice.sessionSuffixRenameFailed",
							i18nParams: { mode: mainCopy("session.forkedSuffix") },
							kind: "warning",
						});
					}
				}
			}
			const target = await sessionCatalog.ensureRuntimeTarget({
				projectId: tab.projectId,
				title,
				source: tab.sessionSource ?? originEntry?.source ?? "pi",
				environment,
				filePath: tab.sessionPath,
				wslDistro: tab.wslDistro ?? (environment === "wsl" ? originEntry?.wslDistro : undefined),
				wslUser: tab.wslUser ?? (environment === "wsl" ? originEntry?.wslUser : undefined),
				importedSourceId: tab.importedSourceId ?? originEntry?.importedSourceId,
				piSessionId: tab.sessionId,

				forked: options?.markForked,

				titleAuthority: "command",

				model: originEntry?.model,
				thinkingLevel: originEntry?.thinkingLevel,
			});

			if (options?.markSuperseded && originEntry && originEntry.id !== target.id) {
				await sessionCatalog.markSuperseded(originEntry.id, target.id);
			}
			return target.id;
		},
		canRestoreOrigin: () => {
			const tab = agentManager.list().find((candidate) => candidate.id === agentId);
			if (!originKey || !tab?.sessionPath) return false;
			return (
				buildSessionOriginKey({
					source: tab.sessionSource ?? "pi",
					environment: tab.sessionEnvironment ?? "native",
					filePath: tab.sessionPath,
					wslDistro: tab.wslDistro,
					wslUser: tab.wslUser,
					importedSourceId: tab.importedSourceId,
				}) === originKey
			);
		},
		onDetached: emitSessionRuntimeDetach,
		onAttached: (binding) => emitReplacementState(binding, true),
		onRestored: (binding) => emitReplacementState(binding, false),
	});
}

function notifySessionCatalogRefreshed(projectIds: Iterable<string>): void {
	const window = mainWindow;
	if (!window || window.isDestroyed()) return;
	for (const projectId of new Set(projectIds)) {
		window.webContents.send(ipcChannels.sessionsCatalogRefreshed, { projectId });
	}
}

const notifyForkCatalogRefreshed = (sessionId: string): void => {
	const projectId = sessionCatalog.get(sessionId)?.projectId;
	if (!projectId) return;
	const window = mainWindow;
	if (window && !window.isDestroyed()) {
		window.webContents.send(ipcChannels.sessionsCatalogRefreshed, { projectId });
	}
};

let sessionForkCommandsInstance: ReturnType<typeof createSessionForkCommands> | undefined;
const getSessionForkCommands = () => {
	if (!sessionForkCommandsInstance) {
		sessionForkCommandsInstance = createSessionForkCommands({
			sessionRuntimeCoordinator,
			agentManager,
			replaceAgentSession,
			logger: appLogger,
			notifyForkCatalogRefreshed,
		});
	}
	return sessionForkCommandsInstance;
};

const sessionForkCommands = {
	forkRuntimeSession: (target: Parameters<ReturnType<typeof createSessionForkCommands>["forkRuntimeSession"]>[0], entryId: string, options?: { mutationFork?: boolean; branchMode?: boolean }) => getSessionForkCommands().forkRuntimeSession(target, entryId, options),
	cloneRuntimeSession: (target: Parameters<ReturnType<typeof createSessionForkCommands>["cloneRuntimeSession"]>[0]) => getSessionForkCommands().cloneRuntimeSession(target),
};

function cancelUnboundUiRequest(payload: unknown): void {
	if (!payload || typeof payload !== "object" || Array.isArray(payload)) return;
	const request = payload as Partial<AgentUiRequest>;
	if (typeof request.agentId !== "string" || typeof request.requestId !== "string" || request.completed === true || !(["select", "confirm", "input", "editor", "batch_ask"] as const).some((method) => method === request.method)) {
		return;
	}
	void appLogger.warn("session", "Cancelled unbound runtime UI request", {
		agentId: request.agentId,
		requestId: request.requestId,
		method: request.method,
	});
	void agentManager.sendUIResponse(request.agentId, request.requestId, { cancelled: true });
}

const imSessionRuntimeBindings: SessionRuntimeBindingGateway = {
	async ensureSession(input) {
		if (input.existingSessionId) {
			const existing = sessionCatalog.get(input.existingSessionId);
			if (existing) return { sessionId: existing.id };
		}
		const environment = settingsStore.get().wslEnabled ? "wsl" : "native";
		if (input.sessionPath) {
			const existing = sessionCatalog.findByFilePath(input.sessionPath, environment);
			if (existing) return { sessionId: existing.id };
			const restored = await sessionCatalog.ensureRuntimeTarget({
				projectId: input.projectId,
				title: input.title,
				source: "pi",
				environment,
				filePath: input.sessionPath,

				channel: input.channel,
				wslDistro: environment === "wsl" ? settingsStore.get().wslDistro : undefined,
				wslUser: environment === "wsl" ? settingsStore.get().wslUser : undefined,
			});
			return { sessionId: restored.id };
		}
		const draft = await sessionCatalog.createDraft({
			projectId: input.projectId,
			title: input.title,
			environment,

			backend: input.backend,
			source: "pi",
			channel: input.channel,

			...(input.autoTitle ? {} : { titleOrigin: "manual" as const }),
		});
		return { sessionId: draft.id };
	},
	async activateRuntime(sessionId) {
		const activated = await sessionRuntimeCoordinator.activateRuntime(sessionId);
		if (!activated.ok) throw sessionCommandIpcError(activated.error);
		const tab = findRuntimeTab(activated.value.agentId);
		if (!tab)
			throw sessionCommandIpcError({
				code: "SESSION_COMMAND_FAILED",
				debugDetails: `Activated runtime not found: ${activated.value.agentId}`,
			});
		tab.runtimeGeneration = activated.value.runtimeGeneration;
		emitSessionRuntimeEvent(tab.id, ipcChannels.agentsState, tab);
		return tab;
	},
	async bindRuntime(input) {
		if (input.agent.status === "error" || input.agent.status === "closed") {
			throw new Error(`Cannot bind terminal Feishu runtime: ${input.agent.id}`);
		}
		const environment = input.agent.sessionEnvironment ?? (settingsStore.get().wslEnabled ? "wsl" : "native");
		const source = input.agent.sessionSource ?? "pi";
		let sessionId: string | undefined;
		if (input.existingSessionId) {
			const existing = sessionCatalog.get(input.existingSessionId);
			if (existing) {
				const currentBinding = sessionRuntimeCoordinator.getRuntimeBinding(input.agent.id);
				if (currentBinding && currentBinding.sessionId !== existing.id) {
					throw new Error(`Runtime is already bound to a different Session: ${currentBinding.sessionId}`);
				}
				if (input.agent.sessionPath && !canAttachRuntimeMetadata(existing, input.agent)) {
					throw new Error(`Existing Session origin does not match runtime: ${existing.id}`);
				}
				sessionId = existing.id;
			}
		}
		if (!sessionId && input.agent.sessionPath) {
			const targetOrigin = buildSessionOriginKey({
				source,
				environment,
				filePath: input.agent.sessionPath,
				wslDistro: input.agent.wslDistro,
				wslUser: input.agent.wslUser,
				importedSourceId: input.agent.importedSourceId,
			});
			sessionId = sessionCatalog.listEntries().find(
				(candidate) =>
					candidate.filePath &&
					buildSessionOriginKey({
						source: candidate.source,
						environment: candidate.environment,
						filePath: candidate.filePath,
						wslDistro: candidate.wslDistro,
						wslUser: candidate.wslUser,
						importedSourceId: candidate.importedSourceId,
					}) === targetOrigin,
			)?.id;
		}
		if (!sessionId) {
			const draft = await sessionCatalog.createDraft({
				projectId: input.projectId,
				title: input.agent.title || "Feishu session",
				environment,
				source,
				titleOrigin: "manual",
			});
			sessionId = draft.id;
		}
		await sessionCatalog.attachRuntime(
			input.agent.sessionPath
				? {
						sessionId,
						filePath: input.agent.sessionPath,
						piSessionId: input.agent.sessionId,
					}
				: {
						sessionId,
						piSessionId: input.agent.sessionId,
					},
		);
		const runtimeGeneration = sessionRuntimeCoordinator.bindExistingAgent(sessionId, input.agent.id);
		input.agent.runtimeGeneration = runtimeGeneration;
		emitSessionRuntimeEvent(input.agent.id, ipcChannels.agentsState, input.agent);
		return { sessionId };
	},
	async sendPrompt(input) {
		const result = await sessionRuntimeCoordinator.send({
			...input,
			requestId: randomUUID(),
		});
		if (!result.accepted) throw new Error(result.error);
	},
	async abortRuntime(sessionId) {
		const target = sessionRuntimeCoordinator.getTarget(sessionId);
		if (!target) throw sessionCommandIpcError({ code: "SESSION_RUNTIME_UNAVAILABLE" });
		const result = await sessionRuntimeCoordinator.abortRuntime(target);
		if (!result.ok) throw sessionCommandIpcError(result.error);
	},
	findRuntimeAgent(agentId) {
		return findRuntimeTab(agentId);
	},
	getRuntimeMessages(sessionId) {
		return sessionRuntimeCoordinator.getRuntimeMessages(sessionId)?.value ?? [];
	},
	waitForRunEnd(input) {
		return waitForSessionRunEnd(
			{
				subscribe: (listener) => {
					runtimeEventListeners.add(listener);
					return () => {
						runtimeEventListeners.delete(listener);
					};
				},
				getMessages: (id) => sessionRuntimeCoordinator.getRuntimeMessages(id)?.value ?? [],
			},
			input,
		);
	},
	async listRuntimeModels(sessionId) {
		const target = sessionRuntimeCoordinator.getTarget(sessionId);
		if (!target) throw sessionCommandIpcError({ code: "SESSION_RUNTIME_UNAVAILABLE" });
		const result = await sessionRuntimeCoordinator.listRuntimeModels(target);
		if (!result.ok) throw sessionCommandIpcError(result.error);
		return result.value.value;
	},
	async getRuntimeState(sessionId) {
		const target = sessionRuntimeCoordinator.getTarget(sessionId);
		if (!target) return undefined;
		const result = await sessionRuntimeCoordinator.getRuntimeState(target);
		if (!result.ok) throw sessionCommandIpcError(result.error);
		return result.value.value;
	},
	async setRuntimeModel(sessionId, provider, modelId) {
		const target = sessionRuntimeCoordinator.getTarget(sessionId);
		if (!target) throw sessionCommandIpcError({ code: "SESSION_RUNTIME_UNAVAILABLE" });
		const result = await sessionRuntimeCoordinator.setRuntimeModel(target, provider, modelId);
		if (!result.ok) throw sessionCommandIpcError(result.error);
	},
	async setRuntimeThinking(sessionId, level) {
		const target = sessionRuntimeCoordinator.getTarget(sessionId);
		if (!target) throw sessionCommandIpcError({ code: "SESSION_RUNTIME_UNAVAILABLE" });
		const result = await sessionRuntimeCoordinator.setRuntimeThinking(target, level);
		if (!result.ok) throw sessionCommandIpcError(result.error);
	},

	sendUIResponse(agentId, requestId, response) {
		agentManager.sendUIResponse(agentId, requestId, response);
	},
};

let themeScheduleTimer: ReturnType<typeof setTimeout> | undefined;

function clearThemeScheduleTimer(): void {
	if (themeScheduleTimer !== undefined) {
		clearTimeout(themeScheduleTimer);
		themeScheduleTimer = undefined;
	}
}

function applyNativeThemeSource(settings: AppSettings) {
	nativeTheme.themeSource =
		settings.theme === "system"
			? "system"
			: resolveAppColorScheme({
					theme: settings.theme,
					themeScheduleLightStart: settings.themeScheduleLightStart,
					themeScheduleDarkStart: settings.themeScheduleDarkStart,
					systemPrefersDark: nativeTheme.shouldUseDarkColors,
				});
	clearThemeScheduleTimer();

	if (settings.theme === "schedule") {
		const delay = msUntilNextThemeBoundary(new Date(), settings.themeScheduleLightStart, settings.themeScheduleDarkStart);
		themeScheduleTimer = setTimeout(() => {
			applyNativeThemeSource(settingsStore.get());
		}, delay);
	}
}

const POSTHOG_PROJECT_KEY = process.env.POSTHOG_PROJECT_KEY ?? "phc_xgJ8gFUMgExZEEPzZ7VRa7698ENcaDRquWZVGYb2dCFK";
const POSTHOG_HOST = process.env.POSTHOG_HOST ?? "https://us.i.posthog.com";

function relaunchAppOnly(): void {
	app.relaunch(desktopRelaunchOptions(process.env, process.argv));
}

function restartApp(): void {
	isQuitting = true;
	void webServiceManager?.stop();
	terminalManager?.closeAll();
	void agentManager?.stopAll();
	relaunchAppOnly();
	app.quit();
}

function refreshTrayContextMenu(): void {
	if (!tray) return;

	const recentProjects = projectStore
		.list()
		.filter((p) => p.kind !== "chat")
		.slice(0, TRAY_RECENT_PROJECTS_LIMIT)
		.map((p) => ({ id: p.id, name: p.name, path: p.path }));
	tray.setContextMenu(
		Menu.buildFromTemplate(
			buildTrayMenuTemplate(mainCopy, app.getVersion(), recentProjects, {
				showWindow: focusMainWindow,
				checkUpdate: checkForUpdatesFromTray,
				openProject: (projectId) => {
					queueFocusTarget({ projectId });
					focusMainWindow();
				},
				openDataDir: () => {
					void openSystemPath(app.getPath("userData"));
				},
				openLogsDir: () => {
					void openSystemPath(join(app.getPath("userData"), "logs"));
				},
				restart: restartApp,
				quit: () => {
					isQuitting = true;
					app.quit();
				},
				toggleFloatingBall: (visible) => {
					if (visible) {
						void floatingController?.show();
					} else {
						floatingController?.hide();
					}
				},
				exitFloatingBall: () => {
					void floatingController?.exit();
				},
				isFloatingBallActive: () => floatingController?.isActive() ?? false,
			}),
		),
	);
}

function checkForUpdatesFromTray(): void {
	void (async () => {
		try {
			if (updateService) {
				await updateService.checkNow();
				const snapshot = updateService.getSnapshot();
				const latest = snapshot.app?.latestVersion;
				if (snapshot.app?.hasUpdate && latest) {
					notifyFromTray(mainCopy("tray.updateAvailableTitle"), mainCopy("tray.updateAvailableBody", { version: latest }));
					return;
				}
			}
			notifyFromTray(mainCopy("tray.upToDateTitle"), mainCopy("tray.upToDateBody", { version: app.getVersion() }));
		} catch (error) {
			void appLogger?.warn("update", "Tray update check failed", { error: error instanceof Error ? error.message : String(error) });
			notifyFromTray(mainCopy("update.checkFailed"), "");
		}
	})();
}

function notifyFromTray(title: string, body: string): void {
	const notification = new Notification({ title, body, silent: false });
	notification.on("click", () => focusMainWindow());
	notification.show();
}

function focusMainWindow() {
	if (!mainWindow || mainWindow.isDestroyed()) return;
	if (mainWindow.isMinimized()) mainWindow.restore();
	if (typeof mainWindow.setSkipTaskbar === "function") {
		mainWindow.setSkipTaskbar(false);
	}
	mainWindow.show();
	mainWindow.focus();

	if (settingsStore.get().floatingBallAlwaysOnTop === false) miniOverlayWindow?.hide();
	if (process.platform === "win32") {
		const wasAlwaysOnTop = mainWindow.isAlwaysOnTop();
		if (!wasAlwaysOnTop) {
			mainWindow.setAlwaysOnTop(true);
			mainWindow.setAlwaysOnTop(false);
		}
	}
}

let projectStoreReady: Promise<unknown> | null = null;

let pendingFocusTarget: { sessionId: string } | { projectId: string } | { projectPath: string } | null = null;

function queueFocusTarget(target: { sessionId: string } | { projectId: string } | { projectPath: string }) {
	if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isLoading()) {
		mainWindow.webContents.send(ipcChannels.petFocusAgentTarget, target);
		return;
	}
	pendingFocusTarget = target;
}

function flushPendingFocusTargetOnLoad() {
	if (pendingFocusTarget && mainWindow && !mainWindow.isDestroyed()) {
		mainWindow.webContents.send(ipcChannels.petFocusAgentTarget, pendingFocusTarget);
	}
}

function handleVersionFocusRequest(payload?: FocusPayload) {
	const target = extractFocusTargetFromArgv(payload?.argv);
	const activateSession = async () => {
		if (!target) return;
		if (await quickTaskChrome.applyLaunchTarget(target)) return;

		if (target.projectPath) {
			if (projectStoreReady) await projectStoreReady;
			const existing = projectStore?.findByPath(target.projectPath);
			if (existing) {
				queueFocusTarget({ projectId: existing.id });
			} else {
				queueFocusTarget({ projectPath: target.projectPath });
			}
			return;
		}
		let sessionId = target.sessionId;
		if (!sessionId && target.agentId && sessionRuntimeCoordinator) {
			sessionId = sessionRuntimeCoordinator.getSessionId(target.agentId);
		}
		if (sessionId) queueFocusTarget({ sessionId });
	};
	if (mainWindow && !mainWindow.isDestroyed()) {
		focusMainWindow();
		void activateSession();
		return;
	}
	void app.whenReady().then(() => {
		if (mainWindow && !mainWindow.isDestroyed()) {
			focusMainWindow();
			void activateSession();
			return;
		}
		if (settingsStore) {
			void createWindow()
				.then(() => {
					void activateSession();
				})
				.catch((error) => {
					void appLogger?.error("app", "Failed to recreate window on version focus request", error);
				});
		}
	});
}

focusExistingWindow = handleVersionFocusRequest;

function setupTray() {
	const trayLogoSettings = settingsStore.get();
	const icon = resolveLogoImage(trayLogoSettings.logoStyle, trayLogoSettings.logoCustomImage)?.image ?? nativeImage.createFromPath(iconPath);

	const createTrayInstance = (): Tray => {
		const instance = new Tray(icon.resize({ width: 16, height: 16 }));
		instance.setToolTip("APIX");

		instance.on("double-click", () => {
			if (mainWindow && !mainWindow.isDestroyed()) {
				mainWindow.show();
				mainWindow.focus();
			}
		});
		return instance;
	};

	tray = createTrayInstance();
	refreshTrayContextMenu();

	const stopTrayProjectListener = projectStore.onChanged(() => refreshTrayContextMenu());

	quitCleanup.register("tray", () => {
		stopTrayProjectListener();
		trayRegistrationVerify?.stop();
		trayRegistrationVerify = null;
		tray?.destroy();
		tray = null;
	});

	if (process.platform === "linux") {
		trayRegistrationVerify = startTrayRegistrationVerify({
			onUnregistered: (detail) => {
				void appLogger?.warn("app", "tray verify: unregistered (likely appindicator extension < v66), see docs/linux-tray-icon.md", detail);
			},
			onLog: (message, detail) => void appLogger?.info("app", message, detail),
		});
	}
}

async function openExternalUrl(url: string, forceSystem = false) {
	if (!url.startsWith("http:") && !url.startsWith("https:")) return;

	if (forceSystem) {
		await shell.openExternal(url);
		return;
	}
	const settings = settingsStore.get();
	if (settings.linkOpenMode === "internal") {
		openInternalLinkInBrowserPanel(url);
		return;
	}
	await shell.openExternal(url);
}

function openInternalLinkInBrowserPanel(url: string) {
	if (!mainWindow || mainWindow.isDestroyed()) {
		void shell.openExternal(url);
		return;
	}
	mainWindow.webContents.send(ipcChannels.appOpenInBrowser, url);
}

function printStartupInfo() {
	if (!mainWindow || mainWindow.isDestroyed()) return;

	const settings = settingsStore.get();
	const appVersion = app.getVersion();
	const electronVersion = process.versions.electron;
	const chromeVersion = process.versions.chrome;
	const nodeVersion = process.versions.node;
	const platform = process.platform;
	const arch = process.arch;
	const persistentInstallationType = settings.installationType || "unknown";
	const isPortableEnv = process.env.PORTABLE_EXECUTABLE_DIR !== undefined;

	const effectiveInstallationType = process.platform === "win32" && isPortableEnv ? "portable" : persistentInstallationType;

	mainWindow.webContents.executeJavaScript(`
		console.log(
			"%c╭──────────────────────────────────────────────────────────╮",
			"color: #8b5cf6; font-weight: bold;"
		);
		console.log(
			"%c│                       APIX Desktop                       │",
			"color: #8b5cf6; font-weight: bold; font-size: 16px;"
		);
		console.log(
			"%c╰──────────────────────────────────────────────────────────╯",
			"color: #8b5cf6; font-weight: bold;"
		);
		console.log("");
		console.log("%c📦 Application Info", "color: #3b82f6; font-weight: bold; font-size: 14px;");
		console.log("%c  Version:         %c${appVersion}", "color: #6b7280;", "color: #10b981; font-weight: bold;");
		console.log("%c  Installation:    %c${effectiveInstallationType}", "color: #6b7280;", "color: #f59e0b; font-weight: bold;");
		console.log("%c  Platform:        %c${platform} (${arch})", "color: #6b7280;", "color: #8b5cf6;");
		console.log("");
		console.log("%c⚡ Runtime Info", "color: #3b82f6; font-weight: bold; font-size: 14px;");
		console.log("%c  Electron:        %c${electronVersion}", "color: #6b7280;", "color: #06b6d4;");
		console.log("%c  Chrome:          %c${chromeVersion}", "color: #6b7280;", "color: #06b6d4;");
		console.log("%c  Node:            %c${nodeVersion}", "color: #6b7280;", "color: #06b6d4;");
		console.log("");
		console.log("%c🔧 Debug Info", "color: #3b82f6; font-weight: bold; font-size: 14px;");
		console.log("%c  PORTABLE_EXECUTABLE_DIR: %c${isPortableEnv ? "✅ Set" : "❌ Not set"}", "color: #6b7280;", "color: ${isPortableEnv ? "#10b981" : "#ef4444"};");
		console.log("%c  Persistent installationType: %c${persistentInstallationType}", "color: #6b7280;", "color: #8b5cf6; font-weight: bold;");
		console.log("");
		console.log("%c🐛 Found a bug? Report at:", "color: #6b7280;");
		console.log("%c  https://github.com/ayuayue/PiDeck/issues", "color: #3b82f6; text-decoration: underline;");
		console.log("");
		console.log("%c🎉 Easter egg: You found it! Thanks for exploring.", "color: #ec4899; font-weight: bold;");
		console.log("");
	`);
}

async function prepareMainPreloadPath() {
	const sourcePath = join(__dirname, "../preload/index.js");
	return preparePreloadPath(sourcePath, "main-preload.js");
}

const BROWSER_PANEL_PARTITION = BROWSER_PANEL_PARTITION_SHARED;

function isAllowedBrowserPanelUrl(targetUrl: string): boolean {
	return isAllowedBrowserPanelUrlShared(targetUrl);
}

let browserPanelRequestInstalled = false;

function configureBrowserPanelWebviewHost(window: BrowserWindow): void {
	const browserPanelSession = session.fromPartition(BROWSER_PANEL_PARTITION);
	browserPanelSession.setPermissionCheckHandler(() => false);
	browserPanelSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
	browserPanelSession.setDevicePermissionHandler(() => false);
	if (!browserPanelRequestInstalled) {
		browserPanelRequestInstalled = true;
		browserPanelSession.webRequest.onBeforeRequest((details, callback) => {
			const isFrameNavigation = details.resourceType === "mainFrame" || details.resourceType === "subFrame";
			if (isFrameNavigation && !isAllowedBrowserPanelUrl(details.url)) {
				void appLogger.warn("browser", "Blocked unsafe webview frame request", {
					resourceType: details.resourceType,
					url: details.url,
				});
				callback({ cancel: true });
				return;
			}
			callback({});
		});
	}

	window.webContents.on("will-attach-webview", (event, webPreferences, params) => {
		const hostPluginId = hostPluginPartitionId(params.partition ?? "");
		if (hostPluginId) {
			const bridge = hostPluginWebviewBridge();
			if (!bridge || !bridge.hasLive(hostPluginId) || (params.src !== `${HOST_PLUGIN_SCHEME}://${hostPluginId}/` && !params.src?.startsWith(`${HOST_PLUGIN_SCHEME}://${hostPluginId}/`))) {
				event.preventDefault();
				void appLogger.warn("host-plugins", "Blocked host-plugin webview attachment", { instanceId: hostPluginId });
				return;
			}
			webPreferences.partition = params.partition;
			webPreferences.sandbox = true;
			webPreferences.additionalArguments = rendererHeapAdditionalArguments();
			webPreferences.nodeIntegration = false;
			webPreferences.nodeIntegrationInWorker = false;
			webPreferences.nodeIntegrationInSubFrames = false;
			webPreferences.contextIsolation = true;
			webPreferences.webSecurity = true;
			webPreferences.allowRunningInsecureContent = false;
			webPreferences.webviewTag = false;
			delete webPreferences.preload;
			delete (webPreferences as Record<string, unknown>).preloadURL;
			const pluginPreload = bridge.preloadPath();
			if (pluginPreload) webPreferences.preload = pluginPreload;
			delete params.preload;
			delete params.preloadURL;
			delete params.allowfileaccess;
			delete params.allowpopups;
			return;
		}
		const sourceUrl = params.src || "about:blank";
		if ((params.partition && params.partition !== BROWSER_PANEL_PARTITION) || !isAllowedBrowserPanelUrl(sourceUrl)) {
			event.preventDefault();
			void appLogger.warn("browser", "Blocked unsafe webview attachment", {
				sourceUrl,
				partition: params.partition,
			});
			return;
		}

		params.src = sourceUrl;
		params.partition = BROWSER_PANEL_PARTITION;
		delete params.preload;
		delete params.preloadURL;
		delete params.allowfileaccess;
		delete params.allowpopups;

		webPreferences.partition = BROWSER_PANEL_PARTITION;
		webPreferences.sandbox = true;

		webPreferences.additionalArguments = rendererHeapAdditionalArguments();
		webPreferences.nodeIntegration = false;
		webPreferences.nodeIntegrationInWorker = false;
		webPreferences.nodeIntegrationInSubFrames = false;
		webPreferences.contextIsolation = true;
		webPreferences.webSecurity = true;
		webPreferences.allowRunningInsecureContent = false;
		webPreferences.webviewTag = false;
		delete webPreferences.preload;
		delete (webPreferences as Record<string, unknown>).preloadURL;
	});

	window.webContents.on("did-attach-webview", (_event, guest) => {
		const pluginBridge = hostPluginWebviewBridge();
		if (pluginBridge) {
			const hostPluginId = pluginBridge.instanceForGuest(guest);
			if (hostPluginId) {
				pluginBridge.attachGuest(hostPluginId, guest);
				return;
			}
		}
		if (guest.session !== browserPanelSession) {
			void appLogger.warn("browser", "Closed webview with unexpected session");
			guest.close();
			return;
		}

		browserAgentService?.attachGuest(guest);

		const blockUnsafeNavigation = (event: { url: string; preventDefault(): void }, phase: string) => {
			if (isAllowedBrowserPanelUrl(event.url)) return;
			event.preventDefault();
			void appLogger.warn("browser", "Blocked unsafe webview navigation", {
				phase,
				url: event.url,
			});
		};

		guest.on("will-frame-navigate", (event) => blockUnsafeNavigation(event, "navigate"));
		guest.on("will-redirect", (event) => blockUnsafeNavigation(event, "redirect"));
		guest.setWindowOpenHandler(({ url }) => {
			if (url !== "about:blank" && isAllowedBrowserPanelUrl(url)) {
				void openExternalUrl(url);
			} else if (!isAllowedBrowserPanelUrl(url)) {
				void appLogger.warn("browser", "Blocked unsafe webview window open", { url });
			}
			return { action: "deny" };
		});

		guest.on("before-input-event", (event, input) => {
			if (isShortcutInput("openSettings", input)) {
				event.preventDefault();
				if (!window || window.isDestroyed()) return;
				if (!window.isVisible()) window.show();
				window.webContents.send(ipcChannels.appOpenSettings);
				return;
			}

			if (handleWindowZoomShortcut(input)) {
				event.preventDefault();
				return;
			}

			if (isShortcutInput("cycleSessionTabs", input)) {
				event.preventDefault();
				if (!window || window.isDestroyed()) return;
				window.webContents.send(ipcChannels.appShortcutTriggered, "cycleSessionTabs");
				return;
			}
			if (isShortcutInput("cycleSessionTabsReverse", input)) {
				event.preventDefault();
				if (!window || window.isDestroyed()) return;
				window.webContents.send(ipcChannels.appShortcutTriggered, "cycleSessionTabsReverse");
				return;
			}

			if (isShortcutInput("closeSessionTab", input)) {
				event.preventDefault();
				if (!window || window.isDestroyed()) return;
				window.webContents.send(ipcChannels.appShortcutTriggered, "closeSessionTab");
				return;
			}
			if (!isShortcutInput("toggleDevTools", input)) return;
			event.preventDefault();
			toggleMainWindowDevTools(window);
		});
	});
}

async function createWindow() {
	applyNativeThemeSource(settingsStore.get());
	const windowOptions = settingsStore.createWindowOptions();

	const initialWindowLogo = resolveLogoImage(settingsStore.get().logoStyle, settingsStore.get().logoCustomImage);
	const showMainWindowImmediately = shouldShowMainWindowImmediately();
	const sourcePreloadPath = join(__dirname, "../preload/index.js");
	const mainPreloadPath = await prepareMainPreloadPath();
	void appLogger.info("app", "Main window preload configured", {
		sourcePreloadPath,
		preloadPath: mainPreloadPath,
		sourceExists: existsSync(sourcePreloadPath),
		exists: existsSync(mainPreloadPath),
		appPath: app.getAppPath(),
		userDataPath: app.getPath("userData"),
		packaged: app.isPackaged,
		isDev: is.dev,
		electronRendererUrl: process.env.ELECTRON_RENDERER_URL ? "set" : "unset",
	});

	const windowThemeSettings = settingsStore.get();
	const isDark =
		resolveAppColorScheme({
			theme: windowThemeSettings.theme,
			themeScheduleLightStart: windowThemeSettings.themeScheduleLightStart,
			themeScheduleDarkStart: windowThemeSettings.themeScheduleDarkStart,
			systemPrefersDark: nativeTheme.shouldUseDarkColors,
		}) === "dark";
	const backgroundColor = isDark ? "#121212" : "#f8f8f5";

	const requestedMode = settingsStore.get().startupWindowMode ?? "last";
	let effectiveStartupMode = requestedMode;
	let startupBounds: LastWindowBounds;
	if (requestedMode === "last") {
		const last = readLastWindowBounds(app.getPath("userData"));
		if (last) {
			startupBounds = last;
			if (last.maximized) effectiveStartupMode = "maximized";
		} else {
			effectiveStartupMode = "maximized";
			startupBounds = resolveStartupWindowBounds("maximized");
		}
	} else {
		startupBounds = resolveStartupWindowBounds(requestedMode);
	}

	const targetDisplay = typeof startupBounds.x === "number" && typeof startupBounds.y === "number" ? screen.getDisplayMatching({ x: startupBounds.x, y: startupBounds.y, width: startupBounds.width, height: startupBounds.height }) : screen.getPrimaryDisplay();
	const startupWindowBounds = constrainWindowBoundsToWorkArea(startupBounds, targetDisplay.workArea);

	mainWindow = new BrowserWindow({
		show: showMainWindowImmediately,
		backgroundColor,
		x: startupWindowBounds.x,
		y: startupWindowBounds.y,
		width: startupWindowBounds.width,
		height: startupWindowBounds.height,
		minWidth: MIN_WINDOW_WIDTH,
		minHeight: MIN_WINDOW_HEIGHT,

		title: composeAppTitle(settingsStore.get().appDisplayName, isolateDevByGitBranch && !isSharedDevBranch(devGitBranch) ? devGitBranch : undefined),
		icon: initialWindowLogo?.image ?? iconPath,
		frame: windowOptions.frame,
		titleBarStyle: windowOptions.titleBarStyle,
		...(windowOptions.trafficLightPosition ? { trafficLightPosition: windowOptions.trafficLightPosition } : {}),
		webPreferences: {
			preload: mainPreloadPath,
			sandbox: false,
			contextIsolation: true,
			nodeIntegration: false,
			webviewTag: true,

			...(isE2E ? { backgroundThrottling: false } : {}),

			additionalArguments: rendererHeapAdditionalArguments(),
		},
	});
	const createdWindow = mainWindow;

	createdWindow.setBounds(startupWindowBounds);
	applyTaskbarIcon(createdWindow);

	applyE2EWindowPlacement(createdWindow, e2eWindowPlacement);
	configureBrowserPanelWebviewHost(createdWindow);
	let hasShownMainWindow = false;
	function showMainWindowOnce() {
		if (createdWindow.isDestroyed() || hasShownMainWindow) return;
		hasShownMainWindow = true;
		if (isE2E) {
			createdWindow.showInactive();
		} else {
			createdWindow.show();
			createdWindow.focus();
		}

		void appLogger?.info("app", "Cold start milestone: first window shown", {
			sinceModuleLoadMs: Date.now() - bootAnchorMs,
			processUptimeMs: Math.round(process.uptime() * 1000),
		});

		printStartupInfo();
	}

	applyStartupWindowMode(mainWindow, effectiveStartupMode, showMainWindowImmediately);

	mainWindow.webContents.setWindowOpenHandler(({ url }) => {
		void openExternalUrl(url);
		return { action: "deny" };
	});
	mainWindow.webContents.on("did-start-loading", () => {
		void appLogger.info("app", "Main window load started", {
			url: mainWindow?.webContents.getURL(),
		});
	});

	mainWindow.on("focus", () => rearmStandbyAgentOnFocus());
	mainWindow.webContents.on("did-finish-load", () => {
		void appLogger.info("app", "Main window load finished", {
			url: mainWindow?.webContents.getURL(),
		});

		mainWindow?.webContents.setZoomFactor(settingsStore.get().zoomFactor);

		syncSelectionToolShortcut();
		flushSelectionShortcutConflictNotice();

		flushPendingFocusTargetOnLoad();

		if (updateChannel === "dev" && app.isPackaged && devDataMode === null) {
			mainWindow?.webContents.send(ipcChannels.dataEnvDecisionRequired);
		}

		const markerInDataDir = readDataEnvDecision(app.getPath("userData"));
		if (markerInDataDir && validateStartupDataEnv(updateChannel, markerInDataDir) === "mismatch") {
			mainWindow?.webContents.send(ipcChannels.dataEnvMismatchDetected, { dataModeInDir: markerInDataDir.dataMode });
		}

		if (updateChannel === "stable" && markerInDataDir === null) {
			writeDataEnvDecision(app.getPath("userData"), "shared", app.getVersion());
		}
	});
	mainWindow.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
		void appLogger.error("app", "Main window load failed", {
			errorCode,
			errorDescription,
			validatedURL,
			isMainFrame,
		});
	});
	mainWindow.webContents.on("render-process-gone", (_event, details) => {
		const level: AppLogLevel = details.reason === "clean-exit" ? "info" : "error";
		void appLogger.log(level, "app", "Main window renderer process gone", {
			...details,
			platform: process.platform,
			arch: process.arch,
		});

		if (isQuitting || !rendererCrashGuard.shouldAutoReload(details.reason)) return;
		void appLogger.warn("app", "Auto-reloading main window after renderer crash", {
			reason: details.reason,
			exitCode: details.exitCode,
			recoveriesInWindow: rendererCrashGuard.recoveriesInWindow(),
		});
		if (mainWindow && !mainWindow.isDestroyed()) {
			try {
				mainWindow.webContents.reload();
			} catch (error) {
				void appLogger.error("app", "Auto-reload failed", error);
			}
		}
	});

	mainWindow.webContents.on("preload-error", (_event, preloadPath, error) => {
		void appLogger.error("app", "Main window preload failed", {
			preloadPath,
			message: error.message,
			stack: error.stack,
		});
	});
	mainWindow.webContents.on("dom-ready", () => {
		void mainWindow?.webContents
			.executeJavaScript("Boolean(window.piDesktop)", true)
			.then((hasPiDesktop) => {
				void appLogger.info("app", "Main window preload API availability", {
					hasPiDesktop,
					url: mainWindow?.webContents.getURL(),
				});
			})
			.catch((error) => {
				void appLogger.warn("app", "Main window preload API check failed", error);
			});
	});

	const rendererConsoleNoise = new RendererNoiseAggregator();
	mainWindow.webContents.on("console-message", (event) => {
		if (!["warning", "error"].includes(event.level)) return;

		if (classifyRendererNoise(event.message).benign) return;

		const level: AppLogLevel = event.level === "error" ? "warn" : "info";
		const detail = { level: event.level, message: event.message, line: event.lineNumber, sourceId: event.sourceId };
		for (const flush of rendererConsoleNoise.record(`console|${event.level}|${event.message.slice(0, 120)}`, level, "Main window renderer console error", { detail })) {
			const log = toRendererNoiseLog(flush);
			void appLogger.log(log.level, "app", log.message, log.detail);
		}
	});

	mainWindow.once("ready-to-show", showMainWindowOnce);
	mainWindow.webContents.once("did-finish-load", showMainWindowOnce);
	setTimeout(showMainWindowOnce, 3000);
	if (showMainWindowImmediately) {
		showMainWindowOnce();
	}

	const windowForState = createdWindow;
	windowForState.on("close", () => quickTaskChrome.saveWorkbenchBoundsOnClose(windowForState));

	windowForState.on("closed", () => {
		for (const flush of rendererConsoleNoise.flushAll()) {
			const log = toRendererNoiseLog(flush);
			void appLogger.log(log.level, "app", log.message, log.detail);
		}
	});

	mainWindow.on("close", (event) => {
		if (!isQuitting && quickTaskChrome.interceptClose(event)) return;
		if (!isQuitting && settingsStore.get().floatingBallEnabled) {
			event.preventDefault();
			mainWindow?.hide();
			void floatingController?.show();
		} else if (!isQuitting && settingsStore.get().closeToTray) {
			event.preventDefault();
			mainWindow?.hide();
		} else if (!isQuitting) {
			isQuitting = true;
			app.quit();
		}
	});

	mainWindow.webContents.on("before-input-event", (event, input) => {
		if (!mainWindow || mainWindow.isDestroyed()) return;
		if (isShortcutInput("openSettings", input)) {
			event.preventDefault();

			if (!mainWindow.isVisible()) mainWindow.show();
			mainWindow.webContents.send(ipcChannels.appOpenSettings);
			return;
		}

		if (handleWindowZoomShortcut(input)) {
			event.preventDefault();
			return;
		}
		if (isShortcutInput("openNewSession", input)) {
			event.preventDefault();
			mainWindow.webContents.send(ipcChannels.appShortcutTriggered, "openNewSession");
			return;
		}
		if (isShortcutInput("openSearch", input)) {
			event.preventDefault();
			mainWindow.webContents.send(ipcChannels.appShortcutTriggered, "openSearch");
			return;
		}

		if (isShortcutInput("findInSession", input)) {
			event.preventDefault();
			mainWindow.webContents.send(ipcChannels.appShortcutTriggered, "findInSession");
			return;
		}
		if (isShortcutInput("openCommandPalette", input)) {
			event.preventDefault();
			mainWindow.webContents.send(ipcChannels.appShortcutTriggered, "openCommandPalette");
			return;
		}

		if (isShortcutInput("cycleModel", input)) {
			event.preventDefault();
			mainWindow.webContents.send(ipcChannels.appShortcutTriggered, "cycleModel");
			return;
		}
		if (isShortcutInput("cycleThinking", input)) {
			event.preventDefault();
			mainWindow.webContents.send(ipcChannels.appShortcutTriggered, "cycleThinking");
			return;
		}

		if (isShortcutInput("openQuickMessages", input)) {
			event.preventDefault();
			mainWindow.webContents.send(ipcChannels.appShortcutTriggered, "openQuickMessages");
			return;
		}

		if (isShortcutInput("toggleVoiceRecording", input)) {
			event.preventDefault();
			mainWindow.webContents.send(ipcChannels.appShortcutTriggered, "toggleVoiceRecording");
			return;
		}

		if (isShortcutInput("cycleSessionTabs", input)) {
			event.preventDefault();
			mainWindow.webContents.send(ipcChannels.appShortcutTriggered, "cycleSessionTabs");
			return;
		}
		if (isShortcutInput("cycleSessionTabsReverse", input)) {
			event.preventDefault();
			mainWindow.webContents.send(ipcChannels.appShortcutTriggered, "cycleSessionTabsReverse");
			return;
		}

		if (isShortcutInput("closeSessionTab", input)) {
			event.preventDefault();
			mainWindow.webContents.send(ipcChannels.appShortcutTriggered, "closeSessionTab");
			return;
		}
		if (isShortcutInput("toggleDevTools", input)) {
			event.preventDefault();
			toggleMainWindowDevTools(mainWindow);
		}
	});

	const devRendererUrl = shouldUseDevRendererUrl() ? process.env.ELECTRON_RENDERER_URL : undefined;
	if (devRendererUrl) {
		await clearDevRendererCache({
			session: session.defaultSession,
			keepHttpCacheFlag: process.env[KEEP_DEV_HTTP_CACHE_ENV],
			onLog: (outcome, detail) => void appLogger.info("app", `dev renderer http cache ${outcome}`, detail),
		});
		mainWindow.loadURL(devRendererUrl);
	} else {
		mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
	}
}

function shouldUseDevRendererUrl() {
	return is.dev && !app.isPackaged && Boolean(process.env.ELECTRON_RENDERER_URL);
}

function shouldShowMainWindowImmediately() {
	return isUsingLinuxXWaylandWorkaround(petEnabledAtLaunch);
}

function resolveStartupWindowBounds(mode: StartupWindowMode): {
	width: number;
	height: number;
} {
	switch (mode) {
		case "normal-compact":
			return { width: 1100, height: 720 };
		case "normal-medium":
			return { width: 1280, height: 840 };
		case "normal-large":
			return { width: 1480, height: 960 };
		case "maximized":
		case "fullscreen":
		default:
			return { width: 1480, height: 960 };
	}
}

function applyStartupWindowMode(window: BrowserWindow, mode: StartupWindowMode, showImmediately: boolean) {
	if (isE2E) return;
	if (mode === "fullscreen") {
		if (showImmediately) {
			window.setFullScreen(true);
		} else {
			window.maximize();
			window.once("show", () => {
				if (!window.isDestroyed()) window.setFullScreen(true);
			});
		}
		return;
	}
	if (mode === "maximized") {
		window.maximize();
	}
}

async function autoConnectFeishu() {
	const bots = listBots();
	if (bots.length === 0) return;
	const bot = bots.find((b) => b.enabled);
	if (!bot) return;

	void appLogger?.info("feishu", "Detected saved bot config, skipping auto connect", { bot: bot.name });
}

function currentMainProcessLocale(): MainProcessLocale {
	const language = settingsStore.get().language;
	if (language === "pseudo") return "en-US";
	return normalizeMainProcessLocale(language === "system" ? app.getLocale() : language);
}

function warmStandbyAgentAtStartup(): void {
	try {
		if (settingsStore.get().standbyRuntimeEnabled === false) return;

		if (agentManager.list().some((tab) => tab.status === "starting")) return;
		const target = pickStandbyWarmupProject({
			entries: sessionCatalog.listEntries(),
			projectIds: new Set(projectStore.list().map((project) => project.id)),
			defaultBackend: settingsStore.get().defaultAgentBackend,
			now: Date.now(),
		});
		if (!target) return;
		void appLogger?.info("agent", "Startup standby warmup requested", { projectId: target });
		agentManager.ensureStandbyAgent(target);
	} catch (error) {
		void appLogger?.warn("agent", "Startup standby warmup target resolution failed", {
			error: error instanceof Error ? error.message : String(error),
		});
	}
}

let lastStandbyFocusRewarmAt = 0;
const STANDBY_FOCUS_REWARM_INTERVAL_MS = 60_000;

function rearmStandbyAgentOnFocus(): void {
	const now = Date.now();
	if (now - lastStandbyFocusRewarmAt < STANDBY_FOCUS_REWARM_INTERVAL_MS) return;
	lastStandbyFocusRewarmAt = now;
	warmStandbyAgentAtStartup();
}

function mainCopy(key: MainProcessTranslationKey, params?: Record<string, string | number>): string {
	return mainProcessT(currentMainProcessLocale(), key, params);
}

function sessionCommandIpcError(error: SessionCommandError): SessionCommandIpcError {
	if (error.debugDetails) {
		void appLogger?.warn("session-command", "Session command failed", {
			code: error.code,
			debugDetails: error.debugDetails,
		});
	}
	return new SessionCommandIpcError(error, mainCopy);
}

function currentFeishuLocale(): FeishuLocale {
	return normalizeFeishuLocale(currentMainProcessLocale());
}

async function sendAgentPromptWithIntegrations(input: SendPromptInput): Promise<SendPromptResult> {
	const gateway = compositeAgentGateway;
	const agentTab = gateway?.list().find((item) => item.id === input.agentId);
	if (gateway && agentTab && agentTab.backend !== "pi") {
		return gateway.sendPrompt(input);
	}
	const bridge = feishuBridgeRef.current;
	const bridgeConnected = bridge?.getStatus().status === "connected";
	const hasFeishuBinding = bridgeConnected && bridge.hasSessionBinding(input.agentId);
	const docTitle = bridgeConnected ? wantsFeishuDoc(input.message) : undefined;
	const sessionChatId = bridgeConnected ? bridge.getSessionChatId(input.agentId) : undefined;
	let agentInstruction: string | undefined;
	const buildFeishuActionInstruction = (chatId?: string) =>
		[
			"当前会话已连接飞书聊天。严禁调用 lark-cli、飞书 IM API 或搜索群聊来发送文件；不要询问 chat_id。需要把本地文件发到当前飞书聊天时，最终回答末尾独立一行写 [SEND_FILE:本地文件路径]，PiDeck 会按当前会话绑定自动上传。",
			chatId ? `当前绑定的飞书 chat_id: ${chatId}。这是只读上下文，用于确认当前会话绑定；发送文件仍必须用 [SEND_FILE:本地文件路径]。` : undefined,
		]
			.filter(Boolean)
			.join("\n");

	if (bridgeConnected && hasFeishuBinding) {
		const filePath = resolveFeishuFileSendIntent(input.message, agentManager.getCwd(input.agentId));
		if (filePath) {
			const result = await bridge.sendFileForSession(input.agentId, filePath);
			agentManager.recordHostExchange(input.agentId, input.message, result);
			void appLogger.info("feishu", "File sent through current session binding", {
				agentId: input.agentId,
				filePath,
				success: result.startsWith("✅"),
			});
			return { accepted: true };
		}
	}

	if (bridgeConnected && docTitle && !hasFeishuBinding) {
		const tab = agentManager.list().find((item) => item.id === input.agentId);
		if (tab) {
			await bridge.ensureSessionMirror(tab.id, tab.title, tab.sessionPath).catch((error) => {
				void appLogger?.error("feishu", "Auto-bind session mirror failed", { error: error instanceof Error ? error.message : String(error) });
			});
			bridge.trackDocRequest(tab.id, docTitle);
			void bridge.forwardUserMessageToFeishu(tab.id, input.message).catch((error) => {
				void appLogger?.error("feishu", "Forward PiDeck message failed", { error: error instanceof Error ? error.message : String(error) });
			});
			agentInstruction = `${buildFeishuActionInstruction(bridge.getSessionChatId(tab.id))}\n创建飞书文档时，先输出完整正文，最后独立一行写 [CREATE_DOC:文档标题]。`;
		}
	} else if (hasFeishuBinding) {
		agentInstruction = buildFeishuActionInstruction(sessionChatId);
		const tab = agentManager.list().find((item) => item.id === input.agentId);
		if (tab) {
			void bridge.startSessionMirrorRun(tab.id, tab.title, tab.sessionPath).catch((error) => {
				void appLogger?.error("feishu", "Session mirror card init failed", { error: error instanceof Error ? error.message : String(error) });
			});
			if (input.message.trim()) {
				void bridge.forwardUserMessageToFeishu(tab.id, input.message).catch((error) => {
					void appLogger?.error("feishu", "Forward PiDeck message failed", { error: error instanceof Error ? error.message : String(error) });
				});
			}
		}
	}
	const result = await agentManager.sendPrompt(agentInstruction ? { ...input, agentMessage: `${agentInstruction}\n\n${input.message}` } : input);
	void appLogger.info("agent", "Prompt sent", {
		agentId: input.agentId,
		messageLength: input.message.length,
		imageCount: input.images?.length ?? 0,
		streamingBehavior: input.streamingBehavior,
	});
	return result;
}

function resolveBuiltInExtensionRoots(): BuiltInExtensionPathRoots {
	return {
		appPath: app.getAppPath(),
		resourcesPath: process.resourcesPath,
		isDev: !app.isPackaged,
		overlayDir: resolveBuiltInExtensionsOverlayDir(app.getPath("userData")),
	};
}

function createCompletionHelperService(namespace: "enhance" | "agent-invoke" | "suggest"): EnhancePromptService {
	const log = (level: "debug" | "info" | "warn" | "error", message: string) => void appLogger?.[level](namespace, message);
	return new EnhancePromptService({
		resolveLaunch: () =>
			resolvePiAuthHostLaunch({
				settings: settingsStore.get(),
				locator: piLocator as PiLocator,
				userDataPath: app.getPath("userData"),
				appPath: app.getAppPath(),
				resourcesPath: process.resourcesPath,
				isPackaged: app.isPackaged,
				helperFilename: PI_ENHANCE_HOST_FILENAME,
			}),
		logger: {
			debug: (message) => log("debug", message),
			info: (message) => log("info", message),
			warn: (message) => log("warn", message),
			error: (message) => log("error", message),
		},
	});
}

function registerIpc() {
	registerUsageStatsIpc(ipcMain, usageStatsService);

	const aiAaaUsageService = new AiAaaUsageService({
		getModelsConfig: () => configManager.getModelsConfig(),
		getAuthConfig: () => configManager.getAuthConfig(),
		request: usageProbeRequest,
		logger: {
			warn: (message, detail) => void appLogger?.warn("ai-aaa-usage", message, detail),
		},
	});
	registerAiAaaUsageIpc(ipcMain, aiAaaUsageService);

	const qoderUsageService = new QoderUsageService({
		getAuthConfig: () => configManager.getAuthConfig(),
		request: usageProbeRequest,
		logger: {
			warn: (message, detail) => void appLogger?.warn("qoder-usage", message, detail),
		},
	});
	registerQoderUsageIpc(ipcMain, qoderUsageService);

	registerUsageQueryIpc(ipcMain, { getModelsConfig: () => configManager.getModelsConfig(), getAuthConfig: () => configManager.getAuthConfig() });

	registerPiAuthIpc(ipcMain, piAuthService);

	registerEnhanceIpc(ipcMain, enhancePromptService);

	registerPromptSuggestionIpc(ipcMain, promptSuggestionService, {
		debug: (message) => void appLogger?.debug("suggest", message),
		info: (message) => void appLogger?.info("suggest", message),
		warn: (message) => void appLogger?.warn("suggest", message),
	});

	if (agentProfileStore) {
		registerAgentProfileIpc({
			store: agentProfileStore,
			appLogger,
			onNotifyChanged: (event) => {
				const win = mainWindow;
				if (win && !win.isDestroyed()) win.webContents.send(ipcChannels.agentProfilesChanged, event);
			},
		});
	}

	if (favoritesStore) registerFavoritesIpc({ store: favoritesStore, appLogger });
	registerAgentInvokeIpc(ipcMain, agentInvokeService);

	registerSelectionToolIpc({
		service: selectionToolService,
		window: selectionToolWindow,
		insertToMain: (text) => {
			const win = mainWindow;
			if (!win || win.isDestroyed()) return false;
			win.webContents.send(ipcChannels.selectionToolInserted, { text });
			focusMainWindow();
			return true;
		},
	});

	registerAcpIpc({
		settingsStore,

		getSessionManager: () => ({
			getSessionConfigOptions: (agentId: string) => acpAgentManager.getSessionConfigOptions(agentId),
			applyConfigOption: (agentId: string, optionId: string, value: string | boolean) => acpAgentManager.applyConfigOption(agentId, optionId, value),
		}),

		getLifecycleDeps: () => ({
			createInvocation: (command, args) => piLocator.createInvocation(command, args),
			spawn: (command, args, options) => spawn(command, args, { timeout: options.timeout, windowsHide: true }),
		}),
	});
	registerDataEnvIpc({
		getChannel: () => updateChannel,
		getDecisionDir: () => channelDevDataDir,
		getActiveDirectory: () => (devDataMode === "channel-dev" ? "channel-dev" : "shared"),
		getAppVersion: () => app.getVersion(),
		relaunchApp: restartApp,
		quitApp: () => {
			isQuitting = true;
			app.quit();
		},

		getSharedDataDir: () => fallbackSharedDataDir,
		getChannelDevDataDir: () => channelDevDataDir,
		sendProgress: (progress) => mainWindow?.webContents.send(ipcChannels.dataEnvImportProgress, progress),
	});

	const channelSwitchService = new ChannelSwitchService({
		currentChannel: () => updateChannel,

		currentVersion: () => app.getVersion(),
		netFetch: (url, init) => net.fetch(url, init),
		getTempDir: () => app.getPath("temp"),
		spawnInstaller: (filePath) => {
			if (process.platform === "win32") {
				const installer = spawn(filePath, [], { detached: true, stdio: "ignore" });

				installer.once("error", (error) => {
					void appLogger.warn("update", "Installer spawn failed", {
						filePath,
						error: error instanceof Error ? error.message : String(error),
					});
				});
				installer.unref();
				return;
			}
			void openSystemPath(filePath);
		},
		quitApp: () => {
			isQuitting = true;
			app.quit();
		},
		sendToRenderer: (snapshot) => {
			const win = mainWindow;
			if (win && !win.isDestroyed()) {
				win.webContents.send(ipcChannels.channelSwitchStateChanged, snapshot);
			}
		},
		registerQuitCleanup: (name, cleanup) => {
			quitCleanup.register(name, cleanup);
		},
	});

	registerChannelSwitchIpc({ service: channelSwitchService, getInstallerDir: () => channelSwitchService.getInstallerDir() });

	if (automationStore && automationScheduler && automationRunCoordinator) {
		registerAutomationIpc({
			automationStore,
			automationScheduler,
			automationRunCoordinator,
			appLogger,
			onNotifyChanged: (event) => {
				const win = mainWindow;
				if (win && !win.isDestroyed()) {
					win.webContents.send(ipcChannels.automationChanged, event);
				}
			},
		});
	}

	const catalogIdentityContext = () => {
		const { wslEnabled, wslDistro, wslUser } = settingsStore.get();
		return wslEnabled ? { wslDistro, wslUser } : {};
	};

	registerEditorsIpc({
		settingsStore,
		appLogger,
		getMainWindow: () => mainWindow,
	});

	registerBackgroundImageProtocol();
	registerBackgroundsIpc();

	const wallpaperEngineDeps = { getDir: () => settingsStore.get().weWorkshopDir ?? "" };
	registerWallpaperEngineProtocol(wallpaperEngineDeps);
	registerWallpaperEngineIpc(wallpaperEngineDeps);
	registerThemesIpc();

	const localServices = new LocalServiceRegistry([
		new BillionContextService({
			cli: createLocalServiceCli({
				command: "bili",

				env: () => (piLocator ? piLocator.createProcessEnv() : undefined),
			}),
			kill: (pid) => killLocalServiceProcess(pid),
		}),
	]);
	const hostPlugins = new HostPluginService(app.getPath("userData"), sessionCatalog, join(__dirname, "../preload/hostPlugin.js"), localServices, (projectId) => projectStore?.get(projectId)?.name);
	const unregisterHostPlugins = registerHostPluginsIpc(hostPlugins, () => mainWindow);
	const mcpWarning = (code: string) => {
		void appLogger.warn("pideck-mcp", "Optional MCP operation rejected", { code });
	};
	const piDeckMcp = new PiDeckMcpService({
		configPath: join(app.getPath("userData"), "pideck-mcp.json"),
		projects: () => projectStore.list().map(({ id, name }) => ({ id, name })),
		sessions: new HostPluginSessions(sessionCatalog),

		settings: () => settingsStore?.get() ?? null,
		builtInExtensionsVersion: () => readEffectiveBuiltInExtensionsVersion(resolveBuiltInExtensionRoots()),

		runtimes: () => sessionRuntimeCoordinator.listRuntimes(),
		abortRuntime: (target) => sessionRuntimeCoordinator.abortRuntime(target),

		agents: {
			list: () => agentProfileStore?.list() ?? [],
			get: (agentId) => agentProfileStore?.get(agentId),
			create: async (input) => {
				if (!agentProfileStore) throw new Error("operation-failed");
				return agentProfileStore.create(input);
			},
			update: async (agentId, patch) => {
				if (!agentProfileStore) throw new Error("operation-failed");
				return agentProfileStore.update(agentId, patch);
			},
			delete: async (agentId) => {
				if (!agentProfileStore) throw new Error("operation-failed");
				return agentProfileStore.delete(agentId);
			},
			bindSession: async (input) => {
				if (!agentProfileStore) throw new Error("operation-failed");
				return agentProfileStore.bindSession(input);
			},
		},

		automation: {
			listTasks: (projectId) => automationStore?.getSnapshot().tasks.filter((task) => task.projectId === projectId) ?? [],
			getTask: (taskId) => automationStore?.getSnapshot().tasks.find((task) => task.id === taskId),
			listRuns: (projectId) => automationStore?.listRuns().filter((run) => run.projectId === projectId) ?? [],
			getRun: (runId) => automationStore?.getRun(runId),
			createTask: async (input) => {
				if (!automationStore) throw new Error("operation-failed");
				return automationStore.createTask(input);
			},
			updateTask: async (taskId, patch) => {
				if (!automationStore) throw new Error("operation-failed");
				return automationStore.updateTask(taskId, patch);
			},
			deleteTask: async (taskId) => {
				if (!automationStore) throw new Error("operation-failed");
				return automationStore.deleteTask(taskId);
			},
			runNow: async (taskId) => {
				if (!automationRunCoordinator) throw new Error("operation-failed");
				return automationRunCoordinator.runNow(taskId);
			},
			abortRun: async (runId) => {
				if (!automationRunCoordinator) throw new Error("operation-failed");
				return automationRunCoordinator.abortRun(runId);
			},
		},

		favorites: {
			list: () => favoritesStore?.list() ?? [],
			get: (favoriteId) => favoritesStore?.list().find((entry) => entry.id === favoriteId),
			add: async (input) => {
				if (!favoritesStore) throw new Error("operation-failed");
				return favoritesStore.add(input);
			},
			remove: async (favoriteId) => {
				if (!favoritesStore) return false;
				return favoritesStore.remove(favoriteId);
			},
		},
		warn: mcpWarning,
	});
	const unregisterPiDeckMcp = registerPiDeckMcpIpc(piDeckMcp, () => mainWindow, mcpWarning);
	quitCleanup.register("pideck-mcp", async () => {
		unregisterPiDeckMcp();
		await piDeckMcp.dispose();
	});
	quitCleanup.register("host-plugins", () => {
		unregisterHostPlugins();
		hostPlugins.dispose();
	});

	void hostPlugins.initialize(resolveBuiltinHostPluginDirectory(resolveBuiltInExtensionRoots())).catch(() => appLogger.warn("host-plugins", "Optional plugin host initialization failed"));
	registerProjectsIpc({
		projectStore,
		settingsStore,
		gitService,
		worktreeService,
		agentManager,
		appLogger,
		projectResourceManager,
		sessionCatalog,
		mainCopy: mainCopy as (key: string, params?: Record<string, string | number>) => string,
		getMainWindow: () => mainWindow,
		resolveWslEnvironment: async (distro, user) => {
			const { resolveWslEnvironment } = await import("./wsl/WslEnvironment");
			return resolveWslEnvironment(distro, user, {
				warn: (msg: string, detail: Record<string, unknown>) => void appLogger?.warn("wsl", msg, detail),
			});
		},
	});
	registerResourceImportIpc(resourceImportManager);

	registerScratchPadIpc({ appLogger });

	const noticeHistoryStore = new NoticeHistoryStore({
		getFilePath: () => join(app.getPath("userData"), "notice-history.json"),
		log: (level, message, detail) => {
			if (level === "error") void appLogger.error("notice-history", message, detail);
			else void appLogger.info("notice-history", message, detail);
		},
	});
	registerNoticeHistoryIpc(noticeHistoryStore);

	quitCleanup.register("notice-history", async () => {
		await noticeHistoryStore.flush();
	});

	cleanupPasteFiles = registerPasteFilesIpc({
		projectStore,
		settingsStore,
		appLogger,
	});

	registerSecurityIpc({
		securityStore,
		log: (domain, message, details) => void appLogger.info(domain, message, details),
	});

	registerVisionIpc({
		visionBridge: new VisionBridgeConfigManager(configManager),
		log: (message, ...args) => appLogger.info("vision", message, ...args),
	});

	const whisperRuntimeRoot = join(app.getPath("userData"), "voice-runtime");
	const whisperRuntimeManager = new WhisperRuntimeManager({
		platform: process.platform,
		arch: process.arch,
		layout: { runtimeRoot: whisperRuntimeRoot, modelsRoot: join(whisperRuntimeRoot, "models"), tempRoot: join(whisperRuntimeRoot, "tmp") },
		download: createNetDownloader((scope, message, detail) => void appLogger.warn(scope, message, detail)),
		fetchReleaseDigests: fetchWhisperReleaseDigests,
		log: (scope, message, detail) => void appLogger.info(scope, message, detail),
	});
	const whisperServerPool = new WhisperServerPool({
		resolveServerPath: (input) => whisperRuntimeManager.resolveServerPath(input),
		getEnv: () => (piLocator ? piLocator.createProcessEnv() : undefined),
		log: (message, details) => void appLogger.info("voice-whisper-server", message, details),
	});

	quitCleanup.register("whisper-server", async () => {
		whisperServerPool.abortAll();
		await whisperServerPool.shutdown("quit");
	});
	const whisperTranscriber = new WhisperTranscriber({
		manager: whisperRuntimeManager,
		server: whisperServerPool,
		getTempRoot: () => join(whisperRuntimeRoot, "tmp"),

		getEnv: () => (piLocator ? piLocator.createProcessEnv() : undefined),
		log: (message, details) => void appLogger.info("voice-whisper", message, details),
	});
	const voiceTranscriptionConfigStore = new VoiceTranscriptionConfigStore({
		getConfigPath: () => join(app.getPath("userData"), "voice-transcription.json"),
		isEncryptionAvailable: () => safeStorage.isEncryptionAvailable(),
		protect: (plainText) => safeStorage.encryptString(plainText),
		unprotect: (encrypted) => safeStorage.decryptString(Buffer.from(encrypted)),
		log: (message, details) => void appLogger.info("voice-transcription", message, details),
		isLocalReady: (config) => {
			const status = whisperRuntimeManager.getStatus({ cliPath: config.cliPath, localModelId: undefined });
			const selected = getWhisperModelDef(config.localModelId);
			return status.cliReady && Boolean(selected && whisperRuntimeManager.isModelInstalled(selected.id));
		},
	});
	registerVoiceTranscriptionIpc({
		configStore: voiceTranscriptionConfigStore,
		service: new VoiceTranscriptionService({
			getPublicConfig: () => voiceTranscriptionConfigStore.getPublicConfig(),
			getCredentials: () => voiceTranscriptionConfigStore.getCredentials(),
			transcribeLocal: (input) => whisperTranscriber.transcribe(input),
			cancelLocal: (requestId) => whisperTranscriber.cancel(requestId),

			createStreamSocket: createVolcStreamSocket,
			emitStreamPartial: (partial) => {
				if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(ipcChannels.voiceTranscriptionStreamPartial, partial);
			},
			log: (message, details) => void appLogger.info("voice-transcription", message, details),
		}),
		runtimeManager: whisperRuntimeManager,

		beforeRuntimeMutation: () => whisperServerPool.shutdown("runtime-mutation"),
		emitRuntimeProgress: (progress) => {
			if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(ipcChannels.voiceTranscriptionRuntimeProgress, progress);
		},
	});

	const imageGenConfigStore = new ImageGenConfigStore({
		getConfigPath: () => join(app.getPath("userData"), "imagegen.json"),
		log: (message, ...args) => appLogger.info("imagegen", message, ...args),
	});

	const imageGenRoots = resolveImageGenStorageRoots();
	const imageBlobStore = new ImageBlobStore({ getBlobsPath: () => imageGenRoots.blobs });
	acpImageBlobStore = imageBlobStore;
	void imageBlobStore.ensureDir();
	const imageSessionStore = new ImageSessionStore({
		getStorePath: () => imageGenRoots.sessions,
		blobs: imageBlobStore,
	});

	registerImageGenImageProtocol(imageBlobStore);

	const resolveLocalImageRoots = () => [app.getPath("userData"), app.getPath("desktop"), join(app.getPath("temp"), "pideck-shots"), projectStore.getChatProjectPath(), ...projectStore.list().map((project) => project.path)];

	const canonicalLocalImageRoots = createCanonicalRootsProvider(resolveLocalImageRoots);
	registerLocalImageProtocol(canonicalLocalImageRoots);

	registerLocalImageIpc({ resolveRoots: canonicalLocalImageRoots });
	registerImageGenIpc({
		imageGen: new ImageGenService({
			getProviderCredentials: async (provider) => {
				const creds = await imageGenConfigStore.getCredentials(provider);
				if (!creds) return null;
				return { baseUrl: creds.baseUrl, apiKey: creds.apiKey, extraParams: creds.extraParams, referenceMode: creds.provider.referenceMode, apiStyle: creds.provider.apiStyle };
			},
			log: (message, ...args) => appLogger.info("imagegen", message, ...args),
		}),
		imageGenConfig: imageGenConfigStore,
		log: (message, ...args) => appLogger.info("imagegen", message, ...args),
		readImageBlob: (ref) => imageBlobStore.readPayload(ref),

		persistImageGen: async ({ sessionId, provider, model, prompt, image, size, referenceImages }) => {
			const entry = sessionCatalog?.get(sessionId);
			if (!entry) return;

			const project = projectStore.get(entry.projectId);
			if (project && isDefaultAgentTitle(entry.title, project, mainCopy as never)) {
				const firstLine = prompt.split(/\r?\n/, 1)[0]?.trim() ?? "";
				if (firstLine) {
					await sessionCatalog.applyAutomaticTitle(sessionId, firstLine, "fallback");
					mainWindow?.webContents.send(ipcChannels.sessionsCatalogRefreshed, { projectId: entry.projectId });
				}
			}

			if (entry.backend === "imagegen" || !entry.filePath) {
				await imageSessionStore.append(sessionId, [
					{
						id: randomUUID(),
						agentId: "",
						role: "user",
						text: prompt,
						timestamp: Date.now(),

						images: (referenceImages ?? []).map((ref) => ({
							type: "image" as const,
							data: ref.data,
							mimeType: ref.mimeType,
						})),
					},
					{
						id: randomUUID(),
						agentId: "",
						role: "assistant",
						text: "",
						stopReason: "stop",
						timestamp: Date.now(),
						images: [{ type: "image" as const, data: image.data, mimeType: image.mimeType }],

						meta: { imageGen: { status: "complete", prompt, size } },
					},
				]);
				await sessionCatalog.promoteToActive(sessionId);
				return;
			}
			await agentManager?.appendLocalMessagesToSession(entry.filePath, [
				{
					role: "user",

					content: [
						{ type: "text", text: prompt },
						...(referenceImages ?? []).map((ref) => ({
							type: "image" as const,
							source: {
								type: "base64" as const,
								media_type: ref.mimeType,
								data: ref.data,
							},
						})),
					],
				},
				{
					role: "assistant",
					content: [
						{
							type: "image",
							source: {
								type: "base64",
								media_type: image.mimeType,
								data: image.data,
							},
						},
					],
					extra: {
						api: "openai-images",
						provider,
						model,

						imageGen: { status: "complete", prompt, size },
					},
				},
			]);
		},
	});

	const videoGenConfigStore = new VideoGenConfigStore({
		getConfigPath: () => join(app.getPath("userData"), "videogen.json"),
		log: (message, ...args) => appLogger.info("videogen", message, ...args),
	});
	const videoGenRoots = resolveVideoGenStorageRoots();
	const videoBlobStore = new VideoBlobStore({ getBlobsPath: () => videoGenRoots.blobs });
	void videoBlobStore.ensureDir();
	const videoSessionStore = new VideoSessionStore({
		getStorePath: () => videoGenRoots.sessions,
		blobs: videoBlobStore,
	});
	const videoJobStore = new VideoJobStore({
		getJobsPath: () => videoGenRoots.jobs,
		log: (message, ...args) => appLogger.info("videogen", message, ...args),
	});

	registerVideoGenProtocol(videoBlobStore);
	const sendVideoGenEvent = (snapshot: VideoGenJobSnapshot) => {
		const window = mainWindow;
		if (window && !window.isDestroyed()) {
			window.webContents.send(ipcChannels.videogenEvent, snapshot);
		}
	};
	const videoJobRunner = new VideoJobRunner({
		loadJobs: () => videoJobStore.load(),
		saveJobs: (jobs) => videoJobStore.save(jobs),
		getCredentials: async (providerId) => {
			const creds = await videoGenConfigStore.getCredentials(providerId);
			if (!creds) return null;
			return { baseUrl: creds.baseUrl, apiKey: creds.apiKey, protocol: creds.protocol, name: creds.provider.name };
		},
		putVideo: (response) => videoBlobStore.putFromResponse(response),
		persistMessages: (sessionId, messages) => videoSessionStore.append(sessionId, messages),
		emit: sendVideoGenEvent,
		log: (message, ...args) => appLogger.info("videogen", message, ...args),
	});
	registerVideoGenIpc({
		submit: async (request) => {
			const result = await videoJobRunner.submit(request);

			if (result.ok && request.sessionId) {
				const entry = sessionCatalog?.get(request.sessionId);
				if (entry) {
					const project = projectStore.get(entry.projectId);
					if (project && isDefaultAgentTitle(entry.title, project, mainCopy as never)) {
						const firstLine = request.prompt.split(/\r?\n/, 1)[0]?.trim() ?? "";
						if (firstLine) {
							await sessionCatalog.applyAutomaticTitle(request.sessionId, firstLine, "fallback");
							mainWindow?.webContents.send(ipcChannels.sessionsCatalogRefreshed, { projectId: entry.projectId });
						}
					}
					await sessionCatalog.promoteToActive(request.sessionId);
				}
			}
			return result;
		},
		cancel: (jobId) => videoJobRunner.cancel(jobId),
		getConfig: () => videoGenConfigStore.getConfig(),
		saveConfig: (input) => videoGenConfigStore.saveConfig(input),
		listJobs: (sessionId) => videoJobRunner.listJobsForSession(sessionId),
		log: (message, ...args) => appLogger.info("videogen", message, ...args),
	});

	void videoJobRunner.resume();

	registerSessionIpc({
		projectStore,
		settingsStore,
		sessionScanner,
		sessionCatalog,

		resolveSessionAgentInstruction: (sessionId) => agentProfileStore?.getBoundAgent(sessionId)?.systemPrompt,
		sessionRuntimeCoordinator,
		agentManager,
		configManager,
		codexSessionImporter,
		claudeSessionImporter,
		qoderSessionImporter,
		openCodeSessionImporter,
		zcodeSessionImporter,
		workbuddySessionImporter,
		cursorSessionImporter,
		kimiSessionImporter,
		kimiWorkSessionImporter,
		minimaxSessionImporter,
		directorySessionImporter,
		appLogger,
		terminalManager,
		mainCopy: mainCopy as (key: string, params?: Record<string, string | number>) => string,
		getMainWindow: () => mainWindow,
		emitSessionRuntimeEvent,
		emitSessionRuntimeDetach,
		emitSessionActivating,
		emitSessionActivationFailed,
		createAnonymousSession,
		stopSessionRuntime,
		emitReplacementState,
		readCatalogSessionReferenceMessages,

		readImageSessionMessages: (sessionId) => imageSessionStore.readMessages(sessionId),

		readVideoSessionMessages: (sessionId) => videoSessionStore.readMessages(sessionId),
		copyCatalogSession,
		exportCatalogSessionHtml,
		replaceAgentSession,

		validationCatalogModels,

		sessionForkCommands,

		sessionContentSearch: async (query) => {
			if (!sessionIndexService) return null;
			const roots = await sessionScanner.resolveContentSearchRoots(projectPathsForContentSearch());
			if (roots.length === 0) return null;
			if (!sessionIndexService.isReady(roots)) {
				sessionIndexService.warmup(roots);
				return null;
			}
			const refreshed = await sessionIndexService.refresh(roots);
			if (!refreshed.ok && !sessionIndexService.isReady(roots)) return null;
			const result = await sessionIndexService.search(roots, query);
			return result.ok ? result.value : null;
		},

		sessionMessageSearch: async (sessionPath, query) => {
			return sessionMessageSearchInFile(sessionPath, query);
		},

		readAcpMessages: (acpSessionId) => acpAgentManager.readMessagesByAcpSessionId(acpSessionId),
		readSessionFacts: (sessionPath) => agentManager.readSessionFacts(sessionPath),
		readSessionOutline: (sessionPath, limit) => agentManager.readSessionOutline(sessionPath, limit),
	});

	const prewarmTimer = setTimeout(() => {
		const projects = projectStore.list();
		projects.forEach((project, index) => {
			const timer = setTimeout(() => {
				scheduleCatalogBackgroundScan(project.id, async () => {
					try {
						const settings = settingsStore.get();
						let projectPath = project.path;
						if (settings.wslEnabled && settings.wslDistro) {
							projectPath = projectPath.replace(/^([A-Za-z]):\\/, (_: string, drive: string) => `/mnt/${drive.toLowerCase()}/`).replace(/\\/g, "/");
						}
						const summaries = await sessionScanner.list(projectPath);
						await sessionCatalog.mergeScanned(project.id, summaries, settings.wslEnabled ? { wslDistro: settings.wslDistro, wslUser: settings.wslUser } : {});
					} catch (error) {
						void appLogger.warn("session", "Catalog prewarm scan failed", {
							projectId: project.id,
							error: error instanceof Error ? error.message : String(error),
						});
					}
				});
			}, index * 1500);
			timer.unref?.();
		});

		try {
			void extensionManager?.warmPiVersionProbe();

			void extensionManager?.list(false).catch((error) => {
				void appLogger.warn("extension", "extension list prewarm failed", { error: error instanceof Error ? error.message : String(error) });
			});
		} catch (error) {
			void appLogger.warn("extension", "pi version prewarm failed", { error: error instanceof Error ? error.message : String(error) });
		}
	}, 3000);
	prewarmTimer.unref?.();

	registerGitIpc({
		appLogger,
		mainCopy: mainCopy as (key: string, params?: Record<string, string | number>) => string,
		gitService,
		gitRefsWatcher: gitRefsWatcher,
		getMainWindow: () => mainWindow,
		piLocator,
		projectStore,
		settingsStore,
		worktreeService,
	});

	if (!piModelCapabilityCache) throw new Error("Pi model capability cache is unavailable after settings load");

	setPiAiCatalogUserDataDir(app.getPath("userData"));
	const catalogUpdater = new PiAiCatalogUpdater({
		userDataDir: app.getPath("userData"),

		source: () => settingsStore.get().updateSource,
	});

	const builtInExtensionRoots = resolveBuiltInExtensionRoots();
	const builtInExtensionsUpdater = new BuiltInExtensionsUpdater({
		userDataDir: app.getPath("userData"),
		builtinExtensionsDir: resolveBuiltInExtensionsDir(builtInExtensionRoots),

		vendorNodeModulesDir: resolveVendorNodeModulesDir(builtInExtensionRoots),

		source: () => settingsStore.get().updateSource,
	});

	builtInExtensionsUpdater.ensureOverlayVendorDependencies();

	installAtomgitNoCacheBypass(() => session.fromPartition(UPDATER_PARTITION_NAME, { cache: false }));
	const updateServiceBase = {
		settingsStore,

		appUpdatesEnabled: false,

		channel: updateChannel,
		checkPiUpdate: () => extensionManager.checkPiUpdate(),

		checkCatalogUpdate: () => catalogUpdater.checkRemote(),

		updateCatalog: () => catalogUpdater.update(),
		sendToRenderer: (snapshot: import("../shared/types").AppUpdateStatusSnapshot) => {
			if (mainWindow && !mainWindow.isDestroyed()) {
				mainWindow.webContents.send(ipcChannels.appUpdateStatusChanged, snapshot);
			}
		},
		log: (level: "info" | "warn", message: string, details?: Record<string, unknown>) => {
			if (level === "warn") void appLogger.warn("update", message, details ?? {});
			else void appLogger.info("update", message, details ?? {});
		},
		getCurrentVersion: () => app.getVersion(),
	};

	let updateInstallSetQuitting = false;

	const appUpdateDelivery = resolveAppUpdateDeliveryPlan({
		platform: process.platform,
		arch: process.arch,
		isAppImage: Boolean(process.env.APPIMAGE),
	});
	const manualUpdateTarget = resolveManualUpdateTarget({
		platform: process.platform,
		arch: process.arch,
		isPortable: process.env.PORTABLE_EXECUTABLE_DIR !== undefined,
		isAppImage: Boolean(process.env.APPIMAGE),
		execPath: process.execPath,
		runningUnderArm64Translation: app.runningUnderARM64Translation === true,
	});
	if (appUpdateDelivery.mode === "manual") {
		const checkManualUpdate = createManualUpdateChecker({ channel: updateChannel, target: manualUpdateTarget });
		updateService = new UpdateService({
			...updateServiceBase,
			deliveryMode: "manual",
			deliveryReason: appUpdateDelivery.reason,

			checkManualAppUpdate: (latestReleaseUrl?: string) => checkManualUpdate(app.getVersion(), latestReleaseUrl),

			downloadManualUpdate: (release: AppManualUpdateRelease, options: { signal?: AbortSignal; onProgress?: (progress: InstallerDownloadProgress) => void }) =>
				downloadInstallerAsset({
					assetName: release.assetName,
					assetUrl: release.assetUrl,
					digestSha256: release.digestSha256,
					targetDir: app.getPath("downloads"),
					netFetch: (url, init) => net.fetch(url, init),
					signal: options.signal,
					onProgress: options.onProgress,
				}),

			openManualInstaller: async (filePath: string) => {
				if (process.platform === "darwin") {
					const error = await openSystemPath(filePath);
					if (error) throw new Error(error);
					return;
				}
				shell.showItemInFolder(filePath);
			},
		});
	} else {
		updateService = new UpdateService({
			...updateServiceBase,
			deliveryMode: "automatic",
			autoUpdater: createRealAutoUpdater(),

			prepareForInstall: () => {
				updateInstallSetQuitting = !isQuitting;
				isQuitting = true;
			},

			rollbackInstallPreparation: () => {
				if (updateInstallSetQuitting) isQuitting = false;
				updateInstallSetQuitting = false;
			},
		});
	}
	updateService.start();
	registerCatalogIpc(catalogUpdater, {
		onCatalogChanged: () => void updateService?.refreshCatalogSnapshot(),
	});

	const quickMessageStore = new QuickMessageStore({
		getConfigPath: () => join(app.getPath("userData"), QUICK_MESSAGES_FILE_NAME),
		getDefaultConfigPath: () => (app.isPackaged ? join(process.resourcesPath, QUICK_MESSAGES_DEFAULT_RESOURCE_NAME) : join(app.getAppPath(), "resources", QUICK_MESSAGES_DEFAULT_RESOURCE_NAME)),

		getLegacyItems: () => settingsStore.get().quickMessages,
		log: (scope, message, detail) => void appLogger.info(scope, message, detail),
	});
	registerQuickMessagesIpc(quickMessageStore, (scope, message, detail) => void appLogger.info(scope, message, detail));

	const replyActionRuleStore = new ReplyActionRuleStore({
		getConfigPath: () => join(app.getPath("userData"), REPLY_ACTIONS_FILE_NAME),
		getDefaultConfigPath: () => (app.isPackaged ? join(process.resourcesPath, REPLY_ACTIONS_DEFAULT_RESOURCE_NAME) : join(app.getAppPath(), "resources", REPLY_ACTIONS_DEFAULT_RESOURCE_NAME)),
		log: (scope, message, detail) => void appLogger.info(scope, message, detail),
	});
	registerReplyActionsIpc(replyActionRuleStore, (scope, message, detail) => void appLogger.info(scope, message, detail));
	registerBuiltInExtensionIpc(builtInExtensionsUpdater);

	const tokendanceCatalogStore = new TokendanceCatalogStore({
		getCachePath: () => join(app.getPath("userData"), "tokendance-models.json"),
		log: (message, detail) => void appLogger.info("tokendance", message, detail),
	});
	registerSystemIpc({
		afterSettingsUpdate: () => syncSelectionToolShortcut(),
		piLocator,
		settingsStore,
		configManager,
		projectResourceManager,
		agentManager,
		skillManager,
		appLogger,
		rpcLogger,
		sessionRuntimeCoordinator,

		isProjectTrusted: async (projectId, projectRoot) => {
			const project = projectStore.get(projectId);
			const settings = settingsStore.get();
			const trustPath = project?.environment === "wsl" && process.platform === "win32" && settings.wslEnabled && settings.wslDistro ? toWslLinuxPath(projectRoot, { distro: settings.wslDistro }) : projectRoot;
			return (await configManager.getProjectTrustDecision(trustPath)) === true;
		},

		piRuntimeNodeInstaller: {
			download: createNetDownloader((scope, message, detail) => {
				void appLogger.info(scope, message, detail);
			}),
			extract: createTarExtractor((scope, message, detail) => void appLogger.warn(scope, message, detail)),
		},
		diagnosticsMonitor: diagnosticsMonitor ?? undefined,
		environmentDoctor: environmentDoctor ?? undefined,
		logBundleExporter: logBundleExporter ?? undefined,

		stopAgentFromMonitor,
		modelCapabilityCache: piModelCapabilityCache,

		relaunchApp: relaunchAppOnly,

		tokendanceCatalog: tokendanceCatalogStore,

		tokendanceAuth: new TokendanceAuthStore(),

		tokendancePayment: new TokendancePaymentStore({
			resolveEndpoint: () => configManager.resolveProviderEndpoint(TOKENDANCE_PROVIDER),
			request: usageProbeRequest,
		}),

		tokendanceInstall: (apiKey) =>
			installTokendanceProvider(
				{
					configManager,
					tokendanceCatalog: tokendanceCatalogStore,

					catalogLookup: (modelId) => lookupPiAiCatalogEntry(getPiAiCatalogIndex(), "tokendance", modelId),
				},
				{ apiKey },
			),
		getMainWindow: () => mainWindow,

		getTray: () => tray,
		mainCopy: mainCopy as (key: string, params?: Record<string, string | number>) => string,

		checkForAppUpdate: () => updateService?.checkNow() ?? Promise.resolve(),
		downloadAppUpdate: () => updateService?.downloadNow() ?? Promise.resolve(),
		installAppUpdate: () => updateService?.installNow(),
		openExternalUrl,
		extensionManager,

		applyDesktopProxy,
		testPiProxy,

		applyWebServiceSettings: async (settings) => {
			await webServiceManager.applySettings(settings);
			await remoteAccessManager?.syncWebService();
		},
		restartWebService: async (settings) => {
			await webServiceManager.restart(settings);
			await remoteAccessManager?.syncWebService();
		},
		reactToPetSettings: async (prev, next) => {
			await petSystem?.reactToSettings(prev, next);
		},

		reactToCuaSettings: async (prev, next) => {
			if (!cuaService) return;
			const cuaChanged = prev.cuaEnabled !== next.cuaEnabled;
			const browserChanged = prev.browserAgentEnabled !== next.browserAgentEnabled;
			if (!cuaChanged && !browserChanged) return;
			await cuaService.applySettings({
				cuaEnabled: next.cuaEnabled,
				browserAgentEnabled: next.browserAgentEnabled ?? false,
			});
		},
		applyNativeThemeSource,
		refreshTrayContextMenu,

		setFeishuLocale: () => {
			feishuBridgeRef.current?.setLocale(currentFeishuLocale());
		},
		setFeishuConfigDefaultBotName: (_name: string) => {
			setFeishuConfigDefaultBotName(feishuT(currentFeishuLocale(), "bridge.defaultBotName"));
		},
		notifyTitleBarChange: (window) => settingsStore.notifyTitleBarChange(window),
		setSessionCatalogIdentityContext: (ctx) => sessionCatalog.setIdentityContext(ctx),
		resolveWslEnvironment: async (distro, user, logger) => {
			const { resolveWslEnvironment: resolveWsl } = await import("./wsl/WslEnvironment");
			return resolveWsl(distro, user, logger);
		},
		configureSessionScannerWsl: (env) => sessionScanner.configureWsl(env),
		clearSessionScannerWsl: () => sessionScanner.clearWsl(),
		configureSkillManagerWsl: (env) => skillManager.configureWsl(env),

		readSkillContent: (skillPath) =>
			readSkillContent(skillPath, {
				globalSkillPaths: skillManager.getLocations().map((location) => location.path),
				projectRootPaths: projectStore.list().map((project) => {
					const settings = settingsStore.get();
					if (process.platform === "win32" && project.environment === "wsl" && settings.wslEnabled && settings.wslDistro) {
						try {
							return toWindowsHostPath(project.path, { distro: settings.wslDistro });
						} catch {
							return project.path;
						}
					}
					return project.path;
				}),
			}),
		configurePromptManagerWsl: (env) => promptManager.configureWsl(env),
		configureExtensionManagerWsl: (env) => extensionManager.configureWsl(env),
		configureConfigManagerWsl: (env) => configManager.configureWsl(env),
		configureXuePromptManagerWsl: (env) => xuePromptManager.configureWsl(env),
		configureAgentManagerWsl: (env) => agentManager.configureWsl(env),

		sessionCommandIpcError,

		webServiceManager,
		terminalManager,
		isQuitting: {
			get value() {
				return isQuitting;
			},
			set value(next: boolean) {
				isQuitting = next;
			},
		},
		devBranch: isolateDevByGitBranch && !isSharedDevBranch(devGitBranch) ? devGitBranch : undefined,
		updateService: updateService ?? undefined,
	});

	registerStoreIpc({
		promptManager,
		skillManager,
		xuePromptManager,
		extensionManager,
		projectResourceManager,
		configManager,
		projectTrustPath: (projectRoot, projectId) => {
			const project = projectStore.get(projectId);
			const settings = settingsStore.get();
			if (project?.environment === "wsl" && process.platform === "win32" && settings.wslEnabled && settings.wslDistro) {
				try {
					return toWslLinuxPath(projectRoot, { distro: settings.wslDistro });
				} catch {
					return projectRoot;
				}
			}
			return projectRoot;
		},

		netFetch: (url, init) => net.fetch(url, init),
		resolveInstallProxyEnv: async () => {
			const settings = settingsStore.get();
			const desktop = { enabled: settings.desktopProxyEnabled, url: settings.desktopProxyUrl, bypass: settings.desktopProxyBypass };

			let systemRules: string | null = null;
			if (!desktop.enabled || !desktop.url.trim()) {
				try {
					systemRules = await session.defaultSession.resolveProxy("https://github.com");
				} catch (error) {
					void appLogger.warn("skill-hub", "Resolve system proxy failed", { error: error instanceof Error ? error.message : String(error) });
				}
			}
			return buildSkillInstallProxyEnv(desktop, systemRules);
		},
		sendSkillHubInstallProgress: (progress) => {
			if (!mainWindow || mainWindow.isDestroyed()) return;
			mainWindow.webContents.send(ipcChannels.skillHubInstallProgress, progress);
		},
		appLogger,
		mainCopy: mainCopy as (key: string, params?: Record<string, string | number>) => string,
	});

	registerWebRemoteAccessIpc({ remoteAccessManager });

	registerBackupIpc({
		configBackupManager: configBackupManager!,
		appLogger,

		flushSettings: () => settingsStore.flushPendingSave(),
		afterRestore: async () => {
			await settingsStore.load();

			refreshShortcutBindings(settingsStore.get());

			applyWindowLogoStyle(settingsStore.get().logoStyle, () => mainWindow, settingsStore.get().logoCustomImage);

			syncTaskbarShortcutIcon({ style: settingsStore.get().logoStyle, customLogoDataUrl: settingsStore.get().logoCustomImage });
			void piModelCapabilityCache?.refresh().catch(() => undefined);
		},
	});

	registerTerminalIpc({
		appLogger,
		sessionRuntimeCoordinator,
		terminalManager,
		toSessionCommandIpcError: sessionCommandIpcError,
	});

	registerFilesIpc({
		fileSystemService,
		projectStore,
		settingsStore,

		getFileIndexService: () => fileIndexService,
		appLogger,
		getMainWindow: () => mainWindow,
		openExternalUrl,
	});
	registerClipboardIpc({ appLogger });

	registerShellMenuIpc({
		appLogger,
		menuTitle: mainCopy("shellMenu.openWithAPIX"),
		quickTaskTitle: mainCopy("shellMenu.quickTask"),
	});
}

function sendTelemetryHeartbeat() {
	const telemetry = new TelemetryService({
		settingsStore,
		config: {
			projectKey: POSTHOG_PROJECT_KEY,
			host: POSTHOG_HOST,
		},
		metadata: {
			appVersion: app.getVersion(),
			platform: process.platform,
			arch: process.arch,
			packaged: app.isPackaged,
		},

		snapshot: () =>
			collectTelemetrySnapshot({
				settings: settingsStore.get(),
				sessionsTotal: sessionCatalog.listEntries().length,
				projectsTotal: projectStore.list().length,
				agentsActive: agentManager.list().length,
				feishuBotsTotal: listBots().length,
				automationTasksTotal: automationStore?.listTasks().length ?? 0,
				systemLocale: app.getLocale(),
				portable: Boolean(process.env.PORTABLE_EXECUTABLE_DIR),
				uptimeMs: process.uptime() * 1000,
				osRelease: osRelease(),
			}),
		capture: async (request) => {
			const response = await net.fetch(request.url, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(request.body),
			});
			if (!response.ok) {
				throw new Error(`Telemetry request failed: ${response.status}`);
			}
		},
	});

	void telemetry.sendHeartbeat().catch(() => undefined);
}

async function detectExternalEditorsOnFirstLaunch() {
	const current = settingsStore.get().externalEditors;
	if (Object.values(current).some((editor) => editor.command)) return;
	const detected = await detectExternalEditors();
	if (detected.length === 0) return;
	await settingsStore.update({
		externalEditors: mergeDetectedExternalEditors(current, detected),
	});
	void appLogger.info("editor", "External editors detected on first launch", { count: detected.length });
}

protocol.registerSchemesAsPrivileged([
	{ scheme: "pideck-plugin", privileges: { secure: true, standard: true, supportFetchAPI: true, corsEnabled: false } },

	{ scheme: "pideck-we", privileges: { secure: true, standard: true, corsEnabled: false, supportFetchAPI: true, stream: true } },
	{ scheme: "pideck-bg", privileges: { secure: true, standard: true, corsEnabled: false, supportFetchAPI: true, stream: false } },
	{ scheme: "pideck-pet", privileges: { secure: true, standard: true, corsEnabled: false, supportFetchAPI: true, stream: false } },
	{ scheme: "pideck-sound", privileges: { secure: true, standard: true, corsEnabled: false, supportFetchAPI: true, stream: true } },

	{ scheme: "pideck-img", privileges: { secure: true, standard: true, corsEnabled: false, supportFetchAPI: true, stream: true } },

	{ scheme: "pideck-file", privileges: { secure: true, standard: true, corsEnabled: false, supportFetchAPI: true, stream: true } },

	{ scheme: "pideck-html", privileges: { secure: true, standard: true, corsEnabled: false, supportFetchAPI: false, stream: false } },
]);

app
	.whenReady()
	.then(async () => {
		if (singleInstanceEnabled && !gotSingleInstanceLock) return;

		projectStore = new ProjectStore(() => mainCopy("dialog.chooseProjectFolder"));
		fileSystemService = new FileSystemService();
		sessionScanner = new SessionScanner(mainCopy);
		codexSessionImporter = new CodexSessionImporter(mainCopy);
		claudeSessionImporter = new ClaudeSessionImporter(mainCopy);
		qoderSessionImporter = new QoderSessionImporter(mainCopy);
		openCodeSessionImporter = new OpenCodeSessionImporter(mainCopy);
		zcodeSessionImporter = new ZCodeSessionImporter(mainCopy);
		workbuddySessionImporter = new WorkBuddySessionImporter(mainCopy);
		cursorSessionImporter = new CursorSessionImporter(mainCopy);
		kimiSessionImporter = new KimiSessionImporter(mainCopy);
		kimiWorkSessionImporter = new KimiWorkSessionImporter(mainCopy);
		minimaxSessionImporter = new MinimaxSessionImporter(mainCopy);

		directorySessionImporter = new DirectorySessionImporter({
			listSessions: () => sessionScanner.list(),
			readSessionName: (filePath) => sessionScanner.inferSessionNameFromFile(filePath),
			readDirectoryShape: async (dir) => {
				const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
				return {
					hasJsonl: entries.some((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".jsonl")),

					hasEncodedGroups: entries.some((entry) => entry.isDirectory() && /^--.*--$/.test(entry.name.trim())),
				};
			},
			listKnownFilePaths: () =>
				new Set(
					sessionCatalog
						.listEntries()
						.filter((entry) => Boolean(entry.filePath))
						.map((entry) => normalizeSessionPathKey(entry.filePath!)),
				),

			mergeScanned: (projectId, summaries, options) => sessionCatalog.mergeScanned(projectId, summaries, undefined, options),

			pathExists: async (path) => {
				try {
					await stat(path);
					return true;
				} catch {
					return false;
				}
			},

			readSessionRoots: () => sessionScanner.getSessionScanRoots(),
			onError: (sourcePath, error) => {
				void appLogger?.warn("session", "Directory session import failed", {
					sourcePath,
					error: error instanceof Error ? error.message : String(error),
				});
			},
		});
		settingsStore = new SettingsStore();

		quitCleanup.register("settings-flush", () => settingsStore.flushPendingSave());

		securityStore = new SecurityStore({
			settingsStore,
			log: (domain, message, details) => void appLogger?.info(domain, message, details),
		});
		appLogger = new AppLogger();
		setAppLogger(appLogger);

		void appLogger.info("app", "Cold start milestone: app ready", {
			sinceModuleLoadMs: Date.now() - bootAnchorMs,
			processUptimeMs: Math.round(process.uptime() * 1000),
		});

		for (const result of [userDataNameMigrationResult, ...devDirectoryMigration.migrations]) {
			if (result?.kind === "migrated") {
				void appLogger.info("migration", "userData directory renamed to PiDeck", { from: result.oldPath, to: result.userDataPath, sessionDirs: result.migratedSessionDirs.length });
			} else if (result?.kind === "failed") {
				void appLogger.warn("migration", "userData migration incomplete; retry next launch", { userDataPath: result.userDataPath, reason: result.reason });
			} else if (result?.kind === "skipped" && result.reason === "collision") {
				void appLogger.warn("migration", "Legacy and PiDeck directories coexist; preserving both without merging", { userDataPath: result.userDataPath });
			}
		}
		rpcLogger = new RpcLogger();

		usageStatsService = new UsageStatsService({
			agentDir: join(app.getPath("home"), ".pi", "agent"),
			logger: {
				info: (message) => void appLogger?.info("usage-stats", message),
				warn: (message) => void appLogger?.warn("usage-stats", message),
			},
		});
		gitService = new GitService();
		gitRefsWatcher = new GitRefsWatcher({ logger: appLogger });

		quitCleanup.register("git-refs-watcher", () => gitRefsWatcher.disposeAll());
		worktreeService = new WorktreeService(mainCopy);
		piLocator = new PiLocator(mainCopy);
		registerQoderProviderIpc({
			setup: (input) =>
				setupQoderProvider(
					{
						piLocator,
						getSettings: () => settingsStore.get(),
						logger: appLogger,

						afterLogin: async (models) => {
							invalidateModelListCache();
							const snapshot = await piModelCapabilityCache?.refresh({ loadExtensions: true });
							const snapshotHasQoder = qoderModelsFromCatalog(snapshot?.models).length > 0;
							// 登录流程已经拿到模型；capability probe 可能因扩展冷启动慢或空快照而没带上
							// Qoder，此时把 CLI 结果（拿不到就用登录结果）直接发布进快照，避免模型选择器继续显示「没有可用模型」。
							if (!snapshotHasQoder) {
								const cliModels = await refreshModelList(piLocator, settingsStore, configManager).catch(() => []);
								piModelCapabilityCache?.publishModels(cliModels.length > 0 ? cliModels : models);
								void appLogger.info("qoder-provider", "Qoder model snapshot reconciled after login", {
									snapshotModels: snapshot?.models.length ?? 0,
									cliModels: cliModels.length,
									loginModels: models.length,
								});
							}
						},
					},
					input,
				),
			status: () =>
				getQoderProviderStatus({
					readAuth: () => configManager.getAuthConfig(),
					models: () => qoderModelsFromCatalog(piModelCapabilityCache?.getSnapshot()?.models),
				}),
		});

		piAuthService = new PiAuthService({
			resolveLaunch: () =>
				resolvePiAuthHostLaunch({
					settings: settingsStore.get(),
					locator: piLocator as PiLocator,
					userDataPath: app.getPath("userData"),
					appPath: app.getAppPath(),
					resourcesPath: process.resourcesPath,
					isPackaged: app.isPackaged,
				}),
			logger: {
				debug: (message) => void appLogger?.debug("pi-auth", message),
				info: (message) => void appLogger?.info("pi-auth", message),
				warn: (message) => void appLogger?.warn("pi-auth", message),
				error: (message) => void appLogger?.error("pi-auth", message),
			},
		});

		piAuthService.setFlowSink((update) => {
			if (!mainWindow || mainWindow.isDestroyed()) return;
			mainWindow.webContents.send(ipcChannels.piAuthFlowUpdate, update);
		});

		quitCleanup.register("pi-auth", () => piAuthService?.dispose());

		enhancePromptService = createCompletionHelperService("enhance");

		quitCleanup.register("enhance-prompt", () => enhancePromptService?.dispose());

		promptSuggestionService = createCompletionHelperService("suggest");
		quitCleanup.register("prompt-suggestion", () => promptSuggestionService?.dispose());
		configManager = new ConfigManager(undefined, mainCopy);

		configBackupManager = new ConfigBackupManager({
			getConfigDir: () => configManager.getConfigDir(),
			getUserDataDir: () => app.getPath("userData"),
			getAppVersion: () => app.getVersion(),
			onError: (message, detail) => void appLogger?.warn("backup", message, { detail }),
		});
		promptManager = new PromptManager(undefined, mainCopy);

		promptManager.configureSettings(
			() => settingsStore.get(),
			(patch) => settingsStore.update(patch),
		);

		promptManager.configureNativeToggle(async (templatePath, enabled) => {
			const service = piResourceConfigService;
			if (!service) return { ok: false, error: "pi resource service unavailable" };
			const saved = await service.setFileResourceEnabled({ scope: { scope: "global" }, kind: "prompts", resourceId: templatePath, enabled });
			if (saved.ok) await refreshPromptProjection();
			return saved;
		});
		promptManager.configureNativeEnabledReader((templatePath) => {
			const entries = promptManagerNativeEntries;
			if (!entries) return undefined;
			return projectResourceEnabled({ entries, value: templatePath, baseDir: dirname(templatePath) });
		});

		promptManager.configureNativeProjectToggle(async (projectId, templatePath, enabled) => {
			const service = piResourceConfigService;
			if (!service) return { ok: false, error: "pi resource service unavailable" };
			return service.setFileResourceEnabled({ scope: { scope: "project", projectId }, kind: "prompts", resourceId: templatePath, enabled });
		});
		promptManager.configureNativeProjectEntriesReader(async (projectId) => {
			const project = projectStore.get(projectId);
			if (!project) return null;
			try {
				const file = await readPiConfigFile(join(project.path, ".pi", "settings.json"));
				const value = file.data.prompts;
				return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
			} catch {
				return null;
			}
		});

		const promptStoreUpdater = new PromptStoreUpdater({
			userDataDir: app.getPath("userData"),

			builtinPromptsDir: app.isPackaged ? join(process.resourcesPath, "prompts") : join(app.getAppPath(), "resources", "prompts"),

			source: () => settingsStore.get().updateSource,
		});
		const skillStoreUpdater = new SkillStoreUpdater({
			userDataDir: app.getPath("userData"),

			builtinSkillsDir: app.isPackaged ? join(process.resourcesPath, "skills") : join(app.getAppPath(), "resources", "skills"),
			source: () => settingsStore.get().updateSource,
		});
		registerContentStoreIpc(promptStoreUpdater, PROMPTS_STORE_CHANNELS);
		registerContentStoreIpc(skillStoreUpdater, SKILLS_STORE_CHANNELS);

		xuePromptDbStore = new XuePromptDbStore({
			userDataDir: app.getPath("userData"),
			repoResourceDir: () => (app.isPackaged ? null : join(app.getAppPath(), "resources")),
			log: (domain, message, details) => void appLogger.info(domain, message, details),
			onStateChange: (state) => {
				const win = mainWindow;
				if (win && !win.isDestroyed()) win.webContents.send(ipcChannels.yaoPromptsDbState, state);
			},
		});
		xueIndexService = new XueIndexService({
			resolveBinaryPath: () => {
				const dir = app.isPackaged ? join(process.resourcesPath, "xue-index") : join(app.getAppPath(), "resources", "xue-index", "bin");
				const name = process.platform === "win32" ? "xue-index.exe" : "xue-index";
				const path = join(dir, name);
				return existsSync(path) ? path : null;
			},
			logger: {
				debug: (m) => appLogger.debug("xue-index", m),
				info: (m) => void appLogger.info("xue-index", m),
				warn: (m) => void appLogger.warn("xue-index", m),
				error: (m) => void appLogger.error("xue-index", m),
			},
		});
		xuePromptManager = new XuePromptManager(
			undefined,

			() => promptStoreUpdater.resolveEffectiveOverlayDir(),
			{ dbStore: xuePromptDbStore, xueIndex: xueIndexService },
		);

		quitCleanup.register("xue-index", () => {
			xueIndexService?.dispose();
			xueIndexService = null;
			xuePromptDbStore?.dispose();
			xuePromptDbStore = null;
		});

		sessionIndexService = new SessionIndexService({
			corpusDir: join(app.getPath("userData"), "session-index"),
			resolveBinaryPath: () => {
				const dir = app.isPackaged ? join(process.resourcesPath, "session-index") : join(app.getAppPath(), "resources", "session-index", "bin");
				const name = process.platform === "win32" ? "session-index.exe" : "session-index";
				const path = join(dir, name);
				return existsSync(path) ? path : null;
			},
			logger: {
				debug: (m) => appLogger.debug("session-index", m),
				info: (m) => void appLogger.info("session-index", m),
				warn: (m) => void appLogger.warn("session-index", m),
				error: (m) => void appLogger.error("session-index", m),
			},
		});
		quitCleanup.register("session-index", () => {
			sessionIndexService?.dispose();
			sessionIndexService = null;
		});

		fileIndexService = new FileIndexService({
			resolveBinaryPath: () => {
				const dir = app.isPackaged ? join(process.resourcesPath, "file-index") : join(app.getAppPath(), "resources", "file-index", "bin");
				const name = process.platform === "win32" ? "file-index.exe" : "file-index";
				const path = join(dir, name);
				return existsSync(path) ? path : null;
			},
			logger: {
				debug: (m) => appLogger.debug("file-index", m),
				info: (m) => void appLogger.info("file-index", m),
				warn: (m) => void appLogger.warn("file-index", m),
				error: (m) => void appLogger.error("file-index", m),
			},
		});
		quitCleanup.register("file-index", () => {
			fileIndexService?.dispose();
			fileIndexService = null;
		});

		sessionStoreService = new SessionStoreService({
			statePath: join(app.getPath("userData"), "session-store", "state.bin"),

			tablesDir: join(app.getPath("userData"), "session-store", "tables"),
			resolveBinaryPath: () => {
				const dir = app.isPackaged ? join(process.resourcesPath, "session-store") : join(app.getAppPath(), "resources", "session-store", "bin");
				const name = process.platform === "win32" ? "session-store.exe" : "session-store";
				const path = join(dir, name);
				return existsSync(path) ? path : null;
			},
			logger: {
				debug: (m) => appLogger.debug("session-store", m),
				info: (m) => void appLogger.info("session-store", m),
				warn: (m) => void appLogger.warn("session-store", m),
				error: (m) => void appLogger.error("session-store", m),
			},
		});
		quitCleanup.register("session-store", () => {
			sessionStoreService?.dispose();
			sessionStoreService = null;
		});

		if (settingsStore.get().sessionStoreEnabled) sessionStoreService.warmup();

		setTimeout(() => {
			void sessionScanner
				.resolveContentSearchRoots(projectPathsForContentSearch())
				.then((roots) => sessionIndexService?.warmup(roots))
				.catch(() => {});
		}, 5_000);
		skillManager = new SkillManager(undefined, mainCopy);

		skillManager.configureSkillOverlay(() => skillStoreUpdater.resolveEffectiveOverlayDir());

		skillManager.configureSettings(
			() => settingsStore.get(),
			(patch) => settingsStore.update(patch),
		);

		skillManager.configureNativeToggle(async (skillPath, enabled) => {
			const service = piResourceConfigService;
			if (!service) return { ok: false, error: "pi resource service unavailable" };

			const saved = await service.setFileResourceEnabled({ scope: { scope: "global" }, kind: "skills", resourceId: skillPath, enabled });
			if (saved.ok) await refreshSkillProjection();
			return saved;
		});

		skillManager.configureNativeEnabledReader((skillPath) => {
			const entries = skillManagerNativeEntries;
			if (!entries) return undefined;
			return projectResourceEnabled({ entries, value: skillPath, baseDir: dirname(skillPath) });
		});

		void skillManager.installUsageProbeTemplate().then((result) => {
			if (result.success) {
				void appLogger?.info("skill", "Usage probe skill template auto-installed", { path: result.path });
			} else {
				void appLogger?.warn("skill", "Usage probe skill template auto-install failed", { error: result.error });
			}
		});

		void skillManager.installImageGenTemplate().then((result) => {
			if (result.success) {
				void appLogger?.info("skill", "Image-gen skill template auto-installed", { path: result.path });
			} else {
				void appLogger?.warn("skill", "Image-gen skill template auto-install failed", { error: result.error });
			}
		});

		void skillManager.installSkillAuthorTemplate().then((result) => {
			if (result.success) void appLogger?.info("skill", "Skill-author skill template auto-installed", { path: result.path });
			else void appLogger?.warn("skill", "Skill-author skill template auto-install failed", { error: result.error });
		});
		void skillManager.installMcpAuthorTemplate().then((result) => {
			if (result.success) void appLogger?.info("skill", "MCP-author skill template auto-installed", { path: result.path });
			else void appLogger?.warn("skill", "MCP-author skill template auto-install failed", { error: result.error });
		});

		void skillManager.installPideckDoctorTemplate().then((result) => {
			if (result.success) {
				void appLogger?.info("skill", "Pideck-doctor skill template auto-installed", { path: result.path });
			} else {
				void appLogger?.warn("skill", "Pideck-doctor skill template auto-install failed", { error: result.error });
			}
		});
		extensionManager = new ExtensionManager(
			piLocator,
			() => settingsStore.get(),
			() => settingsStore.get(),
			(patch) => settingsStore.update(patch),
			mainCopy,

			resolveBuiltInExtensionRoots(),
		);

		extensionManager.configureNativeToggle(async ({ source, path, scope, projectId, enabled }) => {
			const service = piResourceConfigService;
			if (!service) return { ok: false, error: "pi resource service unavailable" };
			let target: PiResourceScope;
			if (scope === "project") {
				if (!projectId) return { ok: false, error: "Project scope requires a project id." };
				target = { scope: "project", projectId };
			} else {
				target = { scope: "global" };
			}
			const saved = await service.setExtensionEnabled({ scope: target, source, path, enabled });
			if (saved.ok) await refreshExtensionProjection();
			return saved;
		});
		extensionManager.configureNativeEnabledReader((extension) => {
			const entries = extensionManagerNativeEntries;
			if (!entries) return undefined;

			const enabled = projectExtensionEnabled({ source: extension.source, path: extension.path, entries, packages: extensionManagerNativePackages });
			if (enabled === undefined) return undefined;

			const filtered = projectExtensionFiltered({ source: extension.source, packages: extensionManagerNativePackages });
			return filtered === undefined ? { enabled } : { enabled, filtered };
		});

		const projectNativeRules = {
			setResourceEnabled: async (projectId: string, kind: "extensions" | "skills" | "prompts", value: string, enabled: boolean) => {
				const service = piResourceConfigService;
				if (!service) return { ok: false, error: "pi resource service unavailable" };
				return service.setFileResourceEnabled({ scope: { scope: "project", projectId }, kind, resourceId: value, enabled });
			},
			setInheritedOverride: async (projectId: string, kind: "extensions" | "skills" | "prompts", value: string, state: "inherit" | "enabled" | "disabled") => {
				const service = piResourceConfigService;
				if (!service) return { ok: false, error: "pi resource service unavailable" };
				return service.setProjectInheritedOverride({ projectId, kind, value, state });
			},
			readEntries: async (projectId: string, kind: "extensions" | "skills" | "prompts") => {
				try {
					const project = projectStore.get(projectId);
					if (!project) return null;
					const file = await readPiConfigFile(join(project.path, ".pi", "settings.json"));
					const value = file.data[kind];
					return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
				} catch {
					return null;
				}
			},
		};
		projectResourceManager = new ProjectResourceManager(
			(projectId) => projectStore.get(projectId),
			mainCopy,
			(project) => {
				const settings = settingsStore.get();
				if (process.platform === "win32" && project.environment === "wsl" && settings.wslEnabled && settings.wslDistro) {
					try {
						return toWindowsHostPath(project.path, { distro: settings.wslDistro });
					} catch {
						return project.path;
					}
				}
				return project.path;
			},
			{
				getProjectTrustDecision: async (project) => {
					const settings = settingsStore.get();
					const cwd = process.platform === "win32" && project.environment === "wsl" && settings.wslEnabled && settings.wslDistro ? toWslLinuxPath(project.path, { distro: settings.wslDistro }) : project.path;
					return configManager.getProjectTrustDecision(cwd);
				},
				getGlobalDisabledResourceNames: () => {
					const settings = settingsStore.get();
					return { skills: settings.disabledSkills, prompts: settings.disabledPrompts };
				},
			},
			projectNativeRules,
		);
		resourceImportManager = new ResourceImportManager(
			configManager,
			skillManager,
			projectResourceManager,
			(id) => projectStore.get(id),
			async (_id, root) => (await configManager.getProjectTrustDecision(root)) === true,
			(report) => {
				void appLogger.info("resource-import", "Resource import completed", {
					kind: report.kind,
					imported: report.imported,
					skipped: report.skipped,
					failed: report.failed,
				});
			},
		);
		agentManager = new AgentManager(
			(id) => projectStore.get(id),
			() => mainWindow,
			settingsStore,
			configManager,
			rpcLogger,
			appLogger,
			undefined,
			mainCopy,

			() => {
				void piModelCapabilityCache
					?.ensure()
					.then((snapshot) => (snapshot ? undefined : refreshModelList(piLocator, settingsStore, configManager)))
					.catch(() => undefined);
			},
			securityStore,

			(filePath) => sessionScanner.repairCorruptSessionHeader(filePath),

			(key) => Boolean(key && feishuBridgeRef.current?.hasSessionBinding(key)),

			(agentId) => sessionRuntimeCoordinator.getSessionId(agentId),

			(sessionKey) => {
				if (!sessionKey || !sessionCatalog) return undefined;
				const entry = sessionCatalog.get(sessionKey);
				if (!entry) return undefined;
				const sessionMode = entry.proxy?.mode;
				const provider = entry.model?.provider;
				const modelId = entry.model?.modelId;
				const { piProxyProviders, piProxyModels } = settingsStore.get();
				return resolveEffectiveSessionProxyMode(sessionMode, provider, modelId, piProxyProviders, piProxyModels);
			},

			async (provider, modelId) => {
				try {
					const snapshot = await piModelCapabilityCache?.ensure();
					const models = snapshot && snapshot.models.length > 0 ? snapshot.models : await fetchModelList(piLocator, settingsStore, configManager);
					return models.some((m) => m.provider === provider && m.id === modelId);
				} catch {
					return false;
				}
			},

			async () => {
				try {
					const list = await extensionManager?.list(false);
					if (!list) return [];
					return detectThirdPartyMcpExtensions(list.extensions).map((hit) => ({
						source: hit.source,
						scope: hit.scope,
						enabled: hit.enabled,
						uninstallCommand: hit.uninstallCommand,
						isLocalFile: hit.isLocalFile,
					}));
				} catch {
					return [];
				}
			},
		);

		quitCleanup.register("pi-agents", () => agentManager?.stopAll());

		agentManager.setSessionStoreIndexReader(async (hostPath) => {
			if (!settingsStore.get().sessionStoreEnabled) return null;
			const service = sessionStoreService;
			if (!service || !service.isReady()) return null;
			const result = await service.getIndex(hostPath);
			return result.ok ? result.value : null;
		});

		const ensureMiniOverlayWindow = (): MiniOverlayWindow => {
			miniOverlayWindow ??= new MiniOverlayWindow({
				settingsStore,
				agentManager,
				projectStore,
				onJumpToSession: (sessionId, projectId) => {
					focusMainWindow();
					queueFocusTarget({ sessionId, projectId });
					mainWindow?.webContents.once("did-finish-load", () => {
						flushPendingFocusTargetOnLoad();
					});
				},
				onQuickPrompt: async (projectId, text) => {
					const draft = await sessionCatalog.createDraft({ projectId, title: text.slice(0, 40), environment: "native", backend: agentManager.backend });
					const runtime = await sessionRuntimeCoordinator.activateRuntime(draft.id);
					if (!runtime.ok) return { ok: false, message: runtime.error.code };
					const result = await agentManager.sendPrompt({ agentId: runtime.value.agentId, message: text });
					if (!result.accepted) return { ok: false, message: result.error };
					return { ok: true };
				},
				onExit: () => {
					settingsStore.update({ floatingBallEnabled: false });
					floatingController?.hide();
					focusMainWindow();
				},
				onCollapse: () => {
					if (settingsStore.get().floatingBallEnabled) {
						void floatingController?.show();
					}
				},
				onSwitchToQuickTask: async (projectPath) => {
					floatingController?.hide();
					await quickTaskChrome.controller.open(projectPath ?? app.getPath("desktop"));
				},
			});
			return miniOverlayWindow;
		};
		async function expandMiniOverlay(): Promise<void> {
			floatingController?.hide();
			await ensureMiniOverlayWindow().show();
		}

		floatingController = new FloatingController({
			settingsStore,
			getMainWindow: () => mainWindow,
			onExpandMini: expandMiniOverlay,
			onExpandCompact: async () => {
				floatingController?.hide();

				if (mainWindow && !mainWindow.isDestroyed()) {
					mainWindow.hide();
				}
				await quickTaskChrome.controller.open(app.getPath("desktop"));
			},
			onShowMainWindow: () => {
				if (mainWindow && !mainWindow.isDestroyed()) {
					mainWindow.show();
					mainWindow.focus();
				}
			},
			addAgentStateListener: (listener) => agentManager.addStateListener(listener),
			getActiveAgentCount: () => agentManager.list().filter((t) => t.status !== "closed").length,
			getRunningAgentCount: () => agentManager.list().filter((t) => t.status === "running").length,
			getRecentRunningTitles: () =>
				agentManager
					.list()
					.filter((t) => t.status === "running")
					.map((t) => t.title)
					.filter(Boolean)
					.slice(0, 3) as string[],
		});
		quitCleanup.register("floating-ball", () => floatingController?.destroy());
		quitCleanup.register("mini-overlay", () => miniOverlayWindow?.destroy());
		registerFloatingIpc(floatingController);

		registerQuickTaskIpc(quickTaskChrome.controller, {
			onSwitchToMiniOverlay: async () => {
				if (mainWindow && !mainWindow.isDestroyed()) mainWindow.hide();
				await expandMiniOverlay();
			},
		});

		if (settingsStore.get().floatingBallEnabled) {
			void floatingController.show();
		}

		quitCleanup.register("rpc-logs-flush", () => rpcLogger?.flushPending());

		quitCleanup.register("model-trace", () => stopModelTraceServer());

		diagnosticsMonitor = new DiagnosticsMonitor({
			logger: appLogger,
			streamingProbe: () => agentManager.hasActiveStreaming(),
		});
		agentManager.setDiagnosticsSink((name, startedAt, detail) => {
			diagnosticsMonitor?.recordTiming(name, startedAt, detail);
		});
		quitCleanup.register("diagnostics-monitor", () => diagnosticsMonitor?.stop());

		environmentDoctor = new EnvironmentDoctor({
			appLogger,
			piLocator,
			settingsStore,
			configManager,
		});
		logBundleExporter = new LogBundleExporter({ appLogger });
		webServiceManager = new WebServiceManager({
			persistToken: (state) => {
				void settingsStore.update({ webServiceToken: state.token, webServiceTokenGeneratedAt: state.generatedAt, webServiceTokenExpiresIn: state.expiresIn }).catch((error) => appLogger.error("[WebService] persist token failed", error));
			},

			devRendererUrl: shouldUseDevRendererUrl() ? process.env.ELECTRON_RENDERER_URL : undefined,

			subscribePiEvents: (handler) => agentManager.addLocalEventListener((agentId, event) => handler(agentId, event as never)),

			getSessionIdForAgent: (agentId) => sessionRuntimeCoordinator.getSessionId(agentId),
			listProjects: () => projectStore.list(),
			createProject: (path) => projectStore.add(path, undefined, settingsStore.get().wslEnabled ? "wsl" : "windows"),
			deleteProject: async (projectId) => {
				if (!projectStore.get(projectId) || projectStore.get(projectId)?.kind === "chat") return false;
				const childIds = projectStore.listWorktreeChildren(projectId).map((child) => child.id);
				await projectStore.remove(projectId);
				for (const id of [projectId, ...childIds]) {
					await sessionCatalog.removeByProjectId(id).catch(() => 0);
				}
				return true;
			},
			listModels: async (force?: boolean) => {
				const snapshot = force ? await piModelCapabilityCache?.refresh() : await piModelCapabilityCache?.ensure();
				return snapshot?.models ?? (force ? refreshModelList(piLocator, settingsStore, configManager) : fetchModelList(piLocator, settingsStore, configManager));
			},
			listSessions: (projectId) => {
				const project = projectStore.get(projectId);
				return sessionScanner.list(project?.path);
			},
			listCatalogSessions: async (projectId) => {
				if (!projectId) {
					return sessionCatalog
						.listEntries()
						.map((entry) => sessionCatalog.getRecord(entry.id))
						.filter((record): record is SessionRecord => Boolean(record) && !record?.supersededBy);
				}
				const project = projectStore.get(projectId);
				if (!project) throw new Error(mainCopy("project.notFound"));
				let projectPath = project.path;
				const settings = settingsStore.get();
				if (settings.wslEnabled && settings.wslDistro) {
					projectPath = projectPath.replace(/^([A-Za-z]):\\/, (_: string, drive: string) => `/mnt/${drive.toLowerCase()}/`).replace(/\\/g, "/");
				}
				const summaries = await sessionScanner.list(projectPath);
				const { wslEnabled, wslDistro, wslUser } = settings;
				const scanned = await sessionCatalog.mergeScanned(projectId, summaries, wslEnabled ? { wslDistro, wslUser } : {});

				const records = scanned.filter((record) => !record.supersededBy);
				const bindings = sessionRuntimeCoordinator.attachCatalogRuntimes(records);
				for (const binding of bindings) {
					const tab = agentManager.list().find((candidate) => candidate.id === binding.agentId);
					if (tab) emitSessionRuntimeEvent(tab.id, ipcChannels.agentsState, tab);
				}
				return records;
			},
			createSessionDraft: async (input) => {
				const project = projectStore.get(input.projectId);
				if (!project) throw new Error(mainCopy("project.notFound"));
				const draft = await sessionCatalog.createDraft({
					projectId: input.projectId,
					title: input.title?.trim() || mainCopy("session.newTitle"),
					environment: settingsStore.get().wslEnabled ? "wsl" : "native",
					model: input.model ? createSessionModelPreference(input.model.provider, input.model.modelId, input.model.modelName) : undefined,
					thinkingLevel: input.thinkingLevel,
				});

				agentManager.ensureStandbyAgent(draft.projectId);
				return draft;
			},
			createAnonymousSession,
			updateSessionRecord: async (sessionId, patch) => {
				const entry = sessionCatalog.get(sessionId);
				if (!entry) throw new Error(mainCopy("session.notFound"));
				const title = patch.title?.trim();
				if (title && title !== entry.title) {
					await sessionCatalog.claimTitleOwnership(sessionId);
					const target = sessionRuntimeCoordinator.getTarget(sessionId);
					if (target) {
						const renamed = await sessionRuntimeCoordinator.renameRuntime(target, title);
						if (!renamed.ok) throw sessionCommandIpcError(renamed.error);
					} else if (entry.filePath) {
						await sessionScanner.rename(entry.filePath, title);
					}
				}
				return sessionCatalog.update(sessionId, {
					...patch,
					...(patch.model ? { model: createSessionModelPreference(patch.model.provider, patch.model.modelId, patch.model.modelName) } : {}),
					title: title || undefined,
				});
			},
			deleteSessionRecord: async (sessionId) => {
				const entry = sessionCatalog.get(sessionId);
				if (!entry) return false;

				await sessionRuntimeCoordinator.releaseRuntimeForDelete(sessionId);

				wechatServiceRef.current?.removeBindingsForSession(sessionId);
				if (entry.filePath) await sessionScanner.delete(entry.filePath);
				await sessionCatalog.removeWithDescendants(sessionId);
				return true;
			},
			copySessionRecord: (sessionId) => copyCatalogSession(sessionId),
			exportSessionRecordHtml: (sessionId) => exportCatalogSessionHtml(sessionId),
			readSessionReferenceMessages: (sessionId) => readCatalogSessionReferenceMessages(sessionId),
			readSessionMessages: async (sessionId) => {
				const entry = sessionCatalog.get(sessionId);
				if (!entry?.filePath) return { messages: [], total: 0, windowStart: 0, truncated: false };

				const window = await agentManager.readSessionLoadWindow(entry.filePath, sessionId, { projectId: entry.projectId });
				return { ...window, truncated: window.windowStart > 0 };
			},
			readSessionMessagePage: async (sessionId, before, pageSize) => {
				const entry = sessionCatalog.get(sessionId);
				if (!entry?.filePath) return { messages: [], total: 0, nextBefore: null };
				return agentManager.readSessionDisplayTurnPage(entry.filePath, sessionId, before, pageSize, undefined, { projectId: entry.projectId });
			},

			searchSessionMessages: async (sessionId, query) => {
				const entry = sessionCatalog.get(sessionId);
				if (!entry?.filePath) return null;
				return sessionMessageSearchInFile(entry.filePath, query);
			},

			fetchProviderUsage: (provider, backend) => configManager.fetchProviderUsage(provider, backend),
			sendSessionPrompt: async (input) => {
				const result = await sessionRuntimeCoordinator.send(input);
				if (result.agentId) {
					const tab = agentManager.list().find((candidate) => candidate.id === result.agentId);
					if (tab) emitSessionRuntimeEvent(tab.id, ipcChannels.agentsState, tab);
				}
				return result;
			},
			listSessionRuntimes: () => sessionRuntimeCoordinator.listRuntimes(),
			listPendingUiRequests: () => sessionRuntimeCoordinator.listPendingUiRequests(),
			respondToUi: (input) => sessionRuntimeCoordinator.respondToUi(input),
			listSessionRuntimeModels: (target) => sessionRuntimeCoordinator.listRuntimeModels(target),
			stopSessionRuntime: stopSessionRuntime,
			abortSessionRuntime: (target) => sessionRuntimeCoordinator.abortRuntime(target),
			restartSessionRuntime: async (target) => {
				terminalManager.closeAgent(target.agentId);
				const result = await sessionRuntimeCoordinator.restartRuntime(target);
				if (result.ok) {
					if (!result.value.session.noSession) emitSessionRuntimeDetach(target);

					emitReplacementState(result.value.runtime, true);
				}
				return result;
			},
			compactSessionRuntime: (target, prompt) => sessionRuntimeCoordinator.compactRuntime(target, prompt),
			getSessionRuntimeState: (target) => sessionRuntimeCoordinator.getRuntimeState(target),
			listSessionRuntimeCommands: (target) => sessionRuntimeCoordinator.listRuntimeCommands(target),
			exportSessionRuntimeHtml: (target) => sessionRuntimeCoordinator.exportRuntimeHtml(target),
			editSessionRuntimeMessage: (target, messageId, newText) => sessionRuntimeCoordinator.editRuntimeMessage(target, messageId, newText),
			deleteSessionRuntimeMessage: (target, messageId) => sessionRuntimeCoordinator.deleteRuntimeMessage(target, messageId),
			listRewindCheckpoints: (target, params) => sessionRuntimeCoordinator.listRewindCheckpoints(target, params),
			getRewindCheckpointDiff: (target, checkpointId) => sessionRuntimeCoordinator.getRewindCheckpointDiff(target, checkpointId),
			restoreRewindCheckpoint: (target, checkpointId, scope) => sessionRuntimeCoordinator.restoreRewindCheckpoint(target, checkpointId, scope),
			prepareSessionRuntimeResend: (target, messageId) => sessionRuntimeCoordinator.prepareRuntimeResend(target, messageId),
			setSessionRuntimeModel: (target, provider, modelId, modelName) => sessionRuntimeCoordinator.setRuntimeModel(target, provider, modelId, modelName),
			setSessionRuntimeThinking: (target, level) => sessionRuntimeCoordinator.setRuntimeThinking(target, level),

			cloneSessionRuntime: (target) => sessionForkCommands.cloneRuntimeSession(target),
			getForkMessages: (target) => sessionRuntimeCoordinator.getRuntimeForkMessages(target),
			forkRuntimeSession: (target, entryId, options) => sessionForkCommands.forkRuntimeSession(target, entryId, options),

			activateSessionRuntime: (sessionId) => sessionRuntimeCoordinator.activateRuntime(sessionId),

			listSessionSubagents: async (sessionId) => {
				const entry = sessionCatalog.get(sessionId);
				if (!entry?.filePath) return [];

				const liveTarget = sessionRuntimeCoordinator.getTarget(sessionId);
				const liveTab = liveTarget ? agentManager.list().find((tab) => tab.id === liveTarget.agentId) : undefined;
				let records = await agentManager.readSessionSubagentRecords(entry.filePath, { liveRuntimeStartedAt: liveTab?.createdAt });

				if (!liveTarget) {
					if (!sessionRuntimeCoordinator.isActivating(sessionId)) {
						records = downgradeStaleRunning(records);
					}
				} else {
					if (liveTab?.createdAt) {
						records = downgradeRunningStartedBefore(records, liveTab.createdAt);
					}
				}
				return records;
			},
			listSessionTodo: (sessionId) => {
				const entry = sessionCatalog.get(sessionId);

				if (!entry?.filePath || entry.backend === "imagegen") return Promise.resolve(undefined);
				return agentManager.readSessionTodo(entry.filePath);
			},
		});

		webServiceManager.workspaceRoutes = new WebWorkspaceRoutes({
			listProjects: () => projectStore.list(),
			git: {
				isGitRepo: (cwd) => gitService.isGitRepo(cwd),
				getBranches: (cwd) => gitService.getBranches(cwd),
				getStatus: (cwd) => gitService.getStatus(cwd),
				getWorkspaceFileDiff: (cwd, group, filePath, maxBytes) => gitService.getWorkspaceFileDiff(cwd, group, filePath, maxBytes),
				getCommitLog: (cwd, options) => gitService.getCommitLog(cwd, options),
			},
			files: {
				listTree: (root, maxDepth, directory) => fileSystemService.listTree(root, maxDepth, directory),
			},

			prompts: xuePromptManager
				? {
						list: (opts) => xuePromptManager.list(opts),
						detail: (slug, category) => xuePromptManager.detail(slug, category),
					}
				: undefined,

			assets: {
				listSkills: () => skillManager.list(),
				toggleSkill: (skillPath, enabled) => skillManager.toggle(skillPath, enabled),
				listExtensions: () => extensionManager.list(),
				setExtensionEnabled: (source, enabled, scope, path, projectId) => extensionManager.toggleFromUi(source, enabled, scope, path, projectId),
			},
		});

		quitCleanup.register("theme-schedule", () => clearThemeScheduleTimer());
		quitCleanup.register("update-check", () => updateService?.stop());
		quitCleanup.register("web-service", () => webServiceManager?.stop());

		remoteAccessManager = new RemoteAccessManager({
			logger: appLogger,
			getWebServiceStatus: () => webServiceManager.getStatus(),

			getTunnelOptions: () => {
				const s = settingsStore.get();
				return { protocol: s.webRemoteCloudflaredProtocol ?? "http2", extraArgs: s.webRemoteCloudflaredExtraArgs };
			},
			pushState: (state) => {
				const win = mainWindow;
				if (win && !win.isDestroyed()) win.webContents.send(ipcChannels.webRemoteAccessChanged, state);
			},
		});
		quitCleanup.register("web-remote-access", () => remoteAccessManager?.dispose());
		terminalManager = new TerminalSessionManager(
			(agentId) => {
				const tab = compositeAgentGateway?.list().find((candidate) => candidate.id === agentId);
				if (tab) return tab.cwd;

				return agentManager.getCwd(agentId);
			},
			(channel, payload) => mainWindow?.webContents.send(channel, payload),
			() => settingsStore.get(),
		);

		quitCleanup.register("terminal", () => terminalManager?.closeAll());

		await settingsStore.load();

		refreshShortcutBindings(settingsStore.get());

		applyWindowLogoStyle(settingsStore.get().logoStyle, () => mainWindow, settingsStore.get().logoCustomImage);

		setImmediate(() => {
			syncTaskbarShortcutIcon({ style: settingsStore.get().logoStyle, customLogoDataUrl: settingsStore.get().logoCustomImage });
		});
		piModelCapabilityCache = new PiModelCapabilityCache({
			createProcess: ({ loadExtensions }) =>
				new PiProcess(
					process.cwd(),
					{
						...settingsStore.get(),

						piRpcOffline: true,
						piRpcNoSkills: true,

						...(loadExtensions ? {} : { piRpcNoExtensions: true }),
					},
					piLocator,

					{ ...createPiProcessExtensionResolvers(process.cwd(), settingsStore.get()) },
				),
			getConfigDirectory: () => configManager.getConfigDir(),

			shouldLoadExtensions: () => hasQoderProviderAuth(configManager.getConfigDir()),
			watchDirectory: watchPiConfigDirectory,
			onWarning: (message, detail) => void appLogger.warn("pi-capabilities", message, detail),
		});
		quitCleanup.register("pi-model-capabilities", () => piModelCapabilityCache?.dispose());
		setFeishuConfigDefaultBotName(feishuT(currentFeishuLocale(), "bridge.defaultBotName"));
		const initialSessionSettings = settingsStore.get();
		sessionCatalog = new SessionCatalog(
			join(app.getPath("userData"), "session-catalog.json"),
			initialSessionSettings.wslEnabled ? { wslDistro: initialSessionSettings.wslDistro, wslUser: initialSessionSettings.wslUser } : {},

			(projectId, filePath, environment) => {
				const project = projectStore.get(projectId);
				if (!project) return filePath;
				return toAbsoluteSessionPath(filePath, project.path, environment);
			},

			(filePath, options) => sessionScanner.inferSessionNameAndValidity(filePath, options),
		);
		automationStore = new AutomationStore(join(app.getPath("userData"), "automation.json"));
		const automationStorePreload = automationStore.load();

		agentProfileStore = new AgentProfileStore(join(app.getPath("userData"), "agent-profiles.json"));
		const agentProfileStorePreload = agentProfileStore.load();

		quitCleanup.register("agent-profile-store", () => agentProfileStore?.flushPendingUsage());

		favoritesStore = new FavoritesStore(join(app.getPath("userData"), "favorites.json"));
		const favoritesStorePreload = favoritesStore.load();
		await Promise.all([sessionCatalog.load(), automationStorePreload, agentProfileStorePreload, favoritesStorePreload]);

		agentInvokeCompletionService = createCompletionHelperService("agent-invoke");

		quitCleanup.register("agent-invoke", () => agentInvokeCompletionService?.dispose());
		agentInvokeService = new AgentInvokeService({
			profiles: agentProfileStore,
			completion: agentInvokeCompletionService,
			logger: {
				warn: (message) => void appLogger.warn("agent-invoke", message),
				error: (message) => void appLogger.error("agent-invoke", message),
			},
		});

		const selectionToolPreloadPath = await prepareMainPreloadPath();
		selectionToolWindow = new SelectionToolWindow({
			preloadPath: selectionToolPreloadPath,
			logger: appLogger,
			devRendererUrl: process.env.ELECTRON_RENDERER_URL ?? null,
		});
		selectionToolService = new SelectionToolService({
			window: selectionToolWindow,
			logger: {
				info: (scope, message, detail) => void appLogger.info(scope, message, detail),
				warn: (scope, message, detail) => void appLogger.warn(scope, message, detail),
				error: (scope, message, detail) => void appLogger.error(scope, message, detail),
			},
			suppressClipboardWatcher: (durationMs) => selectionClipboardWatcher?.suppressFor(durationMs),
		});

		selectionClipboardWatcher = new ClipboardSelectionWatcher({
			readText: () => clipboard.readText(),
			isOwnWindowFocused: () => BrowserWindow.getAllWindows().some((win) => !win.isDestroyed() && win.isFocused()),
			onCaptured: (text) => {
				void selectionToolService?.showText(text);
			},
			logger: { warn: (message, detail) => void appLogger.warn("selection-tool", message, detail) },
		});

		windowsSelectionCapture = new WindowsSelectionCapture({
			onSelection: ({ text }) => {
				selectionClipboardWatcher?.suppressFor(2500);
				void selectionToolService?.showText(text);
			},
			logger: {
				info: (message, detail) => void appLogger.info("selection-tool", message, detail),
				warn: (message, detail) => void appLogger.warn("selection-tool", message, detail),
			},
		});

		quitCleanup.register("selection-tool", () => {
			selectionClipboardWatcher?.dispose();
			selectionClipboardWatcher = null;
			windowsSelectionCapture?.dispose();
			windowsSelectionCapture = null;
			selectionToolService?.dispose();
		});

		agentProfileStore.onChanged(() => syncSelectionToolShortcut());
		syncSelectionToolShortcut();

		app.on("browser-window-focus", () => {
			syncSelectionToolShortcut();
			flushSelectionShortcutConflictNotice();
		});

		await migrateMergedSessionPinnedIds({
			listCatalogSessions: () => sessionCatalog.listEntries(),
			readPinnedSessionIds: () => settingsStore.get().pinnedSessionIds,
			writePinnedSessionIds: (ids) => settingsStore.update({ pinnedSessionIds: ids }),
			logWarning: (cause) => void appLogger.warn("session-catalog", "Merged session id migration for pinned sessions failed", { cause }),
		});

		piResourceStateStore = new PiResourceStateStore(join(app.getPath("userData"), "pi-native-resources.json"));
		piResourceConfigService = new PiResourceConfigService(
			{
				globalSettingsPath: () => join(configManager.getConfigDir(), "settings.json"),
				resolveProject: async (projectId) => {
					const project = projectStore.get(projectId);
					if (!project || project.kind === "chat") return null;
					const root = project.path;
					const settings = settingsStore.get();
					const trustPath = process.platform === "win32" && project.environment === "wsl" && settings.wslEnabled && settings.wslDistro ? toWslLinuxPath(root, { distro: settings.wslDistro }) : root;
					return { root, trusted: (await configManager.getProjectTrustDecision(trustPath)) === true };
				},
			},
			piResourceStateStore,
			{ projectTrust: async (projectId, _root) => (await configManager.getProjectTrustDecision(projectStore.get(projectId)?.path ?? "")) === true },
		);

		const readNativeEntries = async (key: "skills" | "prompts" | "extensions"): Promise<string[] | null> => {
			try {
				const file = await readPiConfigFile(join(configManager.getConfigDir(), "settings.json"));
				const value = file.data[key];
				return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
			} catch {
				return null;
			}
		};
		const refreshSkillProjection = async (): Promise<void> => {
			skillManagerNativeEntries = await readNativeEntries("skills");
		};
		const refreshPromptProjection = async (): Promise<void> => {
			promptManagerNativeEntries = await readNativeEntries("prompts");
		};
		const refreshExtensionProjection = async (): Promise<void> => {
			try {
				const file = await readPiConfigFile(join(configManager.getConfigDir(), "settings.json"));
				const extensions = file.data.extensions;
				const packages = file.data.packages;
				extensionManagerNativeEntries = Array.isArray(extensions) ? extensions.filter((item): item is string => typeof item === "string") : [];
				extensionManagerNativePackages = Array.isArray(packages) ? [...packages] : [];
			} catch {
				extensionManagerNativeEntries = null;
				extensionManagerNativePackages = null;
			}
		};

		const migrationDeps: import("./config/piResourceMigrationRunner").MigrationRunnerDeps = {
			service: piResourceConfigService,
			state: piResourceStateStore,
			readSettings: () => settingsStore.get(),
			resolveGlobalResources: async () => {
				const settings = settingsStore.get();
				const resources: ResolvedMigrationResource[] = [];

				const extensionList = await extensionManager?.list(false).catch(() => null);
				for (const item of extensionList?.extensions ?? []) {
					if (!item.source || item.builtIn) continue;

					resources.push({ kind: "extensions", name: item.source, value: item.path ?? item.source, scope: item.scope === "project" ? "project" : "user", ...(isPackageSource(item.source) ? { packageSource: item.source } : {}) });
				}
				const skills = await skillManager?.list().catch(() => null);
				for (const skill of skills?.skills ?? []) {
					if (skill.sourceId !== "pi-global" && skill.sourceId !== "agents-global") continue;
					resources.push({ kind: "skills", name: skill.name, value: skill.path, scope: "user" });
				}
				const prompts = await promptManager?.list().catch(() => null);
				for (const template of prompts?.templates ?? []) {
					if (template.scope === "project") continue;
					resources.push({ kind: "prompts", name: template.name, value: template.path, scope: "user" });
				}
				return resources;
			},
			readProjectLegacyState: async (projectId) => projectResourceManager.readProjectLegacyDisables(projectId),
			resolveProjectResources: async (projectId) => {
				const project = projectStore.get(projectId);
				if (!project) return [];
				const resources: ResolvedMigrationResource[] = [];
				for (const skill of (await projectResourceManager.list(projectId).catch(() => null))?.skills ?? []) {
					if (typeof skill.path === "string") resources.push({ kind: "skills", name: skill.name, value: skill.path, scope: "project" });
				}
				return resources;
			},
			writeSettingsPatch: async (patch) => {
				await settingsStore.update(patch as Parameters<typeof settingsStore.update>[0]);
			},
			clearProjectLegacyState: async (projectId, patch) => {
				await projectResourceManager.clearProjectLegacyDisables(projectId, patch);
			},
			logger: { info: (scope, message, detail) => void appLogger.info(scope, message, detail), warn: (scope, message, detail) => void appLogger.warn(scope, message, detail) },
		};

		const packageRootRuleRepairDeps: PackageRootRuleRepairDeps = {
			service: {
				stripPackageRootResourceRules: async (scope, packageDirs) => {
					const service = piResourceConfigService;
					if (!service) return { ok: false, error: "pi resource service unavailable", removed: [] };
					return service.stripPackageRootResourceRules(scope, packageDirs);
				},
			},
			npmRoot: (scope) => {
				if (scope.scope === "project") {
					const project = projectStore.get(scope.projectId);
					return project ? join(project.path, ".pi", "npm", "node_modules") : "";
				}
				return join(configManager.getConfigDir(), "npm", "node_modules");
			},
			logger: { info: (scope, message, detail) => void appLogger.info(scope, message, detail), warn: (scope, message, detail) => void appLogger.warn(scope, message, detail) },
		};

		const refreshAllProjections = async (): Promise<void> => {
			await Promise.all([refreshSkillProjection(), refreshPromptProjection(), refreshExtensionProjection()]);
		};
		let globalMigrationRun: Promise<void> | null = null;
		const projectMigrationRuns = new Map<string, Promise<void>>();

		const ensureResourceMigration = async (projectId?: string): Promise<void> => {
			if (!projectId) {
				globalMigrationRun ??= runGlobalResourceMigration(migrationDeps).then(async (result) => {
					await runPackageRootRuleRepair(packageRootRuleRepairDeps, { scope: "global" });
					await refreshAllProjections();
					if (result.errors.length > 0) {
						void appLogger.warn("migration", "Global resource migration reported problems", { status: result.status, errors: result.errors });
					}
				});
				return globalMigrationRun;
			}
			let run = projectMigrationRuns.get(projectId);
			if (!run) {
				run = runProjectResourceMigration(migrationDeps, projectId).then(async (result) => {
					await runPackageRootRuleRepair(packageRootRuleRepairDeps, { scope: "project", projectId });
					await refreshAllProjections();
					if (result.errors.length > 0) {
						void appLogger.warn("migration", "Project resource migration reported problems", { projectId, status: result.status, errors: result.errors });
					}
				});
				projectMigrationRuns.set(projectId, run);
			}
			return run;
		};

		void ensureResourceMigration();
		ensurePiResourceMigration = ensureResourceMigration;
		agentManager.configureResourceMigrationGate(ensureResourceMigration);

		acpAgentManager = new AcpAgentManager({
			piLocator,
			getProject: (projectId) => projectStore.get(projectId),
			getTools: () => settingsStore.get().acpTools ?? [],
			isEnabled: () => settingsStore.get().acpEnabled === true,

			onConfigOptionsChanged: (tab, options) => {
				if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(ipcChannels.acpSessionConfigChanged, { agentId: tab.id, options });
			},

			imageStore: {
				put: (data, mimeType) => acpImageBlobStore?.put(data, mimeType) ?? Promise.resolve(null),
			},

			onTitleChanged: (deckSessionId, title) => {
				const entry = sessionCatalog?.get(deckSessionId);
				if (!entry || entry.title === title) return;

				void sessionCatalog
					.applyAgentTitle(deckSessionId, title)
					.then((applied) => {
						if (!applied) return;
						if (mainWindow && !mainWindow.isDestroyed()) {
							mainWindow.webContents.send(ipcChannels.sessionsCatalogRefreshed, { projectId: applied.projectId });
						}
					})
					.catch((error: unknown) => {
						void appLogger.warn("session", "ACP title sync to catalog failed", { deckSessionId, title, error: error instanceof Error ? error.message : String(error) });
					});
			},
			logger: appLogger,
		});
		quitCleanup.register("acp", async () => {
			await acpAgentManager?.stopAll();
		});
		compositeAgentGateway = new CompositeAgentGateway([agentManager, acpAgentManager]);
		sessionRuntimeCoordinator = new SessionRuntimeCoordinator(sessionCatalog, compositeAgentGateway, sendAgentPromptWithIntegrations, appLogger);

		sessionRuntimeCoordinator.setDetachedNotifier((binding) => emitSessionRuntimeDetach(binding));

		sessionCatalog.setSessionLivenessProbe((sessionId) => sessionRuntimeCoordinator?.hasLiveRuntime(sessionId) === true);

		automationRunCoordinator = new AutomationRunCoordinator({
			store: automationStore,
			catalog: sessionCatalog,
			sessionRuntimeCoordinator,
			projectStore,
			gitService,
			logger: appLogger,
			notifyRunFinished: (run, task) => {
				const settings = settingsStore.get();
				if (!settings.enableNotifications || !Notification.isSupported()) return;

				if (!shouldAlertNow(settings.alertOnlyWhenUnfocused, isMainWindowFocused(mainWindow))) return;
				const isSuccess = run.status === "succeeded";

				const appName = APP_DISPLAY_NAME;
				const body = isSuccess
					? mainCopy("mainNotification.automationDone", { name: task.name })
					: mainCopy("mainNotification.automationFailed", {
							name: task.name,
							error: run.error || run.status,
						});
				const notification = new Notification({
					title: appName,
					body,
					silent: false,

					toastXml: buildToastXml({
						title: appName,
						body,
						launch: notificationLaunchUrl(run.sessionId),
						logoUri: resolveNotificationLogoUri({ isPackaged: app.isPackaged, resourcesPath: process.resourcesPath, appPath: app.getAppPath() }),
					}),
				});
				notification.on("click", () => {
					focusMainWindow();
					if (run.sessionId) {
						queueFocusTarget({ sessionId: run.sessionId });
					}
				});
				notification.show();
			},

			notifySessionCatalogChanged: (projectId) => notifySessionCatalogRefreshed([projectId]),
		});
		automationScheduler = new AutomationScheduler(automationStore);
		automationScheduler.setTriggerHandler(async (task, scheduledFor, trigger) => {
			await automationRunCoordinator?.enqueueRun(task, scheduledFor, trigger);
		});
		automationScheduler.start();
		quitCleanup.register("automation", () => {
			automationScheduler?.stop();
			automationRunCoordinator?.dispose();
			automationScheduler = null;
			automationRunCoordinator = null;
		});

		idleAgentReleaser = new IdleAgentReleaser(
			sessionRuntimeCoordinator,
			compositeAgentGateway,
			() => settingsStore.get(),
			appLogger,
			undefined,

			(agentId, target) => {
				terminalManager.closeAgent(agentId);
				if (target) emitSessionRuntimeDetach(target);
			},
		);
		idleAgentReleaser.start();
		quitCleanup.register("idle-agent-releaser", () => idleAgentReleaser?.stop());

		staleDraftReaper = new StaleDraftReaper(
			sessionCatalog,
			sessionRuntimeCoordinator,
			(projectIds) => {
				if (!mainWindow || mainWindow.isDestroyed()) return;
				for (const projectId of projectIds) {
					mainWindow.webContents.send(ipcChannels.sessionsCatalogRefreshed, { projectId });
				}
			},
			appLogger,
		);
		staleDraftReaper.start();
		quitCleanup.register("stale-draft-reaper", () => staleDraftReaper?.stop());

		agentManager.setAutomaticTitleChangedHandler((agentId, rawTitle, source) => {
			const sessionId = sessionRuntimeCoordinator?.getSessionId(agentId);
			if (!sessionId) return;

			const title = sanitizeAutomaticTitle(rawTitle);
			if (!title) return;
			const entry = sessionCatalog.get(sessionId);

			if (!entry || (entry.title === title && entry.titleOrigin !== "fallback")) return;
			void sessionCatalog
				.applyAutomaticTitle(sessionId, title, source)
				.then(() => {
					if (mainWindow && !mainWindow.isDestroyed()) {
						mainWindow.webContents.send(ipcChannels.sessionsCatalogRefreshed, {
							projectId: entry.projectId,
						});
					}
				})
				.catch((error: unknown) => {
					void appLogger.warn("session", "Pi automatic title sync to catalog failed", {
						agentId,
						sessionId,
						title,
						error: error instanceof Error ? error.message : String(error),
					});
				});
		});
		compositeAgentGateway.onOutput((sourceChannel, payload) => {
			if (sourceChannel === ipcChannels.agentsState && Array.isArray(payload)) {
				for (const tab of payload) {
					if (tab && typeof tab === "object" && typeof tab.id === "string") {
						emitSessionRuntimeEvent(tab.id, sourceChannel, tab);
					}
				}
				return;
			}
			if (payload && typeof payload === "object" && "agentId" in payload) {
				const agentId = (payload as { agentId?: unknown }).agentId;
				if (typeof agentId !== "string") return;
				const forwarded = emitSessionRuntimeEvent(agentId, sourceChannel, payload);
				if (!forwarded && sourceChannel === ipcChannels.agentsUiRequest) {
					cancelUnboundUiRequest(payload);
				}
			}
		});

		const syncWslConfig = async () => {
			const { wslEnabled, wslDistro, wslUser } = settingsStore.get();
			if (wslEnabled && wslDistro && wslUser) {
				const { resolveWslEnvironment: resolveWsl2 } = await import("./wsl/WslEnvironment");
				const wslEnv = await resolveWsl2(wslDistro, wslUser, {
					warn: (msg: string, detail: unknown) => void appLogger?.warn("wsl", String(msg), { detail }),
				});
				await sessionScanner.configureWsl(wslEnv);
				agentManager.configureWsl(wslEnv);
				skillManager.configureWsl(wslEnv);
				promptManager.configureWsl(wslEnv);
				extensionManager.configureWsl(wslEnv);
				if (configManager) configManager.configureWsl(wslEnv);
				if (xuePromptManager) xuePromptManager.configureWsl(wslEnv);

				void piLocator.warmWslCommand(wslDistro, wslUser).catch((error) => {
					void appLogger?.warn("app", "WSL pi which warmup failed", error);
				});
			} else {
				sessionScanner.clearWsl();
				agentManager.configureWsl(null);
				skillManager.configureWsl(null);
				promptManager.configureWsl(null);
				extensionManager.configureWsl(null);
				if (configManager) configManager.configureWsl(null);
				if (xuePromptManager) xuePromptManager.configureWsl(null);
			}
		};

		void getModelTraceServer()
			.start()
			.then((info) => {
				if (!info) return;
				void appLogger?.info("app", "Model trace endpoint ready", { baseUrl: info.baseUrl });
			})
			.catch((error: unknown) => {
				void appLogger?.warn("app", "Model trace endpoint startup failed", error);
			});
		registerIpc();

		if (SYSTEM_SELECTION_TOOL_ENABLED) void selectionToolWindow?.warmUp().catch(() => undefined);

		registerAllDomains();
		registerFeishuIpc({
			getMainWindow: () => mainWindow,
			feishuBridgeRef,
			agentManager,
			projectStore,
			sessionRuntimeCoordinator,
			feishuSessionRuntimeBindings: imSessionRuntimeBindings,
			getCurrentLocale: currentFeishuLocale,
		});

		const wechatService = new WeChatService({
			getProjects: () => projectStore.list().map((project) => ({ id: project.id, name: project.name })),
			runtimeBindings: imSessionRuntimeBindings,
			getLocale: currentMainProcessLocale,
			getWindow: () => mainWindow,
			botAgent: `PiDeck/${app.getVersion()}`,
			logger: (level, message, detail) => {
				if (level === "warn" || level === "error") void appLogger?.warn("wechat", message, detail);
				else void appLogger?.info("wechat", message, detail);
			},
		});
		wechatServiceRef.current = wechatService;
		registerWeChatIpc({
			getMainWindow: () => mainWindow,
			wechatService,
			getProjects: () => projectStore.list().map((project) => ({ id: project.id, name: project.name })),
		});
		void wechatService.start().catch((error: unknown) => {
			void appLogger?.warn("wechat", "WeChat bridge autostart failed", error);
		});
		await createWindow();

		setImmediate(() => {
			configBackupManager?.ensureInitialBackups();
		});

		const coldStartTarget = extractFocusTargetFromArgv(process.argv);
		await quickTaskChrome.applyLaunchTarget(coldStartTarget);
		setupTray();

		void cleanupPasteFiles?.().catch((error: unknown) => {
			void appLogger.warn("app", "Paste file cleanup failed during startup", error);
		});

		void syncWslConfig()
			.then(async () => {
				warmStandbyAgentAtStartup();

				await refreshModelCatalogIfStale(piLocator, settingsStore, configManager.getConfigDir()).then((result) => {
					if (result.ran) {
						void appLogger.info("app", "Pi model catalog refresh at startup", {
							ok: result.ok,
						});
					} else if (result.ok) {
						void appLogger.debug("app", "Pi model catalog is fresh; skip refresh");
					}
				});
				await piModelCapabilityCache?.ensure();
				piModelCapabilityCache?.watchConfigDirectory();
			})
			.catch((error) => {
				void appLogger.warn("app", "WSL config sync or Pi capability hydration failed", error);
			});
		void migrateLegacyBuiltInExtensions().catch((error) => {
			console.error("Failed to migrate legacy built-in extensions:", error);
			void appLogger?.error("extensions", "Failed to migrate legacy built-in extensions", { error: error instanceof Error ? error.message : String(error) });
		});
		void ensureAllPiSettingsDefaults().catch((error) => {
			console.error("Failed to ensure pi settings defaults:", error);
			void appLogger?.error("settings", "Failed to ensure pi settings defaults", { error: error instanceof Error ? error.message : String(error) });
		});
		void appLogger.info("app", "Application started", {
			version: app.getVersion(),
			platform: process.platform,
			arch: process.arch,
			installationType: settingsStore.get().installationType,
		});
		void applyDesktopProxy(settingsStore.get()).catch((error) => {
			void appLogger.warn("settings", "Desktop proxy skipped after apply failure", error);
		});
		void webServiceManager.applySettings(settingsStore.get()).catch((error) => {
			console.error("Failed to start web service:", error);
			void appLogger?.error("web", "Failed to start web service", { error: error instanceof Error ? error.message : String(error) });
			void appLogger.warn("web", "Web service disabled after apply failure", {
				error: error instanceof Error ? error.message : String(error),
			});
			void settingsStore.update({ webServiceEnabled: false });
		});

		void remoteAccessManager
			.refresh()
			.then(() => remoteAccessManager.syncWebService())
			.catch((error) => {
				void appLogger.warn("web-remote", "Remote access initial probe failed", { error: error instanceof Error ? error.message : String(error) });
			});

		autoConnectFeishu();

		if (isMemoryProfileEnabled()) {
			void startMemoryProfile(() => agentManager.hasActiveStreaming())
				.then((handle) => {
					memoryProfileHandle = handle;
					quitCleanup.register("memory-profile", () => memoryProfileHandle?.stop());
				})
				.catch((error) => {
					console.error("Failed to start memory profile:", error);
					void appLogger?.error("memory", "Failed to start memory profile", { error: error instanceof Error ? error.message : String(error) });
				});
		}

		if (settingsStore.get().developerDiagnostics) {
			void diagnosticsMonitor?.setEnabled(true).catch((error) => {
				console.error("Failed to start developer diagnostics:", error);
				void appLogger?.error("diagnostics", "Failed to start developer diagnostics", { error: error instanceof Error ? error.message : String(error) });
			});
		}

		const projectStoreLoadPromise = projectStore.load();
		projectStoreReady = projectStoreLoadPromise.catch(() => undefined);

		void projectStoreReady.then(() => sendTelemetryHeartbeat());
		void projectStoreLoadPromise
			.then(async () => {
				const knownProjectIds = new Set(projectStore.list().map((project) => project.id));
				const orphanProjectIds = new Set(
					sessionCatalog
						.listEntries()
						.map((entry) => entry.projectId)
						.filter((projectId) => !knownProjectIds.has(projectId)),
				);
				for (const projectId of orphanProjectIds) {
					await sessionCatalog.removeByProjectId(projectId).catch(() => 0);
				}
				broadcastVisibleProjects();
			})
			.catch(() => undefined);

		if (coldStartTarget) {
			if (coldStartTarget.projectPath) {
				await projectStoreReady;
				const existing = projectStore?.findByPath(coldStartTarget.projectPath);
				if (existing) {
					queueFocusTarget({ projectId: existing.id });
				} else {
					queueFocusTarget({ projectPath: coldStartTarget.projectPath });
				}
			} else if (coldStartTarget.sessionId) {
				queueFocusTarget({ sessionId: coldStartTarget.sessionId });
			}
		}

		ipcMain.handle(ipcChannels.petGetFocusTargetPending, () => {
			const target = pendingFocusTarget;
			pendingFocusTarget = null;
			return target;
		});
		void detectExternalEditorsOnFirstLaunch().catch((error) => {
			void appLogger.warn("editor", "External editor first launch detection failed", error);
		});

		petSystem = new PetSystem({
			agentManager,
			settingsStore,
			getMainWindow: () => mainWindow,
			resolveSessionId: (agentId) => sessionRuntimeCoordinator.getSessionId(agentId),
			translate: (key, params) => mainCopy(key, params),
			recreateMainWindow: async () => {
				await createWindow();
				return mainWindow!;
			},
		});

		quitCleanup.register("pet", () => {
			petSystem?.stop();
			petSystem = null;
		});
		void petSystem.start().catch((error) => {
			void appLogger.warn("pet", "Pet system start failed", error);
		});

		registerSoundProtocol();
		registerHtmlPreviewProtocol();
		registerSoundIpc();
		soundAlertService = new SoundAlertService({
			agentManager,
			settingsStore,
			getMainWindow: () => mainWindow,
			isWindowFocused: () => isMainWindowFocused(mainWindow),
			log: (domain, message, details) => void appLogger.info(domain, message, details),
		});
		soundAlertService.attach();

		quitCleanup.register("sound-alert", () => {
			soundAlertService?.detach();
			soundAlertService = null;
		});

		announcementService = new AnnouncementService({
			userDataDir: app.getPath("userData"),
			appVersion: app.getVersion(),
			log: (domain, message, details) => void appLogger.info(domain, message, details),
			onSnapshot: (state) => {
				const win = mainWindow;
				if (win && !win.isDestroyed()) win.webContents.send(ipcChannels.announcementChanged, state);
			},
		});
		announcementService.start();
		registerAnnouncementIpc(() => announcementService);

		quitCleanup.register("announcement", () => {
			announcementService?.stop();
			announcementService = null;
		});

		browserAgentService = new BrowserAgentService({
			listAllWebContents: () => webContents.getAllWebContents(),
			isBrowserPanelGuest: (guest) => guest.session === session.fromPartition(BROWSER_PANEL_PARTITION),
			getAutoApprove: () => settingsStore.get().browserAgentAutoApprove,
		});
		cuaService = new CuaService({
			getMainWindow: () => mainWindow,
			log: (domain, message, details) => void appLogger.info(domain, message, details),

			getAutoApprove: () => settingsStore.get().cuaAutoApprove,
			browserAgent: browserAgentService,
		});

		void cuaService
			.applySettings({
				cuaEnabled: settingsStore.get().cuaEnabled,
				browserAgentEnabled: settingsStore.get().browserAgentEnabled ?? false,
			})
			.catch((error) => {
				void appLogger.warn("cua", "CUA/browser agent service start failed", error);
			});
		quitCleanup.register("cua", async () => {
			await cuaService?.dispose();
			cuaService = null;
		});
		quitCleanup.register("browser-agent", () => {
			browserAgentService?.dispose();
			browserAgentService = null;
		});

		setTimeout(() => {
			void settingsStore.ensureRpcTimeoutMinimum().catch((error) => {
				void appLogger.warn("settings", "Failed to ensure rpcTimeout minimum", error);
			});
		}, 0);

		app.on("activate", () => {
			if (mainWindow && !mainWindow.isDestroyed()) {
				mainWindow.show();
				mainWindow.focus();
			} else {
				void createWindow().catch((error) => {
					void appLogger.error("app", "Failed to create window on activate", error);
				});
			}
		});
	})
	.catch((error) => {
		console.error("Application startup failed:", error);
		void appLogger?.error("app", "Application startup failed", { error: error instanceof Error ? error.message : String(error) });
		void appLogger?.error("app", "Application startup failed", error);
		void import("electron")
			.then(({ dialog }) => {
				dialog.showErrorBox("PiDeck failed to start", error instanceof Error ? (error.stack ?? error.message) : String(error));
			})
			.catch(() => undefined);
	});

async function removeStalePiDeckExtension(extensionName: string, homeDir?: string): Promise<void> {
	const home = homeDir ?? app.getPath("home");
	const targetPath = join(home, ".pi", "agent", "extensions", extensionName);
	await rm(targetPath, { force: true });
	appLogger?.info("extension", "Removed legacy/stale extension", { path: targetPath });
}

async function migrateLegacyBuiltInExtensions(): Promise<void> {
	const { BUILT_IN_EXTENSIONS } = await import("./extensions/builtInExtensions");
	const legacyNames = [...BUILT_IN_EXTENSIONS, "pi-deck-project-trust.ts", "pi-deck-file-capture.ts"];
	const homes = [app.getPath("home")];
	const wslSettings = settingsStore.get();
	if (wslSettings.wslEnabled && wslSettings.wslDistro && wslSettings.wslUser) {
		homes.push(`\\\\wsl$\\${wslSettings.wslDistro}\\home\\${wslSettings.wslUser}`);
	}
	for (const home of homes) {
		for (const name of legacyNames) {
			await removeStalePiDeckExtension(name, home).catch(() => undefined);
		}
	}
}

async function ensureAllPiSettingsDefaults(): Promise<void> {
	const s = settingsStore.get();
	let piVersion = "";
	if (piLocator) {
		piVersion = (await piLocator.check(undefined, s.wslEnabled, s.wslDistro, s.wslUser).catch(() => null))?.version ?? "";
	}

	const winDir = join(app.getPath("home"), ".pi", "agent");
	await ensurePiSettingsDefaults(winDir, piVersion).catch(() => undefined);

	if (s.wslEnabled && s.wslDistro && s.wslUser) {
		const wslDir = join(`\\\\wsl$\\${s.wslDistro}\\home\\${s.wslUser}`, ".pi", "agent");
		await ensurePiSettingsDefaults(wslDir, piVersion).catch(() => undefined);
	}
}

app.on("child-process-gone", (_event, details) => {
	void appLogger.error("process", "Child process gone", {
		...details,
		platform: process.platform,
		arch: process.arch,
	});
});

let quitCleanupStarted = false;
app.on("before-quit", (event) => {
	isQuitting = true;

	if (quitCleanupStarted) return;
	quitCleanupStarted = true;
	event.preventDefault();
	const cleanupBudget = new Promise<void>((resolve) => {
		setTimeout(resolve, 5000).unref();
	});
	void Promise.race([quitCleanup.runAll(), cleanupBudget])
		.catch((error) => {
			void appLogger.error("quit", "Quit cleanup crashed", { error: error instanceof Error ? error.message : String(error) });
		})
		.finally(() => {
			app.quit();
		});
});

app.on("window-all-closed", () => {
	if (process.platform === "darwin") return;
	if (!isQuitting) return;
	app.quit();
});
