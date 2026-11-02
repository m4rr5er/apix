import type { PiInstallStatus } from "./app";

export type HealthStatus = "ok" | "warn" | "error" | "skipped";

export type HealthCheckItem = {
	id: string;
	status: HealthStatus;

	detail: string;
};

export type HealthLogLine = {
	time: number;
	level: "warn" | "error";
	scope: string;
	message: string;
};

export type HealthLogSummary = {
	total: number;
	error: number;
	warn: number;

	todayError: number;
	todayWarn: number;

	recent: HealthLogLine[];
};

export type HealthFlags = {
	wslEnabled: boolean;
	wslDistro: string;

	piProxyEnabled: boolean;

	desktopProxyEnabled: boolean;

	piProxyConfigured: boolean;
	chromiumSandbox: boolean;
	developerDiagnostics: boolean;
	webServiceEnabled: boolean;

	customPiPathConfigured: boolean;
};

export type HealthEnvironment = {
	appVersion: string;
	platform: NodeJS.Platform;
	arch: string;

	osVersion: string;

	locale: string;
	timezone: string;
	electronVersion: string;
	chromeVersion: string;
	nodeVersion: string;

	installMode: "installed" | "portable" | "dev";

	userDataDir: string;

	logsDir: string;
	appRssBytes: number;
	appHeapUsedBytes: number;
	systemTotalMemoryBytes: number;
	systemFreeMemoryBytes: number;

	dataDirFreeBytes: number;
	flags: HealthFlags;
	pi: PiInstallStatus;
};

export type HealthLogFile = {
	name: string;
	sizeBytes: number;

	modifiedAt: number;
};

export type HealthReport = {
	generatedAt: number;
	environment: HealthEnvironment;
	checks: HealthCheckItem[];
	logSummary: HealthLogSummary;

	logFiles: HealthLogFile[];
};

export type HealthReportFormat = "markdown" | "card" | "prompt";

export type HealthReportContext = {
	description: string;

	steps: string;

	projectName: string;
};

export type FeedbackProjectContext = {
	projectId: string;
	projectName: string;

	agentsMd: string;

	agentsMdTruncated: boolean;

	skills: string[];
};

export type HealthExportResult = {
	ok: boolean;
	canceled: boolean;

	path?: string;
	error?: string;
};
