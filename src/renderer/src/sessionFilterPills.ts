import type { AgentBackend, SessionSource } from "../../shared/types";

export type SessionFilterPill = SessionSource | "imagegen";

export const SESSION_FILTER_PILLS: readonly SessionFilterPill[] = ["pi", "codex", "claude", "qoder", "opencode", "zcode", "workbuddy", "cursor", "kimi", "kimiwork", "minimax", "imagegen"];

export function isSessionFilterPill(value: unknown): value is SessionFilterPill {
	return typeof value === "string" && (SESSION_FILTER_PILLS as readonly string[]).includes(value);
}

export function sessionPillOf(session: { source?: SessionSource; backend?: AgentBackend }): SessionFilterPill {
	if (session.backend === "imagegen") return "imagegen";
	return session.source ?? "pi";
}

export function filterSessionsByPills<T extends { source?: SessionSource; backend?: AgentBackend }>(sessions: readonly T[], activePills: ReadonlySet<SessionFilterPill>): T[] {
	return sessions.filter((session) => activePills.has(sessionPillOf(session)));
}

export function pillsPresentIn<T extends { source?: SessionSource; backend?: AgentBackend }>(sessions: readonly T[]): SessionFilterPill[] {
	const present = new Set(sessions.map(sessionPillOf));
	return SESSION_FILTER_PILLS.filter((pill) => present.has(pill));
}

export const SESSION_FILTER_STORAGE_VERSION = 3;

export type SessionFilterState = Record<string, Set<SessionFilterPill> | null>;

export function parseSessionFilterState(raw: string | null | undefined): SessionFilterState {
	if (!raw) return {};
	try {
		const parsed: unknown = JSON.parse(raw);
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
		const state: SessionFilterState = {};

		const storedVersion = (parsed as { v?: unknown }).v;
		if (storedVersion === 2 || storedVersion === SESSION_FILTER_STORAGE_VERSION) {
			const records = (parsed as { filters?: unknown }).filters;
			if (!records || typeof records !== "object" || Array.isArray(records)) return {};
			for (const [projectId, value] of Object.entries(records)) {
				if (value === null) {
					state[projectId] = null;
				} else if (Array.isArray(value)) {
					const pills = value.filter(isSessionFilterPill);
					state[projectId] = new Set(pills);
				}
			}
			return state;
		}

		for (const [projectId, value] of Object.entries(parsed)) {
			if (value === null) {
				state[projectId] = null;
				continue;
			}
			if (!Array.isArray(value)) continue;
			const pills = value.filter(isSessionFilterPill);
			state[projectId] = new Set(pills);
		}
		return state;
	} catch {
		return {};
	}
}

export function serializeSessionFilterState(state: SessionFilterState): string {
	return JSON.stringify({
		v: SESSION_FILTER_STORAGE_VERSION,
		filters: Object.fromEntries(Object.entries(state).map(([projectId, filter]) => [projectId, filter === null ? null : [...filter]])),
	});
}
