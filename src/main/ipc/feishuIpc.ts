import { ipcMain } from "electron";
import type { BrowserWindow } from "electron";
import { randomUUID } from "node:crypto";
import { FeishuBridge, type SessionRuntimeBindingGateway } from "../feishu/FeishuBridge";
import { listBots, getBot, addBot as addFeishuBot, removeBot as removeFeishuBot, updateBot as updateFeishuBot, getDecryptedBotAppSecret, getSessionBotId, setSessionBotId } from "../feishu/FeishuConfig";
import { feishuT, type FeishuLocale } from "../feishu/FeishuI18n";
import type { FeishuBotConfig, FeishuBridgeStatus, FeishuChatBinding, FeishuConnectInput } from "../../shared/types/feishu";
import type { AgentManager } from "../pi/AgentManager";
import type { ProjectStore } from "../projects/ProjectStore";
import type { SessionRuntimeCoordinator } from "../sessions/SessionRuntimeCoordinator";
import { ipcChannels } from "../../shared/ipc";
import { getAppLogger } from "../logging/sharedLogger";

export interface FeishuIpcDeps {
	getMainWindow(): BrowserWindow | null;

	feishuBridgeRef: { current: FeishuBridge | null };
	agentManager: AgentManager;
	projectStore: ProjectStore;
	sessionRuntimeCoordinator: SessionRuntimeCoordinator;
	feishuSessionRuntimeBindings: SessionRuntimeBindingGateway;

	getCurrentLocale(): FeishuLocale;
}

export function registerFeishuIpc(deps: FeishuIpcDeps): void {
	const { feishuBridgeRef } = deps;

	function broadcastBotsChanged() {
		const mainWindow = deps.getMainWindow();
		if (!mainWindow || mainWindow.isDestroyed()) return;
		mainWindow.webContents.send(ipcChannels.feishuBotsChanged, listBots());
	}

	function logger() {
		return getAppLogger();
	}

	ipcMain.handle(ipcChannels.feishuConnectTemp, async (_event, input: FeishuConnectInput) => {
		const appId = input.appId?.trim() ?? "";
		const appSecret = input.appSecret?.trim() ?? "";
		void logger()?.info("feishu", "temp connect requested", { appId: appId ? appId.slice(0, 8) : "", name: input.name, hasSecret: Boolean(appSecret) });
		try {
			if (!appId || !appSecret) {
				return { success: false, message: feishuT(deps.getCurrentLocale(), "bridge.configRequired") };
			}
			if (feishuBridgeRef.current) {
				feishuBridgeRef.current.stop();
			}

			const botConfig: FeishuBotConfig = {
				id: "temp-" + randomUUID(),
				name: input.name?.trim() || feishuT(deps.getCurrentLocale(), "bridge.tempBotName"),
				enabled: true,
				appId,
				appSecret,
				defaultUserOpenId: input.defaultUserOpenId,
			};
			feishuBridgeRef.current = new FeishuBridge(
				botConfig,
				deps.agentManager,
				() => deps.getMainWindow(),
				() => deps.projectStore.list(),
				deps.feishuSessionRuntimeBindings,
				appSecret,
				deps.getCurrentLocale(),
			);
			await feishuBridgeRef.current.start();
			const status = feishuBridgeRef.current.getStatus();
			void logger()?.info("feishu", "temp connect ok", { status });
			return {
				success: true,
				message: feishuT(deps.getCurrentLocale(), "connection.success"),
				botInfo: { id: botConfig.id, name: botConfig.name },
			};
		} catch (error) {
			const detail = error instanceof Error ? ((error as Error & { cause?: unknown }).cause ?? error.message) : String(error);
			const message = error instanceof Error ? error.message : String(error);
			void logger()?.error("feishu", "temp connect failed", { detail });
			return { success: false, message, detail: String(detail) };
		}
	});

	ipcMain.handle(ipcChannels.feishuConnect, async (_event, input: FeishuConnectInput) => {
		void logger()?.info("feishu", "connect requested", { appId: input.appId?.slice(0, 8), name: input.name });
		try {
			if (feishuBridgeRef.current) {
				void logger()?.info("feishu", "stopping previous bridge", { previousStatus: feishuBridgeRef.current.getStatus() });
				feishuBridgeRef.current.stop();
			}

			const plainAppSecret = input.appSecret;
			const tempId = "pending-" + randomUUID();

			feishuBridgeRef.current = new FeishuBridge(
				{
					id: tempId,
					name: input.name || feishuT(deps.getCurrentLocale(), "bridge.defaultBotName"),
					enabled: true,
					appId: input.appId,
					appSecret: "",
					defaultUserOpenId: input.defaultUserOpenId,
				},
				deps.agentManager,
				() => deps.getMainWindow(),
				() => deps.projectStore.list(),
				deps.feishuSessionRuntimeBindings,
				plainAppSecret,
				deps.getCurrentLocale(),
			);
			await feishuBridgeRef.current.start();

			const botConfig = addFeishuBot({
				name: input.name || feishuT(deps.getCurrentLocale(), "bridge.defaultBotName"),
				appId: input.appId,
				appSecret: input.appSecret,
				defaultUserOpenId: input.defaultUserOpenId,
			});
			feishuBridgeRef.current.updateBotConfig({ id: botConfig.id });

			void logger()?.info("feishu", "connect ok", { status: feishuBridgeRef.current.getStatus() });
			void logger()?.info("feishu", "Feishu connected", { botId: botConfig.id, name: botConfig.name });
			broadcastBotsChanged();
			return { success: true, message: feishuT(deps.getCurrentLocale(), "connection.success") };
		} catch (error) {
			const detail = error instanceof Error ? ((error as Error & { cause?: unknown }).cause ?? error.message) : String(error);
			const message = error instanceof Error ? error.message : String(error);
			void logger()?.error("feishu", "connect failed", { detail });
			void logger()?.error("feishu", "Feishu connect failed", error);

			return { success: false, message, detail: String(detail) };
		}
	});

	ipcMain.handle(ipcChannels.feishuDisconnect, async () => {
		if (feishuBridgeRef.current) {
			void logger()?.info("feishu", "disconnecting bridge", { previousStatus: feishuBridgeRef.current.getStatus() });
			feishuBridgeRef.current.stop();
			feishuBridgeRef.current = null;
		}
		void logger()?.info("feishu", "Feishu disconnected");
		return { success: true };
	});

	ipcMain.handle(ipcChannels.feishuStatusRequest, async () => {
		if (feishuBridgeRef.current) {
			const s = feishuBridgeRef.current.getStatus();
			void logger()?.info("feishu", "status query", { status: s });
			return s;
		}
		void logger()?.info("feishu", "status query: bridge null, returning disconnected");
		return { status: "disconnected", activeBindings: 0 } as FeishuBridgeStatus;
	});

	ipcMain.handle(ipcChannels.feishuBotsList, async () => {
		return listBots();
	});

	ipcMain.handle(ipcChannels.feishuBotAdd, async (_event, input: FeishuConnectInput) => {
		try {
			const botConfig = addFeishuBot({
				name: input.name || feishuT(deps.getCurrentLocale(), "bridge.defaultBotName"),
				appId: input.appId,
				appSecret: input.appSecret,
				defaultUserOpenId: input.defaultUserOpenId,
			});
			void logger()?.info("feishu", "Feishu bot added", { botId: botConfig.id, name: botConfig.name });
			broadcastBotsChanged();
			return { success: true, bot: { ...botConfig, appSecret: "" } };
		} catch (error) {
			void logger()?.warn("feishu", "Failed to add Feishu bot", {
				error: error instanceof Error ? error.message : String(error),
			});
			return { success: false, error: feishuT(deps.getCurrentLocale(), "bridge.botAddFailed") };
		}
	});

	ipcMain.handle(ipcChannels.feishuBotRemove, async (_event, botId: string) => {
		if (feishuBridgeRef.current) {
			feishuBridgeRef.current.stop();
			feishuBridgeRef.current = null;
		}
		const result = removeFeishuBot(botId);
		if (result) {
			broadcastBotsChanged();
		}
		void logger()?.info("feishu", "Feishu bot removed", { botId });
		return result;
	});

	ipcMain.handle(ipcChannels.feishuBotConfig, async (_event, botId: string, patch: Partial<FeishuBotConfig>) => {
		if (patch.backend !== undefined && patch.backend !== "pi") {
			void logger()?.warn("feishu", "Rejected feishu bot backend", { botId, backend: patch.backend });
			return undefined;
		}
		const updated = updateFeishuBot(botId, patch);
		void logger()?.info("feishu", "Feishu bot config updated", { botId, keys: Object.keys(patch) });

		if (feishuBridgeRef.current && feishuBridgeRef.current.getStatus().status === "connected" && feishuBridgeRef.current.getStatus().botId === botId) {
			const { appSecret: _stripped, ...hotPatch } = patch;
			feishuBridgeRef.current.updateBotConfig(hotPatch);
			void logger()?.info("feishu", "bot config hot-reloaded", { botId, keys: Object.keys(patch).join(", ") });
		}
		if (updated) {
			broadcastBotsChanged();
		}
		return updated ? { ...updated, appSecret: "" } : undefined;
	});

	ipcMain.handle(ipcChannels.feishuBotSecret, async (_event, botId: string) => {
		return getDecryptedBotAppSecret(botId);
	});

	ipcMain.handle(ipcChannels.feishuTestConnection, async (_event, appId: string, appSecret: string) => {
		const testBridge = new FeishuBridge(
			{
				id: "test",
				name: "测试",
				enabled: true,
				appId,
				appSecret: "",
			},
			deps.agentManager,
			() => deps.getMainWindow(),
			() => deps.projectStore.list(),
			deps.feishuSessionRuntimeBindings,
			undefined,
			deps.getCurrentLocale(),
		);
		return testBridge.testConnection(appId, appSecret);
	});

	ipcMain.handle(ipcChannels.feishuBindingsList, async () => {
		if (feishuBridgeRef.current) {
			return feishuBridgeRef.current.listBindings();
		}
		return [];
	});

	ipcMain.handle(ipcChannels.feishuBindingRemove, async (_event, chatId: string) => {
		if (feishuBridgeRef.current) {
			const bindings = feishuBridgeRef.current.listBindings();
			const binding = bindings.find((b) => b.chatId === chatId);
			const result = feishuBridgeRef.current.removeBinding(chatId);
			if (result && binding) {
				setSessionBotId(binding.sessionId, undefined);
			}
			return result;
		}
		return false;
	});

	ipcMain.handle(ipcChannels.feishuBindingUpdate, async (_event, chatId: string, patch: Partial<FeishuChatBinding>) => {
		if (feishuBridgeRef.current) {
			return feishuBridgeRef.current.updateBinding(chatId, patch);
		}
		return undefined;
	});

	ipcMain.handle(ipcChannels.feishuConnectByBot, async (_event, botId: string) => {
		try {
			if (feishuBridgeRef.current) {
				feishuBridgeRef.current.stop();
			}
			const botConfig = getBot(botId);
			if (!botConfig) {
				return { success: false, message: feishuT(deps.getCurrentLocale(), "bridge.botMissing") };
			}
			feishuBridgeRef.current = new FeishuBridge(
				botConfig,
				deps.agentManager,
				() => deps.getMainWindow(),
				() => deps.projectStore.list(),
				deps.feishuSessionRuntimeBindings,
				undefined,
				deps.getCurrentLocale(),
			);
			await feishuBridgeRef.current.start();
			void logger()?.info("feishu", "Feishu connected by saved bot", { botId, name: botConfig.name });
			return { success: true, message: feishuT(deps.getCurrentLocale(), "connection.success") };
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return { success: false, message };
		}
	});

	ipcMain.handle(ipcChannels.feishuSessionBotGet, async (_event, sessionId: string) => {
		const current = getSessionBotId(sessionId);
		if (current) return current;
		const target = deps.sessionRuntimeCoordinator.getTarget(sessionId);
		if (!target || target.agentId === sessionId) return null;
		const legacy = getSessionBotId(target.agentId);
		if (!legacy) return null;
		setSessionBotId(sessionId, legacy);
		setSessionBotId(target.agentId, undefined);
		return legacy;
	});

	ipcMain.handle(ipcChannels.feishuSessionBotSet, async (_event, sessionId: string, botId: string | null) => {
		let target = deps.sessionRuntimeCoordinator.getTarget(sessionId);
		if (!botId) {
			setSessionBotId(sessionId, undefined);
			if (target && target.agentId !== sessionId) setSessionBotId(target.agentId, undefined);

			if (feishuBridgeRef.current && feishuBridgeRef.current.getStatus().status === "connected") {
				feishuBridgeRef.current.removeBindingBySessionId(sessionId);
			}
			return { success: true };
		}
		const status = feishuBridgeRef.current?.getStatus();
		if (!feishuBridgeRef.current || status?.status !== "connected") {
			return { success: false, message: feishuT(deps.getCurrentLocale(), "session.bridgeUnavailable") };
		}
		if (status.botId !== botId) {
			return { success: false, message: feishuT(deps.getCurrentLocale(), "session.botMismatch") };
		}

		if (!target) {
			try {
				await deps.feishuSessionRuntimeBindings.activateRuntime(sessionId);
				target = deps.sessionRuntimeCoordinator.getTarget(sessionId);
			} catch (error) {
				void logger()?.warn("feishu", "auto-start runtime for Feishu bind failed", {
					sessionId,
					error: error instanceof Error ? error.message : String(error),
				});
			}
		}
		if (!target) {
			return { success: false, message: feishuT(deps.getCurrentLocale(), "session.runtimeUnavailable") };
		}

		const tab = deps.feishuSessionRuntimeBindings.findRuntimeAgent(target.agentId);
		if (!tab) {
			return { success: false, message: feishuT(deps.getCurrentLocale(), "session.runtimeUnavailable") };
		}
		const chatId = await feishuBridgeRef.current.ensureSessionMirrorForSession(sessionId, target.agentId, tab.title, tab.sessionPath);
		if (!chatId) {
			return { success: false, message: feishuT(deps.getCurrentLocale(), "session.bindFailed") };
		}
		setSessionBotId(sessionId, botId);
		if (target.agentId !== sessionId) setSessionBotId(target.agentId, undefined);
		return { success: true, chatId };
	});
}
