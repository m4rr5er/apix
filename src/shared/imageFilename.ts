export function imageFileExtension(mimeType: string): string {
	const normalized = mimeType.toLowerCase();
	if (normalized.includes("jpeg") || normalized.includes("jpg")) return "jpg";
	if (normalized.includes("webp")) return "webp";
	if (normalized.includes("gif")) return "gif";
	if (normalized.includes("svg")) return "svg";
	if (normalized.includes("avif")) return "avif";
	if (normalized.includes("bmp")) return "bmp";
	return "png";
}

export function imageDownloadName(base: string, mimeType: string, fallback = "pideck-image"): string {
	const cleaned = base
		.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "")
		.trim()
		// 原名已带图片后缀时先剥掉，避免存成 `a.jpg.jpg`
		.replace(/\.(?:png|jpe?g|webp|gif|svg|avif|bmp)$/i, "")
		.slice(0, 40);
	return `${cleaned || fallback}.${imageFileExtension(mimeType)}`;
}
