import { ipcChannels } from "../../shared/ipc";
import type { RpcLogBatch, RpcLogEntry } from "../../shared/types/rpcLog";

/** 直发渲染层通道的宿主回调：装配层保证窗口存活检查，销毁后静默丢弃。 */
export type RpcLogLiveSend = (channel: string, payload: unknown) => void;

export type RpcLogLiveBroadcasterDeps = {
	/**
	 * 窗口直发（agentsRpcLog 在 pi AgentManager 的 DIRECT_EMIT_CHANNELS 白名单内：
	 * preload 直订 webContents，不走 sessions:runtime-envelope 桥）。
	 */
	send: RpcLogLiveSend;
	/** 节流间隔；缺省 80ms（与 pi AgentManager.LIVE_RPC_LOG_FLUSH_MS 一致）。测试可注入小值。 */
	flushMs?: number;
};

export interface RpcLogLiveSink {
	setWatching(agentId: string, watching: boolean): void;
	enqueue(entry: RpcLogEntry): void;
	dropPending(agentId: string): void;
	clear(): void;
}

export class RpcLogLiveBroadcaster implements RpcLogLiveSink {
	private static readonly DEFAULT_FLUSH_MS = 80;
	private static readonly MAX_BATCH = 100;
	private static readonly MAX_PENDING = 1000;

	private readonly flushMs: number;
	private readonly watchingAgents = new Set<string>();
	private readonly pendingByAgent = new Map<string, RpcLogEntry[]>();
	private flushTimer: NodeJS.Timeout | null = null;

	constructor(private readonly deps: RpcLogLiveBroadcasterDeps) {
		this.flushMs = deps.flushMs ?? RpcLogLiveBroadcaster.DEFAULT_FLUSH_MS;
	}

	/**
	 * 登记「某 agent 的实时日志面板是否在看」。
	 * 由渲染层面板挂载/卸载成对调用（rpcLogsSetWatching）；只影响广播，不影响记录与落盘。
	 */
	setWatching(agentId: string, watching: boolean): void {
		if (watching) this.watchingAgents.add(agentId);
		else this.watchingAgents.delete(agentId);
	}

	/**
	 * 聚合待广播的实时日志条目（入口喂 RpcLogger.push 返回的截断副本，与 getLive 形态一致）。
	 * 无观看者直接丢弃；聚合缓冲按 agent 有界（超限丢最旧）。
	 */
	enqueue(entry: RpcLogEntry): void {
		if (!this.watchingAgents.has(entry.agentId)) return;
		let pending = this.pendingByAgent.get(entry.agentId);
		if (!pending) {
			pending = [];
			this.pendingByAgent.set(entry.agentId, pending);
		}
		if (pending.length >= RpcLogLiveBroadcaster.MAX_PENDING) {
			// 极端高频下丢弃最旧，保证聚合缓冲有界
			pending.splice(0, pending.length - RpcLogLiveBroadcaster.MAX_PENDING + 1);
		}
		pending.push(entry);
		if (this.flushTimer === null) {
			this.flushTimer = setTimeout(() => {
				this.flushTimer = null;
				this.flush();
			}, this.flushMs);
		}
	}

	/** 把聚合缓冲按 agent 拆分后批量广播；单次批次超限的条目留到下一轮，不丢日志。 */
	private flush(): void {
		if (this.pendingByAgent.size === 0) return;
		for (const [agentId, entries] of [...this.pendingByAgent]) {
			const batch = entries.slice(0, RpcLogLiveBroadcaster.MAX_BATCH);
			if (batch.length > 0) {
				this.deps.send(ipcChannels.agentsRpcLog, { agentId, entries: batch } satisfies RpcLogBatch);
			}
			const rest = entries.slice(RpcLogLiveBroadcaster.MAX_BATCH);
			if (rest.length > 0) {
				this.pendingByAgent.set(agentId, rest);
			} else {
				this.pendingByAgent.delete(agentId);
			}
		}
	}

	dropPending(agentId: string): void {
		this.pendingByAgent.delete(agentId);
	}

	/** 全量清理（stopAll/退出）：清观看登记、聚合缓冲与在途定时器。 */
	clear(): void {
		this.watchingAgents.clear();
		this.pendingByAgent.clear();
		if (this.flushTimer !== null) {
			clearTimeout(this.flushTimer);
			this.flushTimer = null;
		}
	}
}
