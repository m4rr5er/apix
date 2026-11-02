import type { PiSkillLocation, PiSkillSummary } from "./skills";

export type PiCommand = {
	name: string;
	description?: string;
	source?: string;
};

export type PiInstallStatus = {
	installed: boolean;
	command?: string;
	version?: string;
	searchedDirs: string[];
	error?: string;

	piPath?: string;
};

export type PiInstallationSource = "managed" | "package-manager" | "portable" | "custom" | "path";

export type PiInstallation = {
	path: string;

	realPath: string;
	version?: string;

	versionError?: string;
	source: PiInstallationSource;

	managedRoot?: string;

	isActive: boolean;

	userAdded?: boolean;

	missing?: boolean;

	shellDefault?: boolean;

	isNewest?: boolean;
};

export type WslConnectionValidation = {
	ok: boolean;
	whoami: string;
	piVersion: string;
	piPath: string;
	error: string;
};

export type PiInstallExecResult = {
	success: boolean;
	exitCode: number | null;
	stdout: string;
	stderr: string;

	alreadyInstalled?: PiInstallation[];
};

export type NpmAvailabilityResult = {
	available: boolean;
	version?: string;
	error?: string;
};

export type ConfigFileDiagnostic = {
	fileName: string;
	message: string;
	line?: number;
	column?: number;
	snippet?: string;
	docsUrl: string;
};

export type ConfigFileReadResult<T> = {
	raw: string;
	parsed: T;
	diagnostic?: ConfigFileDiagnostic;
};

export type ProjectResourceOverrides = {
	disabledGlobalExtensions: string[];

	disabledGlobalSkills: string[];

	disabledGlobalPrompts: string[];
};

export type ProjectInheritedResourceToggleInput = {
	projectId: string;
	kind: "extension" | "skill" | "prompt";
	key: string;
	enabled: boolean;
};

export type ProjectResourceListResult = {
	skills: PiSkillSummary[];
	extensions: PiExtensionSummary[];
	skillLocations: PiSkillLocation[];
	overrides: ProjectResourceOverrides;
};

export type ProjectResourceDiscoveryResult = {
	projectResourcesAllowed: boolean;
	overrides: ProjectResourceOverrides;
	skills: Array<{
		id: string;
		name: string;
		path: string;
		dir: string;
		sourceId: string;
		sourceLabel: string;
		description: string;
		userOnly?: boolean;
		enabled: boolean;
		managed: boolean;
	}>;
	prompts: Array<{
		name: string;
		path: string;
		sourceId: string;
		sourceLabel: string;
		description: string;
		enabled: boolean;
		managed: boolean;
	}>;
	extensions: Array<{
		source: string;
		path: string;
		sourceId: string;
		sourceLabel: string;
		physicalScope: "user" | "project";
		enabled: boolean;
		managed: boolean;

		version?: string;
	}>;
};

export type ProjectResourceDirectoryKind = "project-pi" | "project-agents" | "prompts";

export type CreateProjectSkillInput = {
	projectId: string;
	name: string;
	description: string;
	locationId: Extract<PiSkillLocation["id"], "project-pi" | "project-agents">;
};

export type PiExtensionSummary = {
	id: string;
	source: string;
	path?: string;

	scope: "user" | "project" | "unknown";

	builtIn?: boolean;

	filtered?: boolean;

	local?: boolean;

	enabled?: boolean;
	currentVersion?: string;
	latestVersion?: string;
	hasUpdate?: boolean;
	updateError?: string;
};

export type PiPackageInfo = {
	name: string;
	description: string;
	installCmd: string;
	tags: string[];
	downloads: string;
	updated: string;
	npmUrl: string;
	repoUrl?: string;

	piPackageName?: string;
};

export type PiExtensionListResult = {
	extensions: PiExtensionSummary[];
	raw: string;

	conflicts?: { builtIn: string; thirdParty: string }[];
};

export type PiCliUpdateResult = {
	command: string;
	output: string;
	updated: boolean;
};

export type PiUpdateCheckResult = {
	currentVersion?: string;
	latestVersion?: string;
	hasUpdate: boolean;
	error?: string;

	command?: string;

	packageName?: string;
};

export type PiProxyTestResult = {
	success: boolean;
	url: string;
	elapsedMs: number;
	statusCode?: number;
	message?: string;
	error?: string;
	bypassed?: boolean;
};

export type AppInfo = {
	appUpdatesEnabled?: boolean;
	version: string;
	releasesUrl: string;

	platform: NodeJS.Platform;

	homeDir: string;

	userDataDir: string;

	devBranch?: string;

	piVersion?: string;

	piAiVersion?: string;
	electronVersion?: string;
	chromeVersion?: string;
	nodeVersion?: string;

	buildTime?: string;

	installedAt?: string;
};

export type FeedbackEnvironment = {
	appVersion: string;
	platform: NodeJS.Platform;
	arch: string;
	electronVersion: string;
	chromeVersion: string;
	nodeVersion: string;
	pi: PiInstallStatus;
};

export type AppUpdatePhase = "idle" | "checking" | "available" | "downloading" | "ready" | "installing" | "error";

export type AppUpdateDeliveryMode = "automatic" | "manual";

export type AppUpdateDeliveryReason = "automatic" | "mac-unsigned" | "linux-arm64" | "linux-package-format" | "unsupported";

export type AppManualUpdateAssetKind = "dmg" | "zip" | "nsis" | "portable" | "appimage" | "deb" | "tar.gz";

export interface AppManualUpdateRelease {
	version: string;

	assetName: string;

	assetUrl: string;

	assetSize?: number;

	digestSha256?: string;
	kind: AppManualUpdateAssetKind;
	platform: "darwin" | "win32" | "linux";
	arch: "x64" | "arm64";

	translated?: boolean;

	releasePageUrl: string;
}

export type AppUpdateDownloadState = {
	phase: AppUpdatePhase;

	version?: string;

	percent?: number;
	bytesPerSecond?: number;
	transferred?: number;
	total?: number;

	error?: string;

	errorKind?: "check" | "download";
};

export type UpdateChannel = "stable" | "dev";

export interface UpdateChannelInfo {
	channel: UpdateChannel;
	currentVersion: string;

	devBuild: boolean;
}

export interface TargetChannelRelease {
	version: string;

	notesExcerpt: string;

	assetUrl: string;

	assetName: string;

	digestSha256?: string;

	releasePageUrl: string;
}

export interface ChannelSwitchSnapshot {
	phase: "idle" | "querying" | "available" | "up-to-date" | "downloading" | "ready" | "error";
	target?: TargetChannelRelease;

	targetChannel?: UpdateChannel;

	currentVersion?: string;

	percent?: number;

	installerPath?: string;

	error?: string;
}

export type ChannelSwitchActionResult = { ok: true; release?: TargetChannelRelease; installerPath?: string } | { ok: false; error: string };

export type AppUpdateStatusSnapshot = {
	lastCheckAt?: number;

	deliveryMode: AppUpdateDeliveryMode;

	deliveryReason?: AppUpdateDeliveryReason;

	autoDownload?: boolean | null;

	app: {
		latestVersion?: string;
		hasUpdate: boolean;

		skippedVersion?: string;

		notifiedVersion?: string;

		download: AppUpdateDownloadState;

		recommendedDownload?: AppManualUpdateRelease | null;
	} | null;

	piCli: {
		currentVersion?: string;
		latestVersion?: string;
		hasUpdate: boolean;

		notifiedVersion?: string;
		error?: string;
	} | null;

	catalog: {
		localVersion?: string | null;

		latestVersion?: string;
		hasUpdate: boolean;
		error?: string;
	} | null;
};

export type AppLogLevel = "debug" | "info" | "warn" | "error";

export type AppLogEntry = {
	id: string;
	time: number;
	level: AppLogLevel;
	scope: string;
	message: string;
	detail?: unknown;
};

export type AppLogQuery = {
	level?: AppLogLevel | "all";
	search?: string;

	from?: number;

	to?: number;

	limit?: number;

	page?: number;
	pageSize?: number;
};

export type AppLogPage = {
	entries: AppLogEntry[];

	total: number;

	page: number;
	pageSize: number;

	hasMore: boolean;
};

export type PiRuntimeEvent = {
	agentId: string;
	event: unknown;
};

export type ChangelogPayload = {
	markdown: string | null;

	source: "atomgit" | "github" | null;

	versionCount: number;

	pageUrl: string;

	fetchedAt: string | null;

	fromCache: boolean;

	stale: boolean;
};

export type PiReleaseNotesPayload = {
	markdown: string | null;

	source: "jsdelivr" | "unpkg" | "github" | null;

	versionCount: number;

	pageUrl: string;

	fetchedAt: string | null;

	truncated: boolean;
};
