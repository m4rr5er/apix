import type { ImChannelBackend } from "./agent";

export type WeChatAccountInfo = {
	ilinkBotId: string;

	ilinkUserId: string;

	displayName: string;
	baseUrl: string;
	loggedInAt: number;

	needsRelogin?: boolean;
};

export type WeChatModelChainEntry = {
	provider: string;
	modelId: string;
	modelName?: string;
};

export type WeChatSettings = {
	enabled: boolean;
	account: WeChatAccountInfo | null;

	defaultWorkspaceId?: string;

	backend?: ImChannelBackend;

	modelChain?: WeChatModelChainEntry[];

	defaultModelId?: string;
};

export type WeChatBridgeStatus = {
	status: "disconnected" | "connecting" | "connected" | "error";
	account: WeChatAccountInfo | null;

	activeBindings: number;
	connectedAt?: number;

	lastMessageAt?: number;
	errorMessage?: string;
};

export type WeChatLoginPhase = "idle" | "waiting" | "scanned" | "need-verify-code" | "confirmed" | "expired" | "error";

export type WeChatLoginState = {
	phase: WeChatLoginPhase;

	qrcodeContent?: string;

	message?: string;
	error?: string;
};

export type WeChatLoginResult = {
	ok: boolean;
	account?: WeChatAccountInfo;
	error?: string;
};

export type WeChatChatBinding = {
	chatId: string;
	userId: string;

	sessionId: string;

	sessionPath?: string;

	agentId?: string;
	workspaceId: string;

	backend?: ImChannelBackend;
	modelId?: string;

	modelProvider?: string;
	createdAt: number;
};

export type WeChatBindingModel = {
	provider: string;
	modelId: string;

	modelName?: string;
};

export type WeChatBindingView = WeChatChatBinding & { currentModel?: WeChatBindingModel };

export type WeChatSettingsSnapshot = {
	settings: WeChatSettings;
	status: WeChatBridgeStatus;
	bindings: WeChatBindingView[];

	projects: Array<{ id: string; name: string }>;
};

export type WeChatIpcResult<T> = ({ ok: true } & T) | { ok: false; message: string };
