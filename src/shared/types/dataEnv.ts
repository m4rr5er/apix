export type DataEnvMode = "shared" | "channel-dev";

export interface DataEnvDecisionFile {
	schemaVersion: 1;
	dataMode: DataEnvMode;
	lastAppVersion: string;
	createdAt: string;
}

export interface DataEnvInfo {
	channel: import("./app").UpdateChannel;

	decided: boolean;
	dataMode: DataEnvMode | null;

	activeDirectory: "shared" | "channel-dev";
}

export type DataEnvMismatchAction = "continue" | "quit";

export interface DataEnvChoiceResult {
	restartRequired: boolean;

	importAvailable: boolean;
}

export type DataEnvChoiceFailure = { ok: false; error: "invalid-mode" };

export interface ImportItem {
	relPath: string;
	isDir: boolean;

	bytes: number;
}

export interface ImportProgress {
	phase: "estimating" | "copying" | "done" | "cancelled" | "error";
	currentItem: string | null;
	copiedBytes: number;
	totalBytes: number;
}

export type ImportPreviewResult = { ok: true; items: ImportItem[]; totalBytes: number } | { ok: false; error: "unavailable" };

export type ImportStartResult = { ok: true } | { ok: false; error: "busy" | "cancelled" | "unavailable" | "failed" };
