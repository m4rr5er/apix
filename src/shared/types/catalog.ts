export type CatalogArtifactSourceStatus = {
	packageVersion: string | null;

	entryCount: number | null;
};

export type CatalogUpdateStatus = {
	builtin: CatalogArtifactSourceStatus | null;

	overlay: CatalogArtifactSourceStatus | null;

	hasOverlayFiles: boolean;

	hasBackup: boolean;
};

export type CatalogUpdateFailCode = "network" | "validation" | "incompatible" | "write" | "no-backup";

export type CatalogCheckSourceId = "branch" | "npm";

export type CatalogUpdateResult =
	| {
			ok: true;
			updated: boolean;

			skipped?: "already-latest" | "remote-behind";

			remoteVersion?: string | null;

			localVersion?: string | null;
	  }
	| { ok: false; code: CatalogUpdateFailCode; message: string };

export type CatalogCheckResult =
	| {
			ok: true;
			remoteVersion: string;
			localVersion: string | null;
			hasUpdate: boolean;

			source?: CatalogCheckSourceId;
	  }
	| { ok: false; code: CatalogUpdateFailCode; message: string };
