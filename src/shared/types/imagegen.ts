import type { ImageContent } from "./session";
import type { ImageGenConfigFile } from "../imageGenConfig";

export type { ImageGenConfigFile, ImageGenProviderConfig, ImageGenProviderExtraParams } from "../imageGenConfig";

export type ImageGenRequest = {
	provider: string;

	model: string;

	prompt: string;

	sessionId?: string;

	size?: string;

	watermark?: boolean;

	outputFormat?: string;

	referenceImages?: ImageContent[];
};

export type ImageGenErrorCode = "notConfigured" | "invalidKey" | "badBaseUrl" | "network" | "http" | "responseTooLarge" | "empty" | "referenceUnsupported";

export type ImageGenResult = { ok: true; image: ImageContent } | { ok: false; error: ImageGenErrorCode; detail?: string };

export type ImageGenMeta = {
	status: "generating" | "complete" | "error";

	prompt: string;

	size?: string;

	errorDetail?: string;
};

export type ImageGenSaveResult = { ok: true; config: ImageGenConfigFile } | { ok: false; error: string };

export type ImageBlobPayload = {
	data: string;
	mimeType: string;
};
