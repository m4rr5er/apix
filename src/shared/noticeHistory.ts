import { NOTICE_HISTORY_DESCRIPTION_MAX_CHARS, NOTICE_HISTORY_FILE_VERSION, NOTICE_HISTORY_KINDS, NOTICE_HISTORY_STICKY_DURATION_ENCODING, NOTICE_HISTORY_TITLE_MAX_CHARS, type NoticeHistoryFile, type NoticeHistoryFileEntry, type NoticeHistoryKind, type NoticeHistoryRecordInput } from "./types/noticeHistory";

const KIND_SET: ReadonlySet<string> = new Set(NOTICE_HISTORY_KINDS);

function clampText(value: unknown, maxChars: number): string {
	return typeof value === "string" ? value.slice(0, maxChars) : "";
}

export function sanitizeNoticeHistoryRecord(input: unknown): NoticeHistoryRecordInput | null {
	if (!input || typeof input !== "object") return null;
	const raw = input as Record<string, unknown>;
	const title = clampText(raw.title, NOTICE_HISTORY_TITLE_MAX_CHARS);
	if (!title.trim()) return null;

	if (typeof raw.duration !== "number" || (!Number.isFinite(raw.duration) && raw.duration !== Number.POSITIVE_INFINITY) || raw.duration < 0) return null;
	const description = clampText(raw.description, NOTICE_HISTORY_DESCRIPTION_MAX_CHARS);
	const kind: NoticeHistoryKind = KIND_SET.has(raw.kind as string) ? (raw.kind as NoticeHistoryKind) : "neutral";
	return {
		title,
		description: description || undefined,
		kind,
		duration: raw.duration,
	};
}

export type NoticeHistoryDatedEntry = NoticeHistoryRecordInput & { timestamp: number };

export function toNoticeHistoryFileEntry(entry: NoticeHistoryDatedEntry): NoticeHistoryFileEntry {
	return {
		timestamp: entry.timestamp,
		kind: entry.kind,
		title: entry.title,
		description: entry.description,
		duration: entry.duration === Number.POSITIVE_INFINITY ? NOTICE_HISTORY_STICKY_DURATION_ENCODING : entry.duration,
	};
}

export function fromNoticeHistoryFileEntry(raw: unknown): NoticeHistoryFileEntry | null {
	if (!raw || typeof raw !== "object") return null;
	const record = raw as Record<string, unknown>;
	const title = clampText(record.title, NOTICE_HISTORY_TITLE_MAX_CHARS);
	if (!title.trim()) return null;
	if (typeof record.timestamp !== "number" || !Number.isFinite(record.timestamp)) return null;
	const duration = record.duration;
	if (typeof duration !== "number" || (!Number.isFinite(duration) && duration !== NOTICE_HISTORY_STICKY_DURATION_ENCODING)) return null;
	const description = clampText(record.description, NOTICE_HISTORY_DESCRIPTION_MAX_CHARS);
	const kind: NoticeHistoryKind = KIND_SET.has(record.kind as string) ? (record.kind as NoticeHistoryKind) : "neutral";
	return {
		timestamp: record.timestamp,
		kind,
		title,
		description: description || undefined,
		duration: duration === NOTICE_HISTORY_STICKY_DURATION_ENCODING ? Number.POSITIVE_INFINITY : duration,
	};
}

export function parseNoticeHistoryFile(text: string): NoticeHistoryFile | null {
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		return null;
	}
	if (!parsed || typeof parsed !== "object") return null;
	const raw = parsed as Record<string, unknown>;
	if (raw.version !== NOTICE_HISTORY_FILE_VERSION || !Array.isArray(raw.entries)) return null;
	const entries = raw.entries.map(fromNoticeHistoryFileEntry).filter((entry): entry is NoticeHistoryFileEntry => entry !== null);
	return { version: NOTICE_HISTORY_FILE_VERSION, entries };
}
