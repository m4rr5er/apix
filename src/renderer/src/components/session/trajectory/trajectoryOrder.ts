import type { ChatMessage } from "../../../../../shared/types";
import type { TrajectoryRecord, TrajectoryRecordKind, TrajectoryTurn } from "./buildTrajectory";

/**
 * 若误把秒当毫秒（~1e9），重试/过程事件会排到整段会话之前。
 */
export function wallTime(value: number | undefined): number {
	if (value === undefined || !Number.isFinite(value) || value <= 0) return 0;
	if (value > 1e9 && value < 1e11) return Math.round(value * 1000);
	return value;
}

function asNumber(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function seqOfMessage(message: ChatMessage): number | undefined {
	const fromMeta = asNumber(message.meta?.seq);
	if (fromMeta !== undefined) return fromMeta;
	return undefined;
}

function kindTie(kind: TrajectoryRecordKind): number {
	if (kind === "systemPrompt") return 0;
	if (kind === "user") return 1;
	if (kind === "thinking") return 2;
	if (kind === "assistant") return 3;
	if (kind === "tool") return 4;
	if (kind === "process") return 5;
	if (kind === "error") return 6;
	return 7;
}

export function compareTrajectoryRecords(left: TrajectoryRecord, right: TrajectoryRecord): number {
	const leftInitial = left.kind === "systemPrompt" && left.promptKind === "initial";
	const rightInitial = right.kind === "systemPrompt" && right.promptKind === "initial";
	if (leftInitial && !rightInitial) return -1;
	if (rightInitial && !leftInitial) return 1;
	const leftSeq = left.seq;
	const rightSeq = right.seq;
	if (leftSeq !== undefined && rightSeq !== undefined && leftSeq !== rightSeq) {
		return leftSeq - rightSeq;
	}
	const leftTime = left.startedAt > 0 ? left.startedAt : Number.POSITIVE_INFINITY;
	const rightTime = right.startedAt > 0 ? right.startedAt : Number.POSITIVE_INFINITY;
	if (leftTime !== rightTime) return leftTime - rightTime;
	return kindTie(left.kind) - kindTie(right.kind);
}

export function sortTurnRecords(turn: TrajectoryTurn): void {
	turn.records.sort(compareTrajectoryRecords);
}
