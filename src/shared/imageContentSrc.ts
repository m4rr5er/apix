import type { ImageBlobPayload } from "./types/imagegen";
import type { ImageContent } from "./types/session";

export const IMAGE_BLOB_PROTOCOL = "pideck-img";

export function imageBlobUrl(ref: string): string {
	return `${IMAGE_BLOB_PROTOCOL}://blob/${encodeURIComponent(ref)}`;
}

export function imageContentSrc(image: Pick<ImageContent, "data" | "mimeType" | "ref"> | null | undefined): string | null {
	if (!image) return null;
	if (image.data) return `data:${image.mimeType};base64,${image.data}`;
	if (image.ref) return imageBlobUrl(image.ref);
	return null;
}

export function hasImageSource(image: Pick<ImageContent, "data" | "ref"> | null | undefined): boolean {
	return Boolean(image && (image.data || image.ref));
}

export type ImageBlobReader = (ref: string) => Promise<ImageBlobPayload | null>;

export async function loadImageBase64(image: Pick<ImageContent, "data" | "mimeType" | "ref"> | null | undefined, readBlob: ImageBlobReader): Promise<ImageBlobPayload | null> {
	if (!image) return null;
	if (image.data) return { data: image.data, mimeType: image.mimeType };
	if (!image.ref) return null;
	try {
		const payload = await readBlob(image.ref);
		if (!payload?.data) return null;
		return { data: payload.data, mimeType: payload.mimeType || image.mimeType };
	} catch {
		return null;
	}
}

export async function hydrateImageContents(images: readonly ImageContent[] | undefined, readBlob: ImageBlobReader): Promise<ImageContent[]> {
	if (!images || images.length === 0) return [];
	const hydrated = await Promise.all(
		images.map(async (image): Promise<ImageContent | null> => {
			const payload = await loadImageBase64(image, readBlob);
			if (!payload) return null;
			return { type: "image", data: payload.data, mimeType: payload.mimeType };
		}),
	);
	return hydrated.filter((image): image is ImageContent => image !== null);
}
