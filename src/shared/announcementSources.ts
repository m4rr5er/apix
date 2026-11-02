import { UPDATE_REPO, UPDATE_REPO_OWNER } from "./updateSources";

export const ANNOUNCEMENT_FILE_NAME = "announcements.json";

export const ANNOUNCEMENT_BRANCH = "main";

export const ANNOUNCEMENT_ATOMGIT_URL = `https://api.atomgit.com/api/v5/repos/${UPDATE_REPO_OWNER}/${UPDATE_REPO}/contents/${ANNOUNCEMENT_FILE_NAME}?ref=${ANNOUNCEMENT_BRANCH}`;

export const ANNOUNCEMENT_RAW_URL = `https://raw.githubusercontent.com/${UPDATE_REPO_OWNER}/${UPDATE_REPO}/${ANNOUNCEMENT_BRANCH}/${ANNOUNCEMENT_FILE_NAME}`;

export type AnnouncementSourceKind = "atomgit-contents" | "plain";

export interface AnnouncementSource {
	url: string;
	kind: AnnouncementSourceKind;
}

export const ANNOUNCEMENT_SOURCES: readonly AnnouncementSource[] = [
	{ url: ANNOUNCEMENT_ATOMGIT_URL, kind: "atomgit-contents" },
	{ url: ANNOUNCEMENT_RAW_URL, kind: "plain" },
];

export function unwrapAtomgitContents(text: string): string | null {
	try {
		const parsed: unknown = JSON.parse(text);
		if (typeof parsed !== "object" || parsed === null || !("encoding" in parsed) || !("content" in parsed)) {
			return null;
		}
		const { encoding, content } = parsed as { encoding: unknown; content: unknown };
		if (encoding !== "base64" || typeof content !== "string") return null;

		return Buffer.from(content, "base64").toString("utf8");
	} catch {
		return null;
	}
}
