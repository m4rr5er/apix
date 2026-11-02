import type { TpsDisplayMode } from "./types/settings";

export function normalizeTpsDisplayMode(value: unknown): TpsDisplayMode {
	return value === "endToEnd" ? "endToEnd" : "streaming";
}

export function calculateTokensPerSecond(outputTokens: number | undefined, durationMs: number | undefined): number | undefined {
	if (outputTokens == null || !Number.isFinite(outputTokens) || outputTokens < 0 || durationMs == null || !Number.isFinite(durationMs) || durationMs <= 0) return undefined;
	const value = outputTokens / (durationMs / 1000);
	return Number.isFinite(value) ? value : undefined;
}

export function selectTokensPerSecond(mode: TpsDisplayMode, streaming: number | undefined, endToEnd: number | undefined): number | undefined {
	const value = mode === "endToEnd" ? endToEnd : streaming;
	return value != null && Number.isFinite(value) && value >= 0 ? value : undefined;
}

export type TimeInterval = [start: number, end: number];

export function calculateIntervalUnionDurationMs(intervals: ReadonlyArray<TimeInterval>): number {
	if (intervals.length === 0) return 0;
	const valid: Array<[number, number]> = [];
	for (const [start, end] of intervals) {
		if (typeof start === "number" && typeof end === "number" && Number.isFinite(start) && Number.isFinite(end) && end > start) {
			valid.push([start, end]);
		}
	}
	if (valid.length === 0) return 0;
	valid.sort((a, b) => a[0] - b[0] || a[1] - b[1]);

	let totalDuration = 0;
	let currentStart = valid[0][0];
	let currentEnd = valid[0][1];

	for (let i = 1; i < valid.length; i++) {
		const [nextStart, nextEnd] = valid[i];
		if (nextStart <= currentEnd) {
			if (nextEnd > currentEnd) {
				currentEnd = nextEnd;
			}
		} else {
			totalDuration += currentEnd - currentStart;
			currentStart = nextStart;
			currentEnd = nextEnd;
		}
	}
	totalDuration += currentEnd - currentStart;
	return totalDuration;
}

export interface TaskPerfSpan {
	id?: string;

	startedAt: number;

	firstDeltaAt?: number;

	completedAt: number;

	outputTokens: number;
}

export interface SessionPerfStats {
	sessionTps?: number;

	sessionEndToEndTps?: number;

	totalOutputTokens: number;

	activeDurationMs: number;

	activeStreamingDurationMs: number;
}

export function calculateSessionTokensPerSecond(spans: ReadonlyArray<TaskPerfSpan>): SessionPerfStats {
	if (!spans || spans.length === 0) {
		return {
			totalOutputTokens: 0,
			activeDurationMs: 0,
			activeStreamingDurationMs: 0,
		};
	}

	const validSpans = spans.filter((s) => typeof s.outputTokens === "number" && Number.isFinite(s.outputTokens) && s.outputTokens >= 0 && typeof s.startedAt === "number" && typeof s.completedAt === "number" && s.completedAt > s.startedAt);

	if (validSpans.length === 0) {
		return {
			totalOutputTokens: 0,
			activeDurationMs: 0,
			activeStreamingDurationMs: 0,
		};
	}

	let totalOutputTokens = 0;
	const e2eIntervals: TimeInterval[] = [];
	for (const span of validSpans) {
		totalOutputTokens += span.outputTokens;
		e2eIntervals.push([span.startedAt, span.completedAt]);
	}
	const activeDurationMs = calculateIntervalUnionDurationMs(e2eIntervals);
	const sessionEndToEndTps = calculateTokensPerSecond(totalOutputTokens, activeDurationMs);

	const streamingSpans = validSpans.filter((s) => typeof s.firstDeltaAt === "number" && Number.isFinite(s.firstDeltaAt) && s.firstDeltaAt > 0 && s.completedAt > s.firstDeltaAt);

	let streamingOutputTokens = 0;
	const streamingIntervals: TimeInterval[] = [];
	for (const span of streamingSpans) {
		streamingOutputTokens += span.outputTokens;
		streamingIntervals.push([span.firstDeltaAt!, span.completedAt]);
	}
	const activeStreamingDurationMs = calculateIntervalUnionDurationMs(streamingIntervals);
	const sessionTps = calculateTokensPerSecond(streamingOutputTokens, activeStreamingDurationMs);

	return {
		sessionTps,
		sessionEndToEndTps,
		totalOutputTokens,
		activeDurationMs,
		activeStreamingDurationMs,
	};
}
