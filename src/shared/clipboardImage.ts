export function parseClipboardImageDataUrl(dataUrl: string): { mimeType: string; base64: string } | null {
	if (typeof dataUrl !== "string") return null;
	const match = /^data:(image\/[a-zA-Z0-9.+-]+)(?:;[^,]*)?;base64,(.+)$/s.exec(dataUrl.trim());
	if (!match) return null;
	return { mimeType: match[1], base64: match[2] };
}
