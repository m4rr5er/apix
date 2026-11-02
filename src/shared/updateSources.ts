import type { UpdateSourceId } from "./types/settings";

export const UPDATE_REPO_OWNER = "ayuayue";
export const UPDATE_REPO = "PiDeck";

export const RELEASES_LATEST_DOWNLOAD_PATH = "/releases/latest/download";

export const ATOMGIT_HOST = "https://atomgit.com";

export const ATOMGIT_API_HOST = "https://api.atomgit.com";

export function atomGitReleasesBase(): string {
	return `${ATOMGIT_HOST}/${UPDATE_REPO_OWNER}/${UPDATE_REPO}`;
}

export function atomGitFeedUrl(): string {
	return `${atomGitReleasesBase()}/releases/download/latest`;
}

export function atomGitLatestReleaseApiUrl(): string {
	return `${ATOMGIT_API_HOST}/api/v5/repos/${UPDATE_REPO_OWNER}/${UPDATE_REPO}/releases/latest`;
}

export const UPDATE_SOURCE_MIRRORS: ReadonlyArray<{ id: UpdateSourceId; host: string }> = [{ id: "atomgit", host: ATOMGIT_HOST }];

export function gitHubReleasesBase(): string {
	return `https://github.com/${UPDATE_REPO_OWNER}/${UPDATE_REPO}`;
}

export function gitHubLatestDownloadBase(): string {
	return `${gitHubReleasesBase()}${RELEASES_LATEST_DOWNLOAD_PATH}`;
}

export function buildCustomSourceFeedUrl(host: string): string {
	if (host === ATOMGIT_HOST || host.startsWith(ATOMGIT_HOST)) {
		return atomGitFeedUrl();
	}
	return `${host}/${gitHubReleasesBase()}${RELEASES_LATEST_DOWNLOAD_PATH}`;
}

export function normalizeCustomMirrorHost(raw: string | null | undefined): string | null {
	const trimmed = (raw ?? "").trim().replace(/\/+$/, "");
	if (!trimmed) return null;
	if (!/^https?:\/\//i.test(trimmed)) return null;
	try {
		const parsed = new URL(trimmed);
		if (!parsed.hostname) return null;
		return trimmed;
	} catch {
		return null;
	}
}
