import type { IpcMain } from "electron";
import { ipcChannels } from "../../shared/ipc";
import type { QoderUsageResult } from "../../shared/types/qoderUsage";
import type { QoderUsageService } from "../usage/QoderUsageService";

export function registerQoderUsageIpc(ipc: IpcMain, service: QoderUsageService): void {
	ipc.handle(ipcChannels.qoderUsageGet, async (_event, input: unknown): Promise<QoderUsageResult> => {
		const force = input !== null && typeof input === "object" && (input as { force?: unknown }).force === true;
		return service.get(force);
	});
}
