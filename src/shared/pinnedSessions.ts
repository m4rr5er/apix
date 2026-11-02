export function normalizePinnedSessionIds(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	const ids = new Set<string>();
	for (const candidate of value) {
		if (typeof candidate !== "string") continue;
		const id = candidate.trim();
		if (id) ids.add(id);
	}
	return [...ids];
}
