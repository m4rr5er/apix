export type DiagnosticsEventTiming = {
	name: string;

	startedAt: number;

	durationMs: number;
	detail?: Record<string, string | number | boolean | null>;
};

export type DiagnosticsSnapshot = {
	enabled: boolean;
	sampledAt: number;

	main: {
		rssBytes: number;
		heapUsedBytes: number;
		heapTotalBytes: number;
		externalBytes: number;
		arrayBuffersBytes: number;
	};

	eventLoopLagMs: number;

	eventLoopLagMaxMs: number;

	memoryProfilePath: string | null;

	timingsPath: string | null;

	recentTimings: DiagnosticsEventTiming[];
};

export type ArchStatus = {
	platform: string;

	processArch: string;

	runningUnderArm64Translation: boolean;
};
