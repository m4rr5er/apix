export type SessionIdAliasSource = {
	id: string;
	mergedSessionIds?: readonly string[];
};

export function readMergedSessionIds(value: unknown): string[] | undefined {
	if (!Array.isArray(value)) return undefined;
	const raw: unknown[] = value;
	const ids: string[] = [];
	for (const item of raw) {
		if (typeof item !== "string" || item.length === 0) continue;
		ids.push(item);
	}
	return ids.length > 0 ? ids : undefined;
}

export function buildSessionIdAliasMap(records: readonly SessionIdAliasSource[]): Map<string, string> {
	const realIds = new Set<string>();
	for (const record of records) realIds.add(record.id);
	const aliases = new Map<string, string>();
	for (const record of records) {
		for (const alias of readMergedSessionIds(record.mergedSessionIds) ?? []) {
			if (!alias || alias === record.id) continue;
			if (realIds.has(alias)) continue;
			if (aliases.has(alias)) continue;
			aliases.set(alias, record.id);
		}
	}
	return aliases;
}

export function remapSessionIds(ids: readonly string[], aliases: ReadonlyMap<string, string>): readonly string[] {
	if (aliases.size === 0) return ids;
	let changed = false;
	const seen = new Set<string>();
	const next: string[] = [];
	for (const id of ids) {
		const canonical = aliases.get(id) ?? id;
		if (canonical !== id) changed = true;
		if (seen.has(canonical)) {
			changed = true;
			continue;
		}
		seen.add(canonical);
		next.push(canonical);
	}
	return changed ? next : ids;
}

export function migrateSessionIdList(ids: readonly string[], records: readonly SessionIdAliasSource[]): readonly string[] {
	return remapSessionIds(ids, buildSessionIdAliasMap(records));
}

export function remapSessionIdActivities<T extends { sessionId: string }>(entries: readonly T[], aliases: ReadonlyMap<string, string>): readonly T[] {
	if (aliases.size === 0) return entries;
	let changed = false;
	const seen = new Set<string>();
	const next: T[] = [];
	for (const entry of entries) {
		const sessionId = aliases.get(entry.sessionId) ?? entry.sessionId;
		if (sessionId !== entry.sessionId) changed = true;
		if (seen.has(sessionId)) {
			changed = true;
			continue;
		}
		seen.add(sessionId);
		next.push(sessionId === entry.sessionId ? entry : { ...entry, sessionId });
	}
	return changed ? next : entries;
}
