import { DEFAULT_WHISPER_MODEL_ID, getWhisperModelDef, type WhisperModelId } from "./types/whisperRuntime";

export type VoiceTranscriptionEngine = "cloud" | "local";

export type VoiceTranscriptionCloudProvider = "openai" | "volcengine";

export const VOLC_STREAM_RESOURCE_ID = "volc.bigasr.sauc.duration";
export const VOLC_FLASH_RESOURCE_ID = "volc.bigasr.auc_turbo";

export const VOLC_SUPPORTED_RESOURCE_IDS = [VOLC_STREAM_RESOURCE_ID, VOLC_FLASH_RESOURCE_ID] as const;

export function resolveVolcProtocol(resourceId: string): "stream" | "flash" {
	return resourceId === VOLC_STREAM_RESOURCE_ID ? "stream" : "flash";
}

export const VOLC_STREAM_ENDPOINT = "wss://openspeech.bytedance.com/api/v3/sauc/bigmodel";

export const VOICE_STREAM_SAMPLE_RATE = 16000;

export const VOICE_STREAM_FRAME_MS = 200;
export const VOICE_STREAM_FRAME_BYTES = ((VOICE_STREAM_SAMPLE_RATE * VOICE_STREAM_FRAME_MS) / 1000) * 2;

export const VOICE_STREAM_MAX_FRAMES = 9000;

export const DEFAULT_VOICE_TRANSCRIPTION_CONFIG = {
	enabled: false,
	engine: "cloud",
	cloudProvider: "openai",
	baseUrl: "https://api.openai.com/v1",
	model: "whisper-1",
	language: "",
	inputDeviceId: "",
	localModelId: DEFAULT_WHISPER_MODEL_ID,
	cliPath: "",
	cloudResourceId: VOLC_STREAM_RESOURCE_ID,
} as const;

export const VOICE_TRANSCRIPTION_MAX_AUDIO_BYTES = 25 * 1024 * 1024;
export const VOICE_TRANSCRIPTION_TIMEOUT_MS = 60_000;

export const VOICE_TRANSCRIPTION_LOCAL_TIMEOUT_MS = 300_000;

const MAX_BASE_URL_LENGTH = 2048;
const MAX_MODEL_LENGTH = 200;
const MAX_LANGUAGE_LENGTH = 35;
const MAX_API_KEY_LENGTH = 4096;
const MAX_DEVICE_ID_LENGTH = 512;
const MAX_CLI_PATH_LENGTH = 1024;
const MAX_RESOURCE_ID_LENGTH = 100;

export type SanitizedVoiceTranscriptionConfig = {
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
};

export function sanitizeVoiceTranscriptionConfig(input: unknown): SanitizedVoiceTranscriptionConfig | null {
	if (!isRecord(input)) return null;
	const engine = normalizeEngine(Reflect.get(input, "engine"));
	const cloudProvider = normalizeCloudProvider(Reflect.get(input, "cloudProvider"));
	const enabled = Reflect.get(input, "enabled") === true;
	const baseUrl = readBoundedString(Reflect.get(input, "baseUrl"), MAX_BASE_URL_LENGTH);
	const model = readBoundedString(Reflect.get(input, "model"), MAX_MODEL_LENGTH);
	const language = readBoundedString(Reflect.get(input, "language"), MAX_LANGUAGE_LENGTH);
	const inputDeviceId = readBoundedString(Reflect.get(input, "inputDeviceId"), MAX_DEVICE_ID_LENGTH);
	const cliPath = readBoundedString(Reflect.get(input, "cliPath"), MAX_CLI_PATH_LENGTH);
	const rawResourceId = readBoundedString(Reflect.get(input, "cloudResourceId"), MAX_RESOURCE_ID_LENGTH);
	const cloudResourceId = (VOLC_SUPPORTED_RESOURCE_IDS as readonly string[]).includes(rawResourceId) ? rawResourceId : VOLC_SUPPORTED_RESOURCE_IDS[0];
	const localModel = getWhisperModelDef(Reflect.get(input, "localModelId"));
	const localModelId = localModel ? localModel.id : DEFAULT_WHISPER_MODEL_ID;
	if (engine === "cloud" && cloudProvider === "openai") {
		if (!baseUrl || !model || !normalizeVoiceTranscriptionUrl(baseUrl)) return null;
	}
	if (cliPath && (!isAbsoluteLikePath(cliPath) || containsControlChars(cliPath))) return null;
	return { enabled, engine, cloudProvider, baseUrl, model, language, inputDeviceId, localModelId, cliPath, cloudResourceId };
}

function normalizeEngine(raw: unknown): VoiceTranscriptionEngine {
	return raw === "local" ? "local" : "cloud";
}

function normalizeCloudProvider(raw: unknown): VoiceTranscriptionCloudProvider {
	return raw === "volcengine" ? "volcengine" : "openai";
}

function readBoundedString(raw: unknown, max: number): string {
	const value = typeof raw === "string" ? raw.trim() : "";
	return value.length <= max ? value : "";
}

function containsControlChars(value: string): boolean {
	return /[\u0000-\u001f]/.test(value);
}

function isAbsoluteLikePath(value: string): boolean {
	if (value.startsWith("\\\\")) return true;
	if (/^[a-zA-Z]:[\\/]/.test(value)) return true;
	return value.startsWith("/");
}

function isRecord(input: unknown): input is Record<string, unknown> {
	return Boolean(input) && typeof input === "object";
}

export function sanitizeVoiceTranscriptionApiKey(input: unknown): string | null {
	if (typeof input !== "string") return null;
	const apiKey = input.trim();
	return apiKey && apiKey.length <= MAX_API_KEY_LENGTH ? apiKey : null;
}

export function normalizeVoiceTranscriptionUrl(input: string): string | null {
	if (!input || input.length > MAX_BASE_URL_LENGTH) return null;
	try {
		const url = new URL(input.trim());
		if ((url.protocol !== "https:" && url.protocol !== "http:") || url.username || url.password) {
			return null;
		}
		if (url.search || url.hash) return null;
		const path = url.pathname.replace(/\/+$/, "");
		if (path.endsWith("/audio/transcriptions")) {
			url.pathname = path;
		} else if (!path) {
			url.pathname = "/v1/audio/transcriptions";
		} else {
			url.pathname = `${path}/audio/transcriptions`;
		}
		return url.toString();
	} catch {
		return null;
	}
}

const VOLC_LANGUAGE_TAGS: Record<string, string> = {
	zh: "zh-CN",
	cy: "zh-CN",
	cmn: "zh-CN",
	mandarin: "zh-CN",
	yue: "yue-CN",
	"zh-tw": "zh-TW",
	en: "en-US",
	ja: "ja-JP",
	ko: "ko-KR",
	fr: "fr-FR",
	de: "de-DE",
	es: "es-MX",
	pt: "pt-BR",
	it: "it-IT",
	nl: "nl-NL",
	ru: "ru-RU",
	tr: "tr-TR",
	th: "th-TH",
	vi: "vi-VN",
	id: "id-ID",
	ms: "ms-MY",
	fil: "fil-PH",
	ar: "ar-SA",
	bn: "bn-BD",
	ne: "ne-NP",
	uk: "uk-UA",
	pl: "pl-PL",
	ro: "ro-RO",
	el: "el-GR",
};

export function normalizeVolcLanguageTag(language: string): string {
	const value = language.trim().toLowerCase();
	if (!value) return "";
	return VOLC_LANGUAGE_TAGS[value] ?? (value.includes("-") ? language.trim() : value);
}
