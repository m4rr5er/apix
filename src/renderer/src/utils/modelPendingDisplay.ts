import { resolveModelDisplayName } from "../../../shared/modelDisplayName";

/**
 * 后端拒绝运行中模型切换时的 fallback 展示推导。
 *
 * 支持 live selection 的后端直接更新 runtime，不会设置 pending；只有 busy/error
 * 路径才会把选择保留到后续空闲时重试。
 */

export type ModelPendingRef = {
	provider: string;
	modelId: string;
	modelName?: string;
};

export type ModelPending = {
	from: ModelPendingRef;
	to: ModelPendingRef;
};

export function formatModelRef(ref: Pick<ModelPendingRef, "provider" | "modelId" | "modelName">): string {
	const name = ref.modelName || ref.modelId || "-";
	return ref.provider ? `${ref.provider}/${name}` : name;
}

export type ModelDisplayResult = {
	from?: ModelPendingRef;
	to?: ModelPendingRef;
	pending: boolean;
};

export function computeModelDisplay(current: ModelPendingRef | undefined, pending: ModelPending | undefined): ModelDisplayResult {
	if (pending) {
		return { from: pending.from, to: pending.to, pending: true };
	}
	return { from: current, pending: false };
}

export type ComposerLiveModelSource = {
	provider?: string;
	modelId?: string;
	modelName?: string;
};

/**
 * 底栏/选择器当前模型：会话保存的用户选择优先。
 *
 * 已有会话取 `SessionRecord.model`，尚未创建会话的引导页取 `fallback`。pi 的运行时
 * 状态是执行态（get_state），不能参与名称或当前选择的决策；这样 Agent 启动前后都展示
 * 同一份本地名称快照。
 *
 * 在 record 缺 model 时传 runtime 兜底；pi 调用方不得传。
 */
export function resolveComposerLiveModel(input: { record?: { provider?: string; modelId?: string; modelName?: string }; runtime?: ComposerLiveModelSource; fallback?: ComposerLiveModelSource }): ModelPendingRef {
	const record = input.record?.provider && input.record.modelId ? input.record : undefined;
	const runtime = input.runtime?.provider && input.runtime.modelId ? input.runtime : undefined;
	const source = record ?? runtime ?? input.fallback;
	return {
		provider: source?.provider ?? "",
		modelId: source?.modelId ?? "",
		modelName: resolveModelDisplayName(source?.modelName, source?.modelId ?? ""),
	};
}

export function resolveGuideDisplayModel(input: { welcomeModel?: { provider: string; modelId: string; modelName?: string }; defaultModel?: ComposerLiveModelSource }): ComposerLiveModelSource | undefined {
	return input.welcomeModel ?? input.defaultModel;
}
