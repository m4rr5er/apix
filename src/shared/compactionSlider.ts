export const COMPACTION_SLIDER_MIN_PERCENT = 1;

export const COMPACTION_SLIDER_MAX_PERCENT = 50;

export const COMPACT_REFERENCE_WINDOW_TOKENS = 200_000;

export function compactionPercentToTokens(percent: number, contextWindow: number): number {
	if (!Number.isFinite(percent) || !Number.isFinite(contextWindow) || contextWindow <= 0) return 0;
	return Math.max(0, Math.round((percent / 100) * contextWindow));
}

export function compactionTokensToPercent(tokens: number, contextWindow: number): number {
	if (!Number.isFinite(tokens) || !Number.isFinite(contextWindow) || contextWindow <= 0) return COMPACTION_SLIDER_MIN_PERCENT;
	return Math.min(COMPACTION_SLIDER_MAX_PERCENT, Math.max(COMPACTION_SLIDER_MIN_PERCENT, Math.round((tokens / contextWindow) * 100)));
}
