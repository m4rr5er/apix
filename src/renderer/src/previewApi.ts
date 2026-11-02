import type { PiDesktopApi } from "../../preload";
import { createDefaultExternalEditorSettings, createDefaultSecurityConfig, createDefaultSoundAlertSettings, DEFAULT_PET_SCALE, DEFAULT_TOAST_DURATION_MS, emptyRemoteAccessState } from "../../shared/types";
import { DEFAULT_VOICE_TRANSCRIPTION_CONFIG } from "../../shared/voiceTranscriptionConfig";
import { EMPTY_VIDEO_GEN_CONFIG } from "../../shared/videoGenConfig";
import { SESSION_TAB_MAX_WIDTH_DEFAULT } from "../../shared/sessionTabWidth";
import { ACP_TOOL_PRESETS } from "../../shared/acpToolPresets";
import type { AppSettings, FileTreeNode, Project, SessionRecord, SessionSummary, TerminalDataEvent, TerminalExitEvent, TerminalTab } from "../../shared/types";
import type { ResourceImportKind } from "../../shared/types/resourceImport";
import type { ReplyActionRule } from "../../shared/types/replyActions";
import { t } from "./i18n";

const now = Date.now();

const PREVIEW_QUICK_MESSAGES: readonly string[] = ["继续", "提交", "推送", "提交推送"];
const PREVIEW_REPLY_ACTIONS: readonly ReplyActionRule[] = [
	{ text: "继续", triggers: [{ kind: "onStop" }] },
	{ text: "提交", triggers: [{ kind: "onStop" }] },
	{ text: "重试", triggers: [{ kind: "onFailure" }] },
];

const projects: Project[] = [
	{
		id: "builtin-chat",
		name: "Chat",
		path: "C:/Users/14012/AppData/Roaming/PiDeck/chat-workspace",
		lastOpenedAt: now,
		pinned: true,
		sortOrder: -1,
		kind: "chat",
	},
	{
		id: "preview-project",
		name: "preview-project",
		path: "C:/Users/14012/preview-project",
		lastOpenedAt: now,
		sortOrder: 0,
	},
];

const files: FileTreeNode[] = [
	{
		name: "src",
		path: "C:/Users/14012/preview-project/src",
		relativePath: "src",
		type: "directory",
		children: [
			{
				name: "App.tsx",
				path: "C:/Users/14012/preview-project/src/App.tsx",
				relativePath: "src/App.tsx",
				type: "file",
			},
		],
	},
	{
		name: "README.md",
		path: "C:/Users/14012/preview-project/README.md",
		relativePath: "README.md",
		type: "file",
	},
];

function findPreviewDirectory(nodes: FileTreeNode[], directory: string): FileTreeNode | undefined {
	for (const node of nodes) {
		if (node.type === "directory" && node.path === directory) return node;
		if (node.children) {
			const nested = findPreviewDirectory(node.children, directory);
			if (nested) return nested;
		}
	}
	return undefined;
}

function getSessions(): SessionSummary[] {
	return [
		{
			id: "s1",
			filePath: "preview.jsonl",
			projectPath: projects[0].path,
			name: t("preview.sessionName"),
			preview: t("preview.sessionPreview"),
			updatedAt: now,
			messageCount: 3,
		},
	];
}

const terminalTabs: TerminalTab[] = [];
const terminalDataListeners = new Set<(payload: TerminalDataEvent) => void>();
const terminalExitListeners = new Set<(payload: TerminalExitEvent) => void>();

let previewSettings: AppSettings = {
	useNativeTitleBar: true,
	showNativeMenu: false,
	sendShortcut: "enter-send",
	defaultAgentBackend: "pi",
	floatingBallShowRunningBadge: true,
	theme: "dark",
	themeScheduleLightStart: "07:00",
	themeScheduleDarkStart: "19:00",
	accent: "default",
	themeSkin: "classic-green",
	customThemeOverrides: {},
	backgroundImage: "",
	backgroundImageOpacity: 0.8,
	weWorkshopDir: "",
	weWallpaperId: "",
	language: "system",
	startupWindowMode: "last",
	piEnvironmentChecked: true,

	disabledExtensions: [],

	disabledSkills: [],

	disabledPrompts: [],
	sessionTabOpenMode: "preview",
	busySendDelivery: "steer",
	tpsDisplayMode: "streaming",

	quickMessages: [],
	enableGitManagement: true,
	gitCommitMessagePrompt: "",
	gitCommitMessageProvider: "",
	gitCommitMessageModel: "",
	gitExecutablePath: "",
	closeToTray: true,
	singleInstance: true,
	enableNotifications: true,

	autoSessionTitle: true,

	askNotificationEnabled: false,

	alertOnlyWhenUnfocused: false,

	agentCountReminderEnabled: true,

	announcementNotificationEnabled: true,

	toastDurationMs: DEFAULT_TOAST_DURATION_MS,

	showThinking: true,

	expandInterimDuringStream: true,

	processGroupDisplay: true,
	showDevTools: false,
	developerDiagnostics: false,
	electronChromiumSandbox: false,
	piProxyEnabled: false,
	piProxyUrl: "http://127.0.0.1:7890",
	piProxyBypass: "localhost,127.0.0.1,::1",
	piProxyProviders: [],
	piProxyModels: [],
	desktopProxyEnabled: false,
	desktopProxyUrl: "http://127.0.0.1:7890",
	desktopProxyBypass: "localhost,127.0.0.1,::1",
	customPiPath: "",
	piCustomPaths: [],
	wslEnabled: false,
	wslDistro: "Ubuntu",
	wslUser: "root",
	telemetryEnabled: true,
	webServiceEnabled: false,
	webServiceHost: "0.0.0.0",
	webServicePort: 8765,
	webServiceRequiresAuth: true,
	rpcTimeout: 600_000,
	linkOpenMode: "external",
	workspaceContentOpenMode: "split",
	contentMaxWidth: 1800,
	chatContentWidthPct: 80,
	sessionStatusPlacement: "composer",
	navigationMode: "tabs",
	sessionTabMaxWidth: SESSION_TAB_MAX_WIDTH_DEFAULT,
	maxEditorFileSizeMB: 5,
	externalEditors: createDefaultExternalEditorSettings(),

	petEnabled: false,
	petId: "clawd",
	petAlwaysOnTop: true,
	petScale: DEFAULT_PET_SCALE,
	petPatrolEnabled: true,
	petPatrolPauseMin: 5,

	floatingBallEnabled: false,
	floatingBallExpandTarget: "mini",
	floatingBallAlwaysOnTop: true,
	floatingBallSnapToEdge: true,

	idleAgentAutoRelease: true,
	idleAgentKeepCount: 5,
	idleAgentTimeoutMin: 60,

	cuaEnabled: false,
	cuaAutoApprove: true,

	browserAgentEnabled: false,
	browserAgentAutoApprove: true,
	favoriteModels: [],

	hiddenProviders: [],
	hiddenModels: [],
	hiddenModules: [],
	hiddenComposerFeatures: [],

	fontSize: "medium",
	uiFontSize: null,
	tabBarFontSize: null,
	chatFontSize: null,
	inputFontSize: null,
	zoomFactor: 1,
	fontFamilyBase: "system",
	fontFamilyBaseCustom: "",
	fontFamilyMono: "system-mono",
	fontFamilyMonoCustom: "",
	removedBuiltInExtensions: [],

	soundAlert: createDefaultSoundAlertSettings(),
	imageGenSize: "unset",
	imageGenWatermark: false,
	imageGenOutputFormat: "png",
	autoDownloadUpdates: true,
	catalogAutoUpdate: true,

	updateSource: "github",
	customUpdateSourceUrl: "",

	piRpcOffline: false,
	piRpcNoExtensions: false,
	piRpcNoSkills: false,

	terminalTheme: "inherit",
	terminalFontSize: null,
	terminalFontFamily: "",
	terminalScrollback: 5000,
	terminalCursorStyle: "block",
	terminalCursorBlink: true,
	terminalCopyOnSelect: false,
	terminalPaddingY: 8,
	terminalConfirmClose: "running",
	terminalStartupCommand: "",
};

export function createPreviewApi(): PiDesktopApi {
	const noop = (() => () => undefined) as unknown as (...args: unknown[]) => () => void;
	const previewImportKinds = new Map<string, ResourceImportKind>();
	const clipboardStub: PiDesktopApi["clipboard"] = {
		readText: () => "",
		readHtml: () => "",
		readImage: () => "",
		writeImage: async () => false,
		writeText: async () => false,
	};
	const createTerminalTab = async (agentId: string, shell?: string, cwd?: string) => {
		const shellName = shell ?? "powershell";
		const displayName = shellName === "git-bash" ? "Git Bash" : shellName === "bash" ? "bash" : shellName === "cmd" ? "cmd" : "PowerShell";
		const tab: TerminalTab = {
			id: `preview-terminal-${terminalTabs.length + 1}`,
			agentId,
			ownerKey: `agent:${agentId}`,
			title: `${displayName} ${terminalTabs.length + 1}`,
			cwd: "C:/Users/14012/preview-project",
			shell: "powershell",
			createdAt: Date.now(),
		};
		terminalTabs.push(tab);
		setTimeout(() => {
			for (const listener of terminalDataListeners) {
				listener({
					tabId: tab.id,
					data: "Windows PowerShell\r\nPS C:\\\\Users\\\\14012\\\\preview-project> ",
				});
			}
		}, 0);
		return tab;
	};
	return {
		piDeckMcp: {
			getState: async () => ({ ok: false, code: "desktop-only" }),
			setAccess: async () => ({ ok: false, code: "desktop-only" }),
			connection: async () => ({ ok: false, code: "desktop-only" }),
		},
		hostPlugins: {
			list: async () => ({ ok: false, code: "desktop-only" }),
			rescan: async () => ({ ok: false, code: "desktop-only" }),
			setEnabled: async () => ({ ok: false, code: "desktop-only" }),
			openDirectory: async () => ({ ok: false, code: "desktop-only" }),
			install: async () => ({ ok: false, code: "desktop-only" }),
			installDirectory: async () => ({ ok: false, code: "desktop-only" }),
			installGitHub: async () => ({ ok: false, code: "desktop-only" }),
			scaffold: async () => ({ ok: false, code: "desktop-only" }),
			mount: async () => ({ ok: false, code: "desktop-only" }),
			update: async () => ({ ok: false, code: "desktop-only" }),
			unmount: async () => ({ ok: false, code: "desktop-only" }),
			remove: async () => ({ ok: false, code: "desktop-only" }),
			onChanged: () => () => undefined,
			onNavigate: () => () => undefined,
			onOpenBrowser: () => () => undefined,
		},
		clipboard: clipboardStub,

		quickTask: { getState: async () => ({ active: false, requestId: 0 }), onChanged: () => () => undefined, exit: async () => undefined, switchToMiniOverlay: async () => undefined },
		floatingBall: {
			getState: async () => ({ visible: false, alwaysOnTop: true, snapToEdge: true, expandTarget: "mini" as const, showRunningBadge: true, activeCount: 0, runningCount: 0, recentTitles: [], locale: "zh-CN" as const }),
			onStateChanged: () => () => undefined,
			enter: async () => undefined,
			exit: async () => undefined,
			setEnabled: async () => undefined,
			setExpandTarget: async () => undefined,
			dragStart: async () => undefined,
			dragMove: async () => undefined,
			dragEnd: async () => undefined,
			contextMenu: async () => undefined,
		},
		miniOverlay: {
			getState: async () => null,
			onStateChanged: () => () => undefined,
			jumpToSession: async () => undefined,
			quickPrompt: async () => ({ ok: false, message: "preview mode" }),
			close: async () => undefined,
			collapse: async () => undefined,
			switchToQuickTask: async () => undefined,
		},

		piAuth: {
			listProviders: async () => ({ ok: false as const, errorKind: "sdk-unavailable" as const, error: "Pi auth is unavailable in preview mode." }),
			login: async ({ providerId }: { providerId: string }) => ({ ok: false, cancelled: false, providerId, errorKind: "sdk-unavailable" as const, error: "Pi auth is unavailable in preview mode." }),
			answerPrompt: async () => false,
			cancel: async () => false,
			logout: async (providerId: string) => ({ ok: false, providerId, error: "Pi auth is unavailable in preview mode." }),
			onFlowUpdate: () => () => undefined,
		},

		dataEnv: {
			getInfo: async () => ({ channel: "stable" as const, decided: false, dataMode: null, activeDirectory: "shared" as const }),
			chooseMode: async () => ({ ok: false as const, error: "invalid-mode" as const }),
			restart: async () => undefined,
			confirmMismatch: async () => undefined,
			onDecisionRequired: () => () => undefined,
			onMismatchDetected: () => () => undefined,
			getImportPreview: async () => ({ ok: false as const, error: "unavailable" as const }),
			importStart: async () => ({ ok: false as const, error: "unavailable" as const }),
			importCancel: async () => undefined,
			onImportProgress: () => () => undefined,
		},

		channelSwitch: {
			query: async () => ({ ok: false as const, error: "preview-unavailable" as const }),
			download: async () => ({ ok: false as const, error: "preview-unavailable" as const }),
			launch: async () => ({ ok: false as const, error: "preview-unavailable" as const }),
			getStatus: async () => ({ phase: "idle" as const }),
			onStateChanged: () => () => undefined,
		},
		shellMenu: {
			getQuickTaskState: async () => ({ supported: false, registered: false }),
			setQuickTaskEnabled: async () => ({ supported: false, registered: false }),
			getState: async () => ({ supported: false, registered: false }),
			setEnabled: async () => ({ supported: false, registered: false }),
		},

		system: {
			getProcessMetrics: async () => ({
				agents: [],
				totalAgentBytes: 0,
				sampledAt: Date.now(),
			}),
			stopAgent: async () => undefined,

			getArchStatus: async () => ({
				platform: "",
				processArch: "",
				runningUnderArm64Translation: false,
			}),
			getDiagnosticsSnapshot: async () => ({
				enabled: false,
				sampledAt: Date.now(),
				main: {
					rssBytes: 0,
					heapUsedBytes: 0,
					heapTotalBytes: 0,
					externalBytes: 0,
					arrayBuffersBytes: 0,
				},
				eventLoopLagMs: 0,
				eventLoopLagMaxMs: 0,
				memoryProfilePath: null,
				timingsPath: null,
				recentTimings: [],
			}),
			openDiagnosticsFolder: async () => undefined,

			healthCheck: async () => ({
				generatedAt: Date.now(),
				environment: {
					appVersion: "preview",
					platform: "win32",
					arch: "",
					osVersion: "",
					locale: "",
					timezone: "",
					electronVersion: "",
					chromeVersion: "",
					nodeVersion: "",
					installMode: "dev",
					userDataDir: "",
					logsDir: "",
					appRssBytes: 0,
					appHeapUsedBytes: 0,
					systemTotalMemoryBytes: 0,
					systemFreeMemoryBytes: 0,
					dataDirFreeBytes: 0,
					flags: {
						wslEnabled: false,
						wslDistro: "",
						piProxyEnabled: false,
						desktopProxyEnabled: false,
						piProxyConfigured: false,
						chromiumSandbox: false,
						developerDiagnostics: false,
						webServiceEnabled: false,
						customPiPathConfigured: false,
					},
					pi: { installed: false, searchedDirs: [] },
				},
				checks: [],
				logSummary: { total: 0, error: 0, warn: 0, todayError: 0, todayWarn: 0, recent: [] },
				logFiles: [],
			}),
			healthExportReport: async () => ({ ok: true, canceled: false, path: "preview" }),
			healthExportBundle: async () => ({ ok: true, canceled: false, path: "preview" }),
		},
		editors: {
			list: async () => [],
			redetect: async () => ({ ...previewSettings }),
			update: async (_editorId, patch) => {
				previewSettings = {
					...previewSettings,
					externalEditors: {
						...previewSettings.externalEditors,
						[_editorId]: {
							...previewSettings.externalEditors[_editorId],
							...patch,
							updatedAt: Date.now(),
						},
					},
				};
				return { ...previewSettings };
			},
			chooseExecutable: async () => null,
			openProject: async () => undefined,
		},
		projects: {
			list: async () => projects,
			add: async () => projects[0],
			addByPath: async () => projects[0],
			remove: async () => projects,
			reorder: async (projectIds) => {
				projects.sort((a, b) => projectIds.indexOf(a.id) - projectIds.indexOf(b.id));
				return projects;
			},
			setPinned: async () => projects,
			rename: async () => projects,
			onChanged: noop,
			listRoot: async () => projects,
			listWorktreeChildren: async () => [],
			toggleWorktreeEnabled: async () => projects[0],
			chooseChatPath: async () => null,
			setChatPath: async () => projects[0],
			consumeMigrationNotice: async () => null,
			listModels: async () => [],

			listModelsReport: async () => ({
				models: [],
				ok: false,
				reason: null,
				version: null,
				detail: "",
				source: "none" as const,
				at: Date.now(),
			}),
			getModelSpec: async () => null,
			onTrustRequest: noop,
			respondTrustRequest: async () => undefined,
		},
		projectResources: {
			list: async () => ({
				skills: [],
				extensions: [],
				skillLocations: [],
				overrides: {
					disabledGlobalExtensions: [],
					disabledGlobalSkills: [],
					disabledGlobalPrompts: [],
				},
			}),
			openDirectory: async () => undefined,
			createSkill: async (input) => ({
				id: `project-pi:${input.name}`,
				name: input.name,
				description: input.description,
				path: `C:/Users/preview/project/.pi/skills/${input.name}/SKILL.md`,
				dir: `C:/Users/preview/project/.pi/skills/${input.name}`,
				sourceId: "project-pi" as const,
				sourceLabel: ".pi/skills",
				type: "directory" as const,
				enabled: true,
				valid: true,
				warnings: [],
			}),
			deleteSkill: async () => undefined,
			deleteExtension: async () => undefined,
			toggleExtension: async () => undefined,
			toggleInherited: async (input) => ({
				disabledGlobalExtensions: input.kind === "extension" && !input.enabled ? [input.key] : [],
				disabledGlobalSkills: input.kind === "skill" && !input.enabled ? [input.key] : [],
				disabledGlobalPrompts: input.kind === "prompt" && !input.enabled ? [input.key] : [],
			}),
			renameSkill: async (_projectId, _skillPath, newName) => ({
				id: `project-pi:${newName}`,
				name: newName,
				description: "",
				path: `C:/Users/preview/project/.pi/skills/${newName}/SKILL.md`,
				dir: `C:/Users/preview/project/.pi/skills/${newName}`,
				sourceId: "project-pi" as const,
				sourceLabel: ".pi/skills",
				type: "directory" as const,
				enabled: true,
				valid: true,
				warnings: [],
			}),
			toggleSkill: async (_projectId, _skillPath, enabled) => ({
				id: "project-pi:preview-toggle",
				name: "preview-skill",
				description: "",
				path: "C:/Users/preview/project/.pi/skills/preview-skill/SKILL.md",
				dir: "C:/Users/preview/project/.pi/skills/preview-skill",
				sourceId: "project-pi" as const,
				sourceLabel: ".pi/skills",
				type: "directory" as const,
				enabled,
				valid: true,
				warnings: [],
			}),
			discovery: async () => ({ projectResourcesAllowed: false, overrides: { disabledGlobalExtensions: [], disabledGlobalSkills: [], disabledGlobalPrompts: [] }, skills: [], prompts: [], extensions: [] }),
		},
		files: {
			list: async (_projectId, options) => {
				if (options?.directory) {
					const match = findPreviewDirectory(files, options.directory);
					return match?.children ?? [];
				}
				return files;
			},
			open: async () => undefined,

			search: async () => [],
			searchContent: async () => null,
			showInFolder: async () => undefined,

			detectFileManager: async () => null,
			openFileManager: async () => undefined,
			readContent: async () => "",

			pathsExist: async () => [],

			stat: async () => ({ exists: false, isDirectory: false }),
			readBase64: async () => "",
			create: async () => "/mock/created",
			writeContent: async () => undefined,
			delete: async () => undefined,
			rename: async () => "",
			copy: async () => [],
			move: async () => [],
			getPathForFile: () => "",
			getClipboardPaths: () => [],
		},
		pasteFiles: {
			write: async () => {
				throw new Error("preview mode: paste file write is not available");
			},
			delete: async () => undefined,
			cleanup: async () => 0,
			getSize: async () => 0,
			clearAll: async () => 0,
		},
		noticeHistory: {
			get: async () => [],
			record: async () => undefined,
			clear: async () => undefined,
			getSize: async () => 0,
		},
		dialog: {
			pickFiles: async () => [],
			pickBackgroundImage: async () => "",
			removeBackgroundImage: async () => undefined,
			pickWallpaperEngineDir: async () => "",
			listWallpaperEngine: async () => ({ dir: "", items: [], error: "no-dir" as const }),
			selectWallpaperEngine: async () => null,
		},

		customThemes: {
			list: async () => ({ dir: "", themes: [] }),
			read: async () => null,
			save: async () => ({ ok: false as const, errors: ["preview"] }),
			remove: async () => undefined,
			writeGuide: async () => "",
		},
		sessions: {
			list: async () => getSessions(),

			searchContent: async () => null,

			searchInSession: async () => null,
			resolveLaunchDefaults: async () => ({}),
			listSessionSubagents: async () => [],
			listSessionTodo: async () => undefined,
			listCatalog: async (projectId, _options?: { scan?: boolean }): Promise<SessionRecord[]> =>
				getSessions().map((session) => ({
					id: `preview-record:${session.id}`,
					projectId,
					title: session.name || "Preview session",
					source: session.source || "pi",
					environment: session.wsl ? "wsl" : "native",
					filePath: session.filePath,
					parentSessionPath: session.parentSessionPath,
					projectPath: session.projectPath,
					preview: session.preview,
					messageCount: session.messageCount,
					status: "active",
					createdAt: session.updatedAt,
					updatedAt: session.updatedAt,
					wsl: session.wsl,
				})),

			onCatalogRefreshed: () => () => undefined,
			createDraft: async (input): Promise<SessionRecord> => ({
				id: `preview-draft:${input.projectId}`,
				projectId: input.projectId,
				title: input.title || "New session",
				source: "pi",
				environment: "native",
				preview: "",
				messageCount: 0,
				status: "draft",
				model: input.model,
				thinkingLevel: input.thinkingLevel,
				createdAt: now,
				updatedAt: now,
			}),
			createAnonymous: async (input) => ({
				session: {
					id: `preview-anonymous:${input.projectId}`,
					projectId: input.projectId,
					title: input.title || "Anonymous chat",
					noSession: true,
					source: "pi",
					environment: "native",
					preview: "",
					messageCount: 0,
					status: "active",
					createdAt: now,
					updatedAt: now,
				},
				runtime: {
					sessionId: `preview-anonymous:${input.projectId}`,
					agentId: "preview-anonymous-agent",
					runtimeGeneration: 1,
					projectId: input.projectId,
					cwd: projects.find((project) => project.id === input.projectId)?.path || "",
					status: "idle",
					createdAt: now,
					noSession: true,
				},
			}),
			updateRecord: async (sessionId, patch): Promise<SessionRecord> => ({
				id: sessionId,
				projectId: projects[0].id,
				title: patch.title || "Preview session",
				source: "pi",
				environment: "native",
				preview: "",
				messageCount: 0,
				status: "draft",
				model: patch.model ?? undefined,
				thinkingLevel: patch.thinkingLevel ?? undefined,
				createdAt: now,
				updatedAt: now,
			}),
			deleteRecord: async () => true,
			archiveRecord: async () => true,
			unarchiveRecord: async () => true,
			listArchived: async () => [],
			deleteArchivedRecord: async () => true,
			copyRecord: async (sessionId) => ({
				cancelled: false,
				targetSessionId: `${sessionId}:copy`,
			}),
			exportRecordHtml: async () => ({ path: "preview-session.html" }),
			readRecordMessages: async () => [],
			readRecordMessagePage: async () => ({ messages: [], total: 0, nextBefore: null }),
			editCatalogMessage: async () => ({ ok: true as const, value: undefined }),
			removeCatalogMessageImage: async () => ({ ok: false as const, error: { code: "SESSION_COMMAND_FAILED" as const } }),
			deleteCatalogMessage: async () => ({ ok: true as const, value: undefined }),
			prepareCatalogResend: async () => ({ ok: true as const, value: { text: "" } }),
			readProcessEvents: async () => ({ events: [], version: "", coverage: { fromStart: true, chainComplete: true, readComplete: true, eventsTrimmed: false, reason: "unsupported" } }),
			readOutline: async () => ({ entries: [], total: 0, truncated: false }),
			readMessageFullText: async () => ({ text: "" }),
			readReferenceMessages: async () => [
				{ role: "user", content: "Preview user message", timestamp: Date.now() - 60000 },
				{ role: "assistant", content: "Preview assistant response", timestamp: Date.now() - 30000 },
			],
			sendPrompt: async (input) => ({
				accepted: true,
				sessionId: input.sessionId,
				requestId: input.requestId,
				agentId: "preview-agent",
				sessionPath: "C:/Users/preview/.pi/session.jsonl",
				runtimeGeneration: 1,
			}),
			sendUiResponse: async () => undefined,
			onRuntimeEvent: noop,
			listRuntimes: async () => [],
			activateRuntime: async () => ({
				ok: false,
				error: { code: "SESSION_NOT_FOUND", debugDetails: "preview runtime activation is disabled" },
			}),
			stopRuntime: async (target) => ({ ok: true, value: target }),
			abortRuntime: async (target) => ({
				ok: true,
				value: { target, value: undefined },
			}),
			restartRuntime: async (target) => ({
				ok: true,
				value: {
					previousTarget: target,
					runtime: {
						...target,
						projectId: projects[0].id,
						cwd: projects[0].path,
						status: "idle" as const,
						createdAt: now,
					},
					session: {
						id: target.sessionId,
						projectId: projects[0].id,
						title: "Preview session",
						source: "pi" as const,
						environment: "native" as const,
						preview: "",
						messageCount: 0,
						status: "active" as const,
						createdAt: now,
						updatedAt: now,
					},
				},
			}),
			compactRuntime: async (target) => ({
				ok: true,
				value: { target, value: {} },
			}),
			getRuntimeForkMessages: async (target) => ({
				ok: true,
				value: { target, value: [] },
			}),
			forkRuntimeSession: async (target) => ({
				ok: true,
				value: { cancelled: false, text: "", targetSessionId: `${target.sessionId}:fork` },
			}),
			setFocusedSession: async () => undefined,
			getRuntimeState: async (target) => ({
				ok: true,
				value: { target, value: {} },
			}),
			listRuntimeCommands: async (target) => ({
				ok: true,
				value: { target, value: [] },
			}),

			listRuntimePromptTemplates: async (target) => ({
				ok: true,
				value: { target, value: [] },
			}),

			reloadResources: async (target) => ({
				ok: true,
				value: { target, value: [] },
			}),

			draftCommands: async () => null,
			draftPromptTemplates: async () => null,
			listRuntimeModels: async (target) => ({
				ok: true,
				value: { target, value: [] },
			}),
			listRuntimeThinkingLevels: async (target) => ({
				ok: true,
				value: { target, value: undefined },
			}),
			exportRuntimeHtml: async (target) => ({
				ok: true,
				value: { target, value: { path: "preview-session.html" } },
			}),
			editRuntimeMessage: async (target) => ({
				ok: true,
				value: { target, value: undefined },
			}),
			deleteRuntimeMessage: async (target) => ({
				ok: true,
				value: { target, value: undefined },
			}),
			listRewindCheckpoints: async (target) => ({
				ok: true,
				value: { target, value: { items: [], hasMore: false } },
			}),

			getBranchTree: async () => null,
			getRewindCheckpointDiff: async (target) => ({
				ok: true,
				value: { target, value: "" },
			}),
			restoreRewindCheckpoint: async (target) => ({
				ok: true,
				value: { target, value: { filesRestored: true } },
			}),
			prepareRuntimeResend: async (target) => ({
				ok: true,
				value: { target, value: { text: "" } },
			}),
			setRuntimeModel: async (target, provider, modelId, modelName) => ({
				ok: true,
				value: { target, value: { provider, modelId, modelName: modelName?.trim() || modelId } },
			}),
			setRuntimeThinking: async (target, thinkingLevel) => ({
				ok: true,
				value: { target, value: { thinkingLevel } },
			}),
			cloneRuntime: async (target) => ({
				ok: true,
				value: { targetSessionId: `${target.sessionId}:copy` },
			}),
		},
		usageStats: {
			detect: async () => ({
				installed: false,
				logPath: null,
				recordCount: null,
				firstRecordAt: null,
				lastRecordAt: null,
			}),
			refresh: async () => ({
				fullRescan: false,
				parsedRecords: 0,
				skippedLines: 0,
			}),
			get: async () => null as unknown as import("../../shared/types").UsageAggregated,
		},
		aiAaaUsage: {
			get: async () => ({ ok: false, code: "not-configured" }) as import("../../shared/types/aiAaaUsage").AiAaaUsageResult,
		},
		qoderUsage: {
			get: async () => ({ ok: false, code: "not-configured" }) as import("../../shared/types/qoderUsage").QoderUsageResult,
		},
		codexSessions: {
			scan: async () => [],
			import: async () => ({ results: [], imported: 0, failed: 0 }),
		},
		claudeSessions: {
			scan: async () => [],
			import: async () => ({ results: [], imported: 0, failed: 0 }),
		},
		qoderSessions: {
			scan: async () => [],
			import: async () => ({ results: [], imported: 0, failed: 0 }),
		},
		openCodeSessions: {
			scan: async () => [],
			import: async () => ({ results: [], imported: 0, failed: 0 }),
		},
		zcodeSessions: {
			scan: async () => [],
			import: async () => ({ results: [], imported: 0, failed: 0 }),
		},
		workbuddySessions: {
			scan: async () => [],
			import: async () => ({ results: [], imported: 0, failed: 0 }),
		},
		cursorSessions: {
			scan: async () => [],
			import: async () => ({ results: [], imported: 0, failed: 0 }),
		},
		kimiSessions: {
			scan: async () => [],
			import: async () => ({ results: [], imported: 0, failed: 0 }),
		},
		kimiWorkSessions: {
			describe: async () => ({ root: null, origin: null, sessionsFound: false }),
			scan: async () => [],
			import: async () => ({ results: [], imported: 0, failed: 0 }),
		},

		minimaxSessions: {
			scan: async () => [],
			import: async () => ({ results: [], imported: 0, failed: 0 }),
		},
		directorySessions: {
			scan: async () => ({ sessions: [], kind: "none" }),
			listSources: async () => [],
			import: async () => ({ results: [], imported: 0, failed: 0 }),
		},
		git: {
			listRepos: async () => [],
			branches: async () => ({ current: "main", branches: ["main", "dev"] }),
			checkout: async (_projectId, branch) => ({
				current: branch,
				branches: ["main", "dev"],
			}),
			createBranch: async (_projectId, branchName) => ({
				current: branchName,
				branches: ["main", "dev", branchName],
			}),

			originalContent: async () => "",
			worktreeList: async () => [],
			worktreeCreate: async (_projectId, branchName) => ({
				path: `/tmp/worktree/${branchName}`,
				branch: branchName,
			}),
			worktreeRemove: async () => true,
			commitLog: async () => [],
			commitCount: async () => 0,
			refs: async () => [],
			branchCompare: async () => ({ files: [], ahead: 0, behind: 0 }),
			commitDetail: async () => null,
			commitFileDiff: async () => null,
			diffFileBetween: async () => "",
			status: async () => ({ merge: [], index: [], workingTree: [], untracked: [] }),
			workspaceFileDiff: async () => null,
			stage: async () => {},
			unstage: async () => {},
			discard: async () => {},
			discardFiles: async () => {},
			commit: async () => {},
			cherryPick: async () => {},
			revert: async () => {},
			reset: async () => {},
			dropCommit: async () => {},
			generateCommitMessage: async () => ({ ok: true, message: "" }),
			init: async () => {},
			pull: async () => {},
			push: async () => {},
			fetch: async () => undefined,

			aheadBehind: async () => null,

			watchRefs: async () => "",
			unwatchRefs: async () => {},
			onRefsChanged: () => () => {},
			deleteFiles: async () => {},

			detectExecutable: async () => ({
				source: "path",
				executable: "git",
				resolvedPath: "/usr/bin/git",
				version: "2.53.0",
				error: null,
				system: { resolvedPath: "/usr/bin/git", version: "2.53.0", source: "path" },
			}),

			chooseExecutable: async () => null,
		},
		logs: {
			list: async () => [],
			listPage: async () => ({ entries: [], total: 0, page: 0, pageSize: 50, hasMore: false }),
			clear: async () => undefined,
			openFolder: async () => undefined,
			getSize: async () => 0,
		},
		rpcLogs: {
			getSize: async () => 0,
			get: async () => [],
			getLive: async () => [],
			getModelTrace: async () => null,
			save: async () => [],
			onLog: (_callback: unknown) => () => {},
			clear: async () => undefined,
			setLogging: async () => false,
			getLogging: async () => false,
			setWatching: async () => false,
		},
		pi: {
			check: async () => ({
				installed: true,
				command: "pi",
				version: "preview",
				searchedDirs: [],
			}),
			checkCustom: async (_path) => ({
				installed: true,
				command: _path,
				version: "preview",
				searchedDirs: [],
			}),

			listInstallations: async () => [
				{
					path: "/usr/local/bin/pi",
					realPath: "/usr/local/bin/pi",
					version: "preview",
					source: "package-manager" as const,
					isActive: true,
				},
				{
					path: "/home/preview/.pi/agent/bin/pi",
					realPath: "/home/preview/.pi/agent/bin/pi",
					version: "preview",
					source: "managed" as const,
					managedRoot: "/home/preview/.pi/agent/install",
					isActive: false,
					shellDefault: true,
				},
			],

			chooseExecutable: async () => "/home/preview/.pi/agent/bin/pi",

			setCustomPaths: async (paths) => ({ paths: [...paths], clearedActive: false }),
			checkUpdate: async () => ({
				currentVersion: "preview",
				latestVersion: "preview",
				hasUpdate: false,
			}),
			releaseNotes: async () => ({
				markdown: "## [preview] - 2026-01-01\n\n- Preview mode: pi release notes",
				source: "github",
				versionCount: 1,
				pageUrl: "https://github.com/earendil-works/pi/blob/main/packages/coding-agent/CHANGELOG.md",
				fetchedAt: null,
				truncated: false,
			}),
			update: async () => ({
				command: "pi update pi --no-approve",
				output: "Preview mode: pi update output",
				updated: false,
			}),
			execInstall: async (_command) => ({
				success: true,
				exitCode: 0,
				stdout: "preview: exec install output",
				stderr: "",
			}),
			checkNpm: async () => ({
				available: true,
				version: "preview",
			}),
			runtimeNodeCheck: async () => ({
				installed: false,
				systemNodeAvailable: true,
				systemNodeVersion: "v24.13.0",
				installSupported: true,
			}),
			runtimeNodeInstall: async () => ({
				ok: true,
				path: "preview",
				version: "v24.13.0",
				source: "preview",
			}),
			runtimePiInstall: async (_useMirror) => ({
				success: true,
				exitCode: 0,
				stdout: "preview: runtime pi install output",
				stderr: "",
			}),
		},
		wsl: {
			listDistros: async () => ["Ubuntu", "Debian"],
			validateConnection: async (_distro, _user) => ({
				ok: true,
				whoami: "preview",
				piVersion: "preview",
				piPath: "/usr/local/bin/pi",
				error: "",
			}),
		},
		app: {
			info: async () => ({
				version: "preview",
				releasesUrl: "https://github.com/ayuayue/PiDeck/releases",
				appUpdatesEnabled: false,
				platform: "win32" as NodeJS.Platform,
				homeDir: "C:/Users/preview",
				userDataDir: "C:/Users/preview/AppData/Roaming/PiDeck",
			}),
			preferredSystemLanguages: async () => (navigator.languages?.length ? [...navigator.languages] : [navigator.language]),
			networkAddresses: async () => [{ address: "192.168.1.100", interfaceName: "Wi-Fi", cidr: "192.168.1.100/24", isPrivate: true, family: "IPv4" }],
			checkUpdate: async () => undefined,
			getChannel: async () => ({ channel: "stable" as const, currentVersion: "preview", devBuild: false }),
			onUpdateStatus: () => () => undefined,
			onOpenSettings: () => () => undefined,

			onShortcutTriggered: () => () => undefined,
			getUpdateStatus: async () => null,
			notifyUpdateSeen: async () => undefined,
			skipUpdateVersion: async () => undefined,
			downloadUpdate: async () => undefined,
			installUpdate: async () => undefined,
			checkUpdateMirrors: async () => [{ id: "atomgit", status: "ok", latencyMs: 320, speedKBps: 2560, checkedAt: Date.now() }],
			onOpenInBrowser: () => () => undefined,
			feedbackEnvironment: async () => ({
				appVersion: "preview",
				platform: "win32",
				arch: "x64",
				electronVersion: "preview",
				chromeVersion: "preview",
				nodeVersion: "preview",
				pi: {
					installed: true,
					command: "pi",
					version: "preview",
					searchedDirs: [],
				},
			}),
			getFeedbackProjectContext: async (_projectId: string) => ({
				projectId: _projectId,
				projectName: "preview",
				agentsMd: "",
				agentsMdTruncated: false,
				skills: [],
			}),
			openExternal: async () => undefined,

			getChangelog: async () => ({
				markdown: null,
				source: null,
				versionCount: 0,
				pageUrl: "https://atomgit.com/ayuayue/PiDeck/blob/main/CHANGELOG.zh-CN.md",
				fetchedAt: null,
				fromCache: false,
				stale: false,
			}),
			restart: async () => undefined,
			quit: async () => undefined,
			openDataDir: async () => ({ ok: true }),
			rendererLog: async (level, scope, message, detail) => {
				console[level === "error" ? "error" : level === "warn" ? "warn" : "debug"](`[${scope}] ${message}`, detail);
			},
			minimizeWindow: async () => undefined,
			toggleMaximizeWindow: async () => false,
			isWindowMaximized: async () => false,
			onWindowMaximizedChange: () => () => undefined,

			onZoomFactorChange: () => () => undefined,
			toggleAlwaysOnTopWindow: async () => false,
			isWindowAlwaysOnTop: async () => false,
			closeWindow: async () => undefined,
			toggleDevTools: async () => false,
		},
		skills: {
			list: async () => ({
				locations: [
					{
						id: "pi-global" as const,
						label: "~/.pi/agent/skills",
						path: "C:/Users/preview/.pi/agent/skills",
						rootMarkdownEnabled: true,
					},
					{
						id: "agents-global" as const,
						label: "~/.agents/skills",
						path: "C:/Users/preview/.agents/skills",
						rootMarkdownEnabled: false,
					},
				],
				skills: [
					{
						id: "pi-global:preview-skill",
						name: "preview-skill",
						description: "A preview skill",
						path: "C:/Users/preview/.pi/agent/skills/preview-skill/SKILL.md",
						dir: "C:/Users/preview/.pi/agent/skills/preview-skill",
						sourceId: "pi-global" as const,
						sourceLabel: "~/.pi/agent/skills",
						type: "directory" as const,
						enabled: true,
						valid: true,
						warnings: [],
					},
				],
			}),
			readContent: async (_path) => ({
				content: "# preview-skill\n\nPreview skill body used by the browser preview layout.",
			}),
			create: async (input) => ({
				id: `pi-global:${input.name}`,
				name: input.name,
				description: input.description,
				path: `C:/Users/preview/.pi/agent/skills/${input.name}/SKILL.md`,
				dir: `C:/Users/preview/.pi/agent/skills/${input.name}`,
				sourceId: input.locationId,
				sourceLabel: "~/.pi/agent/skills",
				type: "directory" as const,
				enabled: true,
				valid: true,
				warnings: [],
			}),
			toggle: async (path, enabled) => ({
				id: `pi-global:${path}`,
				name: "preview-skill",
				description: "Preview skill",
				path,
				dir: path.replace(/[/\\]SKILL\.md$/, ""),
				sourceId: "pi-global" as const,
				sourceLabel: "~/.pi/agent/skills",
				type: "directory" as const,
				enabled,
				valid: true,
				warnings: [],
			}),
			delete: async () => undefined,
			openFolder: async () => undefined,
			rename: async (_skillPath, newName) => ({
				id: `pi-global:preview/${newName}/SKILL.md`,
				name: newName,
				description: "Preview skill",
				path: `C:/Users/preview/.pi/agent/skills/${newName}/SKILL.md`,
				dir: `C:/Users/preview/.pi/agent/skills/${newName}`,
				sourceId: "pi-global" as const,
				sourceLabel: "~/.pi/agent/skills",
				type: "directory" as const,
				enabled: true,
				valid: true,
				warnings: [],
			}),
		},
		resourceImport: {
			scan: async (input) => {
				previewImportKinds.set("preview-scan", input.kind);
				return {
					ok: true as const,
					result: { scanId: "preview-scan", kind: input.kind, target: input.target, sources: [], candidates: [] },
				};
			},
			apply: async (input) => ({
				ok: true as const,
				result: {
					scanId: input.scanId,
					kind: previewImportKinds.get(input.scanId) ?? "mcp",
					results: [],
					imported: 0,
					skipped: 0,
					failed: 0,
				},
			}),
		},
		extensions: {
			list: async (_forceRefresh = false) => ({
				extensions: [
					{
						id: "user:npm:preview-extension",
						source: "npm:preview-extension",
						path: "C:/Users/preview/.pi/agent/npm/node_modules/preview-extension",
						scope: "user" as const,
					},
				],
				raw: "User packages:\n  npm:preview-extension\n    C:/Users/preview/.pi/agent/npm/node_modules/preview-extension\n",
			}),
			uninstall: async () => undefined,
			install: async (_source: string) => "",
			toggle: async () => undefined,
			removeBuiltIn: async () => undefined,
			restoreBuiltIn: async () => undefined,
			update: async () => ({
				command: "pi update --extensions --no-approve",
				output: "Preview mode: extensions update output",
				updated: false,
			}),
			updateOne: async (_source: string) => ({
				command: "pi update <source>",
				output: "Preview mode: extension update-one output",
				updated: false,
			}),
			catalog: async () => ({
				generatedAt: Date.now(),
				fromCache: false,
				items: [
					{
						name: "preview-extension",
						description: "Preview mode extension",
						author: "preview",
						types: ["extension"],
						downloadsPerMonth: 1,
						publishedAt: Date.now(),
						searchText: "preview-extension",
						installSource: "npm:preview-extension",
						pageUrl: "https://pi.dev/packages/preview-extension",
					},
				],
				page: 1,
				pageSize: 1,
				total: 1,
				lastPage: 1,
			}),

			builtInStatus: async () => ({
				builtin: { version: "1.0.0", fileCount: 13 },
				overlay: null,
				hasOverlayFiles: false,
				hasBackup: false,
				effectiveVersion: "1.0.0",
				overlayDir: null,
			}),
			builtInCheck: async () => ({
				ok: true,
				remoteVersion: "1.0.0",
				localVersion: "1.0.0",
				hasUpdate: false,
				changedFiles: [],
			}),
			builtInUpdate: async () => ({ ok: true, updated: false, version: "1.0.0" }),
			builtInRestore: async () => ({ ok: true, updated: false }),
			builtInRestorePrevious: async () => ({
				ok: false,
				code: "validation" as const,
				message: "Preview mode: no previous overlay",
				updated: false,
			}),
			builtInOpenDir: async () => undefined,
		},

		contentStore: {
			promptsStatus: async () => ({
				builtin: { version: "1.0.0", fileCount: 0 },
				overlay: null,
				hasOverlayFiles: false,
				hasBackup: false,
				effectiveVersion: "1.0.0",
				overlayDir: null,
			}),
			promptsCheck: async () => ({
				ok: true,
				remoteVersion: "1.0.0",
				localVersion: "1.0.0",
				hasUpdate: false,
				changedFiles: [],
			}),
			promptsUpdate: async () => ({ ok: true, updated: false, version: "1.0.0" }),
			promptsRestore: async () => ({ ok: true, updated: false }),
			promptsRestorePrevious: async () => ({
				ok: false,
				code: "validation" as const,
				message: "Preview mode: no previous overlay",
				updated: false,
			}),
			promptsOpenDir: async () => undefined,
			skillsStatus: async () => ({
				builtin: { version: "1.0.0", fileCount: 0 },
				overlay: null,
				hasOverlayFiles: false,
				hasBackup: false,
				effectiveVersion: "1.0.0",
				overlayDir: null,
			}),
			skillsCheck: async () => ({
				ok: true,
				remoteVersion: "1.0.0",
				localVersion: "1.0.0",
				hasUpdate: false,
				changedFiles: [],
			}),
			skillsUpdate: async () => ({ ok: true, updated: false, version: "1.0.0" }),
			skillsRestore: async () => ({ ok: true, updated: false }),
			skillsRestorePrevious: async () => ({
				ok: false,
				code: "validation" as const,
				message: "Preview mode: no previous overlay",
				updated: false,
			}),
			skillsOpenDir: async () => undefined,
		},
		prompts: {
			list: async () => ({ templates: [], globalDir: "C:/Users/preview/.pi/agent/prompts" }),
			create: async (input) => ({
				name: input.name,
				path: `C:/Users/preview/.pi/agent/prompts/${input.name}.md`,
				description: input.description,
				content: `---\ndescription: ${input.description}\n---\n`,
				userCreated: true,
			}),
			delete: async () => undefined,
			openFolder: async () => undefined,
			edit: async (_filePath, _content?) => "---\ndescription: Preview\n---\n\nPreview content",
			listByProject: async () => ({ templates: [], globalDir: "" }),
			createInProject: async (_projectId, input) => ({
				name: input.name,
				path: `project://${_projectId}/.pi/prompts/${input.name}.md`,
				description: input.description,
				content: `---\ndescription: ${input.description}\n---\n`,
				userCreated: true,
				scope: "project",
			}),
			deleteFromProject: async () => undefined,
			rename: async (_oldName, newName) => ({
				name: newName,
				path: `C:/Users/preview/.pi/agent/prompts/${newName}.md`,
				description: "Renamed prompt",
				content: `---\ndescription: Renamed prompt\n---\n`,
				userCreated: true,
			}),
			renameInProject: async (_projectId, _oldName, newName) => ({
				name: newName,
				path: `project://${_projectId}/.pi/prompts/${newName}.md`,
				description: "Renamed project prompt",
				content: `---\ndescription: Renamed project prompt\n---\n`,
				userCreated: true,
				scope: "project",
			}),
			toggle: async (filePath, enabled) => ({
				name: filePath.split("/").pop()?.replace(/\.md$/, "") ?? "prompt",
				path: filePath,
				description: "Preview prompt",
				content: "",
				userCreated: true,
				enabled,
			}),
			toggleInProject: async (_projectId, name, enabled) => ({
				name,
				path: `project://${_projectId}/.pi/prompts/${name}.md`,
				description: "Preview project prompt",
				content: "",
				userCreated: true,
				scope: "project",
				enabled,
			}),
		},
		promptStore: {
			search: async (_query, _opts) => ({ query: _query ?? "", count: 0, prompts: [] }),
			get: async (_id) => ({ id: _id, title: "", description: "", content: "", type: "TEXT", author: "", category: "", tags: [], votes: 0, createdAt: "" }),
			import: async (data) => ({
				name: data.title.toLowerCase().replace(/[^\w-]+/g, "-"),
				path: `C:/Users/preview/.pi/agent/prompts/${data.title.toLowerCase().replace(/[^\w-]+/g, "-")}.md`,
				description: data.description,
				content: data.content,
				userCreated: true,
			}),
		},
		yaoPrompts: {
			list: async () => ({ categories: [], prompts: [], repoPath: "", dbState: "missing" }),
			detail: async () => ({ title: "", description: "", promptContent: "", fullContent: "" }),
			onDbStateChange: (_callback) => () => {},
			retryDb: async () => ({ state: "missing" }),
			import: async (_slug, _category) => ({
				name: _slug,
				path: `C:/Users/preview/.pi/agent/prompts/${_slug}.md`,
				description: "Preview import",
				content: "Preview content",
				userCreated: true,
			}),
		},
		skillStore: {
			search: async () => ({ query: "", count: 0, prompts: [] }),
			import: async (data, _locationId) => ({
				name: data.title.toLowerCase().replace(/[^\w-]+/g, "-"),
				path: `C:/Users/preview/.pi/agent/skills/${data.title.toLowerCase().replace(/[^\w-]+/g, "-")}/SKILL.md`,
				description: data.description,
				enabled: true,
				valid: true,
				warnings: [],
				id: `pi-global:preview`,
				dir: "",
				sourceId: "pi-global",
				sourceLabel: "Preview",
				type: "directory",
			}),
		},
		skillHub: {
			search: async () => ({ query: "", total: 0, items: [] }),
			detail: async () => null,
			install: async (slug) => ({ success: true, slug, installDir: "", message: "Preview install" }),

			onInstallProgress: () => () => {},
		},
		acp: {
			listTools: async () => [],
			saveTools: async () => [],
			validateTool: async () => ({ ok: true as const }),
			detectTool: async () => ({ presetId: ACP_TOOL_PRESETS[0]?.id ?? "gemini", state: "unknown" as const }),
			installTool: async () => ({ ok: false, output: "preview" }),
			uninstallTool: async () => ({ ok: false, output: "preview" }),
			onLifecycleEvent: () => () => undefined,
			getSessionConfig: async () => null,
			setSessionConfig: async () => [],
			onSessionConfigChanged: () => () => undefined,
		},
		settings: {
			get: async (): Promise<AppSettings> => ({ ...previewSettings }),
			update: async (patch): Promise<AppSettings> => {
				previewSettings = { ...previewSettings, ...patch };
				return { ...previewSettings };
			},
			restartWebService: async () => undefined,
			webServiceStatus: async () => ({
				running: false,
				host: "",
				port: 0,
				token: "",
				requiresAuth: false,
				tokenExpiresAt: null,
			}),
			rotateWebToken: async () => ({
				running: false,
				host: "",
				port: 0,
				token: "",
				requiresAuth: false,
				tokenExpiresAt: null,
			}),
			setWebToken: async () => ({
				running: false,
				host: "",
				port: 0,
				token: "",
				requiresAuth: false,
				tokenExpiresAt: null,
			}),
			webRemoteAccessState: async () => emptyRemoteAccessState(),
			webRemoteAccessStart: async () => ({ ok: false as const, error: "preview" }),
			webRemoteAccessStop: async () => ({ ok: false as const, error: "preview" }),
			webRemoteAccessRefresh: async () => emptyRemoteAccessState(),
			onWebRemoteAccessChanged: noop,
			testPiProxy: async () => ({
				success: true,
				url: "https://api.openai.com/v1/models",
				elapsedMs: 120,
				statusCode: 401,
				message: t("preview.proxyOk"),
			}),
			onApplyWindow: noop,
		},
		security: {
			getConfig: async () => createDefaultSecurityConfig(),
			updateConfig: async () => ({
				ok: true,
				config: createDefaultSecurityConfig(),
			}),
			setSessionLevel: async () => ({
				ok: true,
				config: createDefaultSecurityConfig(),
			}),
		},

		config: {
			installImageGenSkill: async () => ({ success: false, error: "preview" }),
			installMcpSetupSkill: async () => ({ success: false, error: "preview" }),
		} as unknown as PiDesktopApi["config"],
		configBackups: {
			list: async () => ({ ok: true, backups: [] }),
			create: async () => ({ ok: true, id: "backup-preview.json" }),
			read: async () => null,
			restore: async () => ({ ok: false, error: "preview" }),
			delete: async () => ({ ok: true }),
			deleteMany: async () => ({ ok: true, deleted: 0 }),
			deleteAll: async () => ({ ok: true }),
		},
		pet: {
			onState: noop,
			list: async () => [{ id: "clawd", displayName: "Clawd", source: "builtin", spritesheetUrl: "" }],
			setEnabled: async () => undefined,
			setId: async () => undefined,
			moveWindow: async () => undefined,
			moveBy: async () => undefined,
			ready: () => undefined,
			contextMenu: async () => undefined,
			focusAgent: async () => undefined,
			onFocusTarget: noop,
			getPendingFocusTarget: async () => null,
			onSprite: noop,
			onNotify: noop,
			setPreviewMode: async () => undefined,
			onPreviewMode: noop,
			onCaps: noop,
			testNotify: async () => undefined,
			tease: async () => undefined,
			setDragging: async () => undefined,
			getCurrent: async () => ({ id: "clawd", displayName: "Clawd", source: "builtin", spritesheetUrl: "" }),
		},
		sounds: {
			onPlay: noop,
			listCustom: async () => [],
			importCustom: async () => ({ ok: false, error: "canceled" as const }),
			removeCustom: async () => false,
		},
		announcements: {
			list: async () => ({ items: [], fetchedAt: null, source: "cache" as const, readIds: [], notifiedIds: [] }),
			refresh: async () => ({ items: [], fetchedAt: null, source: "cache" as const, readIds: [], notifiedIds: [] }),
			markRead: async () => true,
			markAllRead: async () => true,
			markNotified: async () => true,
			onChanged: () => () => {},
		},
		terminal: {
			list: async (target) => terminalTabs.filter((tab) => tab.agentId === (target.kind === "agent" ? target.agentId : target.projectId)),
			ensure: async (target) => {
				const key = target.kind === "agent" ? target.agentId : target.projectId;
				const existing = terminalTabs.filter((tab) => tab.agentId === key);
				if (existing.length > 0) return existing;
				return [await createTerminalTab(key)];
			},
			create: (target) => createTerminalTab(target.kind === "agent" ? target.agentId : target.projectId),
			input: async (tabId, data) => {
				for (const listener of terminalDataListeners) {
					listener({ tabId, data });
				}
			},
			resize: async () => undefined,
			close: async (tabId) => {
				const index = terminalTabs.findIndex((tab) => tab.id === tabId);
				if (index >= 0) terminalTabs.splice(index, 1);
			},
			onData: (callback) => {
				terminalDataListeners.add(callback);
				return () => {
					terminalDataListeners.delete(callback);
				};
			},
			onExit: (callback) => {
				terminalExitListeners.add(callback);
				return () => {
					terminalExitListeners.delete(callback);
				};
			},
			shells: async () => [
				{ shell: "powershell", label: "PowerShell", available: true },
				{ shell: "pwsh", label: "pwsh", available: true },
				{ shell: "cmd", label: "cmd", available: true },
			],
			fonts: async () => [],
		},
		feishu: {
			connect: async () => ({ success: true, message: "预览模式" }),
			connectTemp: async () => ({ success: false, message: "预览模式不支持" }),
			disconnect: async () => ({ success: true }),
			connectByBot: async () => ({ success: false, message: "预览模式不支持" }),
			statusRequest: async () => ({ status: "disconnected" as const, activeBindings: 0 }),
			onStatus: () => () => {},
			botsList: async () => [],
			botAdd: async () => ({ success: false, error: "预览模式不支持" }),
			botRemove: async () => false,
			botConfig: async () => undefined,
			botSecret: async () => "",
			testConnection: async () => ({ success: false, message: "预览模式不支持" }),
			bindingsList: async () => [],
			bindingRemove: async () => false,
			bindingUpdate: async () => undefined,
			onMessages: () => () => {},
			onBindingsChanged: () => () => {},
			onBotsChanged: () => () => {},
			onWhoamiResult: () => () => {},
			sessionBotGet: async () => null,
			sessionBotSet: async () => ({ success: true }),
		},
		browser: {
			openExternal: async () => {},
		},
		wechat: {
			snapshot: async () => ({ ok: false, message: "预览模式不支持" }),
			setEnabled: async () => ({ ok: false, message: "预览模式不支持" }),
			updateSettings: async () => ({ ok: false, message: "预览模式不支持" }),
			renameAccount: async () => ({ ok: false, message: "预览模式不支持" }),
			logout: async () => ({ ok: false, message: "预览模式不支持" }),
			beginLogin: async () => ({ ok: false, message: "预览模式不支持" }),
			cancelLogin: async () => ({ ok: false, message: "预览模式不支持" }),
			submitVerifyCode: async () => ({ ok: false, message: "预览模式不支持" }),
			getLoginState: async () => ({ phase: "idle" as const }),
			getStatus: async () => ({ status: "disconnected" as const, account: null, activeBindings: 0 }),
			getBindings: async () => [],
			unbindChat: async () => ({ ok: false, message: "预览模式不支持" }),
			onStatus: () => () => {},
			onLoginState: () => () => {},
			onBindingsChanged: () => () => {},
		},
		scratchPad: {
			list: async () => [],
			create: async () => ({ id: "", name: "", path: "", createdAt: 0, updatedAt: 0 }),
			delete: async () => {},
			load: async () => ({ content: "", lastEditedAt: 0, cursorPosition: 0 }),
			save: async () => {},
			export: async () => false,
		},

		imagegen: {
			generate: async (_request) => ({ ok: false, error: "notConfigured" }),
			getConfig: async () => ({ providers: [], activeProviderId: "", activeModel: "" }),
			saveConfig: async (config) => ({ ok: true, config }),
			readImageBlob: async () => null,
		},

		localImage: {
			readBytes: async () => null,
		},

		videogen: {
			submit: async () => ({ ok: false, error: "notConfigured" }),
			cancel: async () => ({ ok: false }),
			getConfig: async () => ({ ...EMPTY_VIDEO_GEN_CONFIG, providers: [] }),
			saveConfig: async (config) => ({ ok: true, config }),
			listJobs: async () => [],
			onEvent: () => () => {},
		},
		enhance: {
			run: async () => ({ ok: false, errorKind: "sdk-unavailable", message: "preview mode" }),
			cancel: async () => ({ ok: true }),
			onEvent: () => () => {},
		},

		suggestion: {
			run: async () => ({ ok: false, errorKind: "sdk-unavailable", message: "preview mode" }),
			cancel: async () => ({ ok: true }),
			onEvent: () => () => {},
		},

		voiceTranscription: {
			getConfig: async () => ({ ...DEFAULT_VOICE_TRANSCRIPTION_CONFIG, hasApiKey: false, hasVolcAppId: false, hasVolcAccessToken: false, apiKeyHint: null, volcAppIdHint: null, volcAccessTokenHint: null, runtimeReady: false }),
			saveConfig: async (config) => ({
				ok: true,
				config: {
					enabled: config.enabled,
					engine: config.engine,
					cloudProvider: config.cloudProvider,
					baseUrl: config.baseUrl,
					model: config.model,
					language: config.language,
					inputDeviceId: config.inputDeviceId,
					localModelId: config.localModelId,
					cliPath: config.cliPath,
					cloudResourceId: config.cloudResourceId,
					hasApiKey: false,
					hasVolcAppId: false,
					hasVolcAccessToken: false,
					apiKeyHint: null,
					volcAppIdHint: null,
					volcAccessTokenHint: null,
					runtimeReady: false,
				},
			}),
			transcribe: async () => ({ ok: false, error: "notConfigured" }),
			test: async () => ({ ok: false, error: "notConfigured" }),
			revealSecret: async () => null,
			cancel: async () => {},

			startStream: async () => ({ ok: false, error: "notConfigured" }),
			sendStreamFrame: () => {},
			finishStream: async () => ({ ok: false, error: "notConfigured" }),
			onStreamPartial: () => () => undefined,
			runtimeStatus: async () => ({ autoRuntimeSupported: false, cliReady: false, cliSource: "none", cliPath: null, runtimeVersion: null, models: [] }),
			installRuntime: async () => ({ ok: false, error: "preview stub" }),
			installModel: async () => ({ ok: false, error: "preview stub" }),
			deleteModel: async () => ({ ok: false, error: "preview stub" }),
			onRuntimeProgress: () => () => undefined,
			abortInstall: async () => false,
		},

		catalog: {
			status: async () => ({ builtin: null, overlay: null, hasOverlayFiles: false, hasBackup: false }),
			check: async () => ({ ok: false, code: "network", message: "preview stub" }),
			updateFromGithub: async () => ({ ok: false, code: "network", message: "preview stub" }),
			restore: async () => ({ ok: true, updated: false }),
			restorePrevious: async () => ({ ok: false, code: "no-backup", message: "preview stub" }),
			openFile: async () => undefined,
		},

		quickMessages: {
			get: async () => ({
				items: [...PREVIEW_QUICK_MESSAGES],
				defaults: [...PREVIEW_QUICK_MESSAGES],
				filePath: "(preview)",
				seeded: false,
				defaultsAvailable: false,
			}),
			save: async (items) => ({
				ok: true as const,
				snapshot: { items, defaults: [...PREVIEW_QUICK_MESSAGES], filePath: "(preview)", seeded: false, defaultsAvailable: false },
			}),
			openFile: async () => undefined,
		},

		replyActions: {
			get: async () => ({
				items: PREVIEW_REPLY_ACTIONS.map((rule) => ({ ...rule, triggers: rule.triggers.map((trigger) => ({ ...trigger })) })),
				defaults: [],
				filePath: "(preview)",
				seeded: false,
				defaultsAvailable: false,
			}),
			save: async (items) => ({
				ok: true as const,
				snapshot: { items, defaults: [], filePath: "(preview)", seeded: false, defaultsAvailable: false },
			}),
			openFile: async () => undefined,
		},
		automation: {
			getSnapshot: async () => ({
				revision: 0,
				settings: { maxConcurrentRuns: 1, historyLimit: 200 },
				tasks: [],
				runs: [],
			}),
			createTask: async (input) => ({
				id: "preview-task",
				name: input.name,
				projectId: input.projectId,
				prompt: input.prompt,
				schedule: input.schedule,
				enabled: input.enabled !== false,
				budget: {
					...(input.budget?.timeoutMs == null ? {} : { timeoutMs: input.budget.timeoutMs }),
					...(input.budget?.maxTokens == null ? {} : { maxTokens: input.budget.maxTokens }),
					...(input.budget?.maxCostUsd == null ? {} : { maxCostUsd: input.budget.maxCostUsd }),
					...(input.budget?.maxSteps == null ? {} : { maxSteps: input.budget.maxSteps }),
				},
				createdAt: Date.now(),
				updatedAt: Date.now(),
			}),
			updateTask: async (taskId, patch) => ({
				id: taskId,
				name: patch.name ?? "Updated Task",
				projectId: patch.projectId ?? "preview-project",
				prompt: patch.prompt ?? "",
				schedule: patch.schedule ?? { type: "manual" },
				enabled: patch.enabled !== false,
				budget: { timeoutMs: 30 * 60_000 },
				createdAt: Date.now(),
				updatedAt: Date.now(),
			}),
			deleteTask: async () => true,
			runNow: async (taskId) => ({
				id: "preview-run",
				taskId,
				taskName: "Preview Task",
				projectId: "preview-project",
				trigger: "manual",
				status: "succeeded",
				queuedAt: Date.now(),
				startedAt: Date.now(),
				endedAt: Date.now(),
				durationMs: 1000,
				updatedAt: Date.now(),
				inputTokens: 100,
				outputTokens: 200,
				costUsd: 0.01,
				stepCount: 2,
				events: [],
			}),
			abortRun: async () => true,
			deleteRuns: async (runIds) => runIds.length,
			clearRuns: async () => 0,
			updateSettings: async (patch) => ({
				maxConcurrentRuns: patch.maxConcurrentRuns ?? 1,
				historyLimit: patch.historyLimit ?? 200,
			}),
			previewCron: async () => ({ valid: true, nextRuns: [] }),
			onChanged: () => () => {},
		},

		agentProfiles: {
			getSnapshot: async () => ({
				revision: 0,
				agents: [],
				settings: { selectionToolEnabled: true, systemSelectionEnabled: false, selectionToolAgentId: null, sessionAgentBindings: {} },
				agentOrder: [],
			}),
			create: async () => {
				throw new Error("preview stub");
			},
			update: async () => {
				throw new Error("preview stub");
			},
			remove: async () => {
				throw new Error("preview stub");
			},
			resetBuiltin: async () => {
				throw new Error("preview stub");
			},
			duplicate: async () => {
				throw new Error("preview stub");
			},

			updateSettings: async (patch) => ({
				selectionToolEnabled: patch.selectionToolEnabled ?? true,
				systemSelectionEnabled: patch.systemSelectionEnabled ?? false,
				selectionToolAgentId: patch.selectionToolAgentId ?? null,
				sessionAgentBindings: {},
			}),

			bindSession: async () => ({ selectionToolEnabled: true, systemSelectionEnabled: false, selectionToolAgentId: null, sessionAgentBindings: {} }),

			reorder: async (agentIds) => agentIds,
			onChanged: () => () => {},
			invoke: async () => ({ ok: false as const, errorKind: "spawn-failed" as const, message: "unavailable" }),
			cancelInvoke: async () => ({ ok: false }),
			onInvokeEvent: () => () => {},
		},

		favorites: {
			list: async () => [],
			add: async () => {
				throw new Error("preview stub");
			},
			remove: async () => false,
			removeMany: async () => 0,

			reorder: async () => [],
		},

		selectionTool: {
			getState: async () => ({ visible: false }),
			hide: async () => {},
			resize: async () => {},
			insertToMain: async () => false,
			onCaptured: () => () => {},
			onStateChanged: () => () => {},
			onInserted: () => () => {},
		},
		cua: {
			onApprovalRequest: () => () => {},
			sendApprovalResponse: async () => {},
			getState: async () => ({ enabled: false, sessionOverrides: {} }),
			setState: async () => ({ enabled: false, sessionOverrides: {} }),
		},
	};
}
