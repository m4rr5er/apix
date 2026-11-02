import type { SessionCommandResult, SessionRuntimeTarget, SessionTargetedValue } from "../../shared/types";

/** 重发/编辑 fork 化重试标记：mutationFork=尾部替换（隐藏旧会话）；branchMode=分支保留。 */
export type ForkRuntimeSessionOptions = { mutationFork?: boolean; branchMode?: boolean };

/** fork/clone 命令结果载荷（与 preload sessionsRuntimeFork 的类型声明同形）。 */
export type SessionForkValue = {
	cancelled?: boolean;
	text?: string;
	targetSessionId?: string;
	[key: string]: unknown;
};

/** fork/clone 命令结果（与 preload sessionsRuntimeFork 的类型声明同形）。 */
export type SessionForkResult = SessionCommandResult<SessionForkValue>;

/** replaceAgentSession 返回 unknown，这里按最小结构收窄（非对象→空载荷），
 * 避免 as 直转；与主进程其它 SessionCommandResult 包装同风格。 */
function toForkValue(value: unknown): SessionForkValue {
	return value && typeof value === "object" && !Array.isArray(value) ? (value as SessionForkValue) : {};
}

export interface SessionForkCommandDeps {
	/** 校验 runtime target 并取 lease 保护（与桌面 sessionIpc 同款入口）。 */
	sessionRuntimeCoordinator: {
		validateTarget(target: SessionRuntimeTarget): SessionCommandResult<SessionTargetedValue<unknown>> | { ok: true; value: unknown };
	};
	agentManager: {
		forkSession(agentId: string, entryId: string): Promise<unknown>;
		cloneSession(agentId: string): Promise<unknown>;
	};
	/** pi fork/clone 专用：RPC 成功后刷新 sessionPath/消息投影并换绑 catalog。 */
	replaceAgentSession: (agentId: string, replace: () => Promise<unknown>, options?: { markForked?: boolean; markSuperseded?: boolean }) => Promise<unknown>;
	logger: { info(channel: string, message: string, data?: Record<string, unknown>): unknown };
	/** fork/clone 成功后的 catalog 刷新广播（桌面主窗口；Web 走 SSE 快照 diff）。 */
	notifyForkCatalogRefreshed: (sessionId: string) => void;
}

export type SessionForkCommands = {
	forkRuntimeSession: (target: SessionRuntimeTarget, entryId: string, options?: ForkRuntimeSessionOptions) => Promise<SessionForkResult>;
	cloneRuntimeSession: (target: SessionRuntimeTarget) => Promise<SessionForkResult>;
};

function forkCommandError(error: unknown): { ok: false; error: { code: "SESSION_COMMAND_FAILED"; debugDetails: string } } {
	return {
		ok: false as const,
		error: {
			code: "SESSION_COMMAND_FAILED" as const,
			debugDetails: error instanceof Error ? error.message : String(error),
		},
	};
}

export function createSessionForkCommands(deps: SessionForkCommandDeps): SessionForkCommands {
	const forkRuntimeSession = async (target: SessionRuntimeTarget, entryId: string, options?: ForkRuntimeSessionOptions): Promise<SessionForkResult> => {
		const validated = deps.sessionRuntimeCoordinator.validateTarget(target);
		if (!validated.ok) return validated;
		// fork 化重试标记（重发/编辑迁移用）：只认显式 true，其余值按 false 处理（边界校验）。
		// branchMode：fork 锚点不是最后一条用户消息 → 旧会话保留可见（带 (fork) 后缀），
		// 只有尾部替换才隐藏旧会话（supersededBy）。
		const mutationFork = options?.mutationFork === true;
		const branchMode = options?.branchMode === true;
		try {
			const value = toForkValue(await deps.replaceAgentSession(target.agentId, () => deps.agentManager.forkSession(target.agentId, entryId), mutationFork && !branchMode ? { markForked: false, markSuperseded: true } : { markForked: true }));
			void deps.logger.info("session", "Session forked", { sessionId: target.sessionId, entryId, mutationFork, branchMode });
			deps.notifyForkCatalogRefreshed(target.sessionId);
			return {
				ok: true as const,
				value,
			};
		} catch (error) {
			return forkCommandError(error);
		}
	};

	const cloneRuntimeSession = async (target: SessionRuntimeTarget): Promise<SessionForkResult> => {
		const validated = deps.sessionRuntimeCoordinator.validateTarget(target);
		if (!validated.ok) return validated;
		try {
			const value = toForkValue(await deps.replaceAgentSession(target.agentId, () => deps.agentManager.cloneSession(target.agentId), { markForked: true }));
			void deps.logger.info("session", "Session cloned", { sessionId: target.sessionId });
			deps.notifyForkCatalogRefreshed(target.sessionId);
			return {
				ok: true as const,
				value,
			};
		} catch (error) {
			return forkCommandError(error);
		}
	};

	return { forkRuntimeSession, cloneRuntimeSession };
}
