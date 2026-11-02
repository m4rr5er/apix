export const SESSION_TAB_MAX_WIDTH_DEFAULT = 104;

export const SESSION_TAB_MAX_WIDTH_MIN = 80;

export const SESSION_TAB_MAX_WIDTH_MAX = 400;

export const SESSION_TAB_BADGE_EXTRA_WIDTH = 28;

export function clampSessionTabMaxWidth(value: unknown): number {
	if (typeof value !== "number" || !Number.isFinite(value)) return SESSION_TAB_MAX_WIDTH_DEFAULT;
	return Math.min(SESSION_TAB_MAX_WIDTH_MAX, Math.max(SESSION_TAB_MAX_WIDTH_MIN, Math.round(value)));
}
