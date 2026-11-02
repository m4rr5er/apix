import { createHash, randomUUID } from "node:crypto";
import type { AgentRuntimeState, AgentTab, ImChannelBackend, WeChatBindingModel, WeChatBridgeStatus, WeChatChatBinding, WeChatModelChainEntry } from "../../shared/types";
import { IlinkClient, IlinkError, type IlinkLogFn } from "./IlinkClient";
import { ILINK_CHANNEL_VERSION, MESSAGE_TYPE_USER, POLL_RETRY_FAST_MS, POLL_RETRY_SLOW_AFTER, POLL_RETRY_SLOW_MS, extractMessageText, hasUnsupportedItem, type IlinkMessage, type IlinkSession } from "./ilinkProtocol";
import type { SessionRuntimeBindingGateway } from "../sessions/sessionRuntimeBinding";
import type { SessionRunOutcome } from "../sessions/sessionRunWaiter";
import { getAccount, getBinding, getDecryptedBotToken, getCursor, getPublicAccount, getSettings, isAllowedUser, loadBindings, markNeedsRelogin, normalizeModelChain, removeBinding, removeBindingsBySessionId, setCursor, updateSettings, upsertBinding } from "./WeChatConfig";
import { normalizeWeChatLocale, weChatLanguage, wechatT, type WeChatLocale, type WeChatTranslationKey } from "./WeChatI18n";
import { pickLatestAssistantText, pickLatestFailureText, prepareOutgoingText, splitForWeChat } from "./weChatText";

export type WeChatBridgeDeps = {
	getProjects: () => Array<{ id: string; name: string }>;
	runtimeBindings: SessionRuntimeBindingGateway;

	getLocale: () => string | undefined;

	botAgent?: string;

	onStatusChange?: (status: WeChatBridgeStatus) => void;

	onBindingsChange?: () => void;
	logger?: IlinkLogFn;
};

const DEDUP_MAX = 200;

const RUN_TIMEOUT_MS = 300_000;

const RESULT_SETTLE_MS = 800;

const EMPTY_RESULT_RETRY_MS = 600;

const MULTI_CHUNK_GAP_MS = 400;

const LATE_DELIVERY_MAX_MS = 60 * 60 * 1000;

const TYPING_TICKET_TTL_MS = 30_000;

type RunAttemptOutcome = { kind: "ok"; sinceIndex: number } | { kind: "failed"; message?: string } | { kind: "sendError"; message: string } | { kind: "timeout"; sinceIndex: number };

type LateRunRecord = { sessionId: string; chatId: string; contextToken: string; startedAt: number; runId?: string; generation: number };

export class WeChatBridge {
	private readonly deps: WeChatBridgeDeps;
	private client: IlinkClient | null = null;
	private status: WeChatBridgeStatus = { status: "disconnected", account: null, activeBindings: 0 };
	private stopping = false;
	private pollStarted = false;

	private readonly seenMessages: number[] = [];
	private readonly seenMessageSet = new Set<number>();

	private activeRun: { chatId: string; contextToken: string; agentId?: string; startedAt: number } | null = null;

	private readonly lateRuns = new Map<string, LateRunRecord>();

	private readonly typingTickets = new Map<string, { ticket: string; at: number }>();

	private clientIdCache: { botId: string; id: string } | null = null;

	private runGeneration = 0;

	constructor(deps: WeChatBridgeDeps) {
		this.deps = deps;
	}

	getStatus(): WeChatBridgeStatus {
		return this.status;
	}

	async start(): Promise<void> {
		this.stopping = false;
		const account = getAccount();
		if (!account) {
			this.setStatus({ status: "disconnected", account: null, activeBindings: loadBindings().length, errorMessage: undefined });
			return;
		}
		const publicAccount = getPublicAccount();
		if (account.needsRelogin) {
			this.setStatus({ status: "error", account: publicAccount, activeBindings: loadBindings().length, errorMessage: "login-required" });
			return;
		}
		const token = getDecryptedBotToken();
		if (!token) {
			this.setStatus({ status: "error", account: publicAccount, activeBindings: loadBindings().length, errorMessage: "credential-unavailable" });
			return;
		}

		this.setStatus({ status: "connecting", account: publicAccount, activeBindings: loadBindings().length, errorMessage: undefined });
		this.client = new IlinkClient({ baseUrl: account.baseUrl, channelVersion: ILINK_CHANNEL_VERSION, botAgent: this.deps.botAgent ?? "PiDeck", logger: this.deps.logger });

		const session = this.buildSession();
		if (session) {
			try {
				await this.client.notifyStart(session);
			} catch (error) {
				this.deps.logger?.("warn", "notifyStart 失败，继续（非必需调用）", error instanceof Error ? error.message : String(error));
			}
		}

		this.setStatus({ status: "connected", account: publicAccount, activeBindings: loadBindings().length, connectedAt: Date.now() });
		if (!this.pollStarted) {
			this.pollStarted = true;
			void this.pollLoop();
		}
	}

	async stop(): Promise<void> {
		this.stopping = true;
		this.runGeneration += 1;
		this.pollStarted = false;
		const client = this.client;
		this.client = null;
		const session = this.buildSession();
		if (client && session) {
			try {
				await client.notifyStop(session);
			} catch {}
		}
		this.activeRun = null;
		this.lateRuns.clear();
		this.typingTickets.clear();
		this.setStatus({ status: "disconnected", account: getPublicAccount(), activeBindings: loadBindings().length });
	}

	removeBindingsForSession(sessionId: string): number {
		const removed = removeBindingsBySessionId(sessionId);
		if (removed > 0) {
			this.setStatus({ activeBindings: loadBindings().length });
			this.notifyBindingsChanged();
		}
		return removed;
	}

	refresh(): void {
		this.setStatus({ account: getPublicAccount(), activeBindings: loadBindings().length, errorMessage: undefined });
		this.notifyBindingsChanged();
	}

	private async pollLoop(): Promise<void> {
		let consecutiveFailures = 0;
		while (!this.stopping) {
			const session = this.buildSession();
			const client = this.client;
			if (!session || !client) return;

			try {
				const { msgs, cursor } = await client.getUpdates(session, session.cursor);
				consecutiveFailures = 0;
				if (cursor && cursor !== session.cursor) {
					setCursor(cursor);
					session.cursor = cursor;
				}
				for (const message of msgs) {
					this.handleIncoming(message);
				}
			} catch (error) {
				if (this.stopping) return;
				if (error instanceof IlinkError && error.kind === "session-expired") {
					markNeedsRelogin();
					this.deps.logger?.("warn", "微信会话已失效（errcode -14），已暂停轮询并要求重新扫码");
					this.setStatus({ status: "error", account: getPublicAccount(), activeBindings: loadBindings().length, errorMessage: "login-required" });
					return;
				}
				consecutiveFailures += 1;
				const delay = consecutiveFailures >= POLL_RETRY_SLOW_AFTER ? POLL_RETRY_SLOW_MS : POLL_RETRY_FAST_MS;
				this.deps.logger?.("warn", `微信收信失败（第 ${consecutiveFailures} 次），${delay}ms 后重试`, error instanceof Error ? error.message : String(error));
				await sleep(delay);
			}
		}
	}

	private handleIncoming(message: IlinkMessage): void {
		if (message.message_type !== MESSAGE_TYPE_USER) return;
		if (this.isDuplicate(message.message_id)) return;

		const chatId = message.from_user_id;
		const contextToken = message.context_token ?? "";
		if (message.group_id) {
			this.sendSafe(chatId, contextToken, this.t("text.group"));
			return;
		}
		if (!isAllowedUser(chatId)) {
			this.deps.logger?.("warn", "忽略非绑定用户的消息", chatId.slice(0, 8));
			return;
		}

		const text = extractMessageText(message.item_list ?? []).trim();
		const hasUnsupported = hasUnsupportedItem(message.item_list ?? []);
		if (!text) {
			if (hasUnsupported) this.sendSafe(chatId, contextToken, this.t("text.empty"));
			return;
		}

		this.setStatus({ lastMessageAt: Date.now() });

		if (text.startsWith("/")) {
			void this.handleCommand(chatId, contextToken, text).catch((error) => {
				this.deps.logger?.("error", "微信命令处理失败", error instanceof Error ? error.message : String(error));
			});
			return;
		}

		if (this.activeRun) {
			this.sendSafe(chatId, contextToken, this.t("run.busy"));
			return;
		}
		this.activeRun = { chatId, contextToken, startedAt: Date.now() };
		void this.runAgent(chatId, contextToken, text).catch((error) => {
			this.deps.logger?.("error", "微信任务执行失败", error instanceof Error ? error.message : String(error));
		});
	}

	private async runAgent(chatId: string, contextToken: string, text: string): Promise<void> {
		const binding = await this.ensureBinding(chatId);
		if (!binding) {
			this.activeRun = null;
			return;
		}
		const agentId = binding.agentId;
		if (!agentId) {
			this.activeRun = null;
			this.sendSafe(chatId, contextToken, this.t("session.restoreFailed"));
			return;
		}
		if (this.activeRun) this.activeRun.agentId = agentId;

		const generation = this.runGeneration;

		const runId = randomUUID();
		const plan = await this.buildModelPlan(binding);

		await this.applyRunThinking(binding);

		const attempts: Array<WeChatModelChainEntry | null> = plan.length > 0 ? plan : [null];
		let lastFailure: string | undefined;

		let typingStarted = false;

		try {
			for (const [index, entry] of attempts.entries()) {
				if (this.runGeneration !== generation || this.stopping) return;
				if (entry && !(await this.applyRunModel(binding.sessionId, entry))) {
					continue;
				}
				if (index > 0 && entry) this.deps.logger?.("warn", "微信模型失败，顺延到下一条", `${entry.provider}/${entry.modelId}`);

				if (!typingStarted) typingStarted = await this.signalTyping(chatId, contextToken, 1);

				const outcome = await this.submitRun(binding, text);
				if (this.runGeneration !== generation) return;
				if (outcome.kind === "sendError") {
					this.activeRun = null;
					this.sendSafe(chatId, contextToken, this.t("run.failed", { message: outcome.message }), runId);
					return;
				}
				if (outcome.kind === "timeout") {
					const record: LateRunRecord = { sessionId: binding.sessionId, chatId, contextToken, startedAt: Date.now(), runId, generation };
					this.lateRuns.set(binding.sessionId, record);
					this.activeRun = null;
					void this.deliverLateResult(record, outcome.sinceIndex).catch((error) => this.deps.logger?.("warn", "微信迟到补发失败", error instanceof Error ? error.message : String(error)));
					await this.sendSafe(chatId, contextToken, this.t("run.timeout"), runId);
					return;
				}
				if (outcome.kind === "ok") {
					this.activeRun = null;
					await this.deliverResult({ sessionId: binding.sessionId, chatId, contextToken, runId }, outcome.sinceIndex);
					return;
				}
				lastFailure = outcome.message;
			}

			this.activeRun = null;
			const failureMessage = lastFailure?.trim();
			this.sendSafe(chatId, contextToken, failureMessage ? this.t("run.failed", { message: failureMessage }) : this.t("run.failedNoDetail"), runId);
		} finally {
			if (typingStarted) void this.signalTyping(chatId, contextToken, 2);
		}
	}

	private async submitRun(binding: WeChatChatBinding, text: string): Promise<RunAttemptOutcome> {
		const sessionId = binding.sessionId;
		const sinceIndex = this.deps.runtimeBindings.getRuntimeMessages(sessionId).length;
		const waitOutcome = this.deps.runtimeBindings.waitForRunEnd({ sessionId, sinceIndex, timeoutMs: RUN_TIMEOUT_MS });
		try {
			await this.deps.runtimeBindings.sendPrompt({
				sessionId,
				...this.promptPayload(binding, text),
			});
		} catch (error) {
			return { kind: "sendError", message: error instanceof Error ? error.message : String(error) };
		}

		let outcome: SessionRunOutcome;
		try {
			outcome = await waitOutcome;
		} catch (error) {
			return { kind: "sendError", message: error instanceof Error ? error.message : String(error) };
		}
		if (outcome.kind === "timeout") return { kind: "timeout", sinceIndex };
		await sleep(RESULT_SETTLE_MS);
		if (outcome.failed) {
			this.deps.logger?.("warn", "微信 run 以错误结束", outcome.errorMessage ?? "unknown");
			return { kind: "failed", message: outcome.errorMessage };
		}
		return { kind: "ok", sinceIndex };
	}

	private async buildModelPlan(binding: WeChatChatBinding): Promise<WeChatModelChainEntry[]> {
		const chain = this.bindingBackend(binding) === "pi" ? normalizeModelChain(getSettings().modelChain) : [];
		const explicit = binding.modelProvider && binding.modelId ? { provider: binding.modelProvider, modelId: binding.modelId } : undefined;
		if (chain.length === 0 && !explicit) return [];
		const current = await this.readRuntimeModel(binding.sessionId);
		const entries: WeChatModelChainEntry[] = [];
		const push = (entry: WeChatModelChainEntry) => {
			if (!entry.provider || !entry.modelId) return;
			if (entries.some((candidate) => candidate.provider === entry.provider && candidate.modelId === entry.modelId)) return;
			entries.push(entry);
		};
		if (explicit) push(explicit);
		if (current?.provider && current.modelId && !chain.some((entry) => entry.provider === current.provider && entry.modelId === current.modelId)) {
			push({ provider: current.provider, modelId: current.modelId });
		}
		for (const entry of chain) push(entry);
		return entries;
	}

	private async applyRunModel(sessionId: string, entry: WeChatModelChainEntry): Promise<boolean> {
		const current = await this.readRuntimeModel(sessionId);
		if (current?.provider === entry.provider && current.modelId === entry.modelId) return true;
		try {
			await this.deps.runtimeBindings.setRuntimeModel(sessionId, entry.provider, entry.modelId);
			return true;
		} catch (error) {
			this.deps.logger?.("warn", "微信切换模型失败，尝试下一条", `${entry.provider}/${entry.modelId}: ${error instanceof Error ? error.message : String(error)}`);
			return false;
		}
	}

	private async readRuntimeState(sessionId: string): Promise<AgentRuntimeState | undefined> {
		try {
			return await this.deps.runtimeBindings.getRuntimeState(sessionId);
		} catch {
			return undefined;
		}
	}

	private async readRuntimeModel(sessionId: string): Promise<{ provider?: string; modelId?: string } | undefined> {
		const state = await this.readRuntimeState(sessionId);
		return state ? { provider: state.provider, modelId: state.modelId } : undefined;
	}

	private async applyRunThinking(binding: WeChatChatBinding): Promise<void> {
		const state = await this.readRuntimeState(binding.sessionId);
		if (state?.thinkingLevel === "off") return;
		try {
			await this.deps.runtimeBindings.setRuntimeThinking(binding.sessionId, "off");
		} catch (error) {
			this.deps.logger?.("debug", "微信关闭思考失败（不影响回信）", error instanceof Error ? error.message : String(error));
		}
	}

	private async applyChainDefault(binding: WeChatChatBinding): Promise<void> {
		if (binding.modelProvider) return;
		if (this.bindingBackend(binding) !== "pi") return;
		const first = normalizeModelChain(getSettings().modelChain)[0];
		if (!first) return;
		await this.applyRunModel(binding.sessionId, first);
	}

	async getBindingModel(binding: WeChatChatBinding): Promise<WeChatBindingModel | undefined> {
		const state = await this.readRuntimeState(binding.sessionId);
		if (!state?.provider || !state.modelId) return undefined;
		return { provider: state.provider, modelId: state.modelId, modelName: state.modelName };
	}

	private async seedModelChain(sessionId: string): Promise<void> {
		try {
			if (normalizeModelChain(getSettings().modelChain).length > 0) return;
			const state = await this.readRuntimeState(sessionId);
			if (!state?.provider || !state.modelId) return;
			updateSettings({ modelChain: [{ provider: state.provider, modelId: state.modelId, modelName: state.modelName }] });
			this.deps.logger?.("info", `微信已把会话当前模型写入模型链链首：${state.provider}/${state.modelId}`);
		} catch (error) {
			this.deps.logger?.("warn", "微信模型链播种失败（不影响本次回复）", error instanceof Error ? error.message : String(error));
		}
	}

	private async deliverResult(target: { sessionId: string; chatId: string; contextToken: string; runId?: string }, sinceIndex = 0): Promise<void> {
		const readTurnMessages = () => this.deps.runtimeBindings.getRuntimeMessages(target.sessionId).slice(sinceIndex);
		let messages = readTurnMessages();
		let raw = pickLatestAssistantText(messages);
		if (!raw && !pickLatestFailureText(messages)) {
			await sleep(EMPTY_RESULT_RETRY_MS);
			messages = readTurnMessages();
			raw = pickLatestAssistantText(messages);
		}
		if (raw) {
			await this.sendSafe(target.chatId, target.contextToken, raw, target.runId);
			return;
		}
		const failure = pickLatestFailureText(messages);
		if (failure) {
			await this.sendSafe(target.chatId, target.contextToken, this.t("run.failed", { message: failure }), target.runId);
			return;
		}
		this.sendSafe(target.chatId, target.contextToken, this.t("run.noText"), target.runId);
	}

	private async handleCommand(chatId: string, contextToken: string, text: string): Promise<void> {
		const [rawCommand, ...rest] = text.trim().split(/\s+/);
		const command = rawCommand.toLowerCase();
		const argument = rest.join(" ").trim();

		switch (command) {
			case "/help":
			case "/?":
				await this.sendSafe(chatId, contextToken, `${this.t("help.title")}\n${this.t("help.body")}\n\n${this.t("help.hint")}`);
				return;
			case "/new": {
				const binding = getBinding(chatId);
				if (binding) {
					removeBinding(chatId);
					this.notifyBindingsChanged();
				}
				const created = await this.ensureBinding(chatId, { forceNew: true });
				if (created) {
					await this.sendSafe(chatId, contextToken, this.t("session.created", { id: created.sessionId.slice(0, 8) }));
				}
				return;
			}
			case "/stop": {
				const binding = getBinding(chatId);
				if (!binding) {
					await this.sendSafe(chatId, contextToken, this.t("run.nothing"));
					return;
				}
				await this.deps.runtimeBindings.abortRuntime(binding.sessionId);
				this.runGeneration += 1;
				this.activeRun = null;

				this.lateRuns.delete(binding.sessionId);
				await this.sendSafe(chatId, contextToken, this.t("run.stopped"));
				return;
			}
			case "/status": {
				const binding = getBinding(chatId);
				if (!binding) {
					await this.sendSafe(chatId, contextToken, this.t("session.none"));
					return;
				}
				const state = await this.deps.runtimeBindings.getRuntimeState(binding.sessionId);
				const model = state?.modelName ?? state?.modelId ?? binding.modelId ?? "-";
				await this.sendSafe(
					chatId,
					contextToken,
					this.t("session.status", {
						id: binding.sessionId.slice(0, 8),
						workspace: binding.workspaceId || this.projectName(binding.workspaceId),
						model,
						state: this.activeRun ? "running" : "idle",
					}),
				);
				return;
			}
			case "/model": {
				await this.handleModelCommand(chatId, contextToken, argument);
				return;
			}
			default:
				await this.sendSafe(chatId, contextToken, `${this.t("help.title")}\n${this.t("help.body")}`);
		}
	}

	private async handleModelCommand(chatId: string, contextToken: string, argument: string): Promise<void> {
		const binding = getBinding(chatId);
		if (!binding) {
			await this.sendSafe(chatId, contextToken, this.t("session.none"));
			return;
		}
		const models = await this.deps.runtimeBindings.listRuntimeModels(binding.sessionId);
		if (models.length === 0) {
			await this.sendSafe(chatId, contextToken, this.t("model.empty"));
			return;
		}
		if (!argument) {
			const state = await this.deps.runtimeBindings.getRuntimeState(binding.sessionId);
			const current = state?.modelName ?? state?.modelId ?? binding.modelId ?? "-";

			const listed = models.slice(0, 30).map((model) => `- ${model.provider}/${model.id}`);
			if (models.length > listed.length) listed.push(`… +${models.length - listed.length}`);
			await this.sendSafe(chatId, contextToken, `${this.t("model.current", { model: current })}\n${listed.join("\n")}\n\n${this.t("model.usage")}`);
			return;
		}
		const target = argument.toLowerCase();
		const match = models.find((model) => `${model.provider}/${model.id}`.toLowerCase() === target) ?? models.find((model) => model.id.toLowerCase() === target) ?? models.find((model) => model.name?.toLowerCase() === target);
		if (!match) {
			await this.sendSafe(chatId, contextToken, this.t("model.invalid", { model: argument }));
			return;
		}
		await this.deps.runtimeBindings.setRuntimeModel(binding.sessionId, match.provider, match.id);

		upsertBinding({ ...binding, modelId: match.id, modelProvider: match.provider });
		await this.sendSafe(chatId, contextToken, this.t("model.switched", { model: `${match.provider}/${match.id}` }));
	}

	private async ensureBinding(chatId: string, options?: { forceNew?: boolean }): Promise<WeChatChatBinding | undefined> {
		const current = getBinding(chatId);
		const existing = options?.forceNew ? undefined : current;
		if (existing) {
			const settingsBackend = getSettings().backend ?? "pi";
			if ((existing.backend ?? "pi") !== settingsBackend) {
				this.deps.logger?.("info", `微信会话后端变更（${existing.backend ?? "pi"} → ${settingsBackend}），换绑新会话`);
				return this.activateBinding(existing, chatId, { backendChanged: true });
			}
			const agentId = await this.authorizeRuntimeAgent(existing);
			if (agentId) return { ...existing, agentId };
		}

		return this.activateBinding(existing, chatId, { firstBinding: current === undefined });
	}

	private async authorizeRuntimeAgent(binding: WeChatChatBinding): Promise<string | undefined> {
		if (!binding.agentId) return undefined;
		const tab = this.deps.runtimeBindings.findRuntimeAgent(binding.agentId);
		if (!tab || tab.status === "error" || tab.status === "closed") {
			upsertBinding({ ...binding, agentId: undefined });
			return undefined;
		}
		try {
			const runtimeBinding = await this.deps.runtimeBindings.bindRuntime({ projectId: tab.projectId, agent: tab, existingSessionId: binding.sessionId });
			if (runtimeBinding.sessionId !== binding.sessionId) {
				throw new Error(`runtime gateway returned a different session: ${runtimeBinding.sessionId}`);
			}
			return tab.id;
		} catch (error) {
			this.deps.logger?.("warn", "微信绑定句柄校验失败，重新激活会话", error instanceof Error ? error.message : String(error));
			upsertBinding({ ...binding, agentId: undefined });
			return undefined;
		}
	}

	private async activateBinding(existing: WeChatChatBinding | undefined, chatId: string, options?: { backendChanged?: boolean; firstBinding?: boolean }): Promise<WeChatChatBinding | undefined> {
		const projects = this.deps.getProjects();
		if (projects.length === 0) {
			this.sendSafe(chatId, this.currentContextToken(chatId), this.t("project.required"));
			return undefined;
		}
		const preferred = existing?.workspaceId || getSettings().defaultWorkspaceId || "";

		const projectId = projects.some((project) => project.id === preferred) ? preferred : projects[0].id;

		const reuse = options?.backendChanged ? undefined : existing;
		const title = reuse ? "微信对话" : `微信 ${chatId.slice(-4)}`;
		const backend: ImChannelBackend = reuse ? (reuse.backend ?? "pi") : (getSettings().backend ?? "pi");

		try {
			let session = await this.deps.runtimeBindings.ensureSession({
				projectId,
				title,
				existingSessionId: reuse?.sessionId,
				sessionPath: reuse?.sessionPath,
				backend,

				channel: "wechat",
				autoTitle: true,
			});
			let tab: AgentTab;
			try {
				tab = await this.deps.runtimeBindings.activateRuntime(session.sessionId);
			} catch (error) {
				if (!reuse?.sessionPath) throw error;
				this.deps.logger?.("warn", "微信会话恢复失败，改新建", error instanceof Error ? error.message : String(error));
				session = await this.deps.runtimeBindings.ensureSession({ projectId, title: `微信 ${chatId.slice(-4)}`, backend, channel: "wechat", autoTitle: true });
				tab = await this.deps.runtimeBindings.activateRuntime(session.sessionId);
			}
			const binding: WeChatChatBinding = {
				chatId,
				userId: chatId,
				backend,
				sessionId: session.sessionId,
				sessionPath: tab.sessionPath,
				workspaceId: projectId,

				modelId: reuse?.modelId,
				createdAt: existing?.createdAt ?? Date.now(),
				agentId: tab.id,
			};
			upsertBinding(binding);

			if (options?.firstBinding && backend === "pi") await this.seedModelChain(binding.sessionId);

			await this.applyChainDefault(binding);
			this.setStatus({ activeBindings: loadBindings().length });
			this.notifyBindingsChanged();
			if (options?.backendChanged) {
				await this.sendSafe(chatId, this.currentContextToken(chatId), this.t("session.backendSwitched", { backend: "pi", id: session.sessionId.slice(0, 8) }));
			}
			return binding;
		} catch (error) {
			this.deps.logger?.("error", "微信会话激活失败", error instanceof Error ? error.message : String(error));
			const key: WeChatTranslationKey = "session.createFailed";
			this.sendSafe(chatId, this.currentContextToken(chatId), this.t(key));
			return undefined;
		}
	}

	private async deliverLateResult(record: LateRunRecord, sinceIndex: number): Promise<void> {
		const outcome = await this.deps.runtimeBindings.waitForRunEnd({ sessionId: record.sessionId, sinceIndex, timeoutMs: LATE_DELIVERY_MAX_MS });
		if (outcome.kind === "timeout") return;
		if (this.lateRuns.get(record.sessionId) !== record) return;
		this.lateRuns.delete(record.sessionId);
		if (this.stopping || record.generation !== this.runGeneration) return;
		if (Date.now() - record.startedAt > LATE_DELIVERY_MAX_MS) {
			this.deps.logger?.("warn", "微信迟到结果已超出投递窗口，放弃回信");
			return;
		}
		await sleep(RESULT_SETTLE_MS);
		await this.deliverResult(record, sinceIndex);
	}

	private async sendSafe(chatId: string, contextToken: string, text: string, runId?: string): Promise<void> {
		const client = this.client;
		const session = this.buildSession();
		if (!client || !session) return;
		if (!contextToken) {
			this.deps.logger?.("warn", "缺 context_token，跳过发送");
			return;
		}
		const chunks = splitForWeChat(prepareOutgoingText(text));
		if (chunks.length === 0) return;

		const base = this.clientId();
		const scope = runId ?? randomUUID();
		for (let index = 0; index < chunks.length; index += 1) {
			const clientId = base ? `${base}-${scope}-${index}` : undefined;
			try {
				await client.sendText(session, { toUserId: chatId, contextToken, text: chunks[index], clientId, runId });
			} catch (error) {
				this.deps.logger?.("warn", "微信发送失败", error instanceof Error ? error.message : String(error));
				this.setStatus({ errorMessage: "send-failed" });
				return;
			}
			if (index < chunks.length - 1) await sleep(MULTI_CHUNK_GAP_MS);
		}
	}

	private async signalTyping(chatId: string, contextToken: string, status: 1 | 2): Promise<boolean> {
		const client = this.client;
		const session = this.buildSession();
		if (!client || !session || !contextToken) return false;
		try {
			let cached = this.typingTickets.get(chatId);
			if (!cached || Date.now() - cached.at > TYPING_TICKET_TTL_MS) {
				const config = await client.getConfig(session, chatId, contextToken);
				const ticket = config.typing_ticket;
				if (!ticket) return false;
				cached = { ticket, at: Date.now() };
				this.typingTickets.set(chatId, cached);
			}
			await client.sendTyping(session, chatId, cached.ticket, status);
			return true;
		} catch (error) {
			this.deps.logger?.("debug", "微信正在输入信号失败（不影响回信）", error instanceof Error ? error.message : String(error));
			return false;
		}
	}

	private clientId(): string | undefined {
		const account = getAccount();
		if (!account) return undefined;
		if (this.clientIdCache?.botId !== account.ilinkBotId) {
			const digest = createHash("sha256").update(account.ilinkBotId).digest("hex").slice(0, 16);
			this.clientIdCache = { botId: account.ilinkBotId, id: `pideck-${digest}` };
		}
		return this.clientIdCache.id;
	}

	private channelInstructions(): string {
		return [
			"当前会话已连接微信（iLink 私聊通道）。微信只支持纯文本：不要输出 Markdown 表格、代码围栏、图片或链接语法，表格请改成分行列表，PiDeck 会在回复前做纯文本降级。",
			"不要调用任何微信/IM 发送接口、CLI 或工具来发消息，也不要询问 chat_id：你的最终回答会自动回复给微信用户。",
			"该通道不支持发送文件、图片与引用消息；需要用户手动取用文件时，直接给出绝对路径。",
			"微信通道不能主动推送消息，用户只有发消息时才能收到回复。",
			`请用${weChatLanguage(this.locale())}回答。`,
		].join("\n");
	}

	private promptPayload(binding: WeChatChatBinding, text: string): { message: string; agentMessage?: string } {
		const instructions = this.channelInstructions();
		const withInstructions = text ? `${instructions}\n\n${text}` : instructions;
		if (this.bindingBackend(binding) !== "pi") return { message: withInstructions };
		return { message: text, agentMessage: withInstructions };
	}

	private bindingBackend(binding: WeChatChatBinding): ImChannelBackend {
		return binding.backend ?? "pi";
	}

	private buildSession(): IlinkSession | null {
		const account = getAccount();
		if (!account) return null;
		const token = getDecryptedBotToken();
		if (!token) return null;
		return {
			botToken: token,
			baseUrl: account.baseUrl,
			ilinkBotId: account.ilinkBotId,
			ilinkUserId: account.ilinkUserId,
			cursor: getCursor(),
		};
	}

	private currentContextToken(_chatId: string): string {
		return this.activeRun?.contextToken ?? "";
	}

	private locale(): WeChatLocale {
		return normalizeWeChatLocale(this.deps.getLocale());
	}

	private t(key: WeChatTranslationKey, params?: Record<string, string | number>): string {
		return wechatT(this.locale(), key, params);
	}

	private projectName(projectId: string): string {
		return this.deps.getProjects().find((project) => project.id === projectId)?.name ?? projectId;
	}

	private isDuplicate(messageId: number): boolean {
		if (this.seenMessageSet.has(messageId)) return true;
		this.seenMessageSet.add(messageId);
		this.seenMessages.push(messageId);
		if (this.seenMessages.length > DEDUP_MAX) {
			const evicted = this.seenMessages.shift();
			if (evicted !== undefined) this.seenMessageSet.delete(evicted);
		}
		return false;
	}

	private setStatus(patch: Partial<WeChatBridgeStatus>): void {
		this.status = { ...this.status, ...patch };
		try {
			this.deps.onStatusChange?.(this.status);
		} catch (error) {
			this.deps.logger?.("warn", "微信状态回调抛错", error instanceof Error ? error.message : String(error));
		}
	}

	private notifyBindingsChanged(): void {
		try {
			this.deps.onBindingsChange?.();
		} catch (error) {
			this.deps.logger?.("warn", "微信绑定回调抛错", error instanceof Error ? error.message : String(error));
		}
	}
}

function errorCodeOf(error: unknown): string | undefined {
	if (typeof error !== "object" || error === null || !("code" in error)) return undefined;
	const code: unknown = error.code;
	return typeof code === "string" ? code : undefined;
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
