import type { IpcMain } from "electron";
import { ipcChannels } from "../../shared/ipc";
import type { AiAaaUsageResult } from "../../shared/types/aiAaaUsage";
import type { AiAaaUsageService } from "../usage/AiAaaUsageService";

export function registerAiAaaUsageIpc(ipc: IpcMain, service: AiAaaUsageService): void {
	ipc.handle(ipcChannels.aiAaaUsageGet, async (_event, input: unknown): Promise<AiAaaUsageResult> => {
		const force = input !== null && typeof input === "object" && (input as { force?: unknown }).force === true;
		return service.get(force);
	});
}
