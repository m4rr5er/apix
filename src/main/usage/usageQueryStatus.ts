import type { PiAuthFile, PiModelsFile } from "../config/ConfigManager";
import { selectAiAaaProvider } from "./aiAaaUsageParser";
import { selectQoderUsageEndpoint } from "./qoderUsageParser";
import type { UsageQueryProviderStatus } from "../../shared/types/usageQuery";

/**
 * 只读探测两个内置用量查询供应商是否已配置，不发网络请求。
 *
 * 配置判定复用查询链路自己的选择器，避免「设置页说已配置、实际查询却 not-configured」
 * 的两套规则漂移：aibvv 要求 models.json 有 provider + API key，Qoder 要求 auth.json
 * 有可用的 OAuth/PAT 凭据。
 */
export async function resolveUsageQueryProviderStatus(deps: { getModelsConfig: () => Promise<{ parsed: PiModelsFile | undefined }>; getAuthConfig: () => Promise<{ parsed: PiAuthFile | undefined }> }): Promise<UsageQueryProviderStatus> {
	try {
		const [models, auth] = await Promise.all([deps.getModelsConfig(), deps.getAuthConfig()]);
		return {
			aibvv: Boolean(selectAiAaaProvider(models.parsed, auth.parsed)),
			qoder: Boolean(selectQoderUsageEndpoint(auth.parsed)),
		};
	} catch {
		return { aibvv: false, qoder: false };
	}
}
