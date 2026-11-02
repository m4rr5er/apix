import type { BrowserWindow } from "electron";
import { ipcChannels } from "../../shared/ipc";
import type { FeishuBotConfig, FeishuBridgeStatus, FeishuChatBinding, FeishuChatMessage, FeishuTestResult, ImageContent, AvailableModel, AgentRuntimeState, AgentTab, ChatMessage, ImChannelBackend } from "../../shared/types";
import type { FeishuGroupInfo, FeishuGroupMember, FeishuImageAttachment, FeishuFileAttachment, FeishuMessageContext, FeishuCardActionEvent } from "./types";
import { loadBindings, saveBindings, getPersistentChatId, setPersistentChatId, type FeishuChatBindingPersist } from "./FeishuConfig";
import { chooseMessageMode, buildPostMessages, buildMarkdownCards } from "./rich-text";
import { CardStream } from "./CardStream";
import { FeishuConnection } from "./FeishuConnection";
import { buildFeishuTextChildren, sanitizeFeishuUserVisibleText, stripFeishuActionMarkers, wantsFeishuDoc } from "./docActions";
import { hasExplicitFeishuFileSendIntent } from "./fileIntent";
import { createInitialState, reduceFromPiEvent, markInterrupted, markError, type RunState } from "./CardRunState";
import { renderRunCard } from "./CardRenderer";
import { buildModelPickerCard, parseModelActionValue } from "./ModelPickerCard";
import { buildAskCard, normalizeAskOption, parseAskActionValue, parseAskInputValue, tryParseBatchAskEnvelope, type AskOption, type AskUiRequest } from "./AskCard";
import { feishuLanguage, feishuT, normalizeFeishuLocale, type FeishuLocale } from "./FeishuI18n";
import type { AgentManager } from "../pi/AgentManager";

import type { SessionRuntimeBindingGateway } from "../sessions/sessionRuntimeBinding";

export type { SessionRuntimeBindingGateway };

const DEDUP_MAX = 200;
const GROUP_CACHE_TTL = 3600_000;

type PendingAsk = {
	requestId: string;
	agentId: string;
	method: "select" | "confirm" | "input" | "editor" | "batch_ask";
	title: string;
	chatId: string;
	askedAt: number;

	options?: AskOption[];
};

function isAskMethod(value: string): value is "select" | "confirm" | "input" | "editor" {
	return value === "select" || value === "confirm" || value === "input" || value === "editor";
}

function safeLog(level: "log" | "warn" | "error", ...args: unknown[]): void {
	try {
		console[level](...args);
	} catch {}
}
const log = (...args: unknown[]) => safeLog("log", ...args);
const warn = (...args: unknown[]) => safeLog("warn", ...args);
const logErr = (...args: unknown[]) => safeLog("error", ...args);

export class FeishuBridge {
	private botConfig: FeishuBotConfig;
	private agentManager: AgentManager;
	private runtimeBindings: SessionRuntimeBindingGateway;
	private getWindow: () => BrowserWindow | null;
	private getProjects: () => Array<{ id: string; name: string; path: string }>;
	private locale: FeishuLocale;

	private connection: FeishuConnection;

	private status: FeishuBridgeStatus = { status: "disconnected", activeBindings: 0 };
	private botOpenId: string | null = null;
	private userOpenId: string | null = null;

	private recentMessageIds = new Set<string>();
	private recentEventIds = new Set<string>();
	private recentContent = new Map<string, number>();
	private processingChats = new Set<string>();

	private pendingAttachments = new Map<string, { images: FeishuImageAttachment[]; files: FeishuFileAttachment[] }>();

	private chatBindings = new Map<string, FeishuChatBinding>();
	private sessionToChat = new Map<string, string>();

	private sessionMirrorPending = new Map<string, Promise<string | undefined>>();

	private groupInfoCache = new Map<string, FeishuGroupInfo>();
	private userNameCache = new Map<string, string>();

	private imageConfirmTimers = new Map<string, ReturnType<typeof setTimeout>>();

	private pendingAsks = new Map<string, PendingAsk>();

	private streamingCards = new Map<string, CardStream>();

	private streamingRunStates = new Map<string, RunState>();

	private pendingCardEvents = new Map<string, unknown[]>();

	private cardUpdateFailed = new Set<string>();

	private cardTerminalSucceeded = new Set<string>();

	private syncedFingerprints = new Set<string>();

	private unsubscribeLocalEvents: (() => void) | null = null;

	private feishuSessions = new Set<string>();

	private feishuDrivenRuns = new Set<string>();

	private lastUserMessageId = new Map<string, string>();

	private pendingDocRequests = new Map<string, string>();

	constructor(botConfig: FeishuBotConfig, agentManager: AgentManager, getWindow: () => BrowserWindow | null, getProjects: () => Array<{ id: string; name: string; path: string }>, runtimeBindings: SessionRuntimeBindingGateway, plainAppSecret?: string, locale: FeishuLocale = "zh-CN") {
		this.botConfig = botConfig;
		this.agentManager = agentManager;
		this.runtimeBindings = runtimeBindings;
		this.getWindow = getWindow;
		this.getProjects = getProjects;
		this.locale = normalizeFeishuLocale(locale);
		this.connection = new FeishuConnection(botConfig, plainAppSecret, this.locale);
	}

	getStatus(): FeishuBridgeStatus {
		return { ...this.status };
	}
	listBindings(): FeishuChatBinding[] {
		return Array.from(this.chatBindings.values());
	}

	hasSessionBinding(sessionOrAgentId: string): boolean {
		return this.sessionToChat.has(sessionOrAgentId);
	}

	getSessionChatId(sessionOrAgentId: string): string | undefined {
		return this.getBestChatId(sessionOrAgentId);
	}

	private getBestChatId(sessionOrAgentId: string): string | undefined {
		const currentChatId = this.sessionToChat.get(sessionOrAgentId);
		if (currentChatId) return currentChatId;
		for (const [chatId, b] of this.chatBindings) {
			if ((b.sessionId === sessionOrAgentId || b.agentId === sessionOrAgentId) && b.source === "session-mirror") return chatId;
		}
		return undefined;
	}

	private hasFeishuBindingForKey(key: string): boolean {
		return Array.from(this.chatBindings.values()).some((candidate) => candidate.source === "feishu" && (candidate.sessionId === key || candidate.agentId === key));
	}

	private removeBindingIndexKey(key: string, chatId: string): void {
		if (this.sessionToChat.get(key) === chatId) this.sessionToChat.delete(key);
		if (!this.hasFeishuBindingForKey(key)) this.feishuSessions.delete(key);
	}

	private setBindingIndexKey(key: string, chatId: string): void {
		const currentChatId = this.sessionToChat.get(key);
		if (!currentChatId || currentChatId === chatId) this.sessionToChat.set(key, chatId);
	}

	private indexBinding(binding: FeishuChatBinding, previousAgentId?: string, previousSessionId?: string): void {
		if (previousSessionId && previousSessionId !== binding.sessionId) {
			this.removeBindingIndexKey(previousSessionId, binding.chatId);
		}
		if (previousAgentId && previousAgentId !== binding.agentId) {
			this.removeBindingIndexKey(previousAgentId, binding.chatId);
		}
		this.setBindingIndexKey(binding.sessionId, binding.chatId);
		if (binding.agentId) this.setBindingIndexKey(binding.agentId, binding.chatId);
		if (binding.source === "feishu") {
			this.feishuSessions.add(binding.sessionId);
			if (binding.agentId) this.feishuSessions.add(binding.agentId);
		}
	}

	private unindexBinding(binding: FeishuChatBinding): void {
		this.chatBindings.delete(binding.chatId);
		this.removeBindingIndexKey(binding.sessionId, binding.chatId);
		if (binding.agentId) this.removeBindingIndexKey(binding.agentId, binding.chatId);
	}

	private clearRuntimeAgentId(binding: FeishuChatBinding): void {
		const previousAgentId = binding.agentId;
		if (!previousAgentId) return;
		binding.agentId = undefined;
		this.indexBinding(binding, previousAgentId);
		this.persistBindings();
		this.pushBindings();
	}

	private botBackend(): ImChannelBackend {
		return this.botConfig.backend ?? "pi";
	}

	private bindingBackend(binding: FeishuChatBinding): ImChannelBackend {
		return binding.backend ?? this.botBackend();
	}

	private async authorizeRuntimeAgent(binding: FeishuChatBinding): Promise<string | undefined> {
		if (!binding.agentId) return undefined;
		const tab = this.runtimeBindings.findRuntimeAgent(binding.agentId);
		if (!tab || tab.status === "error" || tab.status === "closed") {
			this.clearRuntimeAgentId(binding);
			return undefined;
		}
		try {
			const runtimeBinding = await this.runtimeBindings.bindRuntime({
				projectId: tab.projectId,
				agent: tab,
				existingSessionId: binding.sessionId,
			});
			if (runtimeBinding.sessionId !== binding.sessionId) {
				throw new Error(`Runtime gateway returned a different Session: ${runtimeBinding.sessionId}`);
			}
			return tab.id;
		} catch (error) {
			warn(`[飞书 Bridge] runtime handle 校验失败，清理旧绑定: ${error instanceof Error ? error.message : String(error)}`);
			this.clearRuntimeAgentId(binding);
			return undefined;
		}
	}

	private async ensureRuntimeBinding(binding: FeishuChatBinding, options?: { forceNew?: boolean }): Promise<string | undefined> {
		if (!options?.forceNew) {
			const activeAgentId = await this.authorizeRuntimeAgent(binding);
			if (activeAgentId) return activeAgentId;
		}
		const resumed = await this.resumeOrCreateAgent(binding, options);
		return resumed?.agentId;
	}

	removeBindingBySessionId(sessionId: string): boolean {
		const chatId = this.sessionToChat.get(sessionId);
		if (!chatId) return false;
		return this.removeBinding(chatId);
	}

	async reloadBindings(): Promise<void> {
		this.chatBindings.clear();
		this.sessionToChat.clear();
		this.feishuSessions.clear();
		await this.loadPersistedBindings();
		log(`[飞书 Bridge] 手动刷新绑定完成，活跃绑定: ${this.chatBindings.size}`);
	}

	removeBinding(chatId: string): boolean {
		const binding = this.chatBindings.get(chatId);
		if (!binding) return false;

		this.unindexBinding(binding);
		this.chatBindings.delete(chatId);
		const runtimeId = binding.agentId;
		if (runtimeId) {
			this.streamingCards.delete(runtimeId);
			this.streamingRunStates.delete(runtimeId);
			this.pendingCardEvents.delete(runtimeId);
			this.cardUpdateFailed.delete(runtimeId);
		}

		const timer = this.imageConfirmTimers.get(chatId);
		if (timer) {
			clearTimeout(timer);
			this.imageConfirmTimers.delete(chatId);
		}
		this.lastUserMessageId.delete(chatId);

		this.pendingAttachments.delete(chatId);
		for (const key of [...this.pendingAsks.keys()]) {
			if (key.startsWith(`${chatId}:`)) this.pendingAsks.delete(key);
		}
		this.updateStatus({ activeBindings: this.chatBindings.size });
		this.persistBindings();
		this.pushBindings();
		log(`[飞书 Bridge] 已移除绑定: ${chatId}`);
		return true;
	}

	updateBinding(chatId: string, patch: Partial<Omit<FeishuChatBinding, "chatId" | "botId" | "sessionId">>): FeishuChatBinding | undefined {
		const binding = this.chatBindings.get(chatId);
		if (!binding) return undefined;
		Object.assign(binding, patch);
		this.persistBindings();
		return { ...binding };
	}

	async start(): Promise<void> {
		this.updateStatus({ status: "connecting" });

		try {
			const { botOpenId } = await this.connection.start(
				async (data) => {
					await this.handleRawMessage(data).catch((err) => logErr("[飞书 Bridge] handleRawMessage 异常:", err));
				},
				async (event) => {
					await this.handleCardAction(event);
				},
			);
			this.botOpenId = botOpenId;

			this.unsubscribeLocalEvents = this.agentManager.addLocalEventListener((agentId, event) => this.handleAgentEvent(agentId, event));
			await this.loadPersistedBindings();
			this.updateStatus({
				status: "connected",
				activeBindings: this.chatBindings.size,
				connectedAt: Date.now(),
				botId: this.botConfig.id,
				botName: this.botConfig.name,
				botOpenId: this.botOpenId ?? undefined,
			});
			log("[Feishu Bridge] connected");
		} catch (error) {
			const detail = error instanceof Error ? error.message : String(error);
			const message = feishuT(this.locale, "connection.failed");
			this.updateStatus({ status: "error", errorMessage: detail });
			logErr("[飞书 Bridge] 启动失败:", detail);
			throw new Error(message + " (" + detail + ")", { cause: error });
		}
	}

	stop(): void {
		if (this.unsubscribeLocalEvents) {
			this.unsubscribeLocalEvents();
			this.unsubscribeLocalEvents = null;
		}
		for (const [, card] of this.streamingCards) {
			card.close().catch(() => {});
		}
		this.streamingCards.clear();
		this.streamingRunStates.clear();
		this.pendingCardEvents.clear();

		this.connection.stop();
		this.chatBindings.clear();
		this.sessionToChat.clear();
		this.feishuSessions.clear();
		this.recentMessageIds.clear();
		this.recentEventIds.clear();
		this.recentContent.clear();
		this.processingChats.clear();
		this.lastUserMessageId.clear();
		this.syncedFingerprints.clear();
		this.groupInfoCache.clear();
		this.userNameCache.clear();
		this.botOpenId = null;
		this.cardUpdateFailed.clear();
		this.pendingDocRequests.clear();
		for (const [, timer] of this.imageConfirmTimers) {
			clearTimeout(timer);
		}
		this.imageConfirmTimers.clear();
		this.pendingAsks.clear();
		this.pendingAttachments.clear();
		this.updateStatus({ status: "disconnected", activeBindings: 0, botId: undefined, botName: undefined, botOpenId: undefined });
		log("[Feishu Bridge] stopped");
	}

	updateBotConfig(patch: Partial<FeishuBotConfig>): void {
		this.botConfig = { ...this.botConfig, ...patch };
		log("[飞书 Bridge] 配置已热更新:", Object.keys(patch).join(", "));
	}

	setLocale(locale: FeishuLocale): void {
		this.locale = normalizeFeishuLocale(locale);
	}

	async testConnection(appId: string, appSecret: string): Promise<FeishuTestResult> {
		return this.connection.testConnection(appId, appSecret);
	}

	private async sendLightningConfirm(chatId: string, replyToMessageId?: string): Promise<void> {
		if (!this.connection.client) return;
		try {
			if (replyToMessageId) {
				await this.connection.client.im.message.reply({
					path: { message_id: replyToMessageId },
					data: { msg_type: "text", content: JSON.stringify({ text: feishuT(this.locale, "message.received") }) },
				});
			} else {
				await this.connection.client.im.message.create({
					params: { receive_id_type: "chat_id" },
					data: { receive_id: chatId, msg_type: "text", content: JSON.stringify({ text: feishuT(this.locale, "message.received") }) },
				});
			}
		} catch {}
	}

	private async handleRawMessage(data: Record<string, unknown>): Promise<void> {
		const event = (data?.event ?? data) as Record<string, unknown>;
		if (!event) return;
		const sender = event.sender as Record<string, unknown> | undefined;
		if (sender?.sender_type === "bot") return;
		await this.handleMessage(event);
	}

	private async handleMessage(data: Record<string, unknown>): Promise<void> {
		if (!this.connection.client) return;
		const eventId = data.event_id as string | undefined;
		if (eventId && this.recentEventIds.has(eventId)) return;
		if (eventId) {
			this.recentEventIds.add(eventId);
			if (this.recentEventIds.size > DEDUP_MAX) this.recentEventIds.delete(this.recentEventIds.values().next().value as string);
		}

		const message = (data as { message?: Record<string, unknown> }).message;
		if (!message) return;
		const sender = (data as { sender?: Record<string, unknown> }).sender;
		if ((sender?.sender_type as string) !== "user") return;

		const messageId = message.message_id as string;
		if (messageId && this.recentMessageIds.has(messageId)) return;
		if (messageId) {
			this.recentMessageIds.add(messageId);
			if (this.recentMessageIds.size > DEDUP_MAX) this.recentMessageIds.delete(this.recentMessageIds.values().next().value as string);
		}

		const chatId = message.chat_id as string;
		const messageType = message.message_type as string;
		const chatType = message.chat_type as string;
		const userId = ((sender?.sender_id as Record<string, unknown>)?.open_id as string) ?? "unknown";
		const mentions = message.mentions as Array<{ name: string; id: string | { open_id: string; union_id: string; user_id: string } }> | undefined;

		if (userId && userId !== "unknown") {
			this.userOpenId = userId;
			try {
				const win = this.getWindow();
				if (win && !win.isDestroyed()) win.webContents.send(ipcChannels.feishuWhoamiResult, userId);
			} catch {}
		}

		if (messageType === "text" && message.content) {
			try {
				const cmdContent = JSON.parse(message.content as string) as { text?: string };
				const cmdText = (cmdContent.text ?? "").replace(/@_user_\d+/g, "").trim();
				if (cmdText.startsWith("/") || cmdText.toLowerCase() === "whoami") {
					const msgCtx: FeishuMessageContext = {
						chatId,
						senderOpenId: userId,
						senderName: undefined,
						messageId,
						chatType: chatType as "p2p" | "group",
					};
					await this.handleCommand(msgCtx, cmdText);
					return;
				}
			} catch {}
		}

		if (this.processingChats.has(chatId)) {
			log(`[飞书 Bridge] 跳过重入消息: ${chatId}`);
			return;
		}
		this.processingChats.add(chatId);

		try {
			if (chatType === "group" && this.botConfig.requireMention !== false && !this.isBotMentioned(mentions)) {
				const binding = this.chatBindings.get(chatId);
				if (!binding || binding.source !== "session-mirror") return;
			}
			if (chatType === "group" && messageId) this.lastUserMessageId.set(chatId, messageId);

			const supportedTypes = new Set(["text", "image", "post", "file"]);
			if (!supportedTypes.has(messageType)) {
				log(`[飞书 Bridge] 不支持的消息类型: ${messageType}`);
				return;
			}

			let text = "";
			const imageAttachments: FeishuImageAttachment[] = [];
			const fileAttachments: FeishuFileAttachment[] = [];

			if (messageType === "text") {
				const content = JSON.parse(message.content as string) as { text?: string };
				text = (content.text ?? "").replace(/@_user_\d+/g, "").trim();
			} else if (messageType === "post") {
				const content = JSON.parse(message.content as string) as { title?: string; content?: Array<Array<{ tag: string; text?: string; image_key?: string }>> };
				const parts: string[] = [];
				if (content.title) parts.push(content.title);
				for (const line of content.content ?? []) {
					for (const node of line) {
						if (node.tag === "text" && node.text) {
							parts.push(node.text);
						} else if ((node.tag === "img" || node.tag === "image") && node.image_key) {
							try {
								const imgData = await this.downloadImage(messageId, node.image_key);
								imageAttachments.push({ imageKey: node.image_key, data: imgData, mediaType: this.inferImageMediaType(imgData) });
							} catch (e) {
								logErr("[飞书 Bridge] post 图片下载失败:", e);
							}
						}
					}
				}
				text = parts
					.join(" ")
					.replace(/@_user_\d+/g, "")
					.trim();
			} else if (messageType === "image") {
				const content = JSON.parse(message.content as string) as { image_key?: string };
				if (content.image_key) {
					try {
						const imgData = await this.downloadImage(messageId, content.image_key);
						imageAttachments.push({ imageKey: content.image_key, data: imgData, mediaType: this.inferImageMediaType(imgData) });
					} catch (e) {
						logErr("[飞书 Bridge] 下载图片失败:", e);
						await this.sendSmartMessage(chatId, feishuT(this.locale, "attachment.imageDownloadFailed"));
						return;
					}
				}
			} else if (messageType === "file") {
				const content = JSON.parse(message.content as string) as { file_key?: string; file_name?: string };
				if (content.file_key) {
					try {
						const fileData = await this.downloadFile(messageId, content.file_key);
						if (fileData.length > 50 * 1024 * 1024) {
							await this.sendSmartMessage(chatId, feishuT(this.locale, "attachment.fileTooLarge50"));
							return;
						}
						fileAttachments.push({ fileKey: content.file_key, fileName: content.file_name || `feishu-${content.file_key}`, data: fileData });
					} catch (e) {
						logErr("[飞书 Bridge] 下载文件失败:", e);
						await this.sendSmartMessage(chatId, feishuT(this.locale, "attachment.fileDownloadFailed"));
						return;
					}
				}
			}

			if (messageType === "text") {
				const pendingAsk = this.getPendingAskForChat(chatId);
				if (pendingAsk) {
					if (pendingAsk.method === "confirm") {
						await this.sendSmartMessage(chatId, feishuT(this.locale, "ask.confirmHint"));
						return;
					}
					if (pendingAsk.method === "batch_ask") {
						await this.sendSmartMessage(chatId, feishuT(this.locale, "ask.batchUnsupportedHint"));
						return;
					}
					let answer = text ?? "";

					if (answer.trim() && pendingAsk.method === "select" && pendingAsk.options?.length) {
						const index = Number(answer.trim()) - 1;
						if (/^\d+$/.test(answer.trim()) && index >= 0 && index < pendingAsk.options.length) {
							const mapped = normalizeAskOption(pendingAsk.options[index]);
							answer = typeof mapped === "string" ? mapped : (mapped?.value ?? mapped?.label ?? answer);
						}
					}
					if (answer.trim()) {
						this.runtimeBindings.sendUIResponse(pendingAsk.agentId, pendingAsk.requestId, { value: answer });
						this.pendingAsks.delete(`${chatId}:${pendingAsk.requestId}`);
						await this.sendSmartMessage(chatId, feishuT(this.locale, "ask.answered", { answer }));
						return;
					}
				}
			}

			if (!text && (imageAttachments.length > 0 || fileAttachments.length > 0)) {
				const existing = this.pendingAttachments.get(chatId);
				const heldCount = existing ? existing.images.length + existing.files.length : 0;
				const heldBytes = existing ? [...existing.images, ...existing.files].reduce((n, a) => n + a.data.length, 0) : 0;
				const incomingCount = imageAttachments.length + fileAttachments.length;
				const incomingBytes = [...imageAttachments, ...fileAttachments].reduce((n, a) => n + a.data.length, 0);
				if (heldCount + incomingCount > 20 || heldBytes + incomingBytes > 20 * 1024 * 1024) {
					await this.sendSmartMessage(chatId, feishuT(this.locale, "attachment.pendingFull"));
					return;
				}
				const merged = existing || { images: [], files: [] };
				merged.images.push(...imageAttachments);
				merged.files.push(...fileAttachments);
				this.pendingAttachments.set(chatId, merged);
				const names = fileAttachments.map((f) => f.fileName).join("、");
				const hint = names ? feishuT(this.locale, "attachment.filesReceived", { names }) : feishuT(this.locale, "attachment.imageReceived");
				await this.sendSmartMessage(chatId, `📎 ${hint}`);
				return;
			}

			const pending = this.pendingAttachments.get(chatId);
			if (pending) {
				imageAttachments.unshift(...pending.images);
				fileAttachments.unshift(...pending.files);
				this.pendingAttachments.delete(chatId);
			}
			if (!text && imageAttachments.length === 0 && fileAttachments.length === 0) return;

			log(`[Feishu Bridge] message received: chat=${chatId.slice(0, 8)}, type=${messageType}, text=${text.slice(0, 40)}`);

			let groupName: string | undefined;
			let senderName: string | undefined;
			if (chatType === "group") {
				const [gi, un] = await Promise.all([this.getGroupInfo(chatId), this.getUserName(userId)]);
				groupName = gi?.name;
				senderName = un;
			}

			const msgCtx: FeishuMessageContext = { chatId, senderOpenId: userId, senderName, messageId, chatType: chatType as "p2p" | "group", groupName };

			const dedupParts = [chatId, userId, text];
			if (imageAttachments.length > 0) dedupParts.push("img", ...imageAttachments.map((a) => a.imageKey));
			if (fileAttachments.length > 0) dedupParts.push("file", ...fileAttachments.map((f) => f.fileKey));
			const contentKey = dedupParts.join("\u0000");
			const lastTime = this.recentContent.get(contentKey);
			if (lastTime && Date.now() - lastTime <= 5000) {
				log(`[飞书 Bridge] 重复内容已跳过: ${text.slice(0, 50)}`);
				return;
			}
			this.recentContent.set(contentKey, Date.now());
			if (this.recentContent.size > 2000) this.recentContent.delete(this.recentContent.keys().next().value as string);

			log(`[飞书 Bridge] 准备调用 Agent: ${chatId}, "${text.slice(0, 60)}", images=${imageAttachments.length}`);

			const replyToMsgId = chatType === "group" ? messageId : undefined;
			void this.sendLightningConfirm(chatId, replyToMsgId).catch(() => {});

			await this.runAgent(msgCtx, text, imageAttachments, fileAttachments);
		} finally {
			this.processingChats.delete(chatId);
		}
	}

	private async handleCommand(ctx: FeishuMessageContext, text: string): Promise<void> {
		const { chatId, senderOpenId: userId } = ctx;
		const [command] = text.split(/\s+/);
		switch (command?.toLowerCase()) {
			case "/help":
			case "/h":
				await this.sendHelpCard(chatId);
				break;
			case "/new":
			case "/n":
				await this.createNewSession(ctx);
				break;
			case "/stop":
			case "/s":
				await this.handleStopCommand(ctx);
				break;
			case "/status":
				await this.handleStatusCommand(ctx);
				break;
			case "/model":
				await this.handleModelCommand(ctx, text);
				break;
			case "/sendfile": {
				const fp = text.split(/\s+/).slice(1).join(" ");
				if (!fp) {
					await this.sendSmartMessage(chatId, feishuT(this.locale, "command.sendFileUsage"));
					break;
				}
				const result = await this.sendFeishuFile(chatId, fp);
				await this.sendSmartMessage(chatId, result);
				break;
			}
			case "/newdoc": {
				const title = text.split(/\s+/).slice(1).join(" ") || feishuT(this.locale, "doc.defaultTitle");
				const result = await this.createFeishuDoc(chatId, title);
				await this.sendSmartMessage(chatId, result);
				break;
			}
			case "/whoami":
				await this.sendSmartMessage(chatId, feishuT(this.locale, "command.whoami", { openId: userId }));

				try {
					const win = this.getWindow();
					if (win && !win.isDestroyed()) {
						win.webContents.send(ipcChannels.feishuWhoamiResult, userId);
					}
				} catch {}
				break;
			case "/refresh":
			case "/r":
				await this.reloadBindings();
				await this.sendSmartMessage(chatId, feishuT(this.locale, "command.bindingsRefreshed", { count: this.chatBindings.size }));
				break;
			default:
				await this.sendSmartMessage(chatId, feishuT(this.locale, "command.unknown", { command: command ?? "" }));
		}
	}

	private async runAgent(ctx: FeishuMessageContext, text: string, imageAttachments: FeishuImageAttachment[], fileAttachments: FeishuFileAttachment[]): Promise<void> {
		const { chatId } = ctx;
		let binding = this.chatBindings.get(chatId);

		if (binding) {
			const settingsBackend = this.botBackend();
			const currentBackend = binding.backend ?? "pi";
			const switched = currentBackend !== settingsBackend;
			if (switched) {
				log(`[飞书 Bridge] 会话后端变更（${currentBackend} → ${settingsBackend}），换绑新会话`);
				binding.backend = settingsBackend;
			}
			const runtimeAgentId = await this.ensureRuntimeBinding(binding, { forceNew: switched });
			if (!runtimeAgentId) {
				await this.sendSmartMessage(chatId, feishuT(this.locale, "session.restoreFailed"));
				return;
			}
		} else {
			await this.createNewSession(ctx);
			binding = this.chatBindings.get(chatId);
			if (!binding) return;
		}
		const agentId = binding.agentId;
		if (!agentId) return;

		const backend = this.bindingBackend(binding);

		const existingCard = this.streamingCards.get(agentId);
		if (existingCard) {
			await existingCard.flush(markInterrupted(createInitialState())).catch(() => {});
			await existingCard.close().catch(() => {});
			this.streamingCards.delete(agentId);
			this.streamingRunStates.delete(agentId);
		}
		this.pendingCardEvents.delete(agentId);

		const { writeFileSync, mkdirSync } = await import("node:fs");
		const { join } = await import("node:path");
		const { tmpdir } = await import("node:os");
		const imgDir = join(tmpdir(), "pi-feishu-images");
		mkdirSync(imgDir, { recursive: true });
		const savedImages: string[] = [];
		const images: ImageContent[] = imageAttachments.map((att) => {
			const ext = att.mediaType.split("/").pop() || "png";
			const name = `feishu-img-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.${ext}`;
			const fp = join(imgDir, name);
			writeFileSync(fp, att.data);
			savedImages.push(fp);
			return { type: "image" as const, data: att.data.toString("base64"), mimeType: att.mediaType };
		});
		let finalText = text;
		if (savedImages.length > 0) {
			finalText = finalText ? `${finalText}\n\n[图片已保存到: ${savedImages.join(", ")}]` : `[图片已保存到: ${savedImages.join(", ")}]`;
		}
		if (fileAttachments.length > 0) {
			const names = fileAttachments.map((f) => f.fileName).join(", ");
			finalText = finalText ? `${finalText}\n\n[附件: ${names}]` : `处理以下文件: ${names}`;
		}

		const initialState = createInitialState();

		const useStreamingCard = backend === "pi";
		if (useStreamingCard) {
			this.streamingRunStates.set(agentId, initialState);
			this.pendingCardEvents.set(agentId, []);
		}

		const cardPromise = useStreamingCard
			? CardStream.open(this.connection.client!, chatId, renderRunCard(initialState, { locale: this.locale }), { replyToMessageId: ctx.chatType === "group" ? ctx.messageId : undefined }).catch((e) => {
					logErr("[飞书 Bridge] 流式卡片创建失败:", e);
					return null as CardStream | null;
				})
			: Promise.resolve(null as CardStream | null);

		const sinceIndex = this.runtimeBindings.getRuntimeMessages(binding.sessionId).length;
		const runEndPromise: Promise<{ timedOut: boolean; failed: boolean; errorMessage?: string }> =
			backend === "pi"
				? this.waitForAgentEnd(agentId, 300_000).then((timedOut) => ({ timedOut, failed: false }))
				: this.runtimeBindings.waitForRunEnd({ sessionId: binding.sessionId, sinceIndex, timeoutMs: 300_000 }).then((outcome) => (outcome.kind === "timeout" ? { timedOut: true, failed: false } : { timedOut: false, failed: outcome.failed, ...(outcome.errorMessage ? { errorMessage: outcome.errorMessage } : {}) }));

		this.feishuDrivenRuns.add(agentId);
		try {
			const feishuActionInstruction = [
				"当前会话已连接飞书聊天。严禁调用 lark-cli、飞书 IM API 或搜索群聊来发送文件；不要询问 chat_id。需要把本地文件发到当前飞书聊天时，最终回答末尾独立一行写 [SEND_FILE:本地文件路径]，PiDeck 会按当前会话绑定自动上传。",
				"只有用户明确要求发送、上传或分享文件时才写 [SEND_FILE:本地文件路径]；如果只是要求保存到本地，不要写该标记。",
				`当前绑定的飞书 chat_id: ${chatId}。这是只读上下文，用于确认当前会话绑定；发送文件仍必须用 [SEND_FILE:本地文件路径]。`,
				"这是飞书群聊消息。请直接回复用户。",
			].join("\n");
			const feishuCtx = finalText ? `${feishuActionInstruction}\n\n${finalText}\n\n[这是飞书群聊消息。请直接回复用户。]` : `${feishuActionInstruction}\n\n[飞书群聊消息。请直接回复用户。]`;
			const promptText = finalText || "处理附件";

			await this.runtimeBindings.sendPrompt(backend === "pi" ? { sessionId: binding.sessionId, message: promptText, agentMessage: feishuCtx, ...(images.length > 0 ? { images } : {}) } : { sessionId: binding.sessionId, message: `${feishuCtx}\n\n${promptText}`, ...(images.length > 0 ? { images } : {}) });
		} catch (e) {
			this.feishuDrivenRuns.delete(agentId);
			this.streamingRunStates.delete(agentId);
			this.pendingCardEvents.delete(agentId);
			this.streamingCards.delete(agentId);

			void cardPromise.then((c) => {
				if (c) void c.close().catch(() => {});
			});
			throw e;
		}

		const cardStream = await cardPromise;
		const hasCard = cardStream !== null;
		if (cardStream) {
			this.streamingCards.set(agentId, cardStream);
			this.replayBufferedEvents(agentId, cardStream);
		} else {
			this.pendingCardEvents.delete(agentId);
		}

		const startTime = Date.now();

		try {
			const runEnd = await runEndPromise;
			await new Promise((r) => setTimeout(r, 800));

			if (runEnd.timedOut) {
				log(`[飞书 Bridge] 等待 agent_end 超时（run 仍在运行），保留卡片继续跟进: agentId=${agentId.slice(0, 8)}`);
				return;
			}

			if (runEnd.failed) {
				await this.sendSmartMessage(chatId, runEnd.errorMessage ?? feishuT(this.locale, "agent.failed"));
				this.streamingRunStates.delete(agentId);
				this.pendingCardEvents.delete(agentId);
			} else if (hasCard) {
				if (this.cardUpdateFailed.has(agentId)) {
					this.cardUpdateFailed.delete(agentId);
					log(`[飞书 Bridge] 卡片更新失败，降级为文本消息`);
					await this.sendResultFallback(chatId, binding.sessionId, startTime);
				}
				this.streamingCards.delete(agentId);
				this.streamingRunStates.delete(agentId);
				this.pendingCardEvents.delete(agentId);
			} else {
				await this.sendResultFallback(chatId, binding.sessionId, startTime);
				this.streamingRunStates.delete(agentId);
				this.pendingCardEvents.delete(agentId);
			}

			const runMessages = this.runtimeBindings.getRuntimeMessages(binding.sessionId);

			await this.processFeishuActions(chatId, runMessages).catch((e) => logErr("[飞书 Bridge] 处理飞书动作异常:", e));

			const docTitle = wantsFeishuDoc(text);
			if (docTitle) {
				const lastMsg = runMessages.filter((m) => m.role === "assistant").pop();
				if (lastMsg?.text && !lastMsg.text.includes("[CREATE_DOC:")) {
					const body = stripFeishuActionMarkers(lastMsg.text);
					if (body) {
						await this.createFeishuDoc(chatId, docTitle, body).catch((e) => logErr("[飞书 Bridge] feishu 路径自动创建文档失败:", e));
					}
				}
			}
		} catch (e) {
			logErr("[飞书 Bridge] Agent 运行失败:", e);
			const errState = markError(createInitialState(), feishuT(this.locale, "agent.failed"));
			const finalCardStream = this.streamingCards.get(agentId);
			if (finalCardStream) {
				await finalCardStream.flush(renderRunCard(errState, { locale: this.locale })).catch(() => {});
				await finalCardStream.close().catch(() => {});
				this.streamingCards.delete(agentId);
			}
			this.streamingRunStates.delete(agentId);
			this.pendingCardEvents.delete(agentId);
			this.cardUpdateFailed.delete(agentId);
			await this.sendSmartMessage(chatId, feishuT(this.locale, "agent.failed"));
		} finally {
			this.feishuDrivenRuns.delete(agentId);

			if (savedImages.length > 0) {
				void import("node:fs").then(({ unlink }) => {
					for (const fp of savedImages) unlink(fp, () => {});
				});
			}
		}
	}

	private replayBufferedEvents(sessionId: string, cardStream: CardStream): void {
		const pending = this.pendingCardEvents.get(sessionId);
		if (!pending || pending.length === 0) {
			this.pendingCardEvents.delete(sessionId);
			return;
		}

		log(`[飞书 Bridge] 回放 ${pending.length} 个缓存事件到卡片`);
		let currentState = this.streamingRunStates.get(sessionId) ?? createInitialState();
		for (const ev of pending) {
			const nextState = reduceFromPiEvent(currentState, ev as Record<string, unknown>, this.locale);
			if (nextState !== currentState) {
				currentState = nextState;
				this.streamingRunStates.set(sessionId, nextState);
				cardStream.update(
					renderRunCard(nextState, {
						locale: this.locale,
						stopHint: nextState.terminal === "running" ? feishuT(this.locale, "card.stopHint") : undefined,
					}),
				);
			}
		}
		this.pendingCardEvents.delete(sessionId);
	}

	private waitForAgentEnd(sessionId: string, timeoutMs: number): Promise<boolean> {
		return new Promise((resolve) => {
			const timer = setTimeout(() => {
				cleanup();
				resolve(true);
			}, timeoutMs);
			const handler = (agentId: string, event: unknown) => {
				if (agentId !== sessionId) return;
				if (!event || typeof event !== "object") return;
				if ((event as Record<string, unknown>).type === "agent_end") {
					cleanup();
					resolve(false);
				}
			};
			const unsub = this.agentManager.addLocalEventListener(handler);
			const cleanup = () => {
				clearTimeout(timer);
				unsub();
			};
		});
	}

	private handleAgentEvent(agentId: string, event: unknown): void {
		if (!event || typeof event !== "object") return;

		if (this.status.status !== "connected") return;
		const typed = event as Record<string, unknown>;

		if (typed.type === "extension_ui_request") {
			this.handleAskRequest(agentId, typed);
			return;
		}

		if (typed.type === "agent_end") {
			this.clearPendingAsksForAgent(agentId);
		}

		const cardStream = this.streamingCards.get(agentId);

		const pending = this.pendingCardEvents.get(agentId);
		if (pending) {
			pending.push(typed);
			return;
		}

		const runState = this.streamingRunStates.get(agentId);
		if (runState) {
			if (typed.type === "agent_end" && (typed.stopReason === "error" || typed.error || typed.errorMessage)) {
				logErr("[飞书 Bridge] Agent 终态错误:", typed.error ?? typed.errorMessage ?? typed.stopReason);
			}
			const nextState = reduceFromPiEvent(runState, typed, this.locale);
			if (nextState !== runState) {
				this.streamingRunStates.set(agentId, nextState);
			}
			if (cardStream) {
				const cleanText = sanitizeFeishuUserVisibleText(nextState.outputText);
				const displayState = cleanText !== nextState.outputText ? { ...nextState, outputText: cleanText } : nextState;
				const chatId = this.sessionToChat.get(agentId) ?? "";
				const prefix = this.chatBindings.get(chatId)?.groupName ?? "";
				const card = renderRunCard(displayState, {
					locale: this.locale,
					stopHint: nextState.terminal === "running" ? feishuT(this.locale, "card.stopHint") : undefined,
				});
				if (nextState.terminal === "running") {
					cardStream.update(card);
				} else {
					this.cardTerminalSucceeded.add(agentId);

					void cardStream
						.flush(card)
						.then(() => {
							if (cardStream.lastPatchFailed) {
								this.cardUpdateFailed.add(agentId);
								this.cardTerminalSucceeded.delete(agentId);
								log(`[飞书 Bridge] 终态卡片 patch 失败: ${cardStream.lastPatchError}`);

								const chatIdForFallback = this.getBestChatId(agentId);
								if (chatIdForFallback && this.connection.client) {
									void this.syncPiMessageToFeishu(agentId, chatIdForFallback).catch((e) => logErr("[Feishu Bridge] card-fallback sync failed:", e));
								}
							}
						})
						.then(() => cardStream.close())
						.catch((e) => {
							this.cardUpdateFailed.add(agentId);
							this.cardTerminalSucceeded.delete(agentId);
							logErr("[飞书 Bridge] 终态卡片 flush/close 异常:", e);
							const chatIdForFallback = this.getBestChatId(agentId);
							if (chatIdForFallback && this.connection.client) {
								void this.syncPiMessageToFeishu(agentId, chatIdForFallback).catch((err) => logErr("[Feishu Bridge] card-fallback sync failed:", err));
							}
						});
					this.streamingRunStates.delete(agentId);
					this.streamingCards.delete(agentId);
					this.pendingCardEvents.delete(agentId);
				}
			} else {
				const pending = this.pendingCardEvents.get(agentId);
				if (pending) {
					pending.push(typed);
				}
			}
		}

		if (typed.type === "agent_end") {
			const deliveredByCard = this.cardTerminalSucceeded.has(agentId);
			this.cardTerminalSucceeded.delete(agentId);
			if (!deliveredByCard && !this.feishuSessions.has(agentId) && !this.feishuDrivenRuns.has(agentId)) {
				log(`[Feishu Bridge] agent_end 触发 syncPiMessageToFeishu, agentId=${agentId.slice(0, 8)}`);
				const chatId = this.getBestChatId(agentId);
				if (chatId && this.connection.client) {
					this.syncPiMessageToFeishu(agentId, chatId).catch((e) => logErr("[Feishu Bridge] sync Pi message failed:", e));
				}
			}
		}
	}

	private async syncPiMessageToFeishu(agentId: string, chatId: string): Promise<void> {
		if (!this.connection.client) return;
		const messages = this.agentManager.getMessages(agentId);
		const assistantMessages = messages.filter((m) => m.role === "assistant");
		const lastAssistant = assistantMessages.pop();
		if (!lastAssistant?.text?.trim()) return;

		const fingerprint = `${lastAssistant.id}|${lastAssistant.text.slice(0, 50)}`;
		if (this.syncedFingerprints.has(fingerprint)) return;

		const cleanText = sanitizeFeishuUserVisibleText(lastAssistant.text);
		if (cleanText) {
			const delivered = await this.sendSmartMessage(chatId, cleanText);
			if (!delivered) return;
		}
		this.syncedFingerprints.add(fingerprint);
		if (this.syncedFingerprints.size > 200) this.syncedFingerprints.delete(this.syncedFingerprints.keys().next().value as string);

		await this.processFeishuActions(chatId, messages).catch((e) => logErr("[Feishu Bridge] process PiDeck Feishu actions failed:", e));

		const pendingTitle = this.pendingDocRequests.get(agentId);
		if (pendingTitle && !lastAssistant.text.includes("[CREATE_DOC:")) {
			const body = stripFeishuActionMarkers(lastAssistant.text);
			if (body) {
				await this.createFeishuDoc(chatId, pendingTitle, body).catch((e) => logErr("[Feishu Bridge] auto create doc failed:", e));
			}
		}
		this.pendingDocRequests.delete(agentId);
	}

	trackDocRequest(agentId: string, title: string): void {
		this.pendingDocRequests.set(agentId, title);
	}

	async sendFileForSession(agentId: string, filePath: string): Promise<string> {
		const chatId = this.getBestChatId(agentId);
		if (!chatId) return feishuT(this.locale, "session.unbound");
		return this.sendFeishuFile(chatId, filePath);
	}

	async forwardUserMessageToFeishu(agentId: string, text: string): Promise<void> {
		if (!this.connection.client || !text.trim()) return;
		const chatId = this.getBestChatId(agentId);
		if (!chatId) {
			const tab = this.agentManager.list().find((t) => t.id === agentId);
			if (tab) {
				await this.ensureSessionMirror(agentId, tab.title, tab.sessionPath);
			}
			return;
		}

		await this.sendSmartMessage(chatId, `💻 **PiDeck**:\n${text}`);

		const docTitle = wantsFeishuDoc(text);
		if (docTitle) this.pendingDocRequests.set(agentId, docTitle);
	}

	private async createNewSession(ctx: FeishuMessageContext, _title?: string): Promise<void> {
		const { chatId } = ctx;
		const projects = this.getProjects();
		if (projects.length === 0) {
			await this.sendSmartMessage(chatId, feishuT(this.locale, "session.projectRequired"));
			return;
		}
		const projectId = projects[0].id;

		try {
			const session = await this.runtimeBindings.ensureSession({
				projectId,
				title: _title?.trim() || ctx.groupName || feishuT(this.locale, "group.defaultSession"),
				channel: "feishu",
				backend: this.botBackend(),
			});
			const binding: FeishuChatBinding = {
				chatId,
				botId: this.botConfig.id,
				userId: ctx.senderOpenId,
				sessionId: session.sessionId,
				workspaceId: this.botConfig.defaultWorkspaceId ?? "",
				source: "feishu",
				backend: this.botBackend(),
				chatType: ctx.chatType,
				groupName: ctx.groupName,
				createdAt: Date.now(),
			};
			this.chatBindings.set(chatId, binding);
			this.indexBinding(binding);
			this.updateStatus({ activeBindings: this.chatBindings.size });
			this.persistBindings();
			this.pushBindings();

			setPersistentChatId(`session:${binding.sessionId}`, chatId);
			await this.sendSmartMessage(chatId, feishuT(this.locale, "session.created", { id: binding.sessionId.slice(0, 8) }));

			await this.sendSmartMessage(chatId, feishuT(this.locale, "session.askDisabled"));
		} catch (e) {
			logErr("[飞书 Bridge] 创建会话失败:", e);
			await this.sendSmartMessage(chatId, feishuT(this.locale, "session.createFailed"));
		}
	}

	private async resumeOrCreateAgent(binding: FeishuChatBinding, options?: { forceNew?: boolean }): Promise<FeishuChatBinding | undefined> {
		const projects = this.getProjects();
		if (projects.length === 0) {
			log("[飞书 Bridge] 恢复会话失败：无可用项目");
			return undefined;
		}
		const projectId = projects[0].id;
		const forceNew = options?.forceNew === true;

		try {
			const title = binding.groupName || feishuT(this.locale, "group.defaultSession");
			let session = await this.runtimeBindings.ensureSession({
				projectId,
				title,
				existingSessionId: forceNew ? undefined : binding.sessionId,
				sessionPath: forceNew ? undefined : binding.sessionPath,
				channel: "feishu",

				backend: this.bindingBackend(binding),
			});
			let tab: AgentTab;
			try {
				tab = await this.runtimeBindings.activateRuntime(session.sessionId);
			} catch (error) {
				if (!binding.sessionPath) throw error;
				log(`[飞书 Bridge] sessionPath 恢复失败，创建新 Session: ${error instanceof Error ? error.message : String(error)}`);
				session = await this.runtimeBindings.ensureSession({ projectId, title, channel: "feishu", backend: this.bindingBackend(binding) });
				tab = await this.runtimeBindings.activateRuntime(session.sessionId);
			}
			log(`[飞书 Bridge] 已为 Session ${session.sessionId} 激活 runtime ${tab.id}`);
			const previousAgentId = binding.agentId;
			const previousSessionId = binding.sessionId;
			binding.sessionId = session.sessionId;
			binding.agentId = tab.id;
			binding.sessionPath = tab.sessionPath;
			this.indexBinding(binding, previousAgentId, previousSessionId);
			this.chatBindings.set(binding.chatId, binding);
			this.persistBindings();
			this.pushBindings();
			await this.sendSmartMessage(binding.chatId, feishuT(this.locale, forceNew ? "session.backendSwitched" : "session.recovered", { id: binding.sessionId.slice(0, 8), backend: "pi" }));

			await this.sendSmartMessage(binding.chatId, feishuT(this.locale, "session.askDisabled"));
			return binding;
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			logErr(`[飞书 Bridge] Session runtime 恢复失败: ${msg}`);
			return undefined;
		}
	}

	async ensureSessionMirror(agentId: string, sessionTitle?: string, sessionPath?: string): Promise<string | undefined> {
		const pending = this.sessionMirrorPending.get(agentId);
		if (pending) return pending;
		const task = this.ensureSessionMirrorForRuntime(agentId, sessionTitle, sessionPath).finally(() => {
			if (this.sessionMirrorPending.get(agentId) === task) this.sessionMirrorPending.delete(agentId);
		});
		this.sessionMirrorPending.set(agentId, task);
		return task;
	}

	async ensureSessionMirrorForSession(sessionId: string, agentId: string, sessionTitle?: string, sessionPath?: string): Promise<string | undefined> {
		const pending = this.sessionMirrorPending.get(sessionId);
		if (pending) return pending;
		const task = this.ensureSessionMirrorInner(sessionId, agentId, sessionTitle, sessionPath).finally(() => {
			if (this.sessionMirrorPending.get(sessionId) === task) {
				this.sessionMirrorPending.delete(sessionId);
			}
		});
		this.sessionMirrorPending.set(sessionId, task);
		return task;
	}

	private async ensureSessionMirrorForRuntime(agentId: string, sessionTitle?: string, sessionPath?: string): Promise<string | undefined> {
		const tab = this.agentManager.list().find((candidate) => candidate.id === agentId);
		const existingRuntimeBinding = tab ? Array.from(this.chatBindings.values()).find((binding) => binding.agentId === tab.id) : undefined;
		const authorizedAgentId = existingRuntimeBinding ? await this.authorizeRuntimeAgent(existingRuntimeBinding) : undefined;
		let stableSessionId = authorizedAgentId ? existingRuntimeBinding?.sessionId : undefined;
		let runtimeAgentId = authorizedAgentId;
		if (tab && (!stableSessionId || !runtimeAgentId)) {
			const runtimeBinding = await this.runtimeBindings.bindRuntime({ projectId: tab.projectId, agent: tab });
			stableSessionId = runtimeBinding.sessionId;
			runtimeAgentId = tab.id;
		}

		const sessionId = stableSessionId ?? agentId;
		const pending = this.sessionMirrorPending.get(sessionId);
		if (sessionId !== agentId && pending) return pending;
		const task = this.ensureSessionMirrorInner(sessionId, runtimeAgentId, sessionTitle, sessionPath).finally(() => {
			if (this.sessionMirrorPending.get(sessionId) === task) this.sessionMirrorPending.delete(sessionId);
		});
		this.sessionMirrorPending.set(sessionId, task);
		return task;
	}

	private async ensureSessionMirrorInner(sessionId: string, agentId: string | undefined, sessionTitle?: string, sessionPath?: string): Promise<string | undefined> {
		if (!this.connection.client || this.status.status !== "connected") {
			log("[飞书 Session Mirror] Bridge 未连接，跳过自动拉群");
			return undefined;
		}

		const groupName = `Pi Agent - ${(sessionTitle || feishuT(this.locale, "group.newSession", { id: sessionId.slice(0, 8) })).slice(0, 50)}`;

		let existingChatId = Array.from(this.chatBindings.entries()).find(([, binding]) => binding.sessionId === sessionId || (agentId !== undefined && binding.agentId === agentId))?.[0];

		if (!existingChatId && sessionPath) {
			const pathMatches = Array.from(this.chatBindings.entries()).filter(([, binding]) => binding.sessionPath === sessionPath);
			if (pathMatches.length === 1 && pathMatches[0][1].source === "session-mirror") {
				const [cid, binding] = pathMatches[0];
				existingChatId = cid;
				log(`[飞书 Session Mirror] 按唯一 sessionPath 迁移旧群: ${cid} (path: ${sessionPath})`);
				const previousSessionId = binding.sessionId;
				const previousAgentId = binding.agentId;
				binding.sessionId = sessionId;
				binding.agentId = agentId;
				this.indexBinding(binding, previousAgentId, previousSessionId);
				this.persistBindings();
			}
		}

		if (existingChatId) {
			const effectiveUserOpenId = this.botConfig.defaultUserOpenId || this.userOpenId;
			const binding = this.chatBindings.get(existingChatId);
			if (binding) {
				const previousAgentId = binding.agentId;
				binding.agentId = agentId ?? binding.agentId;
				this.indexBinding(binding, previousAgentId);
				if (previousAgentId !== binding.agentId) this.persistBindings();
				if (effectiveUserOpenId && !binding.userId) {
					log(`[飞书 Session Mirror] 检测到空群 ${existingChatId}，尝试补加用户 ${effectiveUserOpenId}`);
					await this.repairEmptyGroup(existingChatId, effectiveUserOpenId).catch(() => {});
					binding.userId = effectiveUserOpenId;
					this.persistBindings();
				}
			}
			return existingChatId;
		}

		let persistedChatId = getPersistentChatId(`session:${sessionId}`);
		if (!persistedChatId && sessionPath) persistedChatId = getPersistentChatId(sessionPath);
		if (!persistedChatId && agentId) persistedChatId = getPersistentChatId(`agent:${agentId}`);
		if (persistedChatId) {
			const activePersistedBinding = this.chatBindings.get(persistedChatId);
			if (activePersistedBinding) {
				log(`[飞书 Session Mirror] 持久化群 ${persistedChatId} 已绑定其他会话，跳过自动 mirror`);
				return undefined;
			}
			log(`[飞书 Session Mirror] 按持久化映射复用群: ${persistedChatId} (session: ${sessionId.slice(0, 8)})`);
			const agentTab = agentId ? this.agentManager.list().find((t) => t.id === agentId) : undefined;
			const binding: FeishuChatBinding = {
				chatId: persistedChatId,
				botId: this.botConfig.id,
				userId: this.botConfig.defaultUserOpenId ?? this.userOpenId ?? "",
				sessionId,
				agentId,
				sessionPath: agentTab?.sessionPath ?? sessionPath,
				workspaceId: this.botConfig.defaultWorkspaceId ?? "",
				source: "session-mirror" as const,
				chatType: "group",
				groupName,
				createdAt: Date.now(),
			};
			this.chatBindings.set(persistedChatId, binding);
			this.indexBinding(binding);
			this.updateStatus({ activeBindings: this.chatBindings.size });
			this.persistBindings();
			this.pushBindings();
			log(`[飞书 Session Mirror] 持久化群绑定已恢复: ${persistedChatId}`);
			return persistedChatId;
		}

		log(`[飞书 Session Mirror] 正在创建群: ${groupName}`);

		let effectiveUserOpenId: string | undefined = this.botConfig.defaultUserOpenId || this.userOpenId || undefined;

		if (effectiveUserOpenId && effectiveUserOpenId === this.botOpenId) {
			warn(`[飞书 Session Mirror] ⚠️ 配置的 open_id (${effectiveUserOpenId}) 是 Bot 自己的，已忽略`);
			warn(`[飞书 Session Mirror] 💡 请在飞书中给 Bot 发 /whoami，Bot 会回复你真正的用户 open_id`);
			effectiveUserOpenId = undefined;
		}

		if (!effectiveUserOpenId) {
			log("[飞书 Session Mirror] ⚠️ 用户 open_id 未获取，群聊将只有 Bot");
			log("[飞书 Session Mirror] 💡 提示：在飞书中给 Bot 发送任意消息或 /whoami，即可自动记录；或将 open_id 填入配置中的「你的 Open ID」字段");
		}

		try {
			const chatData: Record<string, unknown> = {
				name: groupName,
				chat_mode: "group",
				chat_type: "private",
				external: false,
			};
			if (effectiveUserOpenId) {
				chatData.user_id_list = [effectiveUserOpenId];
			}

			const resp = await this.connection.client.im.chat.create({
				data: chatData,
				params: { user_id_type: "open_id" },
			});

			const respAny = resp as Record<string, unknown>;
			const chatId = ((respAny?.data as Record<string, unknown>)?.chat_id as string) ?? (respAny?.chat_id as string) ?? undefined;
			if (!chatId) {
				logErr("[飞书 Session Mirror] 创建群未返回 chat_id, 原始响应:", JSON.stringify(resp).slice(0, 200));
				return undefined;
			}

			log(`[飞书 Session Mirror] 群创建成功: chatId=${chatId}, 成员数=${effectiveUserOpenId ? 2 : 1}`);

			const agentTab = agentId ? this.agentManager.list().find((t) => t.id === agentId) : undefined;
			const effectiveSessionPath = agentTab?.sessionPath ?? sessionPath;
			const binding: FeishuChatBinding = {
				chatId,
				botId: this.botConfig.id,
				userId: effectiveUserOpenId ?? "",
				sessionId,
				agentId,
				sessionPath: effectiveSessionPath,
				workspaceId: this.botConfig.defaultWorkspaceId ?? "",
				source: "session-mirror" as const,
				chatType: "group",
				groupName,
				createdAt: Date.now(),
			};
			this.chatBindings.set(chatId, binding);
			this.indexBinding(binding);
			this.updateStatus({ activeBindings: this.chatBindings.size });
			this.persistBindings();
			this.pushBindings();

			if (effectiveSessionPath) {
				setPersistentChatId(effectiveSessionPath, chatId);
				log(`[飞书 Session Mirror] 已持久化 chatId 映射: ${effectiveSessionPath} → ${chatId}`);
			}
			setPersistentChatId(`session:${sessionId}`, chatId);
			if (agentId) setPersistentChatId(`agent:${agentId}`, chatId);

			await this.sendSmartMessage(chatId, feishuT(this.locale, "session.mirrorWelcome", { id: sessionId.slice(0, 8) }));
			return chatId;
		} catch (e) {
			const errMsg = e instanceof Error ? e.message : String(e);
			logErr("[飞书 Session Mirror] 创建群失败:", errMsg);

			if (errMsg.includes("permission") || errMsg.includes("scope") || errMsg.includes("230001")) {
				logErr("[飞书 Session Mirror] 可能缺少 im:chat 权限，请在飞书开放平台→权限管理中开启「获取群聊信息」权限");
			}
			return undefined;
		}
	}

	private async repairEmptyGroup(chatId: string, userOpenId: string): Promise<void> {
		if (!this.connection.client) return;
		try {
			await this.connection.client.im.chat.members.add({
				path: { chat_id: chatId },
				data: { id_list: [userOpenId] },
				params: { member_id_type: "open_id" },
			});
			log(`[飞书 Session Mirror] 已将用户 ${userOpenId} 补加入群 ${chatId}`);
		} catch (e) {
			logErr("[飞书 Session Mirror] 补加成员失败:", e);
		}
	}

	async startSessionMirrorRun(agentId: string, sessionTitle?: string, sessionPath?: string): Promise<void> {
		if (!this.connection.client || this.status.status !== "connected") return;

		await this.ensureSessionMirror(agentId, sessionTitle, sessionPath);

		const binding = this.sessionToChat.get(agentId) ? this.chatBindings.get(this.sessionToChat.get(agentId)!) : undefined;
		if (!binding || binding.source !== "session-mirror") return;
		if (this.streamingCards.has(agentId)) return;

		const initialState = createInitialState();
		this.streamingRunStates.set(agentId, initialState);

		this.pendingCardEvents.set(agentId, []);

		try {
			const cardStream = await CardStream.open(
				this.connection.client!,
				binding.chatId,
				renderRunCard(initialState, {
					locale: this.locale,
					stopHint: feishuT(this.locale, "card.stopHint"),
				}),
			);
			this.streamingCards.set(agentId, cardStream);
			this.replayBufferedEvents(agentId, cardStream);
		} catch (e) {
			logErr("[飞书 Session Mirror] 流式卡片创建失败:", e);
			this.streamingRunStates.delete(agentId);
			this.pendingCardEvents.delete(agentId);
		}
	}

	stopSessionMirrorRun(agentId: string): void {
		const state = this.streamingRunStates.get(agentId);
		const card = this.streamingCards.get(agentId);
		if (state && card) {
			const finalState = markInterrupted(state);
			void card
				.flush(renderRunCard(finalState, { locale: this.locale }))
				.then(() => card.close())
				.catch(() => {});
		}
		this.streamingCards.delete(agentId);
		this.streamingRunStates.delete(agentId);
		this.pendingCardEvents.delete(agentId);
	}

	private async handleStopCommand(ctx: FeishuMessageContext): Promise<void> {
		const binding = this.chatBindings.get(ctx.chatId);
		if (!binding) {
			await this.sendSmartMessage(ctx.chatId, feishuT(this.locale, "session.notBound"));
			return;
		}

		const agentId = await this.ensureRuntimeBinding(binding);
		if (!agentId) {
			await this.sendSmartMessage(ctx.chatId, feishuT(this.locale, "session.runtimeUnavailable"));
			return;
		}

		const state = this.streamingRunStates.get(agentId);
		const card = this.streamingCards.get(agentId);
		if (state && card) {
			void card
				.flush(renderRunCard(markInterrupted(state), { locale: this.locale }))
				.then(() => card.close())
				.catch(() => {});
			this.streamingCards.delete(agentId);
			this.streamingRunStates.delete(agentId);
			this.pendingCardEvents.delete(agentId);
		}

		await this.runtimeBindings.abortRuntime(binding.sessionId);
		await this.sendSmartMessage(ctx.chatId, feishuT(this.locale, "session.stopped"));
	}

	private async handleStatusCommand(ctx: FeishuMessageContext): Promise<void> {
		const binding = this.chatBindings.get(ctx.chatId);
		const statusLabel = feishuT(this.locale, `status.${this.status.status}` as "status.disconnected" | "status.connecting" | "status.connected" | "status.error");
		const lines = [
			feishuT(this.locale, "status.heading"),
			feishuT(this.locale, "status.status", { status: statusLabel }),
			feishuT(this.locale, "status.bindings", { count: this.chatBindings.size }),
			binding ? feishuT(this.locale, "status.session", { id: binding.sessionId.slice(0, 8) }) : feishuT(this.locale, "status.sessionUnbound"),
		];
		await this.sendCardMessage(ctx.chatId, { config: { wide_screen_mode: true, update_multi: true }, header: { title: { tag: "plain_text", content: feishuT(this.locale, "status.header") }, template: "blue" }, elements: [{ tag: "markdown", content: lines.join("\n") }] });
	}

	private async handleModelCommand(ctx: FeishuMessageContext, text: string): Promise<void> {
		const args = text.split(/\s+/).slice(1).join(" ");
		if (args) {
			await this.doSetModel(ctx.chatId, args);
			return;
		}
		const binding = this.chatBindings.get(ctx.chatId);
		if (!binding) {
			await this.sendSmartMessage(ctx.chatId, feishuT(this.locale, "session.notBoundCreateFirst"));
			return;
		}
		const agentId = await this.ensureRuntimeBinding(binding);
		if (!agentId) {
			await this.sendSmartMessage(ctx.chatId, feishuT(this.locale, "session.runtimeUnavailable"));
			return;
		}
		const models = await this.runtimeBindings.listRuntimeModels(binding.sessionId).catch(() => [] as AvailableModel[]);
		if (!models.length) {
			await this.sendSmartMessage(ctx.chatId, feishuT(this.locale, "model.unavailable"));
			return;
		}
		const state = await this.runtimeBindings.getRuntimeState(binding.sessionId).catch(() => undefined);
		const current = state ? `${state.provider}/${state.modelId}` : feishuT(this.locale, "model.none");
		await this.sendCardMessage(ctx.chatId, buildModelPickerCard({ current, models, locale: this.locale }));
	}

	private async handleCardAction(event: FeishuCardActionEvent): Promise<void> {
		const inputAnswer = parseAskInputValue(event.raw);
		if (inputAnswer !== undefined) {
			await this.handleAskInputSubmit(event, inputAnswer);
			return;
		}

		const askAction = parseAskActionValue(event.action.value);
		if (askAction) {
			await this.handleAskCardAction(event, askAction);
			return;
		}

		const action = parseModelActionValue(event.action.value);
		if (!action) return;
		const binding = this.chatBindings.get(event.chatId);
		if (!binding) {
			await this.sendSmartMessage(event.chatId, feishuT(this.locale, "session.notBound"));
			return;
		}
		const agentId = await this.ensureRuntimeBinding(binding);
		if (!agentId) {
			await this.sendSmartMessage(event.chatId, feishuT(this.locale, "session.runtimeUnavailable"));
			return;
		}
		const models = await this.runtimeBindings.listRuntimeModels(binding.sessionId).catch(() => [] as AvailableModel[]);
		if (!models.some((m) => m.provider === action.provider && m.id === action.modelId)) {
			await this.sendSmartMessage(event.chatId, feishuT(this.locale, "model.notAvailable", { model: `${action.provider}/${action.modelId}` }));
			return;
		}
		try {
			await this.runtimeBindings.setRuntimeModel(binding.sessionId, action.provider, action.modelId);
			await this.sendSmartMessage(event.chatId, feishuT(this.locale, "model.switched", { model: `${action.provider}/${action.modelId}` }));
		} catch (e) {
			logErr("[飞书 Bridge] 模型切换失败:", e);
			await this.sendSmartMessage(event.chatId, feishuT(this.locale, "model.switchFailed"));
		}
	}

	private handleAskRequest(agentId: string, typed: Record<string, unknown>): void {
		const rawMethod = String(typed.method ?? "");
		const requestId = String(typed.id ?? "");

		if (!requestId || !isAskMethod(rawMethod)) return;
		const method = rawMethod;
		const chatId = this.getBestChatId(agentId);
		if (!chatId) return;

		const rawTitle = String(typed.title ?? typed.question ?? "");
		const batchEnvelope = tryParseBatchAskEnvelope(rawTitle);

		const rawOptions = Array.isArray(typed.options)
			? typed.options.map(normalizeAskOption).filter((option): option is NonNullable<ReturnType<typeof normalizeAskOption>> => {
					if (!option) return false;
					const label = typeof option === "string" ? option : option.label;
					return !label.startsWith("✎");
				})
			: undefined;

		const effectiveMethod: AskUiRequest["method"] = method === "select" && (!rawOptions || rawOptions.length === 0) ? "input" : method;

		const request: AskUiRequest = batchEnvelope
			? {
					requestId,
					method: "batch_ask",
					title: "",
					batchQuestions: batchEnvelope.questions,
				}
			: {
					requestId,
					method: effectiveMethod,
					title: rawTitle,
					options: rawOptions,
				};

		const key = `${chatId}:${requestId}`;
		if (this.pendingAsks.has(key)) return;
		this.pendingAsks.set(key, {
			requestId,
			agentId,
			method: request.method,
			title: request.title,
			chatId,
			askedAt: Date.now(),

			options: request.method === "select" ? request.options : undefined,
		});
		void this.sendCardMessage(chatId, buildAskCard({ request, locale: this.locale })).catch((e) => logErr("[飞书 Bridge] ask 卡片发送失败:", e));
	}

	private async handleAskInputSubmit(event: FeishuCardActionEvent, answer: string): Promise<void> {
		const pending = this.getPendingAskForChat(event.chatId);
		if (!pending || pending.method === "confirm" || pending.method === "batch_ask") {
			await this.sendSmartMessage(event.chatId, feishuT(this.locale, "ask.expired"));
			return;
		}
		this.runtimeBindings.sendUIResponse(pending.agentId, pending.requestId, { value: answer });
		this.pendingAsks.delete(`${event.chatId}:${pending.requestId}`);
		await this.sendSmartMessage(event.chatId, feishuT(this.locale, "ask.answeredInput", { answer }));
	}

	private getPendingAskForChat(chatId: string): PendingAsk | undefined {
		let earliest: PendingAsk | undefined;
		for (const pending of this.pendingAsks.values()) {
			if (pending.chatId !== chatId) continue;
			if (!earliest || pending.askedAt < earliest.askedAt) earliest = pending;
		}
		return earliest;
	}

	private clearPendingAsksForAgent(agentId: string): void {
		for (const [key, pending] of this.pendingAsks) {
			if (pending.agentId === agentId) this.pendingAsks.delete(key);
		}
	}

	private async handleAskCardAction(event: FeishuCardActionEvent, action: NonNullable<ReturnType<typeof parseAskActionValue>>): Promise<void> {
		const key = `${event.chatId}:${action.requestId}`;
		const pending = this.pendingAsks.get(key);
		if (!pending) {
			await this.sendSmartMessage(event.chatId, feishuT(this.locale, "ask.expired"));
			return;
		}

		let response: { value?: string; confirmed?: boolean; cancelled?: boolean };
		let feedback: string;
		if (action.kind === "confirm") {
			response = { confirmed: action.confirmed };
			feedback = action.confirmed ? feishuT(this.locale, "ask.confirmed") : feishuT(this.locale, "ask.rejected");
		} else if (action.kind === "cancel") {
			response = { cancelled: true };
			feedback = feishuT(this.locale, "ask.cancelled");
		} else {
			response = { value: action.option };
			feedback = feishuT(this.locale, "ask.answered", { answer: action.option });
		}

		this.runtimeBindings.sendUIResponse(pending.agentId, pending.requestId, response);
		this.pendingAsks.delete(key);
		await this.sendSmartMessage(event.chatId, feedback);
	}

	private async doSetModel(chatId: string, rawId: string): Promise<void> {
		const parts = rawId.split("/");
		if (parts.length < 2) {
			await this.sendSmartMessage(chatId, feishuT(this.locale, "model.usage"));
			return;
		}
		const provider = parts.slice(0, -1).join("/");
		const modelId = parts[parts.length - 1];
		const binding = this.chatBindings.get(chatId);
		if (!binding) {
			await this.sendSmartMessage(chatId, feishuT(this.locale, "session.notBound"));
			return;
		}
		const agentId = await this.ensureRuntimeBinding(binding);
		if (!agentId) {
			await this.sendSmartMessage(chatId, feishuT(this.locale, "session.runtimeUnavailable"));
			return;
		}
		try {
			await this.runtimeBindings.setRuntimeModel(binding.sessionId, provider, modelId);
			await this.sendSmartMessage(chatId, feishuT(this.locale, "model.switched", { model: `${provider}/${modelId}` }));
		} catch (e) {
			logErr("[飞书 Bridge] 模型切换失败:", e);
			await this.sendSmartMessage(chatId, feishuT(this.locale, "model.switchFailed"));
		}
	}

	private async sendSmartMessage(chatId: string, text: string): Promise<boolean> {
		if (!this.connection.client) return false;
		const mode = chooseMessageMode(text);
		const language = feishuLanguage(this.locale);
		try {
			if (mode === "interactive") {
				for (const card of buildMarkdownCards(text, language)) {
					await this.connection.client.im.message.create({ params: { receive_id_type: "chat_id" }, data: { receive_id: chatId, msg_type: "interactive", content: JSON.stringify(card) } });
				}
			} else if (mode === "post") {
				for (const post of buildPostMessages(text, language)) {
					await this.connection.client.im.message.create({ params: { receive_id_type: "chat_id" }, data: { receive_id: chatId, msg_type: "post", content: JSON.stringify(post) } });
				}
			} else {
				await this.connection.client.im.message.create({ params: { receive_id_type: "chat_id" }, data: { receive_id: chatId, msg_type: "text", content: JSON.stringify({ text }) } });
			}
			return true;
		} catch (e) {
			logErr("[飞书 Bridge] 发送消息失败:", e);
			return false;
		}
	}

	private async sendCardMessage(chatId: string, card: Record<string, unknown>): Promise<void> {
		if (!this.connection.client) return;
		try {
			await this.connection.client.im.message.create({ params: { receive_id_type: "chat_id" }, data: { receive_id: chatId, msg_type: "interactive", content: JSON.stringify(card) } });
		} catch (e) {
			logErr("[飞书 Bridge] 发送卡片失败:", e);
		}
	}

	private async sendHelpCard(chatId: string): Promise<void> {
		await this.sendCardMessage(chatId, {
			config: { wide_screen_mode: true, update_multi: true },
			header: { title: { tag: "plain_text", content: feishuT(this.locale, "help.title") }, template: "green" },
			elements: [{ tag: "markdown", content: feishuT(this.locale, "help.body") }],
		});
	}

	private async sendResultFallback(chatId: string, sessionId: string, startTime: number): Promise<void> {
		const messages = this.runtimeBindings.getRuntimeMessages(sessionId);
		const lastAssistant = messages.filter((m) => m.role === "assistant").pop();
		const resultText = lastAssistant?.text ?? "";
		if (!resultText.trim()) return;
		const duration = ((Date.now() - startTime) / 1000).toFixed(1);
		const cleanText = sanitizeFeishuUserVisibleText(resultText);
		if (cleanText) await this.sendSmartMessage(chatId, `${cleanText}\n\n${feishuT(this.locale, "result.completed", { duration })}`);
	}

	private async processFeishuActions(chatId: string, messages: ChatMessage[]): Promise<void> {
		const lastAssistant = messages.filter((m) => m.role === "assistant").pop();
		const text = lastAssistant?.text ?? "";
		if (!text) return;
		const userText = [...messages].reverse().find((m) => m.role === "user")?.text ?? "";
		const canSendFile = hasExplicitFeishuFileSendIntent(userText);

		const sendMatch = text.match(/\[SEND_FILE:([^\]]+)\]/);
		if (sendMatch) {
			const filePath = sendMatch[1].trim();
			if (!canSendFile) {
				log(`[飞书 Bridge] 忽略 SEND_FILE：用户未明确要求发送文件: ${filePath}`);
			} else {
				log(`[飞书 Bridge] 检测到 SEND_FILE: ${filePath}`);
				const result = await this.sendFeishuFile(chatId, filePath);
				log(`[飞书 Bridge] SEND_FILE 结果: ${result}`);
				await this.sendSmartMessage(chatId, result);
			}
		} else if (canSendFile) {
			const { existsSync } = await import("node:fs");
			const pathPattern = /(?:保存到|已生成|文件在|输出到|写入|created|saved to|written to)[：:\s]*([^\s，,\n""<>]{5,200}\.(?:md|txt|csv|json|html|pdf|png|jpg|xlsx|docx|pptx|py|ts|js))/gi;
			const autoFiles: string[] = [];
			let m: RegExpExecArray | null;
			while ((m = pathPattern.exec(text)) !== null) {
				const fp = m[1].trim();
				if (fp && existsSync(fp) && !autoFiles.includes(fp)) autoFiles.push(fp);
			}
			if (autoFiles.length > 0) {
				log(`[飞书 Bridge] 自动检测到 ${autoFiles.length} 个文件: ${autoFiles.join(", ")}`);
				for (const fp of autoFiles.slice(0, 3)) {
					const result = await this.sendFeishuFile(chatId, fp);
					log(`[飞书 Bridge] 自动发送文件结果: ${result}`);
					await this.sendSmartMessage(chatId, result);
				}
			}
		}
		const docMatch = text.match(/\[CREATE_DOC:([^\]]+)\]/);
		if (docMatch) {
			const title = docMatch[1].trim() || feishuT(this.locale, "doc.defaultTitle");
			const result = await this.createFeishuDoc(chatId, title, text);

			if (result.startsWith("❌")) await this.sendSmartMessage(chatId, result);
		}
	}

	private async sendFeishuFile(chatId: string, filePath: string, fileName?: string): Promise<string> {
		if (!this.connection.client) return feishuT(this.locale, "file.bridgeNotReady");
		const { existsSync, readFileSync, statSync } = await import("node:fs");
		const { basename } = await import("node:path");
		if (!existsSync(filePath)) return feishuT(this.locale, "file.notFound", { path: filePath });
		const fName = fileName || basename(filePath);

		if (statSync(filePath).size > 30 * 1024 * 1024) return feishuT(this.locale, "file.tooLarge");
		const fileData = readFileSync(filePath);

		try {
			const uploadResp = await this.connection.client.im.file!.create({
				data: { file_type: "stream", file_name: fName, file: fileData },
			});
			const fileKey = (uploadResp as Record<string, unknown>)?.file_key as string;
			if (!fileKey) {
				logErr("[飞书 Bridge] 上传文件未返回 file_key:", uploadResp);
				return feishuT(this.locale, "file.uploadFailed");
			}

			await this.connection.client.im.message.create({
				params: { receive_id_type: "chat_id" },
				data: {
					receive_id: chatId,
					msg_type: "file",
					content: JSON.stringify({ file_key: fileKey }),
				},
			});
			return feishuT(this.locale, "file.sent", { name: fName });
		} catch (e) {
			logErr("[飞书 Bridge] 发送文件失败:", e);
			return feishuT(this.locale, "file.sendFailed");
		}
	}

	private async createFeishuDoc(chatId: string, title: string, body = ""): Promise<string> {
		if (!this.connection.client) return feishuT(this.locale, "file.bridgeNotReady");
		try {
			const resp = await this.connection.client.request<{
				code?: number;
				msg?: string;
				data?: { document?: { document_id?: string; title?: string; url?: string } };
			}>({
				method: "POST",
				url: "https://open.feishu.cn/open-apis/docx/v1/documents",
				data: { title },
			});
			const doc = resp?.data?.document;
			if (!doc?.document_id) {
				logErr("[飞书 Bridge] 创建文档未返回 document_id:", resp);
				return feishuT(this.locale, "doc.createFailed");
			}

			const children = buildFeishuTextChildren(body);
			if (children.length > 0) {
				try {
					await this.connection.client.request({
						method: "POST",
						url: `https://open.feishu.cn/open-apis/docx/v1/documents/${doc.document_id}/blocks/${doc.document_id}/children`,
						params: { document_revision_id: -1 },
						data: { children, index: 0 },
					});
				} catch (writeError) {
					logErr("[飞书 Bridge] 写入飞书文档正文失败:", writeError);
					const docUrl = doc.url || `https://www.feishu.cn/docx/${doc.document_id}`;
					await this.sendSmartMessage(chatId, `📄 **${title}**\n${docUrl}\n\n${feishuT(this.locale, "doc.bodyWriteFailed")}`);
					return feishuT(this.locale, "doc.bodyWriteFailedResult", { title, url: docUrl });
				}
			}

			const docUrl = doc.url || `https://www.feishu.cn/docx/${doc.document_id}`;
			const preview = stripFeishuActionMarkers(body);
			await this.sendSmartMessage(chatId, `📄 **${title}**\n${docUrl}${preview ? `\n\n${feishuT(this.locale, "doc.bodyWritten")}` : ""}`);
			return feishuT(this.locale, "doc.created", { title, url: docUrl });
		} catch (e) {
			logErr("[飞书 Bridge] 创建飞书文档失败:", e);
			return feishuT(this.locale, "doc.createFailed");
		}
	}

	private async downloadImage(messageId: string, imageKey: string): Promise<Buffer> {
		if (!this.connection.client) throw new Error("飞书 Client 未初始化");
		try {
			return await this.downloadMessageResource(messageId, imageKey, "image");
		} catch {
			warn("[飞书 Bridge] messageResource 失败，回退到 image.get");
		}
		return this.downloadViaImageGet(imageKey);
	}
	private async downloadMessageResource(messageId: string, fileKey: string, type: "image" | "file"): Promise<Buffer> {
		const resp = await this.connection.client!.im.messageResource.get({ path: { message_id: messageId, file_key: fileKey }, params: { type } });
		return this.streamToBuffer(resp);
	}
	private async downloadViaImageGet(imageKey: string): Promise<Buffer> {
		const resp = await this.connection.client!.request({ method: "GET", url: `https://open.feishu.cn/open-apis/im/v1/images/${imageKey}` });
		return this.streamToBuffer(resp);
	}
	private async downloadFile(messageId: string, fileKey: string): Promise<Buffer> {
		return this.downloadMessageResource(messageId, fileKey, "file");
	}

	private static readonly MAX_RESOURCE_DOWNLOAD_BYTES = 64 * 1024 * 1024;

	private async streamToBuffer(result: unknown): Promise<Buffer> {
		const resp = result as Record<string, unknown>;
		const cap = FeishuBridge.MAX_RESOURCE_DOWNLOAD_BYTES;
		if (typeof resp?.getReadableStream === "function") {
			const chunks: Buffer[] = [];
			let total = 0;
			const readable = (resp.getReadableStream as () => NodeJS.ReadableStream)();
			try {
				for await (const chunk of readable as AsyncIterable<Buffer | string>) {
					const piece = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
					total += piece.length;
					if (total > cap) throw new Error(`FEISHU_RESOURCE_TOO_LARGE:${total}`);
					chunks.push(piece);
				}
			} finally {
				const destroyable = readable as { destroy?: (err?: Error) => void };
				if (total > cap) destroyable.destroy?.(new Error("resource exceeds download budget"));
			}
			return Buffer.concat(chunks);
		}
		if (typeof (result as AsyncIterable<unknown>)?.[Symbol.asyncIterator] === "function") {
			const chunks: Buffer[] = [];
			let total = 0;
			for await (const chunk of result as AsyncIterable<Buffer | string>) {
				const piece = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
				total += piece.length;
				if (total > cap) throw new Error(`FEISHU_RESOURCE_TOO_LARGE:${total}`);
				chunks.push(piece);
			}
			return Buffer.concat(chunks);
		}
		if (typeof resp?.writeFile === "function") {
			const { readFileSync, unlinkSync } = await import("node:fs");
			const tmp = `/tmp/feishu-dl-${Date.now()}.tmp`;
			await (resp.writeFile as (p: string) => Promise<void>)(tmp);
			const data = readFileSync(tmp);
			try {
				unlinkSync(tmp);
			} catch {}
			return data;
		}
		logErr("[飞书 Bridge] streamToBuffer 未知格式:", typeof result);
		throw new Error("无法读取飞书文件流");
	}

	private isBotMentioned(mentions: Array<{ name: string; id: string | { open_id: string; union_id: string; user_id: string } }> | undefined): boolean {
		if (!mentions || mentions.length === 0) return false;
		for (const m of mentions) {
			const openId = typeof m.id === "string" ? m.id : m.id.open_id;
			if (openId === "all") continue;
			if (openId === this.botOpenId) return true;
		}
		return false;
	}

	private async getGroupInfo(chatId: string): Promise<FeishuGroupInfo | null> {
		const cached = this.groupInfoCache.get(chatId);
		if (cached && Date.now() - cached.cachedAt < GROUP_CACHE_TTL) return cached;
		if (!this.connection.client) return null;
		try {
			const [chatResp, members] = await Promise.all([this.connection.client.im.chat.get({ path: { chat_id: chatId } }), this.fetchGroupMembers(chatId)]);
			const name = (chatResp as { data?: { name?: string } }).data?.name ?? feishuT(this.locale, "group.unknown");
			const info: FeishuGroupInfo = { chatId, name, members, cachedAt: Date.now() };
			this.groupInfoCache.set(chatId, info);
			return info;
		} catch (e) {
			warn("[飞书 Bridge] 获取群聊信息失败:", e);
			return null;
		}
	}

	private async fetchGroupMembers(chatId: string): Promise<FeishuGroupMember[]> {
		if (!this.connection.client) return [];
		try {
			const resp = await this.connection.client.im.chat.members.get({ path: { chat_id: chatId }, params: { user_id_type: "open_id", page_size: 100 } });
			return ((resp as { data?: { items?: Array<{ open_id: string; name?: string }> } }).data?.items ?? []).map((m) => ({ openId: m.open_id, name: m.name ?? m.open_id }));
		} catch (e) {
			warn("[飞书 Bridge] 获取群成员失败:", e);
			return [];
		}
	}

	private async getUserName(userId: string): Promise<string> {
		const cached = this.userNameCache.get(userId);
		if (cached) return cached;
		this.userNameCache.set(userId, userId);
		return userId;
	}

	private inferImageMediaType(data: Buffer): string {
		if (data.length < 4) return "image/png";
		if (data[0] === 0x89 && data[1] === 0x50) return "image/png";
		if (data[0] === 0xff && data[1] === 0xd8) return "image/jpeg";
		if (data[0] === 0x47 && data[1] === 0x49) return "image/gif";
		if (data[0] === 0x52 && data[1] === 0x49) return "image/webp";
		return "image/png";
	}

	private async loadPersistedBindings(): Promise<void> {
		const bindings = loadBindings(this.botConfig.id);
		const tabs = this.agentManager.list();
		const normalizePath = (value: string): string => {
			const normalized = value.replace(/\\/g, "/").replace(/\/+$/, "");
			return /^[A-Za-z]:\//.test(normalized) ? normalized.toLowerCase() : normalized;
		};
		const persistedPathCounts = new Map<string, number>();
		for (const binding of bindings) {
			if (!binding.sessionPath) continue;
			const pathKey = normalizePath(binding.sessionPath);
			persistedPathCounts.set(pathKey, (persistedPathCounts.get(pathKey) ?? 0) + 1);
		}

		let migrated = false;
		for (const b of bindings) {
			let candidateTab = b.agentId ? tabs.find((candidate) => candidate.id === b.agentId) : undefined;
			if (!candidateTab) candidateTab = tabs.find((candidate) => candidate.id === b.sessionId);
			if (!candidateTab && b.sessionPath) {
				const pathKey = normalizePath(b.sessionPath);
				const samePath = tabs.filter((candidate) => candidate.sessionPath && normalizePath(candidate.sessionPath) === pathKey);
				if (persistedPathCounts.get(pathKey) === 1 && samePath.length === 1) candidateTab = samePath[0];
			}

			if (candidateTab?.status === "error" || candidateTab?.status === "closed") candidateTab = undefined;

			const stableSessionId = b.sessionId;
			let authorizedTab: AgentTab | undefined;
			if (candidateTab) {
				try {
					const runtimeBinding = await this.runtimeBindings.bindRuntime({
						projectId: candidateTab.projectId,
						agent: candidateTab,
						existingSessionId: b.sessionId,
					});
					if (runtimeBinding.sessionId !== b.sessionId) {
						throw new Error(`Runtime gateway returned a different Session: ${runtimeBinding.sessionId}`);
					}
					authorizedTab = candidateTab;
					migrated ||= b.agentId !== candidateTab.id;
				} catch (error) {
					warn(`[飞书 Bridge] 持久绑定 identity 迁移失败，保留原 stable ID: ${error instanceof Error ? error.message : String(error)}`);
				}
			}
			if (!authorizedTab && b.agentId) migrated = true;

			const binding: FeishuChatBinding = {
				chatId: b.chatId,
				botId: b.botId,
				userId: b.userId,
				sessionId: stableSessionId,
				agentId: authorizedTab?.id,
				sessionPath: authorizedTab?.sessionPath ?? b.sessionPath,
				workspaceId: b.workspaceId,
				channelId: b.channelId,
				modelId: b.modelId,
				source: b.source as "feishu" | "session-mirror",
				chatType: b.chatType as "p2p" | "group",
				groupName: b.groupName,
				createdAt: b.createdAt,
			};
			this.chatBindings.set(b.chatId, binding);
			this.indexBinding(binding);
			if (!authorizedTab) {
				log(`[飞书 Bridge] 保留无主绑定（等后续恢复）: ${b.groupName ?? b.chatId}，sessionPath=${b.sessionPath ?? "(无)"}`);
			}
			if (binding.sessionPath) setPersistentChatId(binding.sessionPath, b.chatId);
			setPersistentChatId(`session:${binding.sessionId}`, b.chatId);
			if (binding.agentId) setPersistentChatId(`agent:${binding.agentId}`, b.chatId);
		}
		if (migrated) this.persistBindings();
		if (this.chatBindings.size > 0) log(`[飞书 Bridge] 已恢复 ${this.chatBindings.size} 个聊天绑定`);
		this.updateStatus({ activeBindings: this.chatBindings.size });
	}

	private persistBindings(): void {
		const bindings: FeishuChatBindingPersist[] = Array.from(this.chatBindings.values()).map((b) => ({
			chatId: b.chatId,
			botId: b.botId,
			userId: b.userId,
			sessionId: b.sessionId,
			agentId: b.agentId,
			sessionPath: b.sessionPath,
			workspaceId: b.workspaceId,
			channelId: b.channelId,
			modelId: b.modelId,
			source: b.source,
			chatType: b.chatType,
			groupName: b.groupName,
			createdAt: b.createdAt,
		}));
		saveBindings(this.botConfig.id, bindings);
	}

	private updateStatus(partial: Partial<FeishuBridgeStatus>): void {
		this.status = { ...this.status, ...partial };
		const win = this.getWindow();
		if (win && !win.isDestroyed()) win.webContents.send(ipcChannels.feishuStatus, this.status);
	}

	private pushBindings(): void {
		const win = this.getWindow();
		if (win && !win.isDestroyed()) {
			win.webContents.send(ipcChannels.feishuBindingsChanged, this.listBindings());
		}
	}

	pushMessage(message: FeishuChatMessage): void {
		const win = this.getWindow();
		if (win && !win.isDestroyed()) win.webContents.send(ipcChannels.feishuMessages, message);
	}
}
