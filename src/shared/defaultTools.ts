export const PI_DEFAULT_TOOL_NAMES = ["read", "bash", "edit", "write"] as const;

export const TOOL_CATALOG: Array<{ name: string; group: "builtin" | "extension" }> = [
	{ name: "read", group: "builtin" },
	{ name: "bash", group: "builtin" },
	{ name: "powershell", group: "builtin" },
	{ name: "edit", group: "builtin" },
	{ name: "write", group: "builtin" },
	{ name: "grep", group: "builtin" },
	{ name: "find", group: "builtin" },
	{ name: "ls", group: "builtin" },
	{ name: "codemode", group: "extension" },
	{ name: "tool_search", group: "extension" },
];

function isToolModifier(entry: string): boolean {
	return entry.startsWith("+") || entry.startsWith("-");
}

export function mergeDefaultTools(base: readonly string[] | undefined, overrides: readonly string[] | undefined): string[] | undefined {
	if (overrides === undefined) return base === undefined ? undefined : [...base];
	if (!Array.isArray(base) || !overrides.every(isToolModifier)) return [...overrides];
	return [...base, ...overrides];
}

export function resolveDefaultTools(entries: readonly string[] | undefined): string[] {
	if (entries === undefined) return [...PI_DEFAULT_TOOL_NAMES];
	const plain = entries.filter((entry) => !isToolModifier(entry));
	const tools = plain.length > 0 || entries.length === 0 ? [...plain] : [...PI_DEFAULT_TOOL_NAMES];
	for (const entry of entries) {
		if (!isToolModifier(entry)) continue;
		const name = entry.slice(1);
		const index = tools.indexOf(name);
		if (entry.startsWith("+") && index === -1 && name) tools.push(name);
		else if (entry.startsWith("-") && index !== -1) tools.splice(index, 1);
	}
	return tools;
}

export function resolveDefaultToolsInLayer(baseEntries: readonly string[] | undefined, entries: readonly string[] | undefined): string[] {
	return resolveDefaultTools(mergeDefaultTools(baseEntries, entries));
}

export function isToolEnabledInLayer(baseEntries: readonly string[] | undefined, entries: readonly string[] | undefined, name: string): boolean {
	return resolveDefaultToolsInLayer(baseEntries, entries).includes(name);
}

export function isToolEnabled(entries: readonly string[] | undefined, name: string): boolean {
	return isToolEnabledInLayer(undefined, entries, name);
}

function sameToolSet(left: readonly string[], right: readonly string[]): boolean {
	return left.length === right.length && left.every((name, index) => name === right[index]);
}

function diffModifiers(from: readonly string[], to: readonly string[]): string[] {
	const modifiers: string[] = [];
	for (const name of from) if (!to.includes(name)) modifiers.push(`-${name}`);
	for (const name of to) if (!from.includes(name)) modifiers.push(`+${name}`);
	return modifiers;
}

export function encodeDefaultToolsSelection(options: { baseEntries?: readonly string[] | undefined; entries?: readonly string[] | undefined; selection: readonly string[] }): string[] | undefined {
	const { baseEntries, entries } = options;
	const selection = [...options.selection];
	const resolvesTo = (candidate: readonly string[] | undefined) => sameToolSet(resolveDefaultToolsInLayer(baseEntries, candidate), selection);

	if (resolvesTo(entries)) return entries === undefined ? undefined : [...entries];

	if (resolvesTo(undefined)) return undefined;

	const current = resolveDefaultToolsInLayer(baseEntries, entries);
	const changed = new Set([...current.filter((name) => !selection.includes(name)), ...selection.filter((name) => !current.includes(name))]);
	const kept = (entries ?? []).filter((entry) => !changed.has(isToolModifier(entry) ? entry.slice(1) : entry));
	const diff = diffModifiers(current, selection);

	const candidates: Array<readonly string[] | undefined> = [kept, [...kept, ...diff], diff, selection];
	for (const candidate of candidates) {
		if (resolvesTo(candidate)) return candidate === undefined ? undefined : [...candidate];
	}
	return selection;
}

export function setToolEnabled(options: { baseEntries?: readonly string[] | undefined; entries?: readonly string[] | undefined; name: string; on: boolean }): string[] | undefined {
	const current = resolveDefaultToolsInLayer(options.baseEntries, options.entries);
	const selection = options.on ? (current.includes(options.name) ? current : [...current, options.name]) : current.filter((name) => name !== options.name);
	return encodeDefaultToolsSelection({ baseEntries: options.baseEntries, entries: options.entries, selection });
}

export function defaultToolsDisablesAll(entries: readonly string[] | undefined): boolean {
	return Array.isArray(entries) && entries.length === 0;
}

export function mergeCodemodeSetting(existing: unknown, patch: { mode?: string | undefined; inlineBudget?: number | undefined }): Record<string, unknown> | undefined {
	const next: Record<string, unknown> = existing && typeof existing === "object" && !Array.isArray(existing) ? { ...(existing as Record<string, unknown>) } : {};
	for (const [key, value] of Object.entries(patch)) {
		if (value === undefined) delete next[key];
		else next[key] = value;
	}
	return Object.keys(next).length > 0 ? next : undefined;
}

export function normalizeCodemodeMode(value: unknown): "on" | "only" | undefined {
	return value === "on" || value === "only" ? value : undefined;
}

export function normalizeCodemodeInlineBudget(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : undefined;
}
