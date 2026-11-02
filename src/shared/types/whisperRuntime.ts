export type WhisperModelId = "small-q5_1" | "medium-q5_0" | "turbo-q5_0";

export type WhisperModelDef = {
	id: WhisperModelId;

	file: string;

	bytes: number;

	sha256: string;

	label: string;

	multilingual: boolean;
};

export const WHISPER_MODEL_CATALOG: readonly WhisperModelDef[] = [
	{ id: "small-q5_1", file: "ggml-small-q5_1.bin", bytes: 190085487, sha256: "ae85e4a935d7a567bd102fe55afc16bb595bdb618e11b2fc7591bc08120411bb", label: "Small (q5_1) · 181MB", multilingual: true },
	{ id: "medium-q5_0", file: "ggml-medium-q5_0.bin", bytes: 539212467, sha256: "19fea4b380c3a618ec4723c3eef2eb785ffba0d0538cf43f8f235e7b3b34220f", label: "Medium (q5_0) · 514MB", multilingual: true },
	{ id: "turbo-q5_0", file: "ggml-large-v3-turbo-q5_0.bin", bytes: 574041195, sha256: "394221709cd5ad1f40c46e6031ca61bce88931e6e088c188294c6d5a55ffa7e2", label: "Large v3 Turbo (q5_0) · 547MB", multilingual: true },
];

export const DEFAULT_WHISPER_MODEL_ID: WhisperModelId = "small-q5_1";

export function getWhisperModelDef(id: unknown): WhisperModelDef | undefined {
	return typeof id === "string" ? WHISPER_MODEL_CATALOG.find((def) => def.id === id) : undefined;
}

export const WHISPER_CPP_RELEASE_TAG = "b5130";
const WHISPER_CPP_RELEASE_BASE = `https://github.com/ggml-org/whisper.cpp/releases/download/${WHISPER_CPP_RELEASE_TAG}`;

export function whisperCppReleaseApiUrl(): string {
	return `https://api.github.com/repos/ggml-org/whisper.cpp/releases/tags/${WHISPER_CPP_RELEASE_TAG}`;
}

export type WhisperHostSupport = {
	autoRuntime: boolean;

	asset: string;

	format: "zip" | "tar.gz";
};

export function resolveWhisperHostSupport(platform: NodeJS.Platform | string, arch: string): WhisperHostSupport | null {
	if (platform === "win32" && arch === "x64") return { autoRuntime: true, asset: "whisper-bin-x64.zip", format: "zip" };
	if (platform === "win32" && arch === "arm64") return { autoRuntime: true, asset: "whisper-bin-win-cpu-arm64.zip", format: "zip" };
	if (platform === "linux" && arch === "x64") return { autoRuntime: true, asset: "whisper-bin-ubuntu-x64.tar.gz", format: "tar.gz" };
	if (platform === "linux" && arch === "arm64") return { autoRuntime: true, asset: "whisper-bin-ubuntu-arm64.tar.gz", format: "tar.gz" };
	if (platform === "darwin") return { autoRuntime: false, asset: "", format: "tar.gz" };
	return null;
}

export function whisperAssetUrl(asset: string): string {
	return `${WHISPER_CPP_RELEASE_BASE}/${asset}`;
}

export function whisperModelUrlCandidates(file: string): string[] {
	return [`https://hf-mirror.com/ggerganov/whisper.cpp/resolve/main/${file}`, `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${file}`];
}

export type WhisperRuntimeStatus = {
	autoRuntimeSupported: boolean;

	cliReady: boolean;

	cliSource: "auto" | "custom" | "none";

	cliPath: string | null;

	runtimeVersion: string | null;

	models: Array<{ id: WhisperModelId; installed: boolean; bytes: number; partialBytes?: number }>;
};

export type WhisperInstallProgress = {
	target: "runtime" | WhisperModelId;
	phase: "downloading" | "verifying" | "installing" | "done" | "error";
	percent: number;
	receivedBytes?: number;
	totalBytes?: number;
	error?: string;
};

export type WhisperInstallResult = { ok: true } | { ok: false; error: string };
