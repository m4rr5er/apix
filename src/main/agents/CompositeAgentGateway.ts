import type {
	AgentBackend,
	AgentGatewayCapability,
	AgentRuntimeState,
	AgentTab,
	AvailableModel,
	ChatMessage,
	CreateAgentInput,
	ImageContent,
	SessionMessageImageTarget,
	PiCommand,
	RewindCheckpointPage,
	RewindCheckpointPageParams,
	RewindRestoreResult,
	RewindRestoreScope,
	SendPromptInput,
	SendPromptResult,
	SessionRuntimeModelSelection,
	SessionUiResponseInput,
} from "../../shared/types";
import type { SessionAgentGateway } from "../sessions/SessionRuntimeCoordinator";

export class CompositeAgentGateway implements SessionAgentGateway {
	private readonly byBackend = new Map<AgentBackend, SessionAgentGateway>();
	private readonly ownerByAgent = new Map<string, SessionAgentGateway>();

	constructor(
		private readonly gateways: SessionAgentGateway[],
		private readonly defaultBackend: AgentBackend = "pi",
	) {
		for (const gateway of gateways) {
			this.byBackend.set(gateway.backend, gateway);
		}
	}

	get backend(): AgentBackend {
		return this.defaultBackend;
	}

	get capabilities(): ReadonlySet<AgentGatewayCapability> {
		const union = new Set<AgentGatewayCapability>();
		for (const gateway of this.gateways) {
			for (const capability of gateway.capabilities) union.add(capability);
		}
		return union;
	}

	private resolveBackend(backend: AgentBackend | undefined): SessionAgentGateway {
		const target = backend ?? this.defaultBackend;
		const gateway = this.byBackend.get(target);
		if (!gateway) {
			throw new Error(`CompositeAgentGateway: no gateway for backend "${target}"`);
		}
		return gateway;
	}

	private owner(agentId: string): SessionAgentGateway {
		const cached = this.ownerByAgent.get(agentId);
		if (cached) return cached;
		for (const gateway of this.gateways) {
			if (gateway.list().some((tab) => tab.id === agentId)) {
				this.ownerByAgent.set(agentId, gateway);
				return gateway;
			}
		}
		throw new Error(`CompositeAgentGateway: no gateway owns agent "${agentId}"`);
	}

	private requireCapability(gateway: SessionAgentGateway, method: "getCommands" | "reloadResources" | "exportHtml" | "editMessage" | "deleteMessage" | "listCheckpoints" | "getCheckpointDiff" | "restoreCheckpoint"): void {
		if (typeof gateway[method] !== "function") {
			throw new Error(`CompositeAgentGateway: backend "${gateway.backend}" does not support ${method}`);
		}
	}

	list(): AgentTab[] {
		return this.gateways.flatMap((gateway) => gateway.list());
	}

	getMessageWindow(agentId: string): {
		messages: ChatMessage[];
		windowStart?: number;
		totalLength: number;
		fileVersion?: string;
		windowStartFilePos?: number;
	} {
		const gateway = this.owner(agentId);
		const ownerWindow = (gateway as { getMessageWindow?: (id: string) => { messages: ChatMessage[]; windowStart?: number; totalLength: number; fileVersion?: string; windowStartFilePos?: number } }).getMessageWindow;
		if (typeof ownerWindow === "function") return ownerWindow.call(gateway, agentId);
		const messages = gateway.getMessages(agentId);
		return { messages, totalLength: messages.length };
	}

	async sendPrompt(input: SendPromptInput): Promise<SendPromptResult> {
		return this.owner(input.agentId).sendPrompt(input);
	}

	getMessages(agentId: string): ChatMessage[] {
		return this.owner(agentId).getMessages(agentId);
	}

	async create(input: CreateAgentInput): Promise<AgentTab> {
		const gateway = this.resolveBackend(input.backend);
		const tab = await gateway.create(input);
		this.ownerByAgent.set(tab.id, gateway);
		return tab;
	}

	async claimStandbyAgent(input: { projectId: string; sessionId: string; noSession?: boolean }): Promise<AgentTab | null> {
		const gateway = this.byBackend.get("pi");
		if (typeof gateway?.claimStandbyAgent !== "function") return null;
		const tab = await gateway.claimStandbyAgent(input);
		if (tab) this.ownerByAgent.set(tab.id, gateway);
		return tab;
	}

	ensureStandbyAgent(projectId: string): void {
		this.byBackend.get("pi")?.ensureStandbyAgent?.(projectId);
	}

	async draftCommands(projectId: string): Promise<PiCommand[] | null> {
		const gateway = this.byBackend.get("pi");
		if (typeof gateway?.draftCommands !== "function") return null;
		return gateway.draftCommands(projectId);
	}

	async restart(agentId: string): Promise<AgentTab> {
		const gateway = this.owner(agentId);
		const tab = await gateway.restart(agentId);
		this.ownerByAgent.set(tab.id, gateway);
		return tab;
	}

	async stop(agentId: string): Promise<void> {
		return this.owner(agentId).stop(agentId);
	}

	async rename(agentId: string, name: string): Promise<AgentTab> {
		return this.owner(agentId).rename(agentId, name);
	}

	async abort(agentId: string): Promise<void> {
		return this.owner(agentId).abort(agentId);
	}

	async compact(agentId: string, prompt?: string): Promise<AgentRuntimeState> {
		return this.owner(agentId).compact(agentId, prompt);
	}

	async getRuntimeState(agentId: string): Promise<AgentRuntimeState> {
		return this.owner(agentId).getRuntimeState(agentId);
	}

	reviveIfProcessAlive(agentId: string): boolean {
		const gateway = this.owner(agentId);
		if (typeof gateway.reviveIfProcessAlive !== "function") return false;
		return gateway.reviveIfProcessAlive(agentId);
	}

	async getCommands(agentId: string): Promise<unknown[]> {
		const gateway = this.owner(agentId);
		this.requireCapability(gateway, "getCommands");
		return gateway.getCommands!(agentId);
	}

	async reloadResources(agentId: string): Promise<PiCommand[]> {
		const gateway = this.owner(agentId);
		this.requireCapability(gateway, "reloadResources");
		return gateway.reloadResources!(agentId);
	}

	async getAvailableModels(agentId: string): Promise<AvailableModel[]> {
		return this.owner(agentId).getAvailableModels(agentId);
	}

	async getAvailableThinkingLevels(agentId: string): Promise<string[] | undefined> {
		const gateway = this.owner(agentId);
		if (typeof gateway.getAvailableThinkingLevels !== "function") return undefined;
		return gateway.getAvailableThinkingLevels(agentId);
	}

	async exportHtml(agentId: string): Promise<unknown> {
		const gateway = this.owner(agentId);
		this.requireCapability(gateway, "exportHtml");
		return gateway.exportHtml!(agentId);
	}

	async editMessage(agentId: string, messageId: string, newText: string): Promise<void> {
		const gateway = this.owner(agentId);
		this.requireCapability(gateway, "editMessage");
		await gateway.editMessage?.(agentId, messageId, newText);
	}

	async deleteMessage(agentId: string, messageId: string): Promise<void> {
		const gateway = this.owner(agentId);
		this.requireCapability(gateway, "deleteMessage");
		await gateway.deleteMessage?.(agentId, messageId);
	}

	async listCheckpoints(agentId: string, params?: RewindCheckpointPageParams): Promise<RewindCheckpointPage> {
		const gateway = this.owner(agentId);
		this.requireCapability(gateway, "listCheckpoints");
		return gateway.listCheckpoints!(agentId, params);
	}

	async getCheckpointDiff(agentId: string, checkpointId: string): Promise<string> {
		const gateway = this.owner(agentId);
		this.requireCapability(gateway, "getCheckpointDiff");
		return gateway.getCheckpointDiff!(agentId, checkpointId);
	}

	async restoreCheckpoint(agentId: string, checkpointId: string, scope: RewindRestoreScope): Promise<RewindRestoreResult> {
		const gateway = this.owner(agentId);
		this.requireCapability(gateway, "restoreCheckpoint");
		return gateway.restoreCheckpoint!(agentId, checkpointId, scope);
	}

	async mutatePersistedSessionMessage(
		sessionPath: string,
		messageId: string,
		operation: "edit" | "delete" | "resend" | "remove-image",
		options?: {
			newText?: string;
			environment?: import("../../shared/types").SessionEnvironment;
			wslDistro?: string;

			entryId?: string;
			imageTarget?: SessionMessageImageTarget;
		},
	): Promise<{ text: string; images?: ImageContent[] } | undefined> {
		const gateway = this.resolveBackend("pi");

		if (typeof gateway.mutatePersistedSessionMessage !== "function") {
			throw new Error(`CompositeAgentGateway: backend "${gateway.backend}" does not support persisted session message mutation`);
		}
		return gateway.mutatePersistedSessionMessage(sessionPath, messageId, operation, options);
	}

	async prepareResendFromMessage(agentId: string, messageId: string): Promise<{ text: string; images?: ImageContent[] }> {
		return this.owner(agentId).prepareResendFromMessage(agentId, messageId);
	}

	async setModel(agentId: string, provider: string, modelId: string): Promise<unknown> {
		return this.owner(agentId).setModel(agentId, provider, modelId);
	}

	async getRuntimeModelThinkingState(agentId: string): Promise<SessionRuntimeModelSelection | undefined> {
		return this.owner(agentId).getRuntimeModelThinkingState?.(agentId);
	}

	async setThinking(agentId: string, level: string): Promise<unknown> {
		return this.owner(agentId).setThinking(agentId, level);
	}

	notifyModelPreferenceIgnored(agentId: string, provider: string, modelId: string): void {
		const gateway = this.owner(agentId);
		gateway.notifyModelPreferenceIgnored?.(agentId, provider, modelId);
	}

	async publishRuntimeState(agentId: string): Promise<void> {
		return this.owner(agentId).publishRuntimeState(agentId);
	}

	async getForkMessages(agentId: string): Promise<Array<{ entryId: string; text: string }>> {
		return this.owner(agentId).getForkMessages(agentId);
	}

	async forkSession(agentId: string, entryId: string): Promise<unknown> {
		return this.owner(agentId).forkSession(agentId, entryId);
	}

	async sendUIResponse(agentId: string, requestId: string, response: SessionUiResponseInput["response"]): Promise<unknown> {
		return this.owner(agentId).sendUIResponse(agentId, requestId, response);
	}

	notifyAskPending(agentId: string, sessionId: string, sessionTitle: string, question: string): void {
		for (const gateway of this.gateways) {
			if (gateway.list().some((tab) => tab.id === agentId)) {
				gateway.notifyAskPending(agentId, sessionId, sessionTitle, question);
				return;
			}
		}
	}

	onOutput(listener: (channel: string, payload: unknown) => void): () => void {
		const unsubscribers = this.gateways.map((gateway) => gateway.onOutput(listener));
		return () => {
			for (const unsubscribe of unsubscribers) unsubscribe();
		};
	}
}
