import type { AgentBackend, ResolvedLaunchDefaults, SessionModelPreference } from "../../../shared/types";

/**
 * 切换会话后端时的默认模型/思考档位决策（纯函数，可单测）。
 *
 * 规则：
 * - 切到 pi：按 pi 配置解析出的启动默认（defaultProvider/defaultModel/
 *   defaultThinkingLevel）写入 record——与 createDraft 缺省填充共用同一解析器
 *   （launchDefaults），保证「预选的默认」与「真正套用的默认」同源。
 *   解析结果为空时用 null 清空（对应 updateRecord 的「清空」语义）。
 *   agent-default-model / 独立生图配置）决定，record 不落模型字段，返回 null 清空。
 *
 */
export function resolveBackendSwitchDefaults(
	next: AgentBackend,
	resolved?: ResolvedLaunchDefaults,
): {
	model: SessionModelPreference | null;
	thinkingLevel: string | null;
} {
	if (next !== "pi") return { model: null, thinkingLevel: null };
	return {
		model: resolved?.model ?? null,
		thinkingLevel: resolved?.thinkingLevel ?? null,
	};
}
