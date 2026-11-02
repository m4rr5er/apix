export const NOTICE_HISTORY_KINDS = ["info", "error", "warning", "question", "neutral"] as const;

export type NoticeHistoryKind = (typeof NOTICE_HISTORY_KINDS)[number];

export type NoticeHistoryRecordInput = {
	title: string;

	description?: string;
	kind: NoticeHistoryKind;

	duration: number;
};

export type NoticeHistoryFileEntry = {
	timestamp: number;
	kind: NoticeHistoryKind;
	title: string;
	description?: string;
	duration: number;
};

export type NoticeHistoryFile = { version: typeof NOTICE_HISTORY_FILE_VERSION; entries: NoticeHistoryFileEntry[] };

export const NOTICE_HISTORY_FILE_VERSION = 1;

export const NOTICE_HISTORY_MAX_ENTRIES = 200;

export const NOTICE_HISTORY_TITLE_MAX_CHARS = 2000;
export const NOTICE_HISTORY_DESCRIPTION_MAX_CHARS = 8000;

export const NOTICE_HISTORY_STICKY_DURATION_ENCODING = -1;
