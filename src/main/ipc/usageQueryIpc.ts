import type { IpcMain } from "electron";
import { ipcChannels } from "../../shared/ipc";
import type { UsageQueryProviderStatus } from "../../shared/types/usageQuery";
import { resolveUsageQueryProviderStatus } from "../usage/usageQueryStatus";
import type { PiAuthFile, PiModelsFile } from "../config/ConfigManager";

/** 设置页「用量查询」的只读状态探测；不触发任何供应商请求。 */
export function registerUsageQueryIpc(ipc: IpcMain, deps: { getModelsConfig: () => Promise<{ parsed: PiModelsFile | undefined }>; getAuthConfig: () => Promise<{ parsed: PiAuthFile | undefined }> }): void {
	ipc.handle(ipcChannels.usageQueryStatus, (): Promise<UsageQueryProviderStatus> => resolveUsageQueryProviderStatus(deps));
}
