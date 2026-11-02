export type BuiltInExtensionsArtifactStatus = {
	version: string;

	fileCount: number;
};

export type BuiltInExtensionsUpdateStatus = {
	builtin: BuiltInExtensionsArtifactStatus | null;

	overlay: BuiltInExtensionsArtifactStatus | null;

	hasOverlayFiles: boolean;

	hasBackup: boolean;

	effectiveVersion: string | null;

	overlayDir: string | null;
};

export type BuiltInExtensionsCheckResult = {
	ok: boolean;
	code?: "network" | "validation";
	message?: string;

	remoteVersion?: string;

	localVersion?: string | null;
	hasUpdate: boolean;

	changedFiles?: string[];
};

export type BuiltInExtensionsUpdateResult = {
	ok: boolean;
	code?: "network" | "validation" | "write";
	message?: string;

	updated: boolean;

	version?: string;

	filesWritten?: number;
};
