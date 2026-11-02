import { ipcMain } from "electron";
import { ipcChannels } from "../../shared/ipc";
import type { QoderProviderSetupInput, QoderProviderSetupResult, QoderProviderStatus } from "../../shared/types/qoderProvider";

export function registerQoderProviderIpc(deps: { setup: (input: QoderProviderSetupInput) => Promise<QoderProviderSetupResult>; status: () => Promise<QoderProviderStatus> }): void {
	ipcMain.handle(ipcChannels.configQoderProviderSetup, async (_event, input: unknown): Promise<QoderProviderSetupResult> => {
		if (!input || typeof input !== "object") throw new Error("config:qoder-provider-setup expects an object");
		const record = input as Record<string, unknown>;
		if (record.region !== "global" && record.region !== "cn") throw new Error("Invalid Qoder region");
		if (typeof record.pat !== "string" || !record.pat.trim() || record.pat.length > 4096) throw new Error("Invalid Qoder PAT");
		return deps.setup({ region: record.region, pat: record.pat });
	});
	ipcMain.handle(ipcChannels.configQoderProviderStatus, async (): Promise<QoderProviderStatus> => deps.status());
}
