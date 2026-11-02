import type { SessionSortModeId } from "./types/session";

export const DEFAULT_SESSION_SORT_MODE: SessionSortModeId = "updatedAt";

export function normalizeSessionSortMode(value: unknown): SessionSortModeId {
	return value === "createdAt" || value === "title" ? value : DEFAULT_SESSION_SORT_MODE;
}
