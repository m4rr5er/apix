import type { AppFontBaseMode, AppFontSizeMode } from "./types/settings";

export const PET_BASE_W = 192;

export const PET_BASE_H = 208;

export const NOTIFICATION_FONT_SIZE_PX: Record<AppFontSizeMode, number> = {
	compact: 12,
	medium: 14,
	large: 15,
	xlarge: 16,
};

export const NOTIFICATION_PAD_X = 12;

export const NOTIFICATION_PAD_Y = 8;

export const NOTIFICATION_STROKE = 1.5;

export const NOTIFICATION_GAP = 6;

export const NOTIFICATION_MAX_LINES = 2;

export const NOTIFICATION_MAX_WIDTH = 240;

export const NOTIFICATION_DURATION_MS = 4000;

export function effectiveUIFontSize(uiFontSize: AppFontSizeMode | null | undefined, fontSize: AppFontSizeMode): AppFontSizeMode {
	return uiFontSize ?? fontSize;
}

export type PetLayout = {
	scale: number;
	fontMode: AppFontSizeMode;

	fontSizePx: number;
	spriteW: number;
	spriteH: number;
	notificationVisible: boolean;

	notificationSlotW: number;

	notificationSlotH: number;

	windowW: number;

	windowH: number;
	bubbleMaxWidth: number;
};

export function petLayout(args: { scale: number; fontMode: AppFontSizeMode; notificationVisible: boolean }): PetLayout {
	const scale = Math.max(0.1, Number.isFinite(args.scale) ? args.scale : 1);
	const fontMode = args.fontMode;
	const fontSizePx = NOTIFICATION_FONT_SIZE_PX[fontMode];
	const spriteW = Math.round(PET_BASE_W * scale);
	const spriteH = Math.round(PET_BASE_H * scale);
	const bubbleMaxWidth = NOTIFICATION_MAX_WIDTH;
	const notificationSlotW = Math.round(bubbleMaxWidth + NOTIFICATION_PAD_X * 2 + NOTIFICATION_STROKE * 2);
	const notificationSlotH = Math.round(fontSizePx * 1.5 * NOTIFICATION_MAX_LINES + NOTIFICATION_PAD_Y * 2 + NOTIFICATION_STROKE * 2);
	const notificationVisible = args.notificationVisible;
	const windowW = notificationVisible ? Math.max(spriteW, notificationSlotW) : spriteW;
	const windowH = notificationVisible ? spriteH + NOTIFICATION_GAP + notificationSlotH : spriteH;
	return {
		scale,
		fontMode,
		fontSizePx,
		spriteW,
		spriteH,
		notificationVisible,
		notificationSlotW,
		notificationSlotH,
		windowW,
		windowH,
		bubbleMaxWidth,
	};
}

export type Size2D = { width: number; height: number };
export type WorkArea = { x: number; y: number; width: number; height: number };
export type Pos2D = { x: number; y: number };

export function keepFeetCenter(from: { x: number; y: number; width: number; height: number }, to: Size2D): Pos2D {
	const feetX = from.x + from.width / 2;
	const feetY = from.y + from.height;
	return {
		x: Math.round(feetX - to.width / 2),
		y: Math.round(feetY - to.height),
	};
}

export function toNormalLayoutPosition(pos: Pos2D, currentSize: Size2D, normalSize: Size2D): Pos2D {
	const feetX = pos.x + currentSize.width / 2;
	const feetY = pos.y + currentSize.height;
	return {
		x: Math.round(feetX - normalSize.width / 2),
		y: Math.round(feetY - normalSize.height),
	};
}

export function clampToWorkArea(rect: { x: number; y: number; width: number; height: number }, wa: WorkArea): Pos2D {
	const maxX = wa.x + wa.width - rect.width;
	const maxY = wa.y + wa.height - rect.height;
	return {
		x: Math.round(Math.min(maxX, Math.max(wa.x, rect.x))),
		y: Math.round(Math.min(maxY, Math.max(wa.y, rect.y))),
	};
}

export const DEFAULT_PET_FONT_STACK = '-apple-system, BlinkMacSystemFont, "Segoe UI Variable Text", "Segoe UI", "Microsoft YaHei UI", "Microsoft YaHei", "PingFang SC", "HarmonyOS Sans SC", "Hiragino Sans GB", "Noto Sans CJK SC", sans-serif';

export function petFontStack(fontBase: AppFontBaseMode, customFont: string): string {
	switch (fontBase) {
		case "sans":
			return '"Inter", "Segoe UI Variable Text", "Segoe UI", "Microsoft YaHei UI", "Microsoft YaHei", "PingFang SC", "HarmonyOS Sans SC", "Hiragino Sans GB", "Noto Sans CJK SC", sans-serif';
		case "serif":
			return 'Georgia, "Source Han Serif SC", "Noto Serif CJK SC", "Songti SC", "SimSun", serif';
		case "custom": {
			const font = customFont.trim();
			return font ? `${font}, "Microsoft YaHei UI", "Microsoft YaHei", "PingFang SC", "HarmonyOS Sans SC", "Hiragino Sans GB", "Noto Sans CJK SC", sans-serif` : DEFAULT_PET_FONT_STACK;
		}
		default:
			return DEFAULT_PET_FONT_STACK;
	}
}

export function wrapTextByMeasure(measure: (text: string) => number, text: string, maxW: number): string[] {
	if (maxW <= 0 || measure(text) <= maxW) return [text];
	const lines: string[] = [];
	const words = text.split(" ");
	let cur = "";
	for (const word of words) {
		const trial = cur ? cur + " " + word : word;
		if (measure(trial) <= maxW) {
			cur = trial;
			continue;
		}
		if (cur) {
			lines.push(cur);
			cur = "";
		}
		if (measure(word) <= maxW) {
			cur = word;
			continue;
		}
		let chunk = "";
		for (const ch of word) {
			if (measure(chunk + ch) > maxW && chunk) {
				lines.push(chunk);
				chunk = ch;
			} else chunk += ch;
		}
		cur = chunk;
	}
	if (cur) lines.push(cur);
	return lines;
}

export function clipLinesByMeasure(measure: (text: string) => number, text: string, maxW: number, maxLines: number): string[] {
	const lines = wrapTextByMeasure(measure, text, maxW);
	if (lines.length <= maxLines) return lines;
	const out = lines.slice(0, maxLines);
	let last = out[maxLines - 1];
	while (last.length > 0 && measure(last + "…") > maxW) last = last.slice(0, -1);
	out[maxLines - 1] = last + "…";
	return out;
}

export type NotificationSegment = { text: string; kind: "title" | "status" };

export function layoutNotificationSegments(measure: (text: string) => number, title: string, status: string, maxW: number, maxLines: number): NotificationSegment[][] {
	const statusWithGap = "  " + status;

	if (!title.trim()) {
		return [[{ text: status, kind: "status" }]];
	}
	const statusW = measure(statusWithGap);

	if (statusW > maxW) {
		const titleLines = clipLinesByMeasure(measure, title, maxW, Math.max(1, maxLines - 1));
		const rows: NotificationSegment[][] = titleLines.map((t) => [{ text: t, kind: "title" as const }]);
		rows.push([{ text: status, kind: "status" as const }]);
		return rows;
	}
	const titleMaxW = maxW - statusW;
	const titleLines = clipLinesByMeasure(measure, title, titleMaxW, maxLines);
	const rows: NotificationSegment[][] = titleLines.map((t) => [{ text: t, kind: "title" as const }]);
	rows[rows.length - 1].push({ text: statusWithGap, kind: "status" });
	return rows;
}
