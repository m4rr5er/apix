import { atomGitFeedUrl, gitHubLatestDownloadBase } from "../updateSources";

export const PI_RUNTIME_NODE_VERSION = "24.13.0";

export const PI_RUNTIME_NODE_SHA256: Readonly<Record<string, string>> = {
	"win32-x64": "ca2742695be8de44027d71b3f53a4bdb36009b95575fe1ae6f7f0b5ce091cb88",
	"win32-arm64": "92b9f9b0c0c123e11e4afc535f0ec19cd987465eea506427553a49971364158a",
	"darwin-x64": "6f03c1b48ddbe1b129a6f8038be08e0899f05f17185b4d3e4350180ab669a7f3",
	"darwin-arm64": "d595961e563fcae057d4a0fb992f175a54d97fcc4a14dc2d474d92ddeea3b9f8",
	"linux-x64": "6223aad1a81f9d1e7b682c59d12e2de233f7b4c37475cd40d1c89c42b737ffa8",
	"linux-arm64": "0f6d40b94c6a2eb6b4c240ffc8b9fd3ada7ab044c177dd413c06e1ef9a63f081",
};

export type PiRuntimePlatform = "win32" | "darwin" | "linux";
export type PiRuntimeArch = "x64" | "arm64";

export function piRuntimeNodeArchiveName(platform: PiRuntimePlatform, arch: PiRuntimeArch): string {
	const version = PI_RUNTIME_NODE_VERSION;
	if (platform === "win32") return `node-v${version}-win-${arch}.zip`;
	return `node-v${version}-${platform}-${arch}.tar.gz`;
}

export function officialPiRuntimeNodeUrl(platform: PiRuntimePlatform, arch: PiRuntimeArch): string {
	return `https://nodejs.org/dist/v${PI_RUNTIME_NODE_VERSION}/${piRuntimeNodeArchiveName(platform, arch)}`;
}

export const PI_RUNTIME_NODE_MIRRORS = ["https://npmmirror.com/mirrors/node", "https://mirrors.huaweicloud.com/nodejs"] as const;

export function piRuntimeNodeReleaseAssetUrls(arch: PiRuntimeArch): string[] {
	const file = piRuntimeNodeArchiveName("win32", arch);
	return [`${atomGitFeedUrl()}/${encodeURIComponent(file)}`, `${gitHubLatestDownloadBase()}/${encodeURIComponent(file)}`];
}

export function piRuntimeNodeDownloadUrls(platform: PiRuntimePlatform, arch: PiRuntimeArch): string[] {
	const file = piRuntimeNodeArchiveName(platform, arch);
	const mirrorUrls = PI_RUNTIME_NODE_MIRRORS.map((mirror) => `${mirror}/v${PI_RUNTIME_NODE_VERSION}/${file}`);

	const releaseAssetUrls = platform === "win32" ? piRuntimeNodeReleaseAssetUrls(arch) : [];
	return [...mirrorUrls.slice(0, 1), ...releaseAssetUrls, ...mirrorUrls.slice(1), officialPiRuntimeNodeUrl(platform, arch)];
}

export function piRuntimeNodeInnerDir(platform: PiRuntimePlatform, arch: PiRuntimeArch): string {
	return platform === "win32" ? `node-v${PI_RUNTIME_NODE_VERSION}-win-${arch}` : `node-v${PI_RUNTIME_NODE_VERSION}-${platform}-${arch}`;
}

export function toPiRuntimePlatform(platform: string): PiRuntimePlatform | null {
	return platform === "win32" || platform === "darwin" || platform === "linux" ? platform : null;
}

export function toPiRuntimeArch(arch: string): PiRuntimeArch | null {
	return arch === "x64" || arch === "arm64" ? arch : null;
}

export type PiRuntimeNodeStatus = {
	installed: boolean;

	path?: string;

	version?: string;

	systemNodeAvailable: boolean;

	systemNodeVersion?: string;

	installSupported: boolean;
	error?: string;
};

export type PiRuntimeNodeInstallResult = {
	ok: boolean;
	path?: string;
	version?: string;

	source?: string;
	error?: string;
};

export type PiRuntimeNodeInstallProgress = {
	stage: "download" | "verify" | "extract" | "probe";
	receivedBytes?: number;
	totalBytes?: number;
};
