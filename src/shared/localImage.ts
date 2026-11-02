export const LOCAL_IMAGE_PROTOCOL = "pideck-file";

export const LOCAL_IMAGE_MAX_BYTES = 32 * 1024 * 1024;

const IMAGE_MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
	png: "image/png",
	jpg: "image/jpeg",
	jpeg: "image/jpeg",
	gif: "image/gif",
	webp: "image/webp",
	bmp: "image/bmp",
	svg: "image/svg+xml",
	avif: "image/avif",
};

function extensionOf(path: string): string {
	const leaf = path.slice(Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")) + 1);
	const dot = leaf.lastIndexOf(".");
	return dot < 0 ? "" : leaf.slice(dot + 1).toLowerCase();
}

export function localImageMimeType(path: string): string | null {
	return IMAGE_MIME_BY_EXTENSION[extensionOf(path)] ?? null;
}

export function isLocalImageExtension(path: string): boolean {
	return localImageMimeType(path) !== null;
}

export type LocalImageBytes = { data: string; mimeType: string };

export function localImageUrl(absolutePath: string): string {
	return `${LOCAL_IMAGE_PROTOCOL}://local/?path=${encodeURIComponent(absolutePath)}`;
}

export function parseLocalImageUrl(url: string): string | null {
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		return null;
	}
	if (parsed.protocol !== `${LOCAL_IMAGE_PROTOCOL}:` || parsed.hostname !== "local") return null;
	const requested = parsed.searchParams.get("path");
	return requested === null || requested === "" ? null : requested;
}
