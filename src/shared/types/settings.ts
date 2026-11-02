import type { AgentBackend } from "./agent";
import type { AcpToolConfig } from "./acp";
import type { SessionSortModeId } from "./session";
import type { BusySendDelivery } from "../busySendDelivery";
import type { SessionStatusPlacement } from "../sessionStatusPlacement";
import { SESSION_TAB_MAX_WIDTH_DEFAULT } from "../sessionTabWidth";
import { createDefaultExternalEditorSettings, type ExternalEditorSettings } from "./project";
import type { SecurityConfig } from "./security";
import type { CustomThemeSnapshot } from "../customThemes";
import { createDefaultSoundAlertSettings, type SoundAlertSettings } from "./soundAlert";

export type SendShortcutMode = "enter-send" | "ctrl-enter-send" | "shift-enter-send";

export type TpsDisplayMode = "streaming" | "endToEnd";

export type AppThemeMode = "system" | "light" | "dark" | "schedule";

export type AppAccentMode = "default" | "green" | "blue" | "purple" | "amber" | "rose";

export type AppSkinId = "classic-green" | "fresh-green" | "graphite" | "sea-blue" | "warm-beige" | "custom";

export type LogoStyle = "classic" | "pi-tui" | "custom";

export function resolveLogoStyle(value: string | null | undefined): LogoStyle {
	if (value === "classic" || value === "custom") return value;
	return "pi-tui";
}

export const APP_DISPLAY_NAME_DEFAULT = "APIX";

export const APP_DISPLAY_NAME_MAX_LENGTH = 24;

export function resolveAppDisplayName(value: string | null | undefined): string {
	const trimmed = typeof value === "string" ? value.trim() : "";
	if (trimmed === "" || trimmed.length > APP_DISPLAY_NAME_MAX_LENGTH) return APP_DISPLAY_NAME_DEFAULT;
	return trimmed;
}

export const CUSTOM_LOGO_DATA_URL_MAX_LENGTH = 1_500_000;
export type AppLanguageMode = "system" | "zh-CN" | "zh-TW" | "en-US" | "pseudo";

export function isTraditionalChineseLanguageTag(language: string): boolean {
	const normalized = language.trim().replace(/_/g, "-").toLowerCase();
	return normalized.includes("hant") || /^zh-(tw|hk|mo)\b/.test(normalized);
}
export type LinkOpenMode = "external" | "internal";

export type WebNetworkAddress = {
	address: string;
	interfaceName: string;
	cidr: string | null;
	isPrivate: boolean;
	family: "IPv4" | "IPv6";
};

export type WorkspaceContentOpenMode = "split" | "maximize";

export type SessionTabOpenMode = "preview" | "permanent";
export type AppFontSizeMode = "compact" | "medium" | "large" | "xlarge";

export type UpdateSourceId = "atomgit" | "github";

export type MirrorHealthStatus = "ok" | "slow" | "broken";

export type MirrorHealthResult = {
	id: UpdateSourceId;
	status: MirrorHealthStatus;

	latencyMs: number;

	speedKBps: number;

	error?: string;

	checkedAt: number;
};

export const DEFAULT_PET_SCALE = 0.3;

export const DEFAULT_TOAST_DURATION_MS = 4000;

export const TOAST_DURATION_STICKY_MS = -1;
export type AppFontBaseMode = "system" | "sans" | "serif" | "custom";
export type AppFontMonoMode = "system-mono" | "custom";

export type TerminalThemeId = "inherit" | "solarized-light" | "solarized-dark" | "one-dark" | "monokai";

export type TerminalConfirmCloseMode = "never" | "running" | "always";

export type TerminalCursorStyle = "block" | "bar" | "underline";

export type StartupWindowMode = "last" | "fullscreen" | "maximized" | "normal-large" | "normal-medium" | "normal-compact";

export type DisabledExtensionEntry = {
	scope: "user" | "project" | "unknown";
	source: string;
};

export type AppSettings = {
	autoDownloadUpdates: boolean;
	defaultAgentBackendManual?: boolean;
	useNativeTitleBar: boolean;
	showNativeMenu: boolean;
	sendShortcut: SendShortcutMode;

	enhanceModel?: { provider: string; modelId: string } | null;

	enhanceIncludeContext?: boolean;

	promptSuggestionEnabled?: boolean;

	promptSuggestionModel?: { provider: string; modelId: string } | null;

	shortcuts?: Record<string, string>;

	theme: AppThemeMode;

	themeScheduleLightStart: string;

	themeScheduleDarkStart: string;

	accent: AppAccentMode;

	themeSkin: AppSkinId;

	logoStyle?: LogoStyle;

	logoCustomImage?: string;

	appDisplayName?: string;

	customThemeOverrides: Record<string, string>;

	customTheme?: CustomThemeSnapshot;

	backgroundImage: string;

	backgroundImageOpacity: number;

	weWorkshopDir: string;

	weWallpaperId: string;

	language: AppLanguageMode;

	startupWindowMode: StartupWindowMode;
	piEnvironmentChecked: boolean;

	piInstall?: { command: string; version: string };

	sessionTabOpenMode: SessionTabOpenMode;

	autoSessionTitle: boolean;

	busySendDelivery: BusySendDelivery;

	tpsDisplayMode: TpsDisplayMode;

	quickMessages: string[];

	enableGitManagement: boolean;

	gitCommitMessagePrompt: string;

	gitCommitMessageProvider: string;

	gitCommitMessageModel: string;

	gitExecutablePath: string;

	closeToTray: boolean;

	singleInstance: boolean;

	enableNotifications: boolean;

	soundAlert: SoundAlertSettings;

	askNotificationEnabled: boolean;

	alertOnlyWhenUnfocused: boolean;

	agentCountReminderEnabled: boolean;

	announcementNotificationEnabled: boolean;

	toastDurationMs: number;

	showThinking: boolean;

	expandInterimDuringStream: boolean;

	processGroupDisplay: boolean;

	showDevTools: boolean;

	developerDiagnostics: boolean;

	electronChromiumSandbox: boolean;

	piProxyEnabled: boolean;

	piProxyUrl: string;

	piProxyBypass: string;

	piProxyProviders: string[];

	piProxyModels: string[];

	desktopProxyEnabled: boolean;

	desktopProxyUrl: string;

	desktopProxyBypass: string;

	customPiPath: string;

	piCustomPaths: string[];

	telemetryEnabled: boolean;

	webServiceEnabled: boolean;

	webServiceHost: string;

	webServicePort: number;

	webServiceRequiresAuth: boolean;

	webServiceToken?: string;

	webServiceTokenGeneratedAt?: number;

	webServiceTokenExpiresIn?: number;

	webRemoteCloudflaredProtocol?: WebRemoteCloudflaredProtocol;

	webRemoteCloudflaredExtraArgs?: string;

	telemetryInstallId?: string;

	telemetryLastHeartbeatDate?: string;

	installationType?: "portable" | "installed";

	rpcTimeout: number;

	linkOpenMode: LinkOpenMode;

	workspaceContentOpenMode: WorkspaceContentOpenMode;

	/** @deprecated 由 chatContentWidthPct 取代；仅保留读取旧设置做迁移。 */
	contentMaxWidth: number;

	chatContentWidthPct: number;

	sessionStatusPlacement: SessionStatusPlacement;

	scrollToLatestOnSend?: boolean;

	navigationMode: "tabs" | "simple";
	sessionTabMaxWidth: number;

	maxEditorFileSizeMB: number;

	externalEditors: ExternalEditorSettings;

	wslEnabled: boolean;

	wslDistro: string;

	wslUser: string;

	petEnabled: boolean;

	petId: string;

	petAlwaysOnTop: boolean;

	petScale: number;

	petPatrolEnabled: boolean;

	petPatrolPauseMin: number;

	floatingBallEnabled: boolean;

	floatingBallExpandTarget: "mini" | "compact";

	floatingBallAlwaysOnTop: boolean;

	floatingBallShowRunningBadge: boolean;

	floatingBallSnapToEdge: boolean;

	idleAgentAutoRelease: boolean;

	idleAgentKeepCount: number;

	idleAgentTimeoutMin: number;

	standbyRuntimeEnabled?: boolean;

	sessionStoreEnabled?: boolean;

	cuaEnabled: boolean;

	cuaAutoApprove: boolean;

	browserAgentEnabled: boolean;

	browserAgentAutoApprove: boolean;

	favoriteModels: string[];

	hiddenProviders?: string[];

	hiddenModels?: string[];

	hiddenAuthProviders?: string[];

	hiddenModules?: string[];

	hiddenComposerFeatures?: string[];

	providerOrder?: string[];

	recentProviders?: string[];

	lastUsedModel?: { provider: string; modelId: string };

	fontSize: AppFontSizeMode;

	uiFontSize: AppFontSizeMode | null;

	tabBarFontSize: AppFontSizeMode | null;

	chatFontSize: AppFontSizeMode | null;

	inputFontSize: AppFontSizeMode | null;

	zoomFactor: number;

	fontFamilyBase: AppFontBaseMode;

	fontFamilyBaseCustom: string;

	fontFamilyMono: AppFontMonoMode;

	fontFamilyMonoCustom: string;

	terminalTheme: TerminalThemeId;

	terminalFontSize: number | null;

	terminalFontFamily: string;

	terminalScrollback: number;

	terminalCursorStyle: TerminalCursorStyle;

	terminalCursorBlink: boolean;

	terminalCopyOnSelect: boolean;

	terminalPaddingY: number;

	terminalConfirmClose: TerminalConfirmCloseMode;

	terminalStartupCommand: string;

	catalogAutoUpdate: boolean;

	updateSource: UpdateSourceId;

	customUpdateSourceUrl: string;

	updateSourceAtomgitMigrated?: boolean;

	updateLastCheckAt?: number;

	updateNotifiedVersion?: string;

	updateSkippedVersion?: string;

	updatePiNotifiedVersion?: string;

	updateDotHintSeen?: boolean;

	defaultAgentBackend: AgentBackend;

	piRpcOffline: boolean;

	piRpcNoExtensions: boolean;

	piRpcNoSkills: boolean;

	sidebarWidth?: number;

	drawerWidth?: number;

	sidebarExpandedProjectIds?: string[];

	sidebarNavTab?: "active" | "chats" | "projects";

	pinnedSessionIds?: string[];

	sidebarStickyGroupHeaders?: boolean;

	sessionSortMode?: SessionSortModeId;

	kimiWorkShareRoot?: string;

	removedBuiltInExtensions: string[];

	disabledExtensions: DisabledExtensionEntry[];

	disabledSkills: string[];

	disabledPrompts: string[];

	imageGenSize: string;

	imageGenWatermark: boolean;

	imageGenOutputFormat: string;

	securityConfig?: SecurityConfig;

	acpEnabled?: boolean;

	acpTools?: AcpToolConfig[];
};

export const WEB_TOKEN_EXPIRES_IN_CHOICES = [0, 3_600_000, 86_400_000, 604_800_000, 2_592_000_000] as const;

export const WEB_REMOTE_CLOUDFLARED_PROTOCOLS = ["auto", "quic", "http2"] as const;
export type WebRemoteCloudflaredProtocol = (typeof WEB_REMOTE_CLOUDFLARED_PROTOCOLS)[number];

export function sanitizeCloudflaredExtraArgs(value: unknown): string {
	if (typeof value !== "string") return "";
	const trimmed = value.trim();
	if (!trimmed || trimmed.length > 500) return "";
	return /^[ -~]+$/.test(trimmed) ? trimmed : "";
}

export function isValidWebTokenShape(value: string): boolean {
	return /^[!-~]{8,128}$/.test(value);
}

export type WebServiceStatusInfo = {
	running: boolean;
	host: string;
	port: number;
	token: string;
	requiresAuth: boolean;
	tokenExpiresAt: number | null;
};

export type PetMode = "idle" | "running" | "failed" | "waiting" | "waving" | "hidden" | "jumping" | "running-right" | "running-left" | "review";

export type PetAggregateState = {
	mode: PetMode;

	runningCount: number;

	errorCount: number;

	activeAgentId: string | null;
	timestamp: number;
};

export type PetManifest = {
	id: string;
	displayName: string;
	description?: string;

	source: "builtin" | "petdex";

	spritesheetUrl: string;
};

export type PetWindowCaps = {
	transparent: boolean;

	clickThrough: boolean;

	freePosition: boolean;
};

export type PetNotification = {
	type: "error" | "done" | "waiting";
	text: string;

	agentId?: string;
	timestamp: number;

	persistent?: boolean;

	title?: string;

	status?: string;
};

export function createDefaultAppSettings(): AppSettings {
	return {
		useNativeTitleBar: true,
		showNativeMenu: false,
		sendShortcut: "enter-send",
		defaultAgentBackend: "pi",
		theme: "dark",
		themeScheduleLightStart: "07:00",
		themeScheduleDarkStart: "19:00",
		accent: "default",
		themeSkin: "classic-green",
		logoStyle: "classic",
		logoCustomImage: "",
		appDisplayName: "",
		customThemeOverrides: {},
		backgroundImage: "",
		backgroundImageOpacity: 0.8,
		weWorkshopDir: "",
		weWallpaperId: "",
		language: "system",
		startupWindowMode: "last",
		piEnvironmentChecked: false,

		disabledExtensions: [],

		disabledSkills: [],

		disabledPrompts: [],
		sessionTabOpenMode: "preview",

		autoSessionTitle: true,

		busySendDelivery: "steer",
		tpsDisplayMode: "streaming",

		quickMessages: [],
		enableGitManagement: true,
		gitCommitMessagePrompt: "请根据以下 git diff 生成一条中文 git commit message。\n\n变更描述：\n{diff}\n\nGitmoji 对应关系：\n✨ feat - 新功能\n🐛 fix - Bug 修复\n📚 docs - 文档更新\n💎 style - 代码格式\n♻️ refactor - 重构\n🧪 test - 测试\n🔧 chore - 构建/工具",
		gitCommitMessageProvider: "",
		gitCommitMessageModel: "",
		gitExecutablePath: "",
		closeToTray: true,
		singleInstance: true,
		enableNotifications: true,

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
		scrollToLatestOnSend: true,
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
		floatingBallShowRunningBadge: true,
		floatingBallSnapToEdge: true,

		idleAgentAutoRelease: true,
		idleAgentKeepCount: 5,
		idleAgentTimeoutMin: 60,
		standbyRuntimeEnabled: true,

		sessionStoreEnabled: true,
		cuaEnabled: false,
		cuaAutoApprove: true,

		browserAgentEnabled: false,
		browserAgentAutoApprove: true,
		favoriteModels: [],

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
	};
}
