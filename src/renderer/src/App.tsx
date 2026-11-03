import { Button } from "./components/ui-shadcn/button";
import { NoticeHistoryDialog } from "./components/ui-shadcn/notice-history-dialog";
import { useSessionNavigation } from "./hooks/useSessionNavigation";
import { WorkbenchFileTabs } from "./components/workspace/WorkbenchFileTabs";
import { ArrowLeft, ArrowRight, PanelLeft } from "lucide-react";
import { lazy, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState, useCallback } from "react";
import { useAtomValue, useSetAtom, useStore } from "jotai";
import { toggleThemeMode } from "./themeAppearance";
import { DURATION_SLOW_MS, EASE_OUT_QUINT_CSS } from "./lib/motionTokens";
import { Code, Activity, FolderOpen, Globe, History, Pencil, Terminal, GitBranch, ListTree, SquarePen, Settings2, RotateCw, CircleStop, RefreshCw, Fingerprint, ScrollText, Rocket, Clock, Bot, Star } from "lucide-react";
import { configureNoticeDefaults, showNotice, type NoticeKind } from "./utils/notice";
import { copyTextWithCopiedNotice } from "./utils/clipboardNotice";
import { buildSettingsCommands, type PaletteCommand } from "./utils/commandPaletteCommands";
import { CommandPalette } from "./components/overlays/CommandPalette";
import { CommandPaletteOnboarding, markCommandPaletteOnboardingSeen } from "./components/overlays/CommandPaletteOnboarding";
import { desktopApi as api, isLanWeb, missingElectronPreload } from "./desktopApi";
import {
	turnFlowSettingsAtom,
	defaultAgentBackendAtom,
	busySendDeliveryAtom,
	scrollToLatestOnSendAtom,
	hiddenModulesAtom,
	openAgentMarketPageAtom,
	openFavoritesPageAtom,
	hiddenComposerFeaturesAtom,
	imageGenConfigAtom,
	enhanceModelAtom,
	enhanceIncludeContextAtom,
	promptSuggestionEnabledAtom,
	promptSuggestionModelAtom,
	openSettingsAtom,
	openAutomationPageAtom,
	agentProfilesAtom,
	activeWorkspacePageAtom,
	openWorkspacePageIdsAtom,
	openWorkspacePageAtom,
	deactivateWorkspacePageAtom,
	closeWorkspacePageAtom,
	sessionRecordsAtom,
	bumpNewTurnCollapseTickAtom,
	rpcLoggingAgentIdsAtom,
	toggleRpcLoggingAgent,
	usageQueryProvidersAtom,
} from "./atoms";
import { type SidebarActions } from "./components/sidebar/SidebarContent";
import { AppSidebar } from "./components/sidebar/AppSidebar";
import { AppBootstrap } from "./components/app/AppBootstrap";
import { SettingsFeatureRoot } from "./components/app/SettingsFeatureRoot";
import { hostPluginPanelAtom } from "./atoms/host-plugin-atoms";
import { AutomationPage } from "./components/automation/AutomationPage";
import { AgentMarketPage } from "./components/agents/AgentMarketPage";
import { FavoritesPage } from "./components/favorites/FavoritesPage";
import { sortWorkspacePageIds } from "./utils/workspacePageTabs";
import { SelectionToolHost } from "./components/selectionTool/SelectionToolHost";
import { useRename } from "./hooks/useRename";
import { useProjectRuntimeCapabilities } from "./hooks/useRuntimeCapabilities";
import { useSessionRuntimeBridge } from "./hooks/useSessionRuntimeBridge";
import { useAgentLoadNotice } from "./hooks/useAgentLoadNotice";
import { useArchMismatchNotice } from "./hooks/useArchMismatchNotice";
import { useAnnouncementNotifier } from "./hooks/useAnnouncementNotifier";
import { useModelsVerifyNotifier } from "./hooks/useModelsVerifyNotifier";
import { useBackgroundAskPatrol } from "./hooks/useBackgroundAskPatrol";
import { announcementCenterOpenAtom, announcementNotificationEnabledAtom } from "./atoms/announcement-atoms";
import { appDisplayNameAtom, customLogoAtom, logoStyleAtom } from "./atoms/app-ui-atoms";
import { LOGO_STYLE_STORAGE_KEY, resolveLogoStyle } from "./components/app/piTuiLogoData";
import { writeBootBrandCache } from "./components/app/bootBrandCache";
import { resolveAppDisplayName } from "../../shared/types/settings";
import { openProviderLoginAtom } from "./atoms/providerLoginAtoms";
import { useSessionLayout } from "./hooks/useSessionLayout";
import { useFileEditor } from "./hooks/useFileEditor";
import { useSessionFileLinks } from "./hooks/workspace/useSessionFileLinks";
import { useOverlayActions } from "./hooks/useOverlayActions";
import { useWorkspacePanels, type WorkspaceDrawerPanel, type WorkspaceExternalEditorAdapter } from "./hooks/useWorkspacePanels";
import { useDrawerPorts } from "./hooks/useDrawerPorts";
import { useTerminalDock } from "./hooks/useTerminalDock";
import { resolveTerminalOwner, terminalOwnerKey } from "./terminalDockState";
import { useImportFlow } from "./hooks/useImportFlow";
import { useDirectoryImport } from "./hooks/useDirectoryImport";
import { useQueuedPrompt } from "./hooks/useQueuedPrompt";
import { useComposerStateSessionPrune } from "./hooks/useComposerStateSessionPrune";
import { activeAgentIdAtom } from "./hooks/useSessionRuntimeController";
import { useSessionHistoryMutations } from "./hooks/useSessionHistoryMutations";
import { useUserMessageEditReplay } from "./hooks/useUserMessageEditReplay";
import { isLiveRuntimeStatus, resolveSessionReloadMode, sessionCommandFailureToast, type SessionRunAction, type SessionRunCapabilities, type SessionRunControlView } from "./utils/sessionCommands";
import { GUIDE_BOOTSTRAP_SESSION_ID, readLastSessionPreference, readWelcomeAcpToolPreference, readWelcomeBackendPreference, readWelcomeModelPreference, readWelcomeThinkingPreference, resolveChatSessionBootstrap, resolveGuidePageBackend, writeLastSessionPreference } from "./utils/chatSessionBootstrap";
import { useAppAppearance } from "./hooks/appearance/useAppAppearance";
import { useAppBootstrapInfo } from "./hooks/app/useAppBootstrapInfo";
import { useBootOverlayReady } from "./hooks/app/useBootOverlayReady";
import { useCommandPalette } from "./hooks/app/useCommandPalette";
import { useSidebarArchiveActions } from "./hooks/sidebar/useSidebarArchiveActions";
import { useSettingsUpdater } from "./hooks/settings/useSettingsUpdater";
import { useTpsDisplayMode } from "./hooks/settings/useTpsDisplayMode";
import { useSessionRunControl } from "./hooks/session/useSessionRunControl";
import { useCloseSessionTabShortcut } from "./hooks/useCloseSessionTabShortcut";
import { useProjectFileTreeController } from "./hooks/files/useProjectFileTreeController";
import { useSessionDurationTracking } from "./hooks/session/useSessionDurationTracking";
import { useSessionPromptDispatch } from "./hooks/session/useSessionPromptDispatch";

import { usePiUpdate } from "./hooks/usePiUpdate";
import { useProviderUsageStartupWarmup } from "./hooks/useProviderUsage";

import { useBackgroundUpdateWatch } from "./hooks/useBackgroundUpdateWatch";
import { useChannelSwitchWatch } from "./hooks/useChannelSwitchWatch";
import { useDataEnvWatch } from "./hooks/useDataEnvWatch";
import { DataModeChoiceDialog } from "./components/app/DataModeChoiceDialog";
import { DataEnvMismatchDialog } from "./components/app/DataEnvMismatchDialog";
import { useProjectSync } from "./hooks/useProjectSync";
import {
	agentInventoryAtom,
	applySessionRuntimeEventAtom,
	currentSessionAtom,
	currentSessionIdAtom,
	currentSessionRuntimeAtom,
	projectInventoryAtom,
	removeSessionComposerStateAtom,
	removeSessionStateAtom,
	replaceProjectInventoryAtom,
	replaceProjectSessionsAtom,
	sessionRecordByIdAtomFamily,
	sessionRecordsByProjectIdAtomFamily,
	sessionIdByRuntimeAgentIdAtomFamily,
	sessionRuntimeBySessionIdAtomFamily,
	sidebarExpandedProjectIdsAtom,
	compactMiddlePackagesAtom,
	sessionCatalogLoadStateAtom,
	sessionMessagesCacheAtom,
	sessionSummariesByProjectIdAtomFamily,
	modifiedFilesAtom,
	promoteSessionComposerStateAtom,
	promoteSessionMessagesCacheAtom,
	setSessionAttachmentsAtom,
	setSessionCatalogLoadStateAtom,
	setSessionMessageLoadStateAtom,
	setSessionHistoryMutationOverlayAtom,
	setSessionDraftAtom,
	sessionDraftByIdAtom,
	cacheSessionMessagesAtom,
	upsertSessionAtom,
	acpToolsAtom,
	acpEnabledAtom,
	sessionRuntimeByIdAtom,
} from "./atoms";
import { isSameSessionPath } from "./agentListDisplay";
import { t } from "./i18n";
import { isChatProject, loadSessionSourceFilter, saveSessionSourceFilter, isReplacementForPendingAgent, isPendingAgentId, migrateAgentRecord, stampIdleSessionDuration, type PendingAgentTab } from "./rendererUtils";
import { reorderProjectList } from "./utils/projectOrder";
import { MiniOverlaySurface } from "./components/mini-overlay/MiniOverlaySurface";
import type { SessionFilterPill } from "./sessionFilterPills";
import { useResize } from "./hooks/useResize";
import { ARCHIVED_SESSION_TOAST_MS, archivedSessionToastMessage, useSessionActions } from "./hooks/useSessionActions";
import { useScratchPad } from "./hooks/useScratchPad";
import { useWorktreeActions } from "./hooks/useWorktreeActions";
import { ChatSessionPane } from "./components/session/ChatSessionPane";
import { SessionSplitStage } from "./components/session/SessionSplitStage";
import { splitLayoutSessionIds } from "./utils/sessionSplitEdge";
import { SessionTabsBar, type SessionTabsBarProps, type SessionToolAction, type WorkspacePageTabItem } from "./components/session/SessionTabsBar";
import { SessionPaneServicesProvider, type SessionFileOpenContext } from "./components/session/SessionPaneServices";
import { SessionStatusPanel } from "./components/session/statusPanel/SessionStatusPanel";
import { ProjectEmptyState } from "./components/session/ProjectEmptyState";
import { FileLinkBaseProvider } from "./components/session/FileLinkBase";
import { useSessionWorkspaceChrome } from "./hooks/useSessionWorkspaceChrome";
import { useSessionIdAliasMigration } from "./hooks/useSessionIdAliasMigration";
import { useQuickTask } from "./hooks/useQuickTask";
import { useSideTasks } from "./hooks/useSideTasks";
import { QuickTaskSurface } from "./components/app/QuickTaskSurface";
import { AskPanelOverlay } from "./components/overlays/AskPanelOverlay";
import { HostPluginPanelHost } from "./components/plugins/HostPluginPanelHost";
import { HostPluginPageOverlay } from "./components/plugins/HostPluginPageOverlay";
import { useHostPluginPageTab } from "./hooks/useHostPluginPageTab";
import { useHostPluginNavigation } from "./hooks/plugins/useHostPluginNavigation";
import { TerminalDockPanel } from "./components/terminal/TerminalDockPanel";
import { ResizablePanel, ResizablePanelGroup } from "./components/ui-shadcn/resizable";
import { AppShell } from "./components/app/AppShell";
import { WorkspaceDrawerRail } from "./components/workspace/WorkspaceDrawerRail";
import { DrawerSurface } from "./components/workspace/DrawerSurface";
import { WorkbenchStage } from "./components/workspace/WorkbenchStage";
import { WorkbenchContent } from "./components/workspace/WorkbenchContent";
import { RenameModals } from "./components/RenameModals";
import { SessionActionOverlays } from "./components/overlays/SessionActionOverlays";
import { SessionProxyDialog } from "./components/session/SessionProxyDialog";
import { CuaApprovalDialog, useCuaApproval } from "./components/overlays/CuaApprovalDialog";

import { ImportOverlayHost } from "./components/overlays/ImportOverlayHost";
import { EnvironmentOverlay } from "./components/overlays/EnvironmentOverlay";
import { usePiEnvironmentGuide } from "./hooks/usePiEnvironmentGuide";
import { EnvironmentDialog, FileContextMenu, ImagePreviewModal } from "./components/app/AppParts";
import { ExternalEditorOverlay } from "./components/workspace/ExternalEditorOverlay";
import { navigateTo } from "./components/app/BrowserPanel";
import { flattenFiles, fileNodeDragPayloadToRef, mergeCommands } from "./components/app/AppUtils";

const ProjectResourcesModal = lazy(() => import("./components/app/ProjectResourcesModal").then((m) => ({ default: m.ProjectResourcesModal })));
import { createDefaultAppSettings } from "../../shared/types";
import { hydrateImageContents } from "../../shared/imageContentSrc";
import { parseSessionStatusPlacement, placementShowsSidebarPanel } from "../../shared/sessionStatusPlacement";
import type {
	AgentRuntimeState,
	AgentTab,
	SessionRuntimeTarget,
	AppSettings,
	ChatMessage,
	FileTreeNode,
	ImageContent,
	PiCommand,
	Project,
	AgentBackend,
	AgentProfile,
	SessionLaunchPreferences,
	SessionRecord,
	SessionSummary,
	ComposerAgentMode,
	TerminalTarget,
	TerminalThemeId,
	GitBranchInfo,
	FocusTargetPayload,
} from "../../shared/types";
import type { TerminalDockSettings } from "./components/terminal/TerminalDock";
import { WallpaperVideoLayer } from "./components/app/wallpaper/WallpaperVideoLayer";

export function App() {
	if (missingElectronPreload) {
		return (
			<div className="boot-screen root-loading">
				<div className="boot-logo root-loading-logo" aria-hidden="true">
					<svg viewBox="140 140 520 520" width="48" height="48">
						<defs>
							<linearGradient id="root-loading-logo-silver" x1="0.2" y1="0" x2="0.8" y2="1">
								<stop stopColor="#ffffff" />
								<stop offset="0.5" stopColor="#f4f4f5" />
								<stop offset="1" stopColor="#a7a8ab" />
							</linearGradient>
						</defs>
						<path fill="url(#root-loading-logo-silver)" fillRule="evenodd" d="M165.29 165.29H517.36V400H400V517.36H282.65V634.72H165.29ZM282.65 282.65V400H400V282.65Z" />
						<path fill="url(#root-loading-logo-silver)" d="M517.36 400H634.72V634.72H517.36Z" />
					</svg>
				</div>
				<strong className="text-[40px] font-bold tracking-[0.06em]">APIX</strong>
				<span>{t("app.preloadMissing")}</span>
			</div>
		);
	}

	const store = useStore();

	const currentSessionId = useAtomValue(currentSessionIdAtom);

	useBootOverlayReady(currentSessionId !== undefined);
	const currentSession = useAtomValue(currentSessionAtom);

	const modifiedFiles = useAtomValue(modifiedFilesAtom);
	const projects = useAtomValue(projectInventoryAtom);
	const agents = useAtomValue(agentInventoryAtom);
	const setCurrentSessionId = useSetAtom(currentSessionIdAtom);
	const replaceProjectSessions = useSetAtom(replaceProjectSessionsAtom);
	const openAutomationPage = useSetAtom(openAutomationPageAtom);
	const openAgentMarketPage = useSetAtom(openAgentMarketPageAtom);
	const openFavoritesPage = useSetAtom(openFavoritesPageAtom);

	const openWorkspacePageIds = useAtomValue(openWorkspacePageIdsAtom);
	const activeWorkspacePage = useAtomValue(activeWorkspacePageAtom);
	const openWorkspacePage = useSetAtom(openWorkspacePageAtom);
	const deactivateWorkspacePage = useSetAtom(deactivateWorkspacePageAtom);
	const closeWorkspacePage = useSetAtom(closeWorkspacePageAtom);

	const hostPluginPanel = useAtomValue(hostPluginPanelAtom);
	const setHostPluginPanel = useSetAtom(hostPluginPanelAtom);

	const openProviderLogin = useSetAtom(openProviderLoginAtom);
	const setProjects = useSetAtom(replaceProjectInventoryAtom);
	const applyRuntimeEvent = useSetAtom(applySessionRuntimeEventAtom);
	const upsertSession = useSetAtom(upsertSessionAtom);
	const setCacheMessages = useSetAtom(cacheSessionMessagesAtom);
	const setSessionDraft = useSetAtom(setSessionDraftAtom);
	const setSessionAttachments = useSetAtom(setSessionAttachmentsAtom);
	const promoteSessionComposerState = useSetAtom(promoteSessionComposerStateAtom);
	const promoteSessionMessagesCache = useSetAtom(promoteSessionMessagesCacheAtom);
	const setSessionCatalogLoadState = useSetAtom(setSessionCatalogLoadStateAtom);
	const setSessionMessageLoadState = useSetAtom(setSessionMessageLoadStateAtom);

	const setMutationOverlay = useSetAtom(setSessionHistoryMutationOverlayAtom);
	const removeSessionState = useSetAtom(removeSessionStateAtom);
	const removeSessionComposerState = useSetAtom(removeSessionComposerStateAtom);
	const setImageGenConfig = useSetAtom(imageGenConfigAtom);
	const setEnhanceModel = useSetAtom(enhanceModelAtom);
	const setEnhanceIncludeContext = useSetAtom(enhanceIncludeContextAtom);
	const setPromptSuggestionEnabled = useSetAtom(promptSuggestionEnabledAtom);
	const setPromptSuggestionModel = useSetAtom(promptSuggestionModelAtom);
	const currentSessionIdRef = useRef<string | undefined>(currentSessionId);
	currentSessionIdRef.current = currentSessionId;
	const openSessionRequestRef = useRef(0);
	const creatingSessionDraftRef = useRef<Set<string>>(new Set());

	const guideBootstrapPromotionRef = useRef<Promise<string> | undefined>(undefined);

	const [pendingAgents, setPendingAgents] = useState<PendingAgentTab[]>([]);
	const [activeProjectId, setActiveProjectId] = useState<string>();
	const activeProjectIdRef = useRef<string | undefined>(activeProjectId);
	activeProjectIdRef.current = activeProjectId;
	const activeAgentId = useAtomValue(activeAgentIdAtom);

	useEffect(() => {
		if (activeAgentId) {
			void api.settings
				.get()
				.then(setSettings)
				.catch(() => undefined);
		}
	}, [activeAgentId]);
	const activeAgentIdRef = useRef<string | undefined>(activeAgentId);
	activeAgentIdRef.current = activeAgentId;
	const agentsRef = useRef<AgentTab[]>(agents);
	agentsRef.current = agents;
	const expandedProjects = useAtomValue(sidebarExpandedProjectIdsAtom);
	const compactMiddlePackagesEnabled = useAtomValue(compactMiddlePackagesAtom);

	const jumpToMessageRef = useRef<((messageId: string) => void) | null>(null);

	const [previewImage, setPreviewImage] = useState<ImageContent | null>(null);

	const [proxyDialogSessionId, setProxyDialogSessionId] = useState<string | null>(null);

	const queueFlushBySessionRef = useRef<Set<string>>(new Set());

	const [sessionRefSelections, setSessionRefSelections] = useState<Record<string, { messages: Array<{ role: string; content: string }>; fullContext: boolean; selectedIndices: number[] }>>({});

	const [fileMenu, setFileMenu] = useState<{
		x: number;
		y: number;
		node: FileTreeNode;
	} | null>(null);

	const [hasClipboardFiles, setHasClipboardFiles] = useState(false);
	const [renamingFile, setRenamingFile] = useState<{
		path: string;
		name: string;
	} | null>(null);
	const [renamingFileInput, setRenamingFileInput] = useState("");

	const [sessionSourceFilter] = useState<Record<string, Set<SessionFilterPill> | null>>(() => loadSessionSourceFilter());

	const showToast = useCallback((message: string, duration?: number, kind?: NoticeKind) => {
		showNotice(message, duration, kind);
	}, []);

	useEffect(() => {
		void api.projects
			.consumeMigrationNotice()
			.then((notice) => {
				if (notice) showToast(t("app.userDataMigrationNotice", { newPath: notice.newPath }), 8000);
			})
			.catch(() => undefined);
	}, [showToast]);

	useEffect(() => {
		let cancelled = false;
		void api.acp
			.listTools()
			.then((tools) => {
				if (!cancelled) store.set(acpToolsAtom, tools);
			})
			.catch(() => undefined);
		void api.settings
			.get()
			.then((settings) => {
				if (!cancelled) store.set(acpEnabledAtom, settings.acpEnabled === true);
			})
			.catch(() => undefined);
		return () => {
			cancelled = true;
		};
	}, [store]);

	const promptHistoryRef = useRef<Record<string, string[]>>({});

	const layoutSettingsRequestRef = useRef<Promise<AppSettings> | null>(null);
	const getLayoutSettings = useCallback(() => {
		const cached = layoutSettingsRequestRef.current;
		if (cached) return cached;
		const request = api.settings.get();
		layoutSettingsRequestRef.current = request;
		void request.catch(() => {
			if (layoutSettingsRequestRef.current === request) layoutSettingsRequestRef.current = null;
		});
		return request;
	}, []);
	const loadSidebarWidth = useCallback(async () => (await getLayoutSettings()).sidebarWidth, [getLayoutSettings]);
	const loadDrawerWidth = useCallback(async () => (await getLayoutSettings()).drawerWidth, [getLayoutSettings]);
	const persistSidebarWidth = useCallback((width: number) => api.settings.update({ sidebarWidth: width }), []);
	const persistDrawerWidth = useCallback((width: number) => api.settings.update({ drawerWidth: width }), []);

	const editorsAdapter = useMemo<WorkspaceExternalEditorAdapter>(
		() => ({
			list: () => api.editors.list(),
			openProject: (editor, projectPath) => api.editors.openProject(editor, projectPath),
		}),
		[],
	);
	const workspace = useWorkspacePanels({
		projectId: activeProjectId,
		editors: editorsAdapter,
		loadPersistedWidth: loadDrawerWidth,
		persistWidth: persistDrawerWidth,
	});
	const drawer = workspace.drawer;
	const drawerCollapsed = workspace.drawerCollapsed;

	const toggleRightDrawer = useCallback(() => {
		if (workspace.drawer) {
			workspace.closeDrawer();
			return;
		}
		workspace.openDrawer("files");
	}, [workspace]);
	const browserFullscreen = workspace.browserFullscreen;
	const externalEditors = workspace.externalEditors;
	const editorsOpen = workspace.externalEditorsOpen;
	const editorsAnchor = workspace.externalEditorsAnchor;
	const editorsTargetPath = workspace.externalEditorsTargetPath;

	const setDrawer = useCallback(
		(panel: WorkspaceDrawerPanel | null) => {
			if (panel) workspace.openDrawer(panel);
			else workspace.closeDrawer();
		},
		[workspace.openDrawer, workspace.closeDrawer],
	);
	const setDrawerCollapsed = useCallback(
		(collapsed: boolean) => {
			if (collapsed) workspace.collapseDrawer();
			else workspace.expandDrawer();
		},
		[workspace.collapseDrawer, workspace.expandDrawer],
	);

	const [sessionsProjectId, setSessionsProjectId] = useState<string>();
	const [projectResourcesProject, setProjectResourcesProject] = useState<Project | null>(null);
	const sessions = useAtomValue(sessionSummariesByProjectIdAtomFamily(sessionsProjectId ?? ""));

	const {
		worktreesByProject,
		branchByProject,
		setBranchByProject,
		files,
		fileTreeContentRevision,
		setFiles,
		gitInfo,
		setGitInfo,
		setSessionLoadingByProject,
		setVisibleProjectChildCountByProject,
		refreshProjects,
		refreshAllProjects,
		refreshWorktrees,
		refreshProjectSessions,
		refreshFiles,
		refreshProjectTree,
		beginFileTreeRequest,
		isFileTreeRequestCurrent,
	} = useProjectSync({
		projects,
		activeProjectId,
		setProjects,
		setActiveProjectId,
		replaceProjectSessions,
		api: {
			projects: { list: api.projects.list },
			git: { worktreeList: api.git.worktreeList, branches: api.git.branches },
			sessions: {
				listCatalog: api.sessions.listCatalog,
				onCatalogRefreshed: api.sessions.onCatalogRefreshed,
			},
			files: {
				list: (projectId: string, options?: { maxDepth?: number; directory?: string }) => api.files.list(projectId, options),
			},
		},
		showToast,
		setSessionCatalogLoadState,
		t,
	});

	const answerEndRefreshTimerRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
	const scheduleAnswerEndRefresh = useCallback(
		(projectId: string) => {
			const existing = answerEndRefreshTimerRef.current[projectId];
			if (existing) clearTimeout(existing);
			answerEndRefreshTimerRef.current[projectId] = setTimeout(() => {
				delete answerEndRefreshTimerRef.current[projectId];
				void refreshProjectSessions(projectId, true).catch(() => undefined);
			}, 500);
		},
		[refreshProjectSessions],
	);

	const {
		codexImportProject,
		setCodexImportProject,
		claudeImportProject,
		setClaudeImportProject,
		qoderImportProject,
		setQoderImportProject,
		openCodeImportProject,
		setOpenCodeImportProject,
		zcodeImportProject,
		setZcodeImportProject,
		workbuddyImportProject,
		setWorkbuddyImportProject,
		cursorImportProject,
		setCursorImportProject,
		kimiImportProject,
		setKimiImportProject,
		kimiWorkImportProject,
		setKimiWorkImportProject,
		minimaxImportProject,
		setMinimaxImportProject,
		codexImportController,
		claudeImportController,
		qoderImportController,
		openCodeImportController,
		zcodeImportController,
		workbuddyImportController,
		cursorImportController,
		kimiImportController,
		kimiWorkImportController,
		minimaxImportController,
		openCodexImport,
		openClaudeImport,
		openQoderImport,
		openOpenCodeImport,
		openZCodeImport,
		openWorkBuddyImport,
		openCursorImport,
		openKimiImport,
		openKimiWorkImport,
		openMinimaxImport,
	} = useImportFlow({
		setProjectMenu: () => undefined,
		refreshProjectSessions,
		showToast,
		scanCodexSessions: api.codexSessions.scan,
		importCodexSessionsApi: api.codexSessions.import,
		scanClaudeSessions: api.claudeSessions.scan,
		importClaudeSessionsApi: api.claudeSessions.import,
		scanQoderSessions: api.qoderSessions.scan,
		importQoderSessionsApi: api.qoderSessions.import,
		scanOpenCodeSessions: api.openCodeSessions.scan,
		importOpenCodeSessionsApi: api.openCodeSessions.import,
		scanZCodeSessions: api.zcodeSessions.scan,
		importZCodeSessionsApi: api.zcodeSessions.import,
		scanWorkBuddySessions: api.workbuddySessions.scan,
		importWorkBuddySessionsApi: api.workbuddySessions.import,
		scanCursorSessions: api.cursorSessions.scan,
		importCursorSessionsApi: api.cursorSessions.import,
		scanKimiSessions: api.kimiSessions.scan,
		importKimiSessionsApi: api.kimiSessions.import,
		describeKimiWorkShareRoot: api.kimiWorkSessions.describe,
		scanKimiWorkSessions: api.kimiWorkSessions.scan,
		importKimiWorkSessionsApi: api.kimiWorkSessions.import,
		scanMinimaxSessions: api.minimaxSessions.scan,
		importMinimaxSessionsApi: api.minimaxSessions.import,
		getSettings: api.settings.get,
		updateSettings: api.settings.update,
		t,
	});

	const {
		project: directoryImportProject,
		setProject: setDirectoryImportProject,
		controller: directoryImportController,
		open: openDirectoryImport,
	} = useDirectoryImport({
		setProjectMenu: () => undefined,
		refreshProjectSessions,
		showToast,
	});

	const rename = useRename({
		renameAgent: async (id, name) => {
			const agent = agentsRef.current.find((candidate) => candidate.id === id);
			const sessionId = store.get(sessionIdByRuntimeAgentIdAtomFamily(id));
			if (!agent || !sessionId) throw new Error("Session runtime is not bound");
			const updated = await api.sessions.updateRecord(sessionId, { title: name });
			upsertSession(updated);
			return { ...agent, title: updated.title };
		},
		renameSession: (id, name) => api.sessions.updateRecord(id, { title: name }),
		renameProject: (id, name) => api.projects.rename(id, name),
		applyRenamedProjects: setProjects,
		showToast,
		refreshProjectSessions,
		closeAgentMenu: () => undefined,
	});

	const getProjectSessionRecords = (projectId: string) => store.get(sessionRecordsByProjectIdAtomFamily(projectId));
	const getSessionRecord = (sessionId: string) => store.get(sessionRecordByIdAtomFamily(sessionId));
	const [sessionHistoryLoading, setSessionHistoryLoading] = useState(false);

	useBackgroundUpdateWatch({
		api,

		openSettings: () => store.set(openSettingsAtom, { tab: "dev" }),
	});

	useChannelSwitchWatch({ api });

	useDataEnvWatch({ api });

	const [settingsLoaded, setSettingsLoaded] = useState(false);
	const [expandedProjectsReady, setExpandedProjectsReady] = useState(false);
	const [settings, setSettings] = useState<AppSettings>(createDefaultAppSettings);

	const setTurnFlowSettings = useSetAtom(turnFlowSettingsAtom);
	useEffect(() => {
		setTurnFlowSettings({
			expandInterimDuringStream: settings.expandInterimDuringStream,
			processGroupDisplay: settings.processGroupDisplay,
		});
	}, [settings.expandInterimDuringStream, settings.processGroupDisplay, setTurnFlowSettings]);

	const setDefaultAgentBackend = useSetAtom(defaultAgentBackendAtom);
	useEffect(() => {
		setDefaultAgentBackend(settings.defaultAgentBackend);
	}, [settings.defaultAgentBackend, setDefaultAgentBackend]);

	const setUsageQueryProviders = useSetAtom(usageQueryProvidersAtom);
	useEffect(() => {
		setUsageQueryProviders(settings.usageQueryProviders ?? []);
	}, [settings.usageQueryProviders, setUsageQueryProviders]);
	const effectiveAgentBackend: AgentBackend = "pi";

	const setBusySendDelivery = useSetAtom(busySendDeliveryAtom);
	useEffect(() => {
		setBusySendDelivery(settings.busySendDelivery);
	}, [settings.busySendDelivery, setBusySendDelivery]);

	const setScrollToLatestOnSend = useSetAtom(scrollToLatestOnSendAtom);
	useEffect(() => {
		setScrollToLatestOnSend(settings.scrollToLatestOnSend !== false);
	}, [settings.scrollToLatestOnSend, setScrollToLatestOnSend]);

	const setHiddenModules = useSetAtom(hiddenModulesAtom);
	useEffect(() => {
		setHiddenModules(settings.hiddenModules ?? []);
	}, [settings.hiddenModules, setHiddenModules]);

	const setHiddenComposerFeatures = useSetAtom(hiddenComposerFeaturesAtom);
	useEffect(() => {
		setHiddenComposerFeatures(settings.hiddenComposerFeatures ?? []);
	}, [settings.hiddenComposerFeatures, setHiddenComposerFeatures]);

	useProviderUsageStartupWarmup();

	useEffect(() => {
		if (settings.enableGitManagement) return;

		if (drawer === "git") workspace.closeDrawer();
	}, [settings.enableGitManagement, drawer, workspace.closeDrawer]);

	const { appInfo, systemLanguage } = useAppBootstrapInfo(api);

	useAppAppearance({ settings, systemLanguage, settingsLoaded });

	const piUpdate = usePiUpdate({
		settings,
		setSettings,
		showToast,
		api,
	});
	const { piStatus, piChecking, environmentDialog, setPiStatus, setEnvironmentDialog } = piUpdate;

	const { checkPiInstall } = piUpdate;
	const recheckPiForGuide = useCallback(async () => {
		const status = await checkPiInstall("manual");
		return Boolean(status?.installed);
	}, [checkPiInstall]);

	const piGuide = usePiEnvironmentGuide(api, recheckPiForGuide);
	const { checkNode: checkGuideNode, checkNpmForGuide: checkGuideNpm } = piGuide;
	useEffect(() => {
		if (!environmentDialog) return;
		void checkGuideNode();
		void checkGuideNpm();
	}, [environmentDialog, checkGuideNode, checkGuideNpm]);

	const drawerWidth = workspace.drawerWidth;
	const setDrawerWidth = workspace.setDrawerWidth;
	const [composerOffsetHeight, setComposerOffsetHeight] = useState(0);

	const currentSessionRecord = useAtomValue(sessionRecordByIdAtomFamily(currentSessionId ?? ""));

	const currentSessionRuntime = useAtomValue(sessionRuntimeBySessionIdAtomFamily(currentSessionId ?? ""));
	const currentSessionIsLive = isLiveRuntimeStatus(currentSessionRuntime?.status);

	const terminalOwner = resolveTerminalOwner(activeAgentId, activeProjectId ?? currentSessionRecord?.projectId);
	const {
		terminalOpen,
		terminalCollapsed,
		terminalDockVisible,
		terminalDockClosing,
		terminalHeight,
		setTerminalOpenForOwner,
		setTerminalCollapsedForOwner,
		setTerminalHeight,
		setTerminalOpenByOwnerKey,
		setTerminalCollapsedByOwnerKey,
		terminalStatesByOwner,
		prune: pruneTerminalDockState,
	} = useTerminalDock(terminalOwner);

	const terminalSettings = useMemo<TerminalDockSettings>(
		() => ({
			themeId: settings.terminalTheme,
			fontFamily: settings.terminalFontFamily,
			fontSize: settings.terminalFontSize,
			scrollback: settings.terminalScrollback,
			cursorStyle: settings.terminalCursorStyle,
			cursorBlink: settings.terminalCursorBlink,
			copyOnSelect: settings.terminalCopyOnSelect,
			paddingY: settings.terminalPaddingY,
			confirmClose: settings.terminalConfirmClose,
			startupCommand: settings.terminalStartupCommand,
		}),
		[settings.terminalTheme, settings.terminalFontFamily, settings.terminalFontSize, settings.terminalScrollback, settings.terminalCursorStyle, settings.terminalCursorBlink, settings.terminalCopyOnSelect, settings.terminalPaddingY, settings.terminalConfirmClose, settings.terminalStartupCommand],
	);
	const setTerminalTheme = useCallback(
		(themeId: TerminalThemeId) => {
			void api.settings
				.update({ terminalTheme: themeId })
				.then(setSettings)
				.catch(() => showToast(t("settings.terminal.themeChangeFailed"), 3000));
		},
		[api, showToast],
	);
	const [expandedSidebarProjects, setExpandedSidebarProjects] = useState<Set<string>>(new Set());
	const expandedSidebarProjectsRef = useRef(expandedSidebarProjects);
	expandedSidebarProjectsRef.current = expandedSidebarProjects;
	const expandedSidebarFromSettingsRef = useRef(false);
	function saveExpandedSidebarProjectsToLocal(next: Set<string>) {
		try {
			localStorage.setItem("pidek.sidebarExpandedProjectIds", JSON.stringify([...next]));
		} catch {}
	}
	const queuedTrackRef = useRef<HTMLElement | null>(null);

	const composerTextareaRef = useRef<HTMLDivElement | null>(null);

	const pendingComposerCaretRef = useRef<number | null>(null);
	const pendingAgentsRef = useRef<PendingAgentTab[]>([]);

	const { expandedDirs, refreshVisibleFiles, restoreExpandedDirs, drillCompactChain, toggleDirectory, collapseAllDirectories } = useProjectFileTreeController({
		files,
		setFiles,
		refreshFiles,
		beginFileTreeRequest,
		isFileTreeRequestCurrent,
		activeProjectId,
		activeProjectIdRef,
		compactMiddlePackagesEnabled,
		agentsRef,
		refreshProjects,
		showToast,
	});

	const scratchPad = useScratchPad(workspace);

	const cuaApproval = useCuaApproval();
	const activeProjectRuntimeCapabilities = useProjectRuntimeCapabilities(activeProjectId);
	const activeProject = projects.find((project) => project.id === activeProjectId);
	const overlays = useOverlayActions({ activeProject, appInfo, showToast });
	const sessionsProject = projects.find((project) => project.id === sessionsProjectId);
	const displayAgents = useMemo(() => {
		const realIds = new Set(agents.map((agent) => agent.id));
		return [...agents, ...pendingAgents.filter((agent) => !realIds.has(agent.id) && !agents.some((realAgent) => isReplacementForPendingAgent(realAgent, agent)))];
	}, [agents, pendingAgents]);

	const { worktreeCreating, removingWorktreePaths, createWorktree, removeWorktree, requestRemoveWorktree, toggleProjectWorktree } = useWorktreeActions({
		projects,
		displayAgents,
		setProjects,
		refreshWorktrees,
		overlays,
	});

	const { sessionDurationByAgent } = useSessionDurationTracking({ displayAgents, activeAgentId });

	const displayAgentsRef = useRef(displayAgents);
	displayAgentsRef.current = displayAgents;

	const activeAgent = activeAgentId ? [...displayAgents, ...pendingAgents].find((agent) => agent.id === activeAgentId) : undefined;

	const rewindBackend = activeAgent?.backend ?? currentSessionRecord?.backend;
	const rewindSupported = rewindBackend === undefined || rewindBackend === "pi";

	const rpcLoggingAgentIds = useAtomValue(rpcLoggingAgentIdsAtom);
	const setRpcLoggingAgentIds = useSetAtom(rpcLoggingAgentIdsAtom);
	const patchRpcLoggingAgentIds = useCallback((agentId: string, enabled: boolean) => {
		setRpcLoggingAgentIds((current) => toggleRpcLoggingAgent(current, agentId, enabled));
	}, []);
	const rpcLogTabTargetAgentId = useMemo(() => {
		if (rpcLoggingAgentIds.size === 0) return undefined;
		const liveIds = new Set([...displayAgents, ...pendingAgents].filter((agent) => agent.status !== "closed" && agent.status !== "error").map((agent) => agent.id));

		if (workspace.rpcLogAgentId && rpcLoggingAgentIds.has(workspace.rpcLogAgentId) && liveIds.has(workspace.rpcLogAgentId)) return workspace.rpcLogAgentId;
		for (const id of rpcLoggingAgentIds) if (liveIds.has(id)) return id;
		return undefined;
	}, [rpcLoggingAgentIds, displayAgents, pendingAgents, workspace.rpcLogAgentId]);

	const { livePromptByAgentRef, setPromptForAgent, setPrompt, isAgentCurrentlyBusy, dispatchPromptSnapshot, submitPromptSnapshot, translateAgentErrorMessage } = useSessionPromptDispatch({ store, setSessionDraft, currentSessionId, currentSessionIdRef, activeAgentIdRef, showToast });

	const queue = useQueuedPrompt({
		displayAgentsRef,
		queueFlushBySessionRef,
		composerTextareaRef,
		pendingComposerCaretRef,
		store,
		setComposerCursor: (v: React.SetStateAction<number>) => {},
		showToast,
		unknownDeliveryMessage: t("app.queuedUnknown"),
		dispatchPromptSnapshot,
	});

	useComposerStateSessionPrune(store);
	useSessionRuntimeBridge({
		onRestartSessionRuntime: (sessionId) => {
			const runtime = store.get(sessionRuntimeByIdAtom)[sessionId];
			if (!runtime?.agentId) return;
			overlays.showConfirm({
				title: t("runControl.restartRunningTitle"),
				message: t("runControl.restartRunningBody"),
				confirmLabel: t("app.restart"),
				onConfirm: () => {
					overlays.clearConfirm();
					void restartSessionAnyState(sessionId);
				},
			});
		},
		onRuntimeCapabilityChanged: ({ sessionId, previous, current, patch }) => {
			if (previous?.isExecutingTool && !current.isExecutingTool && (patch.toolStateSequence == null || previous.toolStateSequence == null || patch.toolStateSequence >= previous.toolStateSequence) && queue.isSessionRuntimeBusy(sessionId)) {
				void queue.flushQueuedSteerPrompts(sessionId);
			}

			if (previous?.isStreaming && !current.isStreaming) {
				const projectId = store.get(sessionRecordByIdAtomFamily(sessionId))?.projectId;
				if (projectId) {
					scheduleAnswerEndRefresh(projectId);
				}
			}
		},
	});

	useAgentLoadNotice(settings.agentCountReminderEnabled);
	useTpsDisplayMode(settings.tpsDisplayMode);

	useArchMismatchNotice();

	const setLogoStyle = useSetAtom(logoStyleAtom);
	useEffect(() => {
		const logoStyle = resolveLogoStyle(settings.logoStyle);
		setLogoStyle(logoStyle);
		try {
			window.localStorage.setItem(LOGO_STYLE_STORAGE_KEY, logoStyle);
		} catch {}
	}, [settings.logoStyle, setLogoStyle]);

	const setAppDisplayName = useSetAtom(appDisplayNameAtom);
	const setCustomLogo = useSetAtom(customLogoAtom);
	useEffect(() => {
		const displayName = resolveAppDisplayName(settings.appDisplayName);
		const customLogo = resolveLogoStyle(settings.logoStyle) === "custom" ? (settings.logoCustomImage ?? "") : "";
		setAppDisplayName(displayName);
		setCustomLogo(settings.logoCustomImage ?? "");
		writeBootBrandCache(displayName, customLogo);
	}, [settings.appDisplayName, settings.logoCustomImage, settings.logoStyle, setAppDisplayName, setCustomLogo]);

	const setAnnouncementNotifyEnabled = useSetAtom(announcementNotificationEnabledAtom);
	useEffect(() => {
		setAnnouncementNotifyEnabled(settings.announcementNotificationEnabled);

		if (!settings.announcementNotificationEnabled) {
			store.set(announcementCenterOpenAtom, false);
		}
	}, [settings.announcementNotificationEnabled, setAnnouncementNotifyEnabled, store]);

	useAnnouncementNotifier();

	useEffect(() => {
		configureNoticeDefaults({ toastDurationMs: settings.toastDurationMs });
	}, [settings.toastDurationMs]);

	useModelsVerifyNotifier();
	const activeQueuedPrompts = currentSessionId ? (queue.queuedPrompts[currentSessionId] ?? []) : [];

	const enqueueSessionPrompt = useCallback(
		(sessionId: string, snapshot: { displayText: string; message: string; images?: ImageContent[]; agentMode: string; behavior?: "steer" | "followUp" }) => {
			if (!store.get(sessionRuntimeBySessionIdAtomFamily(sessionId))?.agentId) return false;
			return queue.enqueueQueuedPrompt(sessionId, {
				id: crypto.randomUUID(),
				message: snapshot.message,
				displayText: snapshot.displayText,
				images: snapshot.images,

				behavior: snapshot.behavior ?? store.get(busySendDeliveryAtom),
				agentMode: snapshot.agentMode as ComposerAgentMode,
				timestamp: Date.now(),
			});
		},
		[store, queue.enqueueQueuedPrompt],
	);

	const insertQuickPrompt = useCallback(
		(sessionId: string, message: string) => {
			setSessionDraft({ sessionId, value: message });
			requestAnimationFrame(() => {
				document.querySelector<HTMLElement>(".composer-box .rich-input")?.focus();
			});
		},
		[setSessionDraft],
	);

	const activeProjectHasBusyAgent = Boolean(activeProjectId && displayAgents.some((agent) => agent.projectId === activeProjectId && (agent.status === "starting" || agent.status === "running" || activeProjectRuntimeCapabilities[agent.id]?.isStreaming || activeProjectRuntimeCapabilities[agent.id]?.isExecutingTool)));
	const activeProjectSessionSyncKey = useMemo(() => {
		if (!activeProjectId) return "";
		return displayAgents
			.filter((agent) => agent.projectId === activeProjectId)
			.map((agent) => {
				const runtime = activeProjectRuntimeCapabilities[agent.id];
				return `${agent.id}:${agent.status}:${runtime?.isStreaming ? 1 : 0}:${runtime?.isExecutingTool ? 1 : 0}`;
			})
			.sort()
			.join("|");
	}, [activeProjectId, activeProjectRuntimeCapabilities, displayAgents]);

	const anyTerminalDockOpen = useMemo(() => Object.values(terminalStatesByOwner).some((state) => state.open), [terminalStatesByOwner]);
	const sessionLayout = useSessionLayout({
		terminalRequestedHeight: terminalHeight,
		terminalOpen: anyTerminalDockOpen,

		terminalClosing: false,
		terminalCollapsed,
		queuedPromptCount: activeQueuedPrompts.length,
	});
	const { chatPaneRef: sessionChatPaneRef, headerRef: sessionHeaderRef, composerRef: sessionComposerRef, terminalRowHeight, availableTerminalHeight } = sessionLayout;

	const chatPaneRef = sessionChatPaneRef;
	const chatHeaderRef = sessionHeaderRef;
	const composerRef = sessionComposerRef;

	const { listWidth, setListWidth, listCollapsed, setListCollapsed, toggleListCollapsed } = useResize({
		loadPersistedWidth: loadSidebarWidth,
		persistWidth: persistSidebarWidth,
	});

	const flatFiles = useMemo(() => flattenFiles(files), [files]);

	const {
		editorMode,
		toggleEditorMode,
		editorTabs,
		activeTabId,
		activeTab,
		readEditorFileContent,
		readEditorOriginalContent,
		saveEditorFileContent,
		closeEditorTab,
		selectEditorTab,
		promotePreviewEditorTab,
		allowSaveEditorTab,
		previewEditorTabId,
		openFilePath,
		viewFilePath,
		openEditorTab,
		diffFilePath,
		openWorkspaceFileDiff,
		openCommitFileDiff,
		closeGitDiff,
		dismissGitDiff,
		gitDiffDisplayMode,
		gitDrawerDiff,
		toggleGitDiffDisplayMode,
		closeEditor,
	} = useFileEditor({
		activeProjectId,
		activeProjectIdRef,
		activeAgent: activeAgent ?? null,
		activeProject: activeProject ?? null,
		drawer,
		modifiedFiles,
		setDrawer,
		setDrawerCollapsed,
		preserveTabsForGit: settings.navigationMode === "simple",
		contentOpenMode: settings.navigationMode === "simple" ? "split" : (settings.workspaceContentOpenMode ?? "split"),
		showToast,
		readFileContent: api.files.readContent,
		readGitOriginalContent: api.git.originalContent,
		writeFileContent: api.files.writeContent,
		openFile: api.files.open,
		workspaceFileDiff: api.git.workspaceFileDiff,
		commitFileDiff: api.git.commitFileDiff,
		t,
	});

	const { openSessionFilePath, requestExternalPathOpen, externalPathOpenDialog, handleOpenLinkedFile, handleToolDrawerAction } = useSessionFileLinks({
		activeAgent,
		activeProject,
		projects,
		currentSessionId,
		activeProjectId,
		showToast,
		setPreviewImage,
		viewFilePath,
		workspace,
		gitDrawerDiff,
		closeGitDiff,
		refreshVisibleFiles,
		restoreExpandedDirs,
	});

	const workspaceChrome = useSessionWorkspaceChrome({
		currentSessionId,
		activeProjectId,
	});

	useSessionIdAliasMigration();

	const {
		selectProject: selectProjectCommand,
		selectSession: selectSessionCommand,
		copySession: runCopySession,
		exportHistorySession: runExportHistorySession,
		deleteHistorySession: runDeleteHistorySession,
		openSidebarSession: runOpenSidebarSession,
		openSidebarSessionById: runOpenSidebarSessionById,
		copySidebarSession: runCopySidebarSession,
		exportSidebarSession: runExportSidebarSession,
		createSessionDraft: runCreateSessionDraft,
		createAnonymousSession: runCreateAnonymousSession,
		dismissSessionTree,
	} = useSessionActions({
		openSessionRequestRef,
		creatingSessionDraftRef,
		activeProjectId,
		sessionsProjectId,
		projects,
		setActiveProjectId,
		setCurrentSessionId,
		getSessionRecord,
		getProjectSessionRecords,
		upsertSession,
		removeSessionState,
		removeSessionComposerState,
		closeTabs: workspaceChrome.closeTabs,
		refreshProjectSessions,
		api,
		showToast,

		defaultBackend: effectiveAgentBackend,
	});

	const {
		restartingAgentId,
		activatingSessionId,
		stoppingAgentId,
		reloadingSessionId,
		getRuntimeTargetForSession,
		getRuntimeTargetForAgent,
		isSessionRuntimeLive,
		openReplacedRuntimeSession,
		cloneAgentSession,
		applyAgentRuntimeState,
		refreshRuntimeState,
		reloadSessionMessages,
		closeAgent,
		requestCloseAgent,
		requestCloseAgentForSession,
		abortAgent,
		restartActiveAgent,
		restartSessionAnyState,
		exportAgentHtml,
		getSessionRunCapabilities,
		runSessionControl,
	} = useSessionRunControl({
		agents,
		activeAgent,
		activeAgentId,
		activeProjectId,
		showToast,
		overlays,
		refreshProjectSessions,
		selectSessionCommand,
		registerOpenSession: workspaceChrome.registerOpenSession,
		getSessionRecord,
		pendingAgentsRef,
		setPendingAgents,
		queueFlushBySessionRef,
		queuedPromptsRef: queue.queuedPromptsRef,
		suppressQueueAutoDrain: queue.suppressSessionQueueAutoDrain,
	});

	useCloseSessionTabShortcut({ closeTab: workspaceChrome.closeTab, abortAgent, overlays });

	const terminalTarget: TerminalTarget | undefined = useMemo(() => {
		if (!terminalOwner) return undefined;
		const fallbackProject = (() => {
			const pid = terminalOwner.kind === "project" ? terminalOwner.id : (activeProjectId ?? currentSessionRecord?.projectId);
			return pid ? projects.find((p) => p.id === pid) : undefined;
		})();
		const projectTarget = fallbackProject && !isChatProject(fallbackProject) ? { kind: "project" as const, projectId: fallbackProject.id, cwd: fallbackProject.path } : undefined;
		if (terminalOwner.kind === "agent") {
			const runtimeTarget = getRuntimeTargetForSession(currentSessionId);
			return runtimeTarget ? { kind: "agent" as const, ...runtimeTarget } : projectTarget;
		}
		return projectTarget;
	}, [terminalOwner, currentSessionId, currentSessionRecord, projects, activeProjectId, getRuntimeTargetForSession]);

	const quickTask = useQuickTask({ ready: settingsLoaded, backend: effectiveAgentBackend, upsertSession, selectSession: selectSessionCommand, registerSession: workspaceChrome.registerOpenSession, refreshProjects, getSessionRecord });

	const sideTasks = useSideTasks({
		backend: effectiveAgentBackend,
		showToast,
		onCreated: () => workspace.openDrawerForce("sideTask"),
	});

	const openInBrowser = (url: string) => {
		workspace.openDrawerForce("browser");
		navigateTo(url);
	};

	useHostPluginNavigation(selectSessionCommand, openInBrowser);

	useEffect(() => {
		workspaceChrome.bindFocusHandlers({
			focusSession: (projectId, sessionId) => {
				selectSessionCommand(projectId, sessionId, true);
			},
			focusProject: (projectId) => {
				selectProjectCommand(projectId);
			},

			focusOpenProjectPath: (path: string) => {
				overlays.showConfirm({
					title: t("app.openFolderConfirmTitle"),
					message: t("app.openFolderConfirmMessage", { path }),
					confirmLabel: t("app.openFolderConfirmAdd"),
					onConfirm: () => {
						void (async () => {
							try {
								const project = await api.projects.addByPath(path);

								await refreshProjects();
								selectProjectCommand(project.id);
								showToast(t("app.openFolderAdded", { name: project.name }));
							} catch (error) {
								showToast(error instanceof Error ? error.message : String(error), 5000, "error");
							} finally {
								overlays.clearConfirm();
							}
						})();
					},
				});
			},
		});
	}, [workspaceChrome, selectSessionCommand, selectProjectCommand, overlays, showToast]);

	const createSessionDraftWithTab = useCallback(
		async (projectId?: string, preferences: SessionLaunchPreferences = {}, backend?: AgentBackend) => {
			const session = await runCreateSessionDraft(projectId, preferences, backend);
			if (session) workspaceChrome.registerOpenSession(session.id, "permanent");
			return session;
		},
		[runCreateSessionDraft, workspaceChrome],
	);

	const createAnonymousSessionWithTab = useCallback(
		async (projectId?: string, preferences: SessionLaunchPreferences = {}) => {
			const session = await runCreateAnonymousSession(projectId, preferences);
			if (session) workspaceChrome.registerOpenSession(session.id, "permanent");
			return session;
		},
		[runCreateAnonymousSession, workspaceChrome],
	);

	const handleFeedbackCreateSession = useCallback(
		async (prompt: string): Promise<boolean> => {
			const session = await createSessionDraftWithTab();
			if (!session) return false;
			setSessionDraft({ sessionId: session.id, value: prompt });
			return true;
		},
		[createSessionDraftWithTab, setSessionDraft],
	);

	const handleAgentSendToSession = useCallback(
		async ({ agentId, text }: { agentId: string; text: string }): Promise<boolean> => {
			const agent = store.get(agentProfilesAtom).find((profile) => profile.id === agentId);
			const project = projects.find((candidate) => candidate.id === activeProjectId);
			const trimmed = text.trim();
			if (!agent || !project || !trimmed) return false;
			const backend: AgentBackend = "pi";
			try {
				const title = `${agent.icon ? `${agent.icon} ` : ""}${agent.name}`.trim();
				const session = await api.sessions.createDraft({
					projectId: project.id,
					title,
					backend,
					...(agent.model && backend === "pi" ? { model: agent.model } : {}),
				});
				upsertSession(session);
				selectSessionCommand(project.id, session.id, false);
				workspaceChrome.registerOpenSession(session.id, "permanent");
				const persona = agent.systemPrompt.trim();
				const hiddenPersona = true;
				const payload = `${persona}\n\n${trimmed}`;
				const result = await api.sessions.sendPrompt({
					sessionId: session.id,
					requestId: crypto.randomUUID(),
					message: hiddenPersona ? trimmed : payload,
					...(hiddenPersona ? { agentMessage: payload } : {}),
				});
				if (!result.accepted) {
					showToast(result.error || t("agentInvoke.errorTitle"), 4000, "error");
					return false;
				}
				return true;
			} catch (error) {
				showToast(error instanceof Error ? error.message : String(error), 4000, "error");
				return false;
			}
		},
		[activeProjectId, effectiveAgentBackend, projects, selectSessionCommand, showToast, store, upsertSession, workspaceChrome],
	);

	const handleAgentUseAgent = useCallback(
		async (agent: AgentProfile): Promise<boolean> => {
			const project = projects.find((candidate) => candidate.id === activeProjectId) ?? projects[0];
			if (!project) {
				showToast(t("agentMarket.useFailed", { error: t("feedback.ai.noProject") }), 4000, "error");
				return false;
			}

			const backend: AgentBackend = "pi";
			try {
				const title = `${agent.icon ? `${agent.icon} ` : ""}${agent.name}`.trim();
				const session = await api.sessions.createDraft({
					projectId: project.id,
					title,
					backend,
					...(agent.model && backend === "pi" ? { model: agent.model } : {}),
				});
				upsertSession(session);

				await api.agentProfiles.bindSession({ sessionId: session.id, agentId: agent.id });
				selectSessionCommand(project.id, session.id, false);
				workspaceChrome.registerOpenSession(session.id, "permanent");
				showToast(t("agentMarket.usedAgent", { name: agent.name }), 2600);
				return true;
			} catch (error) {
				showToast(t("agentMarket.useFailed", { error: error instanceof Error ? error.message : String(error) }), 5000, "error");
				return false;
			}
		},
		[activeProjectId, effectiveAgentBackend, projects, selectSessionCommand, showToast, upsertSession, workspaceChrome],
	);

	useEffect(() => {
		return api.selectionTool.onInserted(({ text }) => {
			const trimmed = text.trim();
			if (!trimmed) return;
			const targetSessionId = currentSessionId ?? GUIDE_BOOTSTRAP_SESSION_ID;
			const existing = store.get(sessionDraftByIdAtom)[targetSessionId] ?? "";
			setSessionDraft({ sessionId: targetSessionId, value: existing ? `${existing}\n\n${trimmed}` : trimmed });
			showToast(t("selectionTool.inserted"), 2400);
		});
	}, [currentSessionId, setSessionDraft, showToast, store]);

	const workspacePageScopeRef = useRef<string | undefined>(undefined);
	useEffect(() => {
		const scope = `${activeProjectId ?? ""}|${currentSessionId ?? ""}`;
		if (workspacePageScopeRef.current === undefined) {
			workspacePageScopeRef.current = scope;
			return;
		}
		if (scope === workspacePageScopeRef.current) return;
		workspacePageScopeRef.current = scope;
		deactivateWorkspacePage();
	}, [activeProjectId, currentSessionId, deactivateWorkspacePage]);

	useEffect(() => {
		if (activeWorkspacePage && hostPluginPanel) setHostPluginPanel(null);
	}, [activeWorkspacePage, hostPluginPanel, setHostPluginPanel]);

	const openSidebarSessionByIdWithTab = useCallback(
		async (projectId: string, sessionId: string, tabMode: "preview" | "permanent" = "permanent") => {
			const openedId = await runOpenSidebarSessionById(projectId, sessionId);
			if (openedId) workspaceChrome.registerOpenSession(openedId, tabMode);
			return openedId;
		},
		[runOpenSidebarSessionById, workspaceChrome],
	);

	useEffect(() => {
		if (!activeProject) return;
		const action = resolveChatSessionBootstrap({
			isChatProject: isChatProject(activeProject),
			currentSessionId,
			catalogStatus: store.get(sessionCatalogLoadStateAtom)[activeProject.id]?.status,
		});
		if (action.kind === "load") {
			void refreshProjectSessions(activeProject.id).catch(() => undefined);
		}
	}, [activeProject, currentSessionId, refreshProjectSessions, selectSessionCommand, store]);

	const ensureSessionForSend = useCallback(
		async (sessionId: string) => {
			if (sessionId !== GUIDE_BOOTSTRAP_SESSION_ID) return sessionId;
			if (guideBootstrapPromotionRef.current) return guideBootstrapPromotionRef.current;
			const project = projects.find((candidate) => candidate.id === activeProjectId);
			if (!project) {
				throw new Error(t("app.guideBootstrapUnavailable"));
			}
			const promotion = (async () => {
				const draftBackend = resolveGuidePageBackend({ override: readWelcomeBackendPreference(), acpToolId: readWelcomeAcpToolPreference(), effectiveDefault: effectiveAgentBackend });

				const welcomeModel = draftBackend === "pi" ? readWelcomeModelPreference()?.model : undefined;
				const welcomeThinking = draftBackend === "acp" ? undefined : readWelcomeThinkingPreference()?.thinkingLevel;

				const session = await api.sessions.createDraft({
					projectId: project.id,
					title: `${project.name} agent`,
					backend: draftBackend,
					...(draftBackend === "acp" ? { acpToolId: readWelcomeAcpToolPreference() } : {}),
					...(welcomeModel ? { welcomeModel } : {}),
					...(welcomeThinking ? { thinkingLevel: welcomeThinking } : {}),
				});
				upsertSession(session);

				promoteSessionMessagesCache({
					fromSessionId: GUIDE_BOOTSTRAP_SESSION_ID,
					toSessionId: session.id,
				});
				promoteSessionComposerState({
					fromSessionId: GUIDE_BOOTSTRAP_SESSION_ID,
					toSessionId: session.id,
				});
				selectSessionCommand(project.id, session.id, false);
				workspaceChrome.registerOpenSession(session.id, "permanent");
				return session.id;
			})();
			guideBootstrapPromotionRef.current = promotion;
			try {
				return await promotion;
			} finally {
				guideBootstrapPromotionRef.current = undefined;
			}
		},
		[activeProjectId, projects, promoteSessionComposerState, promoteSessionMessagesCache, selectSessionCommand, upsertSession, workspaceChrome, effectiveAgentBackend],
	);

	const validFilePaths = useMemo(() => new Set(flatFiles.map((f) => f.relativePath)), [flatFiles]);

	const projectIdsKey = useMemo(() => projects.map((project) => project.id).join("\n"), [projects]);

	function handleAgentInventoryChanged(nextAgents: AgentTab[]) {
		const previousPendingAgents = pendingAgentsRef.current;
		const remainingPendingAgents = previousPendingAgents.filter((pending) => !nextAgents.some((agent) => isReplacementForPendingAgent(agent, pending)));
		const pendingReplacementById = new Map(
			previousPendingAgents
				.map((pending) => {
					const replacement = nextAgents.find((agent) => isReplacementForPendingAgent(agent, pending));
					return replacement ? [pending.id, replacement.id] : undefined;
				})
				.filter((entry): entry is [string, string] => Boolean(entry)),
		);
		if (remainingPendingAgents.length !== previousPendingAgents.length) {
			pendingAgentsRef.current = remainingPendingAgents;
			setPendingAgents(remainingPendingAgents);
		}
		const draftIds = new Set([...nextAgents.map((agent) => agent.id), ...remainingPendingAgents.map((agent) => agent.id)]);

		livePromptByAgentRef.current = migrateAgentRecord(livePromptByAgentRef.current, pendingReplacementById, draftIds);
	}

	useEffect(() => {
		handleAgentInventoryChanged(agents);
	}, [agents]);

	const bootstrapProps = {
		onProjectsChanged: (next: Project[]) => {
			if (!activeProjectId && next.length > 0) setActiveProjectId(next[0].id);
		},
		onSettingsApplied: (next: AppSettings) => {
			setSettings(next);
			showToast(t("settings.restartNotice"));
		},
		onOpenInBrowser: openInBrowser,
		onTrustRequest: overlays.setTrustRequest,

		onFocusTarget: (target: FocusTargetPayload) => {
			if (!("sessionId" in target)) return;
			const session = store.get(sessionRecordByIdAtomFamily(target.sessionId));
			if (session) selectSessionCommand(session.projectId, session.id, false);
		},
	};

	useEffect(() => {
		void workspace.loadExternalEditors().catch(() => undefined);
		void api.imagegen
			.getConfig()
			.then(setImageGenConfig)
			.catch(() => undefined);
		void api.settings
			.get()
			.then((next) => {
				setSettings(next);
				setSettingsLoaded(true);
				setEnhanceModel(next.enhanceModel ?? null);
				setEnhanceIncludeContext(next.enhanceIncludeContext === true);
				setPromptSuggestionEnabled(next.promptSuggestionEnabled !== false);
				setPromptSuggestionModel(next.promptSuggestionModel ?? null);
				piUpdate.setCustomPiPath(next.customPiPath ?? "");
				if (!Object.values(next.externalEditors).some((editor) => editor.command)) {
					void api.editors
						.redetect()
						.then((updated) => {
							setSettings(updated);
						})
						.then(() => workspace.loadExternalEditors())
						.catch(() => undefined);
				}
				if (!next.piEnvironmentChecked) {
					window.setTimeout(() => {
						void piUpdate.checkPiInstall("startup");
					}, 300);
				}
			})
			.catch(() => {
				setSettingsLoaded(true);
			});
	}, []);

	const commitExpandedSidebarProjects = useCallback((next: Set<string>) => {
		expandedSidebarFromSettingsRef.current = true;
		expandedSidebarProjectsRef.current = next;
		setExpandedSidebarProjects(next);
		saveExpandedSidebarProjectsToLocal(next);
		void api.settings
			.update({ sidebarExpandedProjectIds: [...next] })
			.then((saved) => {
				setSettings((current) => ({
					...current,
					sidebarExpandedProjectIds: saved.sidebarExpandedProjectIds,
				}));
			})
			.catch(() => undefined);
	}, []);

	const setProjectSidebarExpanded = useCallback(
		(projectId: string, forceExpand?: boolean) => {
			const prev = expandedSidebarProjectsRef.current;
			const next = new Set(prev);
			const shouldExpand = forceExpand ?? !next.has(projectId);
			if (shouldExpand) next.add(projectId);
			else next.delete(projectId);
			const unchanged = next.size === prev.size && [...next].every((id) => prev.has(id));
			if (unchanged) return next;
			commitExpandedSidebarProjects(next);
			return next;
		},
		[commitExpandedSidebarProjects],
	);

	useEffect(() => {
		const projectIds = new Set(projects.map((project) => project.id));
		setVisibleProjectChildCountByProject((current) => Object.fromEntries(Object.entries(current).filter(([projectId]) => projectIds.has(projectId))));
		setSessionLoadingByProject((current) => Object.fromEntries(Object.entries(current).filter(([projectId]) => projectIds.has(projectId))));
	}, [projectIdsKey]);

	useEffect(() => {
		if (!expandedProjectsReady) return;
		for (const project of projects) {
			if (!expandedProjects.has(project.id)) continue;
			const loadState = store.get(sessionCatalogLoadStateAtom)[project.id];
			if (loadState?.status === "loading" || loadState?.status === "ready") continue;
			void refreshProjectSessions(project.id).catch(() => undefined);
		}
	}, [expandedProjects, expandedProjectsReady, projectIdsKey, refreshProjectSessions, store]);

	useEffect(() => {
		if (activeAgentId && !isPendingAgentId(activeAgentId)) void refreshRuntimeState(activeAgentId);
	}, [activeAgentId]);

	useEffect(() => {
		const liveAgentIds = new Set(displayAgents.map((agent) => agent.id));
		const liveProjectIds = new Set(projects.map((project) => project.id));
		pruneTerminalDockState(liveAgentIds, liveProjectIds);
	}, [displayAgents, projects]);

	useEffect(() => {
		if (!expandedProjectsReady || !activeProjectId || !expandedProjects.has(activeProjectId)) return;

		let disposed = false;
		const scheduleRefresh = () => {
			if (disposed) return;
			void refreshProjectSessions(activeProjectId, true).catch(() => undefined);
		};
		scheduleRefresh();
		if (!activeProjectHasBusyAgent) {
			return () => {
				disposed = true;
			};
		}

		const timer = window.setInterval(scheduleRefresh, 15_000);
		return () => {
			disposed = true;
			window.clearInterval(timer);
		};
	}, [activeProjectId, activeProjectHasBusyAgent, activeProjectSessionSyncKey, expandedProjects, expandedProjectsReady]);

	useLayoutEffect(() => {
		setComposerOffsetHeight(composerRef.current?.offsetHeight ?? 0);
	}, [activeAgentId, activeQueuedPrompts.length, composerRef]);

	useEffect(() => {
		try {
			saveSessionSourceFilter(sessionSourceFilter);
		} catch (error) {}
	}, [sessionSourceFilter]);

	useEffect(() => {
		void api.sessions.setFocusedSession(currentSessionId).catch(() => undefined);
	}, [currentSessionId]);

	useEffect(() => {
		if (!currentSessionId) return;
		const record = store.get(sessionRecordByIdAtomFamily(currentSessionId));
		if (record) writeLastSessionPreference({ sessionId: record.id, projectId: record.projectId });
	}, [currentSessionId, store]);

	const lastSessionRestoreRef = useRef(false);
	useEffect(() => {
		if (lastSessionRestoreRef.current || currentSessionId || !settingsLoaded || projects.length === 0) return;
		const saved = readLastSessionPreference();
		lastSessionRestoreRef.current = true;
		if (!saved) return;
		const requestAtSchedule = openSessionRequestRef.current;

		const timer = window.setTimeout(() => {
			if (store.get(currentSessionIdAtom) || openSessionRequestRef.current !== requestAtSchedule) return;
			void (async () => {
				let record = store.get(sessionRecordByIdAtomFamily(saved.sessionId));
				if (!record && projects.some((project) => project.id === saved.projectId)) {
					await refreshProjectSessions(saved.projectId, true).catch(() => undefined);
					record = store.get(sessionRecordByIdAtomFamily(saved.sessionId));
				}
				if (!record || store.get(currentSessionIdAtom) || openSessionRequestRef.current !== requestAtSchedule) return;

				if (record.backend === "qoder") return;
				workspaceChrome.registerOpenSession(record.id, "permanent");
				selectSessionCommand(record.projectId, record.id, false);
			})();
		}, 350);
	}, [currentSessionId, projects, refreshProjectSessions, selectSessionCommand, settingsLoaded, store, workspaceChrome]);

	useUserMessageEditReplay({
		setPrompt,
		pendingComposerCaretRef,
		composerRef: composerTextareaRef,
		currentSessionIdRef,
	});

	useEffect(() => {
		const handler = (event: Event) => {
			const detail = (event as CustomEvent<{ refs?: string[] }>).detail;
			const refs = detail?.refs;
			if (!refs?.length) return;
			setPrompt((current) => `${current}${current.endsWith(" ") || current.length === 0 ? "" : " "}${refs.join(" ")} `);
		};
		window.addEventListener("composer-attach-refs", handler);
		return () => window.removeEventListener("composer-attach-refs", handler);
	}, []);

	useEffect(() => {
		if (!activeProjectId) return;

		const activeProject = projects.find((p) => p.id === activeProjectId);
		const loadState = store.get(sessionCatalogLoadStateAtom)[activeProjectId];
		if (expandedProjectsReady && activeProject && expandedProjects.has(activeProjectId) && loadState?.status !== "loading" && loadState?.status !== "ready") {
			void refreshProjectSessions(activeProjectId).catch(() => undefined);
		}
	}, [activeProjectId, expandedProjects, expandedProjectsReady, projects, refreshProjectSessions, store]);

	useEffect(() => {
		if (!activeProjectId) {
			setGitInfo({ current: null, branches: [] });
			return;
		}
		let cancelled = false;
		void api.git
			.branches(activeProjectId)
			.then((info) => {
				if (!cancelled) setGitInfo(info);
			})
			.catch(() => {
				if (!cancelled) setGitInfo({ current: null, branches: [] });
			});
		return () => {
			cancelled = true;
		};
	}, [activeProjectId]);

	useEffect(() => {
		if (!activeProjectId) return;
		let stopped = false;
		const refreshGitInfo = async () => {
			try {
				const next = await api.git.branches(activeProjectId);
				if (stopped) return;

				setGitInfo((current) => (current.current === next.current && current.branches.join("\n") === next.branches.join("\n") ? current : next));

				setBranchByProject((prev) => (prev[activeProjectId] === next.current ? prev : { ...prev, [activeProjectId]: next.current }));
			} catch {
				if (!stopped) {
					setGitInfo({ current: null, branches: [] });
				}
			}
		};
		void refreshGitInfo();

		const offRefsChanged = api.git.onRefsChanged((changedWatchId) => {
			if (changedWatchId !== watchId || stopped) return;
			void refreshGitInfo();
		});
		const watchPromise = api.git.watchRefs(activeProjectId).catch(() => null);
		let watchId: string | null = null;
		void watchPromise.then((id) => {
			watchId = id;
		});
		return () => {
			stopped = true;
			offRefsChanged();

			void watchPromise.then((id) => {
				if (id) void api.git.unwatchRefs(id);
			});
		};
	}, [activeProjectId]);

	async function deleteDraftSession(session: SessionRecord) {
		try {
			await api.sessions.deleteRecord(session.id);

			removeSessionState(session.id);
			removeSessionComposerState(session.id);
		} catch (error) {
			showToast(error instanceof Error ? error.message : String(error), 4000);
		}
	}

	async function reorderProjects(sourceProjectId: string, targetProjectId: string, position: "before" | "after" = "after") {
		if (sourceProjectId === targetProjectId) return;
		const sourceProject = projects.find((project) => project.id === sourceProjectId);
		const targetProject = projects.find((project) => project.id === targetProjectId);
		if (isChatProject(sourceProject) || isChatProject(targetProject)) return;

		const previousProjects = projects;
		const nextProjects = reorderProjectList(projects, (project) => project.id, sourceProjectId, targetProjectId, position);
		if (nextProjects === previousProjects) return;
		setProjects([...nextProjects]);

		try {
			const savedProjects = await api.projects.reorder(nextProjects.map((project) => project.id));
			setProjects(savedProjects);
		} catch (error) {
			setProjects(previousProjects);
			showToast(
				t("app.projectSortFailed", {
					error: error instanceof Error ? error.message : String(error),
				}),
				4000,
			);
		}
	}

	async function setProjectPinned(project: Project, pinned: boolean) {
		if (isChatProject(project)) return;
		try {
			const savedProjects = await api.projects.setPinned(project.id, pinned);
			setProjects(savedProjects);
		} catch (error) {
			showToast(
				t("app.projectSortFailed", {
					error: error instanceof Error ? error.message : String(error),
				}),
				4000,
			);
		}
	}

	async function addProject() {
		const project = await api.projects.add();
		if (!project) return;
		await refreshProjects();
		setActiveProjectId(project.id);
		await refreshProjectSessions(project.id);
	}

	function updateAfterProjectRemoved(removedProjectId: string, next: Project[]) {
		setVisibleProjectChildCountByProject((current) => {
			const updated = { ...current };
			delete updated[removedProjectId];
			return updated;
		});
		if (activeProjectId === removedProjectId) {
			setActiveProjectId(next[0]?.id);
		}
		if (sessionsProjectId === removedProjectId) {
			setSessionsProjectId(undefined);
			if (drawer === "sessions") workspace.closeDrawer();
		}
	}

	function adjustMenuPos(x: number, y: number, width = 200, height = 260) {
		const vw = window.innerWidth;
		const vh = window.innerHeight;
		return {
			x: x + width > vw ? Math.max(4, vw - width - 8) : x,
			y: y + height > vh ? Math.max(4, vh - height - 8) : y,
		};
	}

	useEffect(() => {
		for (const sessionId of Object.keys(queue.queuedPrompts)) {
			if (queue.canFlushQueuedPrompt(sessionId)) {
				void queue.flushNextQueuedPrompt(sessionId);
			}
		}
	}, [activeProjectRuntimeCapabilities, agents, queue.queuedPrompts]);

	const { editMessage, deleteMessage, removeMessageImage, resendUserMessage, forkFromUserMessage, forkAtEntry, forkingMessageId } = useSessionHistoryMutations({
		currentSessionId,
		getRuntimeTargetForSession,
		getRuntimeTargetForAgent,
		isSessionRuntimeLive,
		showConfirm: overlays.showConfirm,
		clearConfirm: overlays.clearConfirm,
		showToast,
		translateAgentErrorMessage,
		submitPromptSnapshot,
		openReplacedRuntimeSession,
		setPromptForAgent,
		setCurrentSessionIdRef: (sessionId) => {
			currentSessionIdRef.current = sessionId;
		},
		isAgentCurrentlyBusy,
		resolveProjectId: (sessionId) => getSessionRecord(sessionId)?.projectId ?? activeProjectId,
		hasPersistedSessionFile: (sessionId) => {
			const record = getSessionRecord(sessionId);
			return Boolean(record?.filePath) && !record?.noSession;
		},

		isImageGenSession: (sessionId) => (store.get(sessionMessagesCacheAtom)?.[sessionId]?.messages ?? []).some((message) => message.meta?.imageGen !== undefined),

		isLastUserMessage: (sessionId, message) => {
			const cached = store.get(sessionMessagesCacheAtom)?.[sessionId]?.messages;
			if (!cached) return false;
			const index = cached.findIndex((candidate) => candidate.id === message.id);
			if (index < 0) return false;
			return !cached.slice(index + 1).some((candidate) => candidate.role === "user");
		},

		restoreImageGenTurn: (sessionId, text, images) => {
			setSessionDraft({ sessionId, value: text });
			if (!images?.length) return;

			void hydrateImageContents(images, (ref) => window.piDesktop.imagegen.readImageBlob(ref))
				.then((hydrated) => {
					if (hydrated.length > 0) {
						setSessionAttachments({ sessionId, value: hydrated });
						return;
					}
					if (images.length > 0) showToast(t("imagegen.referenceUnavailable"));
				})
				.catch(() => showToast(t("imagegen.referenceUnavailable")));
		},
	});

	async function handleAttachFile() {
		try {
			const paths = await window.piDesktop.dialog.pickFiles({
				title: t("menu.attachFile"),
			});
			if (paths.length > 0) {
				window.dispatchEvent(new CustomEvent("composer-attach-paths", { detail: { paths } }));
			}
		} catch {}
	}

	const { updateSettings, restartWebService, webServiceChanging } = useSettingsUpdater({
		showToast,
		piUpdate,
		onSettingsApplied: setSettings,
		onProjectsChanged: setProjects,
		activeProjectId,
		refreshProjectSessions,
		webServiceEnabled: settings.webServiceEnabled,
	});

	const switchBranch = useCallback(
		async (branch: string) => {
			if (!activeProjectId || !branch || branch === gitInfo.current) return;
			try {
				const next = await api.git.checkout(activeProjectId, branch);
				setGitInfo(next);
				setBranchByProject((prev) => ({ ...prev, [activeProjectId]: next.current }));
			} catch (error) {
				showToast(
					t("app.branchSwitchFailed", {
						error: error instanceof Error ? error.message : String(error),
					}),
				);
				const refreshed = await api.git.branches(activeProjectId).catch(() => ({ current: null, branches: [] }));
				setGitInfo(refreshed);
			}
		},
		[activeProjectId, gitInfo.current, showToast],
	);

	const createBranch = useCallback(
		async (branchName: string) => {
			if (!activeProjectId || !branchName.trim()) return;
			try {
				const next = await api.git.createBranch(activeProjectId, branchName);
				setGitInfo(next);
				setBranchByProject((prev) => ({ ...prev, [activeProjectId]: next.current }));
				showToast(t("app.branchCreated", { branch: branchName }), 2500);
			} catch (error) {
				showToast(
					t("app.branchCreateFailed", {
						error: error instanceof Error ? error.message : String(error),
					}),
				);
			}
		},
		[activeProjectId, showToast],
	);

	const { deleteSidebarSession, archiveSidebarSession, unarchiveSidebarSession, listArchivedSidebarSessions, deleteArchivedSidebarSession, requestDeleteSidebarSession } = useSidebarArchiveActions({
		activeProjectId,
		showToast,
		overlays,
		refreshProjectSessions,
		dismissSessionTree,
		getSessionRecords: getProjectSessionRecords,
	});

	async function removeSidebarProject(project: Project) {
		try {
			const next = await api.projects.remove(project.id);
			setProjects(next);
			updateAfterProjectRemoved(project.id, next);
		} catch (error) {
			if (String(error instanceof Error ? error.message : error).includes("PROJECT_HAS_RUNNING_AGENT")) {
				overlays.showConfirm({
					title: t("app.projectRemoveBlockedTitle"),
					message: t("app.projectRemoveBlockedByAgent"),
					confirmLabel: t("app.projectRemoveBlockedAck"),
					onConfirm: () => overlays.clearConfirm(),
				});
			} else {
				showToast(error instanceof Error ? error.message : String(error), 5000);
			}
		}
	}

	async function changeChatPath(project: Project) {
		const picked = await api.projects.chooseChatPath();
		if (!picked || picked === project.path) return;
		try {
			await api.projects.setChatPath(picked);
			await refreshProjectSessions(project.id);
			showToast(t("app.chatProjectPathUpdated"), 1800);
		} catch (error) {
			const message = String(error instanceof Error ? error.message : error);
			showToast(message.includes("CHAT_PATH_OVERLAPS_PROJECT") ? t("app.chatPathOverlapsProject") : message, 5000);
		}
	}

	const ensureProjectCatalogLoaded = useCallback(
		(projectId: string, silent = false) => {
			const loadState = store.get(sessionCatalogLoadStateAtom)[projectId];
			if (loadState?.status === "loading" || loadState?.status === "ready") return;
			void refreshProjectSessions(projectId, silent).catch(() => undefined);
		},
		[store, refreshProjectSessions],
	);

	const sidebarActions: SidebarActions = {
		projects: {
			add: addProject,
			select: (projectId) => {
				selectProjectCommand(projectId);

				ensureProjectCatalogLoaded(projectId);
			},
			refresh: async (projectId) => {
				const project = projects.find((candidate) => candidate.id === projectId);
				if (project) await refreshProjectTree(project);
			},
			refreshAll: refreshAllProjects,
			reorder: reorderProjects,
			setPinned: setProjectPinned,
			reveal: (project) => api.files.showInFolder(project.path),
			openWithEditor: (project) => {
				workspace.openExternalEditorChooser(project.path, { x: 80, y: 80 });
			},
			importSessions: (project, source) => {
				if (source === "codex") return openCodexImport(project);
				if (source === "claude") return openClaudeImport(project);
				if (source === "qoder") return openQoderImport(project);
				if (source === "zcode") return openZCodeImport(project);
				if (source === "workbuddy") return openWorkBuddyImport(project);
				if (source === "cursor") return openCursorImport(project);
				if (source === "kimi") return openKimiImport(project);
				if (source === "kimiwork") return openKimiWorkImport(project);
				if (source === "minimax") return openMinimaxImport(project);
				return openOpenCodeImport(project);
			},
			importDirectorySessions: (project) => openDirectoryImport(project),
			manageResources: (project) => setProjectResourcesProject(project),
			manageAutomations: (projectId) => openAutomationPage(projectId),
			toggleWorktree: toggleProjectWorktree,
			copyPath: async (project) => {
				await navigator.clipboard.writeText(project.path);
				showToast(t("common.copied"));
			},
			remove: removeSidebarProject,
			rename: rename.openProjectRename,
			changeChatPath,
		},
		sessions: {
			simpleNavigation: settings.navigationMode === "simple",
			open: async (projectId, sessionId, tabMode) => {
				await openSidebarSessionByIdWithTab(projectId, sessionId, settings.navigationMode === "simple" ? "permanent" : (tabMode ?? settings.sessionTabOpenMode));
			},

			ensureCatalogsLoaded: (projectIds) => {
				for (const projectId of projectIds) ensureProjectCatalogLoaded(projectId, true);
			},
			beginDrag: workspaceChrome.beginDrag,
			endDrag: workspaceChrome.endDrag,
			createDraft: async (projectId) => {
				await createSessionDraftWithTab(projectId);
			},

			createSideTask: async (projectId, backend) => {
				await sideTasks.create({ projectId, backend });
			},
			createAnonymous: async (projectId) => {
				await createAnonymousSessionWithTab(projectId);
			},

			createAcp: async (projectId, toolId) => {
				const tool = store.get(acpToolsAtom).find((candidate) => candidate.id === toolId);
				if (!tool) {
					showToast(t("app.acpNoTools"), 3000);
					return;
				}
				const session = await api.sessions.createDraft({ projectId, title: tool.name, backend: "acp", acpToolId: tool.id });
				upsertSession(session);
				selectSessionCommand(projectId, session.id, false);
				workspaceChrome.registerOpenSession(session.id, "permanent");
			},
			deleteDraft: deleteDraftSession,
			rename: rename.openSessionRename,
			export: runExportSidebarSession,
			copy: runCopySidebarSession,
			copyPath: async (session) => {
				const path = session.filePath;
				if (!path) {
					showToast(t("menu.copySessionFilePathUnavailable"), 3000);
					return;
				}
				await navigator.clipboard.writeText(path);
				showToast(t("common.copied"));
			},
			openFile: (session) =>
				api.files.open(session.filePath).catch((error) => {
					showToast(t("app.openFileFailed", { error: error instanceof Error ? error.message : String(error) }), 4000);
				}),
			delete: async (projectId, session) => {
				requestDeleteSidebarSession(projectId, session);
			},

			runControl: async (sessionId, action) => {
				await runSessionControl(sessionId, action);
			},

			openProxySetting: (sessionId) => setProxyDialogSessionId(sessionId),
			archive: async (projectId, session) => {
				await archiveSidebarSession(projectId, session);
			},
			unarchive: async (archived, projectId) => {
				await unarchiveSidebarSession(archived.filePath, projectId);
			},
			listArchived: () => listArchivedSidebarSessions(),
			deleteArchived: async (archivedPath) => {
				await deleteArchivedSidebarSession(archivedPath);
			},
		},
		agents: {
			rename: rename.openAgentRename,
			export: (agent) => exportAgentHtml(agent.id),
			copySession: (agent) => cloneAgentSession(agent.id),
			copyPath: async (agent) => {
				if (!agent.sessionPath) return;
				await navigator.clipboard.writeText(agent.sessionPath);
				showToast(t("common.copied"));
			},
			openSessionFile: (agent) =>
				agent.sessionPath
					? api.files.open(agent.sessionPath).catch((error) => {
							showToast(t("app.openFileFailed", { error: error instanceof Error ? error.message : String(error) }), 4000);
						})
					: Promise.resolve(),
			close: requestCloseAgent,

			runControl: async (sessionId, action) => {
				await runSessionControl(sessionId, action);
			},
		},
		worktrees: {
			create: async (projectId, branchName) => {
				await createWorktree(projectId, branchName);
			},
			remove: (parentProjectId, entry, childProject) => {
				requestRemoveWorktree(parentProjectId, entry.path, childProject);
				return Promise.resolve();
			},
		},
		rpc: {
			getLogging: (agentId) => {
				const target = getRuntimeTargetForAgent(agentId);
				return target ? api.rpcLogs.getLogging(target) : Promise.resolve(false);
			},
			setLogging: (agentId, enabled) => {
				const target = getRuntimeTargetForAgent(agentId);
				if (!target) return Promise.resolve(false);

				return api.rpcLogs.setLogging(target, enabled).then((receipt) => {
					patchRpcLoggingAgentIds(agentId, receipt);
					return receipt;
				});
			},
			listLogs: (agentId) => {
				const target = getRuntimeTargetForAgent(agentId);
				return target ? api.rpcLogs.get({ target }) : Promise.resolve([]);
			},

			openViewer: (agentId) => workspace.openRpcLogPanel(agentId),
		},
	};

	const sidebarContentNode = (
		<AppSidebar
			simple={settings.navigationMode === "simple"}
			listCollapsed={listCollapsed}
			toggleListCollapsed={toggleListCollapsed}
			actions={sidebarActions}
			currentProjectId={activeProjectId}
			currentSessionId={currentSessionId}
			worktreesByProject={worktreesByProject}
			branchByProject={branchByProject}
			creatingWorktree={worktreeCreating}
			removingWorktreePaths={removingWorktreePaths}
			isLanWeb={isLanWeb}
			onOpenNewSession={() => {
				if (activeProjectId) selectProjectCommand(activeProjectId);
			}}
			onOpenFeedback={() => overlays.setFeedbackOpen(true)}
			settingsExpandedProjectIds={settings.sidebarExpandedProjectIds}
			settingsNavTab={settings.sidebarNavTab}
			settingsPinnedSessionIds={settings.pinnedSessionIds}
			settingsSessionSortMode={settings.sessionSortMode}
			stickyGroupHeaders={settings.sidebarStickyGroupHeaders === true}
			settingsLoaded={settingsLoaded}
			onExpandedProjectsReady={() => setExpandedProjectsReady(true)}
			appInfo={appInfo}
			themeMode={settings.theme}
			onToggleTheme={() => {
				void api.settings
					.update({
						theme: toggleThemeMode(settings, window.matchMedia?.("(prefers-color-scheme: dark)")?.matches ?? false),
					})
					.then((saved) => setSettings((current) => ({ ...current, theme: saved.theme })))
					.catch(() => undefined);
			}}
		/>
	);

	const focusSessionPane = useCallback(
		(sessionId: string) => {
			const record = store.get(sessionRecordByIdAtomFamily(sessionId));
			if (record) selectSessionCommand(record.projectId, sessionId, true);
		},
		[selectSessionCommand, store],
	);

	const navigation = useSessionNavigation(currentSessionId, (id) => {
		workspaceChrome.registerOpenSession(id, "permanent");
		focusSessionPane(id);
	});

	const jumpToAskSession = useCallback(
		(sessionId: string) => {
			const record = store.get(sessionRecordByIdAtomFamily(sessionId));
			if (!record) return;
			workspaceChrome.registerOpenSession(sessionId, "permanent");
			selectSessionCommand(record.projectId, sessionId, true);
		},
		[selectSessionCommand, store, workspaceChrome],
	);

	useBackgroundAskPatrol({ onFocusSession: jumpToAskSession });

	const chatPaneContentRef = useRef<HTMLDivElement>(null);
	const prevSessionIdRef = useRef(currentSessionId);
	useEffect(() => {
		const el = chatPaneContentRef.current;
		if (!el || prevSessionIdRef.current === currentSessionId) return;
		const prev = prevSessionIdRef.current;
		prevSessionIdRef.current = currentSessionId;

		if (settings.navigationMode === "simple") return;

		const layout = workspaceChrome.splitLayout;
		const splitIds = layout ? splitLayoutSessionIds(layout) : [];
		const prevInSplit = Boolean(layout && prev && splitIds.includes(prev));
		const nextInSplit = Boolean(layout && currentSessionId && splitIds.includes(currentSessionId));
		if (prevInSplit && nextInSplit) return;
		if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
		const anim = el.animate(
			[
				{ opacity: 0, transform: "translateY(4px)" },
				{ opacity: 1, transform: "none" },
			],

			{ duration: DURATION_SLOW_MS, easing: EASE_OUT_QUINT_CSS },
		);
		return () => anim.cancel();
	}, [currentSessionId, workspaceChrome.splitLayout, settings.navigationMode]);

	const buildTabsSessionActions = (sessionId: string): SessionTabsBarProps["sessionActions"] => {
		const record = store.get(sessionRecordsAtom)[sessionId];
		if (!record) return undefined;
		const runtime = store.get(sessionRuntimeBySessionIdAtomFamily(sessionId));
		const isLive = isLiveRuntimeStatus(runtime?.status);
		const agentId = runtime?.agentId;

		const canRename = record.status !== "draft";
		return {
			canCopySession: canRename && record.backend !== "acp",
			canExportHtml: canRename && record.backend !== "acp",
			hasFilePath: Boolean(record.filePath),

			onCreateSideTask: () => void sideTasks.create({ projectId: record.projectId, backend: record.backend }),
			onCopySession: () => {
				if (isLive && agentId) {
					void cloneAgentSession(agentId);
					return;
				}
				void runCopySession(sessionId, record.projectId);
			},
			onCopySessionFilePath: () => {
				void (async () => {
					const path = record.filePath;
					if (!path) {
						showToast(t("menu.copySessionFilePathUnavailable"), 3000);
						return;
					}
					await navigator.clipboard.writeText(path);
					showToast(t("common.copied"));
				})();
			},
			onOpenSessionFile: record.filePath
				? () => {
						const filePath = record.filePath;
						if (!filePath) return;
						api.files.open(filePath).catch((error) => {
							showToast(
								t("app.openFileFailed", {
									error: error instanceof Error ? error.message : String(error),
								}),
								4000,
							);
						});
					}
				: undefined,
			onExportSessionHtml: () => {
				if (isLive && agentId) {
					void exportAgentHtml(agentId);
					return;
				}
				api.sessions
					.exportRecordHtml(sessionId)
					.then((result) => showToast(t("app.exportedPath", { path: result.path }), 3500))
					.catch((error) => showToast(error instanceof Error ? error.message : String(error), 5000));
			},
			onRename: canRename
				? () => {
						const agent = agentId ? [...displayAgents, ...pendingAgents].find((candidate) => candidate.id === agentId) : undefined;
						if (isLive && agent) {
							rename.openAgentRename(agent);
							return;
						}
						rename.openSessionRename(record.projectId, {
							id: record.id,
							filePath: record.filePath ?? "",
							name: record.title,
							preview: record.preview,
							updatedAt: record.updatedAt,
							messageCount: record.messageCount,
							backend: record.backend,
							forked: record.forked,
						});
					}
				: undefined,
		};
	};

	const buildTabsRunControl = (sessionId: string): SessionRunControlView | undefined => {
		const capabilities = getSessionRunCapabilities(sessionId);
		if (!capabilities) return undefined;
		const target = getRuntimeTargetForSession(sessionId);
		const record = store.get(sessionRecordsAtom)[sessionId];
		return {
			capabilities,
			isStopping: Boolean(stoppingAgentId && stoppingAgentId === target?.agentId),
			isRestarting: Boolean(target?.agentId && restartingAgentId === target.agentId) || activatingSessionId === sessionId,
			isReloading: reloadingSessionId === sessionId,
			reloadMode: resolveSessionReloadMode(record?.backend),
			onAction: (action) => void runSessionControl(sessionId, action),
		};
	};

	const tabsSessionActions = currentSessionId ? buildTabsSessionActions(currentSessionId) : undefined;

	useEffect(() => {
		if (settings.navigationMode === "simple" && workspaceChrome.previewSessionTabId) workspaceChrome.promotePreview(workspaceChrome.previewSessionTabId);
	}, [settings.navigationMode, workspaceChrome.previewSessionTabId, workspaceChrome.promotePreview]);

	const workspacePageTabItems: WorkspacePageTabItem[] = sortWorkspacePageIds(openWorkspacePageIds).map((pageId) => ({
		id: pageId,
		title: t(pageId === "automation" ? "automation.title" : pageId === "agents" ? "agentMarket.title" : "favorites.title"),
		icon: pageId === "automation" ? Clock : pageId === "agents" ? Bot : Star,
		active: activeWorkspacePage === pageId,
		onSelect: () => openWorkspacePage(pageId),
		onClose: () => closeWorkspacePage(pageId),
	}));

	const sessionTabsProps = {
		tabs: workspaceChrome.sessionTabIds,

		tabMaxWidth: settings.sessionTabMaxWidth,
		pinnedTabs: workspaceChrome.pinnedSessionTabIds,
		previewTabId: workspaceChrome.previewSessionTabId,
		currentSessionId,
		onSelect: workspaceChrome.selectTab,
		onPromotePreview: workspaceChrome.promotePreview,
		onClose: workspaceChrome.closeTab,
		onCloseOthers: workspaceChrome.closeOtherTabs,
		onCloseAll: workspaceChrome.closeAllTabs,

		newSessionTargets: projects
			.map((project) => ({
				projectId: project.id,
				label: isChatProject(project) ? t("app.chatProject") : project.name,
				isChat: isChatProject(project),
			}))
			.sort((a, b) => Number(b.isChat) - Number(a.isChat)),
		onNewSessionInProject: (projectId: string) => {
			// 新会话先落在 renderer-only 引导页；首次发送由 ensureSessionForSend 创建真实会话。
			selectProjectCommand(projectId);
		},

		onNewAcpSession: (projectId: string, toolId: string) => {
			void sidebarActions.sessions.createAcp(projectId, toolId);
		},
		onTogglePin: workspaceChrome.togglePin,
		onReorder: workspaceChrome.reorderTab,

		splitGroupIds: workspaceChrome.splitLayout ? splitLayoutSessionIds(workspaceChrome.splitLayout) : [],
		splitGroupCollapsed: workspaceChrome.splitGroupCollapsed,
		onToggleSplitGroup: workspaceChrome.toggleSplitGroupCollapsed,
		splitGroupName: workspaceChrome.splitGroupConfig.name,
		splitGroupColor: workspaceChrome.splitGroupConfig.color,
		onSplitGroupRename: (name: string) => workspaceChrome.setSplitGroupConfig((config) => ({ ...config, name })),
		onSplitGroupColorChange: (color: string) => workspaceChrome.setSplitGroupConfig((config) => ({ ...config, color })),
		onExitAllSplit: workspaceChrome.exitAllSplit,

		runControl: currentSessionId
			? {
					capabilities: getSessionRunCapabilities(currentSessionId),
					isStopping: Boolean(stoppingAgentId && stoppingAgentId === activeAgentId),
					isRestarting: restartingAgentId === activeAgentId || activatingSessionId === currentSessionId,
					isReloading: reloadingSessionId === currentSessionId,
					reloadMode: resolveSessionReloadMode(currentSessionRecord?.backend),

					agentId: activeAgentId,
					onCloseAgent: activeAgentId ? () => requestCloseAgentForSession(currentSessionId) : undefined,
					onAction: (action: SessionRunAction) => void runSessionControl(currentSessionId, action),
				}
			: undefined,

		contextRunControl: buildTabsRunControl,

		onOpenProxySetting: currentSessionId && getSessionRecord(currentSessionId)?.backend !== "acp" ? () => setProxyDialogSessionId(currentSessionId) : undefined,
		onToggleDrawer: toggleRightDrawer,
		drawerOpen: Boolean(drawer && !drawerCollapsed),
		listCollapsed,
		onToggleListCollapsed: toggleListCollapsed,
		onDragSessionChange: (sessionId: string | null) => {
			if (sessionId) workspaceChrome.beginDrag(sessionId);
			else workspaceChrome.endDrag();
		},
	};

	const paneLayoutRefs = useMemo(
		() => ({
			chatHeaderRef,
			composerRef,
			composerOffsetHeight,
			terminalRowHeight,
		}),
		[composerOffsetHeight, terminalRowHeight],
	);

	const activeTerminalOwnerKey = terminalOwner ? terminalOwnerKey(terminalOwner) : undefined;

	const handleProjectGitChanged = useCallback(
		(projectId: string, info: GitBranchInfo) => {
			setBranchByProject((prev) => (prev[projectId] === info.current ? prev : { ...prev, [projectId]: info.current }));
			if (projectId !== activeProjectIdRef.current) return;
			setGitInfo((current) => (current.current === info.current && current.branches.join("\n") === info.branches.join("\n") ? current : info));
		},
		[setBranchByProject],
	);

	const sessionToolActions: SessionToolAction[] = [
		{
			id: "scratch",
			label: t("scratchPad.openTooltip"),
			icon: <Pencil size={14} />,
			active: scratchPad.isOpen,
			onClick: () => scratchPad.toggle(),
		},
		...(!isLanWeb && terminalTarget
			? [
					{
						id: "terminal",
						label: t("app.terminal"),
						icon: <Terminal size={14} />,
						active: terminalOpen,
						onClick: () => {
							setTerminalOpenForOwner(!terminalOpen);
						},
					},
				]
			: []),
		{
			id: "editors",
			label: t("app.openWithEditor"),
			icon: <Code size={14} />,
			active: editorsOpen,
			onClick: (e) => {
				const projectPath = activeAgent?.cwd || (activeProject && !isChatProject(activeProject) ? activeProject.path : null);

				const anchor = adjustMenuPos(e.currentTarget.getBoundingClientRect().left - 4, e.currentTarget.getBoundingClientRect().bottom + 4, 240, 240);
				workspace.openExternalEditorChooser(projectPath || "", anchor);
			},
		},
	];
	const sessionPaneServices = useMemo(
		() => ({
			simpleNavigation: settings.navigationMode === "simple",
			isLanWeb,
			promoteSessionToPermanent: workspaceChrome.promotePreview,
			showToast,
			onOpenFile: handleOpenLinkedFile,
			onDiffFile: diffFilePath,
			onPreviewImage: setPreviewImage,
			abortAgent,
			restartActiveAgent,
			getSessionRunCapabilities,
			runSessionControl,

			requestCloseAgentForSession,
			getSessionMenu: (sessionId: string) => ({
				sessionActions: buildTabsSessionActions(sessionId),
				toolActions: sessionToolActions,
				onOpenProxySetting: getSessionRecord(sessionId)?.backend !== "acp" ? () => setProxyDialogSessionId(sessionId) : undefined,
			}),
			stoppingAgentId,
			activatingSessionId,
			reloadingSessionId,
			openProviderLogin,
			runCreateSessionDraft: async () => {
				await createSessionDraftWithTab();
			},
			enqueueSessionPrompt,
			insertQuickPrompt,
			ensureSessionId: ensureSessionForSend,
			resendUserMessage,
			editMessage,
			deleteMessage,
			removeMessageImage,
			forkFromUserMessage,
			forkingMessageId,
			openSidebarSessionById: async (projectId: string, sessionId: string) => {
				await openSidebarSessionByIdWithTab(projectId, sessionId, "permanent");
			},
			focusAskSessionById: jumpToAskSession,
			agents: displayAgents,
			queuedPromptsBySession: queue.queuedPrompts,
			queueRetract: queue.retractQueuedPromptForEdit,
			queueDiscard: queue.discardQueuedPrompt,
			queueChangeBehavior: queue.setQueuedPromptBehavior,
			queueSuppressAutoDrain: queue.suppressSessionQueueAutoDrain,
			queueFlushBySessionRef,
			restartingAgentId,
			sessionDurationByAgent,
			activeProjectId,
			onProjectGitChanged: handleProjectGitChanged,
			showThinking: settings.showThinking,
			validFilePaths,
			terminalStatesByOwner,
			activeTerminalOwnerKey,
			availableTerminalHeight: availableTerminalHeight ?? 120,
			setTerminalOpenByOwnerKey,
			setTerminalCollapsedByOwnerKey,
			setTerminalHeight,
			terminalSettings,
			hiddenComposerFeatures: settings.hiddenComposerFeatures ?? [],
			onTerminalThemeChange: setTerminalTheme,
			environmentDialog: Boolean(environmentDialog),
			showNotice,
			api,
			changeChatPath,
			jumpToMessageRef,
			layoutRefs: paneLayoutRefs,
			exitSessionSplit: workspaceChrome.exitSplit,
		}),
		[
			abortAgent,
			activeTerminalOwnerKey,
			activeProjectId,
			availableTerminalHeight,
			createSessionDraftWithTab,
			changeChatPath,
			deleteMessage,
			removeMessageImage,
			diffFilePath,
			displayAgents,
			editMessage,
			enqueueSessionPrompt,
			handleProjectGitChanged,
			ensureSessionForSend,
			environmentDialog,
			forkFromUserMessage,
			forkingMessageId,
			handleOpenLinkedFile,
			insertQuickPrompt,
			isLanWeb,
			jumpToAskSession,
			jumpToMessageRef,
			openSidebarSessionByIdWithTab,
			paneLayoutRefs,
			queue.discardQueuedPrompt,
			queue.queuedPrompts,
			queue.retractQueuedPromptForEdit,
			queue.suppressSessionQueueAutoDrain,
			queueFlushBySessionRef,
			restartActiveAgent,
			restartingAgentId,
			getSessionRunCapabilities,
			runSessionControl,
			stoppingAgentId,
			activatingSessionId,
			reloadingSessionId,
			openProviderLogin,
			resendUserMessage,
			sessionDurationByAgent,
			settings.showThinking,
			settings.navigationMode,
			setPreviewImage,
			setTerminalCollapsedByOwnerKey,
			setTerminalHeight,
			setTerminalTheme,
			terminalSettings,
			settings.hiddenComposerFeatures,
			setTerminalOpenByOwnerKey,
			showToast,
			terminalStatesByOwner,
			availableTerminalHeight,
			validFilePaths,
			workspaceChrome.exitSplit,
			workspaceChrome.promotePreview,
		],
	);

	const chatPaneSessionNode = (
		<SessionPaneServicesProvider value={sessionPaneServices}>
			{currentSessionId ? (
				<div ref={chatPaneContentRef} className="flex h-full min-h-0 min-w-0 flex-col">
					<SessionSplitStage
						layout={workspaceChrome.splitLayout && splitLayoutSessionIds(workspaceChrome.splitLayout).includes(currentSessionId) ? workspaceChrome.splitLayout : null}
						draggingSessionId={workspaceChrome.draggingSessionId}
						onDropSplit={workspaceChrome.dropSplit}
						solo={<ChatSessionPane sessionId={currentSessionId} focused onFocusPane={() => focusSessionPane(currentSessionId)} splitPane={false} />}
						soloSessionId={currentSessionId}
						tabCount={workspaceChrome.sessionTabIds.length}
						renderSession={(sessionId) => <ChatSessionPane key={sessionId} sessionId={sessionId} focused={currentSessionId === sessionId} onFocusPane={() => focusSessionPane(sessionId)} splitPane />}
					/>
				</div>
			) : (
				<ResizablePanelGroup key={`empty-terminal-${terminalDockVisible ? "docked" : "solo"}`} orientation="vertical" className="min-h-0 flex-1">
					<ResizablePanel id="empty-main" minSize={200} className="flex min-h-0 flex-col">
						<ProjectEmptyState activeProject={activeProject} projects={projects} onAddProject={() => void addProject()} onSelectProject={selectProjectCommand} />
					</ResizablePanel>
					{!isLanWeb && terminalDockVisible && terminalTarget && (
						<TerminalDockPanel
							target={terminalTarget}
							open={terminalOpen}
							closing={terminalDockClosing}
							collapsed={terminalCollapsed}
							height={terminalRowHeight}
							maxHeight={availableTerminalHeight ?? 120}
							terminal={api.terminal}
							terminalSettings={terminalSettings}
							onThemeChange={setTerminalTheme}
							ownerKey={terminalOwner ? terminalOwnerKey(terminalOwner) : undefined}
							onOpenChange={setTerminalOpenForOwner}
							onCollapsedChange={setTerminalCollapsedForOwner}
							onHeightChange={setTerminalHeight}
						/>
					)}
				</ResizablePanelGroup>
			)}
		</SessionPaneServicesProvider>
	);

	const workbenchTheme: "dark" | "light" = typeof document !== "undefined" && document.documentElement.dataset.theme === "dark" ? "dark" : "light";

	const workbenchHasGitDiff = Boolean(gitDrawerDiff && gitDrawerDiff.projectId === activeProjectId);
	const workbenchHasEditor = Boolean(activeTab) && !workbenchHasGitDiff;
	const workbenchHasContent = workbenchHasGitDiff || workbenchHasEditor;

	const [workbenchContentWidth, setWorkbenchContentWidth] = useState(0);
	const handleWorkbenchContentWidth = useCallback((width: number) => {
		setWorkbenchContentWidth((current) => (current === width ? current : width));
	}, []);
	const simpleMode = settings.navigationMode === "simple";

	const sessionStatusPlacement = parseSessionStatusPlacement(settings.sessionStatusPlacement);
	const [simpleContentExpanded, setSimpleContentExpanded] = useState(false);
	useEffect(() => setSimpleContentExpanded(false), [activeTabId, gitDrawerDiff?.filePath, simpleMode]);
	const workbenchLayout = simpleMode ? (simpleContentExpanded ? "maximize" : "split") : workbenchHasGitDiff ? gitDiffDisplayMode : editorMode;

	const fileTabs = editorTabs.map((tab) => ({
		id: tab.id,
		label: tab.label ?? tab.filePath.split(/[/\\]/).pop() ?? tab.filePath,
		title: tab.filePath,
		preview: tab.id === previewEditorTabId,
		active: !workbenchHasGitDiff && tab.id === activeTabId,
	}));
	const workbenchEditorTabs = [...(simpleMode || !workbenchHasGitDiff ? fileTabs : []), ...(workbenchHasGitDiff && gitDrawerDiff ? [{ id: `git-diff:${gitDrawerDiff.filePath}`, label: gitDrawerDiff.label, title: gitDrawerDiff.filePath, active: true }] : [])];

	const { commandPaletteOpen, setCommandPaletteOpen, openCommandPalette, commandPaletteCommands } = useCommandPalette({
		activeProjectId,
		currentSessionId,
		activeAgentId,
		hiddenModules: settings.hiddenModules ?? [],
		actions: { selectProjectCommand, restartActiveAgent, closeAgent, runSessionControl, openAutomationPage: () => openAutomationPage(), openAgentMarketPage: () => openAgentMarketPage(), openFavoritesPage: () => openFavoritesPage(), openEnvironmentGuide: piUpdate.openEnvironmentGuide },
	});

	useEffect(() => {
		return api.app.onZoomFactorChange((zoomFactor) => {
			setSettings((prev) => (prev.zoomFactor === zoomFactor ? prev : { ...prev, zoomFactor }));
		});
	}, []);

	const selectWorkbenchTab = (id: string) => {
		if (id.startsWith("git-diff:")) return;
		if (workbenchHasGitDiff) dismissGitDiff();
		selectEditorTab(id);
	};
	const closeWorkbenchTab = (id: string) => {
		if (id.startsWith("git-diff:")) {
			if (simpleMode) dismissGitDiff();
			else closeGitDiff();
		} else closeEditorTab(id);
	};
	const toggleSimpleContent = () => setSimpleContentExpanded((value) => !value);

	const hostPluginPageTab = useHostPluginPageTab();
	const sessionTabsBarNode = (
		<SessionTabsBar
			{...sessionTabsProps}
			simple={simpleMode}
			currentSessionId={activeWorkspacePage || hostPluginPageTab ? undefined : currentSessionId}
			pageTabs={workspacePageTabItems}
			pluginTab={simpleMode || activeWorkspacePage ? null : hostPluginPageTab}
			onSelect={(sessionId) => {
				deactivateWorkspacePage();
				hostPluginPageTab?.onClose();
				workspaceChrome.selectTab(sessionId);
			}}
			sessionActions={tabsSessionActions}
			contextSessionActions={buildTabsSessionActions}
			toolActions={sessionToolActions}
			editorTabs={simpleMode ? [] : workbenchEditorTabs}
			onSelectEditorTab={(tabId) => {
				if (workbenchHasGitDiff) return;
				selectEditorTab(tabId);
			}}
			onCloseEditorTab={(tabId) => {
				if (workbenchHasGitDiff) {
					closeGitDiff();
					return;
				}
				closeEditorTab(tabId);
			}}
			onPromoteEditorPreview={promotePreviewEditorTab}
		/>
	);

	const workbenchContentNode = workbenchHasContent ? (
		<WorkbenchContent
			theme={workbenchTheme}
			maxFileSizeMB={settings.maxEditorFileSizeMB}
			editorTabs={editorTabs}
			onDirty={promotePreviewEditorTab}
			gitDiff={workbenchHasGitDiff && gitDrawerDiff ? gitDrawerDiff : null}
			gitDiffDisplayMode={simpleMode ? workbenchLayout : gitDiffDisplayMode}
			onToggleGitDiffMode={simpleMode ? toggleSimpleContent : toggleGitDiffDisplayMode}
			onCloseGitDiff={simpleMode ? dismissGitDiff : closeGitDiff}
			activeTab={activeTab}
			editorMode={simpleMode ? workbenchLayout : editorMode}
			onToggleEditorMode={simpleMode ? toggleSimpleContent : activeTab?.preserveDrawer ? undefined : toggleEditorMode}
			onCloseEditor={() => {
				if (simpleMode && activeTab) closeEditorTab(activeTab.id);
				else closeEditor();
			}}
			readContent={readEditorFileContent}
			readOriginalContent={readEditorOriginalContent}
			saveContent={saveEditorFileContent}
			onAllowSaveTab={allowSaveEditorTab}
		/>
	) : null;

	const chatPaneContentNode = (
		<WorkbenchStage
			simple={simpleMode}
			contentChrome={<WorkbenchFileTabs tabs={workbenchEditorTabs} onSelect={selectWorkbenchTab} onClose={closeWorkbenchTab} onPromote={promotePreviewEditorTab} />}
			chrome={sessionTabsBarNode}
			layout={workbenchLayout}
			hasContent={workbenchHasContent}
			session={
				<div className="relative flex h-full min-h-0 min-w-0 flex-col">
					{chatPaneSessionNode}
					<HostPluginPageOverlay projectId={activeProject?.id} sessionId={currentSessionId} />

					<AutomationPage
						active={activeWorkspacePage === "automation"}
						onViewSession={(projectId, sessionId) => {
							void openSidebarSessionByIdWithTab(projectId, sessionId, "permanent");
						}}
					/>
					<AgentMarketPage active={activeWorkspacePage === "agents"} onUseAgent={handleAgentUseAgent} />

					<FavoritesPage active={activeWorkspacePage === "favorites"} />
				</div>
			}
			content={workbenchContentNode}
			onContentWidthChange={handleWorkbenchContentWidth}
		/>
	);

	const drawerPorts = useDrawerPorts({
		enableGitManagement: settings.enableGitManagement,
		activeProjectId,
		gitDiffDisplayMode,
		openCommitFileDiff,
		openWorkspaceFileDiff,
		toggleGitDiffDisplayMode,
		closeGitDiff,
		dismissGitDiff,
		gitApi: api.git,
		gitInfo,
		switchBranch,
		createBranch,
		openDrawer: workspace.openDrawer,
		closeDrawer: workspace.closeDrawer,
		collapseDrawer: workspace.collapseDrawer,
		closeBrowser: () => workspace.closeBrowser(),
		minimizeBrowser: () => workspace.minimizeBrowser(),
		enterBrowserFullscreen: () => workspace.enterBrowserFullscreen(),
		browserFullscreen,
		rpcLogAgentId: workspace.rpcLogAgentId,
		rpcLogListLogs: sidebarActions.rpc.listLogs,
		rpcLogGetLogging: sidebarActions.rpc.getLogging,
		rpcLogSetLogging: sidebarActions.rpc.setLogging,
		closeRpcLogPanel: workspace.closeRpcLogPanel,
		sessionsProject,
		sessionsProjectId,
		files,
		fileTreeContentRevision,
		sessions,
		sessionSourceFilter,
		sessionHistoryLoading,
		expandedDirs,
		onToggleDirectory: toggleDirectory,
		onCollapseAllDirectories: collapseAllDirectories,
		setFileMenu: (menu: { x: number; y: number; node: FileTreeNode } | null) => {
			setFileMenu(menu);
			if (!menu) return;
			try {
				setHasClipboardFiles(api.files.getClipboardPaths().length > 0);
			} catch {
				setHasClipboardFiles(false);
			}
		},
		refreshFiles: refreshVisibleFiles,
		showToast,
		projects,
		refreshProjectSessions,
		runOpenSidebarSession: async (projectId: string, session: SessionSummary) => {
			const openedId = await runOpenSidebarSession(projectId, session);
			if (openedId) workspaceChrome.registerOpenSession(openedId, "permanent");
		},
		isSameSessionPath,
		runCopySession,
		runExportHistorySession,
		runDeleteHistorySession,
		viewFilePath,
		openFilePath,
		openEditorTab,
		api,
		t,
		projectRoot: activeProject?.path,
		onDropFiles: (targetDir, fileList) => {
			const paths: string[] = [];
			for (let i = 0; i < fileList.length; i++) {
				const file = fileList.item(i);
				if (file) {
					const path = api.files.getPathForFile(file);
					if (path) paths.push(path);
				}
			}
			if (paths.length > 0) {
				void api.files
					.copy(paths, targetDir)
					.then(() => {
						void refreshVisibleFiles();
						showToast(t("app.fileCopyDone", { count: paths.length }), 2000);
					})
					.catch((error) => {
						showToast(error instanceof Error ? error.message : String(error), 4000);
					});
			}
		},
		onPasteFiles: (targetDir) => {
			try {
				const paths = api.files.getClipboardPaths();
				if (paths.length > 0) {
					void api.files
						.copy(paths, targetDir)
						.then(() => {
							void refreshVisibleFiles();
							showToast(t("app.fileCopyDone", { count: paths.length }), 2000);
						})
						.catch((error) => {
							showToast(t("app.filePasteFailed", { error: error instanceof Error ? error.message : String(error) }), 4000);
						});
				}
			} catch {}
		},
		onMoveFiles: (sourcePaths, targetDir) => {
			void api.files
				.move(sourcePaths, targetDir)
				.then(() => {
					void refreshVisibleFiles();
					showToast(t("app.fileMoveDone", { count: sourcePaths.length }), 2000);
				})
				.catch((error) => {
					showToast(error instanceof Error ? error.message : String(error), 4000);
				});
		},
	});

	return (
		<FileLinkBaseProvider baseDir={activeAgent?.cwd ?? activeProject?.path} projectId={activeProject?.id} projectRoot={activeProject?.path} sessionId={currentSessionId}>
			<>
				<WallpaperVideoLayer settings={settings} />
				<AppBootstrap {...bootstrapProps} />
				<AppShell
					navigationChrome={
						simpleMode ? (
							<div className="simple-navigation-bar flex h-8 shrink-0 items-center gap-0.5 bg-(--simple-shell-surface) px-2 [&_button]:[-webkit-app-region:no-drag]">
								<Button variant="ghost" size="icon-sm" className="size-6.5" type="button" aria-label={listCollapsed ? t("app.expandList") : t("app.collapseList")} title={listCollapsed ? t("app.expandList") : t("app.collapseList")} onClick={toggleListCollapsed}>
									<PanelLeft size={14} />
								</Button>
								<Button variant="ghost" size="icon-sm" className="size-6.5" type="button" aria-label={t("navigation.back")} title={t("navigation.back")} disabled={!navigation.canBack} onClick={navigation.back}>
									<ArrowLeft size={14} />
								</Button>
								<Button variant="ghost" size="icon-sm" className="size-6.5" type="button" aria-label={t("navigation.forward")} title={t("navigation.forward")} disabled={!navigation.canForward} onClick={navigation.forward}>
									<ArrowRight size={14} />
								</Button>
							</div>
						) : undefined
					}
					compactContent={
						new URLSearchParams(window.location.search).get("mini-overlay") === "1" ? (
							<MiniOverlaySurface
								activeProjectId={activeProjectId}
								onCreateSession={createSessionDraftWithTab}
								onOpenSession={openSidebarSessionByIdWithTab}
								onSwitchToQuickTask={() => {
									const projectPath = currentSession ? projects.find((item) => item.id === currentSession.projectId)?.path : undefined;
									void api.miniOverlay.switchToQuickTask(projectPath).catch(() => showToast(t("miniOverlay.windowActionFailed"), 4000, "error"));
								}}
							>
								{currentSession ? (
									<SessionPaneServicesProvider value={sessionPaneServices}>
										<ChatSessionPane sessionId={currentSession.id} focused onFocusPane={() => focusSessionPane(currentSession.id)} splitPane={false} />
									</SessionPaneServicesProvider>
								) : null}
							</MiniOverlaySurface>
						) : quickTask.active ? (
							<QuickTaskSurface task={quickTask}>
								<SessionPaneServicesProvider value={sessionPaneServices}>{quickTask.session && <ChatSessionPane sessionId={quickTask.session.id} focused onFocusPane={() => focusSessionPane(quickTask.session!.id)} splitPane={false} />}</SessionPaneServicesProvider>
							</QuickTaskSurface>
						) : undefined
					}
					listCollapsed={listCollapsed}
					listWidth={listWidth}
					drawer={drawer}
					drawerCollapsed={drawerCollapsed}
					drawerWidth={drawerWidth}
					useNativeTitleBar={settings.useNativeTitleBar}
					platform={appInfo.platform}
					chatPaneRef={chatPaneRef}
					terminalRowHeight={terminalRowHeight}
					chatContentWidthPct={settings.chatContentWidthPct}
					outlineContentOffset={workbenchContentWidth}
					sidebarContent={sidebarContentNode}
					chatPaneContent={chatPaneContentNode}
					drawerRail={
						<WorkspaceDrawerRail
							addLabel={t("drawer.addPanel")}
							actions={[
								{
									id: "files",
									label: t("app.files"),
									icon: <FolderOpen size={16} />,
									active: drawer === "files",
									pinned: true,
									onClick: () => handleToolDrawerAction("files"),
								},

								...(settings.enableGitManagement && activeProjectId
									? [
											{
												id: "git",
												label: t("drawer.sourceControl"),
												icon: <GitBranch size={16} />,
												active: drawer === "git",
												pinned: true,
												onClick: () => handleToolDrawerAction("git"),
											},
										]
									: []),

								{
									id: "trajectory",
									label: t("session.view.trajectory"),
									icon: <Activity size={16} />,
									active: drawer === "trajectory",
									pinned: workspace.pinnedPanels.includes("trajectory"),
									canRemove: true,
									onTogglePinned: () => workspace.toggleDrawerPanelPinned("trajectory"),
									onClick: () => handleToolDrawerAction("trajectory"),
								},

								...(rewindSupported
									? [
											{
												id: "branchTree" as const,
												label: t("session.branchTree.title"),

												icon: <ListTree size={16} />,
												active: drawer === "branchTree",
												pinned: workspace.pinnedPanels.includes("branchTree"),
												canRemove: true,
												onTogglePinned: () => workspace.toggleDrawerPanelPinned("branchTree"),
												onClick: () => handleToolDrawerAction("branchTree"),
											},
										]
									: []),

								...(rewindSupported
									? [
											{
												id: "rewind" as const,
												label: t("rewind.title"),
												icon: <History size={16} />,
												active: drawer === "rewind",
												pinned: workspace.pinnedPanels.includes("rewind"),
												canRemove: true,
												onTogglePinned: () => workspace.toggleDrawerPanelPinned("rewind"),
												onClick: () => handleToolDrawerAction("rewind"),
											},
										]
									: []),
								{
									id: "browser",
									label: t("app.browser"),
									icon: <Globe size={16} />,
									active: drawer === "browser",
									pinned: workspace.pinnedPanels.includes("browser"),
									canRemove: true,
									onTogglePinned: () => workspace.toggleDrawerPanelPinned("browser"),
									onClick: () => handleToolDrawerAction("browser"),
								},

								...(sideTasks.ids.length > 0 || drawer === "sideTask"
									? [
											{
												id: "sideTask",
												label: t("sideTask.title"),
												icon: <Rocket size={16} />,
												active: drawer === "sideTask",
												onClick: () => handleToolDrawerAction("sideTask"),
											},
										]
									: []),
								{
									id: "scratchPad",
									label: t("scratchPad.title"),
									icon: <Pencil size={16} />,
									active: scratchPad.isOpen,
									onClick: scratchPad.toggle,
								},

								...(rpcLogTabTargetAgentId
									? [
											{
												id: "rpcLog",
												label: t("drawer.rpcLog"),
												icon: <ScrollText size={16} />,
												active: drawer === "rpcLog",
												onClick: () => {
													if (workspace.drawer === "rpcLog" && !workspace.drawerCollapsed) workspace.closeRpcLogPanel();
													else workspace.openRpcLogPanel(rpcLogTabTargetAgentId);
												},
											},
										]
									: []),
							]}
						/>
					}
					drawerFooter={
						placementShowsSidebarPanel(sessionStatusPlacement) ? (
							<SessionPaneServicesProvider value={sessionPaneServices}>
								<SessionStatusPanel sessionId={currentSessionId} />
							</SessionPaneServicesProvider>
						) : undefined
					}
					drawerContent={(visibleDrawerPanel) => (
						<DrawerSurface
							drawer={visibleDrawerPanel}
							drawerCollapsed={drawerCollapsed}
							git={drawerPorts.git}
							chrome={drawerPorts.chrome}
							browser={drawerPorts.browser}
							files={drawerPorts.files}
							rpcLog={drawerPorts.rpcLog}
							scratchPad={scratchPad}
							sideTask={{ controller: sideTasks, paneServices: sessionPaneServices }}
							branchTree={{ forkAtEntry: (entryId, fallbackText) => void forkAtEntry(entryId, fallbackText, `branch:${entryId}`) }}
						/>
					)}
					setListCollapsed={setListCollapsed}
					setListWidth={setListWidth}
					setDrawerCollapsed={setDrawerCollapsed}
					setDrawerWidth={setDrawerWidth}
					onToggleListCollapsed={toggleListCollapsed}
					drawerPinned={workspace.drawerPinned}
					onDrawerCollapse={workspace.collapseDrawer}
					onDrawerClose={workspace.closeDrawer}
					onDrawerRestore={() => workspace.expandDrawer()}
					onToggleDrawerPin={workspace.toggleDrawerPinned}
					toggleAlwaysOnTop={api.app.toggleAlwaysOnTopWindow}
					isWindowAlwaysOnTop={api.app.isWindowAlwaysOnTop}
					minimizeWindow={api.app.minimizeWindow}
					toggleMaximizeWindow={api.app.toggleMaximizeWindow}
					isWindowMaximized={api.app.isWindowMaximized}
					onWindowMaximizedChange={api.app.onWindowMaximizedChange}
					closeWindow={api.app.closeWindow}
				>
					{fileMenu && (
						<FileContextMenu
							menu={fileMenu}
							hasClipboardFiles={hasClipboardFiles}
							onPaste={(targetDir) => {
								try {
									const paths = api.files.getClipboardPaths();
									if (paths.length > 0) {
										void api.files
											.copy(paths, targetDir)
											.then(() => {
												void refreshVisibleFiles();
												showToast(t("app.fileCopyDone", { count: paths.length }), 2000);
											})
											.catch((error) => {
												showToast(t("app.filePasteFailed", { error: error instanceof Error ? error.message : String(error) }), 4000);
											});
									}
								} catch {}
								setFileMenu(null);
							}}
							onClose={() => setFileMenu(null)}
							onOpen={() => {
								void api.files.open(fileMenu.node.path).catch((error) => {
									showToast(t("app.openFileFailed", { error: error instanceof Error ? error.message : String(error) }), 4000);
								});
								setFileMenu(null);
							}}
							onReveal={() => {
								void api.files.showInFolder(fileMenu.node.path).catch((error) => {
									showToast(t("app.openFileFailed", { error: error instanceof Error ? error.message : String(error) }), 4000);
								});
								setFileMenu(null);
							}}
							onAttach={() => {
								window.dispatchEvent(
									new CustomEvent("composer-attach-refs", {
										detail: {
											refs: [
												fileNodeDragPayloadToRef({
													path: fileMenu.node.path,
													relativePath: fileMenu.node.relativePath,
													type: fileMenu.node.type,
												}),
											],
										},
									}),
								);
								setFileMenu(null);
							}}
							onCopyPath={() => {
								void navigator.clipboard.writeText(fileMenu.node.path);
								setFileMenu(null);
								showToast(t("app.pathCopied"), 1200);
							}}
							onRename={() => {
								const node = fileMenu.node;
								setRenamingFile({ path: node.path, name: node.name });
								setRenamingFileInput(node.name);
								setFileMenu(null);
							}}
							onDelete={() => {
								const node = fileMenu.node;
								setFileMenu(null);
								overlays.showConfirm({
									title: node.type === "directory" ? t("drawer.deleteFolderTitle") : t("drawer.deleteFileTitle"),
									message: node.type === "directory" ? t("drawer.deleteFolderConfirm", { name: node.name }) : t("drawer.deleteFileConfirm", { name: node.name }),
									danger: true,
									confirmLabel: t("common.delete"),
									onConfirm: async () => {
										overlays.clearConfirm();
										try {
											await api.files.delete(node.path, true);
											void refreshVisibleFiles();
											showToast(t("app.fileDeleted"), 2000);
										} catch (error) {
											showToast(t("app.fileDeleteFailed", {}), 5000, "error");
										}
									},
								});
							}}
						/>
					)}

					{projectResourcesProject && (
						<Suspense fallback={null}>
							<ProjectResourcesModal project={projectResourcesProject} onClose={() => setProjectResourcesProject(null)} />
						</Suspense>
					)}
					<RenameModals
						rename={rename.renameModalsProps.rename}
						fileRename={
							renamingFile
								? {
										path: renamingFile.path,
										name: renamingFile.name,
										inputValue: renamingFileInput,
										onInputChange: setRenamingFileInput,
										onClose: () => setRenamingFile(null),
										onConfirm: (path, newName) => {
											void api.files
												.rename(path, newName)
												.then(() => {
													void refreshVisibleFiles();
													setRenamingFile(null);
													showToast(t("app.fileRenamed"), 2000);
												})
												.catch((err) => console.error("[File] rename failed:", err));
										},
									}
								: undefined
						}
					/>

					<EnvironmentOverlay open={environmentDialog}>
						<EnvironmentDialog
							status={piStatus}
							checking={piChecking}
							guide={piGuide}
							setupPreview={piUpdate.environmentSetupPreview}
							onClose={() => {
								setEnvironmentDialog(false);

								piUpdate.setEnvironmentSetupPreview(false);
								piUpdate.setCustomPathResult(null);

								piUpdate.setInstallResult(null);
								piUpdate.setInstallCompleted(false);
								piUpdate.setNpmAvailable(null);

								piGuide.resetGuide();
							}}
							onRecheck={() => {
								piUpdate.setCustomPathResult(null);
								piUpdate.setNpmAvailable(null);
								piUpdate.setNpmVersion(undefined);
								piUpdate.setInstallResult(null);
								piUpdate.setInstallCompleted(false);

								void piGuide.checkNode();
								void piGuide.checkNpmForGuide();
								piUpdate.checkPiInstall("manual");
							}}
							onOpenInstallDocs={() => api.app.openExternal("https://pi.dev/docs/latest/quickstart#install")}
							installations={piUpdate.piInstallations ?? []}
							applyingInstallationPath={piUpdate.applyingInstallationPath}
							onChooseInstallation={(path) => void piUpdate.choosePiInstallation(path)}
							onShellProbeInstallations={() => void piUpdate.loadPiInstallations({ forceShellProbe: true })}
							shellProbingInstallations={piUpdate.piInstallationsProbing}
							onBrowsePiPath={() => void piUpdate.browsePiPath()}
							browsingPiPath={piUpdate.browsingPiPath}
							customPath={piUpdate.customPiPath}
							customPathValidating={piUpdate.customPathValidating}
							customPathResult={piUpdate.customPathResult}
							onCustomPathChange={(path) => {
								piUpdate.setCustomPiPath(path);
								piUpdate.setCustomPathResult(null);
							}}
							onValidateCustomPath={() => piUpdate.validateCustomPiPath({ closeDialogOnSuccess: true })}
							installCommand={piUpdate.installCommand}
							installExecuting={piUpdate.installExecuting}
							installResult={piUpdate.installResult}
							installCompleted={piUpdate.installCompleted}
							onInstallCommandChange={(cmd) => {
								piUpdate.setInstallCommand(cmd);
								piUpdate.setInstallResult(null);
								piUpdate.setInstallCompleted(false);
							}}
							onExecInstall={piUpdate.execInstallCommand}
							onRestartApp={() => api.app.restart()}
							onClearCheckFlag={async () => {
								await api.settings.update({ piEnvironmentChecked: false });
								showToast(t("environment.checkFlagCleared"));
							}}
						/>
					</EnvironmentOverlay>
					<SettingsFeatureRoot settings={settings} piUpdate={piUpdate} webServiceChanging={webServiceChanging} onRestartWebService={restartWebService} appInfo={appInfo} onChange={updateSettings} projects={projects} projectId={activeProject?.id} projectKind={activeProject?.kind} projectName={activeProject?.name} />

					<SessionActionOverlays
						{...overlays.overlayProps}
						feedback={
							overlays.overlayProps.feedback
								? {
										...overlays.overlayProps.feedback,
										props: {
											...overlays.overlayProps.feedback.props,
											onCreateSessionWithPrompt: handleFeedbackCreateSession,
										},
									}
								: undefined
						}
					/>
					{previewImage && <ImagePreviewModal image={previewImage} onClose={() => setPreviewImage(null)} />}

					{externalPathOpenDialog}

					{proxyDialogSessionId && <SessionProxyDialog sessionId={proxyDialogSessionId} onClose={() => setProxyDialogSessionId(null)} />}
					{codexImportProject && <ImportOverlayHost kind="codex" project={codexImportProject} controller={codexImportController} onClose={() => setCodexImportProject(null)} />}
					{claudeImportProject && <ImportOverlayHost kind="claude" project={claudeImportProject} controller={claudeImportController} onClose={() => setClaudeImportProject(null)} />}
					{qoderImportProject && <ImportOverlayHost kind="qoder" project={qoderImportProject} controller={qoderImportController} onClose={() => setQoderImportProject(null)} />}
					{openCodeImportProject && <ImportOverlayHost kind="opencode" project={openCodeImportProject} controller={openCodeImportController} onClose={() => setOpenCodeImportProject(null)} />}
					{zcodeImportProject && <ImportOverlayHost kind="zcode" project={zcodeImportProject} controller={zcodeImportController} onClose={() => setZcodeImportProject(null)} />}
					{workbuddyImportProject && <ImportOverlayHost kind="workbuddy" project={workbuddyImportProject} controller={workbuddyImportController} onClose={() => setWorkbuddyImportProject(null)} />}
					{cursorImportProject && <ImportOverlayHost kind="cursor" project={cursorImportProject} controller={cursorImportController} onClose={() => setCursorImportProject(null)} />}
					{kimiImportProject && <ImportOverlayHost kind="kimi" project={kimiImportProject} controller={kimiImportController} onClose={() => setKimiImportProject(null)} />}
					{kimiWorkImportProject && <ImportOverlayHost kind="kimiwork" project={kimiWorkImportProject} controller={kimiWorkImportController} onClose={() => setKimiWorkImportProject(null)} />}
					{minimaxImportProject && <ImportOverlayHost kind="minimax" project={minimaxImportProject} controller={minimaxImportController} onClose={() => setMinimaxImportProject(null)} />}
					{directoryImportProject && <ImportOverlayHost kind="directory" project={directoryImportProject} controller={directoryImportController} onClose={() => setDirectoryImportProject(null)} />}

					<SelectionToolHost onSendToSession={handleAgentSendToSession} />

					<AskPanelOverlay />
					<HostPluginPanelHost projectId={activeProject?.id} sessionId={currentSessionId} />

					<NoticeHistoryDialog />

					<ExternalEditorOverlay
						open={editorsOpen}
						editors={externalEditors}
						anchor={editorsAnchor}
						projectPath={editorsTargetPath}
						onClose={() => workspace.closeExternalEditorChooser()}
						onOpenProject={(editor, path) => workspace.openProjectInExternalEditor(editor)}
						onError={(error) => showToast(t("app.openEditorFailed", { error: String(error) }), 3000)}
					/>
				</AppShell>
				<CommandPalette open={commandPaletteOpen} onOpenChange={setCommandPaletteOpen} commands={commandPaletteCommands} placeholder={t("command.placeholder")} emptyMessage={t("command.empty")} />
				{/* 不主动提示就等于不存在。看完即写 localStorage，只弹一次。 */}
				{!quickTask.active && <CommandPaletteOnboarding enabled={Boolean(activeProjectId) && !commandPaletteOpen} onTryNow={openCommandPalette} />}
				<DataModeChoiceDialog />
				<DataEnvMismatchDialog />
				<CuaApprovalDialog request={cuaApproval.request} pendingCount={cuaApproval.pendingCount} responding={cuaApproval.responding} open={cuaApproval.open} onOpenChange={cuaApproval.setOpen} onRespond={(allowed) => void cuaApproval.respond(allowed)} onCancel={cuaApproval.cancel} />
			</>
		</FileLinkBaseProvider>
	);
}
