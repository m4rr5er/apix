import { app, dialog, ipcMain, shell } from "electron";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { ipcChannels } from "../../shared/ipc";
import { isDevChannelBuild, resolveUpdateChannel } from "../update/channelIdentity";
import { UPDATE_REPO, UPDATE_REPO_OWNER } from "../update/releaseRepo";
import { probeAllMirrors, type MirrorHealthResult } from "../update/mirrorHealth";
import { ChangelogService, type ChangelogLanguage } from "../update/ChangelogService";
import { normalizeUpdateSource } from "../update/updateSources";
import type { RpcLogEntry } from "../../shared/types/rpcLog";
import { resolveAppTimes } from "../utils/appInfoTimes";
import { join } from "node:path";
import { promisify } from "node:util";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { PiMcpCli } from "../pi/piMcpCli";
import { piChangelogService } from "../pi/PiChangelogService";
import { validateMcpConfigFile } from "../config/mcpConfig";
import { discoverExternalAgentProviders, resolveExternalAgentKey } from "../config/externalAgentDiscovery";
import { PiResourceConfigService } from "../config/PiResourceConfigService";
import { PiResourceStateStore } from "../config/PiResourceStateStore";
import { tmpdir } from "node:os";
import { installPiRuntimeNode, piRuntimeNodeBinDir, probeNodeVersion, detectPiRuntimeNode } from "../pi/runtimeNodeInstall";
import { runPiGlobalInstall } from "../pi/piGlobalInstall";
import { isValidWebTokenShape, WEB_TOKEN_EXPIRES_IN_CHOICES, type NpmAvailabilityResult, type PiInstallExecResult, type PiInstallStatus, type PiRuntimeNodeInstallResult, type PiRuntimeNodeStatus, type WebServiceStatusInfo } from "../../shared/types";
import type { AppInfo, AppLogLevel, AppLogQuery, AppSettings, AvailableModel, ChangelogPayload, CreatePiSkillInput, ModelListReport, ModelsVerifyResult, SessionCommandResult, SessionRuntimeTarget } from "../../shared/types";
import { invalidatePiInstallationCache, type PiLocator } from "../pi/PiLocator";
import { validateInstallCommand } from "../pi/installCommandPolicy";
import { resolvePiInstallGuard } from "../pi/piInstallGuard";
import { sanitizePiCustomPaths } from "../pi/piCustomPaths";
import type { SettingsStore } from "../settings/SettingsStore";
import type { ConfigManager } from "../config/ConfigManager";
import type { AgentManager } from "../pi/AgentManager";
import type { AppLogger } from "../logging/AppLogger";
import type { RpcLogger } from "../logging/RpcLogger";
import type { SessionRuntimeCoordinator } from "../sessions/SessionRuntimeCoordinator";
import { resolveConfigProxyTarget } from "../sessions/sessionProxyPolicy";
import { setConfiguredGitPath } from "../git/gitExecutable";
import { openSystemPath } from "../fs/openPath";
import { applyTrayLogoStyle, applyWindowLogoStyle } from "../appWindowLogo";
import { syncTaskbarShortcutIcon } from "../appTaskbarIdentity";
import { refreshShortcutBindings } from "../appShortcuts";
import type { ConfigProxyMode } from "../../shared/types/fetchedModel";
import type { SkillManager } from "../skills/SkillManager";
import { fetchModelList, invalidateModelListCache, modelsFromPiConfig, refreshModelCatalogStore, refreshModelList, resolveModelListReport } from "../pi/modelListCache";
import { TokendanceCatalogStore } from "../config/tokendanceCatalog";
import type { TokendanceInstallResult } from "../config/tokendanceInstaller";
import type { TokendanceAuthMode, TokendanceAuthStore } from "../config/tokendanceAuth";
import type { TokendancePaymentStore } from "../config/tokendancePayment";
import type { ProjectResourceManager } from "../projects/ProjectResourceManager";

import { probePiModel } from "../pi/PiModelProber";
import { PROBE_AGENT_DIR_ENV, buildProbeDraftFiles, toWslAccessiblePath } from "../pi/probeDraftConfig";
import type { PiModelCapabilityCache } from "../pi/PiModelCapabilityCache";
import { getPiAiCatalogIndex, readBuiltinPiAiCatalogVersion } from "../pi/piAiBuiltinCatalog";
import { resolveModelSpecFromCatalogs } from "../pi/modelCapabilityResolver";
import { getProcessSnapshot } from "../process/ProcessMonitor";
import type { AgentProcessMetric, ArchStatus, DiagnosticsSnapshot, ProcessMetricsSnapshot } from "../../shared/types";
import type { DiagnosticsMonitor } from "../diagnostics/DiagnosticsMonitor";
import { getWslExe, decodeWslOutput, parseWslDistroList } from "../wsl/wslExe";
import { listWebNetworkAddresses } from "../web/WebNetwork";
import { toggleMainWindowDevTools } from "../devTools";
import { USAGE_PROBE_CANDIDATES } from "../config/providerUsageProbe";
import { isDeclarativeTemplateId } from "../config/usageProbeTemplates";
import { saveUsageProbeForProvider } from "../config/userUsageProbes";
import type { UsageProbeProviderConfig, UsageProbeTestInput } from "../../shared/types/providerUsage";
import type { McpConfigFile, McpServerDefinition } from "../../shared/types/mcp";
import type { HealthExportResult, HealthReport, HealthReportContext, HealthReportFormat } from "../../shared/types";
import type { EnvironmentDoctor } from "../health/EnvironmentDoctor";
import type { LogBundleExporter } from "../health/LogBundleExporter";

function isRpcLogEntry(value: unknown): value is RpcLogEntry {
	if (typeof value !== "object" || value === null) return false;
	const entry = value as Record<string, unknown>;
	return typeof entry.id === "string" && typeof entry.agentId === "string" && (entry.direction === "send" || entry.direction === "recv" || entry.direction === "model") && typeof entry.summary === "string" && typeof entry.time === "number";
}

function isUnknownRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringRecord(value: unknown): value is Record<string, string> {
	return isUnknownRecord(value) && Object.values(value).every((entry) => typeof entry === "string");
}

const MCP_EXPOSURE_VALUES = ["codemode", "codemode-deferred", "deferred", "direct", "hidden"];

function isProviderAuth(value: unknown): boolean {
	return isUnknownRecord(value) && (value.provider === undefined || typeof value.provider === "string");
}

function isMcpServerDefinition(value: unknown): value is McpServerDefinition {
	if (!isUnknownRecord(value)) return false;
	const optionalString = (key: string) => !(key in value) || value[key] === undefined || typeof value[key] === "string";
	const optionalExposure = (key: string) => !(key in value) || value[key] === undefined || (typeof value[key] === "string" && MCP_EXPOSURE_VALUES.includes(value[key]));

	return (
		["command", "cwd", "url"].every(optionalString) &&
		optionalString("description") &&
		optionalExposure("exposure") &&
		(!("toolExposure" in value) || value.toolExposure === undefined || (isUnknownRecord(value.toolExposure) && Object.values(value.toolExposure).every((entry) => typeof entry === "string" && MCP_EXPOSURE_VALUES.includes(entry)))) &&
		(!("enabled" in value) || value.enabled === undefined || typeof value.enabled === "boolean") &&
		(!("timeout" in value) || value.timeout === undefined || (typeof value.timeout === "number" && Number.isFinite(value.timeout) && value.timeout > 0)) &&
		(!("args" in value) || value.args === undefined || (Array.isArray(value.args) && value.args.every((entry) => typeof entry === "string"))) &&
		(!("env" in value) || value.env === undefined || isStringRecord(value.env)) &&
		(!("headers" in value) || value.headers === undefined || isStringRecord(value.headers)) &&
		(!("oauth" in value) || value.oauth === undefined || isUnknownRecord(value.oauth)) &&
		(!("auth" in value) || value.auth === undefined || isProviderAuth(value.auth))
	);
}

function isMcpConfigFile(value: unknown): value is McpConfigFile {
	if (!isUnknownRecord(value)) return false;
	if ("settings" in value && value.settings !== undefined && !isUnknownRecord(value.settings)) return false;
	if (!("mcpServers" in value) || value.mcpServers === undefined) return true;
	if (!isUnknownRecord(value.mcpServers)) return false;
	return Object.values(value.mcpServers).every(isMcpServerDefinition);
}

type McpScopeRequest = { kind: "global" } | { kind: "project"; projectId: string };

function parseMcpScopeRequest(value: unknown): McpScopeRequest {
	if (value === undefined || value === null) return { kind: "global" };
	if (typeof value === "string") {
		if (!value.trim() || value.length > 256) throw new Error("Invalid project id.");
		return { kind: "project", projectId: value.trim() };
	}
	if (!isUnknownRecord(value)) throw new Error("Invalid MCP scope.");
	const scope = value.scope;
	if (scope === undefined || scope === "global") return { kind: "global" };
	if (scope !== "project") throw new Error("Invalid MCP scope.");
	const projectId = value.projectId;
	if (typeof projectId !== "string" || !projectId.trim() || projectId.length > 256) throw new Error("Invalid project id.");
	return { kind: "project", projectId: projectId.trim() };
}

export type SystemIpcDeps = {
	afterSettingsUpdate?: (settings: AppSettings) => void;
	piLocator: PiLocator;
	settingsStore: SettingsStore;
	configManager: ConfigManager;
	projectResourceManager: ProjectResourceManager;
	agentManager: AgentManager;
	skillManager: SkillManager;
	appLogger: AppLogger;
	rpcLogger: RpcLogger;
	sessionRuntimeCoordinator: SessionRuntimeCoordinator;

	isProjectTrusted?: (projectId: string, projectRoot: string) => Promise<boolean>;

	piRuntimeNodeInstaller?: import("../pi/runtimeNodeInstall").RuntimeNodeInstallerDeps;

	diagnosticsMonitor?: DiagnosticsMonitor;

	stopAgentFromMonitor: (agentId: string) => Promise<SessionCommandResult<SessionRuntimeTarget | undefined>>;

	modelCapabilityCache: PiModelCapabilityCache;

	relaunchApp?: () => void;

	tokendanceCatalog?: TokendanceCatalogStore;

	tokendanceAuth?: TokendanceAuthStore;

	tokendancePayment?: TokendancePaymentStore;

	tokendanceInstall?: (apiKey?: string) => Promise<TokendanceInstallResult>;

	environmentDoctor?: EnvironmentDoctor;

	logBundleExporter?: LogBundleExporter;
	getMainWindow: () => Electron.BrowserWindow | null;

	getTray?: () => Electron.Tray | null;
	mainCopy: (key: string, params?: Record<string, string | number>) => string;

	checkForAppUpdate: () => Promise<void>;

	downloadAppUpdate: () => Promise<void>;

	installAppUpdate: () => void;

	openExternalUrl: (url: string, forceSystem?: boolean) => Promise<void>;

	resolveWslEnvironment?: (distro: string, user: string, logger: { warn: (msg: string, detail: unknown) => void }) => Promise<import("../wsl/WslPaths").WslEnvironment>;

	reactToPetSettings?: (prev: AppSettings, next: AppSettings) => Promise<void>;

	reactToCuaSettings?: (prev: AppSettings, next: AppSettings) => Promise<void>;

	configureSessionScannerWsl?: (env: import("../wsl/WslPaths").WslEnvironment) => Promise<void>;
	clearSessionScannerWsl?: () => void;

	setFeishuLocale?: (locale: unknown) => void;

	setFeishuConfigDefaultBotName?: (name: string) => void;

	refreshTrayContextMenu?: () => void;

	notifyTitleBarChange?: (window: Electron.BrowserWindow) => void;

	applyNativeThemeSource?: (settings: AppSettings) => void;

	applyDesktopProxy?: (settings: AppSettings) => Promise<void>;

	testPiProxy?: (settings: AppSettings, proxyUrl?: string, translate?: (key: string, params?: Record<string, string | number>) => string) => Promise<import("../../shared/types").PiProxyTestResult>;

	applyWebServiceSettings?: (settings: AppSettings) => Promise<void>;

	restartWebService?: (settings: AppSettings) => Promise<void>;

	setSessionCatalogIdentityContext?: (ctx: { wslDistro?: string; wslUser?: string }) => void;

	configureSkillManagerWsl?: (env: import("../wsl/WslPaths").WslEnvironment | null) => void;
	configurePromptManagerWsl?: (env: import("../wsl/WslPaths").WslEnvironment | null) => void;
	configureExtensionManagerWsl?: (env: import("../wsl/WslPaths").WslEnvironment | null) => void;
	configureConfigManagerWsl?: (env: import("../wsl/WslPaths").WslEnvironment | null) => void;
	configureXuePromptManagerWsl?: (env: import("../wsl/WslPaths").WslEnvironment | null) => void;
	configureAgentManagerWsl?: (env: import("../wsl/WslPaths").WslEnvironment | null) => void;

	sessionCommandIpcError?: (error: import("../../shared/types").SessionCommandError) => Error;

	readSkillContent?: (skillPath: string) => Promise<import("../../shared/types").SkillContentResult>;

	extensionManager?: {
		checkPiUpdate: () => Promise<import("../../shared/types").PiUpdateCheckResult>;
		updatePi: () => Promise<import("../../shared/types").PiCliUpdateResult>;
	};

	webServiceManager?: { stop: () => Promise<void>; getStatus: () => WebServiceStatusInfo; rotateToken: () => void; setTokenPolicy: (input: { token?: string; expiresIn?: number }) => void };

	terminalManager?: { closeAll: () => void };

	isQuitting?: { value: boolean };

	RELEASES_URL?: string;

	devBranch?: string;

	updateService?: {
		getSnapshot: () => import("../../shared/types").AppUpdateStatusSnapshot;
		notifySeen: (kind: "app" | "pi", version: string) => Promise<void>;
		skipVersion: (version: string) => Promise<void>;
		checkNow: () => Promise<void>;

		applyPiCheckResult: (result: import("../../shared/types").PiUpdateCheckResult) => void;
		downloadNow: () => Promise<void>;
		installNow: () => void;
		applyAutoDownloadPreference: () => void;

		applyUpdateSource: () => void;
	};
};

function asConfigProxyMode(raw: unknown): ConfigProxyMode {
	return raw === "pi" || raw === "desktop" || raw === "off" ? raw : "follow";
}

function isWslName(value: string): boolean {
	return /^[A-Za-z0-9._][A-Za-z0-9._-]{0,63}$/.test(value);
}

async function probeSystemNodeVersion(piLocator: PiLocator): Promise<string | undefined> {
	try {
		if (process.platform === "win32") {
			const { stdout } = await promisify(execFile)(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", "node -v"], { env: piLocator.createProcessEnv(), timeout: 10_000, encoding: "utf8", windowsHide: true, shell: false });
			const version = stdout.trim();
			return /^v\d+\.\d+\.\d+$/.test(version) ? version : undefined;
		}
		return await probeNodeVersion("node");
	} catch {
		return undefined;
	}
}

async function probeSystemNpmVersion(piLocator: PiLocator): Promise<NpmAvailabilityResult> {
	try {
		const run = async () => {
			if (process.platform === "win32") {
				const { stdout } = await promisify(execFile)(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", "npm --version"], { env: piLocator.createProcessEnv(), timeout: 10_000, encoding: "utf8", windowsHide: true, shell: false });
				return stdout.trim();
			}
			const { stdout } = await promisify(execFile)("npm", ["--version"], {
				env: piLocator.createProcessEnv(),
				timeout: 10_000,
				encoding: "utf8",
			});
			return stdout.trim();
		};
		const version = await run();
		return version ? { available: true, version } : { available: false };
	} catch (error) {
		return { available: false, error: error instanceof Error ? error.message : String(error) };
	}
}

export function registerSystemIpc(deps: SystemIpcDeps): void {
	const {
		piLocator,
		settingsStore,
		configManager,
		projectResourceManager,
		agentManager,
		skillManager,
		appLogger,
		rpcLogger,
		sessionRuntimeCoordinator,
		isProjectTrusted,
		getMainWindow,
		getTray,
		mainCopy,
		checkForAppUpdate,
		downloadAppUpdate,
		installAppUpdate,
		openExternalUrl: doOpenExternalUrl,
		resolveWslEnvironment,
		reactToPetSettings,
		reactToCuaSettings,
		configureSessionScannerWsl,
		clearSessionScannerWsl,
		setFeishuLocale,
		setFeishuConfigDefaultBotName,
		refreshTrayContextMenu,
		updateService,
		notifyTitleBarChange,
		applyNativeThemeSource,
		applyDesktopProxy,
		testPiProxy,
		applyWebServiceSettings,
		restartWebService,
		setSessionCatalogIdentityContext,
		configureSkillManagerWsl,
		configurePromptManagerWsl,
		configureExtensionManagerWsl,
		configureConfigManagerWsl,
		configureXuePromptManagerWsl,
		configureAgentManagerWsl,
		sessionCommandIpcError,
		readSkillContent,
		extensionManager,
		webServiceManager,
		terminalManager,
		isQuitting,
		RELEASES_URL,
		devBranch,
		modelCapabilityCache,
		tokendanceCatalog,
		tokendanceAuth,
		tokendancePayment,
		tokendanceInstall,
		diagnosticsMonitor,
		environmentDoctor,
		logBundleExporter,
	} = deps;

	let piMcpCli: PiMcpCli | null = null;

	let piResourceService: PiResourceConfigService | undefined;
	const getPiMcpCli = () => {
		piMcpCli ??= new PiMcpCli({
			locator: piLocator,
			getSettings: () => settingsStore.get(),
			resolveProjectScope: async (projectId) => {
				const root = projectResourceManager.getProjectRoot(projectId);
				const trusted = isProjectTrusted ? await isProjectTrusted(projectId, root) : false;
				return { cwd: root, trusted };
			},
		});
		return piMcpCli;
	};

	const refreshPiModelCatalogs = async (): Promise<void> => {
		invalidateModelListCache();
		const snapshot = await modelCapabilityCache.refresh();
		if (snapshot) return;

		await refreshModelList(piLocator, settingsStore, configManager).catch(() => undefined);
	};

	const verifyModelsAfterSave = async (savedAt: number): Promise<void> => {
		let payload: ModelsVerifyResult;
		try {
			const report = await resolveModelListReport(piLocator, settingsStore, configManager, true, { retryOnEmpty: false });

			const ok = report.ok && report.models.length > 0 && report.source !== "config-fallback";

			const reason = report.source === "config-fallback" ? "config-fallback" : report.reason;
			payload = {
				ok,
				modelCount: report.models.length,
				reason,
				detail: report.detail ?? "",
				savedAt,
			};
			void appLogger.info("config", "Models config background verify", {
				ok,
				modelCount: payload.modelCount,
				reason,
			});
		} catch (error) {
			payload = {
				ok: false,
				modelCount: 0,
				reason: "cli-failed",
				detail: error instanceof Error ? error.message : String(error),
				savedAt,
			};
			void appLogger.warn("config", "Models config background verify failed", {
				detail: payload.detail,
			});
		}

		if (!payload.ok) {
			getMainWindow()?.webContents.send(ipcChannels.configModelsVerifyResult, payload);
		}
		void refreshPiModelCatalogs().catch(() => undefined);
	};

	ipcMain.handle(ipcChannels.piCheck, async (_event, force?: unknown) => {
		const settings = settingsStore.get();

		const forceWslProbe = force === true;
		const status = await piLocator.check(settings.customPiPath, settings.wslEnabled, settings.wslDistro, settings.wslUser, { forceWslProbe });
		void appLogger.info("pi", "Pi check completed", {
			installed: status.installed,
			version: status.version,
			command: status.command,
			error: status.error,
			forceWslProbe,
		});

		const snapshotPiVersion = updateService?.getSnapshot().piCli?.currentVersion;
		if (updateService && status.installed && status.version && snapshotPiVersion && snapshotPiVersion !== status.version) {
			void updateService.checkNow().catch((error: unknown) => {
				appLogger.warn("pi", "Pi update snapshot refresh failed", { error: error instanceof Error ? error.message : String(error) });
			});
		}
		return status;
	});

	ipcMain.handle(ipcChannels.piInstallations, async (_event, force?: unknown) => {
		const settings = settingsStore.get();
		const forceShellProbe = force === true;
		const installations = await piLocator.listInstallations(settings.customPiPath, settings.wslEnabled, settings.wslDistro, settings.wslUser, { forceShellProbe, customPaths: settings.piCustomPaths });
		void appLogger.info("pi", "Pi installations listed", {
			count: installations.length,
			forceShellProbe,

			sources: installations.map((item) => `${item.source}:${item.version ?? "unknown"}`),
		});
		return installations;
	});

	ipcMain.handle(ipcChannels.piSetCustomPaths, async (_event, input: unknown) => {
		const settings = settingsStore.get();
		const { paths, rejected } = sanitizePiCustomPaths(input);
		const activePath = settings.customPiPath.trim();
		const activeStillPresent = !activePath || paths.some((path) => path === activePath);
		const next = await settingsStore.update(activeStillPresent ? { piCustomPaths: paths } : { piCustomPaths: paths, customPiPath: "" });
		invalidatePiInstallationCache();
		void appLogger.info("pi", "Pi custom paths saved", {
			count: paths.length,
			rejected: rejected.length,

			clearedActive: !activeStillPresent,
		});
		return { paths: next.piCustomPaths, clearedActive: !activeStillPresent };
	});

	ipcMain.handle(ipcChannels.piChooseExecutable, async () => {
		const options = {
			properties: ["openFile"],
			title: mainCopy("mainPi.chooseExecutableTitle"),
			filters:
				process.platform === "win32"
					? [
							{ name: "Executables", extensions: ["exe", "cmd", "bat"] },
							{ name: "All Files", extensions: ["*"] },
						]
					: [{ name: "All Files", extensions: ["*"] }],
		} satisfies Electron.OpenDialogOptions;
		const result = await dialog.showOpenDialog(options);
		return result.canceled ? null : (result.filePaths[0] ?? null);
	});

	ipcMain.handle(ipcChannels.piCheckCustom, async (_event, customPath: string, activate?: unknown) => {
		const shouldActivate = activate !== false;
		const settings = settingsStore.get();
		const status = await piLocator.validateCustomPath(customPath, settings.wslEnabled, settings.wslDistro, settings.wslUser);
		if (status.installed && status.command && shouldActivate) {
			await settingsStore.update({ customPiPath: status.command });

			invalidatePiInstallationCache();
			void refreshPiModelCatalogs().catch(() => undefined);
		}
		void appLogger.info("pi", "Custom pi path checked", {
			installed: status.installed,
			version: status.version,
			command: status.command,
			error: status.error,

			wslEnabled: settings.wslEnabled,
			wslDistro: settings.wslDistro,
			wslUser: settings.wslUser,
		});
		return status;
	});

	ipcMain.handle(ipcChannels.projectsListModels, async (_event, _projectId?: string) => {
		try {
			const snapshot = await modelCapabilityCache.ensure();
			// 空快照（例如扩展尚未加载完）不能挡住 CLI 缓存：Qoder 登录后 CLI 已拿到模型，
			// 但 capability probe 可能暂时返回空数组，旧的 `??` 会让选择器误报「没有可用模型」。
			const models = snapshot && snapshot.models.length > 0 ? snapshot.models : await fetchModelList(piLocator, settingsStore, configManager);
			void appLogger.info("pi", "Model list resolved", {
				count: models.length,
				capabilitiesReady: snapshot !== null,
				providers: [...new Set(models.map((m) => m.provider))].slice(0, 8),
			});

			return models;
		} catch (error) {
			void appLogger.warn("pi", "Failed to resolve model list", {
				error: error instanceof Error ? error.message : String(error),
			});
			return [];
		}
	});

	ipcMain.handle(ipcChannels.projectsListModelsReport, async (_event, projectId: unknown, force: unknown) => {
		const projectIdArg = typeof projectId === "string" && projectId.length <= 256 ? projectId : undefined;
		const forceArg = force === true;
		try {
			if (forceArg) {
				const catalogRefreshed = await refreshModelCatalogStore(piLocator, settingsStore);
				void appLogger.info("pi", "Model catalog force refresh on manual reload", {
					ok: catalogRefreshed,
				});
			}
			// 手动刷新（force）才显式带扩展；普通打开仍复用自动水合结果。
			const snapshot = forceArg ? await modelCapabilityCache.refresh({ loadExtensions: true }) : await modelCapabilityCache.ensure();
			const report: ModelListReport =
				snapshot && snapshot.models.length > 0
					? {
							models: snapshot.models,
							ok: true,
							reason: null,
							version: null,
							detail: "",
							source: "cache",
							at: Date.now(),
						}
					: await resolveModelListReport(piLocator, settingsStore, configManager, forceArg);

			void appLogger.info("pi", "Model list report resolved", {
				ok: report.ok,
				reason: report.reason,
				count: report.models.length,
				source: report.source,
				forced: forceArg,

				loadExtensions: snapshot?.loadExtensions ?? null,
			});
			return report;
		} catch (error) {
			void appLogger.warn("pi", "Model list report failed", {
				error: error instanceof Error ? error.message : String(error),
			});
			return {
				models: [],
				ok: false,
				reason: "cli-failed",
				version: null,
				detail: error instanceof Error ? error.message : String(error),
				source: "none",
				at: Date.now(),
			};
		}
	});

	ipcMain.handle(ipcChannels.projectsGetModelSpec, async (_event, providerName: unknown, modelId: unknown, modelName: unknown) => {
		if (typeof providerName !== "string" || typeof modelId !== "string" || (modelName !== undefined && typeof modelName !== "string") || providerName.length > 128 || modelId.length > 256 || (typeof modelName === "string" && modelName.length > 256)) {
			return null;
		}
		try {
			return resolveModelSpecFromCatalogs(
				{
					providerName,
					modelId,
					...(typeof modelName === "string" && modelName.trim() ? { modelName } : {}),
				},
				getPiAiCatalogIndex(),
			);
		} catch (error) {
			void appLogger.warn("models", "Model spec lookup failed", {
				error: error instanceof Error ? error.message : String(error),
			});
			return null;
		}
	});

	const wslExe = getWslExe();
	const wslExePath = wslExe.command;
	const wslShell = wslExe.shell;

	ipcMain.handle(ipcChannels.wslListDistros, async () => {
		if (process.platform !== "win32") return [] as string[];
		try {
			const { execFile } = await import("node:child_process");
			return await new Promise<string[]>((resolve) => {
				execFile(wslExePath, ["-l", "-q"], { encoding: "buffer", timeout: 10_000, windowsHide: true, shell: wslShell }, (err, stdout) => {
					if (err) {
						resolve([]);
						return;
					}
					resolve(parseWslDistroList(stdout));
				});
			});
		} catch {
			return [] as string[];
		}
	});

	ipcMain.handle(ipcChannels.wslValidateConnection, async (_event, distro: unknown, user: unknown) => {
		if (typeof distro !== "string" || typeof user !== "string" || !isWslName(distro) || !isWslName(user)) {
			return { ok: false, whoami: "", piVersion: "", piPath: "", error: mainCopy("wsl.connectionFailed") };
		}
		if (process.platform !== "win32") {
			return { ok: false, whoami: "", piVersion: "", piPath: "", error: mainCopy("wsl.windowsOnly") };
		}
		try {
			const { execFile } = await import("node:child_process");
			const whoami = await new Promise<string>((resolve, reject) => {
				execFile(wslExePath, ["-d", distro, "-u", user, "whoami"], { encoding: "buffer", timeout: 10_000, windowsHide: true, shell: wslShell }, (err, stdout) => {
					if (err) {
						reject(err);
						return;
					}
					resolve(decodeWslOutput(stdout).trim());
				});
			});

			const pi = await piLocator.checkWslInstallation(distro, user, { force: true });
			return {
				ok: true,
				whoami,
				piVersion: pi.installed ? (pi.version ?? "") : "",
				piPath: pi.installed ? (pi.piPath ?? "") : "",
				error: pi.installed ? "" : mainCopy("wsl.piNotInstalled"),
			};
		} catch (err) {
			void appLogger.warn("wsl", "WSL connection validation failed", {
				distro,
				user,
				error: err instanceof Error ? err.message : String(err),
			});
			return {
				ok: false,
				whoami: "",
				piVersion: "",
				piPath: "",
				error: mainCopy("wsl.connectionFailed"),
			};
		}
	});

	ipcMain.handle(ipcChannels.piExecInstall, async (_event, command: string): Promise<PiInstallExecResult> => {
		const check = validateInstallCommand(command);
		if (!check.ok) {
			void appLogger.warn("pi", "Install command rejected", { command, reason: check.reason });
			return { success: false, exitCode: -1, stdout: "", stderr: `Command rejected: ${check.reason}` };
		}
		const normalized = check.command;
		void appLogger.info("pi", "Executing install command", { command: normalized });
		try {
			const { execFile } = await import("node:child_process");
			const result = await new Promise<import("../../shared/types").PiInstallExecResult>((resolve) => {
				const isWin = process.platform === "win32";
				if (isWin) {
					const child = execFile(
						process.env.ComSpec || "cmd.exe",
						["/d", "/s", "/c", normalized],
						{
							cwd: app.getPath("home"),
							timeout: 120_000,

							env: { ...piLocator.createProcessEnv(), npm_config_fund: "false", npm_config_audit: "false" },
							windowsHide: true,
							encoding: "utf8",
							shell: false,
						},
						(error: unknown, stdout: string, stderr: string) => {
							const execError = error as { code?: number | string } | null;
							resolve({
								success: !error,
								exitCode: typeof execError?.code === "number" ? execError.code : execError ? -1 : 0,
								stdout: stdout || "",
								stderr: stderr || "",
							});
						},
					);
				} else {
					execFile(
						"/bin/sh",
						["-c", normalized],
						{
							cwd: app.getPath("home"),
							timeout: 120_000,
							env: { ...piLocator.createProcessEnv(), npm_config_fund: "false", npm_config_audit: "false" },
							encoding: "utf8",
						},
						(error: unknown, stdout: string, stderr: string) => {
							const execError = error as { code?: number | string } | null;
							resolve({
								success: !error,
								exitCode: typeof execError?.code === "number" ? execError.code : execError ? -1 : 0,
								stdout: stdout || "",
								stderr: stderr || "",
							});
						},
					);
				}
			});
			void appLogger.info("pi", "Install command completed", {
				success: result.success,
				exitCode: result.exitCode,
				stdoutLength: result.stdout.length,
				stderrLength: result.stderr.length,
			});
			return result;
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			void appLogger.error("pi", "Install command threw", { error: message });
			return { success: false, exitCode: -1, stdout: "", stderr: message };
		}
	});

	ipcMain.handle(ipcChannels.piCheckNpm, async (): Promise<import("../../shared/types").NpmAvailabilityResult> => {
		try {
			const { execFile } = await import("node:child_process");
			const result = await new Promise<import("../../shared/types").NpmAvailabilityResult>((resolve) => {
				const isWin = process.platform === "win32";
				if (isWin) {
					execFile(
						process.env.ComSpec || "cmd.exe",
						["/d", "/s", "/c", "npm --version"],
						{
							env: piLocator.createProcessEnv(),
							timeout: 10_000,
							encoding: "utf8",
							windowsHide: true,
							shell: false,
						},
						(error, stdout) => {
							if (error) {
								resolve({ available: false, error: error.message });
							} else {
								resolve({ available: true, version: stdout.trim() });
							}
						},
					);
				} else {
					execFile(
						"npm",
						["--version"],
						{
							env: piLocator.createProcessEnv(),
							timeout: 10_000,
							encoding: "utf8",
						},
						(error, stdout) => {
							if (error) {
								resolve({ available: false, error: error.message });
							} else {
								resolve({ available: true, version: stdout.trim() });
							}
						},
					);
				}
			});
			return result;
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return { available: false, error: message };
		}
	});

	ipcMain.handle(ipcChannels.piRuntimeNodeCheck, async (): Promise<PiRuntimeNodeStatus> => {
		try {
			const systemNodeVersion = await probeSystemNodeVersion(piLocator);
			return await detectPiRuntimeNode(app.getPath("userData"), systemNodeVersion);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			void appLogger.warn("pi", "Runtime node check failed", { error: message });
			return { installed: false, systemNodeAvailable: false, installSupported: true, error: message };
		}
	});

	ipcMain.handle(ipcChannels.piRuntimeNodeInstall, async (): Promise<PiRuntimeNodeInstallResult> => {
		if (!deps.piRuntimeNodeInstaller) {
			return { ok: false, error: "installer not available" };
		}
		try {
			const result = await installPiRuntimeNode(
				{
					userDataPath: app.getPath("userData"),
					log: (message, detail) => void appLogger.info("pi", message, { detail: detail ?? null }),
				},
				deps.piRuntimeNodeInstaller,
			);
			void appLogger.info("pi", "Runtime node install completed", {
				ok: result.ok,
				source: result.source,
				version: result.version,
				error: result.error,
			});
			return result;
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			void appLogger.error("pi", "Runtime node install threw", { error: message });
			return { ok: false, error: message };
		}
	});

	ipcMain.handle(ipcChannels.piRuntimePiInstall, async (_event, useMirror: unknown): Promise<PiInstallExecResult> => {
		const mirrorArg = useMirror === true;
		try {
			const settings = settingsStore.get();
			const existing = await piLocator.listInstallations(settings.customPiPath, settings.wslEnabled, settings.wslDistro, settings.wslUser);
			const guard = resolvePiInstallGuard(existing);
			if (guard.skip) {
				void appLogger.info("pi", "Runtime pi install skipped because pi already exists", {
					count: guard.installations.length,
					sources: guard.installations.map((item) => item.source),
				});
				return { success: false, exitCode: null, stdout: "", stderr: "", alreadyInstalled: guard.installations };
			}
			const userData = app.getPath("userData");

			const portableBinDir = piRuntimeNodeBinDir(userData);
			const portableNpm = join(portableBinDir, process.platform === "win32" ? "npm.cmd" : "npm");
			const hasPortableNpm = existsSync(portableNpm);

			const systemNpm = await probeSystemNpmVersion(piLocator);
			if (!systemNpm.available && !hasPortableNpm) {
				return {
					success: false,
					exitCode: null,
					stdout: "",
					stderr: "npm is not available; complete the node install step first",
				};
			}
			const npmArgs = ["install", "-g", "@earendil-works/pi-coding-agent"];
			if (mirrorArg) {
				npmArgs.push("--registry=https://registry.npmmirror.com");
			}

			const prefixDir = join(userData, "pi-runtime", "pi-global");

			const runInstall = (npmCommand: string, usePrefix: boolean) =>
				runPiGlobalInstall({
					npmCommand,
					npmArgs,
					...(usePrefix ? { prefixDir } : {}),
					launcher: {
						createInvocation: (command, args) => piLocator.createInvocation(command, args),

						createProcessEnv: (pathPrefix) => piLocator.createProcessEnv(undefined, pathPrefix),
					},
					cwd: app.getPath("home"),

					execFileImpl: (command, args, options, callback) => execFile(command, args, options, callback),
				});
			let outcome: Awaited<ReturnType<typeof runPiGlobalInstall>>;
			let installMode: "system-global" | "pideck-prefix" = "pideck-prefix";
			if (systemNpm.available) {
				installMode = "system-global";
				outcome = await runInstall("npm", false);
				const failed = !outcome.success || outcome.exitCode !== 0;

				const layoutSpecific = failed && (outcome.exitCode === -1 || /EACCES|EPERM|permission denied|ENOENT/i.test(outcome.stderr));
				if (layoutSpecific && hasPortableNpm) {
					void appLogger.warn("pi", "Runtime pi system-global install hit a layout failure; falling back to PiDeck prefix", {
						exitCode: outcome.exitCode,
						stderrPreview: outcome.stderr.slice(0, 200),
					});
					installMode = "pideck-prefix";
					outcome = await runInstall(portableNpm, true);
				}
			} else {
				outcome = await runInstall(portableNpm, true);
			}
			void appLogger.info("pi", "Runtime pi install started", {
				mode: installMode,
				systemNpm: systemNpm.available,
				useMirror: mirrorArg,
				prefix: installMode === "pideck-prefix" ? prefixDir : undefined,
			});
			const { launchCommand, launchChannel, launchFallbackReason, ...result } = outcome;
			void appLogger.info("pi", "Runtime pi install completed", {
				success: result.success,
				exitCode: result.exitCode,
				stdoutLength: result.stdout.length,
				stderrLength: result.stderr.length,
				launch: launchCommand,
				launchChannel,
				launchFallbackReason,

				stderrPreview: result.exitCode === -1 ? result.stderr.slice(0, 200) : undefined,
			});

			if (result.success && result.exitCode === 0) invalidatePiInstallationCache();
			return result;
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			void appLogger.error("pi", "Runtime pi install threw", { error: message });
			return { success: false, exitCode: null, stdout: "", stderr: message };
		}
	});

	if (extensionManager) {
		ipcMain.handle(ipcChannels.piUpdateCheck, async () => {
			const result = await extensionManager.checkPiUpdate();

			updateService?.applyPiCheckResult(result);
			void appLogger.info("pi", "Pi update check completed", { currentVersion: result.currentVersion, latestVersion: result.latestVersion, hasUpdate: result.hasUpdate, error: result.error });
			return result;
		});
		ipcMain.handle(ipcChannels.piUpdate, async () => {
			const result = await extensionManager.updatePi();
			if (result.updated) void refreshPiModelCatalogs().catch(() => undefined);
			void appLogger.info("pi", "Pi update command completed", { updated: result.updated, bytes: result.output.length });
			return result;
		});

		ipcMain.handle(ipcChannels.piReleaseNotes, async (_event, rawOptions) => {
			const options = (rawOptions ?? {}) as { latestVersion?: unknown; currentVersion?: unknown };
			const latestVersion = typeof options.latestVersion === "string" ? options.latestVersion : "";
			const currentVersion = typeof options.currentVersion === "string" ? options.currentVersion : undefined;
			const result = await piChangelogService.getReleaseNotes({ latestVersion, currentVersion });
			void appLogger.info("pi", "Pi release notes fetched", { source: result.source, versionCount: result.versionCount, truncated: result.truncated });
			return result;
		});
	}

	let appInfoPromise: Promise<AppInfo> | undefined;

	const resolveAppInfo = (): Promise<AppInfo> => {
		appInfoPromise ??= (async () => {
			let piVersion: string | undefined;
			try {
				const settings = settingsStore.get();
				const status = await piLocator.check(settings.customPiPath, settings.wslEnabled, settings.wslDistro, settings.wslUser);
				piVersion = status.version;
			} catch (error) {
				appLogger.warn("appInfo", "pi version probe failed", { error });
			}
			const times = resolveAppTimes({
				isPackaged: app.isPackaged,
				resourcesPath: typeof process.resourcesPath === "string" ? process.resourcesPath : "",
				appPath: app.getAppPath(),
				execPath: process.execPath,
			});
			return {
				version: app.getVersion(),
				releasesUrl: RELEASES_URL ?? `https://github.com/${UPDATE_REPO_OWNER}/${UPDATE_REPO}/releases`,
				appUpdatesEnabled: false,
				platform: process.platform,

				userDataDir: app.getPath("userData"),
				homeDir: app.getPath("home"),
				devBranch: devBranch,
				piVersion,
				piAiVersion: readBuiltinPiAiCatalogVersion(),
				electronVersion: process.versions.electron ?? "",
				chromeVersion: process.versions.chrome ?? "",
				nodeVersion: process.versions.node,
				...times,
			};
		})();
		return appInfoPromise;
	};

	ipcMain.handle(ipcChannels.appInfo, resolveAppInfo);

	ipcMain.handle(ipcChannels.appNetworkAddresses, () => listWebNetworkAddresses());

	ipcMain.handle(ipcChannels.appPreferredSystemLanguages, () => {
		try {
			return app.getPreferredSystemLanguages();
		} catch {
			return [];
		}
	});

	ipcMain.handle(ipcChannels.appCheckUpdate, async () => {
		await updateService?.checkNow();
	});

	ipcMain.handle(ipcChannels.appGetChannel, () => ({
		channel: resolveUpdateChannel(),
		currentVersion: app.getVersion(),

		devBuild: isDevChannelBuild(),
	}));
	ipcMain.handle(ipcChannels.appDownloadUpdate, async () => {
		await updateService?.downloadNow();
	});
	ipcMain.handle(ipcChannels.appInstallUpdate, async () => {
		updateService?.installNow();
	});

	ipcMain.handle(ipcChannels.appUpdateStatusChanged, () => updateService?.getSnapshot() ?? null);
	ipcMain.handle(ipcChannels.appUpdateNotifySeen, async (_event, kind: unknown, version: unknown) => {
		if (!updateService) return;

		if (kind !== "app" && kind !== "pi") return;
		if (typeof version !== "string" || !version) return;
		await updateService.notifySeen(kind, version);
	});
	ipcMain.handle(ipcChannels.appUpdateSkipVersion, async (_event, version: unknown) => {
		if (!updateService) return;
		if (typeof version !== "string" || !version) return;
		await updateService.skipVersion(version);
	});

	ipcMain.handle(ipcChannels.appCheckUpdateMirrors, async (): Promise<MirrorHealthResult[]> => {
		return probeAllMirrors();
	});

	ipcMain.handle(ipcChannels.diagnosticsSnapshot, (): DiagnosticsSnapshot => {
		return (
			diagnosticsMonitor?.snapshot() ?? {
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
			}
		);
	});

	ipcMain.handle(ipcChannels.archStatus, (): ArchStatus => {
		return {
			platform: process.platform,
			processArch: process.arch,
			runningUnderArm64Translation: app.runningUnderARM64Translation === true,
		};
	});
	ipcMain.handle(ipcChannels.diagnosticsOpenFolder, async () => {
		if (!diagnosticsMonitor) return;
		await diagnosticsMonitor.openFolder();
	});

	ipcMain.handle(ipcChannels.processMetrics, async (): Promise<ProcessMetricsSnapshot> => {
		const agents: Array<Pick<AgentProcessMetric, "agentId" | "pid" | "kind" | "sessionId" | "sessionTitle">> = deps.agentManager.listAgentPids().map((agent) => {
			const sessionInfo = deps.sessionRuntimeCoordinator.getSessionInfoForAgent(agent.agentId);
			return { ...agent, kind: "pi" as const, ...(sessionInfo ?? {}) };
		});
		return getProcessSnapshot(agents);
	});

	ipcMain.handle(ipcChannels.stopAgent, async (_event, agentId: unknown) => {
		if (typeof agentId !== "string" || !agentId) {
			throw new Error("invalid agentId");
		}

		const result = await deps.stopAgentFromMonitor(agentId);
		if (!result.ok) {
			throw new Error(result.error.debugDetails ?? `failed to stop agent ${agentId}`);
		}
	});

	ipcMain.handle(ipcChannels.logsList, async (_event, query: AppLogQuery) => appLogger.list(query));
	ipcMain.handle(ipcChannels.logsListPage, async (_event, query: AppLogQuery) => appLogger.listPage(query));
	ipcMain.handle(ipcChannels.rendererLog, async (_event, level: AppLogLevel, scope: string, message: string, detail?: unknown) => {
		const safeLevel = ["debug", "info", "warn", "error"].includes(level) ? level : "info";
		await appLogger.log(safeLevel as AppLogLevel, scope, message, detail);
	});
	ipcMain.on(ipcChannels.preloadReady, (event) => {
		void appLogger.info("app", "Preload API exposed", { url: event.sender.getURL() });
	});
	ipcMain.on(ipcChannels.preloadError, (event, detail) => {
		void appLogger.error("app", "Preload API expose failed", { url: event.sender.getURL(), detail });
	});
	ipcMain.handle(ipcChannels.logsClear, async () => appLogger.clear());
	ipcMain.handle(ipcChannels.logsOpenFolder, async () => appLogger.openFolder());
	ipcMain.handle(ipcChannels.logsSize, async () => appLogger.getSize());

	ipcMain.handle(ipcChannels.healthCheck, async (): Promise<HealthReport> => {
		if (!environmentDoctor) throw new Error("EnvironmentDoctor not injected");
		return environmentDoctor.run();
	});

	ipcMain.handle(ipcChannels.healthExportReport, async (_event, markdown: unknown, reportJson?: unknown): Promise<HealthExportResult> => {
		if (!logBundleExporter) throw new Error("LogBundleExporter not injected");
		return logBundleExporter.exportReport({
			markdown: typeof markdown === "string" ? markdown : "",
			reportJson: typeof reportJson === "string" ? reportJson : undefined,
		});
	});

	ipcMain.handle(ipcChannels.healthExportBundle, async (_event, markdown: unknown, reportJson: unknown): Promise<HealthExportResult> => {
		if (!logBundleExporter) throw new Error("LogBundleExporter not injected");
		return logBundleExporter.exportBundle({
			markdown: typeof markdown === "string" ? markdown : "",
			reportJson: typeof reportJson === "string" ? reportJson : "{}",
		});
	});

	const resolveRpcRuntimeAgent = (target?: SessionRuntimeTarget) => {
		if (!target) return undefined;
		const validated = sessionRuntimeCoordinator.validateTarget(target);
		if (!validated.ok) {
			const error = (validated as { ok: false; error: import("../../shared/types").SessionCommandError }).error;
			void appLogger.warn("agent", "RPC log runtime target invalid", {
				sessionId: target.sessionId,
				agentId: target.agentId,
				runtimeGeneration: target.runtimeGeneration,
				code: error.code,
			});
			if (sessionCommandIpcError) throw sessionCommandIpcError(error);
			return undefined;
		}
		return target.agentId;
	};

	ipcMain.handle(ipcChannels.rpcLogsGetSize, async (_event, target?: SessionRuntimeTarget) => rpcLogger.getSize(resolveRpcRuntimeAgent(target)));
	ipcMain.handle(ipcChannels.rpcLogsGet, async (_event, options?: { target?: SessionRuntimeTarget; days?: number; limit?: number }) => rpcLogger.getFromFile({ agentId: resolveRpcRuntimeAgent(options?.target), days: options?.days, limit: options?.limit }));

	ipcMain.handle(ipcChannels.rpcLogsGetLive, async (_event, agentId?: string) => rpcLogger.getLive(typeof agentId === "string" ? agentId : undefined));

	ipcMain.handle(ipcChannels.rpcLogsGetModelTrace, async (_event, options?: { agentId?: unknown; traceId?: unknown }) => {
		const agentId = typeof options?.agentId === "string" ? options.agentId : "";
		const traceId = typeof options?.traceId === "string" ? options.traceId : "";
		if (!agentId || !traceId) return null;
		return rpcLogger.readModelTrace(agentId, traceId);
	});

	ipcMain.handle(ipcChannels.rpcLogsSave, async (_event, options?: { entries?: unknown }) => {
		const rawEntries = Array.isArray(options?.entries) ? options.entries : [];
		const entries = rawEntries.slice(0, 10_000).filter((value): value is RpcLogEntry => isRpcLogEntry(value));
		if (entries.length === 0) return [];
		return rpcLogger.appendEntries(entries);
	});
	ipcMain.handle(ipcChannels.rpcLogsClear, async (_event, target?: SessionRuntimeTarget) => rpcLogger.clear(resolveRpcRuntimeAgent(target)));
	ipcMain.handle(ipcChannels.rpcLoggingSet, async (_event, target: SessionRuntimeTarget, enabled: boolean) => {
		const agentId = resolveRpcRuntimeAgent(target);

		if (!agentId) return false;
		agentManager.setRpcLogging(agentId, enabled);
		return enabled;
	});
	ipcMain.handle(ipcChannels.rpcLoggingGet, async (_event, target: SessionRuntimeTarget) => {
		const agentId = resolveRpcRuntimeAgent(target);
		if (!agentId) return false;
		return agentManager.isRpcLogging(agentId);
	});

	ipcMain.handle(ipcChannels.rpcLogsSetWatching, async (_event, agentId?: unknown, watching?: unknown) => {
		if (typeof agentId !== "string" || !agentId || typeof watching !== "boolean") return false;
		agentManager.setRpcLogWatching(agentId, watching);
		return true;
	});

	ipcMain.handle(ipcChannels.appFeedbackEnvironment, async () => {
		const settings = settingsStore.get();
		const pi = await piLocator.check(settings.customPiPath, settings.wslEnabled, settings.wslDistro, settings.wslUser);
		return {
			appVersion: app.getVersion(),
			platform: process.platform,
			arch: process.arch,
			electronVersion: process.versions.electron ?? "",
			chromeVersion: process.versions.chrome ?? "",
			nodeVersion: process.versions.node,
			pi,
		};
	});

	ipcMain.handle(ipcChannels.appOpenExternal, async (_event, url: string, forceSystem?: boolean) => {
		await doOpenExternalUrl(url, forceSystem);
	});

	ipcMain.handle(ipcChannels.appGetChangelog, async (_event, language?: unknown, forceRefresh?: unknown): Promise<ChangelogPayload> => {
		const lang: ChangelogLanguage = language === "en" ? "en" : "zh";
		const refresh = forceRefresh === true;

		const service = new ChangelogService({
			source: () => normalizeUpdateSource(settingsStore.get().updateSource),
			cacheDir: join(app.getPath("userData"), "changelog-cache"),
		});

		const pageUrl = service.changelogPageUrl(lang);
		try {
			const result = await service.getChangelog(lang, { forceRefresh: refresh });
			if (!result) {
				void appLogger.info("changelog", "All sources failed and no cached copy exists", { lang });
				return {
					markdown: null,
					source: null,
					versionCount: 0,
					pageUrl,
					fetchedAt: null,
					fromCache: false,
					stale: false,
				};
			}
			return {
				markdown: result.markdown,
				source: result.source,
				versionCount: result.versionCount,
				pageUrl,
				fetchedAt: result.fetchedAt,
				fromCache: result.fromCache,
				stale: result.stale,
			};
		} catch (error) {
			void appLogger.warn("changelog", "Failed to fetch changelog", {
				lang,
				error: error instanceof Error ? error.message : String(error),
			});
			return {
				markdown: null,
				source: null,
				versionCount: 0,
				pageUrl,
				fetchedAt: null,
				fromCache: false,
				stale: false,
			};
		}
	});

	ipcMain.handle(ipcChannels.appRestart, async () => {
		if (isQuitting) isQuitting.value = true;
		await webServiceManager?.stop();
		terminalManager?.closeAll();
		agentManager?.stopAll();
		if (deps.relaunchApp) deps.relaunchApp();
		else app.relaunch();
		app.quit();
	});

	ipcMain.handle(ipcChannels.appQuit, () => {
		if (isQuitting) isQuitting.value = true;
		app.quit();
	});

	ipcMain.handle(ipcChannels.appOpenDataDir, async (): Promise<{ ok: boolean; error?: string }> => {
		const error = await openSystemPath(app.getPath("userData"));
		return error ? { ok: false, error } : { ok: true };
	});

	const mainWindow = getMainWindow();

	ipcMain.handle(ipcChannels.appWindowMinimize, () => {
		const win = getMainWindow();
		if (!win || win.isDestroyed()) return;
		win.minimize();
	});

	const wiredMaximizeWindows = new WeakSet<Electron.BrowserWindow>();
	const maximizedByWindow = new WeakMap<Electron.BrowserWindow, boolean>();
	const emitMaximizedState = (win: Electron.BrowserWindow, maximized: boolean) => {
		if (win.isDestroyed()) return;
		maximizedByWindow.set(win, maximized);
		win.webContents.send(ipcChannels.appWindowMaximizedChanged, maximized);
	};
	const wireMaximizeEvents = (win: Electron.BrowserWindow) => {
		if (wiredMaximizeWindows.has(win)) return;
		wiredMaximizeWindows.add(win);
		maximizedByWindow.set(win, win.isMaximized());

		win.on("maximize", () => emitMaximizedState(win, true));
		win.on("unmaximize", () => emitMaximizedState(win, false));
	};
	const readMaximized = (win: Electron.BrowserWindow): boolean => maximizedByWindow.get(win) ?? win.isMaximized();
	ipcMain.handle(ipcChannels.appWindowToggleMaximize, () => {
		const win = getMainWindow();
		if (!win || win.isDestroyed()) return false;
		wireMaximizeEvents(win);
		const nextMaximized = !readMaximized(win);
		if (nextMaximized) win.maximize();
		else win.unmaximize();

		emitMaximizedState(win, nextMaximized);
		return nextMaximized;
	});
	ipcMain.handle(ipcChannels.appWindowIsMaximized, () => {
		const win = getMainWindow();
		if (!win || win.isDestroyed()) return false;
		wireMaximizeEvents(win);
		return readMaximized(win);
	});
	{
		const win = getMainWindow();
		if (win && !win.isDestroyed()) wireMaximizeEvents(win);
	}
	ipcMain.handle(ipcChannels.appWindowToggleAlwaysOnTop, () => {
		const win = getMainWindow();
		if (!win || win.isDestroyed()) return false;
		const next = !win.isAlwaysOnTop();
		win.setAlwaysOnTop(next, "floating");
		return next;
	});

	ipcMain.handle(ipcChannels.appWindowIsAlwaysOnTop, () => {
		const win = getMainWindow();
		if (!win || win.isDestroyed()) return false;
		return win.isAlwaysOnTop();
	});
	ipcMain.handle(ipcChannels.appWindowClose, () => {
		const win = getMainWindow();
		if (!win || win.isDestroyed()) return;
		win.close();
	});

	ipcMain.handle(ipcChannels.settingsGet, () => settingsStore.get());

	ipcMain.handle(ipcChannels.settingsUpdate, async (_event, patch: Partial<AppSettings>) => {
		const prevSettings = settingsStore.get();
		const settings = await settingsStore.update(patch);

		if ("shortcuts" in patch) {
			refreshShortcutBindings(settings);
		}

		deps.afterSettingsUpdate?.(settings);

		if ("gitExecutablePath" in patch) {
			setConfiguredGitPath(settings.gitExecutablePath);
		}

		if ("autoDownloadUpdates" in patch) {
			updateService?.applyAutoDownloadPreference();
		}

		const logoChanged = ("logoStyle" in patch && prevSettings.logoStyle !== settings.logoStyle) || ("logoCustomImage" in patch && prevSettings.logoCustomImage !== settings.logoCustomImage);
		if (logoChanged) {
			applyWindowLogoStyle(settings.logoStyle, getMainWindow, settings.logoCustomImage);
			if (getTray) applyTrayLogoStyle(settings.logoStyle, getTray, settings.logoCustomImage);
		}

		if (logoChanged) {
			syncTaskbarShortcutIcon({ style: settings.logoStyle, customLogoDataUrl: settings.logoCustomImage });
		}

		if ("updateSource" in patch || "customUpdateSourceUrl" in patch) {
			updateService?.applyUpdateSource();
		}
		if ("developerDiagnostics" in patch && diagnosticsMonitor) {
			void diagnosticsMonitor.setEnabled(settings.developerDiagnostics).catch((error) => {
				void appLogger.warn("diagnostics", "Failed to toggle developer diagnostics", {
					error: error instanceof Error ? error.message : String(error),
				});
			});
		}

		if (typeof reactToPetSettings === "function") {
			await reactToPetSettings(prevSettings, settings);
		}

		if (("cuaEnabled" in patch || "browserAgentEnabled" in patch) && typeof reactToCuaSettings === "function") {
			await reactToCuaSettings(prevSettings, settings);
		}
		if ("desktopProxyEnabled" in patch || "desktopProxyUrl" in patch || "desktopProxyBypass" in patch) {
			if (applyDesktopProxy) await applyDesktopProxy(settings);
		}
		if ("theme" in patch || "themeScheduleLightStart" in patch || "themeScheduleDarkStart" in patch) {
			if (applyNativeThemeSource) applyNativeThemeSource(settings);
		}
		if ("language" in patch) {
			if (setFeishuLocale) setFeishuLocale(undefined);
			if (setFeishuConfigDefaultBotName) setFeishuConfigDefaultBotName("");
			if (refreshTrayContextMenu) refreshTrayContextMenu();
		}
		if ("useNativeTitleBar" in patch) {
			if (notifyTitleBarChange) notifyTitleBarChange(getMainWindow()!);
		}
		if ("zoomFactor" in patch) {
			getMainWindow()?.webContents.setZoomFactor(settings.zoomFactor);
		}
		if ("webServiceEnabled" in patch || "webServiceHost" in patch || "webServicePort" in patch || "webServiceRequiresAuth" in patch) {
			try {
				if (applyWebServiceSettings) await applyWebServiceSettings(settings);
			} catch (error) {
				const debugDetails = error instanceof Error ? error.message : String(error);
				void appLogger.warn("web", "Failed to apply web service settings", { error: debugDetails });
				if (settings.webServiceEnabled) {
					await settingsStore.update({ webServiceEnabled: false });
				}
				throw new Error(mainCopy(debugDetails === "WEB_SERVICE_INVALID_PORT" ? "webService.invalidPort" : "webService.startFailed"));
			}
		}

		if ("wslEnabled" in patch || "wslDistro" in patch || "wslUser" in patch) {
			if (setSessionCatalogIdentityContext) {
				setSessionCatalogIdentityContext(settings.wslEnabled ? { wslDistro: settings.wslDistro, wslUser: settings.wslUser } : {});
			}
			if (settings.wslEnabled && settings.wslDistro && settings.wslUser && resolveWslEnvironment) {
				const environment = await resolveWslEnvironment(settings.wslDistro, settings.wslUser, {
					warn: (msg: string, detail: unknown) => console.warn("[PiDeck] " + String(msg), detail),
				});
				if (configureSessionScannerWsl) await configureSessionScannerWsl(environment);
				if (configureSkillManagerWsl) configureSkillManagerWsl(environment);
				if (configurePromptManagerWsl) configurePromptManagerWsl(environment);
				if (configureExtensionManagerWsl) configureExtensionManagerWsl(environment);
				if (configureConfigManagerWsl) configureConfigManagerWsl(environment);
				if (configureXuePromptManagerWsl) configureXuePromptManagerWsl(environment);
				if (configureAgentManagerWsl) configureAgentManagerWsl(environment);
			} else {
				if (clearSessionScannerWsl) clearSessionScannerWsl();
				if (configureSkillManagerWsl) configureSkillManagerWsl(null);
				if (configurePromptManagerWsl) configurePromptManagerWsl(null);
				if (configureExtensionManagerWsl) configureExtensionManagerWsl(null);
				if (configureConfigManagerWsl) configureConfigManagerWsl(null);
				if (configureXuePromptManagerWsl) configureXuePromptManagerWsl(null);
				if (configureAgentManagerWsl) configureAgentManagerWsl(null);
			}
		}
		if ("customPiPath" in patch || "wslEnabled" in patch || "wslDistro" in patch || "wslUser" in patch) {
			modelCapabilityCache.watchConfigDirectory();

			invalidatePiInstallationCache();
			void refreshPiModelCatalogs().catch(() => undefined);
		}
		return settings;
	});

	ipcMain.handle(ipcChannels.settingsRestartWebService, async () => {
		if (!restartWebService) throw new Error("restartWebService not available");
		await restartWebService(settingsStore.get());
	});

	ipcMain.handle(ipcChannels.webServiceStatus, () => {
		if (!webServiceManager) {
			return {
				running: false,
				host: "",
				port: 0,
				token: "",
				requiresAuth: false,
				tokenExpiresAt: null,
			} satisfies WebServiceStatusInfo;
		}
		return webServiceManager.getStatus();
	});

	ipcMain.handle(ipcChannels.webServiceRotateToken, () => {
		if (!webServiceManager) throw new Error("web service not available");
		webServiceManager.rotateToken();
		return webServiceManager.getStatus();
	});

	ipcMain.handle(ipcChannels.webServiceSetToken, (_event, input: unknown) => {
		if (!webServiceManager) throw new Error("web service not available");
		if (typeof input !== "object" || input === null) throw new Error("invalid payload");
		const payload = input as { token?: unknown; expiresIn?: unknown };
		const patch: { token?: string; expiresIn?: number } = {};
		if (payload.token !== undefined) {
			if (typeof payload.token !== "string") throw new Error("invalid token");
			const token = payload.token.trim();
			if (!isValidWebTokenShape(token)) throw new Error("invalid token shape");
			patch.token = token;
		}
		if (payload.expiresIn !== undefined) {
			if (typeof payload.expiresIn !== "number" || !WEB_TOKEN_EXPIRES_IN_CHOICES.includes(payload.expiresIn as (typeof WEB_TOKEN_EXPIRES_IN_CHOICES)[number])) throw new Error("invalid expiresIn");
			patch.expiresIn = payload.expiresIn;
		}
		if (patch.token === undefined && patch.expiresIn === undefined) throw new Error("empty payload");
		webServiceManager.setTokenPolicy(patch);
		return webServiceManager.getStatus();
	});

	ipcMain.handle(ipcChannels.settingsTestPiProxy, async () => {
		if (!testPiProxy) throw new Error("testPiProxy not available");
		const result = await testPiProxy(settingsStore.get(), undefined, mainCopy);
		void appLogger.info("settings", "Pi proxy tested", {
			success: result.success,
			elapsedMs: result.elapsedMs,
			statusCode: result.statusCode,
			error: result.error,
		});
		return result;
	});

	ipcMain.handle(ipcChannels.skillsList, () => skillManager.list());
	ipcMain.handle(ipcChannels.skillsReadContent, async (_event, skillPath: string) => {
		if (!readSkillContent) throw new Error("readSkillContent not available");

		return readSkillContent(skillPath);
	});
	ipcMain.handle(ipcChannels.skillsCreate, async (_event, input: CreatePiSkillInput) => {
		const result = await skillManager.create(input);
		void appLogger.info("skill", "Skill created", { name: input.name, locationId: input.locationId });
		return result;
	});
	ipcMain.handle(ipcChannels.skillsToggle, async (_event, path: string, enabled: boolean) => {
		const result = await skillManager.toggle(path, enabled);
		void appLogger.info("skill", "Skill toggled", { path, enabled });
		return result;
	});
	ipcMain.handle(ipcChannels.skillsDelete, async (_event, path: string) => {
		const result = await skillManager.delete(path);
		void appLogger.info("skill", "Skill deleted", { path });
		return result;
	});
	ipcMain.handle(ipcChannels.skillsRename, async (_event, skillPath: unknown, newName: unknown) => {
		if (typeof skillPath !== "string" || skillPath.trim().length === 0 || skillPath.length > 4096) {
			throw new Error("Invalid skill path for rename.");
		}
		if (typeof newName !== "string" || newName.trim().length === 0 || newName.length > 256) {
			throw new Error("Invalid skill name for rename.");
		}
		const result = await skillManager.rename(skillPath, newName);
		void appLogger.info("skill", "Skill renamed", { skillPath, newName });
		return result;
	});
	ipcMain.handle(ipcChannels.skillsOpenFolder, (_event, path?: string) => skillManager.openFolder(path));

	ipcMain.handle(ipcChannels.configGetModels, () => configManager.getModelsConfig());
	ipcMain.handle(ipcChannels.configGetAuth, () => configManager.getAuthConfig());
	ipcMain.handle(ipcChannels.configGetSettings, () => configManager.getSettingsConfig());
	ipcMain.handle(ipcChannels.configGetTrust, () => configManager.getTrustConfig());

	const assertTrustedMcpProject = async (projectId: string, root: string): Promise<void> => {
		if (!isProjectTrusted) throw new Error(mainCopy("mainProjectResource.projectNotTrusted"));
		if (!(await isProjectTrusted(projectId, root))) throw new Error(mainCopy("mainProjectResource.projectNotTrusted"));
	};
	ipcMain.handle(ipcChannels.configGetMcp, async (_event, scope: unknown) => {
		const parsed = parseMcpScopeRequest(scope);
		if (parsed.kind === "global") return configManager.getMcpConfig();
		const root = projectResourceManager.getProjectRoot(parsed.projectId);
		await assertTrustedMcpProject(parsed.projectId, root);
		return configManager.getMcpConfig(root, { writableScope: "project-pi", projectTrusted: true });
	});
	ipcMain.handle(ipcChannels.configSaveMcp, async (_event, data: unknown, scope: unknown, expectedRevision: unknown) => {
		const parsed = parseMcpScopeRequest(scope);
		if (!isMcpConfigFile(data)) {
			return { valid: false, error: "mcp.json must contain an object of server definitions" };
		}
		if (expectedRevision !== undefined && typeof expectedRevision !== "string") {
			return { valid: false, error: "Invalid expectedRevision." };
		}
		let result: { valid: boolean; error?: string; conflict?: boolean; revision?: string };
		if (parsed.kind === "global") {
			result = await configManager.saveMcpConfig(data, { expectedRevision });
		} else {
			const root = projectResourceManager.getProjectRoot(parsed.projectId);
			await assertTrustedMcpProject(parsed.projectId, root);

			const validationError = validateMcpConfigFile(data, { scope: "project-pi" });
			result = validationError ? { valid: false, error: validationError } : { valid: true };
			if (result.valid) {
				const write = await projectResourceManager.saveProjectMcpConfig(parsed.projectId, data, { expectedRevision });
				result = write.ok ? { valid: true } : { valid: false, error: write.error, conflict: write.conflict };
			}
		}
		void appLogger.info("config", "MCP config saved", {
			scope: parsed.kind,
			serverCount: Object.keys(data.mcpServers ?? {}).length,
			...(result.conflict ? { conflict: true } : {}),
		});
		return result;
	});

	ipcMain.handle(ipcChannels.configProbeMcp, async (_event, definition: unknown) => {
		if (!isMcpServerDefinition(definition)) {
			return { ok: false, error: "invalid MCP server definition" };
		}
		return configManager.probeMcpServer(definition);
	});

	ipcMain.handle(ipcChannels.mcpListStatus, async (_event, scope: unknown) => {
		const parsed = parseMcpScopeRequest(scope);
		const result = await getPiMcpCli().list(parsed.kind === "global" ? { scope: "global" } : { scope: "project", projectId: parsed.projectId });
		void appLogger.info("config", "pi mcp list finished", {
			scope: parsed.kind,
			servers: result.servers.length,
			errors: result.errors.length,
			connected: result.servers.filter((server) => server.state === "connected").length,
		});
		return result;
	});

	ipcMain.handle(ipcChannels.mcpLogin, (event, server: unknown, timeoutSec: unknown, scope: unknown, operationId: unknown) => {
		if (typeof server !== "string" || !server.trim() || server.length > 128) {
			return Promise.resolve({ ok: false, output: "invalid server name" });
		}
		const seconds = typeof timeoutSec === "number" && Number.isFinite(timeoutSec) && timeoutSec > 0 ? Math.min(Math.floor(timeoutSec), 600) : 240;
		const parsed = parseMcpScopeRequest(scope);
		const operation = typeof operationId === "string" && operationId.length <= 128 ? operationId : undefined;
		const webContents = event.sender;
		return getPiMcpCli()
			.login(parsed.kind === "global" ? { scope: "global" } : { scope: "project", projectId: parsed.projectId }, server.trim(), seconds, {
				operationId: operation,
				onUrl: (url) => {
					if (!webContents.isDestroyed()) webContents.send(ipcChannels.mcpLoginUrl, { server: server.trim(), scope: parsed, operationId: operation, url });
				},
			})
			.catch((error: unknown) => ({ ok: false as const, output: error instanceof Error ? error.message : String(error) }));
	});

	ipcMain.handle(ipcChannels.mcpLogout, async (_event, server: unknown, scope: unknown) => {
		if (typeof server !== "string" || !server.trim() || server.length > 128) {
			return { ok: false, output: "invalid server name" };
		}
		const parsed = parseMcpScopeRequest(scope);
		return getPiMcpCli().logout(parsed.kind === "global" ? { scope: "global" } : { scope: "project", projectId: parsed.projectId }, server.trim());
	});

	const getPiResources = (): import("../config/PiResourceConfigService").PiResourceConfigService => {
		piResourceService ??= new PiResourceConfigService(
			{
				globalSettingsPath: () => join(configManager.getConfigDir(), "settings.json"),
				resolveProject: async (projectId) => {
					const root = projectResourceManager.getProjectRoot(projectId);
					const trusted = isProjectTrusted ? await isProjectTrusted(projectId, root) : false;
					return { root, trusted };
				},
			},
			new PiResourceStateStore(join(app.getPath("userData"), "pi-native-resources.json")),
			{ projectTrust: (projectId, root) => (isProjectTrusted ? isProjectTrusted(projectId, root) : Promise.resolve(false)) },
		);
		return piResourceService;
	};
	ipcMain.handle(ipcChannels.piResourcesSummary, async (_event, scope: unknown) => {
		const parsed = parseMcpScopeRequest(scope);
		return getPiResources().readSummary(parsed.kind === "global" ? { scope: "global" } : { scope: "project", projectId: parsed.projectId });
	});
	ipcMain.handle(ipcChannels.piResourcesSetBuiltin, async (_event, input: unknown) => {
		if (!isUnknownRecord(input)) throw new Error("Invalid built-in extension input.");
		const parsed = parseMcpScopeRequest(input.scope);
		const name = input.name;
		const enabled = input.enabled;
		if (typeof name !== "string" || typeof enabled !== "boolean") throw new Error("Invalid built-in extension input.");
		const result = await getPiResources().setBuiltinEnabled(parsed.kind === "global" ? { scope: "global" } : { scope: "project", projectId: parsed.projectId }, name as import("../../shared/types/piResources").PiBuiltinExtension, enabled, {
			expectedRevision: typeof input.expectedRevision === "string" ? input.expectedRevision : undefined,
		});
		void appLogger.info("config", "pi built-in extension toggled", { scope: parsed.kind, name, enabled, ok: result.ok });
		return result;
	});

	ipcMain.handle(ipcChannels.configGetDir, () => configManager.getConfigDir());
	ipcMain.handle(ipcChannels.projectsTrustResponse, (_event, requestId: string, choice: "trust-remember" | "trust-session" | "deny") => agentManager.respondTrustRequest(requestId, choice));
	ipcMain.handle(ipcChannels.configSaveModels, async (_event, data) => {
		const result = await configManager.saveModelsConfig(data);
		if (!result.valid) return result;
		invalidateModelListCache();

		const localModels = modelsFromPiConfig(data);
		void appLogger.info("config", "Models config saved", {
			providerCount: Object.keys(data?.providers ?? {}).length,
			modelCount: localModels.length,
		});
		void verifyModelsAfterSave(Date.now());
		return {
			valid: true,
			modelLoadOk: localModels.length > 0,
			modelCount: localModels.length,
			modelLoadReason: localModels.length > 0 ? null : "empty",
			modelLoadDetail: localModels.length > 0 ? "" : "no models in saved models.json",
		};
	});
	ipcMain.handle(ipcChannels.configSaveAuth, async (_event, data) => {
		const result = await configManager.saveAuthConfig(data);
		if (result.valid) {
			void refreshPiModelCatalogs().catch(() => undefined);
		}
		void appLogger.info("config", "Auth config saved", { authCount: Object.keys(data ?? {}).length });
		return result;
	});
	ipcMain.handle(ipcChannels.configSaveSettings, async (_event, settings) => {
		const result = await configManager.saveSettingsConfig(settings);
		void appLogger.info("config", "Pi settings config saved", { keys: Object.keys(settings ?? {}) });
		return result;
	});
	ipcMain.handle(ipcChannels.configSaveRaw, async (_event, fileName, rawJson) => {
		const result = await configManager.saveRawConfig(fileName, rawJson);
		if (result.valid) {
			if (fileName === "models.json" || fileName === "auth.json") {
				void refreshPiModelCatalogs().catch(() => undefined);
			}
		}
		void appLogger.info("config", "Raw config saved", { fileName, bytes: Buffer.byteLength(rawJson, "utf8") });
		return result;
	});
	ipcMain.handle(ipcChannels.configExport, () => configManager.exportConfig());
	ipcMain.handle(ipcChannels.configImport, async (_event, packageJson: string) => {
		const result = await configManager.importConfig(packageJson);
		if (result.valid) {
			void refreshPiModelCatalogs().catch(() => undefined);
		}
		void appLogger.info("config", "Config imported", { bytes: Buffer.byteLength(packageJson, "utf8"), valid: result.valid });
		return result;
	});

	ipcMain.handle(ipcChannels.configDiscoverExternalAgents, async () => {
		try {
			return await discoverExternalAgentProviders();
		} catch (error) {
			void appLogger.warn("config", "External agent discovery failed", { error: error instanceof Error ? error.message : String(error) });
			return { sources: [], providers: [] };
		}
	});

	ipcMain.handle(ipcChannels.configResolveExternalAgentKey, async (_event, sourceId: unknown) => {
		if (typeof sourceId !== "string" || sourceId.length === 0 || sourceId.length > 80 || !/^[a-z0-9:.-]+$/.test(sourceId)) {
			return { ok: false as const, error: "invalid source id" };
		}
		void appLogger.info("config", "External agent key resolved", { sourceId });
		return resolveExternalAgentKey(sourceId);
	});
	ipcMain.handle(ipcChannels.configFetchModels, async (_event, payload: { baseUrl: string; apiKey: string; apiType?: string; headers?: Record<string, string>; proxyMode?: string }) => {
		const proxyTarget = resolveConfigProxyTarget(settingsStore.get(), asConfigProxyMode(payload?.proxyMode));
		const result = await configManager.fetchProviderModels(payload.baseUrl, payload.apiKey, payload.apiType, payload.headers, proxyTarget);
		void appLogger.info("config", "Provider models fetched", {
			baseUrl: payload.baseUrl,
			apiType: payload.apiType,
			modelCount: Array.isArray(result) ? result.length : undefined,
		});
		return result;
	});
	ipcMain.handle(ipcChannels.configGetTokendanceModels, async (_event, force: unknown) => {
		const forceArg = force === true;
		try {
			if (!tokendanceCatalog) return { models: [], fromCache: false, at: 0 };
			const result = forceArg ? await tokendanceCatalog.refresh() : await tokendanceCatalog.getModels();
			return result ?? { models: [], fromCache: false, at: 0 };
		} catch (error) {
			void appLogger.warn("config", "TokenDance catalog load failed", {
				error: error instanceof Error ? error.message : String(error),
			});
			return { models: [], fromCache: false, at: 0 };
		}
	});
	ipcMain.handle(ipcChannels.configTokendanceAuthStart, async (_event, payload: unknown) => {
		if (!tokendanceAuth) return { ok: false, error: "TokenDance auth unavailable" };
		const mode = typeof payload === "object" && payload ? (payload as { mode?: unknown }).mode : undefined;

		const requested: TokendanceAuthMode = mode === "headless" ? "headless" : "callback";
		try {
			return { ok: true, ...(await tokendanceAuth.start({ mode: requested })) } as const;
		} catch (error) {
			void appLogger.warn("config", "TokenDance auth start failed", {
				error: error instanceof Error ? error.message : String(error),
			});
			return { ok: false, error: "TokenDance auth start failed" };
		}
	});
	ipcMain.handle(ipcChannels.configTokendanceAuthAwait, async (_event, payload: unknown) => {
		const flowId = typeof payload === "object" && payload ? (payload as { flowId?: unknown }).flowId : undefined;
		if (typeof flowId !== "string" || !flowId) {
			return { ok: false, error: "Invalid auth await input" };
		}
		if (!tokendanceAuth) return { ok: false, error: "TokenDance auth unavailable" };
		const result = await tokendanceAuth.awaitKey(flowId);
		if (result.ok) {
			void appLogger.info("config", "TokenDance API key exchanged via callback");
			return { ok: true, key: result.key } as const;
		}
		void appLogger.warn("config", "TokenDance callback auth failed", { error: result.error });
		return { ok: false, error: result.error } as const;
	});
	ipcMain.handle(ipcChannels.configTokendanceAuthCancel, async (_event, payload: unknown) => {
		const flowId = typeof payload === "object" && payload ? (payload as { flowId?: unknown }).flowId : undefined;
		if (typeof flowId !== "string" || !flowId) return { ok: false, error: "Invalid auth cancel input" };
		tokendanceAuth?.cancel(flowId);
		return { ok: true } as const;
	});
	ipcMain.handle(ipcChannels.configTokendanceAuthExchange, async (_event, payload: unknown) => {
		const flowId = typeof payload === "object" && payload ? (payload as { flowId?: unknown }).flowId : undefined;
		const code = typeof payload === "object" && payload ? (payload as { code?: unknown }).code : undefined;
		if (typeof flowId !== "string" || !flowId || typeof code !== "string" || !code) {
			return { ok: false, error: "Invalid auth exchange input" };
		}
		if (!tokendanceAuth) return { ok: false, error: "TokenDance auth unavailable" };
		const result = await tokendanceAuth.complete(flowId, code);
		if (result.ok) {
			void appLogger.info("config", "TokenDance API key exchanged");
			return { ok: true, key: result.key } as const;
		}
		void appLogger.warn("config", "TokenDance auth exchange failed", { error: result.error });
		return { ok: false, error: result.error } as const;
	});
	ipcMain.handle(ipcChannels.configInstallTokendance, async (_event, payload: unknown) => {
		if (!tokendanceInstall) {
			return { ok: false, modelCount: 0, piSaved: false, error: "TokenDance install unavailable" };
		}
		const apiKey = payload && typeof payload === "object" ? (payload as { apiKey?: unknown }).apiKey : undefined;
		if (typeof apiKey !== "undefined" && typeof apiKey !== "string") {
			return { ok: false, modelCount: 0, piSaved: false, error: "Invalid install input" };
		}
		try {
			const result = await tokendanceInstall(typeof apiKey === "string" && apiKey.trim() ? apiKey.trim() : undefined);
			void appLogger.info("config", "TokenDance provider installed", {
				ok: result.ok,
				modelCount: result.modelCount,
				piSaved: result.piSaved,
			});
			if (result.ok) {
				modelCapabilityCache.invalidate();
			}
			return result;
		} catch (error) {
			void appLogger.warn("config", "TokenDance install failed", {
				error: error instanceof Error ? error.message : String(error),
			});
			return { ok: false, modelCount: 0, piSaved: false, error: "TokenDance install failed" };
		}
	});
	ipcMain.handle(ipcChannels.configTokendanceTopUpCreate, async (_event, payload: unknown) => {
		if (!tokendancePayment) return { ok: false, code: "not-configured" } as const;

		const amount = payload && typeof payload === "object" ? (payload as { amount?: unknown }).amount : undefined;
		const result = await tokendancePayment.createSession(amount);
		if (result.ok) {
			void appLogger.info("config", "TokenDance top-up session created", { amount: result.session.amount, expiredAt: result.session.expiredAt });
		} else {
			void appLogger.warn("config", "TokenDance top-up session failed", { code: result.code, detail: result.detail });
		}
		return result;
	});
	ipcMain.handle(ipcChannels.configTokendanceTopUpStatus, async (_event, payload: unknown) => {
		if (!tokendancePayment) return { ok: false, code: "not-configured" } as const;

		const statusUrl = payload && typeof payload === "object" ? (payload as { statusUrl?: unknown }).statusUrl : undefined;
		if (typeof statusUrl !== "string" || !statusUrl) {
			return { ok: false, code: "bad-status-url" } as const;
		}
		const result = await tokendancePayment.fetchSession(statusUrl);

		if (!result.ok) void appLogger.warn("config", "TokenDance top-up status failed", { code: result.code, detail: result.detail });
		return result;
	});
	ipcMain.handle(ipcChannels.configTokendanceTopUpOpenAlipay, async (_event, payload: unknown) => {
		const url = payload && typeof payload === "object" ? (payload as { url?: unknown }).url : undefined;
		if (typeof url !== "string" || url.length > 4096 || !/^alipays:\/\/\S+$/i.test(url)) {
			return { ok: false, error: "Invalid alipay deep link" } as const;
		}
		try {
			await shell.openExternal(url);
			return { ok: true } as const;
		} catch (error) {
			void appLogger.warn("config", "TokenDance alipay deep link failed", {
				error: error instanceof Error ? error.message : String(error),
			});
			return { ok: false, error: "TokenDance alipay deep link failed" } as const;
		}
	});
	ipcMain.handle(ipcChannels.configTestProvider, async (_event, payload: unknown) => {
		const raw =
			payload && typeof payload === "object" && !Array.isArray(payload)
				? (payload as {
						providerName?: unknown;
						modelId?: unknown;
						provider?: unknown;
						apiKey?: unknown;
						proxyMode?: unknown;
					})
				: {};
		const providerName = typeof raw.providerName === "string" ? raw.providerName.trim() : "";
		const modelId = typeof raw.modelId === "string" ? raw.modelId.trim() : "";
		const provider = raw.provider;
		const apiKey = typeof raw.apiKey === "string" ? raw.apiKey : "";
		if (!providerName || providerName.length > 128 || !modelId || modelId.length > 256 || !provider || typeof provider !== "object" || Array.isArray(provider) || apiKey.length > 4096) {
			return { success: false, error: "Invalid provider name or model id" };
		}

		const tempDir = await mkdtemp(join(tmpdir(), "pideck-probe-"));
		try {
			const settingsConfig = await configManager.getSettingsConfig();
			const { modelsJson, authJson, settingsJson } = buildProbeDraftFiles(providerName, provider as Record<string, unknown>, apiKey || undefined, settingsConfig.parsed);
			await writeFile(join(tempDir, "models.json"), modelsJson, "utf8");
			await writeFile(join(tempDir, "auth.json"), authJson, "utf8");

			if (settingsJson) await writeFile(join(tempDir, "settings.json"), settingsJson, "utf8");

			const settings = settingsStore.get();
			const agentDirEnv = settings.wslEnabled && process.platform === "win32" ? toWslAccessiblePath(tempDir) : tempDir;

			const result = await probePiModel(piLocator, settingsStore, providerName, modelId, resolveConfigProxyTarget(settingsStore.get(), asConfigProxyMode(raw.proxyMode)), { [PROBE_AGENT_DIR_ENV]: agentDirEnv });
			void appLogger.info("config", "Provider connection tested via pi (isolated)", {
				providerName,
				modelId,
				success: result.success,
				error: result.error,
			});
			return result;
		} finally {
			await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
		}
	});
	ipcMain.handle(ipcChannels.configFetchUsage, async (_event, payload: { provider: string; backend?: "pi" }) => {
		const provider = payload?.provider?.trim() ?? "";
		if (!provider || provider.length > 128) {
			return { success: false, error: "Invalid provider name" };
		}
		const backend = "pi" as const;

		const result = await configManager.fetchProviderUsage(provider, backend);
		void appLogger.info("config", "Provider usage fetched", {
			provider,
			backend,
			success: result.success,
			error: result.error,
		});
		return { ...result, provider };
	});

	ipcMain.handle(ipcChannels.configGetUsageProbes, async (_event, payload: unknown) => {
		const raw = payload && typeof payload === "object" ? (payload as { provider?: unknown; backend?: unknown }) : {};
		const provider = typeof raw.provider === "string" ? raw.provider.trim() : "";
		if (!provider || provider.length > 128) {
			return { success: false, error: "Invalid provider name" };
		}
		const backend = "pi" as const;
		return configManager.getUsageProbeSettings(provider, backend);
	});

	ipcMain.handle(ipcChannels.configSaveUsageProbes, async (_event, payload: unknown) => {
		const input = payload && typeof payload === "object" && !Array.isArray(payload) ? (payload as { provider?: unknown; config?: unknown; backend?: unknown }) : {};
		const provider = typeof input.provider === "string" ? input.provider.trim() : "";
		if (!provider || provider.length > 128) {
			return { ok: false, error: "Invalid provider name" };
		}
		const backend = "pi" as const;
		const result = await saveUsageProbeForProvider(configManager.getUsageProbeConfigDir(backend), provider, input.config as UsageProbeProviderConfig);

		void appLogger.info("config", "Usage probe config saved", {
			provider,
			backend,
			ok: result.ok,
		});
		return result;
	});

	ipcMain.handle(ipcChannels.configListUsageProbeStates, async (_event, payload: unknown) => {
		const raw = payload && typeof payload === "object" ? (payload as { backend?: unknown; providers?: unknown }) : {};
		const backend = "pi" as const;

		const providers = Array.isArray(raw.providers) ? raw.providers.filter((name): name is string => typeof name === "string").slice(0, 512) : [];
		return configManager.listUsageProbeStates(backend, providers);
	});

	ipcMain.handle(ipcChannels.configTestUsageProbe, async (_event, payload: unknown) => {
		const input = payload && typeof payload === "object" && !Array.isArray(payload) ? (payload as UsageProbeTestInput) : ({} as UsageProbeTestInput);
		const provider = typeof input.provider === "string" ? input.provider.trim() : "";
		if (!provider || provider.length > 128) {
			return { success: false, error: "Invalid provider name" };
		}
		const template = typeof input.template === "string" ? input.template.trim() : undefined;

		if (template && !isDeclarativeTemplateId(template)) {
			const knownBuiltin = USAGE_PROBE_CANDIDATES.some((c) => c.templateId === template);
			if (!knownBuiltin) {
				return { success: false, error: "Unknown template" };
			}
		}
		const result = await configManager.testUsageProbe({
			provider,
			backend: "pi" as const,
			...(template ? { template } : {}),
			...(typeof input.apiKey === "string" ? { apiKey: input.apiKey } : {}),
			...(typeof input.baseUrl === "string" ? { baseUrl: input.baseUrl } : {}),
			...(typeof input.accessToken === "string" ? { accessToken: input.accessToken } : {}),
			...(typeof input.userId === "string" ? { userId: input.userId } : {}),

			...(typeof input.cookie === "string" ? { cookie: input.cookie } : {}),
			...(typeof input.cookiePath === "string" ? { cookiePath: input.cookiePath } : {}),
			...(typeof input.valuePath === "string" ? { valuePath: input.valuePath } : {}),
			...(typeof input.currencyPath === "string" ? { currencyPath: input.currencyPath } : {}),

			...(typeof input.accessKeyId === "string" ? { accessKeyId: input.accessKeyId } : {}),
			...(typeof input.secretAccessKey === "string" ? { secretAccessKey: input.secretAccessKey } : {}),

			...(typeof input.panelJwt === "string" ? { panelJwt: input.panelJwt } : {}),

			...(typeof input.panelRefreshToken === "string" ? { panelRefreshToken: input.panelRefreshToken } : {}),
			...(typeof input.timeoutSecs === "number" ? { timeoutSecs: input.timeoutSecs } : {}),
		});
		void appLogger.info("config", "Usage probe tested", {
			provider,
			backend: "pi" as const,
			template: template ?? "(auto)",
			success: result.success,
		});
		return result;
	});

	ipcMain.handle(ipcChannels.configInstallUsageSkill, async () => {
		const result = await skillManager.installUsageProbeTemplate();
		if (result.success) {
			void appLogger.info("skill", "Usage probe skill template installed", { path: result.path });
			return { success: true, path: result.path };
		}
		void appLogger.warn("skill", "Failed to install usage probe skill template", { error: result.error });
		return { success: false, error: result.error };
	});

	ipcMain.handle(ipcChannels.configInstallImageGenSkill, async () => {
		const result = await skillManager.installImageGenTemplate();
		if (result.success) {
			void appLogger.info("skill", "Image-gen skill template installed", { path: result.path });
			return { success: true, path: result.path };
		}
		void appLogger.warn("skill", "Failed to install image-gen skill template", { error: result.error });
		return { success: false, error: result.error };
	});

	ipcMain.handle(ipcChannels.configInstallMcpSetupSkill, async () => {
		const result = await skillManager.installMcpSetupTemplate();
		if (result.success) {
			void appLogger.info("skill", "MCP setup skill template installed", { path: result.path });
			return { success: true, path: result.path };
		}
		void appLogger.warn("skill", "Failed to install mcp-setup skill template", { error: result.error });
		return { success: false, error: result.error };
	});

	ipcMain.handle(ipcChannels.appToggleDevTools, () => toggleMainWindowDevTools(getMainWindow()));
}
