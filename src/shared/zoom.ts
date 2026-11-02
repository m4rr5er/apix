export const ZOOM_FACTOR_MIN = 0.8;

export const ZOOM_FACTOR_MAX = 1.5;

export const ZOOM_FACTOR_STEP = 0.05;

export function clampZoomFactor(value: number): number {
	const safe = Number.isFinite(value) ? value : 1;
	return Math.min(ZOOM_FACTOR_MAX, Math.max(ZOOM_FACTOR_MIN, Math.round(safe * 100) / 100));
}

export function nextZoomFactor(current: number, direction: "in" | "out"): number {
	const safe = Number.isFinite(current) ? current : 1;
	return clampZoomFactor(safe + (direction === "in" ? ZOOM_FACTOR_STEP : -ZOOM_FACTOR_STEP));
}
