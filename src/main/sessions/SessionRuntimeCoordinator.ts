import type {
	AgentBackend,
	AgentGatewayCapability,
	AgentRuntimeState,
	AgentTab,
	AvailableModel,
	ChatMessage,
	CreateAgentInput,
	I18nDescriptor,
	ImageContent,
	PiCommand,
	RewindCheckpointPage,
	RewindCheckpointPageParams,
	RewindRestoreResult,
	RewindRestoreScope,
	SendPromptInput,
	SendPromptResult,
	SendSessionPromptInput,
	SendSessionPromptResult,
	SessionCommandErrorCode,
	SessionCommandResult,
	SessionMessageImageTarget,
	SessionRecord,
	SessionModelPreference,
	SessionRuntimeEvent,
	SessionRuntimeInfo,
	SessionRuntimeModelSelection,
	SessionRuntimeReplacement,
	SessionRuntimeTarget,
	SessionTargetedValue,
	SessionUiResponseInput,
	AgentUiBatchQuestion,
} from "../../shared/types";
import { buildSessionOriginKey } from "../../shared/sessionIdentity";
import { descriptorFromThrownError } from "../../shared/errorI18n";
import { createSessionModelPreference } from "../../shared/modelDisplayName";
import { isRewindCheckpointId, isRewindRestoreScope } from "../../shared/types";
import type { SessionCatalogEntry } from "./SessionCatalog";
import { sessionFileSizeMb } from "./sessionFileSizeCopy";

export interface SessionCatalogGateway {
	get(sessionId: string): SessionCatalogEntry | undefined;
	getRecord(sessionId: string): SessionRecord | undefined;

	resolveSessionId?(sessionId: string): string;
	update(
		sessionId: string,
		patch: {
			title?: string;
			model?: SessionModelPreference | null;
			thinkingLevel?: string | null;
			backend?: AgentBackend;
			updatedAt?: number;
		},
	): Promise<SessionCatalogEntry>;
	attachRuntime(input: { sessionId: string; filePath?: string; piSessionId?: string; acpSessionId?: string; qoderSessionId?: string; agentPreset?: string; promoteToActive?: boolean }): Promise<unknown>;
}

export interface SessionAgentGateway {
	readonly backend: AgentBackend;

	readonly capabilities: ReadonlySet<AgentGatewayCapability>;
	list(): AgentTab[];

	sendPrompt(input: SendPromptInput): Promise<SendPromptResult>;
	getMessages(agentId: string): ChatMessage[];
	create(input: CreateAgentInput): Promise<AgentTab>;

	claimStandbyAgent?(input: { projectId: string; sessionId: string; noSession?: boolean }): Promise<AgentTab | null>;

	ensureStandbyAgent?(projectId: string): void;

	draftCommands?(projectId: string): Promise<PiCommand[] | null>;
	restart(agentId: string): Promise<AgentTab>;
	stop(agentId: string): Promise<void>;

	stopAndWaitForExit?(agentId: string, timeoutMs?: number): Promise<boolean>;
	rename(agentId: string, name: string): Promise<AgentTab>;
	abort(agentId: string): Promise<void>;
	compact(agentId: string, prompt?: string): Promise<AgentRuntimeState>;
	getRuntimeState(agentId: string): Promise<AgentRuntimeState>;

	reviveIfProcessAlive?(agentId: string): boolean;

	getCommands?(agentId: string): Promise<unknown[]>;

	reloadResources?(agentId: string): Promise<PiCommand[]>;
	getAvailableModels(agentId: string): Promise<AvailableModel[]>;

	getAvailableThinkingLevels?(agentId: string): Promise<string[] | undefined>;

	exportHtml?(agentId: string): Promise<unknown>;

	listCheckpoints?(agentId: string, params?: RewindCheckpointPageParams): Promise<RewindCheckpointPage>;

	getCheckpointDiff?(agentId: string, checkpointId: string): Promise<string>;

	restoreCheckpoint?(agentId: string, checkpointId: string, scope: RewindRestoreScope): Promise<RewindRestoreResult>;

	editMessage?(agentId: string, messageId: string, newText: string): Promise<void>;

	deleteMessage?(agentId: string, messageId: string): Promise<void>;

	mutatePersistedSessionMessage?(
		sessionPath: string,
		messageId: string,
		operation: "edit" | "delete" | "resend" | "remove-image",
		options?: {
			newText?: string;
			environment?: SessionRecord["environment"];
			wslDistro?: string;

			entryId?: string;
			imageTarget?: SessionMessageImageTarget;
		},
	): Promise<{ text: string; images?: ImageContent[] } | undefined>;
	prepareResendFromMessage(agentId: string, messageId: string): Promise<{ text: string; images?: ImageContent[] }>;
	getRuntimeModelThinkingState?(agentId: string): Promise<SessionRuntimeModelSelection | undefined>;
	setModel(agentId: string, provider: string, modelId: string): Promise<unknown>;
	setThinking(agentId: string, level: string): Promise<unknown>;

	notifyModelPreferenceIgnored?(agentId: string, provider: string, modelId: string): void;

	publishRuntimeState(agentId: string): Promise<void>;
	getForkMessages(agentId: string): Promise<Array<{ entryId: string; text: string }>>;
	forkSession(agentId: string, entryId: string): Promise<unknown>;
	sendUIResponse(agentId: string, requestId: string, response: SessionUiResponseInput["response"]): Promise<unknown> | unknown;

	notifyAskPending(agentId: string, sessionId: string, sessionTitle: string, question: string): void;

	onOutput(listener: (channel: string, payload: unknown) => void): () => void;
}

export interface SessionRuntimeLogger {
	info(scope: string, message: string, detail?: unknown): unknown;
	warn(scope: string, message: string, detail?: unknown): unknown;
	error(scope: string, message: string, detail?: unknown): unknown;
}

type DeliveryCacheEntry = {
	createdAt: number;
	settled: boolean;
	promise: Promise<SendSessionPromptResult>;
};

export type PendingUiRequestSnapshot = {
	sessionId: string;
	agentId: string;
	runtimeGeneration: number;
	requestId: string;
	method: string;
	title: string;
	options?: string[];
	placeholder?: string;
	prefill?: string;
	allowOther?: boolean;
	batchQuestions?: AgentUiBatchQuestion[];
	batchReview?: boolean;
};

type PendingUiRequest = PendingUiRequestSnapshot;

export type SessionRuntimeBinding = {
	sessionId: string;
	agentId: string;
	runtimeGeneration: number;
};

export type SessionRuntimeDetachNotifier = (binding: SessionRuntimeBinding) => void;

type RuntimeReplacement = SessionRuntimeBinding & {
	replacementId: number;
};

type DispatchLease = SessionRuntimeBinding & {
	leaseId: number;
};

class SessionRuntimeCommandError extends Error {
	constructor(
		readonly code: SessionCommandErrorCode,
		message: string,
	) {
		super(message);
		this.name = "SessionRuntimeCommandError";
	}
}

const DELIVERY_CACHE_TTL_MS = 10 * 60_000;
const DELIVERY_CACHE_MAX_ENTRIES = 500;
const AGENT_READY_TIMEOUT_MS = 60_000;

const DELETE_STOP_TIMEOUT_MS = 3000;

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function isTerminalAgent(tab: AgentTab): boolean {
	return tab.status === "error" || tab.status === "closed";
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isInteractiveUiMethod(method: unknown): boolean {
	return method === "select" || method === "confirm" || method === "input" || method === "editor" || method === "batch_ask";
}

type AppliedSessionPreferences = {
	model?: SessionModelPreference;
	thinkingLevel?: string;
};

function snapshotPreferences(entry: SessionCatalogEntry): AppliedSessionPreferences {
	return {
		...(entry.model ? { model: createSessionModelPreference(entry.model.provider, entry.model.modelId, entry.model.modelName) } : {}),
		...(entry.thinkingLevel ? { thinkingLevel: entry.thinkingLevel } : {}),
	};
}

function sameAppliedPreferences(a: AppliedSessionPreferences | undefined, b: AppliedSessionPreferences): boolean {
	if (!a) return false;
	const aModel = a.model;
	const bModel = b.model;
	if (Boolean(aModel) !== Boolean(bModel)) return false;
	if (aModel && bModel && (aModel.provider !== bModel.provider || aModel.modelId !== bModel.modelId)) {
		return false;
	}
	return a.thinkingLevel === b.thinkingLevel;
}

export class SessionRuntimeCoordinator {
	private readonly activationBySession = new Map<string, Promise<AgentTab>>();
	private readonly deliveryByRequest = new Map<string, DeliveryCacheEntry>();
	private readonly agentIdBySession = new Map<string, string>();
	private readonly sessionIdByAgent = new Map<string, string>();
	private readonly generationBySession = new Map<string, number>();
	private readonly pendingUiRequests = new Map<string, PendingUiRequest>();
	private readonly replacementByAgent = new Map<string, RuntimeReplacement>();
	private readonly replacementBySession = new Map<string, RuntimeReplacement>();
	private readonly dispatchLeasesByAgent = new Map<string, Set<DispatchLease>>();
	private readonly dispatchLeasesBySession = new Map<string, Set<DispatchLease>>();
	private replacementSequence = 0;
	private dispatchLeaseSequence = 0;

	private focusedSessionId: string | undefined = undefined;

	private readonly deletingSessions = new Set<string>();

	private readonly lastAppliedBySession = new Map<
		string,
		{
			agentId: string;
			preferences: AppliedSessionPreferences;
		}
	>();

	private readonly preferenceMutationTails = new Map<string, Promise<void>>();
	private readonly lastRequestedThinkingBySession = new Map<string, { agentId: string; level: string }>();
	private detachedNotifier: SessionRuntimeDetachNotifier | undefined;

	constructor(
		private readonly catalog: SessionCatalogGateway,
		private readonly agents: SessionAgentGateway,
		private readonly sendAgentPrompt: (input: SendPromptInput) => Promise<SendPromptResult>,
		private readonly logger?: SessionRuntimeLogger,
	) {}

	setFocusedSession(sessionId: string | undefined): void {
		this.focusedSessionId = sessionId;

		void this.logger?.info("session-runtime", "Focused session changed", { sessionId });
	}

	getFocusedSession(): string | undefined {
		return this.focusedSessionId;
	}

	send(input: SendSessionPromptInput): Promise<SendSessionPromptResult> {
		const sessionId = input.sessionId.trim();
		const requestId = input.requestId.trim();
		if (!sessionId) return Promise.resolve(this.rejected(input, "Session ID is required"));
		if (!requestId) return Promise.resolve(this.rejected(input, "Request ID is required"));
		if (!input.message.trim() && !input.images?.length) {
			return Promise.resolve(
				this.rejected(input, "消息不能为空", {
					i18nKey: "diagnostic.messageRequired",
				}),
			);
		}

		this.pruneDeliveryCache();

		const canonicalSessionId = this.canonicalSessionId(sessionId);
		const cacheKey = `${canonicalSessionId}\u0000${requestId}`;
		const existing = this.deliveryByRequest.get(cacheKey);
		if (existing) return existing.promise;

		const cacheEntry: DeliveryCacheEntry = {
			createdAt: Date.now(),
			settled: false,
			promise: Promise.resolve(this.rejected(input, "Request was not started")),
		};
		cacheEntry.promise = this.sendOnce({ ...input, sessionId: canonicalSessionId, requestId }).finally(() => {
			cacheEntry.settled = true;
		});
		this.deliveryByRequest.set(cacheKey, cacheEntry);
		return cacheEntry.promise;
	}

	hasLiveRuntime(sessionId: string): boolean {
		const canonicalSessionId = this.canonicalSessionId(sessionId);
		const agentId = this.agentIdBySession.get(canonicalSessionId);
		if (!agentId) return false;
		const tab = this.agents.list().find((candidate) => candidate.id === agentId);
		if (!tab) return false;
		if (!isTerminalAgent(tab)) return true;

		return tab.status === "error" && this.hasPendingUiRequest(canonicalSessionId, agentId);
	}

	getAgentId(sessionId: string): string | undefined {
		const canonicalSessionId = this.canonicalSessionId(sessionId);
		const agentId = this.agentIdBySession.get(canonicalSessionId);
		if (!agentId) return undefined;
		const tab = this.agents.list().find((candidate) => candidate.id === agentId);
		if (tab && !isTerminalAgent(tab)) return agentId;

		if (tab?.status === "error" && this.hasPendingUiRequest(canonicalSessionId, agentId)) return agentId;

		if (tab?.status === "error" && this.reviveTerminalAgent(agentId)) return agentId;

		const binding = this.getRuntimeBinding(agentId);
		this.unbindTerminalAgent(agentId);

		if (binding) this.notifyRuntimeDetached({ ...binding, agentId });
		return undefined;
	}

	setDetachedNotifier(notifier: SessionRuntimeDetachNotifier | undefined): void {
		this.detachedNotifier = notifier;
	}

	private notifyRuntimeDetached(binding: SessionRuntimeBinding): void {
		if (!this.detachedNotifier) return;
		try {
			this.detachedNotifier(binding);
		} catch (error) {
			void this.logger?.warn("session-runtime", "Runtime detach notification failed", { ...binding, error: errorMessage(error) });
		}
	}

	getSessionId(agentId: string): string | undefined {
		return this.sessionIdByAgent.get(agentId);
	}

	getSessionInfoForAgent(agentId: string): { sessionId: string; sessionTitle?: string } | undefined {
		const sessionId = this.sessionIdByAgent.get(agentId);
		if (!sessionId) return undefined;
		const entry = this.catalog.get(sessionId);
		return { sessionId, sessionTitle: entry?.title };
	}

	listRuntimes(): SessionRuntimeInfo[] {
		const result: SessionRuntimeInfo[] = [];
		for (const [sessionId, agentId] of this.agentIdBySession) {
			const tab = this.agents.list().find((candidate) => candidate.id === agentId);
			if (!tab || isTerminalAgent(tab)) continue;
			result.push(this.runtimeInfo(sessionId, tab));
		}
		return result.sort((left, right) => right.createdAt - left.createdAt);
	}

	getTarget(sessionId: string): SessionRuntimeTarget | undefined {
		const canonicalSessionId = this.canonicalSessionId(sessionId);
		const agentId = this.getAgentId(canonicalSessionId);
		if (!agentId) return undefined;
		const binding = this.getRuntimeBinding(agentId);
		if (!binding || binding.sessionId !== canonicalSessionId) return undefined;
		return { sessionId: canonicalSessionId, agentId, runtimeGeneration: binding.runtimeGeneration };
	}

	isActivating(sessionId: string): boolean {
		return this.activationBySession.has(this.canonicalSessionId(sessionId));
	}

	registerPendingRuntime(sessionId: string, activation: Promise<AgentTab>): void {
		const normalizedSessionId = this.canonicalSessionId(sessionId.trim());
		if (!normalizedSessionId) throw new Error("Session ID is required");
		if (this.activationBySession.has(normalizedSessionId)) return;

		this.activationBySession.set(normalizedSessionId, activation);

		void activation.then(
			() => this.clearPendingRuntime(normalizedSessionId, activation),
			() => this.clearPendingRuntime(normalizedSessionId, activation),
		);
	}

	private clearPendingRuntime(sessionId: string, activation: Promise<AgentTab>): void {
		if (this.activationBySession.get(sessionId) === activation) {
			this.activationBySession.delete(sessionId);
		}
	}

	async releaseRuntimeForDelete(sessionId: string): Promise<void> {
		const requestedSessionId = this.canonicalSessionId(sessionId);
		this.deletingSessions.add(requestedSessionId);
		const activating = this.activationBySession.get(requestedSessionId);
		if (activating) await activating.catch(() => undefined);

		const mappedAgentId = this.agentIdBySession.get(requestedSessionId);
		const mappedGeneration = mappedAgentId ? (this.getRuntimeBinding(mappedAgentId)?.runtimeGeneration ?? 0) : 0;
		const liveTarget = this.getTarget(requestedSessionId);
		const target = liveTarget ?? (mappedAgentId ? { sessionId: requestedSessionId, agentId: mappedAgentId, runtimeGeneration: mappedGeneration } : undefined);

		this.generationBySession.delete(requestedSessionId);
		if (!target) {
			this.deletingSessions.delete(requestedSessionId);
			return;
		}
		this.unbindAgentUnchecked(target.agentId);

		try {
			await this.stopForDelete(target.agentId);
		} finally {
			this.deletingSessions.delete(requestedSessionId);
		}
	}

	private async stopForDelete(agentId: string): Promise<void> {
		const stopAndWait = this.agents.stopAndWaitForExit;
		if (typeof stopAndWait !== "function") {
			await this.agents.stop(agentId).catch(() => undefined);
			return;
		}
		let exited = false;
		try {
			exited = await stopAndWait.call(this.agents, agentId, DELETE_STOP_TIMEOUT_MS);
		} catch {
			exited = false;
		}
		if (!exited) {
			void this.logger?.warn("session-runtime", "Agent exit timed out before session delete", { agentId, timeoutMs: DELETE_STOP_TIMEOUT_MS });
		}
	}

	getRuntimeMessages(sessionId: string): SessionTargetedValue<ChatMessage[]> | undefined {
		const target = this.getTarget(sessionId);
		if (!target) return undefined;
		const messages = this.agents.getMessages(target.agentId);

		if (!this.validateTarget(target).ok) return undefined;
		return { target, value: messages };
	}

	async activateRuntime(sessionId: string): Promise<SessionCommandResult<SessionRuntimeInfo>> {
		const canonicalSessionId = this.canonicalSessionId(sessionId);
		try {
			const tab = await this.ensureRuntime(canonicalSessionId);
			void this.logger?.info("session-runtime", "Runtime activated", {
				sessionId: canonicalSessionId,
				agentId: tab.id,
				status: tab.status,
			});
			return { ok: true, value: this.runtimeInfo(canonicalSessionId, tab) };
		} catch (error) {
			return this.commandFailure(error);
		}
	}

	bindAnonymousRuntime(sessionId: string, agentId: string): SessionRuntimeInfo {
		const canonicalSessionId = this.canonicalSessionId(sessionId);
		const entry = this.catalog.get(canonicalSessionId);
		if (!entry?.noSession) throw new Error(`Anonymous session not found: ${canonicalSessionId}`);
		const tab = this.agents.list().find((candidate) => candidate.id === agentId);
		if (!tab?.noSession || isTerminalAgent(tab)) {
			throw new Error(`Anonymous runtime is not available: ${agentId}`);
		}
		const runtimeGeneration = this.bind(canonicalSessionId, agentId);
		tab.runtimeGeneration = runtimeGeneration;
		void this.logger?.info("session-runtime", "Anonymous runtime bound", {
			sessionId: canonicalSessionId,
			agentId,
			runtimeGeneration,
		});
		return this.runtimeInfo(canonicalSessionId, tab);
	}

	validateTarget(target: SessionRuntimeTarget): SessionCommandResult<SessionRuntimeTarget> {
		try {
			const canonical = this.canonicalTarget(target);
			this.requireTarget(canonical);
			return { ok: true, value: canonical };
		} catch (error) {
			return this.commandFailure(error);
		}
	}

	renameRuntime(target: SessionRuntimeTarget, name: string): Promise<SessionCommandResult<SessionTargetedValue<AgentTab>>> {
		return this.runTargetCommand(target, async (agentId) => {
			const result = await this.agents.rename(agentId, name);
			void this.logger?.info("session-runtime", "Runtime renamed", {
				sessionId: target.sessionId,
				agentId,
				name,
			});
			return result;
		});
	}

	abortRuntime(target: SessionRuntimeTarget): Promise<SessionCommandResult<SessionTargetedValue<void>>> {
		return this.runTargetCommand(target, (agentId) => this.agents.abort(agentId));
	}

	compactRuntime(target: SessionRuntimeTarget, prompt?: string): Promise<SessionCommandResult<SessionTargetedValue<AgentRuntimeState>>> {
		return this.runTargetCommand(target, (agentId) => this.agents.compact(agentId, prompt));
	}

	getRuntimeState(target: SessionRuntimeTarget): Promise<SessionCommandResult<SessionTargetedValue<AgentRuntimeState>>> {
		return this.runTargetCommand(target, (agentId) => this.agents.getRuntimeState(agentId));
	}

	listRuntimeCommands(target: SessionRuntimeTarget): Promise<SessionCommandResult<SessionTargetedValue<PiCommand[]>>> {
		return this.runTargetCommand(target, async (agentId) => {
			if (typeof this.agents.getCommands !== "function") {
				throw new SessionRuntimeCommandError("SESSION_COMMAND_FAILED", `backend "${this.agents.backend}" does not support getCommands`);
			}
			return (await this.agents.getCommands(agentId)) as PiCommand[];
		});
	}

	reloadResources(target: SessionRuntimeTarget): Promise<SessionCommandResult<SessionTargetedValue<PiCommand[]>>> {
		return this.runTargetCommand(target, async (agentId) => {
			if (typeof this.agents.reloadResources !== "function") {
				throw new SessionRuntimeCommandError("SESSION_COMMAND_FAILED", `backend "${this.agents.backend}" does not support reloadResources`);
			}
			return this.agents.reloadResources(agentId);
		});
	}

	listRuntimeModels(target: SessionRuntimeTarget): Promise<SessionCommandResult<SessionTargetedValue<AvailableModel[]>>> {
		return this.runTargetCommand(target, (agentId) => this.agents.getAvailableModels(agentId));
	}

	async draftCommands(projectId: string): Promise<PiCommand[] | null> {
		if (typeof this.agents.draftCommands !== "function") return null;
		try {
			return await this.agents.draftCommands(projectId);
		} catch {
			return null;
		}
	}

	listRuntimeThinkingLevels(target: SessionRuntimeTarget): Promise<SessionCommandResult<SessionTargetedValue<string[] | undefined>>> {
		return this.runTargetCommand(target, async (agentId) => {
			if (typeof this.agents.getAvailableThinkingLevels !== "function") return undefined;
			return this.agents.getAvailableThinkingLevels(agentId);
		});
	}

	exportRuntimeHtml(target: SessionRuntimeTarget): Promise<SessionCommandResult<SessionTargetedValue<unknown>>> {
		return this.runTargetCommand(target, async (agentId) => {
			if (typeof this.agents.exportHtml !== "function") {
				throw new SessionRuntimeCommandError("SESSION_COMMAND_FAILED", `backend "${this.agents.backend}" does not support exportHtml`);
			}
			return this.agents.exportHtml(agentId);
		});
	}

	listRewindCheckpoints(target: SessionRuntimeTarget, params?: RewindCheckpointPageParams): Promise<SessionCommandResult<SessionTargetedValue<RewindCheckpointPage>>> {
		return this.runTargetCommand(target, async (agentId) => {
			if (typeof this.agents.listCheckpoints !== "function") {
				throw new SessionRuntimeCommandError("SESSION_COMMAND_FAILED", `backend "${this.agents.backend}" does not support rewind checkpoints`);
			}
			return this.agents.listCheckpoints(agentId, params);
		});
	}

	getRewindCheckpointDiff(target: SessionRuntimeTarget, checkpointId: unknown): Promise<SessionCommandResult<SessionTargetedValue<string>>> {
		return this.runTargetCommand(target, async (agentId) => {
			if (!isRewindCheckpointId(checkpointId)) {
				throw new SessionRuntimeCommandError("SESSION_COMMAND_FAILED", `Invalid rewind checkpoint id: ${String(checkpointId)}`);
			}
			if (typeof this.agents.getCheckpointDiff !== "function") {
				throw new SessionRuntimeCommandError("SESSION_COMMAND_FAILED", `backend "${this.agents.backend}" does not support rewind diffs`);
			}
			return this.agents.getCheckpointDiff(agentId, checkpointId);
		});
	}

	restoreRewindCheckpoint(target: SessionRuntimeTarget, checkpointId: unknown, scope: unknown): Promise<SessionCommandResult<SessionTargetedValue<RewindRestoreResult>>> {
		return this.runTargetCommand(target, async (agentId) => {
			if (!isRewindCheckpointId(checkpointId)) {
				throw new SessionRuntimeCommandError("SESSION_COMMAND_FAILED", `Invalid rewind checkpoint id: ${String(checkpointId)}`);
			}
			if (!isRewindRestoreScope(scope)) {
				throw new SessionRuntimeCommandError("SESSION_COMMAND_FAILED", `Invalid rewind restore scope: ${String(scope)}`);
			}
			if (typeof this.agents.restoreCheckpoint !== "function") {
				throw new SessionRuntimeCommandError("SESSION_COMMAND_FAILED", `backend "${this.agents.backend}" does not support rewind restore`);
			}
			return this.agents.restoreCheckpoint(agentId, checkpointId, scope);
		});
	}

	editRuntimeMessage(target: SessionRuntimeTarget, messageId: string, newText: string): Promise<SessionCommandResult<SessionTargetedValue<void>>> {
		return this.runTargetCommand(target, async (agentId) => {
			if (typeof this.agents.editMessage !== "function") {
				throw new SessionRuntimeCommandError("SESSION_COMMAND_FAILED", `backend "${this.agents.backend}" does not support editMessage`);
			}
			return this.agents.editMessage(agentId, messageId, newText);
		});
	}

	deleteRuntimeMessage(target: SessionRuntimeTarget, messageId: string): Promise<SessionCommandResult<SessionTargetedValue<void>>> {
		return this.runTargetCommand(target, async (agentId) => {
			if (typeof this.agents.deleteMessage !== "function") {
				throw new SessionRuntimeCommandError("SESSION_COMMAND_FAILED", `backend "${this.agents.backend}" does not support deleteMessage`);
			}
			return this.agents.deleteMessage(agentId, messageId);
		});
	}

	prepareRuntimeResend(target: SessionRuntimeTarget, messageId: string): Promise<SessionCommandResult<SessionTargetedValue<{ text: string; images?: ImageContent[] }>>> {
		return this.runTargetCommand(target, (agentId) => this.agents.prepareResendFromMessage(agentId, messageId));
	}

	editCatalogMessage(
		sessionId: string,
		messageId: string,
		newText: string,

		entryId?: string,
	): Promise<SessionCommandResult<void>> {
		return this.mutateCatalogMessage(sessionId, messageId, "edit", newText, entryId).then((result) => {
			if (!result.ok) return result;
			return { ok: true as const, value: undefined };
		});
	}

	removeCatalogMessageImage(sessionId: string, messageId: string, imageTarget: SessionMessageImageTarget, entryId?: string): Promise<SessionCommandResult<void>> {
		return this.mutateCatalogMessage(sessionId, messageId, "remove-image", undefined, entryId, imageTarget).then((result) => {
			if (!result.ok) return result;
			return { ok: true as const, value: undefined };
		});
	}

	deleteCatalogMessage(
		sessionId: string,
		messageId: string,

		entryId?: string,
	): Promise<SessionCommandResult<void>> {
		return this.mutateCatalogMessage(sessionId, messageId, "delete", undefined, entryId).then((result) => {
			if (!result.ok) return result;
			return { ok: true as const, value: undefined };
		});
	}

	prepareCatalogResend(
		sessionId: string,
		messageId: string,

		entryId?: string,
	): Promise<SessionCommandResult<{ text: string; images?: ImageContent[] }>> {
		return this.mutateCatalogMessage(sessionId, messageId, "resend", undefined, entryId).then((result) => {
			if (!result.ok) return result;
			return {
				ok: true as const,
				value: result.value ?? { text: "" },
			};
		});
	}

	getRuntimeForkMessages(target: SessionRuntimeTarget): Promise<SessionCommandResult<SessionTargetedValue<Array<{ entryId: string; text: string }>>>> {
		return this.runTargetCommand(target, (agentId) => this.agents.getForkMessages(agentId));
	}

	forkRuntimeSession(target: SessionRuntimeTarget, entryId: string): Promise<SessionCommandResult<SessionTargetedValue<unknown>>> {
		return this.runTargetCommand(target, (agentId) => this.agents.forkSession(agentId, entryId));
	}

	setRuntimeModel(target: SessionRuntimeTarget, provider: string, modelId: string, modelName?: string): Promise<SessionCommandResult<SessionTargetedValue<SessionRuntimeModelSelection>>> {
		return this.runTargetCommand(target, (agentId) =>
			this.serializePreferenceMutation(target.sessionId, async () => {
				this.requireBoundTarget(target);
				const existing = this.catalog.get(target.sessionId);
				const selectedModel = createSessionModelPreference(provider, modelId, modelName);
				const last = this.lastAppliedBySession.get(target.sessionId);
				const alreadyApplied = last?.agentId === agentId && last.preferences.model?.provider === provider && last.preferences.model.modelId === modelId;
				if (alreadyApplied && existing?.model?.modelName === selectedModel.modelName) return selectedModel;

				if (!alreadyApplied) {
					await this.agents.setModel(agentId, provider, modelId);
					this.lastRequestedThinkingBySession.delete(target.sessionId);
				}
				this.requireBoundTarget(target);
				const runtimeSelection = await this.agents.getRuntimeModelThinkingState?.(agentId);
				this.requireBoundTarget(target);
				const appliedModel = runtimeSelection ? createSessionModelPreference(runtimeSelection.provider, runtimeSelection.modelId, runtimeSelection.modelName) : selectedModel;
				const effectiveThinkingLevel = runtimeSelection?.thinkingLevel;
				const result: SessionRuntimeModelSelection = {
					...appliedModel,
					...(effectiveThinkingLevel !== undefined ? { thinkingLevel: effectiveThinkingLevel } : {}),
				};
				const updated = await this.catalog.update(target.sessionId, {
					model: appliedModel,
					...(effectiveThinkingLevel !== undefined ? { thinkingLevel: effectiveThinkingLevel } : {}),
					updatedAt: Date.now(),
				});
				this.lastAppliedBySession.set(target.sessionId, {
					agentId,
					preferences: snapshotPreferences(updated),
				});

				void this.logger?.info("session-runtime", "Runtime model changed", {
					sessionId: target.sessionId,
					agentId,
					provider,
					modelId,
					modelName: appliedModel.modelName,
					thinkingLevel: effectiveThinkingLevel,
				});

				this.requireBoundTarget(target);
				await this.agents.publishRuntimeState(agentId).catch(() => undefined);
				return result;
			}),
		);
	}

	setRuntimeThinking(target: SessionRuntimeTarget, level: string): Promise<SessionCommandResult<SessionTargetedValue<{ thinkingLevel: string }>>> {
		return this.runTargetCommand(target, (agentId) =>
			this.serializePreferenceMutation(target.sessionId, async () => {
				this.requireBoundTarget(target);
				const lastRequest = this.lastRequestedThinkingBySession.get(target.sessionId);
				if (lastRequest?.agentId === agentId && lastRequest.level === level) {
					return { thinkingLevel: this.catalog.get(target.sessionId)?.thinkingLevel ?? level };
				}

				await this.agents.setThinking(agentId, level);
				this.requireBoundTarget(target);
				const runtimeSelection = await this.agents.getRuntimeModelThinkingState?.(agentId);
				this.requireBoundTarget(target);
				const effectiveThinkingLevel = runtimeSelection?.thinkingLevel ?? level;
				const updated = await this.catalog.update(target.sessionId, {
					thinkingLevel: effectiveThinkingLevel,
					updatedAt: Date.now(),
				});
				this.lastAppliedBySession.set(target.sessionId, {
					agentId,
					preferences: snapshotPreferences(updated),
				});
				this.lastRequestedThinkingBySession.set(target.sessionId, { agentId, level });
				void this.logger?.info("session-runtime", "Runtime thinking changed", {
					sessionId: target.sessionId,
					agentId,
					requestedLevel: level,
					thinkingLevel: effectiveThinkingLevel,
				});
				return { thinkingLevel: effectiveThinkingLevel };
			}),
		);
	}

	async stopRuntime(target: SessionRuntimeTarget): Promise<SessionCommandResult<SessionRuntimeTarget>> {
		let reservation: RuntimeReplacement | undefined;
		try {
			const stopTarget = this.resolveStopTarget(target);

			reservation = this.reserveBoundRuntime(stopTarget.sessionId, stopTarget.agentId, { ignoreDispatchLease: true });
			await this.agents.stop(stopTarget.agentId);
			this.requireCurrentReservation(reservation);
			this.releaseRuntimeReplacement(reservation);
			reservation = undefined;
			this.unbindAgentUnchecked(stopTarget.agentId);
			void this.logger?.info("session-runtime", "Runtime stopped", {
				sessionId: stopTarget.sessionId,
				agentId: stopTarget.agentId,
				runtimeGeneration: stopTarget.runtimeGeneration,

				requestedSessionId: target.sessionId,
			});
			return { ok: true, value: stopTarget };
		} catch (error) {
			return this.commandFailure(error);
		} finally {
			if (reservation && this.replacementByAgent.get(target.agentId) === reservation) {
				this.releaseRuntimeReplacement(reservation);
			}
		}
	}

	async stopAgentById(agentId: string): Promise<SessionCommandResult<SessionRuntimeTarget | undefined>> {
		try {
			const binding = this.getRuntimeBinding(agentId);
			if (!binding) {
				await this.agents.stop(agentId);
				void this.logger?.info("session-runtime", "Agent stopped (unbound)", { agentId });
				return { ok: true, value: undefined };
			}
			const target: SessionRuntimeTarget = {
				sessionId: binding.sessionId,
				agentId,
				runtimeGeneration: binding.runtimeGeneration,
			};
			return await this.stopRuntime(target);
		} catch (error) {
			return this.commandFailure(error);
		}
	}

	async restartRuntime(target: SessionRuntimeTarget): Promise<SessionCommandResult<SessionRuntimeReplacement>> {
		try {
			const canonical = this.canonicalTarget(target);
			this.requireTarget(canonical);
			const tab = await this.restartSession(canonical.sessionId, canonical.agentId);
			const session = this.catalog.getRecord(canonical.sessionId);
			if (!session) {
				throw new SessionRuntimeCommandError("SESSION_NOT_FOUND", "Session no longer exists");
			}
			void this.logger?.info("session-runtime", "Runtime restarted", {
				sessionId: canonical.sessionId,
				agentId: canonical.agentId,
				runtimeGeneration: canonical.runtimeGeneration,
			});
			return {
				ok: true,
				value: {
					previousTarget: canonical,
					runtime: this.runtimeInfo(canonical.sessionId, tab),
					session: { ...session },
				},
			};
		} catch (error) {
			return this.commandFailure(error);
		}
	}

	bindExistingAgent(sessionId: string, agentId: string): number {
		if (!this.catalog.get(sessionId)) throw new Error(`Session not found: ${sessionId}`);
		return this.bind(sessionId, agentId);
	}

	attachCatalogRuntimes(records: SessionRecord[]): Array<{
		sessionId: string;
		agentId: string;
		runtimeGeneration: number;
	}> {
		const bindings: Array<{
			sessionId: string;
			agentId: string;
			runtimeGeneration: number;
		}> = [];
		const availableAgents = this.agents.list().filter((tab) => !isTerminalAgent(tab) && !this.replacementByAgent.has(tab.id) && !this.hasDispatchLease(undefined, tab.id));
		for (const record of records) {
			if (!record.filePath || this.replacementBySession.has(record.id) || this.hasDispatchLease(record.id)) continue;
			const target = buildSessionOriginKey({
				source: record.source,
				environment: record.environment,
				filePath: record.filePath,
				wslDistro: record.wslDistro,
				wslUser: record.wslUser,
				importedSourceId: record.importedSourceId,
			});
			const tab = availableAgents.find(
				(candidate) =>
					candidate.projectId === record.projectId &&
					candidate.sessionPath &&
					buildSessionOriginKey({
						source: candidate.sessionSource ?? "pi",
						environment: candidate.sessionEnvironment ?? "native",
						filePath: candidate.sessionPath,
						wslDistro: candidate.wslDistro,
						wslUser: candidate.wslUser,
						importedSourceId: candidate.importedSourceId,
					}) === target,
			);
			if (!tab) continue;
			bindings.push({
				sessionId: record.id,
				agentId: tab.id,
				runtimeGeneration: this.bind(record.id, tab.id),
			});
		}
		return bindings;
	}

	observeRuntimeEvent(event: SessionRuntimeEvent): void {
		const binding = this.getRuntimeBinding(event.agentId);
		if (!binding || binding.sessionId !== event.sessionId || binding.runtimeGeneration !== event.runtimeGeneration || event.sourceChannel !== "agents:ui-request" || !isRecord(event.payload)) {
			return;
		}
		const requestId = typeof event.payload.requestId === "string" ? event.payload.requestId.trim() : "";
		if (!requestId) return;
		const key = this.uiRequestKey(event.sessionId, requestId);
		if (event.payload.completed === true) {
			this.pendingUiRequests.delete(key);
			return;
		}
		if (!isInteractiveUiMethod(event.payload.method)) return;
		const options = Array.isArray(event.payload.options) ? event.payload.options.filter((option): option is string => typeof option === "string") : undefined;
		const batchQuestions = Array.isArray(event.payload.batchQuestions) ? (event.payload.batchQuestions as AgentUiBatchQuestion[]) : undefined;
		const batchReview = event.payload.batchReview === true;
		this.pendingUiRequests.set(key, {
			sessionId: event.sessionId,
			agentId: event.agentId,
			runtimeGeneration: event.runtimeGeneration,
			requestId,
			method: String(event.payload.method),
			title: typeof event.payload.title === "string" ? event.payload.title : "",
			options,
			placeholder: typeof event.payload.placeholder === "string" ? event.payload.placeholder : undefined,
			prefill: typeof event.payload.prefill === "string" ? event.payload.prefill : undefined,
			allowOther: event.payload.allowOther === true,
			batchQuestions,
			batchReview,
		});

		const title = this.catalog.get(event.sessionId)?.title ?? this.catalog.getRecord(event.sessionId)?.title ?? "";

		const rawQuestion = typeof event.payload.title === "string" ? event.payload.title : "";
		const question = rawQuestion || (batchQuestions && batchQuestions[0]?.question ? batchQuestions[0].question : "");
		this.agents.notifyAskPending(event.agentId, event.sessionId, title, question);
	}

	listPendingUiRequests(sessionId?: string): PendingUiRequestSnapshot[] {
		const items: PendingUiRequestSnapshot[] = [];
		for (const pending of this.pendingUiRequests.values()) {
			if (sessionId && pending.sessionId !== sessionId) continue;
			items.push({ ...pending });
		}
		return items;
	}

	async respondToUi(input: SessionUiResponseInput): Promise<void> {
		const binding = this.getRuntimeBinding(input.agentId);
		if (!binding || binding.sessionId !== input.sessionId || binding.runtimeGeneration !== input.runtimeGeneration || this.agentIdBySession.get(input.sessionId) !== input.agentId) {
			throw new Error("Session runtime binding changed before UI response");
		}
		const key = this.uiRequestKey(input.sessionId, input.requestId);
		const pending = this.pendingUiRequests.get(key);
		if (!pending || pending.agentId !== input.agentId || pending.runtimeGeneration !== input.runtimeGeneration) {
			throw new Error("Session UI request is not pending");
		}
		this.pendingUiRequests.delete(key);
		try {
			await this.agents.sendUIResponse(input.agentId, input.requestId, input.response);
		} catch (error) {
			this.pendingUiRequests.set(key, pending);
			throw error;
		}
	}

	currentRuntimeGeneration(sessionId: string): number {
		return this.generationBySession.get(sessionId) ?? 0;
	}

	getRuntimeBinding(agentId: string):
		| {
				sessionId: string;
				runtimeGeneration: number;
		  }
		| undefined {
		const sessionId = this.sessionIdByAgent.get(agentId);
		if (!sessionId || this.agentIdBySession.get(sessionId) !== agentId) return undefined;
		return {
			sessionId,
			runtimeGeneration: this.generationBySession.get(sessionId) ?? 0,
		};
	}

	async replaceBoundRuntime<T extends { cancelled?: boolean }>(input: {
		agentId: string;
		replace: () => Promise<T>;
		resolveTargetSessionId: (result: T) => Promise<string>;
		canRestoreOrigin: () => boolean;
		onDetached: (binding: SessionRuntimeBinding) => void;
		onAttached: (binding: SessionRuntimeBinding) => void;
		onRestored: (binding: SessionRuntimeBinding) => void;
	}): Promise<T & { targetSessionId?: string }> {
		const replacement = this.beginRuntimeReplacement(input.agentId);
		if (!replacement) return input.replace();

		try {
			input.onDetached(replacement);
			const result = await input.replace();
			if (result.cancelled) {
				const restored = this.restoreRuntimeReplacement(replacement);
				input.onRestored(restored);
				return result;
			}
			const targetSessionId = await input.resolveTargetSessionId(result);

			this.lastAppliedBySession.delete(targetSessionId);
			await this.applyLatestPreferences(targetSessionId, input.agentId);
			const attached = this.completeRuntimeReplacement(replacement, targetSessionId);

			input.onAttached(attached);
			return { ...result, targetSessionId };
		} catch (error) {
			if (this.replacementByAgent.get(input.agentId) === replacement) {
				let canRestoreOrigin = false;
				try {
					canRestoreOrigin = input.canRestoreOrigin();
				} catch {}
				if (canRestoreOrigin) {
					const restored = this.restoreRuntimeReplacement(replacement);
					input.onRestored(restored);
				} else {
					this.failClosedRuntimeReplacement(replacement);
				}
			}
			throw error;
		}
	}

	unbindAgent(agentId: string): void {
		this.assertNoDispatchLease(undefined, agentId);
		this.unbindAgentUnchecked(agentId);
	}

	unbindTerminalAgent(agentId: string): void {
		this.unbindAgentUnchecked(agentId);
	}

	private unbindAgentUnchecked(agentId: string): void {
		const replacement = this.replacementByAgent.get(agentId);
		if (replacement) this.releaseRuntimeReplacement(replacement);
		const sessionId = this.sessionIdByAgent.get(agentId);
		if (sessionId) {
			this.agentIdBySession.delete(sessionId);
			this.clearPendingUiRequests(sessionId, agentId);

			const last = this.lastAppliedBySession.get(sessionId);
			if (last?.agentId === agentId) this.lastAppliedBySession.delete(sessionId);
			const lastRequest = this.lastRequestedThinkingBySession.get(sessionId);
			if (lastRequest?.agentId === agentId) this.lastRequestedThinkingBySession.delete(sessionId);
		}
		this.sessionIdByAgent.delete(agentId);
	}

	async restartSession(sessionId: string, agentId: string): Promise<AgentTab> {
		const entry = this.catalog.get(sessionId);
		if (!entry) throw new Error(`Session not found: ${sessionId}`);

		const boundAgentId = this.agentIdBySession.get(sessionId);
		if (boundAgentId && boundAgentId !== agentId) {
			throw new Error("Session runtime changed before restart");
		}

		await this.waitForNoDispatchLease(sessionId, agentId);
		const reservation = this.reserveBoundRuntime(sessionId, agentId);
		try {
			let tab = await this.agents.restart(agentId);
			if (tab.status === "starting") tab = await this.waitUntilReady(tab);
			if (isTerminalAgent(tab)) {
				this.unbindAgentUnchecked(agentId);
				throw new Error(`Failed to restart session runtime (${tab.status})`);
			}
			try {
				await this.applyLatestPreferences(sessionId, tab.id);
			} catch (error) {
				await this.agents.stop(tab.id).catch(() => undefined);
				this.unbindAgentUnchecked(agentId);
				throw new Error(`Failed to apply session preferences: ${errorMessage(error)}`);
			}

			this.requireCurrentReservation(reservation);
			this.releaseRuntimeReplacement(reservation);
			this.unbindAgentUnchecked(agentId);
			const runtimeGeneration = this.bind(sessionId, tab.id);
			tab.runtimeGeneration = runtimeGeneration;

			const restartPatch = this.buildAttachPatch(sessionId, tab, entry);
			if (restartPatch) {
				await this.catalog.attachRuntime(restartPatch);
			}

			await this.agents.publishRuntimeState(tab.id).catch(() => undefined);
			return tab;
		} finally {
			if (this.replacementByAgent.get(agentId) === reservation) {
				this.releaseRuntimeReplacement(reservation);
			}
		}
	}

	private async runtimeModelMismatch(sessionId: string, agentId: string): Promise<{ expected: string; actual: string } | undefined> {
		const entry = this.catalog.get(sessionId);
		const expected = entry?.model;
		if (!entry || !expected?.provider || !expected.modelId) return undefined;

		if (entry.backend === "acp" || entry.backend === "qoder") return undefined;
		let actual: SessionRuntimeModelSelection | undefined;
		try {
			actual = await this.agents.getRuntimeModelThinkingState?.(agentId);
		} catch {
			return undefined;
		}
		if (!actual?.provider || !actual.modelId) return undefined;
		if (actual.provider === expected.provider && actual.modelId === expected.modelId) return undefined;
		return { expected: `${expected.provider}/${expected.modelId}`, actual: `${actual.provider}/${actual.modelId}` };
	}

	private async sendOnce(input: SendSessionPromptInput): Promise<SendSessionPromptResult> {
		const pipelineStartedAt = Date.now();
		void this.logger?.info("session-perf", "Prompt pipeline started", {
			sessionId: input.sessionId,
			requestId: input.requestId,
		});
		let tab: AgentTab;
		try {
			void this.logger?.info("session-perf", "Runtime activation started", {
				sessionId: input.sessionId,
				requestId: input.requestId,
			});
			tab = await this.ensureRuntime(input.sessionId);
			void this.logger?.info("session-perf", "Runtime activation completed", {
				sessionId: input.sessionId,
				requestId: input.requestId,
				agentId: tab.id,
				activationMs: Date.now() - pipelineStartedAt,
			});
		} catch (error) {
			return this.rejected(input, errorMessage(error), descriptorFromThrownError(error));
		}

		let lease: DispatchLease;
		try {
			lease = this.acquireDispatchLease(input.sessionId, tab.id);
		} catch (error) {
			return this.rejected(input, errorMessage(error));
		}

		try {
			if (!this.isCurrentDispatchLease(lease)) {
				return this.unknownDelivery(input, "Session runtime binding changed before prompt dispatch");
			}

			if (input.requireAppliedModel) {
				const mismatch = await this.runtimeModelMismatch(input.sessionId, lease.agentId);

				if (!this.isCurrentDispatchLease(lease)) {
					return this.rejected(input, "Session runtime binding changed before prompt dispatch");
				}
				if (mismatch) {
					void this.logger?.warn("session-runtime", "Refused prompt dispatch: runtime model differs from session selection", {
						sessionId: input.sessionId,
						requestId: input.requestId,
						agentId: lease.agentId,
						expected: mismatch.expected,
						actual: mismatch.actual,
					});
					return this.rejected(input, `Session model unavailable: expected ${mismatch.expected}, runtime is ${mismatch.actual}`, {
						i18nKey: "diagnostic.promptModelMismatch",
						i18nParams: { expected: mismatch.expected, actual: mismatch.actual },
						debugDetails: `expected ${mismatch.expected}, actual ${mismatch.actual}`,
					});
				}
			}

			let result: SendPromptResult;
			const dispatchStartedAt = Date.now();
			void this.logger?.info("session-perf", "Prompt dispatch started", {
				sessionId: input.sessionId,
				requestId: input.requestId,
				agentId: lease.agentId,
			});
			try {
				result = await this.sendAgentPrompt({
					agentId: lease.agentId,
					message: input.message,
					images: input.images,
					streamingBehavior: input.streamingBehavior,
					agentMessage: input.agentMessage,
					description: input.description,
					requestId: input.requestId,
				});
				void this.logger?.info("session-perf", "Prompt dispatch completed", {
					sessionId: input.sessionId,
					requestId: input.requestId,
					agentId: lease.agentId,
					accepted: result.accepted,
					dispatchMs: Date.now() - dispatchStartedAt,
				});
			} catch (error) {
				result = {
					accepted: false,
					error: errorMessage(error),
					delivery: "unknown",
				};
			}
			if (!this.isCurrentDispatchLease(lease)) {
				return this.unknownDelivery(input, "Session runtime binding changed during prompt dispatch");
			}
			const currentTab = this.agents.list().find((candidate) => candidate.id === lease.agentId && !isTerminalAgent(candidate));
			if (!currentTab) {
				return this.unknownDelivery(input, "Session runtime stopped during prompt dispatch");
			}

			const dispatchEntry = this.catalog.get(input.sessionId);
			const dispatchPatch = dispatchEntry ? this.buildAttachPatch(input.sessionId, currentTab, dispatchEntry) : null;
			if (dispatchPatch) {
				void this.catalog
					.attachRuntime({
						...dispatchPatch,
						promoteToActive: true,
					})
					.catch(() => undefined);
			}
			if (!this.isCurrentDispatchLease(lease)) {
				return this.unknownDelivery(input, "Session runtime binding changed after prompt dispatch");
			}
			return {
				...result,
				sessionId: input.sessionId,
				requestId: input.requestId,
				agentId: lease.agentId,
				sessionPath: currentTab.sessionPath,
				runtimeGeneration: lease.runtimeGeneration,
			};
		} finally {
			this.releaseDispatchLease(lease);
		}
	}

	private ensureRuntime(sessionId: string): Promise<AgentTab> {
		const canonicalSessionId = this.canonicalSessionId(sessionId);
		const existing = this.activationBySession.get(canonicalSessionId);
		if (existing) return existing;
		const activation = this.activate(canonicalSessionId).finally(() => {
			this.activationBySession.delete(canonicalSessionId);
		});
		this.activationBySession.set(canonicalSessionId, activation);
		return activation;
	}

	private canonicalSessionId(sessionId: string): string {
		return this.catalog.resolveSessionId?.(sessionId) ?? sessionId;
	}

	private canonicalTarget(target: SessionRuntimeTarget): SessionRuntimeTarget {
		const sessionId = this.canonicalSessionId(target.sessionId);
		return sessionId === target.sessionId ? target : { ...target, sessionId };
	}

	private async activate(sessionId: string): Promise<AgentTab> {
		if (this.deletingSessions.has(sessionId)) {
			throw new Error(`Session is being deleted: ${sessionId}`);
		}
		const entry = this.catalog.get(sessionId);
		if (!entry) throw new Error(`Session not found: ${sessionId}`);
		if (this.replacementBySession.has(sessionId)) {
			throw new Error(`Session runtime replacement reservation conflict: ${sessionId}`);
		}

		const mappedAgentId = this.getAgentId(sessionId);
		if (mappedAgentId) {
			const mappedTab = this.agents.list().find((candidate) => candidate.id === mappedAgentId);
			if (mappedTab) {
				if (isTerminalAgent(mappedTab) && !this.reviveTerminalAgent(mappedTab.id)) {
					throw this.startupFailure(mappedTab);
				}
				const ready = await this.waitUntilReady(mappedTab);

				try {
					const applied = await this.applyLatestPreferences(sessionId, ready.id);
					if (applied) {
						await this.agents.publishRuntimeState(ready.id).catch(() => undefined);
					}
				} catch (error) {
					throw new Error(`Failed to apply session preferences: ${errorMessage(error)}`);
				}
				return ready;
			}
		}

		let tab = entry.filePath ? this.findAgentBySessionPath(entry) : undefined;
		if (tab && isTerminalAgent(tab)) {
			if (!this.reviveTerminalAgent(tab.id)) {
				await this.agents.stop(tab.id);
				tab = undefined;
			}
		}
		if (tab?.status === "starting") tab = await this.waitUntilReady(tab);

		const created = !tab;
		if (!tab) {
			if (entry.backend !== "acp" && entry.backend !== "qoder" && !entry.filePath) {
				tab = (await this.agents.claimStandbyAgent?.({ projectId: entry.projectId, sessionId, noSession: entry.noSession }).catch(() => null)) ?? undefined;
			}
		}
		if (!tab) {
			tab = await this.agents.create({
				projectId: entry.projectId,
				title: entry.title,
				deckSessionId: sessionId,
				sessionPath: entry.filePath,
				environment: entry.environment,
				source: entry.source,
				backend: entry.backend,

				acpSessionId: entry.backend === "acp" ? entry.acpSessionId : undefined,
				qoderSessionId: entry.backend === "qoder" ? entry.qoderSessionId : undefined,
				...(entry.backend === "acp" ? { agentPreset: entry.acpToolId ?? entry.agentPreset } : {}),
				wslDistro: entry.wslDistro,
				wslUser: entry.wslUser,
				importedSourceId: entry.importedSourceId,
				noSession: entry.noSession,
			});
		}
		if (tab.status === "starting") tab = await this.waitUntilReady(tab);
		if (isTerminalAgent(tab)) {
			if (created) await this.agents.stop(tab.id).catch(() => undefined);
			throw this.startupFailure(tab);
		}

		try {
			await this.applyLatestPreferences(sessionId, tab.id);
		} catch (error) {
			if (created) {
				if (tab.backend === "acp" && tab.sessionId) {
					await this.catalog.attachRuntime({ sessionId, acpSessionId: tab.sessionId }).catch(() => undefined);
				}
				if (tab.backend === "qoder" && tab.sessionId) {
					await this.catalog.attachRuntime({ sessionId, qoderSessionId: tab.sessionId }).catch(() => undefined);
				}
				await this.agents.stop(tab.id).catch(() => undefined);
			}
			throw new Error(`Failed to apply session preferences: ${errorMessage(error)}`);
		}

		const runtimeGeneration = this.bind(sessionId, tab.id);
		tab.runtimeGeneration = runtimeGeneration;

		const activatePatch = this.buildAttachPatch(sessionId, tab, entry);
		if (activatePatch) {
			await this.catalog.attachRuntime(activatePatch);
		}

		await this.agents.publishRuntimeState(tab.id).catch(() => undefined);

		if (entry.backend !== "acp" && entry.backend !== "qoder") this.agents.ensureStandbyAgent?.(entry.projectId);
		return tab;
	}

	private buildAttachPatch(
		sessionId: string,
		tab: Pick<AgentTab, "sessionPath" | "sessionId" | "backend" | "agentPreset">,
		entry: Pick<SessionCatalogEntry, "noSession" | "backend">,
	): { sessionId: string; filePath?: string; piSessionId?: string; acpSessionId?: string; qoderSessionId?: string; agentPreset?: string; promoteToActive?: boolean } | null {
		if (entry.backend === "acp") {
			return tab.sessionId && !entry.noSession ? { sessionId, acpSessionId: tab.sessionId, ...(tab.agentPreset ? { agentPreset: tab.agentPreset } : {}) } : null;
		}
		if (entry.backend === "qoder") {
			return tab.sessionId && !entry.noSession ? { sessionId, qoderSessionId: tab.sessionId } : null;
		}
		if (tab.sessionPath && !entry.noSession) {
			return {
				sessionId,
				filePath: tab.sessionPath,
				piSessionId: tab.sessionId,
			};
		}
		return null;
	}

	private findAgentBySessionPath(entry: SessionCatalogEntry): AgentTab | undefined {
		if (!entry.filePath) return undefined;
		const target = buildSessionOriginKey({
			source: entry.source,
			environment: entry.environment,
			filePath: entry.filePath,
			wslDistro: entry.wslDistro,
			wslUser: entry.wslUser,
			importedSourceId: entry.importedSourceId,
		});
		return this.agents.list().find(
			(tab) =>
				!this.replacementByAgent.has(tab.id) &&
				tab.sessionPath &&
				buildSessionOriginKey({
					source: tab.sessionSource ?? "pi",
					environment: tab.sessionEnvironment ?? "native",
					filePath: tab.sessionPath,
					wslDistro: tab.wslDistro,
					wslUser: tab.wslUser,
					importedSourceId: tab.importedSourceId,
				}) === target,
		);
	}

	private async applyLatestPreferences(sessionId: string, agentId: string): Promise<boolean> {
		const latest = this.catalog.get(sessionId);
		if (!latest) throw new Error(`Session not found: ${sessionId}`);
		const preferences = snapshotPreferences(latest);
		const last = this.lastAppliedBySession.get(sessionId);
		if (last?.agentId === agentId && sameAppliedPreferences(last.preferences, preferences)) {
			return false;
		}
		await this.applyPreferences(latest, agentId);
		this.lastAppliedBySession.set(sessionId, { agentId, preferences });
		this.lastRequestedThinkingBySession.delete(sessionId);
		return true;
	}

	private async applyPreferences(entry: SessionCatalogEntry, agentId: string): Promise<void> {
		if (entry.model) {
			try {
				await this.agents.setModel(agentId, entry.model.provider, entry.model.modelId);
			} catch (error) {
				const modelGoneOnPi = this.isModelGoneError(error);
				if (!modelGoneOnPi) throw error;
				void this.logger?.warn("session-runtime", "pi model preference ignored: model no longer exists", {
					sessionId: entry.id,
					provider: entry.model.provider,
					modelId: entry.model.modelId,
					error: errorMessage(error),
				});
				this.agents.notifyModelPreferenceIgnored?.(agentId, entry.model.provider, entry.model.modelId);
			}
		}
		if (entry.thinkingLevel) {
			await this.agents.setThinking(agentId, entry.thinkingLevel);
		}
	}

	private isModelGoneError(error: unknown): boolean {
		if ((error as { needsRestart?: unknown } | null)?.needsRestart === true) {
			return false;
		}
		return /model not found/i.test(errorMessage(error));
	}

	private reviveTerminalAgent(agentId: string): boolean {
		if (typeof this.agents.reviveIfProcessAlive !== "function") return false;
		const revived = this.agents.reviveIfProcessAlive(agentId);
		if (revived) {
			void this.logger?.info("session-runtime", "Terminal agent revived with live process", {
				agentId,
			});
		}
		return revived;
	}

	private async waitUntilReady(initialTab: AgentTab): Promise<AgentTab> {
		const startedAt = Date.now();
		let tab = initialTab;
		while (tab.status === "starting") {
			if (Date.now() - startedAt >= AGENT_READY_TIMEOUT_MS) {
				throw new Error("Timed out while starting session runtime");
			}
			await new Promise<void>((resolve) => setTimeout(resolve, 50));
			const current = this.agents.list().find((candidate) => candidate.id === tab.id);
			if (!current) throw new Error("Session runtime stopped while starting");
			tab = current;
		}
		if (isTerminalAgent(tab)) {
			throw this.startupFailure(tab);
		}
		return tab;
	}

	private startupFailure(tab: AgentTab): Error {
		try {
			const diagnostic = [...this.agents.getMessages(tab.id)].reverse().find((message) => message.role === "error");
			const debugDetails = diagnostic?.meta?.debugDetails;
			if (typeof debugDetails === "string" && debugDetails.trim()) {
				return new Error(debugDetails);
			}
			if (diagnostic?.text?.trim()) return new Error(diagnostic.text);
		} catch {}
		return new Error(`Failed to start session runtime (${tab.status})`);
	}

	private bind(sessionId: string, agentId: string): number {
		if (this.deletingSessions.has(sessionId)) {
			throw new Error(`Session is being deleted: ${sessionId}`);
		}
		this.assertNoDispatchLease(sessionId, agentId);
		if (this.replacementByAgent.has(agentId)) {
			throw new Error(`Session runtime replacement already in progress: ${agentId}`);
		}
		if (this.replacementBySession.has(sessionId)) {
			throw new Error(`Session runtime replacement reservation conflict: ${sessionId}`);
		}
		const previousAgentId = this.agentIdBySession.get(sessionId);
		if (previousAgentId === agentId && this.sessionIdByAgent.get(agentId) === sessionId) {
			return this.generationBySession.get(sessionId) ?? 0;
		}
		if (previousAgentId && previousAgentId !== agentId) {
			this.sessionIdByAgent.delete(previousAgentId);
			this.clearPendingUiRequests(sessionId, previousAgentId);
		}
		const previousSessionId = this.sessionIdByAgent.get(agentId);
		if (previousSessionId && previousSessionId !== sessionId) {
			this.agentIdBySession.delete(previousSessionId);
			this.clearPendingUiRequests(previousSessionId, agentId);
		}
		this.clearPendingUiRequests(sessionId);
		const runtimeGeneration = (this.generationBySession.get(sessionId) ?? 0) + 1;
		this.generationBySession.set(sessionId, runtimeGeneration);
		this.agentIdBySession.set(sessionId, agentId);
		this.sessionIdByAgent.set(agentId, sessionId);
		const tab = this.agents.list().find((candidate) => candidate.id === agentId);
		if (tab) tab.runtimeGeneration = runtimeGeneration;
		return runtimeGeneration;
	}

	private beginRuntimeReplacement(agentId: string): RuntimeReplacement | undefined {
		const binding = this.getRuntimeBinding(agentId);
		if (!binding) return undefined;
		this.assertNoDispatchLease(binding.sessionId, agentId);
		if (this.replacementByAgent.has(agentId)) {
			throw new Error(`Session runtime replacement already in progress: ${agentId}`);
		}
		if (this.replacementBySession.has(binding.sessionId)) {
			throw new Error(`Session runtime replacement reservation conflict: ${binding.sessionId}`);
		}
		const runtimeGeneration = binding.runtimeGeneration + 1;
		this.generationBySession.set(binding.sessionId, runtimeGeneration);
		this.agentIdBySession.delete(binding.sessionId);
		this.sessionIdByAgent.delete(agentId);
		this.clearPendingUiRequests(binding.sessionId, agentId);
		const replacement: RuntimeReplacement = {
			...binding,
			agentId,
			runtimeGeneration,
			replacementId: ++this.replacementSequence,
		};
		this.replacementByAgent.set(agentId, replacement);
		this.replacementBySession.set(binding.sessionId, replacement);
		return replacement;
	}

	private completeRuntimeReplacement(replacement: RuntimeReplacement, targetSessionId: string): SessionRuntimeBinding {
		this.requireCurrentReplacement(replacement);
		if (!this.catalog.get(targetSessionId)) {
			throw new Error(`Session not found: ${targetSessionId}`);
		}
		const targetAgentId = this.getAgentId(targetSessionId);
		if (targetAgentId && targetAgentId !== replacement.agentId) {
			throw new Error(`Session runtime target already bound: ${targetSessionId}`);
		}
		const targetReplacement = this.replacementBySession.get(targetSessionId);
		if (targetReplacement && targetReplacement !== replacement) {
			throw new Error(`Session runtime replacement reservation conflict: ${targetSessionId}`);
		}
		this.releaseRuntimeReplacement(replacement);
		return {
			sessionId: targetSessionId,
			agentId: replacement.agentId,
			runtimeGeneration: this.bind(targetSessionId, replacement.agentId),
		};
	}

	private restoreRuntimeReplacement(replacement: RuntimeReplacement): SessionRuntimeBinding {
		this.requireCurrentReplacement(replacement);
		this.releaseRuntimeReplacement(replacement);
		return {
			sessionId: replacement.sessionId,
			agentId: replacement.agentId,
			runtimeGeneration: this.bind(replacement.sessionId, replacement.agentId),
		};
	}

	private failClosedRuntimeReplacement(replacement: RuntimeReplacement): void {
		this.requireCurrentReplacement(replacement);
		this.releaseRuntimeReplacement(replacement);
	}

	private releaseRuntimeReplacement(replacement: RuntimeReplacement): void {
		if (this.replacementByAgent.get(replacement.agentId) === replacement) {
			this.replacementByAgent.delete(replacement.agentId);
		}
		if (this.replacementBySession.get(replacement.sessionId) === replacement) {
			this.replacementBySession.delete(replacement.sessionId);
		}
	}

	private requireCurrentReplacement(replacement: RuntimeReplacement): void {
		if (this.replacementByAgent.get(replacement.agentId) !== replacement) {
			throw new Error("Session runtime replacement binding changed");
		}
		if (this.replacementBySession.get(replacement.sessionId) !== replacement) {
			throw new Error("Session runtime replacement reservation changed");
		}
		if (this.sessionIdByAgent.has(replacement.agentId) || this.agentIdBySession.get(replacement.sessionId) === replacement.agentId) {
			throw new Error("Session runtime replacement acquired a competing binding");
		}
	}

	private reserveBoundRuntime(sessionId: string, agentId: string, opts: { ignoreDispatchLease?: boolean } = {}): RuntimeReplacement {
		const binding = this.getRuntimeBinding(agentId);
		if (!binding || binding.sessionId !== sessionId || this.agentIdBySession.get(sessionId) !== agentId) {
			throw new Error("Session runtime changed before reservation");
		}

		if (!opts.ignoreDispatchLease) this.assertNoDispatchLease(sessionId, agentId);
		if (this.replacementByAgent.has(agentId)) {
			throw new Error(`Session runtime replacement already in progress: ${agentId}`);
		}
		if (this.replacementBySession.has(sessionId)) {
			throw new Error(`Session runtime replacement reservation conflict: ${sessionId}`);
		}
		const reservation: RuntimeReplacement = {
			...binding,
			agentId,
			replacementId: ++this.replacementSequence,
		};
		this.replacementByAgent.set(agentId, reservation);
		this.replacementBySession.set(sessionId, reservation);
		return reservation;
	}

	private requireCurrentReservation(reservation: RuntimeReplacement): void {
		if (this.replacementByAgent.get(reservation.agentId) !== reservation || this.replacementBySession.get(reservation.sessionId) !== reservation) {
			throw new Error("Session runtime reservation changed");
		}
		const binding = this.getRuntimeBinding(reservation.agentId);
		if (!binding || binding.sessionId !== reservation.sessionId || binding.runtimeGeneration !== reservation.runtimeGeneration) {
			throw new Error("Session runtime binding changed during reservation");
		}
	}

	private runtimeInfo(sessionId: string, tab: AgentTab): SessionRuntimeInfo {
		const target = this.getTarget(sessionId);
		if (!target || target.agentId !== tab.id) {
			throw new SessionRuntimeCommandError("SESSION_RUNTIME_CHANGED", "Session runtime binding changed while building runtime state");
		}
		return {
			...target,
			projectId: tab.projectId,
			cwd: tab.cwd,
			status: tab.status,
			sessionPath: tab.sessionPath,
			createdAt: tab.createdAt,
			compactionCount: tab.compactionCount,
			noSession: tab.noSession,

			deckSessionId: tab.deckSessionId,
		};
	}

	private requireTarget(target: SessionRuntimeTarget): SessionRuntimeBinding {
		if (!this.catalog.get(target.sessionId)) {
			throw new SessionRuntimeCommandError("SESSION_NOT_FOUND", `Session not found: ${target.sessionId}`);
		}
		return this.requireBoundTarget(target);
	}

	private resolveStopTarget(target: SessionRuntimeTarget): SessionRuntimeTarget {
		const live = this.getRuntimeBinding(target.agentId);
		if (live) {
			return {
				sessionId: live.sessionId,
				agentId: target.agentId,
				runtimeGeneration: live.runtimeGeneration,
			};
		}
		if (!this.catalog.get(target.sessionId)) {
			throw new SessionRuntimeCommandError("SESSION_NOT_FOUND", `Session not found: ${target.sessionId}`);
		}
		throw new SessionRuntimeCommandError("SESSION_RUNTIME_UNAVAILABLE", "Session runtime is not available");
	}

	private requireBoundTarget(target: SessionRuntimeTarget): SessionRuntimeBinding {
		const binding = this.getRuntimeBinding(target.agentId);
		if (!binding || this.agentIdBySession.get(target.sessionId) !== target.agentId) {
			throw new SessionRuntimeCommandError("SESSION_RUNTIME_UNAVAILABLE", "Session runtime is not available");
		}
		if (binding.sessionId !== target.sessionId || binding.runtimeGeneration !== target.runtimeGeneration) {
			throw new SessionRuntimeCommandError("SESSION_RUNTIME_CHANGED", "Session runtime binding changed");
		}
		return { ...target };
	}

	private serializePreferenceMutation<T>(sessionId: string, operation: () => Promise<T>): Promise<T> {
		const previous = this.preferenceMutationTails.get(sessionId) ?? Promise.resolve();
		const current = previous.then(operation, operation);
		const tail = current.then(
			() => undefined,
			() => undefined,
		);
		this.preferenceMutationTails.set(sessionId, tail);
		void tail.then(() => {
			if (this.preferenceMutationTails.get(sessionId) === tail) this.preferenceMutationTails.delete(sessionId);
		});
		return current;
	}

	private async runTargetCommand<T>(target: SessionRuntimeTarget, operation: (agentId: string) => Promise<T>): Promise<SessionCommandResult<SessionTargetedValue<T>>> {
		let lease: DispatchLease | undefined;
		try {
			const canonical = this.canonicalTarget(target);
			this.requireTarget(canonical);
			lease = this.acquireDispatchLease(canonical.sessionId, canonical.agentId);
			if (lease.runtimeGeneration !== canonical.runtimeGeneration) {
				throw new SessionRuntimeCommandError("SESSION_RUNTIME_CHANGED", "Session runtime generation changed before command dispatch");
			}
			const value = await operation(lease.agentId);
			if (!this.isCurrentDispatchLease(lease)) {
				throw new SessionRuntimeCommandError("SESSION_RUNTIME_CHANGED", "Session runtime binding changed during command dispatch");
			}
			return {
				ok: true,
				value: {
					target: {
						sessionId: lease.sessionId,
						agentId: lease.agentId,
						runtimeGeneration: lease.runtimeGeneration,
					},
					value,
				},
			};
		} catch (error) {
			return this.commandFailure(error);
		} finally {
			if (lease) this.releaseDispatchLease(lease);
		}
	}

	private async mutateCatalogMessage(
		requestedSessionId: string,
		messageId: string,
		operation: "edit" | "delete" | "resend" | "remove-image",
		newText?: string,

		entryId?: string,
		imageTarget?: SessionMessageImageTarget,
	): Promise<SessionCommandResult<{ text: string; images?: ImageContent[] } | undefined>> {
		try {
			const sessionId = this.canonicalSessionId(requestedSessionId);
			const entry = this.catalog.get(sessionId);
			if (!entry) {
				throw new SessionRuntimeCommandError("SESSION_NOT_FOUND", `Session not found: ${sessionId}`);
			}
			if (entry.backend === "imagegen" || entry.backend === "acp" || entry.backend === "qoder") {
				throw new SessionRuntimeCommandError("SESSION_COMMAND_FAILED", `backend "${entry.backend}" does not support persisted session message mutation`);
			}
			if (!entry.filePath) {
				throw new SessionRuntimeCommandError("SESSION_COMMAND_FAILED", "Session not persisted");
			}
			this.requireStoppedForFileMutation(sessionId);

			if (typeof this.agents.mutatePersistedSessionMessage !== "function") {
				throw new SessionRuntimeCommandError("SESSION_COMMAND_FAILED", `backend "${this.agents.backend}" does not support persisted session message mutation`);
			}
			const value = await this.agents.mutatePersistedSessionMessage(entry.filePath, messageId, operation, {
				newText,
				environment: entry.environment,
				wslDistro: entry.wslDistro,
				entryId,
				imageTarget,
			});

			try {
				this.requireStoppedForFileMutation(sessionId);
			} catch (busyError) {
				void this.logger?.warn("session-runtime", "Session file mutated while runtime re-activated; mutation already persisted", {
					sessionId,
					messageId,
					operation,
				});
			}
			void this.logger?.info("session-runtime", "Catalog session message mutated", {
				sessionId,
				messageId,
				operation,
			});
			return { ok: true, value };
		} catch (error) {
			return this.commandFailure(error);
		}
	}

	private requireStoppedForFileMutation(sessionId: string): void {
		if (this.getTarget(sessionId) || this.isActivating(sessionId)) {
			throw new SessionRuntimeCommandError("SESSION_RUNTIME_BUSY", "Stop the running agent before mutating the session file");
		}
	}

	private commandFailure<T>(error: unknown): SessionCommandResult<T> {
		if (error instanceof SessionRuntimeCommandError) {
			return {
				ok: false,
				error: { code: error.code, debugDetails: error.message },
			};
		}

		if (error instanceof Error && (error as Error & { needsRestart?: boolean }).needsRestart) {
			return {
				ok: false,
				error: {
					code: "SESSION_MODEL_NOT_FOUND",
					debugDetails: error.message,
					needsRestart: true,

					params: { model: this.extractModelFromNotFound(error.message) ?? error.message },
				},
			};
		}
		const message = errorMessage(error);
		const lower = message.toLowerCase();
		const model = this.extractModelFromNotFound(message);
		const editorCode = this.sessionFileEditorErrorCode(error);
		const code: SessionCommandErrorCode =
			editorCode === "SESSION_FILE_TOO_LARGE"
				? "SESSION_FILE_TOO_LARGE"
				: editorCode === "SESSION_ENTRY_NOT_FOUND" || lower.includes("message not found") || lower.includes("not found on the active session branch") || lower.includes("not part of the active session branch") || lower.includes("already been deleted") || lower.includes("no longer present in the file")
					? "MESSAGE_NOT_FOUND"
					: lower.includes("agent not found")
						? "SESSION_RUNTIME_UNAVAILABLE"
						: lower.includes("model not found")
							? "SESSION_MODEL_NOT_FOUND"
							: lower.includes("not found")
								? "SESSION_NOT_FOUND"
								: lower.includes("busy") || lower.includes("in progress") || lower.includes("stream")
									? "SESSION_RUNTIME_BUSY"
									: lower.includes("binding") || lower.includes("generation") || lower.includes("changed")
										? "SESSION_RUNTIME_CHANGED"
										: lower.includes("runtime") && lower.includes("available")
											? "SESSION_RUNTIME_UNAVAILABLE"
											: "SESSION_COMMAND_FAILED";
		return {
			ok: false,
			error: {
				code,
				debugDetails: message,

				...(code === "SESSION_MODEL_NOT_FOUND" && model ? { params: { model } } : {}),
				...(code === "SESSION_FILE_TOO_LARGE" ? { params: this.sessionFileSizeParams(error) } : {}),
			},
		};
	}

	private sessionFileSizeParams(error: unknown): Record<string, number> {
		const details = (error as { details?: Record<string, unknown> } | null)?.details;
		const size = typeof details?.size === "number" ? details.size : undefined;
		const limit = typeof details?.limit === "number" ? details.limit : undefined;
		const { sizeMb, limitMb } = sessionFileSizeMb({ size, limit });
		return { sizeMb, limitMb };
	}

	private extractModelFromNotFound(message: string): string | undefined {
		const match = /model not found\s*:?\s*(.+)$/i.exec(message);
		return match?.[1]?.trim() || undefined;
	}

	private sessionFileEditorErrorCode(error: unknown): string | undefined {
		if (!error || typeof error !== "object" || !("code" in error)) return undefined;
		const code = (error as { code?: unknown }).code;
		return typeof code === "string" && code.startsWith("SESSION_") ? code : undefined;
	}

	private acquireDispatchLease(sessionId: string, agentId: string): DispatchLease {
		if (this.replacementBySession.has(sessionId) || this.replacementByAgent.has(agentId)) {
			throw new Error("Session runtime replacement is in progress");
		}
		const binding = this.getRuntimeBinding(agentId);
		if (!binding || binding.sessionId !== sessionId) {
			throw new Error("Session runtime binding changed before prompt dispatch");
		}
		const lease: DispatchLease = {
			...binding,
			agentId,
			leaseId: ++this.dispatchLeaseSequence,
		};
		this.addDispatchLease(this.dispatchLeasesBySession, sessionId, lease);
		this.addDispatchLease(this.dispatchLeasesByAgent, agentId, lease);
		return lease;
	}

	private addDispatchLease(leases: Map<string, Set<DispatchLease>>, key: string, lease: DispatchLease): void {
		const current = leases.get(key) ?? new Set<DispatchLease>();
		current.add(lease);
		leases.set(key, current);
	}

	private releaseDispatchLease(lease: DispatchLease): void {
		for (const [leases, key] of [
			[this.dispatchLeasesBySession, lease.sessionId],
			[this.dispatchLeasesByAgent, lease.agentId],
		] as const) {
			const current = leases.get(key);
			if (!current) continue;
			current.delete(lease);
			if (current.size === 0) leases.delete(key);
		}
	}

	private isCurrentDispatchLease(lease: DispatchLease): boolean {
		if (!this.dispatchLeasesBySession.get(lease.sessionId)?.has(lease) || !this.dispatchLeasesByAgent.get(lease.agentId)?.has(lease)) return false;
		const binding = this.getRuntimeBinding(lease.agentId);
		return Boolean(binding && binding.sessionId === lease.sessionId && binding.runtimeGeneration === lease.runtimeGeneration && this.agentIdBySession.get(lease.sessionId) === lease.agentId);
	}

	private hasDispatchLease(sessionId?: string, agentId?: string): boolean {
		return Boolean((sessionId && this.dispatchLeasesBySession.get(sessionId)?.size) || (agentId && this.dispatchLeasesByAgent.get(agentId)?.size));
	}

	private async waitForNoDispatchLease(sessionId: string, agentId: string, timeoutMs = 2000): Promise<void> {
		const deadline = Date.now() + timeoutMs;
		while (this.hasDispatchLease(sessionId, agentId)) {
			if (Date.now() >= deadline) return;
			await new Promise<void>((resolve) => setTimeout(resolve, 50));
		}
	}

	private assertNoDispatchLease(sessionId?: string, agentId?: string): void {
		if (this.hasDispatchLease(sessionId, agentId)) {
			throw new Error("Session runtime prompt dispatch is in progress");
		}
	}

	private uiRequestKey(sessionId: string, requestId: string): string {
		return `${sessionId}\u0000${requestId}`;
	}

	private hasPendingUiRequest(sessionId: string, agentId: string): boolean {
		for (const pending of this.pendingUiRequests.values()) {
			if (pending.sessionId === sessionId && pending.agentId === agentId) return true;
		}
		return false;
	}

	private clearPendingUiRequests(sessionId: string, agentId?: string): void {
		for (const [key, pending] of this.pendingUiRequests) {
			if (pending.sessionId === sessionId && (!agentId || pending.agentId === agentId)) {
				this.pendingUiRequests.delete(key);
			}
		}
	}

	private pruneDeliveryCache(): void {
		const now = Date.now();
		for (const [key, entry] of this.deliveryByRequest) {
			if (entry.settled && now - entry.createdAt > DELIVERY_CACHE_TTL_MS) {
				this.deliveryByRequest.delete(key);
			}
		}
		if (this.deliveryByRequest.size <= DELIVERY_CACHE_MAX_ENTRIES) return;
		for (const [key, entry] of this.deliveryByRequest) {
			if (!entry.settled) continue;
			this.deliveryByRequest.delete(key);
			if (this.deliveryByRequest.size <= DELIVERY_CACHE_MAX_ENTRIES) break;
		}
	}

	private rejected(
		input: Pick<SendSessionPromptInput, "sessionId" | "requestId">,
		error: string,
		descriptor: I18nDescriptor = {
			i18nKey: "diagnostic.promptRejected",
			debugDetails: error,
		},
	): SendSessionPromptResult {
		return {
			accepted: false,
			delivery: "rejected",
			error,
			...descriptor,
			sessionId: input.sessionId,
			requestId: input.requestId,
		};
	}

	private unknownDelivery(input: Pick<SendSessionPromptInput, "sessionId" | "requestId">, error: string): SendSessionPromptResult {
		return {
			accepted: false,
			delivery: "unknown",
			error,
			i18nKey: "diagnostic.promptDeliveryUnknown",
			debugDetails: error,
			sessionId: input.sessionId,
			requestId: input.requestId,
		};
	}
}
