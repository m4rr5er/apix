export type ConfigBackupReason = "first-run" | "upgrade" | "on-save" | "manual" | "pre-restore";

export type ConfigBackupMeta = {
	id: string;

	createdAt: string;

	appVersion: string;

	reason: ConfigBackupReason;

	size: number;

	files: string[];

	configDir: string;
};

export type ConfigBackupFileView = {
	name: string;

	raw: string;

	redacted: boolean;
};

export type ConfigBackupDetail = {
	id: string;
	createdAt: string;
	appVersion: string;
	reason: ConfigBackupReason;
	size: number;
	configDir: string;
	files: ConfigBackupFileView[];
};

export type ConfigBackupListResult = { ok: true; backups: ConfigBackupMeta[] } | { ok: false; error: string };

export type ConfigBackupActionResult = { ok: true; id?: string } | { ok: false; error: string };

export type ConfigBackupDeleteManyResult = { ok: true; deleted: number } | { ok: false; error: string };
