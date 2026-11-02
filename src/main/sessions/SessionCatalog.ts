import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { copyFile, mkdir, open, readFile, unlink } from "node:fs/promises";
import { dirname } from "node:path";
import type { AgentBackend, AgentTab, SessionChannel, SessionEnvironment, SessionModelPreference, SessionRecord, SessionSource, SessionSummary } from "../../shared/types";
import type { SessionProxyOverride } from "../../shared/types/session";
import { getAppLogger } from "../logging/sharedLogger";
import { renameWithRetry } from "../utils/fsRetry";
import {
	buildSessionOriginKey,
	buildSummaryOriginKey,
	canonicalizeSessionPath,
	collectSessionSubtreeIds,
	getImportedSessionSourceId,
	getSessionEnvironment,
	isInSubagentArtifactsDir,
	isUnambiguousAbsoluteSessionPath,
	looksLikeCodexSessionFileStem,
	looksLikePiSessionFileStem,
	looksLikeToolMarkerTitle,
} from "../../shared/sessionIdentity";
import { looksLikeExpandedRefBlockTitle } from "../../shared/expandedRefBlocks";
import { createSessionModelPreference } from "../../shared/modelDisplayName";
import { buildSessionIdAliasMap } from "../../shared/sessionIdAliases";
import { arbitrateRuntimeMergeTitle, isFileSession, mergeSourceGroupInto, repairSessionCatalogIdentities } from "./sessionCatalogIdentityRepair";

export type SessionTitleOrigin = "fallback" | "auto" | "manual" | "legacy";

export type SessionCatalogEntry = {
	id: string;
	projectId: string;
	originKey?: string;
	title: string;

	titleLocked?: boolean;

	titleOrigin?: SessionTitleOrigin;

	noSession?: boolean;
	source: SessionSource;
	environment: SessionEnvironment;

	channel?: SessionChannel;

	sideTask?: boolean;

	backend?: AgentBackend;
	filePath?: string;
	wslDistro?: string;
	wslUser?: string;
	importedSourceId?: string;
	status: "draft" | "active";

	parentSessionPath?: string;

	forked?: boolean;

	supersededBy?: string;

	mergedSessionIds?: string[];
	model?: SessionModelPreference;
	thinkingLevel?: string;
	piSessionId?: string;

	acpSessionId?: string;

	qoderSessionId?: string;
	agentPreset?: string;

	acpToolId?: string;

	proxy?: SessionProxyOverride;

	manualProjectAssignment?: boolean;
	createdAt: number;
	updatedAt: number;
};

type SessionCatalogFile = {
	version: 1;
	sessions: SessionCatalogEntry[];
};

type SessionCatalogContext = {
	wslDistro?: string;
	wslUser?: string;
};

export type SessionFilePathResolver = (projectId: string, filePath: string, environment: SessionEnvironment) => string;

export type SessionTitleFetchResult = { name?: string; nameFromSessionInfo?: boolean; valid?: boolean; parentSessionPath?: string; forked?: boolean; fallbackName?: string; firstUserText?: string };

type ScannedTitleFetch = { name: string; fromSessionInfo: boolean; fallbackName?: string };

type LegacyTitleProbe = { authoritative?: string; fallback?: string; firstUserText?: string };

export type SessionTitleFetchOptions = {
	includeTitle?: boolean;

	includeFirstUserText?: boolean;
};

export type SessionTitleFetcher = (filePath: string, options?: SessionTitleFetchOptions) => Promise<SessionTitleFetchResult>;

function scannedFileStemTitle(filePath: string): string {
	const normalized = filePath.replace(/\\/g, "/");
	const base = normalized.slice(normalized.lastIndexOf("/") + 1);
	const stem = base.replace(/\.jsonl$/i, "").trim();
	if (!stem || looksLikePiSessionFileStem(stem)) return "Untitled";
	return stem;
}

function findExistingAncestorDir(filePath: string, maxDepth = 6): string | undefined {
	let dir = dirname(filePath);
	for (let depth = 0; depth < maxDepth; depth += 1) {
		if (existsSync(dir)) return dir;
		const parent = dirname(dir);
		if (parent === dir) return undefined;
		dir = parent;
	}
	return undefined;
}

function catalogDisplayTitle(title: string | undefined): string | undefined {
	if (!title) return undefined;

	if (looksLikePiSessionFileStem(title) || looksLikeToolMarkerTitle(title)) return undefined;
	return title;
}

function isPlaceholderCatalogTitle(title: string | undefined): boolean {
	if (!title) return true;
	if (looksLikePiSessionFileStem(title)) return true;

	if (looksLikeToolMarkerTitle(title)) return true;

	if (looksLikeExpandedRefBlockTitle(title)) return true;
	return /^(?:untitled(?: session)?|new session|新会话)$/i.test(title);
}

function resolveTitleOrigin(entry: Pick<SessionCatalogEntry, "title" | "titleLocked" | "titleOrigin">): SessionTitleOrigin | undefined {
	if (looksLikeToolMarkerTitle(entry.title)) return undefined;
	if (entry.titleOrigin === "fallback" || entry.titleOrigin === "auto" || entry.titleOrigin === "manual" || entry.titleOrigin === "legacy") return entry.titleOrigin;
	if (entry.titleLocked === false) return undefined;

	if (entry.titleLocked === true) return "legacy";
	return isPlaceholderCatalogTitle(entry.title) ? undefined : "legacy";
}

function isTitleLocked(entry: Pick<SessionCatalogEntry, "title" | "titleLocked" | "titleOrigin">): boolean {
	if (looksLikeCodexSessionFileStem(entry.title)) return false;
	return resolveTitleOrigin(entry) !== undefined;
}

function assignTitleOrigin(entry: SessionCatalogEntry, origin: SessionTitleOrigin | undefined): void {
	if (origin) {
		entry.titleOrigin = origin;
		entry.titleLocked = true;
		return;
	}
	delete entry.titleOrigin;
	entry.titleLocked = false;
}

function repairedLegacyFallbackTitle(entry: Pick<SessionCatalogEntry, "title">, probe: { authoritative?: string; fallback?: string; firstUserText?: string }): string | undefined {
	const authoritative = catalogDisplayTitle(probe.authoritative);
	if (!authoritative) return undefined;
	const title = normalizeFingerprintTitle(entry.title);
	if (!title) return undefined;
	const candidates = [probe.fallback, probe.firstUserText].map(normalizeFingerprintTitle).filter(Boolean);
	if (!candidates.some((candidate) => candidate === title)) return undefined;
	if (authoritative === entry.title) return undefined;
	return authoritative;
}

function normalizeFingerprintTitle(value: string | undefined): string {
	return (value ?? "").replace(/\s+/g, " ").trim();
}

function claimAutomaticTitle(entry: SessionCatalogEntry, nextTitle: string, source: "auto" | "fallback"): boolean {
	const origin = resolveTitleOrigin(entry);
	if (source === "fallback" ? origin !== undefined : origin !== undefined && origin !== "fallback") return false;
	entry.title = nextTitle;
	assignTitleOrigin(entry, source);
	return true;
}

function scannedTitleOrigin(title: string, authoritative: boolean): SessionTitleOrigin | undefined {
	if (isPlaceholderCatalogTitle(title) || looksLikeCodexSessionFileStem(title)) return undefined;
	return authoritative ? "manual" : "fallback";
}

function cloneModelPreference(model: SessionModelPreference | undefined): SessionModelPreference | undefined {
	return model ? createSessionModelPreference(model.provider, model.modelId, model.modelName) : undefined;
}

function cloneEntry(entry: SessionCatalogEntry): SessionCatalogEntry {
	return {
		...entry,
		model: cloneModelPreference(entry.model),
	};
}

function equalModel(left?: SessionModelPreference, right?: SessionModelPreference): boolean {
	return left?.provider === right?.provider && left?.modelId === right?.modelId;
}

function isMissingFileError(error: unknown): boolean {
	return Boolean(error && typeof error === "object" && "code" in error && (error as { code?: unknown }).code === "ENOENT");
}

export function canAttachRuntimeMetadata(entry: SessionCatalogEntry | undefined, tab: Partial<AgentTab>): boolean {
	if (!entry || !tab.sessionPath) return false;
	if (entry.status === "draft" && !entry.filePath) return true;
	if (!entry.filePath) return false;
	const environment = tab.sessionEnvironment ?? entry.environment;
	return (
		buildSessionOriginKey({
			source: entry.source,
			environment: entry.environment,
			filePath: entry.filePath,
			wslDistro: entry.wslDistro,
			wslUser: entry.wslUser,
			importedSourceId: entry.importedSourceId,
		}) ===
		buildSessionOriginKey({
			source: tab.sessionSource ?? entry.source,
			environment,
			filePath: tab.sessionPath,
			wslDistro: tab.wslDistro ?? entry.wslDistro,
			wslUser: tab.wslUser ?? entry.wslUser,
			importedSourceId: tab.importedSourceId ?? entry.importedSourceId,
		})
	);
}

const SUPPORTED_RUNTIME_BACKENDS: ReadonlySet<string> = new Set(["pi", "imagegen", "videogen", "acp", "qoder"]);

function filterSupportedBackendEntries(entries: SessionCatalogEntry[]): SessionCatalogEntry[] {
	return entries.filter((entry) => entry.backend === undefined || SUPPORTED_RUNTIME_BACKENDS.has(entry.backend));
}

export class SessionCatalog {
	private entries: SessionCatalogEntry[] = [];

	private mergedIdAliases = new Map<string, string>();

	private transientEntries = new Map<string, SessionCatalogEntry>();
	private loaded = false;
	private writeQueue: Promise<void> = Promise.resolve();
	private skipNextBackup = false;

	private identityContext: SessionCatalogContext;

	private sessionLivenessProbe?: (sessionId: string) => boolean;

	constructor(
		private readonly filePath: string,
		identityContext: SessionCatalogContext = {},
		private readonly resolveFilePath?: SessionFilePathResolver,
		private readonly fetchTitle?: SessionTitleFetcher,
	) {
		this.identityContext = { ...identityContext };
	}

	setIdentityContext(context: SessionCatalogContext): void {
		this.identityContext = { ...context };
	}

	setSessionLivenessProbe(probe: ((sessionId: string) => boolean) | undefined): void {
		this.sessionLivenessProbe = probe;
	}

	async load(): Promise<void> {
		if (this.loaded) return;
		let primaryError: unknown;
		try {
			const snapshot = await this.readCatalogFile(this.filePath);
			this.entries = filterSupportedBackendEntries(snapshot.entries);
		} catch (error) {
			primaryError = error;
			try {
				const snapshot = await this.readCatalogFile(this.backupFilePath());
				this.entries = filterSupportedBackendEntries(snapshot.entries);
				this.skipNextBackup = true;
			} catch (backupError) {
				if (isMissingFileError(primaryError) && isMissingFileError(backupError)) {
					this.entries = [];
				} else {
					void getAppLogger()?.error("session-catalog", "Catalog and backup both failed to load", {
						primary: primaryError instanceof Error ? primaryError.message : String(primaryError),
						backup: backupError instanceof Error ? backupError.message : String(backupError),
					});
					this.entries = [];
				}
			}
		}

		const staleDrafts = this.entries.filter((entry) => entry.status === "draft" && entry.backend !== "acp" && entry.backend !== "qoder");
		if (staleDrafts.length > 0) {
			this.entries = this.entries.filter((entry) => entry.status !== "draft" || entry.backend === "acp" || entry.backend === "qoder");
			try {
				await this.writeSnapshot(this.entries);
			} catch {}
		}

		const timestampTitles = this.entries.filter((entry) => looksLikePiSessionFileStem(entry.title));
		if (timestampTitles.length > 0) {
			for (const entry of timestampTitles) entry.title = "Untitled";
			try {
				await this.writeSnapshot(this.entries);
			} catch {}
		}

		const missingTitleOwnership = this.entries.filter((entry) => typeof entry.titleLocked !== "boolean" || (entry.titleOrigin === undefined && entry.titleLocked === true));
		if (missingTitleOwnership.length > 0) {
			for (const entry of missingTitleOwnership) {
				if (typeof entry.titleLocked !== "boolean") entry.titleLocked = !isPlaceholderCatalogTitle(entry.title);
				if (entry.titleOrigin === undefined && entry.titleLocked === true) entry.titleOrigin = "legacy";
			}
			try {
				await this.writeSnapshot(this.entries);
			} catch {}
		}

		const repaired = await repairSessionCatalogIdentities(this.entries, this.resolveFilePath, (entry) => this.originKeyForEntry(entry), this.fetchTitle);
		if (repaired) {
			this.entries = repaired;
			try {
				await this.writeSnapshot(this.entries);
			} catch (error) {
				void getAppLogger()?.warn("session-catalog", "Identity repair snapshot write failed on startup", {
					cause: error instanceof Error ? error.message : String(error),
				});
			}
		}

		this.mergedIdAliases = buildSessionIdAliasMap(this.entries);
		this.loaded = true;
	}

	resolveSessionId(id: string): string {
		this.assertLoaded();
		return this.mergedIdAliases.get(id) ?? id;
	}

	private rebuildMergedIdAliases(): void {
		this.mergedIdAliases = buildSessionIdAliasMap(this.entries);
		this.loaded = true;
	}

	get(id: string): SessionCatalogEntry | undefined {
		this.assertLoaded();
		const transient = this.transientEntries.get(id);
		if (transient) return cloneEntry(transient);
		const entry = this.entries.find((candidate) => candidate.id === id);
		return entry ? cloneEntry(entry) : undefined;
	}

	listEntries(): SessionCatalogEntry[] {
		this.assertLoaded();
		return [...this.entries, ...this.transientEntries.values()].map(cloneEntry);
	}

	createAnonymous(input: { projectId: string; title: string; environment: SessionEnvironment; model?: SessionModelPreference; thinkingLevel?: string }): SessionRecord {
		this.assertLoaded();
		const now = Date.now();
		const entry: SessionCatalogEntry = {
			id: randomUUID(),
			projectId: input.projectId,
			title: input.title,
			titleLocked: true,
			titleOrigin: "manual",
			noSession: true,
			source: "pi",
			environment: input.environment,
			wslDistro: input.environment === "wsl" ? this.identityContext.wslDistro : undefined,
			wslUser: input.environment === "wsl" ? this.identityContext.wslUser : undefined,
			status: "active",
			model: cloneModelPreference(input.model),
			thinkingLevel: input.thinkingLevel,
			createdAt: now,
			updatedAt: now,
		};
		this.transientEntries.set(entry.id, entry);
		return this.recordFromEntry(entry);
	}

	removeTransient(id: string): boolean {
		this.assertLoaded();
		return this.transientEntries.delete(id);
	}

	getRecord(id: string): SessionRecord | undefined {
		const entry = this.get(id);
		return entry ? this.recordFromEntry(entry) : undefined;
	}

	findByFilePath(filePath: string, environment: SessionEnvironment): SessionCatalogEntry | undefined {
		this.assertLoaded();
		const target = canonicalizeSessionPath(filePath, environment);
		const entry = this.entries.find((candidate) => candidate.filePath && candidate.environment === environment && canonicalizeSessionPath(candidate.filePath, environment) === target);
		return entry ? cloneEntry(entry) : undefined;
	}

	async ensureRuntimeTarget(input: {
		projectId: string;
		title: string;
		source: SessionSource;
		environment: SessionEnvironment;
		filePath: string;
		wslDistro?: string;
		wslUser?: string;
		importedSourceId?: string;
		piSessionId?: string;

		channel?: SessionChannel;

		titleAuthority?: "command";

		forked?: boolean;

		model?: SessionModelPreference;
		thinkingLevel?: string;
	}): Promise<SessionCatalogEntry> {
		this.assertLoaded();

		const filePath = this.resolveFilePath ? this.resolveFilePath(input.projectId, input.filePath, input.environment) : input.filePath;
		return this.enqueueMutation((entries) => {
			const originKey = buildSessionOriginKey({
				source: input.source,
				environment: input.environment,
				filePath,
				wslDistro: input.wslDistro,
				wslUser: input.wslUser,
				importedSourceId: input.importedSourceId,
			});
			let entry = entries.find((candidate) => {
				if (candidate.originKey === originKey) return true;
				if (!candidate.filePath) return false;
				return (
					buildSessionOriginKey({
						source: candidate.source,
						environment: candidate.environment,
						filePath: candidate.filePath,
						wslDistro: candidate.wslDistro,
						wslUser: candidate.wslUser,
						importedSourceId: candidate.importedSourceId,
					}) === originKey
				);
			});
			const now = Date.now();
			if (!entry) {
				entry = {
					id: randomUUID(),
					projectId: input.projectId,
					originKey,
					title: input.title,
					titleLocked: true,
					titleOrigin: "manual",
					source: input.source,
					environment: input.environment,
					filePath,
					wslDistro: input.wslDistro,
					wslUser: input.wslUser,
					importedSourceId: input.importedSourceId,
					piSessionId: input.piSessionId,
					channel: input.channel,
					forked: input.forked,
					model: cloneModelPreference(input.model),
					thinkingLevel: input.thinkingLevel,
					status: "active",
					createdAt: now,
					updatedAt: now,
				};
				entries.push(entry);
			} else {
				entry.projectId = input.projectId;
				entry.originKey = originKey;
				entry.source = input.source;
				entry.environment = input.environment;
				entry.filePath = filePath;
				entry.wslDistro = input.wslDistro;
				entry.wslUser = input.wslUser;
				entry.importedSourceId = input.importedSourceId;
				entry.piSessionId = input.piSessionId;

				if (input.channel) entry.channel = input.channel;

				if (input.titleAuthority === "command") {
					const commandTitle = catalogDisplayTitle(input.title);
					const currentOrigin = resolveTitleOrigin(entry);
					if (commandTitle && !isPlaceholderCatalogTitle(commandTitle) && commandTitle !== entry.title && (currentOrigin === undefined || currentOrigin === "fallback")) {
						entry.title = commandTitle;
						assignTitleOrigin(entry, "manual");
					}
				}

				if (input.forked) entry.forked = true;

				if (!entry.model && input.model) entry.model = cloneModelPreference(input.model);
				if (!entry.thinkingLevel && input.thinkingLevel) entry.thinkingLevel = input.thinkingLevel;
				entry.status = "active";
				entry.updatedAt = now;
			}
			return { value: cloneEntry(entry), changed: true };
		});
	}

	async createDraft(input: {
		projectId: string;
		title: string;
		environment: SessionEnvironment;
		source?: SessionSource;
		backend?: AgentBackend;
		model?: SessionModelPreference;
		thinkingLevel?: string;

		titleOrigin?: SessionTitleOrigin;
		agentPreset?: string;

		acpToolId?: string;

		channel?: SessionChannel;

		sideTask?: boolean;

		forked?: boolean;

		updatedAt?: number;

		keepExistingTitle?: boolean;

		restoreDismissed?: boolean;
	}): Promise<SessionRecord> {
		this.assertLoaded();
		const entry = await this.enqueueMutation((entries) => {
			const now = Date.now();
			const nextTitle = input.title;
			const nextEntry: SessionCatalogEntry = {
				id: randomUUID(),
				projectId: input.projectId,
				title: input.title,
				titleLocked: input.titleOrigin !== undefined,
				titleOrigin: input.titleOrigin,
				source: input.source ?? "pi",
				environment: input.environment,
				channel: input.channel,

				sideTask: input.sideTask ? true : undefined,
				forked: input.forked ? true : undefined,
				backend: input.backend,
				wslDistro: input.environment === "wsl" ? this.identityContext.wslDistro : undefined,
				wslUser: input.environment === "wsl" ? this.identityContext.wslUser : undefined,
				status: "draft",
				model: cloneModelPreference(input.model),
				thinkingLevel: input.thinkingLevel,
				agentPreset: input.agentPreset,
				acpToolId: input.acpToolId,
				createdAt: now,

				updatedAt: input.updatedAt ?? now,
			};
			entries.push(nextEntry);
			return { value: cloneEntry(nextEntry), changed: true };
		});
		return this.recordFromEntry(entry);
	}

	async update(
		id: string,
		patch: Partial<Pick<SessionCatalogEntry, "title" | "backend" | "updatedAt">> & {
			model?: SessionModelPreference | null;
			thinkingLevel?: string | null;
			agentPreset?: string | null;

			acpToolId?: string | null;

			acpSessionId?: string | null;

			qoderSessionId?: string | null;
			proxy?: SessionProxyOverride | null;

			filePath?: string | null;
			piSessionId?: string | null;

			forked?: boolean | null;

			sideTask?: boolean | null;
		},
	): Promise<SessionRecord> {
		this.assertLoaded();
		const sessionId = this.resolveSessionId(id);
		const transient = this.transientEntries.get(sessionId);
		if (transient) {
			if (patch.title !== undefined) {
				transient.title = patch.title;
				assignTitleOrigin(transient, "manual");
			}
			if (patch.model !== undefined) transient.model = cloneModelPreference(patch.model ?? undefined);
			if (patch.thinkingLevel !== undefined) transient.thinkingLevel = patch.thinkingLevel ?? undefined;
			if (patch.agentPreset !== undefined) transient.agentPreset = patch.agentPreset ?? undefined;
			if (patch.acpToolId !== undefined) transient.acpToolId = patch.acpToolId ?? undefined;
			if (patch.backend !== undefined) transient.backend = patch.backend;

			if (patch.filePath !== undefined) transient.filePath = patch.filePath ?? undefined;
			if (patch.piSessionId !== undefined) transient.piSessionId = patch.piSessionId ?? undefined;
			if (patch.forked === true) transient.forked = true;
			if (patch.sideTask !== undefined) transient.sideTask = patch.sideTask ? true : undefined;

			if (patch.proxy !== undefined) transient.proxy = patch.proxy ?? undefined;
			transient.updatedAt = patch.updatedAt ?? Date.now();
			return this.recordFromEntry(transient);
		}
		const entry = await this.enqueueMutation((entries) => {
			const nextEntry = this.requireEntry(entries, sessionId);
			if (patch.title !== undefined) {
				nextEntry.title = patch.title;
				assignTitleOrigin(nextEntry, "manual");
			}
			if (patch.model !== undefined) nextEntry.model = cloneModelPreference(patch.model ?? undefined);
			if (patch.thinkingLevel !== undefined) nextEntry.thinkingLevel = patch.thinkingLevel ?? undefined;
			if (patch.agentPreset !== undefined) nextEntry.agentPreset = patch.agentPreset ?? undefined;
			if (patch.acpToolId !== undefined) nextEntry.acpToolId = patch.acpToolId ?? undefined;
			if (patch.acpSessionId !== undefined) nextEntry.acpSessionId = patch.acpSessionId ?? undefined;
			if (patch.qoderSessionId !== undefined) nextEntry.qoderSessionId = patch.qoderSessionId ?? undefined;
			if (patch.backend !== undefined) nextEntry.backend = patch.backend;
			if (patch.filePath !== undefined) nextEntry.filePath = patch.filePath ?? undefined;
			if (patch.piSessionId !== undefined) nextEntry.piSessionId = patch.piSessionId ?? undefined;
			if (patch.forked === true) nextEntry.forked = true;
			if (patch.sideTask !== undefined) nextEntry.sideTask = patch.sideTask ? true : undefined;

			if (patch.proxy !== undefined) nextEntry.proxy = patch.proxy ?? undefined;
			nextEntry.updatedAt = patch.updatedAt ?? Date.now();
			return { value: cloneEntry(nextEntry), changed: true };
		});
		return this.recordFromEntry(entry);
	}

	async applyAutomaticTitle(id: string, title: string, source: "auto" | "fallback"): Promise<SessionRecord> {
		this.assertLoaded();
		const nextTitle = title.replace(/\s+/g, " ").trim();
		if (!nextTitle) throw new Error("Automatic session title is required");
		const sessionId = this.resolveSessionId(id);
		const transient = this.transientEntries.get(sessionId);
		if (transient) {
			if (claimAutomaticTitle(transient, nextTitle, source)) transient.updatedAt = Date.now();
			return this.recordFromEntry(transient);
		}
		const entry = await this.enqueueMutation((entries) => {
			const nextEntry = this.requireEntry(entries, sessionId);
			const claimed = claimAutomaticTitle(nextEntry, nextTitle, source);
			if (claimed) nextEntry.updatedAt = Date.now();
			return { value: cloneEntry(nextEntry), changed: claimed };
		});
		return this.recordFromEntry(entry);
	}

	async applyAgentTitle(id: string, title: string): Promise<SessionRecord | undefined> {
		this.assertLoaded();
		const nextTitle = title.replace(/\s+/g, " ").trim();
		if (!nextTitle || looksLikeToolMarkerTitle(nextTitle)) return undefined;
		const sessionId = this.resolveSessionId(id);
		const transient = this.transientEntries.get(sessionId);
		if (transient) {
			if (resolveTitleOrigin(transient) === "manual" || transient.title === nextTitle) return undefined;
			transient.title = nextTitle;
			assignTitleOrigin(transient, "auto");
			transient.updatedAt = Date.now();
			return this.recordFromEntry(transient);
		}
		let claimed = false;
		const entry = await this.enqueueMutation((entries) => {
			const nextEntry = this.requireEntry(entries, sessionId);
			if (resolveTitleOrigin(nextEntry) === "manual" || nextEntry.title === nextTitle) return { value: cloneEntry(nextEntry), changed: false };
			nextEntry.title = nextTitle;
			assignTitleOrigin(nextEntry, "auto");
			nextEntry.updatedAt = Date.now();
			claimed = true;
			return { value: cloneEntry(nextEntry), changed: true };
		});
		return claimed ? this.recordFromEntry(entry) : undefined;
	}

	async claimTitleOwnership(id: string): Promise<SessionRecord> {
		this.assertLoaded();
		const sessionId = this.resolveSessionId(id);
		const transient = this.transientEntries.get(sessionId);
		if (transient) {
			if (!isTitleLocked(transient)) {
				assignTitleOrigin(transient, "manual");
				transient.updatedAt = Date.now();
			}
			return this.recordFromEntry(transient);
		}
		const entry = await this.enqueueMutation((entries) => {
			const nextEntry = this.requireEntry(entries, sessionId);
			if (isTitleLocked(nextEntry)) return { value: cloneEntry(nextEntry), changed: false };
			assignTitleOrigin(nextEntry, "manual");
			nextEntry.updatedAt = Date.now();
			return { value: cloneEntry(nextEntry), changed: true };
		});
		return this.recordFromEntry(entry);
	}

	async attachRuntime(input: {
		sessionId: string;
		filePath?: string;
		piSessionId?: string;

		acpSessionId?: string;

		qoderSessionId?: string;
		agentPreset?: string;
		promoteToActive?: boolean;

		restoreDismissed?: boolean;
	}): Promise<SessionCatalogEntry> {
		this.assertLoaded();
		return this.enqueueMutation(async (entries) => {
			let entry = this.requireEntry(entries, this.resolveSessionId(input.sessionId));

			const before = {
				filePath: entry.filePath,
				piSessionId: entry.piSessionId,
				acpSessionId: entry.acpSessionId,
				qoderSessionId: entry.qoderSessionId,
				agentPreset: entry.agentPreset,
				status: entry.status,
				originKey: entry.originKey,
				createdAt: entry.createdAt,
				model: entry.model,
				thinkingLevel: entry.thinkingLevel,
				importedSourceId: entry.importedSourceId,
			};

			const filePath = input.filePath && this.resolveFilePath ? this.resolveFilePath(entry.projectId, input.filePath, entry.environment) : input.filePath;

			if (filePath && entry.backend !== "acp" && entry.backend !== "qoder") entry.filePath = filePath;
			if (input.piSessionId) entry.piSessionId = input.piSessionId;
			if (input.acpSessionId) entry.acpSessionId = input.acpSessionId;
			if (input.qoderSessionId) entry.qoderSessionId = input.qoderSessionId;
			let restoredDismissed = false;

			if (input.agentPreset !== undefined) entry.agentPreset = input.agentPreset;

			if (input.promoteToActive && input.acpSessionId && entry.status === "draft") {
				entry.status = "active";
			}
			if (input.promoteToActive && input.qoderSessionId && entry.status === "draft") {
				entry.status = "active";
			}
			let mergedDuplicate = false;
			if (entry.filePath) {
				const nextOriginKey = this.confirmedOriginKey(entry);

				const group = nextOriginKey ? [entry, ...entries.filter((candidate) => candidate.id !== entry.id && this.confirmedOriginKey(candidate) === nextOriginKey)] : [];
				let canMerge = Boolean(nextOriginKey);
				let titleOwner: SessionCatalogEntry | undefined;
				if (group.length > 1) {
					const arbitration = await arbitrateRuntimeMergeTitle(group, this.fetchTitle);
					canMerge = arbitration.merge;
					titleOwner = arbitration.titleOwner;
				}
				entry.status = "active";
				if (canMerge && nextOriginKey) {
					entry.originKey = nextOriginKey;
					if (group.length > 1) {
						const absorbedIds = new Set(group.filter((candidate) => candidate.id !== entry.id).map((candidate) => candidate.id));
						const merged = mergeSourceGroupInto(entry.id, group, titleOwner);
						const survivorIndex = entries.findIndex((candidate) => candidate.id === entry.id);
						entries[survivorIndex] = merged;
						entry = merged;
						for (let index = entries.length - 1; index >= 0; index -= 1) {
							if (absorbedIds.has(entries[index].id)) entries.splice(index, 1);
						}
						mergedDuplicate = true;
					}
				}
			}

			const touched =
				restoredDismissed ||
				mergedDuplicate ||
				canonicalizeSessionPath(before.filePath ?? "", entry.environment) !== canonicalizeSessionPath(entry.filePath ?? "", entry.environment) ||
				before.piSessionId !== entry.piSessionId ||
				before.acpSessionId !== entry.acpSessionId ||
				before.qoderSessionId !== entry.qoderSessionId ||
				before.agentPreset !== entry.agentPreset ||
				before.status !== entry.status ||
				before.originKey !== entry.originKey ||
				before.createdAt !== entry.createdAt ||
				before.model !== entry.model ||
				before.thinkingLevel !== entry.thinkingLevel ||
				before.importedSourceId !== entry.importedSourceId;

			if (!touched) return { value: cloneEntry(entry), changed: false };
			entry.updatedAt = Date.now();
			return { value: cloneEntry(entry), changed: true };
		});
	}

	async remove(id: string): Promise<boolean> {
		this.assertLoaded();
		const requestedId = this.resolveSessionId(id);
		if (this.transientEntries.delete(requestedId)) return true;
		return this.enqueueMutation((entries) => {
			const entry = this.findEntryInTransaction(entries, requestedId);
			if (!entry) return { value: false, changed: false };
			entries.splice(entries.indexOf(entry), 1);
			return { value: true, changed: true };
		});
	}

	async removeWithDescendants(id: string): Promise<string[]> {
		this.assertLoaded();
		const requestedId = this.resolveSessionId(id);
		const parent = this.transientEntries.get(requestedId) ?? this.entries.find((entry) => entry.id === requestedId);
		if (!parent) return [];
		const projectEntries = this.listEntries().filter((entry) => entry.projectId === parent.projectId);
		const ids = collectSessionSubtreeIds(projectEntries, parent);

		const removed: string[] = [];
		for (const sessionId of ids) {
			if (this.transientEntries.delete(sessionId)) removed.push(sessionId);
		}
		const persistedIds = ids.filter((sessionId) => !removed.includes(sessionId));
		if (persistedIds.length === 0) return removed;

		const persistedRemoved = await this.enqueueMutation((entries) => {
			const idSet = new Set(persistedIds.map((sessionId) => this.canonicalIdInTransaction(sessionId)));
			const next = entries.filter((entry) => !idSet.has(entry.id));
			const actuallyRemoved = entries.filter((entry) => idSet.has(entry.id)).map((entry) => entry.id);
			if (actuallyRemoved.length === 0) return { value: [] as string[], changed: false };
			entries.splice(0, entries.length, ...next);
			return { value: actuallyRemoved, changed: true };
		});
		return [...removed, ...persistedRemoved];
	}

	async promoteToActive(sessionId: string): Promise<SessionRecord | undefined> {
		this.assertLoaded();
		const requestedId = this.resolveSessionId(sessionId);
		const transient = this.transientEntries.get(requestedId);
		if (transient) {
			if (transient.status === "draft") transient.status = "active";
			transient.updatedAt = Date.now();
			return this.recordFromEntry(transient);
		}
		const entry = await this.enqueueMutation((entries) => {
			const nextEntry = this.requireEntry(entries, requestedId);
			if (nextEntry.status === "draft") nextEntry.status = "active";
			nextEntry.updatedAt = Date.now();
			return { value: cloneEntry(nextEntry), changed: true };
		});
		return this.recordFromEntry(entry);
	}

	async removeByProjectId(projectId: string): Promise<number> {
		this.assertLoaded();
		for (const [id, entry] of this.transientEntries) {
			if (entry.projectId === projectId) this.transientEntries.delete(id);
		}
		return this.enqueueMutation((entries) => {
			const next = entries.filter((entry) => entry.projectId !== projectId);
			const removed = entries.length - next.length;
			if (removed === 0) return { value: 0, changed: false };
			entries.splice(0, entries.length, ...next);
			return { value: removed, changed: true };
		});
	}

	async removeByFilePath(filePath: string, environment: SessionEnvironment): Promise<boolean> {
		this.assertLoaded();
		const target = canonicalizeSessionPath(filePath, environment);
		return this.enqueueMutation((entries) => {
			const index = entries.findIndex((entry) => entry.filePath && entry.environment === environment && canonicalizeSessionPath(entry.filePath, environment) === target);
			if (index < 0) return { value: false, changed: false };
			entries.splice(index, 1);
			return { value: true, changed: true };
		});
	}

	async mergeScanned(
		projectId: string,
		summaries: SessionSummary[],
		context: SessionCatalogContext = this.identityContext,
		options: {
			manualAssignment?: boolean;
		} = {},
	): Promise<SessionRecord[]> {
		this.assertLoaded();

		const { titles: fetchedTitles, legacyProbes: fetchedLegacyProbes, invalid: invalidOrigins, parents: fetchedParents, forked: fetchedForked } = await this.collectScannedTitles(summaries, context);

		const externallyMissingIds = new Set<string>();
		for (const entry of this.entries) {
			if (entry.projectId !== projectId) continue;
			if (entry.source !== "pi") continue;
			if (entry.environment !== "native") continue;
			if (!entry.filePath) continue;

			if (this.sessionLivenessProbe?.(entry.id)) continue;
			if (existsSync(entry.filePath)) continue;
			if (!findExistingAncestorDir(entry.filePath)) continue;
			externallyMissingIds.add(entry.id);
		}

		return this.enqueueMutation((entries) => {
			let changed = false;

			if (externallyMissingIds.size > 0) {
				for (let index = entries.length - 1; index >= 0; index -= 1) {
					if (!externallyMissingIds.has(entries[index]!.id)) continue;
					entries.splice(index, 1);
					changed = true;
				}
			}

			for (let index = entries.length - 1; index >= 0; index -= 1) {
				const entry = entries[index]!;
				if (entry.source !== "pi" || !entry.filePath) continue;
				if (!isInSubagentArtifactsDir(entry.filePath)) continue;
				entries.splice(index, 1);
				changed = true;
			}

			if (invalidOrigins.size > 0) {
				for (let index = entries.length - 1; index >= 0; index -= 1) {
					const entry = entries[index]!;
					if (entry.source !== "pi") continue;
					if (!entry.originKey || !invalidOrigins.has(entry.originKey)) continue;
					entries.splice(index, 1);
					changed = true;
				}
			}

			const acceptedSummaries = summaries.filter((summary) => {
				if (summary.source === "pi" && isInSubagentArtifactsDir(summary.filePath)) return false;
				if (invalidOrigins.has(buildSummaryOriginKey(summary, context))) return false;
				return true;
			});

			const byOrigin = new Map(entries.filter((entry) => entry.originKey).map((entry) => [entry.originKey!, entry]));
			const summaryById = new Map<string, SessionSummary>();

			function inheritSessionMeta(entry: SessionCatalogEntry, summary: SessionSummary) {
				if (!entry.model && summary.model) {
					entry.model = createSessionModelPreference(summary.model.provider, summary.model.modelId, undefined);
					changed = true;
				}
				if (!entry.thinkingLevel && summary.thinkingLevel) {
					entry.thinkingLevel = summary.thinkingLevel;
					changed = true;
				}
			}

			for (const summary of acceptedSummaries) {
				const originKey = buildSummaryOriginKey(summary, context);

				const summaryTitle = catalogDisplayTitle(summary.name);
				const fetched = fetchedTitles.get(originKey);
				const fetchedTitle = catalogDisplayTitle(fetched?.name);
				const initialAuthoritative = summaryTitle ? summary.nameFromSessionInfo !== false : fetched?.fromSessionInfo === true;

				const fetchedParent = fetchedParents.get(originKey);

				const fetchedForkedFlag = fetchedForked.get(originKey);
				const importedSourceId = getImportedSessionSourceId(summary);
				let entry = byOrigin.get(originKey);
				if (!entry) {
					const now = summary.updatedAt || Date.now();
					const initialTitle = summaryTitle || fetchedTitle || scannedFileStemTitle(summary.filePath);
					const initialOrigin = scannedTitleOrigin(initialTitle, initialAuthoritative);
					entry = {
						id: randomUUID(),
						projectId,
						originKey,

						title: initialTitle,
						titleLocked: initialOrigin !== undefined,
						titleOrigin: initialOrigin,
						source: summary.source ?? "pi",
						environment: getSessionEnvironment(summary),
						filePath: summary.filePath,
						wslDistro: summary.wsl ? context.wslDistro : undefined,
						wslUser: summary.wsl ? context.wslUser : undefined,
						importedSourceId,
						status: "active",
						parentSessionPath: summary.parentSessionPath ?? fetchedParent,
						forked: (summary.parentSessionPath ?? fetchedParent) ? undefined : fetchedForkedFlag,
						createdAt: now,
						updatedAt: now,
					};
					entries.push(entry);
					byOrigin.set(originKey, entry);
					changed = true;
					if (options?.manualAssignment) entry.manualProjectAssignment = true;
				} else {
					const canInitializeTitle = !isTitleLocked(entry);
					const initialTitle = summaryTitle || fetchedTitle;

					const authoritativeUpgrade = initialAuthoritative && resolveTitleOrigin(entry) === "fallback";
					const canAbsorbTitle = canInitializeTitle || authoritativeUpgrade;

					const legacyProbe = fetchedLegacyProbes.get(originKey);
					const legacyRepair = legacyProbe ? repairedLegacyFallbackTitle(entry, summaryTitle && summary.nameFromSessionInfo === true ? { ...legacyProbe, authoritative: summaryTitle } : legacyProbe) : undefined;
					const nextTitle = legacyRepair || (canAbsorbTitle ? initialTitle : undefined) || catalogDisplayTitle(entry.title) || scannedFileStemTitle(summary.filePath);

					const nextOrigin = legacyProbe ? "manual" : ((canAbsorbTitle && initialTitle ? scannedTitleOrigin(nextTitle, initialAuthoritative) : undefined) ?? resolveTitleOrigin(entry));
					const nextTitleLocked = nextOrigin !== undefined;

					const nextParent = summary.parentSessionPath ?? fetchedParent ?? entry.parentSessionPath;

					const nextForked = nextParent ? entry.forked : fetchedForkedFlag || entry.forked;

					const nextProjectId = entry.manualProjectAssignment && !options?.manualAssignment && entry.projectId !== projectId ? entry.projectId : projectId;

					const nextUpdatedAt = Math.max(entry.updatedAt, summary.updatedAt);
					if (
						entry.projectId !== nextProjectId ||
						entry.filePath !== summary.filePath ||
						entry.title !== nextTitle ||
						entry.titleLocked !== nextTitleLocked ||
						entry.titleOrigin !== nextOrigin ||
						entry.source !== (summary.source ?? "pi") ||
						entry.environment !== getSessionEnvironment(summary) ||
						entry.wslDistro !== (summary.wsl ? context.wslDistro : undefined) ||
						entry.wslUser !== (summary.wsl ? context.wslUser : undefined) ||
						entry.importedSourceId !== importedSourceId ||
						entry.status !== "active" ||
						entry.parentSessionPath !== nextParent ||
						entry.forked !== nextForked ||
						entry.updatedAt !== nextUpdatedAt
					) {
						entry.projectId = nextProjectId;
						entry.filePath = summary.filePath;
						entry.title = nextTitle;
						entry.titleLocked = nextTitleLocked;
						entry.titleOrigin = nextOrigin;
						entry.source = summary.source ?? "pi";
						entry.environment = getSessionEnvironment(summary);
						entry.wslDistro = summary.wsl ? context.wslDistro : undefined;
						entry.wslUser = summary.wsl ? context.wslUser : undefined;
						entry.importedSourceId = importedSourceId;
						entry.status = "active";

						entry.parentSessionPath = summary.parentSessionPath ?? fetchedParent ?? entry.parentSessionPath;
						entry.forked = nextForked;
						entry.updatedAt = nextUpdatedAt;
						changed = true;
					}

					if (options?.manualAssignment && !entry.manualProjectAssignment) {
						entry.manualProjectAssignment = true;
						changed = true;
					}
				}
				summaryById.set(entry.id, summary);
				inheritSessionMeta(entry, summary);
			}

			const records = entries.filter((entry) => entry.projectId === projectId).map((entry) => this.recordFromEntry(entry, summaryById.get(entry.id)));
			const idByPath = new Map<string, string>();
			for (const record of records) {
				if (!record.filePath) continue;
				idByPath.set(canonicalizeSessionPath(record.filePath, record.environment), record.id);
			}
			for (const record of records) {
				if (!record.parentSessionPath) continue;
				record.parentSessionId = idByPath.get(canonicalizeSessionPath(record.parentSessionPath, record.environment));
			}
			return {
				value: records.sort((left, right) => right.updatedAt - left.updatedAt),
				changed,
			};
		}).then((records) =>
			[
				...Array.from(this.transientEntries.values())
					.filter((entry) => entry.projectId === projectId)
					.map((entry) => this.recordFromEntry(entry)),
				...records,
			].sort((left, right) => right.updatedAt - left.updatedAt),
		);
	}

	private async collectScannedTitles(summaries: SessionSummary[], context: SessionCatalogContext): Promise<{ titles: Map<string, ScannedTitleFetch>; legacyProbes: Map<string, LegacyTitleProbe>; invalid: Set<string>; parents: Map<string, string>; forked: Map<string, boolean> }> {
		const titles = new Map<string, ScannedTitleFetch>();

		const legacyProbes = new Map<string, LegacyTitleProbe>();
		const invalid = new Set<string>();
		const parents = new Map<string, string>();
		const forked = new Map<string, boolean>();
		if (!this.fetchTitle) return { titles, legacyProbes, invalid, parents, forked };
		const byOrigin = new Map(this.entries.filter((entry) => entry.originKey).map((entry) => [entry.originKey!, entry]));
		const wanted: Array<{ originKey: string; filePath: string; includeTitle: boolean; legacyProbe?: boolean; lockedTitle?: string }> = [];
		for (const summary of summaries) {
			const originKey = buildSummaryOriginKey(summary, context);
			const existing = byOrigin.get(originKey);
			if (existing && isTitleLocked(existing)) {
				const legacy = existing.source === "pi" && resolveTitleOrigin(existing) === "legacy";
				const tintinwebOrphan = existing.source === "pi" && !existing.parentSessionPath && /^[^#]+#[0-9a-f]{8}$/i.test(existing.title);
				if (legacy) wanted.push({ originKey, filePath: summary.filePath, includeTitle: true, legacyProbe: true, lockedTitle: existing.title });
				else if (tintinwebOrphan) wanted.push({ originKey, filePath: summary.filePath, includeTitle: false });
				continue;
			}

			if (catalogDisplayTitle(summary.name)) continue;

			wanted.push({ originKey, filePath: summary.filePath, includeTitle: true });
		}
		if (wanted.length === 0) return { titles, legacyProbes, invalid, parents, forked };

		const CONCURRENCY = 8;
		let cursor = 0;
		const workers = Array.from({ length: Math.min(CONCURRENCY, wanted.length) }, async () => {
			while (cursor < wanted.length) {
				const item = wanted[cursor++];
				const result = await this.fetchTitle!(item.filePath, { includeTitle: item.includeTitle }).catch(() => undefined);
				if (!result) continue;
				if (item.includeTitle && result.name) {
					const junkMarkerName = result.nameFromSessionInfo !== false && looksLikeToolMarkerTitle(result.name);
					const scannedName = junkMarkerName ? result.fallbackName : result.name;
					if (scannedName) {
						titles.set(item.originKey, { name: scannedName, fromSessionInfo: junkMarkerName ? false : result.nameFromSessionInfo !== false, fallbackName: result.fallbackName });
					}
				}
				if (item.legacyProbe) {
					const authoritative = result.nameFromSessionInfo === true ? result.name : undefined;

					const needsFirstUserText = Boolean(authoritative) && normalizeFingerprintTitle(result.fallbackName) !== normalizeFingerprintTitle(item.lockedTitle);

					const firstUserText = needsFirstUserText
						? await this.fetchTitle!(item.filePath, { includeTitle: false, includeFirstUserText: true })
								.then((extra) => extra?.firstUserText)
								.catch(() => undefined)
						: undefined;
					legacyProbes.set(item.originKey, { authoritative, fallback: result.fallbackName, firstUserText });
				}

				if (result.valid === false) invalid.add(item.originKey);

				if (result.parentSessionPath) parents.set(item.originKey, result.parentSessionPath);

				if (result.forked === true) forked.set(item.originKey, true);
			}
		});
		await Promise.all(workers);
		return { titles, legacyProbes, invalid, parents, forked };
	}

	private recordFromEntry(entry: SessionCatalogEntry, summary?: SessionSummary): SessionRecord {
		return {
			id: entry.id,
			projectId: entry.projectId,
			title: catalogDisplayTitle(entry.title) || "Untitled",
			noSession: entry.noSession,
			source: summary?.source ?? entry.source,
			environment: summary ? getSessionEnvironment(summary) : entry.environment,
			channel: entry.channel,
			backend: entry.backend,
			sideTask: entry.sideTask,
			filePath: summary?.filePath ?? entry.filePath,
			wslDistro: entry.wslDistro,
			wslUser: entry.wslUser,
			importedSourceId: summary ? getImportedSessionSourceId(summary) : entry.importedSourceId,
			parentSessionPath: summary?.parentSessionPath ?? entry.parentSessionPath,
			forked: entry.forked,
			supersededBy: entry.supersededBy,
			mergedSessionIds: entry.mergedSessionIds ? [...entry.mergedSessionIds] : undefined,
			projectPath: summary?.projectPath,
			preview: summary?.preview ?? "",
			messageCount: summary?.messageCount ?? 0,
			status: entry.status,
			model: entry.model ? { ...entry.model } : undefined,
			thinkingLevel: entry.thinkingLevel,
			acpToolId: entry.acpToolId,
			acpSessionId: entry.acpSessionId,
			qoderSessionId: entry.qoderSessionId,
			proxy: entry.proxy ? { ...entry.proxy } : undefined,
			createdAt: entry.createdAt,

			updatedAt: Math.max(entry.updatedAt, summary?.updatedAt ?? entry.updatedAt),
			wsl: summary?.wsl,
			codexSessionId: summary?.codexSessionId,
			codexThreadSource: summary?.codexThreadSource,
			codexParentThreadId: summary?.codexParentThreadId,
			codexAgentRole: summary?.codexAgentRole,
			codexAgentNickname: summary?.codexAgentNickname,
		};
	}

	private originKeyForEntry(entry: SessionCatalogEntry): string | undefined {
		if (!entry.filePath) return undefined;
		return buildSessionOriginKey({
			source: entry.source,
			environment: entry.environment,
			filePath: entry.filePath,
			wslDistro: entry.wslDistro ?? this.identityContext.wslDistro,
			wslUser: entry.wslUser ?? this.identityContext.wslUser,
			importedSourceId: entry.importedSourceId,
		});
	}

	private confirmedOriginKey(entry: SessionCatalogEntry): string | undefined {
		if (!isFileSession(entry) || !entry.filePath) return undefined;
		const resolved = this.resolveFilePath ? this.resolveFilePath(entry.projectId, entry.filePath, entry.environment) : entry.filePath;
		if (!resolved || !isUnambiguousAbsoluteSessionPath(resolved)) return undefined;
		return this.originKeyForEntry(resolved === entry.filePath ? entry : { ...entry, filePath: resolved });
	}

	private requireEntry(entries: SessionCatalogEntry[], id: string): SessionCatalogEntry {
		const entry = this.findEntryInTransaction(entries, id);
		if (!entry) throw new Error(`Session not found: ${id}`);
		return entry;
	}

	private canonicalIdInTransaction(id: string): string {
		return this.mergedIdAliases.get(id) ?? id;
	}

	private findEntryInTransaction(entries: SessionCatalogEntry[], id: string): SessionCatalogEntry | undefined {
		const canonical = this.canonicalIdInTransaction(id);
		return entries.find((candidate) => candidate.id === canonical);
	}

	async markSuperseded(id: string, supersededBy: string): Promise<SessionCatalogEntry | undefined> {
		this.assertLoaded();
		const sessionId = this.resolveSessionId(id);
		return this.enqueueMutation((entries) => {
			const entry = this.findEntryInTransaction(entries, sessionId);
			if (!entry) return { value: undefined, changed: false };
			if (entry.supersededBy === supersededBy) {
				return { value: cloneEntry(entry), changed: false };
			}
			entry.supersededBy = supersededBy;
			entry.updatedAt = Date.now();
			return { value: cloneEntry(entry), changed: true };
		});
	}

	private assertLoaded(): void {
		if (!this.loaded) throw new Error("SessionCatalog.load() must complete before use");
	}

	private enqueueMutation<T>(mutate: (entries: SessionCatalogEntry[]) => { value: T; changed: boolean } | Promise<{ value: T; changed: boolean }>): Promise<T> {
		const operation = this.writeQueue
			.catch(() => undefined)
			.then(async () => {
				const nextEntries = this.entries.map(cloneEntry);
				const result = await mutate(nextEntries);
				if (result.changed) {
					await this.writeSnapshot(nextEntries);
					this.entries = nextEntries;
					this.rebuildMergedIdAliases();
				}
				return result.value;
			});
		this.writeQueue = operation.then(
			() => undefined,
			() => undefined,
		);
		return operation;
	}

	private backupFilePath(): string {
		return `${this.filePath}.bak`;
	}

	private async readCatalogFile(filePath: string): Promise<{
		entries: SessionCatalogEntry[];
	}> {
		const parsed = JSON.parse(await readFile(filePath, "utf8")) as Partial<SessionCatalogFile>;
		if (!Array.isArray(parsed.sessions)) {
			throw new Error(`Invalid Session catalog: ${filePath}`);
		}
		const entries = parsed.sessions.filter((entry): entry is SessionCatalogEntry => typeof entry?.id === "string" && typeof entry.projectId === "string" && typeof entry.title === "string" && (entry.environment === "native" || entry.environment === "wsl") && (entry.status === "draft" || entry.status === "active"));
		if (entries.length !== parsed.sessions.length) {
			throw new Error(`Session catalog contains invalid records: ${filePath}`);
		}

		for (const entry of entries) {
			if (entry.channel !== "wechat" && entry.channel !== "feishu") delete entry.channel;
		}
		return {
			entries: entries.map(cloneEntry),
		};
	}

	private async writeSnapshot(entries: SessionCatalogEntry[]): Promise<void> {
		const snapshot: SessionCatalogFile = {
			version: 1,
			sessions: entries.map(cloneEntry),
		};
		await mkdir(dirname(this.filePath), { recursive: true });
		const nonce = randomUUID();
		const tempPath = `${this.filePath}.${nonce}.tmp`;
		const backupPath = this.backupFilePath();
		const backupTempPath = `${backupPath}.${nonce}.tmp`;
		try {
			const handle = await open(tempPath, "w");
			try {
				await handle.writeFile(JSON.stringify(snapshot, null, 2), "utf8");
				await handle.sync();
			} finally {
				await handle.close();
			}

			if (!this.skipNextBackup) {
				try {
					await copyFile(this.filePath, backupTempPath);
					await renameWithRetry(backupTempPath, backupPath);
				} catch (error) {
					await unlink(backupTempPath).catch(() => undefined);
					if (isMissingFileError(error)) {
					} else {
						void getAppLogger()?.warn("session-catalog", "Backup rotation failed, continuing without backup", {
							cause: error instanceof Error ? error.message : String(error),
						});
					}
				}
			}
			await renameWithRetry(tempPath, this.filePath);
			this.skipNextBackup = false;
		} finally {
			await unlink(tempPath).catch(() => undefined);
			await unlink(backupTempPath).catch(() => undefined);
		}
	}
}

export function didSessionPreferencesChange(entry: SessionCatalogEntry, patch: Pick<SessionCatalogEntry, "model" | "thinkingLevel">): boolean {
	return !equalModel(entry.model, patch.model) || entry.thinkingLevel !== patch.thinkingLevel;
}
