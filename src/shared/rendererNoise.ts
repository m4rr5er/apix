import type { AppLogLevel } from "./types/app";

export type RendererNoiseKind = "resize-observer-loop";

export type RendererNoiseVerdict = {
	benign: boolean;
	kind: RendererNoiseKind | null;
};

export type RendererNoiseKindMeta = {
	kind: RendererNoiseKind;

	message: string;

	level: AppLogLevel;

	windowMs: number;
};

export const RENDERER_NOISE_KINDS: Record<RendererNoiseKind, RendererNoiseKindMeta> = {
	"resize-observer-loop": {
		kind: "resize-observer-loop",
		message: "Renderer benign ResizeObserver loop notifications",
		level: "info",
		windowMs: 30_000,
	},
};

export const RENDERER_NOISE_WINDOW_MS = 30_000;

export const RENDERER_NOISE_WINDOW_GROWTH = 2;

export const RENDERER_NOISE_WINDOW_MAX_MS = 3_600_000;

export function classifyRendererNoise(message: unknown): RendererNoiseVerdict {
	if (typeof message === "string" && message.includes("ResizeObserver loop")) {
		return { benign: true, kind: "resize-observer-loop" };
	}
	return { benign: false, kind: null };
}

export function toRendererNoiseSummaryLevel(level: AppLogLevel): AppLogLevel {
	if (level === "error") return "warn";
	if (level === "warn") return "info";
	return level;
}

export type RendererNoiseFlush = {
	key: string;

	count: number;

	level: AppLogLevel;
	message: string;
	windowMs: number;

	summary: boolean;

	detail?: unknown;
};

export type RendererNoiseRecordOptions = {
	windowMs?: number;

	deferFirst?: boolean;

	detail?: unknown;
};

type NoiseWindow = {
	windowStart: number;
	total: number;
	suppressed: number;
	level: AppLogLevel;
	message: string;
	windowMs: number;
	deferFirst: boolean;
	detail?: unknown;
};

export class RendererNoiseAggregator {
	private readonly windows = new Map<string, NoiseWindow>();

	constructor(private readonly now: () => number = Date.now) {}

	record(key: string, level: AppLogLevel, message: string, options: RendererNoiseRecordOptions = {}): RendererNoiseFlush[] {
		const time = this.now();
		const windowMs = options.windowMs ?? RENDERER_NOISE_WINDOW_MS;
		const deferFirst = options.deferFirst ?? false;
		const current = this.windows.get(key);
		if (current && time - current.windowStart < current.windowMs) {
			current.total += 1;
			current.suppressed += 1;
			return [];
		}
		const flushes: RendererNoiseFlush[] = [];
		if (current) flushes.push(...this.settle(key, current));
		this.windows.set(key, { windowStart: time, total: 1, suppressed: 0, level, message, windowMs, deferFirst, detail: options.detail });
		if (!deferFirst) {
			flushes.push({ key, count: 1, level, message, windowMs, summary: false, detail: options.detail });
		}
		return flushes;
	}

	flushAll(): RendererNoiseFlush[] {
		const flushes: RendererNoiseFlush[] = [];
		for (const [key, window] of this.windows) {
			flushes.push(...this.settle(key, window));
		}
		this.windows.clear();
		return flushes;
	}

	private settle(key: string, window: NoiseWindow): RendererNoiseFlush[] {
		const nextWindowMs = Math.min(window.windowMs * RENDERER_NOISE_WINDOW_GROWTH, RENDERER_NOISE_WINDOW_MAX_MS);
		if (nextWindowMs !== window.windowMs) window.windowMs = nextWindowMs;
		const base = { key, message: window.message, windowMs: window.windowMs, detail: window.detail };

		if (window.deferFirst) return [{ ...base, count: window.total, level: window.level, summary: false }];

		if (window.suppressed <= 0) return [];
		return [{ ...base, count: window.suppressed, level: toRendererNoiseSummaryLevel(window.level), summary: true }];
	}
}

export function toRendererNoiseLog(flush: RendererNoiseFlush): { level: AppLogLevel; message: string; detail: unknown } {
	return {
		level: flush.level,
		message: flush.summary || flush.count > 1 ? `${flush.message} (${flush.count} in ${Math.round(flush.windowMs / 1000)}s)` : flush.message,
		detail: { ...(typeof flush.detail === "object" && flush.detail !== null ? (flush.detail as Record<string, unknown>) : { detail: flush.detail }), noiseKey: flush.key, count: flush.count, windowMs: flush.windowMs, repeated: flush.summary },
	};
}
