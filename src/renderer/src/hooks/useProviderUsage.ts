import { useCallback, useEffect, useRef } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import type { ProviderUsageResult, UsageProbeBackend, UsageProbeProviderState, UsageProbeStatesResult } from "../../../shared/types/providerUsage";
import { desktopApi } from "../desktopApi";
import {
	beginProviderUsageAtom,
	markProviderUsageStatesStatusAtom,
	mergeProviderUsageStatesAtom,
	providerUsageEntryAtomFamily,
	providerUsageRecordsReadAtom,
	providerUsageStateAtomFamily,
	providerUsageStatesReadAtom,
	providerUsageStatesStatusAtom,
	resolveProviderUsageAtom,
	type ProviderUsageEntry,
} from "../atoms/provider-usage-atoms";
import { USAGE_PROBE_DEFAULT_INTERVAL_MINUTES, shouldAutoFetchProviderUsage } from "./providerUsageAutoQuery";
import { selectWarmupProviders, warmupDelayMs } from "./providerUsageWarmup";

export {
	USAGE_PROBE_DEFAULT_INTERVAL_MINUTES,
	providerUsageEntryStale,
} from "./providerUsageAutoQuery";

export function usageCacheKey(provider: string, _backend: UsageProbeBackend): string {
	return provider;
}

const inFlight = new Map<string, Promise<void>>();

function startFetch(provider: string, cacheKey: string, resolve: (key: string, result: ProviderUsageResult) => void, backend: UsageProbeBackend = "pi"): void {
	if (inFlight.has(cacheKey)) return;
	const promise = desktopApi.config
		.fetchUsage(provider, backend)
		.then((result) => resolve(cacheKey, result))
		.catch(() => {
			resolve(cacheKey, { success: false, error: "fetch failed", at: Date.now() });
		})
		.finally(() => {
			inFlight.delete(cacheKey);
		});
	inFlight.set(cacheKey, promise);
}

export function useProviderUsageState(provider: string | undefined, backend: UsageProbeBackend = "pi"): UsageProbeProviderState | undefined {
	const cacheKey = provider ? usageCacheKey(provider, backend) : "";
	return useAtomValue(providerUsageStateAtomFamily(cacheKey));
}

const statesInFlight = new Map<string, Promise<UsageProbeStatesResult>>();

export function useProviderUsageStatesLoader(providers: string[], backend: UsageProbeBackend = "pi"): void {
	const merge = useSetAtom(mergeProviderUsageStatesAtom);
	const markStatus = useSetAtom(markProviderUsageStatesStatusAtom);

	const providerKey = providers.join("\n");
	useEffect(() => {
		const list: string[] = [];
		const signature = "pi";
		let cancelled = false;
		markStatus(backend, "loading");
		const pending = statesInFlight.get(signature) ?? desktopApi.config.listUsageProbeStates({ providers: list, backend }).catch(() => ({ providers: {}, errors: [] }));
		statesInFlight.set(signature, pending);
		void pending.then((result) => {
			if (!cancelled) markStatus(backend, "ready");
			const entries: Record<string, UsageProbeProviderState> = {};
			for (const [name, state] of Object.entries(result.providers)) {
				entries[usageCacheKey(name, backend)] = state;
			}
			merge(entries);
		});
		return () => {
			cancelled = true;
		};
	}, [providerKey, backend, merge, markStatus]);
}

export function useRefreshProviderUsageState(): (provider: string, backend?: UsageProbeBackend) => Promise<void> {
	const merge = useSetAtom(mergeProviderUsageStatesAtom);
	return useCallback(
		async (provider: string, backend: UsageProbeBackend = "pi") => {
			if (!provider) return;
			const result = await desktopApi.config.listUsageProbeStates({ providers: [provider], backend }).catch(() => ({ providers: {}, errors: [] }));
			const entries: Record<string, UsageProbeProviderState> = {};
			for (const [name, state] of Object.entries(result.providers)) {
				entries[usageCacheKey(name, backend)] = state;
			}
			merge(entries);
		},
		[merge],
	);
}

export function useProviderUsageEntry(provider: string | undefined, backend: UsageProbeBackend = "pi"): ProviderUsageEntry {
	const cacheKey = provider ? usageCacheKey(provider, backend) : undefined;

	useProviderUsageStatesLoader(provider ? [provider] : [], backend);
	const entry = useAtomValue(providerUsageEntryAtomFamily(cacheKey ?? ""));
	const state = useAtomValue(providerUsageStateAtomFamily(cacheKey ?? ""));
	const begin = useSetAtom(beginProviderUsageAtom);
	const resolve = useSetAtom(resolveProviderUsageAtom);

	const queryEnabled = state?.enabled === true;

	const intervalMinutes = entry.result?.intervalMinutes ?? state?.intervalMinutes ?? USAGE_PROBE_DEFAULT_INTERVAL_MINUTES;
	useEffect(() => {
		if (!provider || !cacheKey || !queryEnabled) return;

		if (
			shouldAutoFetchProviderUsage({
				reason: "mount",
				entry,
				intervalMinutes,
			})
		) {
			begin(cacheKey);
			startFetch(provider, cacheKey, resolve, backend);
		}
	}, [provider, cacheKey, entry.fetchedAt, intervalMinutes, queryEnabled, begin, resolve, backend]);

	useEffect(() => {
		if (!provider || !cacheKey || !queryEnabled) return;
		if (
			!shouldAutoFetchProviderUsage({
				reason: "poll",
				entry,
				intervalMinutes,
			})
		) {
			return;
		}
		const timer = window.setTimeout(() => {
			begin(cacheKey);
			startFetch(provider, cacheKey, resolve, backend);
		}, intervalMinutes * 60_000);
		return () => window.clearTimeout(timer);
	}, [provider, cacheKey, intervalMinutes, queryEnabled, begin, resolve, backend]);

	return entry;
}

export function useProviderUsageStartupWarmup(): void {
	useProviderUsageStatesLoader([], "pi");
	const states = useAtomValue(providerUsageStatesReadAtom);
	const status = useAtomValue(providerUsageStatesStatusAtom);
	const refresh = useProviderUsageRefresh();
	const started = useRef(false);
	useEffect(() => {
		if (started.current) return;
		const piStatus = status.pi ?? "idle";
		if (piStatus === "loading") return;
		if (piStatus === "idle") return;
		started.current = true;
		const targets = selectWarmupProviders(states);
		const timers = targets.map((target, index) => window.setTimeout(() => refresh(target.provider, target.backend), warmupDelayMs(index)));
		return () => {
			for (const timer of timers) window.clearTimeout(timer);
		};
	}, [status.pi, states, refresh]);
}

export function useProviderUsageRefresh(): (provider: string, backend?: UsageProbeBackend) => void {
	const begin = useSetAtom(beginProviderUsageAtom);
	const resolve = useSetAtom(resolveProviderUsageAtom);
	return useCallback(
		(provider: string, backend: UsageProbeBackend = "pi") => {
			if (!provider) return;
			const cacheKey = usageCacheKey(provider, backend);
			begin(cacheKey);
			startFetch(provider, cacheKey, resolve, backend);
		},
		[begin, resolve],
	);
}

export function useProviderUsageBatchRefresh(): (providers: string[], backend?: UsageProbeBackend) => void {
	const records = useAtomValue(providerUsageRecordsReadAtom);
	const begin = useSetAtom(beginProviderUsageAtom);
	const resolve = useSetAtom(resolveProviderUsageAtom);
	return useCallback(
		(providers: string[], backend: UsageProbeBackend = "pi") => {
			for (const provider of providers) {
				if (!provider) continue;
				const cacheKey = usageCacheKey(provider, backend);
				const record = records[cacheKey] ?? null;
				const interval = record?.result?.intervalMinutes ?? USAGE_PROBE_DEFAULT_INTERVAL_MINUTES;

				if (
					!shouldAutoFetchProviderUsage({
						reason: "batch",
						entry: record,
						intervalMinutes: interval,
					})
				) {
					continue;
				}
				begin(cacheKey);
				startFetch(provider, cacheKey, resolve, backend);
			}
		},
		[records, begin, resolve],
	);
}
