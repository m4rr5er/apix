import type { ImageGenApiStyle, ImageGenProviderExtraParams } from "./imageGenConfig";
import { DEFAULT_IMAGE_GEN_EXTRA_PARAMS } from "./imageGenConfig";
import type { ImageContent } from "./types/session";

export const IMAGE_GEN_SIZE_PRESETS = ["1024x1024", "1024x1536", "1536x1024", "1024x1792", "1792x1024", "2048x2048", "1K", "2K", "4K"] as const;

export type ImageGenSizePreset = (typeof IMAGE_GEN_SIZE_PRESETS)[number];

export const IMAGE_GEN_SIZE_UNSET = "unset";

export const DEFAULT_IMAGE_GEN_SIZE = IMAGE_GEN_SIZE_UNSET;

export const DEFAULT_IMAGE_GEN_WATERMARK = false;

export const IMAGE_GEN_OUTPUT_FORMATS = ["png", "jpeg"] as const;
export type ImageGenOutputFormat = (typeof IMAGE_GEN_OUTPUT_FORMATS)[number];

export const DEFAULT_IMAGE_GEN_OUTPUT_FORMAT: ImageGenOutputFormat = "png";

const PIXEL_SIZE_RE = /^\d{2,5}x\d{2,5}$/;
const VOLC_SCALE_RE = /^[1-4]K$/i;

export function parseImageGenSize(value: unknown): string | null {
	if (typeof value !== "string") return null;
	const trimmed = value.trim();
	if (!trimmed || trimmed.toLowerCase() === IMAGE_GEN_SIZE_UNSET) return IMAGE_GEN_SIZE_UNSET;
	if (trimmed.length > 16) return null;
	if (VOLC_SCALE_RE.test(trimmed)) return trimmed.toUpperCase();
	if (PIXEL_SIZE_RE.test(trimmed)) return trimmed;
	return null;
}

export function resolveImageGenApiSize(value: unknown): string | undefined {
	const parsed = parseImageGenSize(value);
	if (!parsed || parsed === IMAGE_GEN_SIZE_UNSET) return undefined;
	return parsed;
}

export function parseImageGenWatermark(value: unknown, fallback = DEFAULT_IMAGE_GEN_WATERMARK): boolean {
	return typeof value === "boolean" ? value : fallback;
}

export function parseImageGenOutputFormat(value: unknown, fallback: ImageGenOutputFormat | null = DEFAULT_IMAGE_GEN_OUTPUT_FORMAT): ImageGenOutputFormat | null {
	if (typeof value !== "string") return fallback;
	const normalized = value.trim().toLowerCase();
	const jpg = normalized === "jpg" ? "jpeg" : normalized;
	if ((IMAGE_GEN_OUTPUT_FORMATS as readonly string[]).includes(jpg)) {
		return jpg as ImageGenOutputFormat;
	}
	return fallback;
}

export function imageGenOutputMimeType(format: ImageGenOutputFormat | null | undefined): string {
	return format === "jpeg" ? "image/jpeg" : "image/png";
}

export const IMAGE_GEN_REFERENCE_LIMIT = 4;

export const IMAGE_GEN_REFERENCE_MAX_BASE64 = 11_000_000;
const REFERENCE_MIME_RE = /^image\/(png|jpeg|webp)$/;

export function parseImageGenReferenceImages(value: unknown): ImageContent[] | null {
	if (!Array.isArray(value)) return null;
	if (value.length > IMAGE_GEN_REFERENCE_LIMIT) return null;
	const images: ImageContent[] = [];
	for (const item of value) {
		if (typeof item !== "object" || item === null) return null;

		const type = Reflect.get(item, "type");
		const data = Reflect.get(item, "data");
		const mimeType = Reflect.get(item, "mimeType");
		if (type !== "image") return null;
		if (typeof data !== "string" || typeof mimeType !== "string") return null;
		if (!REFERENCE_MIME_RE.test(mimeType)) return null;
		if (!data || data.length > IMAGE_GEN_REFERENCE_MAX_BASE64) return null;
		images.push({ type: "image", data, mimeType });
	}
	return images;
}

export function buildImageGenImageField(images: Array<{ data: string; mimeType: string }>): string[] {
	return images.map((image) => `data:${image.mimeType};base64,${image.data}`);
}

export function buildImageGenEditsForm(input: { model: string; prompt: string; images: Array<{ data: string; mimeType: string }>; extraParams?: Partial<ImageGenProviderExtraParams> | null; size?: string }): FormData {
	const form = new FormData();
	form.append("model", input.model.trim());
	form.append("prompt", input.prompt);
	form.append("n", "1");
	for (const image of input.images) {
		const bytes = Uint8Array.from(atob(image.data), (ch) => ch.charCodeAt(0));
		form.append("image[]", new Blob([bytes], { type: image.mimeType }), "reference.png");
	}
	const extra = resolveExtraParams(input.extraParams ?? DEFAULT_IMAGE_GEN_EXTRA_PARAMS);
	if (extra.size) {
		const size = resolveImageGenApiSize(input.size);
		if (size) form.append("size", size);
	}
	return form;
}

function resolveExtraParams(extraParams?: Partial<ImageGenProviderExtraParams> | null): ImageGenProviderExtraParams {
	return {
		size: extraParams?.size === true,
		output_format: extraParams?.output_format === true,
		watermark: extraParams?.watermark === true,
	};
}

export function buildImageGenApiBody(input: { model: string; prompt: string; extraParams?: Partial<ImageGenProviderExtraParams> | null; size?: string; watermark?: boolean; outputFormat?: string; apiStyle?: ImageGenApiStyle; referenceImages?: Array<{ data: string; mimeType: string }> }): Record<string, unknown> {
	if ((input.apiStyle ?? "openai") === "siliconflow") {
		return buildSiliconFlowApiBody(input);
	}
	const body: Record<string, unknown> = {
		model: input.model.trim(),
		prompt: input.prompt,
		n: 1,

		response_format: "b64_json",
	};
	const extra = resolveExtraParams(input.extraParams ?? DEFAULT_IMAGE_GEN_EXTRA_PARAMS);

	if (extra.size) {
		const size = resolveImageGenApiSize(input.size);
		if (size) body.size = size;
	}
	if (extra.watermark && typeof input.watermark === "boolean") {
		body.watermark = input.watermark;
	}
	if (extra.output_format) {
		const outputFormat = parseImageGenOutputFormat(input.outputFormat, null);
		if (outputFormat) body.output_format = outputFormat;
	}

	if (input.referenceImages && input.referenceImages.length > 0) {
		body.image = buildImageGenImageField(input.referenceImages);
	}
	return body;
}

function buildSiliconFlowApiBody(input: { model: string; prompt: string; extraParams?: Partial<ImageGenProviderExtraParams> | null; size?: string; referenceImages?: Array<{ data: string; mimeType: string }> }): Record<string, unknown> {
	const body: Record<string, unknown> = {
		model: input.model.trim(),
		prompt: input.prompt,
	};
	const extra = resolveExtraParams(input.extraParams ?? DEFAULT_IMAGE_GEN_EXTRA_PARAMS);
	if (extra.size) {
		const size = resolveImageGenApiSize(input.size);
		if (size) body.image_size = size;
	}
	const first = input.referenceImages?.[0];
	if (first) {
		body.image = `data:${first.mimeType};base64,${first.data}`;
	}
	return body;
}
