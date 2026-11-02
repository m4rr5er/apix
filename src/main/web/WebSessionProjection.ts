import type { SessionModelPreference, SessionRecord } from "../../shared/types/session";
import type { AgentBackend } from "../../shared/types/agent";

/** Web 端可见的会话形状：字段集与渲染层 `webTypes.ts` 的 `WebSession` 对齐。 */
export type WebPublicSession = {
	id: string;
	projectId: string;
	title: string;
	status: string;
	projectPath?: string;
	model?: SessionModelPreference;
	thinkingLevel?: string;
	backend?: AgentBackend;
	/** 最近活动时间（毫秒时间戳），会话列表按此降序 */
	updatedAt?: number;
	/** 分支导航：fork 自哪条会话 / 是否为 fork 产物 / 创建时间 */
	parentSessionId?: string;
	forked?: boolean;
	createdAt?: number;
};

/**
 * 会话记录 → Web 可见投影。
 *
 * 只挑字段、不做任何语义加工：服务端保持单一数据源，渲染层拿到的值与桌面端一致。
 */
export function toPublicSession(record: SessionRecord): WebPublicSession {
	return {
		id: record.id,
		projectId: record.projectId,
		title: record.title,
		status: record.status,
		projectPath: record.projectPath,
		model: record.model,
		thinkingLevel: record.thinkingLevel,
		backend: record.backend,
		updatedAt: record.updatedAt,
		parentSessionId: record.parentSessionId,
		forked: record.forked,
		createdAt: record.createdAt,
	};
}

export function toPublicSessions(records: readonly SessionRecord[]): WebPublicSession[] {
	return records.map(toPublicSession);
}
