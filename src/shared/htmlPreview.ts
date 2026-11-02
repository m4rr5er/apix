export const HTML_PREVIEW_SCHEME = "pideck-html";
export const HTML_PREVIEW_HOST = "preview";

export const MAX_HTML_PREVIEW_CHARS = 1_500_000;

export const MAX_HTML_PREVIEW_URL_CHARS = 1_500_000;

export const HTML_PREVIEW_CSP = [
	"default-src 'none'",
	"script-src 'unsafe-inline' 'unsafe-eval' data: blob:",
	"style-src 'unsafe-inline' data:",
	"img-src data: blob: pideck-file: pideck-img:",
	"font-src data:",
	"media-src data: blob: pideck-sound:",
	"connect-src 'none'",
	"frame-src 'none'",
	"form-action 'none'",
	"base-uri 'none'",
].join("; ");

function toBase64Url(value: string): string {
	const bytes = new TextEncoder().encode(value);
	let binary = "";

	const CHUNK_SIZE = 0x8000;
	for (let index = 0; index < bytes.length; index += CHUNK_SIZE) {
		binary += String.fromCharCode(...bytes.subarray(index, index + CHUNK_SIZE));
	}
	return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(value: string): string {
	const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
	const binary = atob(base64);
	const bytes = new Uint8Array(binary.length);
	for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
	return new TextDecoder().decode(bytes);
}

export function encodeHtmlPreviewUrl(content: string): string | null {
	if (!content || content.length > MAX_HTML_PREVIEW_CHARS) return null;
	const encoded = toBase64Url(content);

	if (encoded.length > MAX_HTML_PREVIEW_URL_CHARS) return null;
	return `${HTML_PREVIEW_SCHEME}://${HTML_PREVIEW_HOST}/${encoded}`;
}

export function decodeHtmlPreviewUrl(url: string): string | null {
	try {
		const parsed = new URL(url);
		if (parsed.protocol !== `${HTML_PREVIEW_SCHEME}:` || parsed.hostname !== HTML_PREVIEW_HOST) return null;
		const encoded = parsed.pathname.replace(/^\/+/, "");
		if (!encoded) return null;
		return fromBase64Url(encoded);
	} catch {
		return null;
	}
}
