import { clearTimeout as clearNodeTimeout, setTimeout as nodeSetTimeout } from "node:timers";
import type { ChatMessage, SessionRuntimeEvent } from "../../shared/types";

export type SessionRunOutcome = { kind: "ended"; failed: boolean; errorMessage?: string } | { kind: "timeout" };

export interface SessionRunWaitInput {
	sessionId: string;
	sinceIndex: number;
	timeoutMs: number;
}

export interface SessionRunWaiterDeps {
	/** 订阅会话运行时事件；返回退订函数（必须幂等调用）。 */
	subscribe(listener: (event: SessionRuntimeEvent) => void): () => void;
	/** 会话当前 runtime 的消息（无 runtime 返回空数组）。 */
	getMessages(sessionId: string): ChatMessage[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * 等一个回合收口。调用方必须在提交 prompt **之前**登记等待器，否则起跑瞬间的
 * 终态事件会落在注册之前（原先的 endedAgents/lateRuns 兜底就是为这个竞态打的补丁；
 * 先注册后提交就不需要它们）。
 */
export function waitForSessionRunEnd(deps: SessionRunWaiterDeps, input: SessionRunWaitInput): Promise<SessionRunOutcome> {
	return new Promise<SessionRunOutcome>((resolve) => {
		let settled = false;
		let turnStarted = false;
		let unsubscribe: (() => void) | undefined;
		let timer: NodeJS.Timeout | undefined;

		const finish = (outcome: SessionRunOutcome): void => {
			if (settled) return;
			settled = true;
			if (timer) clearNodeTimeout(timer);
			timer = undefined;
			unsubscribe?.();
			unsubscribe = undefined;
			resolve(outcome);
		};

		const finishFromMessages = (statusErrorMessage?: string, statusFailed = false): void => {
			const finishFailed = (text?: string): void => {
				finish(text ? { kind: "ended", failed: true, errorMessage: text } : { kind: "ended", failed: true });
			};
			let messages: ChatMessage[] = [];
			try {
				messages = deps.getMessages(input.sessionId);
			} catch {
				// 读消息失败不该让等待器悬挂：按状态收口（交付阶段会再读一次）。
				if (statusFailed) finishFailed(statusErrorMessage);
				else finish({ kind: "ended", failed: false });
				return;
			}
			for (let index = messages.length - 1; index >= input.sinceIndex && index >= 0; index -= 1) {
				const message = messages[index];
				if (!message) continue;
				if (message.role === "error") {
					const text = typeof message.text === "string" ? message.text.trim() : "";
					finishFailed(text || statusErrorMessage);
					return;
				}
				if (message.role === "assistant") break;
			}
			if (statusFailed) finishFailed(statusErrorMessage);
			else finish({ kind: "ended", failed: false });
		};

		const handleEvent = (event: SessionRuntimeEvent): void => {
			if (settled || event.sessionId !== input.sessionId) return;
			const payload = isRecord(event.payload) ? event.payload : undefined;
			if (!payload) return;
			const channel = typeof event.sourceChannel === "string" ? event.sourceChannel : "";
			// agents:runtime-state：只认显式 isTurnActive === true 作为「回合开始过」的证据。
			if (channel.includes("runtime-state")) {
				const state = isRecord(payload.state) ? payload.state : undefined;
				if (state?.isTurnActive === true) turnStarted = true;
				return;
			}
			// agents:state 快照（全量 tab）：终态判定唯一依据。
			if (!channel.includes("state")) return;
			const status = payload.status;
			if (status === "running") {
				turnStarted = true;
				return;
			}
			if (status === "error") {
				const errorMessage = typeof payload.error === "string" && payload.error.trim() ? payload.error : undefined;
				finishFromMessages(errorMessage, true);
				return;
			}
			if (status === "closed") {
				finish({ kind: "ended", failed: true, errorMessage: "Runtime process exited before the run finished" });
				return;
			}
			// 必须确认回合真的开始过：否则提交前残留的空闲快照会把这一轮直接判成完成。
			if (status === "idle" && turnStarted) finishFromMessages();
		};

		unsubscribe = deps.subscribe(handleEvent);
		timer = nodeSetTimeout(() => finish({ kind: "timeout" }), input.timeoutMs);
		// 主进程常驻、测试进程短命：不 unref 的话一个挂着等超时的等待器会拖住 node --test 退出。
		timer.unref?.();
	});
}
