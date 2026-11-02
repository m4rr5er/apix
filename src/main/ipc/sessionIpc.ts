import { existsSync } from "node:fs";
import { isAbsolute } from "node:path";
import { dialog, ipcMain, type BrowserWindow } from "electron";
import { ipcChannels } from "../../shared/ipc";
import { isRewindRestoreScope } from "../../shared/types/rewind";
import { canonicalizeSessionPath } from "../../shared/sessionIdentity";
import { createSessionModelPreference } from "../../shared/modelDisplayName";
import { modelThinkingLevelOf } from "../../shared/modelThinkingLevels";
import { readRuntimePromptTemplateBodies } from "../prompts/runtimeTemplateBodies";
import { sessionFileExistsCached } from "../sessions/sessionFileLiveness";
import type {
	AvailableModel,
	CreateSessionDraftInput,
	CreateAnonymousSessionInput,
	CreateAnonymousSessionResult,
	UpdateSessionRecordInput,
	SendSessionPromptInput,
	SessionUiResponseInput,
	SessionRuntimeTarget,
	SessionRuntimeInfo,
	SessionRuntimeReplacement,
	SessionRuntimeEvent,
	SessionCommandError,
	SessionCommandResult,
	SendPromptInput,
	SendPromptResult,
	SessionRecord,
	SessionFactsCoverage,
	SessionFactsResult,
	SessionProcessEvent,
	FetchedModel,
	SessionBranchTree,
	SessionMessagePage,
	SessionModelPreference,
	RewindCheckpointPageParams,
	ResolveLaunchDefaultsInput,
	ResolvedLaunchDefaults,
	SessionSearchMatch,
	SessionSearchResult,
} from "../../shared/types";
import { parseSessionProcessEventsFromFile } from "../sessions/sessionProcessEventsFile";
import type { SessionOutlineSnapshot as OutlineSnapshot } from "../../shared/types/outline";
import type { SessionForkCommands } from "../sessions/sessionForkCommands";
import { missingSessionFilePage } from "../sessions/sessionFileMissingPage";
import { isSessionSearchFilePath } from "../sessions/sessionSearchPath";
import { downgradeRunningStartedBefore, downgradeStaleRunning } from "../pi/derivedSubagents";
import { getCachedModelList } from "../pi/modelListCache";
import { resolveLaunchDefaultOptions, isModelInModelsConfig } from "../sessions/launchDefaults";
import { BackgroundScanCoordinator } from "../sessions/BackgroundScanCoordinator";
import { DIRECTORY_IMPORT_MAX_SUMMARIES } from "../sessions/directorySessionImport";
import type { DirectorySessionImporter } from "../sessions/DirectorySessionImporter";
import { registerSessionImageMutationIpc } from "./sessionImageMutationIpc";
import { acpMessagePage } from "../acp/acpMessagePage";
import { composeAgentInstruction } from "../agents/agentPersonaInstruction";

function isRecord(input: unknown): input is Record<string, unknown> {
	return typeof input === "object" && input !== null && !Array.isArray(input);
}

function normalizeSessionModelPreference(input: unknown): SessionModelPreference | undefined {
	if (!isRecord(input) || typeof input.provider !== "string" || typeof input.modelId !== "string" || (input.modelName !== undefined && typeof input.modelName !== "string")) return undefined;
	const provider = input.provider.trim();
	const modelId = input.modelId.trim();
	if (!provider || !modelId || provider.length > 128 || modelId.length > 256 || (typeof input.modelName === "string" && input.modelName.length > 256)) return undefined;
	return createSessionModelPreference(provider, modelId, input.modelName);
}

const scannedProjects = new Set<string>();

const catalogScanCoordinator = new BackgroundScanCoordinator(5000);

export function scheduleCatalogBackgroundScan(projectId: string, task: () => Promise<void>): boolean {
	scannedProjects.add(projectId);
	return catalogScanCoordinator.schedule(projectId, task);
}
import type { ProjectStore } from "../projects/ProjectStore";
import type { SettingsStore } from "../settings/SettingsStore";
import type { SessionScanner } from "../sessions/SessionScanner";
import type { SessionCatalog, SessionCatalogEntry } from "../sessions/SessionCatalog";
import type { SessionRuntimeCoordinator } from "../sessions/SessionRuntimeCoordinator";
import { SessionCommandIpcError } from "../sessions/SessionCommandIpcError";
import { appendSessionForkSuffix } from "../sessions/sessionForkTitle";
import type { AgentManager } from "../pi/AgentManager";
import type { ConfigManager } from "../config/ConfigManager";
import type { TerminalSessionManager } from "../terminal/TerminalSessionManager";
import type { CodexSessionImporter } from "../sessions/CodexSessionImporter";
import type { ClaudeSessionImporter } from "../sessions/ClaudeSessionImporter";
import type { QoderSessionImporter } from "../sessions/QoderSessionImporter";
import type { OpenCodeSessionImporter } from "../sessions/OpenCodeSessionImporter";
import type { ZCodeSessionImporter } from "../sessions/ZCodeSessionImporter";
import type { WorkBuddySessionImporter } from "../sessions/WorkBuddySessionImporter";
import type { CursorSessionImporter } from "../sessions/CursorSessionImporter";
import type { KimiSessionImporter } from "../sessions/KimiSessionImporter";
import type { KimiWorkSessionImporter } from "../sessions/KimiWorkSessionImporter";
import type { MinimaxSessionImporter } from "../sessions/MinimaxSessionImporter";
import type { AppLogger } from "../logging/AppLogger";

export type SessionIpcDeps = {
	projectStore: ProjectStore;
	settingsStore: SettingsStore;
	sessionScanner: SessionScanner;
	sessionCatalog: SessionCatalog;
	sessionRuntimeCoordinator: SessionRuntimeCoordinator;
	agentManager: AgentManager;
	configManager: ConfigManager;
	codexSessionImporter: CodexSessionImporter;
	claudeSessionImporter: ClaudeSessionImporter;
	qoderSessionImporter: QoderSessionImporter;
	openCodeSessionImporter: OpenCodeSessionImporter;
	zcodeSessionImporter: ZCodeSessionImporter;
	workbuddySessionImporter: WorkBuddySessionImporter;
	cursorSessionImporter: CursorSessionImporter;
	kimiSessionImporter: KimiSessionImporter;

	kimiWorkSessionImporter: KimiWorkSessionImporter;

	minimaxSessionImporter: MinimaxSessionImporter;

	directorySessionImporter: DirectorySessionImporter;
	appLogger: AppLogger;
	terminalManager: TerminalSessionManager;
	mainCopy: (key: string, params?: Record<string, string | number>) => string;
	getMainWindow: () => BrowserWindow | null;
	emitSessionRuntimeEvent: (agentId: string, channel: string, payload: unknown) => boolean;
	emitSessionRuntimeDetach: (target: SessionRuntimeTarget) => void;

	emitSessionActivating?: (sessionId: string) => void;

	emitSessionActivationFailed?: (sessionId: string) => void;
	createAnonymousSession: (input: CreateAnonymousSessionInput) => Promise<CreateAnonymousSessionResult>;
	stopSessionRuntime: (target: SessionRuntimeTarget) => void;
	emitReplacementState: (runtime: SessionRuntimeInfo, includeMessages: boolean) => void;
	readCatalogSessionReferenceMessages: (sessionId: string) => Promise<unknown[]>;

	readImageSessionMessages?: (sessionId: string) => Promise<import("../../shared/types").ChatMessage[]>;

	readVideoSessionMessages?: (sessionId: string) => Promise<import("../../shared/types").ChatMessage[]>;
	copyCatalogSession: (sessionId: string) => Promise<{ cancelled: boolean; targetSessionId?: string }>;
	exportCatalogSessionHtml: (sessionId: string) => Promise<Record<string, unknown> & { path: string }>;
	replaceAgentSession: (agentId: string, fn: () => Promise<unknown>, options?: { markForked?: boolean; markSuperseded?: boolean }) => Promise<unknown>;

	sessionForkCommands: SessionForkCommands;

	validationCatalogModels?: () => AvailableModel[] | null | undefined;

	sessionContentSearch?: (query: string) => Promise<SessionSearchResult | null>;

	sessionMessageSearch?: (sessionPath: string, query: string) => Promise<SessionSearchResult | null>;

	resolveSessionAgentInstruction?: (sessionId: string) => string | undefined;

	readAcpMessages?: (acpSessionId: string) => import("../../shared/types").ChatMessage[];
	readQoderMessages?: (qoderSessionId: string) => import("../../shared/types").ChatMessage[];

	readSessionFacts?: (sessionPath: string) => Promise<import("../../shared/types/trajectory").SessionFactsResult>;

	readSessionOutline?: (sessionPath: string, limit?: number) => Promise<import("../../shared/types/outline").SessionOutlineSnapshot>;
};

function sessionCommandIpcError(error: SessionCommandError, appLogger: Pick<AppLogger, "warn">, mainCopy: (key: string, params?: Record<string, string | number>) => string): SessionCommandIpcError {
	logSessionCommandFailure(appLogger, error);
	return new SessionCommandIpcError(error, mainCopy);
}

function logSessionCommandFailure(appLogger: Pick<AppLogger, "warn">, error: SessionCommandError, extra?: Record<string, unknown>): void {
	void appLogger.warn("session-command", `Session command failed (${error.code})`, {
		code: error.code,
		...(error.debugDetails ? { debugDetails: error.debugDetails } : {}),
		...extra,
	});
}

async function handleSessionCommandResult<T>(appLogger: Pick<AppLogger, "warn">, operation: string, target: SessionRuntimeTarget, extra: Record<string, unknown>, run: () => Promise<SessionCommandResult<T>>): Promise<SessionCommandResult<T>> {
	const result = await run();
	if (!result.ok) {
		logSessionCommandFailure(appLogger, result.error, {
			operation,
			sessionId: target.sessionId,
			agentId: target.agentId,
			runtimeGeneration: target.runtimeGeneration,
			...extra,
		});
	}
	return result;
}

export function registerSessionIpc(deps: SessionIpcDeps): void {
	const {
		projectStore,
		settingsStore,
		sessionScanner,
		sessionCatalog,
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
		mainCopy,
		getMainWindow,
		emitSessionRuntimeEvent,
		emitSessionRuntimeDetach,
		createAnonymousSession,
		stopSessionRuntime,
		emitSessionActivating,
		emitSessionActivationFailed,
		emitReplacementState,
		readCatalogSessionReferenceMessages,

		readImageSessionMessages,

		readVideoSessionMessages,
		copyCatalogSession,
		exportCatalogSessionHtml,
		replaceAgentSession,
		resolveSessionAgentInstruction,
		validationCatalogModels,
	} = deps;

	const selectableModels = validationCatalogModels ?? getCachedModelList;
	const { readAcpMessages, readQoderMessages, readSessionFacts, readSessionOutline } = deps;

	const backfillHistoricalSessionMetadata = async (sessionId: string, metadata: Pick<SessionMessagePage, "model" | "thinkingLevel">): Promise<void> => {
		if (sessionRuntimeCoordinator.getTarget(sessionId)) return;
		const entry = sessionCatalog.get(sessionId);
		if (!entry || !entry.filePath) return;
		if (entry.model && entry.thinkingLevel) return;
		if (!metadata.model && !metadata.thinkingLevel) return;
		try {
			const current = sessionCatalog.get(sessionId);
			if (!current || !current.filePath) return;
			const patch: {
				model?: SessionModelPreference;
				thinkingLevel?: string;
				updatedAt: number;
			} = { updatedAt: current.updatedAt };
			if (!current.model && metadata.model) patch.model = createSessionModelPreference(metadata.model.provider, metadata.model.modelId, undefined);
			if (!current.thinkingLevel && metadata.thinkingLevel) {
				patch.thinkingLevel = metadata.thinkingLevel;
			}
			if (!patch.model && patch.thinkingLevel === undefined) return;
			const updated = await sessionCatalog.update(sessionId, patch);
			const window = getMainWindow();
			if (window && !window.isDestroyed()) {
				window.webContents.send(ipcChannels.sessionsCatalogRefreshed, {
					projectId: updated.projectId,
				});
			}
		} catch (error) {
			void appLogger.warn("session", "Historical session metadata backfill failed", {
				sessionId,
				error: error instanceof Error ? error.message : String(error),
			});
		}
	};

	let firstSessionListMilestoneLogged = false;
	ipcMain.handle(ipcChannels.sessionsList, async (_event, projectId?: string) => {
		const project = projectId ? projectStore.get(projectId) : undefined;
		let projectPath = project?.path;

		if (projectPath && settingsStore.get().wslEnabled && settingsStore.get().wslDistro) {
			projectPath = projectPath.replace(/^([A-Za-z]):\\/, (_: string, d: string) => `/mnt/${d.toLowerCase()}/`).replace(/\\/g, "/");
		}
		const startedAt = Date.now();
		const sessions = await sessionScanner.list(projectPath);
		if (!firstSessionListMilestoneLogged) {
			firstSessionListMilestoneLogged = true;
			void appLogger.info("app", "Cold start milestone: first session list", {
				scanMs: Date.now() - startedAt,
				sessions: sessions.length,
				projectId: projectId ?? null,
				processUptimeMs: Math.round(process.uptime() * 1000),
			});
		}
		return sessions;
	});

	ipcMain.handle(ipcChannels.sessionsSearchContent, async (_event, query: unknown) => {
		const searcher = deps.sessionContentSearch;
		if (!searcher) return null;
		if (typeof query !== "string") return null;
		const trimmed = query.trim();
		if (!trimmed || trimmed.length > 256) return null;
		try {
			return await searcher(trimmed);
		} catch (error) {
			void appLogger.warn("session", "Content search failed", { error: error instanceof Error ? error.message : String(error) });
			return null;
		}
	});

	ipcMain.handle(ipcChannels.sessionsSearchInSession, async (_event, sessionId: unknown, query: unknown) => {
		if (typeof sessionId !== "string" || typeof query !== "string") return null;
		const trimmed = query.trim();
		if (!trimmed || trimmed.length > 256) return null;
		const entry = sessionCatalog.get(sessionId.trim());
		if (!entry) return null;
		const searcher = deps.sessionMessageSearch;

		if (!searcher || !entry.filePath || !isSessionSearchFilePath(entry.filePath)) return null;
		try {
			return await searcher(entry.filePath, trimmed);
		} catch (error) {
			void appLogger.warn("session", "In-session search failed", { error: error instanceof Error ? error.message : String(error) });
			return null;
		}
	});

	ipcMain.handle(ipcChannels.sessionsCatalogList, async (_event, projectId: string, options?: { scan?: boolean }) => {
		const project = projectStore.get(projectId);
		if (!project) throw new Error(mainCopy("project.notFound"));
		let projectPath = project.path;
		const settings = settingsStore.get();
		if (settings.wslEnabled && settings.wslDistro) {
			projectPath = projectPath.replace(/^([A-Za-z]):\\/, (_: string, drive: string) => `/mnt/${drive.toLowerCase()}/`).replace(/\\/g, "/");
		}
		const { wslEnabled, wslDistro, wslUser } = settings;

		const runScanAndMerge = async (): Promise<SessionRecord[]> => {
			const summaries = await sessionScanner.list(projectPath);
			const records = await sessionCatalog.mergeScanned(projectId, summaries, wslEnabled ? { wslDistro, wslUser } : {});

			const visibleRecords = records.filter((record) => !record.supersededBy);
			const bindings = sessionRuntimeCoordinator.attachCatalogRuntimes(visibleRecords);
			for (const binding of bindings) {
				const tab = agentManager.list().find((candidate) => candidate.id === binding.agentId);
				if (tab) emitSessionRuntimeEvent(tab.id, ipcChannels.agentsState, tab);
			}
			return visibleRecords;
		};

		const cachedRecords = sessionCatalog
			.listEntries()

			.filter((entry) => entry.projectId === projectId && !entry.supersededBy)
			.map((entry) => sessionCatalog.getRecord(entry.id))
			.filter((record): record is SessionRecord => Boolean(record))

			.sort((left, right) => right.updatedAt - left.updatedAt)

			.filter((record) => {
				if (!record.filePath || record.backend === "acp" || record.backend === "qoder" || record.filePath.startsWith("\\\\")) return true;

				if (record.environment === "wsl") return true;
				if (sessionRuntimeCoordinator.hasLiveRuntime(record.id)) return true;

				return sessionFileExistsCached(record.filePath);
			});

		if (options?.scan === false) return cachedRecords;

		scannedProjects.add(projectId);
		catalogScanCoordinator.schedule(projectId, async () => {
			try {
				await runScanAndMerge();
			} catch (error) {
				void appLogger.warn("session", "Background catalog scan failed", {
					projectId,
					error: error instanceof Error ? error.message : String(error),
				});
			} finally {
				const window = getMainWindow();
				if (window && !window.isDestroyed()) {
					window.webContents.send(ipcChannels.sessionsCatalogRefreshed, { projectId });
				}
			}
		});
		return cachedRecords;
	});
	ipcMain.handle(ipcChannels.sessionsCatalogCreateDraft, async (_event, input: CreateSessionDraftInput) => {
		const project = projectStore.get(input.projectId);
		if (!project) throw new Error(mainCopy("project.notFound"));

		let model = normalizeSessionModelPreference(input.model);
		let thinkingLevel = input.thinkingLevel;
		const nonPiBackend = input.backend === "acp" || input.backend === "qoder";
		if ((!nonPiBackend && !model) || !thinkingLevel) {
			try {
				const [settingsResult, modelsResult] = await Promise.all([configManager.getSettingsConfig(), configManager.getModelsConfig()]);

				if (!nonPiBackend && model) {
					if (
						typeof model.provider !== "string" ||
						typeof model.modelId !== "string" ||
						!isModelInModelsConfig(
							modelsResult.parsed,
							{
								provider: model.provider,
								modelId: model.modelId,
							},
							selectableModels(),
						)
					) {
						model = undefined;
					}
				}

				const defaults = resolveLaunchDefaultOptions({
					backend: input.backend,
					settings: settingsResult.parsed,
					models: modelsResult.parsed,

					catalogModels: selectableModels(),

					lastUsedModel: settingsStore.get().lastUsedModel,
					welcomeModel: input.welcomeModel && typeof input.welcomeModel.provider === "string" && typeof input.welcomeModel.modelId === "string" ? input.welcomeModel : undefined,
				});
				if (!nonPiBackend && !model) {
					model = defaults.model;
				}
				if (!thinkingLevel) {
					const perModelThinkingLevel = !nonPiBackend && model && typeof model.provider === "string" && typeof model.modelId === "string" ? modelThinkingLevelOf(settingsResult.parsed, model.provider, model.modelId) : undefined;
					thinkingLevel = perModelThinkingLevel ?? defaults.thinkingLevel;
				}
			} catch {}
		}
		const draft = await sessionCatalog.createDraft({
			projectId: input.projectId,
			title: input.title?.trim() || mainCopy("session.newTitle"),
			environment: settingsStore.get().wslEnabled ? "wsl" : "native",

			backend: input.backend === "acp" ? "acp" : input.backend === "qoder" ? "qoder" : undefined,

			acpToolId: input.backend === "acp" && typeof input.acpToolId === "string" ? input.acpToolId : undefined,
			model,
			thinkingLevel,

			sideTask: input.sideTask === true,
		});
		void appLogger.info("session", "Session draft created", {
			sessionId: draft.id,
			projectId: input.projectId,
			title: draft.title,
			model: draft.model,
		});

		if (!nonPiBackend) agentManager.ensureStandbyAgent(input.projectId);
		return draft;
	});
	ipcMain.handle(ipcChannels.sessionsResolveLaunchDefaults, async (_event, input?: ResolveLaunchDefaultsInput): Promise<ResolvedLaunchDefaults> => {
		const backend = input?.backend === "acp" ? "acp" : input?.backend === "qoder" ? "qoder" : undefined;
		try {
			const [settingsResult, modelsResult] = await Promise.all([configManager.getSettingsConfig(), configManager.getModelsConfig()]);
			return resolveLaunchDefaultOptions({
				backend,
				settings: settingsResult.parsed,
				models: modelsResult.parsed,

				catalogModels: selectableModels(),

				lastUsedModel: settingsStore.get().lastUsedModel,
			});
		} catch {
			return {};
		}
	});
	ipcMain.handle(ipcChannels.sessionsCreateAnonymous, async (_event, input: CreateAnonymousSessionInput) => {
		const result = await createAnonymousSession(input);
		void appLogger.info("session", "Anonymous session created", {
			sessionId: result.session.id,
			projectId: input.projectId,
		});
		return result;
	});
	ipcMain.handle(ipcChannels.sessionsCatalogUpdate, async (_event, sessionId: string, patch: UpdateSessionRecordInput) => {
		if (patch.sideTask !== undefined && patch.sideTask !== true && patch.sideTask !== null) {
			patch = { ...patch, sideTask: undefined };
		}
		const normalizedModel = patch.model === undefined ? undefined : patch.model === null ? null : normalizeSessionModelPreference(patch.model);
		if (patch.model !== undefined && patch.model !== null && !normalizedModel) {
			throw new Error(mainCopy("session.invalidModel"));
		}
		if (patch.model !== undefined) {
			patch = { ...patch, model: normalizedModel };
		}
		const entry = sessionCatalog.get(sessionId);
		if (!entry) throw new Error(mainCopy("session.notFound"));

		if (patch.backend !== undefined && patch.backend !== entry.backend && (entry.status === "active" || sessionRuntimeCoordinator.getTarget(sessionId))) {
			throw new Error(mainCopy("session.backendLocked"));
		}

		if (patch.backend !== undefined && patch.backend !== entry.backend && patch.backend !== "pi") {
			agentManager.releaseStandbyAgent(entry.projectId);
		}
		const title = patch.title?.trim();
		if (title && title !== entry.title) {
			await sessionCatalog.claimTitleOwnership(sessionId);
			const target = sessionRuntimeCoordinator.getTarget(sessionId);
			if (target) {
				const renamed = await sessionRuntimeCoordinator.renameRuntime(target, title);
				if (!renamed.ok) throw sessionCommandIpcError(renamed.error, appLogger, mainCopy);
			} else if (entry.filePath) {
				await sessionScanner.rename(entry.filePath, title);
				void appLogger.info("session", "Session renamed (file)", {
					sessionId,
					oldTitle: entry.title,
					newTitle: title,
				});
			}
		}
		return sessionCatalog.update(sessionId, {
			...patch,
			title: title || undefined,

			...(patch.backend === "imagegen" || patch.backend === "videogen" || patch.backend === "acp" || patch.backend === "qoder" ? { filePath: null, piSessionId: null } : {}),
		});
	});
	ipcMain.handle(ipcChannels.sessionsCatalogDelete, async (_event, sessionId: string) => {
		const entry = sessionCatalog.get(sessionId);
		if (!entry) return false;

		await sessionRuntimeCoordinator.releaseRuntimeForDelete(sessionId);
		try {
			if (entry.filePath) {
				const normalizedTarget = canonicalizeSessionPath(entry.filePath, entry.environment);
				const usingAgent = agentManager
					.list()
					.find((agent) => agent.sessionPath && agent.sessionEnvironment === entry.environment && (entry.environment !== "wsl" || (agent.wslDistro === entry.wslDistro && agent.wslUser === entry.wslUser)) && canonicalizeSessionPath(agent.sessionPath, entry.environment) === normalizedTarget);
				if (usingAgent) {
					await sessionRuntimeCoordinator.stopAgentById(usingAgent.id).catch(() => undefined);
					await agentManager.stop(usingAgent.id).catch(() => undefined);
				}
				await sessionScanner.delete(entry.filePath);
			}

			await sessionCatalog.removeWithDescendants(sessionId);
			void appLogger.info("session", "Catalog session deleted", { sessionId, filePath: entry.filePath });
			return true;
		} catch (error) {
			void appLogger.error("session", "Catalog session delete failed", {
				sessionId,
				filePath: entry.filePath,
				error: error instanceof Error ? error.message : String(error),
			});
			throw error;
		}
	});
	ipcMain.handle(ipcChannels.sessionsCatalogArchive, async (_event, sessionId: string) => {
		const entry = sessionCatalog.get(sessionId);
		if (!entry?.filePath) return false;

		if (sessionRuntimeCoordinator.getTarget(sessionId) || sessionRuntimeCoordinator.isActivating(sessionId)) {
			throw new Error(mainCopy("session.stopBeforeDelete"));
		}
		const archivedPath = await sessionScanner.archive(entry.filePath);

		await sessionCatalog.removeWithDescendants(sessionId);
		void appLogger.info("session", "Session archived", { sessionId, archivedPath });
		return true;
	});
	ipcMain.handle(ipcChannels.sessionsCatalogUnarchive, async (_event, archivedPath: string) => {
		if (typeof archivedPath !== "string" || !archivedPath.endsWith(".jsonl")) {
			throw new Error(mainCopy("session.invalidArchivePath"));
		}
		const restoredPath = await sessionScanner.unarchive(archivedPath);
		void appLogger.info("session", "Session restored from archive", { restoredPath });
		return true;
	});
	ipcMain.handle(ipcChannels.sessionsCatalogListArchived, async () => sessionScanner.listArchived());
	ipcMain.handle(ipcChannels.sessionsCatalogDeleteArchived, async (_event, archivedPath: unknown): Promise<boolean> => {
		if (typeof archivedPath !== "string" || !archivedPath.endsWith(".jsonl")) {
			throw new Error(mainCopy("session.invalidArchivePath"));
		}
		await sessionScanner.deleteArchived(archivedPath);
		void appLogger.info("session", "Archived session deleted", { archivedPath });
		return true;
	});
	ipcMain.handle(ipcChannels.sessionsCatalogReadMessages, async (_event, sessionId: string) => {
		const entry = sessionCatalog.get(sessionId);

		if (entry?.backend === "acp") {
			return readAcpMessages ? readAcpMessages(entry.acpSessionId ?? "") : [];
		}
		if (entry?.backend === "qoder") {
			return readQoderMessages ? readQoderMessages(entry.qoderSessionId ?? "") : [];
		}
		if (entry?.backend === "imagegen") {
			return (await readImageSessionMessages?.(sessionId)) ?? [];
		}
		if (entry?.backend === "videogen") {
			return (await readVideoSessionMessages?.(sessionId)) ?? [];
		}
		if (!entry?.filePath) return [];

		const window = await agentManager.readSessionLoadWindow(entry.filePath, sessionId, { projectId: entry.projectId });
		const messages = window.messages;
		const metadata = await agentManager.readSessionDisplayMetadata(entry.filePath);
		await backfillHistoricalSessionMetadata(sessionId, metadata);
		return messages;
	});

	ipcMain.handle(ipcChannels.sessionsGetBranchTree, async (_event, sessionId: unknown): Promise<SessionBranchTree | null> => {
		if (typeof sessionId !== "string" || !sessionId.trim()) throw new Error("Invalid branch-tree request");
		const entry = sessionCatalog.get(sessionId);

		if (!entry?.filePath || entry.backend === "imagegen" || entry.backend === "videogen" || entry.backend === "acp" || entry.backend === "qoder") return null;
		return agentManager.readSessionBranchTree(entry.filePath);
	});

	ipcMain.handle(ipcChannels.sessionsListSubagents, async (_event, sessionId: string) => {
		if (typeof sessionId !== "string" || !sessionId) return [];
		const entry = sessionCatalog.get(sessionId);
		if (!entry?.filePath) return [];

		const liveTarget = sessionRuntimeCoordinator.getTarget(sessionId);
		const liveTab = liveTarget ? agentManager.list().find((t) => t.id === liveTarget.agentId) : undefined;
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

		const children = sessionCatalog
			.listEntries()
			.filter((e) => e.parentSessionPath === entry.filePath)
			.map((e) => sessionCatalog.getRecord(e.id))
			.filter((r): r is NonNullable<typeof r> => r != null);
		for (const record of records) {
			const namePrefix = `${record.type}#${record.id.slice(0, 8)}`;
			const child = children.find((s) => (s.title ?? "").startsWith(namePrefix));
			if (child?.filePath) record.childSessionPath = child.filePath;
			if (child) record.childSessionId = child.id;
		}

		if (liveTarget?.agentId) {
			agentManager.syncSubagentPerfSpans(liveTarget.agentId, records, { emit: false });
		}
		return records;
	});

	ipcMain.handle(ipcChannels.sessionsListSessionTodo, async (_event, sessionId: string) => {
		if (typeof sessionId !== "string" || !sessionId) return undefined;
		const entry = sessionCatalog.get(sessionId);

		if (!entry?.filePath || entry.backend === "imagegen" || entry.backend === "videogen") return undefined;
		return agentManager.readSessionTodo(entry.filePath);
	});

	ipcMain.handle(ipcChannels.sessionsCatalogReadMessagePage, async (_event, sessionId: string, before?: number, pageSize?: number, options?: { beforeEntryId?: string }) => {
		const entry = sessionCatalog.get(sessionId);
		if (entry?.backend === "acp") return acpMessagePage(readAcpMessages?.(entry.acpSessionId ?? "") ?? [], before, pageSize);
		if (entry?.backend === "qoder") return acpMessagePage(readQoderMessages?.(entry.qoderSessionId ?? "") ?? [], before, pageSize);
		if (entry?.backend === "imagegen" || entry?.backend === "videogen" || !entry?.filePath) {
			const independentMessages = entry?.backend === "videogen" ? ((await readVideoSessionMessages?.(sessionId)) ?? []) : ((await readImageSessionMessages?.(sessionId)) ?? []);
			if (independentMessages.length > 0) {
				return {
					messages: independentMessages,
					total: independentMessages.length,
					nextBefore: null,
				};
			}
			return { messages: [], total: 0, nextBefore: null };
		}

		try {
			let page: SessionMessagePage;

			if (options?.beforeEntryId || typeof before === "number") {
				const target = sessionRuntimeCoordinator.getTarget(sessionId);
				if (target) {
					const cached = await agentManager
						.tryReadRuntimeTurnPage(entry.filePath, target.agentId, {
							beforeEntryId: options?.beforeEntryId,
							before,
							turnCount: pageSize,
						})
						.catch(() => null);
					if (cached) return cached;
				}
			}
			page = await agentManager.readSessionDisplayTurnPage(entry.filePath, sessionId, before, pageSize, options?.beforeEntryId, { projectId: entry.projectId });
			await backfillHistoricalSessionMetadata(sessionId, page);
			return page;
		} catch (error) {
			const missingFile = missingSessionFilePage(error);
			if (missingFile) {
				appLogger.info("session", "Read message page: session file not written yet", { sessionId, filePath: entry.filePath });
				return missingFile;
			}

			const imageSessionMessages = (await readImageSessionMessages?.(sessionId)) ?? [];
			if (imageSessionMessages.length > 0) {
				return {
					messages: imageSessionMessages,
					total: imageSessionMessages.length,
					nextBefore: null,
				};
			}
			appLogger.warn("session", "Read message page failed", {
				sessionId,
				filePath: entry.filePath,
				error: error instanceof Error ? error.message : String(error),
			});
			throw error;
		}
	});
	ipcMain.handle(ipcChannels.sessionsCatalogReadProcessEvents, async (_event, sessionId: string): Promise<SessionFactsResult> => {
		const unavailable = (reason: SessionFactsCoverage["reason"]): SessionFactsResult => ({ events: [], version: "", coverage: { fromStart: true, chainComplete: true, readComplete: true, eventsTrimmed: false, ...(reason ? { reason } : {}) } });
		if (typeof sessionId !== "string" || !sessionId.trim()) return unavailable("unavailable");
		const entry = sessionCatalog.get(sessionId);
		if (!entry?.filePath) return unavailable("unavailable");
		if (readSessionFacts) {
			try {
				const facts = await readSessionFacts(entry.filePath);
				if (facts.events.length === 0) appLogger.debug("trajectory", "pi process events empty", { sessionId, filePath: entry.filePath, reason: facts.coverage.reason ?? null });
				return facts;
			} catch (error) {
				appLogger.warn("trajectory", "Read session facts failed", {
					sessionId,
					filePath: entry.filePath,
					error: error instanceof Error ? error.message : String(error),
				});
				return unavailable("unavailable");
			}
		}

		return { events: await parseSessionProcessEventsFromFile(entry.filePath), version: "", coverage: { fromStart: true, chainComplete: true, readComplete: true, eventsTrimmed: false } };
	});

	ipcMain.handle(ipcChannels.sessionsCatalogReadOutline, async (_event, sessionId: unknown, limit?: unknown): Promise<OutlineSnapshot> => {
		const empty: OutlineSnapshot = { entries: [], total: 0, truncated: false };
		if (typeof sessionId !== "string" || !sessionId.trim()) return empty;
		const entry = sessionCatalog.get(sessionId);
		if (!entry?.filePath || !readSessionOutline) return empty;
		const bounded = typeof limit === "number" && Number.isFinite(limit) ? Math.min(Math.max(Math.floor(limit), 1), 10_000) : undefined;
		return readSessionOutline(entry.filePath, bounded);
	});
	ipcMain.handle(ipcChannels.sessionsCatalogReadReferenceMessages, (_event, sessionId: string) => readCatalogSessionReferenceMessages(sessionId));

	ipcMain.handle(ipcChannels.sessionsCatalogReadMessageFullText, async (_event, sessionId: unknown, agentId: unknown, messageId: unknown, entryId?: unknown) => {
		if (typeof agentId !== "string" || !agentId.trim() || typeof messageId !== "string" || !messageId.trim()) {
			throw new Error("Invalid message full-text request");
		}
		if (sessionId !== undefined && (typeof sessionId !== "string" || !sessionId.trim())) {
			throw new Error("Invalid sessionId");
		}
		if (entryId !== undefined && (typeof entryId !== "string" || !entryId.trim())) {
			throw new Error("Invalid entryId");
		}
		try {
			return await agentManager.readMessageFullText(agentId, messageId, entryId as string | undefined);
		} catch (error) {
			if (typeof sessionId === "string" && sessionId.trim()) {
				const record = sessionCatalog.get(sessionId);
				if (record?.filePath) {
					return agentManager.readMessageFullTextFromFile(record.filePath, messageId, entryId as string | undefined);
				}
			}
			throw error;
		}
	});
	ipcMain.handle(ipcChannels.sessionsCatalogCopy, async (_event, sessionId: string) => {
		if (typeof sessionId !== "string" || !sessionId.trim()) throw new Error("Invalid session id");
		const result = await copyCatalogSession(sessionId);
		void appLogger.info("session", "Session copied", { sessionId, targetSessionId: result.cancelled ? undefined : result.targetSessionId });
		return result;
	});
	ipcMain.handle(ipcChannels.sessionsCatalogExportHtml, async (_event, sessionId: string) => {
		if (typeof sessionId !== "string" || !sessionId.trim()) throw new Error("Invalid session id");
		const result = await exportCatalogSessionHtml(sessionId);
		void appLogger.info("session", "Session exported (catalog HTML)", { sessionId, path: result.path });
		return result;
	});
	registerSessionImageMutationIpc(ipcMain, sessionRuntimeCoordinator, (error, context) => {
		logSessionCommandFailure(appLogger, error, { operation: "removeCatalogMessageImage", ...context });
	});
	// catalog 级消息改写：按 sessionId 操作 JSONL，不要求 live runtime。
	// 运行中必须先停（coordinator 拒绝 SESSION_RUNTIME_BUSY）；入参在边界校验。
	ipcMain.handle(ipcChannels.sessionsCatalogEditMessage, async (_event, sessionId: unknown, messageId: unknown, newText: unknown, entryId: unknown) => {
		if (typeof sessionId !== "string" || !sessionId.trim() || typeof messageId !== "string" || !messageId.trim() || typeof newText !== "string" || (entryId !== undefined && typeof entryId !== "string")) {
			throw new Error("Invalid catalog edit-message request");
		}
		const result = await sessionRuntimeCoordinator.editCatalogMessage(sessionId, messageId, newText, entryId as string | undefined);
		if (!result.ok) logSessionCommandFailure(appLogger, result.error, { operation: "editCatalogMessage", sessionId, messageId });
		return result;
	});
	ipcMain.handle(ipcChannels.sessionsCatalogDeleteMessage, async (_event, sessionId: unknown, messageId: unknown, entryId: unknown) => {
		if (typeof sessionId !== "string" || !sessionId.trim() || typeof messageId !== "string" || !messageId.trim() || (entryId !== undefined && typeof entryId !== "string")) {
			throw new Error("Invalid catalog delete-message request");
		}
		const result = await sessionRuntimeCoordinator.deleteCatalogMessage(sessionId, messageId, entryId as string | undefined);
		if (!result.ok) logSessionCommandFailure(appLogger, result.error, { operation: "deleteCatalogMessage", sessionId, messageId });
		return result;
	});
	ipcMain.handle(ipcChannels.sessionsCatalogPrepareResend, async (_event, sessionId: unknown, messageId: unknown, entryId: unknown) => {
		if (typeof sessionId !== "string" || !sessionId.trim() || typeof messageId !== "string" || !messageId.trim() || (entryId !== undefined && typeof entryId !== "string")) {
			throw new Error("Invalid catalog prepare-resend request");
		}
		const result = await sessionRuntimeCoordinator.prepareCatalogResend(sessionId, messageId, entryId as string | undefined);
		if (!result.ok) logSessionCommandFailure(appLogger, result.error, { operation: "prepareCatalogResend", sessionId, messageId });
		return result;
	});
	ipcMain.handle(ipcChannels.sessionsSendPrompt, async (_event, input: SendSessionPromptInput) => {
		const startedAt = Date.now();
		if (!isRecord(input) || typeof input.sessionId !== "string" || typeof input.requestId !== "string" || typeof input.message !== "string") {
			throw new Error("Invalid session prompt input");
		}
		void appLogger.info("session", "Session prompt IPC received", {
			sessionId: input.sessionId,
			requestId: input.requestId,
			messageLength: input.message.length,
			imageCount: input.images?.length ?? 0,
		});
		try {
			// 绑定了智能体的会话：发送前统一注入角色设定，渲染层各入口不再自行拼接。
			const persona = resolveSessionAgentInstruction?.(input.sessionId);
			const boundRecord = persona ? sessionCatalog.get(input.sessionId) : undefined;
			let promptInput: SendSessionPromptInput = input;
			if (persona && boundRecord) {
				const composed = composeAgentInstruction({ persona, message: input.message, existingAgentMessage: input.agentMessage, backend: boundRecord.backend });
				promptInput = { ...input, message: composed.message };
				if (composed.agentMessage === undefined) delete promptInput.agentMessage;
				else promptInput.agentMessage = composed.agentMessage;
			}
			const result = await sessionRuntimeCoordinator.send(promptInput);
			if (result.agentId) {
				const tab = agentManager.list().find((candidate) => candidate.id === result.agentId);
				if (tab) emitSessionRuntimeEvent(tab.id, ipcChannels.agentsState, tab);
			}
			// 消息被接受才记「最后一次使用」（选而未发不算）。
			if (result.accepted && boundRecord?.model?.provider && boundRecord.model.modelId) {
				const provider = boundRecord.model.provider;
				const current = settingsStore.get().recentProviders ?? [];
				void settingsStore
					.update({
						lastUsedModel: { provider, modelId: boundRecord.model.modelId },
						recentProviders: [provider, ...current.filter((item) => item !== provider)],
					})
					.catch((error) => void appLogger.warn("settings", "Failed to record lastUsedModel", { error: error instanceof Error ? error.message : String(error) }));
			}
			void appLogger.info("session", "Session prompt IPC completed", {
				sessionId: input.sessionId,
				requestId: input.requestId,
				agentId: result.agentId,
				accepted: result.accepted,
				delivery: "delivery" in result ? result.delivery : undefined,
				totalMs: Date.now() - startedAt,
			});
			return result;
		} catch (error) {
			void appLogger.warn("session", "Session prompt IPC failed", {
				sessionId: input.sessionId,
				requestId: input.requestId,
				error: error instanceof Error ? error.message : String(error),
			});
			throw error;
		}
	});
	ipcMain.handle(ipcChannels.sessionsUiResponse, (_event, input: SessionUiResponseInput) => sessionRuntimeCoordinator.respondToUi(input));
	ipcMain.handle(ipcChannels.sessionsRuntimeList, () => sessionRuntimeCoordinator.listRuntimes());
	ipcMain.handle(ipcChannels.sessionsRuntimeActivate, async (_event, sessionId: unknown) => {
		if (typeof sessionId !== "string" || !sessionId.trim()) throw new Error("Invalid session id");
		const startedAt = Date.now();
		void appLogger.info("session-perf", "Runtime activation IPC started", { sessionId });
		if (!sessionRuntimeCoordinator.hasLiveRuntime(sessionId)) emitSessionActivating?.(sessionId);
		const result = await sessionRuntimeCoordinator.activateRuntime(sessionId);
		if (result.ok) emitReplacementState(result.value, true);
		else if (!sessionRuntimeCoordinator.hasLiveRuntime(sessionId)) emitSessionActivationFailed?.(sessionId);
		void appLogger.info("session-perf", "Runtime activation IPC completed", {
			sessionId,
			ok: result.ok,
			activationMs: Date.now() - startedAt,
			...(result.ok ? {} : { error: result.error?.debugDetails ?? JSON.stringify(result.error) }),
		});
		return result;
	});
	// 渲染层切换会话时汇报聚焦会话；主进程据此判断 Ask 类请求是否需要桌面通知。
	ipcMain.handle(ipcChannels.sessionsSetFocusedSession, (_event, sessionId: unknown) => {
		sessionRuntimeCoordinator.setFocusedSession(typeof sessionId === "string" && sessionId.trim() ? sessionId.trim() : undefined);
	});
	ipcMain.handle(ipcChannels.sessionsRuntimeStop, (_event, target: SessionRuntimeTarget) => stopSessionRuntime(target));
	ipcMain.handle(ipcChannels.sessionsRuntimeAbort, (_event, target: SessionRuntimeTarget) => sessionRuntimeCoordinator.abortRuntime(target));
	ipcMain.handle(ipcChannels.sessionsRuntimeRestart, async (_event, target: SessionRuntimeTarget) => {
		terminalManager.closeAgent(target.agentId);
		const result = await sessionRuntimeCoordinator.restartRuntime(target);
		if (result.ok) {
			if (!result.value.session.noSession) emitSessionRuntimeDetach(target);

			emitReplacementState(result.value.runtime, true);
		}
		return result;
	});
	ipcMain.handle(ipcChannels.sessionsRuntimeCompact, (_event, target: SessionRuntimeTarget, prompt?: string) => sessionRuntimeCoordinator.compactRuntime(target, prompt));
	ipcMain.handle(ipcChannels.sessionsRuntimeState, (_event, target: SessionRuntimeTarget) => sessionRuntimeCoordinator.getRuntimeState(target));
	ipcMain.handle(ipcChannels.sessionsRuntimeCommands, (_event, target: SessionRuntimeTarget) => sessionRuntimeCoordinator.listRuntimeCommands(target));

	ipcMain.handle(ipcChannels.sessionsRuntimePromptTemplates, async (_event, target: SessionRuntimeTarget) => {
		const commands = await sessionRuntimeCoordinator.listRuntimeCommands(target);
		if (!commands.ok) return commands;
		const templates = await readRuntimePromptTemplateBodies(commands.value.value);
		return { ok: true as const, value: { target: commands.value.target, value: templates } };
	});
	ipcMain.handle(ipcChannels.sessionsRuntimeReloadResources, (_event, target: SessionRuntimeTarget) => sessionRuntimeCoordinator.reloadResources(target));

	ipcMain.handle(ipcChannels.sessionsDraftCommands, (_event, projectId: string) => {
		if (typeof projectId !== "string" || !projectId.trim()) return null;
		return sessionRuntimeCoordinator.draftCommands(projectId);
	});

	ipcMain.handle(ipcChannels.sessionsDraftPromptTemplates, async (_event, projectId: string) => {
		if (typeof projectId !== "string" || !projectId.trim()) return null;
		const commands = await sessionRuntimeCoordinator.draftCommands(projectId);
		if (!Array.isArray(commands) || commands.length === 0) return null;
		const templates = await readRuntimePromptTemplateBodies(commands);
		return templates.length > 0 ? templates : null;
	});
	ipcMain.handle(ipcChannels.sessionsRuntimeListModels, (_event, target: SessionRuntimeTarget) => sessionRuntimeCoordinator.listRuntimeModels(target));
	ipcMain.handle(ipcChannels.sessionsRuntimeThinkingLevels, (_event, target: SessionRuntimeTarget) => sessionRuntimeCoordinator.listRuntimeThinkingLevels(target));
	ipcMain.handle(ipcChannels.sessionsRuntimeExportHtml, async (_event, target: SessionRuntimeTarget) => {
		const result = await sessionRuntimeCoordinator.exportRuntimeHtml(target);
		void appLogger.info("session", "Session exported (runtime HTML)", {
			sessionId: target.sessionId,
			ok: result.ok,
		});
		return result;
	});
	ipcMain.handle(ipcChannels.sessionsRuntimeEditMessage, (_event, target: SessionRuntimeTarget, messageId: string, newText: string) => handleSessionCommandResult(appLogger, "editRuntimeMessage", target, { messageId }, () => sessionRuntimeCoordinator.editRuntimeMessage(target, messageId, newText)));
	ipcMain.handle(ipcChannels.sessionsRuntimeDeleteMessage, (_event, target: SessionRuntimeTarget, messageId: string) => handleSessionCommandResult(appLogger, "deleteRuntimeMessage", target, { messageId }, () => sessionRuntimeCoordinator.deleteRuntimeMessage(target, messageId)));

	ipcMain.handle(ipcChannels.sessionsRewindList, (_event, target: SessionRuntimeTarget, params?: RewindCheckpointPageParams) => sessionRuntimeCoordinator.listRewindCheckpoints(target, params));
	ipcMain.handle(ipcChannels.sessionsRewindDiff, (_event, target: SessionRuntimeTarget, checkpointId: string) => sessionRuntimeCoordinator.getRewindCheckpointDiff(target, checkpointId));
	ipcMain.handle(ipcChannels.sessionsRewindRestore, (_event, target: SessionRuntimeTarget, checkpointId: string, scope: unknown) => {
		if (!isRewindRestoreScope(scope)) {
			return handleSessionCommandResult(appLogger, "restoreRewindCheckpoint", target, { checkpointId, scope: String(scope) }, () =>
				Promise.resolve({
					ok: false,
					error: {
						code: "SESSION_COMMAND_FAILED",
						debugDetails: `Invalid rewind restore scope: ${String(scope)}`,
					},
				}),
			);
		}
		return handleSessionCommandResult(appLogger, "restoreRewindCheckpoint", target, { checkpointId, scope }, async () => {
			const result = await sessionRuntimeCoordinator.restoreRewindCheckpoint(target, checkpointId, scope);

			if (result.ok && scope !== "files") {
				const tab = agentManager.list().find((candidate) => candidate.id === target.agentId);
				if (tab?.sessionPath) {
					const environment = tab.sessionEnvironment ?? "native";
					const entry = sessionCatalog.findByFilePath(tab.sessionPath, environment);
					if (entry) {
						await sessionCatalog.update(entry.id, { forked: true });

						const forkedTitle = appendSessionForkSuffix(entry.title, mainCopy("session.forkedSuffix"));
						if (forkedTitle !== entry.title) {
							const originBinding = sessionRuntimeCoordinator.getRuntimeBinding(target.agentId);
							const originSessionId = originBinding?.sessionId;
							const originTitle = originSessionId && originSessionId !== entry.id ? sessionCatalog.get(originSessionId)?.title : undefined;
							try {
								await agentManager.rename(target.agentId, forkedTitle);
								await sessionCatalog.update(entry.id, { title: forkedTitle });
								if (originSessionId && originTitle !== undefined) {
									await sessionCatalog.update(originSessionId, { title: originTitle });
								}
							} catch (error) {
								void appLogger.warn("session", "Rewind fork suffix rename failed", {
									sessionId: entry.id,
									agentId: target.agentId,
									title: entry.title,
									error: error instanceof Error ? error.message : String(error),
								});
							}
						}
					}
				}
			}
			return result;
		});
	});
	ipcMain.handle(ipcChannels.sessionsRuntimePrepareResend, (_event, target: SessionRuntimeTarget, messageId: string) => handleSessionCommandResult(appLogger, "prepareRuntimeResend", target, { messageId }, () => sessionRuntimeCoordinator.prepareRuntimeResend(target, messageId)));
	ipcMain.handle(ipcChannels.sessionsRuntimeSetModel, (_event, target: SessionRuntimeTarget, provider: unknown, modelId: unknown, modelName?: unknown) => {
		if (typeof provider !== "string" || typeof modelId !== "string" || (modelName !== undefined && typeof modelName !== "string") || !provider.trim() || !modelId.trim() || provider.length > 128 || modelId.length > 256 || (typeof modelName === "string" && modelName.length > 256)) {
			return Promise.resolve({
				ok: false as const,
				error: {
					code: "SESSION_COMMAND_FAILED" as const,
					debugDetails: "Invalid model selection",
				},
			});
		}
		return sessionRuntimeCoordinator.setRuntimeModel(target, provider.trim(), modelId.trim(), modelName);
	});
	ipcMain.handle(ipcChannels.sessionsRuntimeSetThinking, (_event, target: SessionRuntimeTarget, level: string) => sessionRuntimeCoordinator.setRuntimeThinking(target, level));

	ipcMain.handle(ipcChannels.sessionsRuntimeClone, (_event, target: SessionRuntimeTarget) => deps.sessionForkCommands.cloneRuntimeSession(target));
	ipcMain.handle(ipcChannels.sessionsRuntimeGetForkMessages, (_event, target: SessionRuntimeTarget) => sessionRuntimeCoordinator.getRuntimeForkMessages(target));
	ipcMain.handle(ipcChannels.sessionsRuntimeFork, (_event, target: SessionRuntimeTarget, entryId: string, options?: { mutationFork?: boolean; branchMode?: boolean }) => deps.sessionForkCommands.forkRuntimeSession(target, entryId, options));
	ipcMain.handle(ipcChannels.codexSessionsScan, async (_event, projectId: string) => {
		const project = projectStore.get(projectId);
		if (!project) throw new Error(`Project not found: ${projectId}`);
		const result = await codexSessionImporter.scan(project.path);
		void appLogger.debug("session", "Codex sessions scanned", { projectId });
		return result;
	});
	ipcMain.handle(ipcChannels.codexSessionsImport, async (_event, projectId: string, sourcePaths: string[]) => {
		const project = projectStore.get(projectId);
		if (!project) throw new Error(`Project not found: ${projectId}`);
		const result = await codexSessionImporter.import(project.path, sourcePaths);
		void appLogger.info("session", "Codex sessions imported", {
			projectId,
			sourceCount: sourcePaths.length,
		});
		return result;
	});
	ipcMain.handle(ipcChannels.claudeSessionsScan, async (_event, projectId: string) => {
		const project = projectStore.get(projectId);
		if (!project) throw new Error(`Project not found: ${projectId}`);
		const result = await claudeSessionImporter.scan(project.path);
		void appLogger.debug("session", "Claude sessions scanned", { projectId });
		return result;
	});
	ipcMain.handle(ipcChannels.claudeSessionsImport, async (_event, projectId: string, sourcePaths: string[]) => {
		const project = projectStore.get(projectId);
		if (!project) throw new Error(`Project not found: ${projectId}`);
		const result = await claudeSessionImporter.import(project.path, sourcePaths);
		void appLogger.info("session", "Claude sessions imported", {
			projectId,
			sourceCount: sourcePaths.length,
		});
		return result;
	});
	ipcMain.handle(ipcChannels.qoderSessionsScan, async (_event, projectId: string) => {
		const project = projectStore.get(projectId);
		if (!project) throw new Error(`Project not found: ${projectId}`);
		const result = await qoderSessionImporter.scan(project.path);
		void appLogger.debug("session", "Qoder sessions scanned", { projectId });
		return result;
	});
	ipcMain.handle(ipcChannels.qoderSessionsImport, async (_event, projectId: string, sourcePaths: string[]) => {
		const project = projectStore.get(projectId);
		if (!project) throw new Error(`Project not found: ${projectId}`);
		const result = await qoderSessionImporter.import(project.path, sourcePaths);
		void appLogger.info("session", "Qoder sessions imported", {
			projectId,
			sourceCount: sourcePaths.length,
		});
		return result;
	});
	ipcMain.handle(ipcChannels.openCodeSessionsScan, async (_event, projectId: string) => {
		const project = projectStore.get(projectId);
		if (!project) throw new Error(`Project not found: ${projectId}`);
		const result = await openCodeSessionImporter.scan(project.path);
		void appLogger.debug("session", "OpenCode sessions scanned", { projectId });
		return result;
	});
	ipcMain.handle(ipcChannels.openCodeSessionsImport, async (_event, projectId: string, sourcePaths: string[]) => {
		const project = projectStore.get(projectId);
		if (!project) throw new Error(`Project not found: ${projectId}`);
		const result = await openCodeSessionImporter.import(project.path, sourcePaths);
		void appLogger.info("session", "OpenCode sessions imported", {
			projectId,
			sourceCount: sourcePaths.length,
		});
		return result;
	});
	ipcMain.handle(ipcChannels.zcodeSessionsScan, async (_event, projectId: string) => {
		const project = projectStore.get(projectId);
		if (!project) throw new Error(`Project not found: ${projectId}`);
		const result = await zcodeSessionImporter.scan(project.path);
		void appLogger.debug("session", "ZCode sessions scanned", { projectId });
		return result;
	});
	ipcMain.handle(ipcChannels.zcodeSessionsImport, async (_event, projectId: string, sourcePaths: string[]) => {
		const project = projectStore.get(projectId);
		if (!project) throw new Error(`Project not found: ${projectId}`);
		const result = await zcodeSessionImporter.import(project.path, sourcePaths);
		void appLogger.info("session", "ZCode sessions imported", {
			projectId,
			sourceCount: sourcePaths.length,
		});
		return result;
	});
	ipcMain.handle(ipcChannels.workbuddySessionsScan, async (_event, projectId: string) => {
		const project = projectStore.get(projectId);
		if (!project) throw new Error(`Project not found: ${projectId}`);
		const result = await workbuddySessionImporter.scan(project.path);
		void appLogger.debug("session", "WorkBuddy sessions scanned", { projectId });
		return result;
	});
	ipcMain.handle(ipcChannels.workbuddySessionsImport, async (_event, projectId: string, sourcePaths: string[]) => {
		const project = projectStore.get(projectId);
		if (!project) throw new Error(`Project not found: ${projectId}`);
		const result = await workbuddySessionImporter.import(project.path, sourcePaths);
		void appLogger.info("session", "WorkBuddy sessions imported", {
			projectId,
			sourceCount: sourcePaths.length,
		});
		return result;
	});
	ipcMain.handle(ipcChannels.cursorSessionsScan, async (_event, projectId: string) => {
		const project = projectStore.get(projectId);
		if (!project) throw new Error(`Project not found: ${projectId}`);
		const result = await cursorSessionImporter.scan(project.path);
		void appLogger.debug("session", "Cursor sessions scanned", { projectId });
		return result;
	});
	ipcMain.handle(ipcChannels.cursorSessionsImport, async (_event, projectId: string, sourcePaths: string[]) => {
		const project = projectStore.get(projectId);
		if (!project) throw new Error(`Project not found: ${projectId}`);
		const result = await cursorSessionImporter.import(project.path, sourcePaths);
		void appLogger.info("session", "Cursor sessions imported", {
			projectId,
			sourceCount: sourcePaths.length,
		});
		return result;
	});
	ipcMain.handle(ipcChannels.kimiSessionsScan, async (_event, projectId: string) => {
		const project = projectStore.get(projectId);
		if (!project) throw new Error(`Project not found: ${projectId}`);
		const result = await kimiSessionImporter.scan(project.path);
		void appLogger.debug("session", "Kimi sessions scanned", { projectId });
		return result;
	});
	ipcMain.handle(ipcChannels.kimiSessionsImport, async (_event, projectId: string, sourcePaths: string[]) => {
		const project = projectStore.get(projectId);
		if (!project) throw new Error(`Project not found: ${projectId}`);
		const result = await kimiSessionImporter.import(project.path, sourcePaths);
		void appLogger.info("session", "Kimi sessions imported", {
			projectId,
			sourceCount: sourcePaths.length,
		});
		return result;
	});

	ipcMain.handle(ipcChannels.kimiWorkSessionsDescribe, async () => {
		const customRoot = settingsStore.get().kimiWorkShareRoot;
		const result = await kimiWorkSessionImporter.describeShareRoot(customRoot);
		void appLogger.debug("session", "Kimi Work share root described", { origin: result.origin });
		return result;
	});
	ipcMain.handle(ipcChannels.kimiWorkSessionsScan, async (_event, projectId: string) => {
		const project = projectStore.get(projectId);
		if (!project) throw new Error(`Project not found: ${projectId}`);
		const customRoot = settingsStore.get().kimiWorkShareRoot;
		const result = await kimiWorkSessionImporter.scan(project.path, customRoot);
		void appLogger.debug("session", "Kimi Work sessions scanned", { projectId, count: result.length });
		return result;
	});
	ipcMain.handle(ipcChannels.kimiWorkSessionsImport, async (_event, projectId: string, sourcePaths: string[]) => {
		const project = projectStore.get(projectId);
		if (!project) throw new Error(`Project not found: ${projectId}`);
		const customRoot = settingsStore.get().kimiWorkShareRoot;
		const result = await kimiWorkSessionImporter.import(project.path, sourcePaths, customRoot);
		void appLogger.info("session", "Kimi Work sessions imported", {
			projectId,
			sourceCount: sourcePaths.length,
			imported: result.imported,
		});
		return result;
	});

	ipcMain.handle(ipcChannels.minimaxSessionsScan, async (_event, projectId: string) => {
		const project = projectStore.get(projectId);
		if (!project) throw new Error(`Project not found: ${projectId}`);
		const result = await minimaxSessionImporter.scan(project.path);
		void appLogger.debug("session", "MinimaxCode sessions scanned", { projectId, count: result.length });
		return result;
	});
	ipcMain.handle(ipcChannels.minimaxSessionsImport, async (_event, projectId: string, sourcePaths: string[]) => {
		const project = projectStore.get(projectId);
		if (!project) throw new Error(`Project not found: ${projectId}`);
		const result = await minimaxSessionImporter.import(project.path, sourcePaths);
		void appLogger.info("session", "MinimaxCode sessions imported", {
			projectId,
			sourceCount: sourcePaths.length,
			imported: result.imported,
		});
		return result;
	});

	ipcMain.handle(ipcChannels.directorySessionsListSources, async () => {
		const sources = await directorySessionImporter.listSourceDirectories();
		void appLogger.debug("session", "Directory session sources listed", { count: sources.length });
		return sources;
	});
	ipcMain.handle(ipcChannels.directorySessionsScan, async (_event, projectId: string, dir: unknown) => {
		const project = projectStore.get(projectId);
		if (!project) throw new Error(`Project not found: ${projectId}`);
		const result = await directorySessionImporter.scan(requireImportDirectory(dir));
		void appLogger.debug("session", "Directory sessions scanned", {
			projectId,
			count: result.sessions.length,

			kind: result.kind,
		});
		return result;
	});
	ipcMain.handle(ipcChannels.directorySessionsImport, async (_event, projectId: string, dir: unknown, sourcePaths: unknown) => {
		const project = projectStore.get(projectId);
		if (!project) throw new Error(`Project not found: ${projectId}`);
		const report = await directorySessionImporter.import(projectId, requireImportDirectory(dir), requireImportSourcePaths(sourcePaths));
		void appLogger.info("session", "Directory sessions imported", {
			projectId,
			imported: report.imported,
			failed: report.failed,
		});
		if (report.imported > 0) {
			const window = getMainWindow();
			if (window && !window.isDestroyed()) {
				window.webContents.send(ipcChannels.sessionsCatalogRefreshed, { projectId });
			}
		}
		return report;
	});
}

function requireImportDirectory(raw: unknown): string {
	if (typeof raw !== "string") throw new Error("Invalid directory path");
	const dir = raw.trim();
	if (!dir || dir.length > 32_768) throw new Error("Invalid directory path");

	if (!isAbsolute(dir) && !/^[A-Za-z]:[\\/]/.test(dir)) throw new Error("Invalid directory path");
	return dir;
}

function requireImportSourcePaths(raw: unknown): string[] {
	if (!Array.isArray(raw)) throw new Error("Invalid source paths");
	if (raw.length > DIRECTORY_IMPORT_MAX_SUMMARIES * 2) throw new Error("Too many source paths");
	return raw.filter((item): item is string => typeof item === "string" && Boolean(item.trim()));
}
