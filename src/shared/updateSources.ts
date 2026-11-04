import type { UpdateSourceId } from "./types/settings";

export const UPDATE_REPO_OWNER = "m4rr5er";
export const UPDATE_REPO = "apix";

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

export const UPDATE_SOURCE_MIRRORS: ReadonlyArray<{ id: UpdateSourceId; host: string }> = [];

/**
 * GitHub 直连失败时的更新镜像。
 *
 * APIX 只发布 GitHub Release；国内网络对 github.com 的 `releases.atom` / 资源下载经常
 * 直接 RST（electron-updater 报 net::ERR_CONNECTION_RESET）。这里只作为**网络失败后的
 * 自动回退**，不改变用户设置里的「更新源」；镜像仍从同一 Release 读取 latest.yml，
 * 安装包的 sha512 仍由 electron-updater 按 latest.yml 校验。
 */
export const GITHUB_PROXY_HOST = "https://gh-proxy.com";

export function gitHubProxyFeedUrl(host: string = GITHUB_PROXY_HOST): string {
	return `${host.replace(/\/+$/, "")}/${gitHubReleasesBase()}/releases/latest/download`;
}

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
