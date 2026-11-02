import { ipcMain, type BrowserWindow } from "electron";
import { ipcChannels } from "../../shared/ipc";
import type { ImChannelBackend, WeChatModelChainEntry, WeChatSettingsSnapshot } from "../../shared/types";
import { getAppLogger } from "../logging/sharedLogger";
import { MODEL_CHAIN_MAX, normalizeModelChain } from "../wechat/WeChatConfig";
import type { WeChatService } from "../wechat/WeChatService";

export type WeChatIpcDeps = {
	getMainWindow(): BrowserWindow | null;
	wechatService: WeChatService;

	getProjects(): Array<{ id: string; name: string }>;
};

const MAX_TEXT_LENGTH = 200;

const MAX_VERIFY_CODE_LENGTH = 16;

function logger() {
	return getAppLogger();
}

function readText(value: unknown, maxLength = MAX_TEXT_LENGTH): string | null {
	if (typeof value !== "string") return null;
	const trimmed = value.trim();
	if (!trimmed || trimmed.length > maxLength) return null;
	return trimmed;
}

async function guard<T>(action: string, run: () => Promise<T> | T): Promise<T | { ok: false; message: string }> {
	try {
		return await run();
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		logger()?.warn("wechat", `wechat ipc failed: ${action}`, { message });
		return { ok: false, message };
	}
}

export function registerWeChatIpc(deps: WeChatIpcDeps): void {
	const { wechatService } = deps;

	ipcMain.handle(ipcChannels.wechatGetSettings, () =>
		guard<{ ok: true } & WeChatSettingsSnapshot>("get-settings", async () => ({
			ok: true,
			settings: wechatService.getSettings(),
			status: wechatService.getStatus(),
			bindings: await wechatService.bindingsWithModel(),
			projects: deps.getProjects(),
		})),
	);

	ipcMain.handle(ipcChannels.wechatGetStatus, () => guard("get-status", () => wechatService.getStatus()));

	ipcMain.handle(ipcChannels.wechatGetBindings, () => guard("get-bindings", () => wechatService.bindingsWithModel()));

	ipcMain.handle(ipcChannels.wechatGetLoginState, () => guard("get-login-state", () => wechatService.getLoginState()));

	ipcMain.handle(ipcChannels.wechatSetEnabled, (_event, enabled: unknown) => {
		if (typeof enabled !== "boolean") return { ok: false, message: "enabled must be a boolean" };
		return guard("set-enabled", async () => {
			const settings = await wechatService.setEnabled(enabled);
			return { ok: true, settings };
		});
	});

	ipcMain.handle(ipcChannels.wechatUpdateSettings, (_event, patch: unknown) => {
		if (typeof patch !== "object" || patch === null) return { ok: false, message: "patch must be an object" };
		const source = patch as Record<string, unknown>;
		const next: { defaultWorkspaceId?: string; defaultModelId?: string; backend?: ImChannelBackend; modelChain?: WeChatModelChainEntry[] } = {};

		for (const key of ["defaultWorkspaceId", "defaultModelId"] as const) {
			const value = source[key];
			if (value === undefined) continue;
			if (typeof value !== "string" || value.length > MAX_TEXT_LENGTH) return { ok: false, message: `${key} is invalid` };
			next[key] = value.trim();
		}
		const backend = source.backend;
		if (backend !== undefined) {
			if (backend !== "pi") return { ok: false, message: "backend is invalid" };
			next.backend = backend;
		}
		const chain = source.modelChain;
		if (chain !== undefined) {
			if (!Array.isArray(chain) || chain.length > MODEL_CHAIN_MAX) return { ok: false, message: "modelChain is invalid" };
			for (const item of chain) {
				if (typeof item !== "object" || item === null) return { ok: false, message: "modelChain entry must be an object" };
				const entry = item as Record<string, unknown>;
				for (const key of ["provider", "modelId", "modelName"] as const) {
					const value = entry[key];
					if (value === undefined || value === null) continue;
					if (typeof value !== "string" || value.length > MAX_TEXT_LENGTH) return { ok: false, message: `modelChain.${key} is invalid` };
				}
				if (typeof entry.provider !== "string" || !entry.provider.trim() || typeof entry.modelId !== "string" || !entry.modelId.trim()) {
					return { ok: false, message: "modelChain entry needs provider and modelId" };
				}
			}
			next.modelChain = normalizeModelChain(chain);
		}
		return guard("update-settings", () => ({ ok: true, settings: wechatService.updateSettings(next) }));
	});

	ipcMain.handle(ipcChannels.wechatRenameAccount, (_event, displayName: unknown) => {
		const name = readText(displayName);
		if (name === null) return { ok: false, message: "displayName is invalid" };
		return guard("rename-account", () => ({ ok: true, settings: wechatService.renameAccount(name) }));
	});

	ipcMain.handle(ipcChannels.wechatLogout, () => guard("logout", async () => ({ ok: true, settings: await wechatService.logout() })));

	ipcMain.handle(ipcChannels.wechatBeginLogin, () => guard("begin-login", async () => ({ ok: true, state: await wechatService.beginLogin() })));

	ipcMain.handle(ipcChannels.wechatCancelLogin, () =>
		guard("cancel-login", () => {
			wechatService.cancelLogin();
			return { ok: true, state: wechatService.getLoginState() };
		}),
	);

	ipcMain.handle(ipcChannels.wechatSubmitVerifyCode, (_event, code: unknown) => {
		const text = readText(code, MAX_VERIFY_CODE_LENGTH);
		if (text === null) return { ok: false, message: "verify code is invalid" };
		return guard("submit-verify-code", () => ({ ok: true, state: wechatService.submitVerifyCode(text) }));
	});

	ipcMain.handle(ipcChannels.wechatUnbindChat, (_event, chatId: unknown) => {
		const id = readText(chatId);
		if (id === null) return { ok: false, message: "chatId is invalid" };
		return guard("unbind-chat", async () => ({ ok: true, removed: wechatService.unbindChat(id), bindings: await wechatService.bindingsWithModel() }));
	});
}
