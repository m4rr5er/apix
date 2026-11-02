import type { VoiceTranscriptionCloudProvider, VoiceTranscriptionEngine } from "../voiceTranscriptionConfig";
import type { WhisperModelId } from "./whisperRuntime";

export type VoiceTranscriptionPublicConfig = {
	enabled: boolean;
	engine: VoiceTranscriptionEngine;

	cloudProvider: VoiceTranscriptionCloudProvider;
	baseUrl: string;
	model: string;
	language: string;
	inputDeviceId: string;
	localModelId: WhisperModelId;
	cliPath: string;

	cloudResourceId: string;
	hasApiKey: boolean;

	hasVolcAppId: boolean;
	hasVolcAccessToken: boolean;

	apiKeyHint: VoiceTranscriptionSecretHint | null;
	volcAppIdHint: VoiceTranscriptionSecretHint | null;
	volcAccessTokenHint: VoiceTranscriptionSecretHint | null;

	runtimeReady: boolean;
};

export type VoiceTranscriptionSaveInput = {
	enabled: boolean;
	engine: VoiceTranscriptionEngine;
	cloudProvider: VoiceTranscriptionCloudProvider;
	baseUrl: string;
	model: string;
	language: string;
	inputDeviceId: string;
	localModelId: WhisperModelId;
	cliPath: string;
	cloudResourceId: string;

	apiKey?: string;

	volcAppId?: string;

	volcAccessToken?: string;

	clearApiKey?: boolean;
};

export type VoiceTranscriptionSecretField = "apiKey" | "volcAppId" | "volcAccessToken";

export type VoiceTranscriptionSecretHint = { tail: string; length: number };

export type VoiceTranscriptionConfigErrorCode = "invalidConfig" | "secureStorageUnavailable" | "saveFailed";

export type VoiceTranscriptionSaveResult = { ok: true; config: VoiceTranscriptionPublicConfig } | { ok: false; error: VoiceTranscriptionConfigErrorCode };

export type VoiceTranscriptionRequest = {
	requestId: string;
	audio: ArrayBuffer;
	mimeType: string;
};

export type VoiceTranscriptionErrorCode = "invalidRequest" | "notConfigured" | "engineUnavailable" | "invalidKey" | "notGranted" | "badBaseUrl" | "network" | "timeout" | "cancelled" | "http" | "empty" | "sessionTooLong";

export type VoiceTranscriptionFailureDetail = { statusCode?: string; message?: string; logId?: string };

export type VoiceTranscriptionResult = { ok: true; text: string } | { ok: false; error: VoiceTranscriptionErrorCode; detail?: VoiceTranscriptionFailureDetail };

export type VoiceTranscriptionTestResult = { ok: true } | { ok: false; error: VoiceTranscriptionErrorCode; detail?: VoiceTranscriptionFailureDetail };

export type VoiceTranscriptionStreamStartInput = {
	requestId: string;

	sampleRate: number;
};

export type VoiceTranscriptionStreamFrame = { requestId: string; pcm: ArrayBuffer };

export type VoiceTranscriptionStreamStartResult = { ok: true } | { ok: false; error: VoiceTranscriptionErrorCode; detail?: VoiceTranscriptionFailureDetail };

export type VoiceTranscriptionStreamPartial = { requestId: string; text: string; final: boolean };
