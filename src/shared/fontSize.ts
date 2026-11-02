import type { AppFontSizeMode } from "./types/settings";

export const APP_FONT_SIZE_MODES: readonly AppFontSizeMode[] = ["compact", "medium", "large", "xlarge"];

export const DEFAULT_APP_FONT_SIZE_MODE: AppFontSizeMode = "medium";

export function normalizeFontSizeMode(value: unknown, fallback: AppFontSizeMode = DEFAULT_APP_FONT_SIZE_MODE): AppFontSizeMode {
	if (typeof value !== "string") return fallback;
	return APP_FONT_SIZE_MODES.find((mode) => mode === value) ?? fallback;
}

export function normalizeOptionalFontSizeMode(value: unknown, fallback: AppFontSizeMode = DEFAULT_APP_FONT_SIZE_MODE): AppFontSizeMode | null {
	if (value === null || value === undefined) return null;
	return normalizeFontSizeMode(value, fallback);
}
