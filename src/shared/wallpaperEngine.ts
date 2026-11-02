export const WALLPAPER_ENGINE_PROTOCOL = "pideck-we";

export const WALLPAPER_ENGINE_ID_RE = /^\d{1,20}$/;

const VIDEO_MIME_BY_EXT: Record<string, string> = {
	mp4: "video/mp4",
	webm: "video/webm",
	m4v: "video/mp4",
};

export interface WallpaperEngineItem {
	id: string;
	title: string;
	type: "video";

	file: string;

	preview: string;
}

export interface WallpaperEngineListResult {
	dir: string;
	items: WallpaperEngineItem[];
	error?: "no-dir" | "unreadable";
}

export function isSafeRelativeFile(file: string): boolean {
	if (!file || file.length > 255) return false;
	if (/^[\\/]/.test(file) || /^[a-zA-Z]:/.test(file) || file.includes("\0")) return false;
	return file.split(/[\\/]/).every((seg) => seg !== "" && seg !== "." && seg !== "..");
}

export function wallpaperEngineVideoMime(file: string): string | null {
	const ext = file.slice(file.lastIndexOf(".") + 1).toLowerCase();
	return VIDEO_MIME_BY_EXT[ext] ?? null;
}

export function parseWallpaperEngineProject(id: string, raw: string): WallpaperEngineItem | null {
	if (!WALLPAPER_ENGINE_ID_RE.test(id)) return null;
	let data: unknown;
	try {
		data = JSON.parse(stripWallpaperEngineJsonNoise(raw));
	} catch {
		return null;
	}
	if (!data || typeof data !== "object") return null;
	const obj = data as Record<string, unknown>;
	const type = typeof obj.type === "string" ? obj.type.toLowerCase() : "";
	if (type !== "video") return null;
	const file = typeof obj.file === "string" ? obj.file : "";
	if (!isSafeRelativeFile(file) || !wallpaperEngineVideoMime(file)) return null;
	const previewRaw = typeof obj.preview === "string" ? obj.preview : "";
	const preview = isSafeRelativeFile(previewRaw) ? previewRaw : "";
	const title = typeof obj.title === "string" && obj.title.trim() ? obj.title.trim().slice(0, 200) : id;
	return { id, title, type: "video", file, preview };
}

export function wallpaperEngineVideoUrl(id: string): string {
	return WALLPAPER_ENGINE_ID_RE.test(id) ? `${WALLPAPER_ENGINE_PROTOCOL}://video/${id}` : "";
}

export function wallpaperEnginePreviewUrl(id: string): string {
	return WALLPAPER_ENGINE_ID_RE.test(id) ? `${WALLPAPER_ENGINE_PROTOCOL}://preview/${id}` : "";
}

export function parseByteRange(header: string | null, size: number): { start: number; end: number } | null {
	if (!header || size <= 0) return null;
	const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
	if (!m) return null;
	const [, s, e] = m;
	if (s === "" && e === "") return null;
	if (s === "") {
		const n = Number(e);
		if (!Number.isFinite(n) || n <= 0) return null;
		return { start: Math.max(0, size - n), end: size - 1 };
	}
	const start = Number(s);
	const end = e === "" ? size - 1 : Number(e);
	if (!Number.isFinite(start) || start >= size || !Number.isFinite(end) || end < start) return null;
	return { start, end: Math.min(end, size - 1) };
}

export function stripWallpaperEngineJsonNoise(raw: string): string {
	return raw.replace(/^\uFEFF/, "").replace(/[\0\s]+$/, "");
}

export const WALLPAPER_ENGINE_APP_ID = "431960";
export function wallpaperEngineDirCandidates(picked: string, join: (...parts: string[]) => string): string[] {
	if (!picked) return [];
	const id = WALLPAPER_ENGINE_APP_ID;
	return [join(picked, "steamapps", "workshop", "content", id), join(picked, "workshop", "content", id), join(picked, "content", id), join(picked, id), picked];
}

export type WallpaperEnginePlayability = "probably" | "maybe" | "unsupported";

export function wallpaperEnginePlayability(file: string, canPlayType: (mime: string) => string): WallpaperEnginePlayability {
	const mime = wallpaperEngineVideoMime(file);
	if (!mime) return "unsupported";
	const answer = canPlayType(mime);
	return answer === "probably" ? "probably" : answer === "maybe" ? "maybe" : "unsupported";
}
