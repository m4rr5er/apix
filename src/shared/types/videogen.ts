import type { VideoGenConfigFile } from "../videoGenConfig";

export type { VideoGenConfigFile, VideoGenProviderConfig, VideoGenProtocolFamily } from "../videoGenConfig";

export type VideoGenRequest = {
	provider: string;

	model: string;

	prompt: string;

	messageId?: string;

	sessionId?: string;

	resolution?: string;

	duration?: string;

	ratio?: string;
};

export type VideoGenSubmitResult = { ok: true; jobId: string; messageId: string } | { ok: false; error: VideoGenErrorCode; detail?: string };

export type VideoGenErrorCode = "notConfigured" | "invalidKey" | "badBaseUrl" | "network" | "http" | "empty" | "timeout" | "downloadFailed" | "generationFailed" | "cancelled";

export type VideoGenJobStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled" | "timeout";

export type VideoGenJobSnapshot = {
	jobId: string;
	sessionId: string;
	provider: string;
	providerName: string;
	model: string;
	prompt: string;
	resolution?: string;
	duration?: string;
	ratio?: string;
	status: VideoGenJobStatus;

	videoRef?: string;

	errorDetail?: string;

	createdAt: number;

	finishedAt?: number;

	messageId: string;
};

export type VideoGenMeta = {
	status: "queued" | "generating" | "complete" | "error";

	prompt: string;

	jobId?: string;

	resolution?: string;

	duration?: string;

	ratio?: string;

	errorDetail?: string;

	videoRef?: string;
};

export type VideoGenSaveResult = { ok: true; config: VideoGenConfigFile } | { ok: false; error: string };

export type VideoContent = {
	type: "video";

	ref: string;
	mimeType: string;

	seconds?: number;
};
