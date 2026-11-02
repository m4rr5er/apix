export const MAX_QUICK_MESSAGES = 30;

export const MAX_QUICK_MESSAGE_LENGTH = 200;

export const QUICK_MESSAGES_FILE_NAME = "quick-messages.json";
export const QUICK_MESSAGES_DEFAULT_RESOURCE_NAME = "quick-messages.default.json";

export const REPLY_ACTIONS_FILE_NAME = "reply-actions.json";
export const REPLY_ACTIONS_DEFAULT_RESOURCE_NAME = "reply-actions.default.json";

export const QUICK_MESSAGES_FILE_VERSION = 1;

export type QuickMessagesFile = {
	version: number;
	items: string[];
};

export function normalizeQuickMessages(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	const seen = new Set<string>();
	const result: string[] = [];
	for (const item of value) {
		if (typeof item !== "string") continue;
		const text = item.trim();
		if (!text) continue;
		const clipped = text.slice(0, MAX_QUICK_MESSAGE_LENGTH);
		const dedupeKey = clipped.toLowerCase();
		if (seen.has(dedupeKey)) continue;
		seen.add(dedupeKey);
		result.push(clipped);
		if (result.length >= MAX_QUICK_MESSAGES) break;
	}
	return result;
}

export function sanitizeQuickMessagesFile(raw: unknown): QuickMessagesFile | null {
	if (Array.isArray(raw)) return { version: QUICK_MESSAGES_FILE_VERSION, items: normalizeQuickMessages(raw) };
	if (!raw || typeof raw !== "object") return null;
	const record = raw as Record<string, unknown>;
	if (!("items" in record)) return null;

	if (!Array.isArray(record.items)) return null;
	const version = typeof record.version === "number" && Number.isFinite(record.version) ? record.version : QUICK_MESSAGES_FILE_VERSION;
	return { version, items: normalizeQuickMessages(record.items) };
}
