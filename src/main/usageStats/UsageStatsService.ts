import { stat } from "node:fs/promises";
import { join } from "node:path";
import type { UsageAggregated, UsageStatsDetectResult, UsageStatsRefreshResult } from "../../shared/types/usageStats";
import { SessionSummaryCache, type SessionFileVersion } from "../sessions/sessionSummaryCache";
import { buildAggregatedView, intermediateFromRecords, mergeIntermediates, type UsageStatsIntermediate } from "./usageStatsAggregator";
import { UsageLogReader, type LogFileState } from "./UsageLogReader";

const CACHE_SCHEMA_VERSION = 2;

type CachedUsageStats = {
	schemaVersion: number;
	fileState: LogFileState;
	intermediate: UsageStatsIntermediate;
};

type MemoryState = {
	version: SessionFileVersion;
	cached: CachedUsageStats;
};

export type UsageStatsServiceDeps = {
	agentDir: string;

	userDataDir?: string;
	logger?: { info?: (msg: string) => void; warn?: (msg: string) => void };
};

function isMissingFileError(error: unknown): boolean {
	return Boolean(error && typeof error === "object" && "code" in error && (error as { code?: unknown }).code === "ENOENT");
}

function versionEqual(a: SessionFileVersion, b: SessionFileVersion): boolean {
	return a.mtimeMs === b.mtimeMs && a.size === b.size;
}

function emptyRefresh(): UsageStatsRefreshResult {
	return { fullRescan: false, parsedRecords: 0, skippedLines: 0 };
}

function mergeRefresh(a: UsageStatsRefreshResult, b: UsageStatsRefreshResult): UsageStatsRefreshResult {
	return {
		fullRescan: a.fullRescan || b.fullRescan,
		parsedRecords: a.parsedRecords + b.parsedRecords,
		skippedLines: a.skippedLines + b.skippedLines,
	};
}

class UsageLogSource {
	private memoryState: MemoryState | null = null;

	constructor(
		private readonly label: string,
		private readonly reader: UsageLogReader,
		private readonly cache: SessionSummaryCache<CachedUsageStats>,
		private readonly logger?: UsageStatsServiceDeps["logger"],
	) {}

	clearMemory(): void {
		this.memoryState = null;
	}

	async detect(logPath: string): Promise<{
		present: boolean;
		recordCount: number | null;
		firstRecordAt: number | null;
		lastRecordAt: number | null;
	}> {
		const fileStat = await statLogOrMissing(logPath, this.logger);
		if (!fileStat) {
			return { present: false, recordCount: null, firstRecordAt: null, lastRecordAt: null };
		}
		const version = { mtimeMs: fileStat.mtimeMs, size: fileStat.size };
		const state = await this.loadState(logPath, version);
		if (state) {
			const { intermediate } = state.cached;
			const hasData = intermediate.recordCount > 0;
			return {
				present: true,
				recordCount: intermediate.recordCount,
				firstRecordAt: hasData ? intermediate.window.since : null,
				lastRecordAt: hasData ? intermediate.window.to : null,
			};
		}
		return { present: true, recordCount: null, firstRecordAt: null, lastRecordAt: null };
	}

	async refresh(logPath: string): Promise<UsageStatsRefreshResult> {
		const fileStat = await statLogOrMissing(logPath, this.logger);
		if (!fileStat) return emptyRefresh();

		const version = { mtimeMs: fileStat.mtimeMs, size: fileStat.size };
		const state = await this.loadState(logPath, version);
		if (state) return emptyRefresh();

		const prev = this.memoryState?.cached.fileState ?? null;
		const result = await this.reader.readIncremental(logPath, prev);
		if (!result.fileState) return emptyRefresh();
		if (result.truncated) {
			this.logger?.warn?.(`[UsageStats:${this.label}] log exceeds read cap; data may be incomplete (${result.newRecords.length} records read)`);
		}

		if (result.fullRescan) {
			const intermediate = intermediateFromRecords(result.newRecords);
			this.commitState(logPath, version, {
				schemaVersion: CACHE_SCHEMA_VERSION,
				fileState: result.fileState,
				intermediate,
			});
			this.logger?.info?.(`[UsageStats:${this.label}] full rescan: ${result.newRecords.length} records${result.truncated ? " (truncated)" : ""}`);
		} else if (result.newRecords.length > 0) {
			const delta = intermediateFromRecords(result.newRecords);
			const intermediate = this.memoryState ? mergeIntermediates(this.memoryState.cached.intermediate, delta) : delta;
			this.commitState(logPath, version, {
				schemaVersion: CACHE_SCHEMA_VERSION,
				fileState: result.fileState,
				intermediate,
			});
			this.logger?.info?.(`[UsageStats:${this.label}] refreshed: +${result.newRecords.length} records`);
		} else if (this.memoryState) {
			this.commitState(logPath, version, { ...this.memoryState.cached, fileState: result.fileState });
		}

		return {
			fullRescan: result.fullRescan,
			parsedRecords: result.newRecords.length,
			skippedLines: result.skippedLines,
		};
	}

	async getIntermediate(logPath: string): Promise<UsageStatsIntermediate | null> {
		const fileStat = await statLogOrMissing(logPath, this.logger);
		if (!fileStat) return null;

		const version = { mtimeMs: fileStat.mtimeMs, size: fileStat.size };
		let state = await this.loadState(logPath, version);
		if (!state) {
			await this.refresh(logPath);
			state = this.memoryState && versionEqual(this.memoryState.version, version) ? this.memoryState : null;
		}
		return state?.cached.intermediate ?? null;
	}

	private async loadState(logPath: string, version: SessionFileVersion): Promise<MemoryState | null> {
		if (this.memoryState && versionEqual(this.memoryState.version, version)) {
			return this.memoryState;
		}
		await this.cache.ensureLoaded();
		const cached = this.cache.get(logPath, version);
		if (!cached) return null;
		if (cached.schemaVersion !== CACHE_SCHEMA_VERSION) return null;
		this.memoryState = { version, cached };
		return this.memoryState;
	}

	private commitState(logPath: string, version: SessionFileVersion, cached: CachedUsageStats): void {
		this.memoryState = { version, cached };
		this.cache.set(logPath, version, {
			schemaVersion: CACHE_SCHEMA_VERSION,
			fileState: cached.fileState,
			intermediate: cached.intermediate,
		});
	}
}

async function statLogOrMissing(logPath: string, logger?: UsageStatsServiceDeps["logger"]): Promise<{ mtimeMs: number; size: number } | null> {
	try {
		return await stat(logPath);
	} catch (error) {
		if (isMissingFileError(error)) return null;
		logger?.warn?.(`[UsageStats] stat failed: ${String(error)}`);
		throw error;
	}
}

export class UsageStatsService {
	private agentDir: string;
	private readonly piSource: UsageLogSource;

	private refreshPromise: Promise<UsageStatsRefreshResult> | null = null;

	constructor(deps: UsageStatsServiceDeps) {
		this.agentDir = deps.agentDir;
		this.logger = deps.logger;

		const cache = new SessionSummaryCache<CachedUsageStats>("usage-stats-cache.json", deps.userDataDir);
		this.piSource = new UsageLogSource("pi", new UsageLogReader(), cache, deps.logger);
	}

	private readonly logger?: UsageStatsServiceDeps["logger"];

	private get piLogPath(): string {
		return join(this.agentDir, "analytics", "usage.jsonl");
	}

	setAgentDir(agentDir: string): void {
		if (agentDir === this.agentDir) return;
		this.agentDir = agentDir;
		this.piSource.clearMemory();
	}

	async detect(): Promise<UsageStatsDetectResult> {
		const piPath = this.piLogPath;
		const pi = await this.piSource.detect(piPath);
		return {
			installed: pi.present,
			piInstalled: pi.present,
			logPath: pi.present ? piPath : null,
			recordCount: pi.recordCount,
			firstRecordAt: pi.firstRecordAt,
			lastRecordAt: pi.lastRecordAt,
		};
	}

	private async doRefresh(): Promise<UsageStatsRefreshResult> {
		return this.piSource.refresh(this.piLogPath);
	}

	async refresh(): Promise<UsageStatsRefreshResult> {
		if (this.refreshPromise) return this.refreshPromise;
		this.refreshPromise = this.doRefresh().finally(() => {
			this.refreshPromise = null;
		});
		return this.refreshPromise;
	}

	async getAggregated(): Promise<UsageAggregated | null> {
		const pi = await this.piSource.getIntermediate(this.piLogPath);
		return pi ? buildAggregatedView(pi) : null;
	}
}
