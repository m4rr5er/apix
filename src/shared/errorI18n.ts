import type { I18nDescriptor } from "./types/session";

export function descriptorFromThrownError(error: unknown, debugDetailsFallback?: string): I18nDescriptor | undefined {
	if (!error || typeof error !== "object") return undefined;
	const descriptor = error as I18nDescriptor & { message?: unknown };
	if (typeof descriptor.i18nKey !== "string" || !descriptor.i18nKey.trim()) return undefined;
	const debugDetails = typeof descriptor.debugDetails === "string" && descriptor.debugDetails ? descriptor.debugDetails : typeof descriptor.message === "string" ? descriptor.message : debugDetailsFallback;
	return {
		i18nKey: descriptor.i18nKey,
		...(descriptor.i18nParams ? { i18nParams: descriptor.i18nParams } : {}),
		...(debugDetails ? { debugDetails } : {}),
	};
}
