export type CompactUrgency = "idle" | "warn" | "danger";

export type CompactUiState = {
	ready: boolean;
	compacting: boolean;
	urgency: CompactUrgency;
};

export type CompactNoticeKind = "done" | "nothingToDo" | "tooSmall" | "inProgress" | "failed" | "cancelled" | "cancelledByOwner" | "interrupted" | "routedToOwner" | "timeout";

export const COMPACT_CANCELLED_BY_OWNER = "Compaction cancelled by session_before_compact hook";
export const COMPACT_CANCELLED_BY_USER_ABORT = "Compaction cancelled by user abort";

export const COMPACT_ROUTED_TO_OWNER = "Compaction routed to extension command";

export const COMPACT_WAIT_TIMEOUT = "Compact wait timed out; still running in background";

export function compactRoutedCommand(raw: string): string | null {
	const index = raw.indexOf(COMPACT_ROUTED_TO_OWNER);
	if (index < 0) return null;
	const command = raw
		.slice(index + COMPACT_ROUTED_TO_OWNER.length)
		.replace(/^[:：\s]+/, "")
		.split(/\s+/)[0]
		?.trim();
	return command && command.startsWith("/") ? command : null;
}

export function compactOwnerReason(raw: string): string | null {
	const index = raw.indexOf(COMPACT_CANCELLED_BY_OWNER);
	if (index < 0) return null;
	const reason = raw
		.slice(index + COMPACT_CANCELLED_BY_OWNER.length)
		.replace(/^[:：\-\s]+/, "")
		.trim();
	return reason.length > 0 ? reason : null;
}

export const COMPACT_HOOK_REJECT_MAX_MS = 1500;

export const COMPACT_USER_ABORT_WINDOW_MS = 10_000;

export const COMPACT_OBSERVATION_MAX_AGE_MS = 60_000;

export type CompactUsageInput = {
	contextPercent?: number | null;
	contextTokens?: number | null;
	contextWindow?: number | null;
};

export function resolveCompactUsagePercent(state?: CompactUsageInput | null): number | null {
	if (state?.contextPercent == null) return null;
	let percent = state.contextPercent;
	const used = state.contextTokens;
	const contextWindow = state.contextWindow;
	if (percent <= 0 && used != null && used > 0 && contextWindow != null && contextWindow > 0) {
		percent = (used / contextWindow) * 100;
	}
	return percent;
}

export function compactUiState(percent: number | null | undefined, compacting: boolean): CompactUiState {
	return {
		ready: percent != null,
		compacting,
		urgency: percent == null ? "idle" : percent >= 90 ? "danger" : percent >= 70 ? "warn" : "idle",
	};
}

export function classifyCompactError(raw: string): CompactNoticeKind {
	const lower = raw.trim().toLowerCase();
	if (!lower) return "failed";
	if (/nothing to compact|already compacted/.test(lower)) return "nothingToDo";
	if (/session too small|too small|not ready|below threshold/.test(lower)) {
		return "tooSmall";
	}
	if (/already compacting|compaction in progress/.test(lower)) return "inProgress";

	if (/compaction routed to extension/.test(lower)) return "routedToOwner";

	if (/compact wait timed out/.test(lower)) return "timeout";

	if (/session_before_compact|cancelled by owner|cancelled by extension/.test(lower)) {
		return "cancelledByOwner";
	}
	if (/cancelled by user abort|cancelled by abort/.test(lower)) return "interrupted";
	if (/compaction cancelled|cancelled/.test(lower)) return "cancelled";
	return "failed";
}
