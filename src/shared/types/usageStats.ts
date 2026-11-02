export type UsageRecord = {
	ts: number;

	sid: string;

	cwd: string;

	model: string;
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	totalTokens: number;
	cost: number;

	costKnown: boolean;
};

export type UsageStatsDetectResult = {
	installed: boolean;

	piInstalled?: boolean;

	logPath: string | null;

	recordCount: number | null;

	firstRecordAt: number | null;

	lastRecordAt: number | null;
};

export type UsageStatsRefreshResult = {
	fullRescan: boolean;

	parsedRecords: number;

	skippedLines: number;
};

export type ProviderSlice = {
	provider: string;
	tokens: number;
	cost: number;
	turns: number;
};

export type DayTotals = {
	tokens: number;
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	cost: number;
	turns: number;

	sessions: string[];
};

export type UsageDayModelSlice = {
	model: string;
	provider: string;
	tokens: number;
	cost: number;
	turns: number;
};

export type UsageDayProjectSlice = {
	project: string;
	tokens: number;
	cost: number;
	turns: number;
};

export type UsageDayRow = {
	day: string;
	totals: DayTotals;
	byProvider: ProviderSlice[];

	byModel: UsageDayModelSlice[];

	byProject: UsageDayProjectSlice[];
};

export type HeatmapCell = {
	tokens: number;
	turns: number;

	level: 0 | 1 | 2 | 3 | 4;
};

export type UsageModelRow = {
	model: string;
	provider: string;
	tokens: number;
	cost: number;
	turns: number;
	sessions: number;
};

export type UsageProjectRow = {
	project: string;
	tokens: number;
	cost: number;
	turns: number;
};

export type UsageAggregated = {
	window: { since: number; to: number };
	totals: DayTotals;

	activeDays: number;
	today: DayTotals;
	thisWeek: DayTotals;
	thisMonth: DayTotals;

	daily: UsageDayRow[];

	heatmap: HeatmapCell[];

	heatmapStart: string;
	byModel: UsageModelRow[];
	byProject: UsageProjectRow[];

	costKnown: boolean;

	recordCount: number;
};
