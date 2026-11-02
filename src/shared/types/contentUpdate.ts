export type BuiltinContentArtifactStatus = {
	version: string;

	fileCount: number;
};

export type BuiltinContentUpdateStatus = {
	builtin: BuiltinContentArtifactStatus | null;

	overlay: BuiltinContentArtifactStatus | null;

	hasOverlayFiles: boolean;

	hasBackup: boolean;

	effectiveVersion: string | null;

	overlayDir: string | null;
};

export type BuiltinContentCheckResult = {
	ok: boolean;
	code?: "network" | "validation";
	message?: string;

	remoteVersion?: string;

	localVersion?: string | null;
	hasUpdate: boolean;

	changedFiles?: string[];
};

export type BuiltinContentUpdateResult = {
	ok: boolean;
	code?: "network" | "validation" | "write";
	message?: string;

	updated: boolean;

	version?: string;

	filesWritten?: number;
};
