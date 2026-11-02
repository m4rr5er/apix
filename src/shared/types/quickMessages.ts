export type QuickMessagesSnapshot = {
	items: string[];

	defaults: string[];

	filePath: string;

	seeded: boolean;

	defaultsAvailable: boolean;
};

export type QuickMessagesSaveResult = { ok: true; snapshot: QuickMessagesSnapshot } | { ok: false; error: string };
