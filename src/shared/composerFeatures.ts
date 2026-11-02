import { normalizeHiddenModules } from "./hiddenModules";

export const HIDEABLE_COMPOSER_FEATURE_IDS = ["security", "quickMessages", "gitBranch", "enhance", "voice"] as const;

export type HideableComposerFeatureId = (typeof HIDEABLE_COMPOSER_FEATURE_IDS)[number];

export const normalizeHiddenComposerFeatures = normalizeHiddenModules;

export function isComposerFeatureHidden(hiddenFeatures: readonly string[], featureId: HideableComposerFeatureId): boolean {
	return hiddenFeatures.includes(featureId);
}

export function toggleHiddenComposerFeature(hiddenFeatures: readonly string[], featureId: HideableComposerFeatureId, hidden: boolean): string[] {
	const without = hiddenFeatures.filter((id) => id !== featureId);
	return hidden ? [...without, featureId] : without;
}
