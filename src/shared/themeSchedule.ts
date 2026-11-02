export const DEFAULT_THEME_SCHEDULE_LIGHT_START = "07:00";
export const DEFAULT_THEME_SCHEDULE_DARK_START = "19:00";

const TIME_PATTERN = /^(\d{1,2}):(\d{2})(?::\d{2})?$/;

export function parseClockToMinutes(value: string | undefined): number | undefined {
	if (typeof value !== "string") return undefined;
	const match = TIME_PATTERN.exec(value.trim());
	if (!match) return undefined;
	const hours = Number(match[1]);
	const minutes = Number(match[2]);
	if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return undefined;
	if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return undefined;
	return hours * 60 + minutes;
}

export function normalizeClockTime(value: string | undefined, fallback: string): string {
	const minutes = parseClockToMinutes(value);
	if (minutes === undefined) return fallback;
	const hours = Math.floor(minutes / 60);
	const mins = minutes % 60;
	return `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}`;
}

export function normalizeThemeSchedule(input: { lightStart?: string; darkStart?: string }): { lightStart: string; darkStart: string } {
	return {
		lightStart: normalizeClockTime(input.lightStart, DEFAULT_THEME_SCHEDULE_LIGHT_START),
		darkStart: normalizeClockTime(input.darkStart, DEFAULT_THEME_SCHEDULE_DARK_START),
	};
}

function minutesOfDay(date: Date): number {
	return date.getHours() * 60 + date.getMinutes();
}

export function isLightScheduleWindow(now: Date, lightStart: string, darkStart: string): boolean {
	const schedule = normalizeThemeSchedule({ lightStart, darkStart });
	const light = parseClockToMinutes(schedule.lightStart) ?? 7 * 60;
	const dark = parseClockToMinutes(schedule.darkStart) ?? 19 * 60;
	if (light === dark) return false;
	const current = minutesOfDay(now);
	if (light < dark) return current >= light && current < dark;
	return current >= light || current < dark;
}

export function resolveScheduledTheme(now: Date, lightStart: string, darkStart: string): "light" | "dark" {
	return isLightScheduleWindow(now, lightStart, darkStart) ? "light" : "dark";
}

export type ResolvedAppColorScheme = "light" | "dark";

export function resolveAppColorScheme(input: { theme: string; themeScheduleLightStart?: string; themeScheduleDarkStart?: string; systemPrefersDark?: boolean; now?: Date }): ResolvedAppColorScheme {
	if (input.theme === "light" || input.theme === "dark") return input.theme;
	if (input.theme === "schedule") {
		return resolveScheduledTheme(input.now ?? new Date(), input.themeScheduleLightStart ?? DEFAULT_THEME_SCHEDULE_LIGHT_START, input.themeScheduleDarkStart ?? DEFAULT_THEME_SCHEDULE_DARK_START);
	}
	return input.systemPrefersDark ? "dark" : "light";
}

export function msUntilNextThemeBoundary(now: Date, lightStart: string, darkStart: string): number {
	const schedule = normalizeThemeSchedule({ lightStart, darkStart });
	const light = parseClockToMinutes(schedule.lightStart) ?? 7 * 60;
	const dark = parseClockToMinutes(schedule.darkStart) ?? 19 * 60;
	const current = minutesOfDay(now);
	const secondOffset = now.getSeconds() * 1000 + now.getMilliseconds();
	const candidates = light === dark ? [light] : [light, dark];
	let bestMinutes = 24 * 60;
	for (const boundary of candidates) {
		let delta = boundary - current;
		if (delta < 0 || (delta === 0 && secondOffset > 0)) delta += 24 * 60;
		if (delta === 0) delta = 24 * 60;
		if (delta < bestMinutes) bestMinutes = delta;
	}
	const ms = bestMinutes * 60_000 - secondOffset;
	return Math.max(1_000, ms);
}
