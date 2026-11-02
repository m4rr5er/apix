import type { UsageProbeBackend, UsageProbeProviderState } from "../../../shared/types/providerUsage";

export type ProviderUsageWarmupTarget = {
	provider: string;
	backend: UsageProbeBackend;
};

export const PROVIDER_USAGE_WARMUP_GAP_MS = 300;

export function selectWarmupProviders(states: Record<string, UsageProbeProviderState>): ProviderUsageWarmupTarget[] {
	const targets: ProviderUsageWarmupTarget[] = [];
	for (const [cacheKey, state] of Object.entries(states)) {
		if (!state?.enabled) continue;
		targets.push({ provider: cacheKey, backend: "pi" });
	}
	return targets.sort((a, b) => {
		return a.provider.localeCompare(b.provider);
	});
}

export function warmupDelayMs(index: number, gapMs: number = PROVIDER_USAGE_WARMUP_GAP_MS): number {
	if (!Number.isFinite(index) || index <= 0) return 0;
	return Math.round(index * Math.max(0, gapMs));
}
