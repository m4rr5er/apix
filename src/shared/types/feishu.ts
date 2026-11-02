import type { ImChannelBackend } from "./agent";

export type FeishuBotConfig = {
	id: string;
	name: string;
	enabled: boolean;
	appId: string;
	appSecret: string;
	defaultWorkspaceId?: string;
	defaultChannelId?: string;
	defaultModelId?: string;
	requireMention?: boolean;

	defaultUserOpenId?: string;

	backend?: ImChannelBackend;
};

export type FeishuBridgeStatus = {
	status: "disconnected" | "connecting" | "connected" | "error";
	activeBindings: number;
	connectedAt?: number;
	errorMessage?: string;

	botId?: string;
	botOpenId?: string;
	botName?: string;
};

export type FeishuChatBinding = {
	chatId: string;
	botId: string;
	userId: string;

	sessionId: string;

	agentId?: string;
	sessionPath?: string;
	workspaceId: string;
	channelId?: string;
	modelId?: string;
	source: "feishu" | "session-mirror";

	backend?: ImChannelBackend;
	chatType: "p2p" | "group";
	groupName?: string;
	createdAt: number;
};

export type DraftMeta = {
	id: string;
	name: string;
	path: string;
	createdAt: number;
	updatedAt: number;
};

export type ScratchPadData = {
	content: string;
	lastEditedAt: number;
	cursorPosition: number;
};

export type FeishuChatMessage = {
	chatId: string;
	messageId: string;
	senderOpenId: string;
	senderName?: string;
	chatType: "p2p" | "group";
	groupName?: string;
	messageType: "text" | "image" | "post" | "file";
	text: string;
	imageKeys: string[];
	fileKeys: string[];
	timestamp: number;
};

export type FeishuConnectInput = {
	appId: string;
	appSecret: string;
	name?: string;
	defaultUserOpenId?: string;
};

export type FeishuTestResult = {
	success: boolean;
	message: string;
	botName?: string;
};

export type FeishuSessionBotResult = {
	success: boolean;
	message?: string;
	chatId?: string;
};
