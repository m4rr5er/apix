import type { AvailableModel } from "../../../shared/types";

export type CycleDirection = "forward" | "backward";

export function modelKey(provider: string, id: string): string {
	return `${provider}/${id}`;
}

export function resolveFavoriteCycleCandidates(input: { favorites: readonly string[]; models: readonly AvailableModel[]; hiddenProviders?: readonly string[]; hiddenModels?: readonly string[]; backend?: "pi" }): AvailableModel[] {
	const hidden = new Set(input.hiddenProviders ?? []);
	const hiddenModels = new Set(input.hiddenModels ?? []);
	const byKey = new Map<string, AvailableModel>();
	for (const model of input.models) {
		if (!model?.provider || !model.id) continue;
		if (hidden.has(model.provider)) continue;
		const key = modelKey(model.provider, model.id);

		if (hiddenModels.has(key)) continue;
		if (!byKey.has(key)) byKey.set(key, model);
	}

	const seen = new Set<string>();
	const candidates: AvailableModel[] = [];
	for (const favorite of input.favorites) {
		const key = typeof favorite === "string" ? favorite.trim() : "";
		if (!key || seen.has(key)) continue;
		const model = byKey.get(key);
		if (!model) continue;
		seen.add(key);
		candidates.push(model);
	}
	return candidates;
}

export function pickCycleTarget<T>(items: readonly T[], currentIndex: number, direction: CycleDirection = "forward"): T | undefined {
	if (items.length <= 1) return undefined;
	if (currentIndex < 0) return direction === "forward" ? items[0] : items[items.length - 1];
	const offset = direction === "forward" ? 1 : -1;
	return items[(currentIndex + offset + items.length) % items.length];
}

export function indexOfModelKey(candidates: readonly AvailableModel[], currentKey: string | undefined): number {
	if (!currentKey) return -1;
	return candidates.findIndex((model) => modelKey(model.provider, model.id) === currentKey);
}

export function pickCycleModel(input: { candidates: readonly AvailableModel[]; currentKey?: string; direction?: CycleDirection }): AvailableModel | undefined {
	return pickCycleTarget(input.candidates, indexOfModelKey(input.candidates, input.currentKey), input.direction);
}

export function pickCycleThinkingLevel(input: { levels: readonly { value: string }[]; current?: string; direction?: CycleDirection }): string | undefined {
	const values = input.levels.map((level) => level.value).filter((value): value is string => !!value);
	const currentIndex = input.current ? values.indexOf(input.current) : -1;
	return pickCycleTarget(values, currentIndex, input.direction);
}
