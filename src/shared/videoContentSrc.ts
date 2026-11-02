import type { VideoContent } from "./types/videogen";

export const VIDEO_BLOB_PROTOCOL = "pideck-video";

export function videoBlobUrl(ref: string): string {
	return `${VIDEO_BLOB_PROTOCOL}://blob/${encodeURIComponent(ref)}`;
}

export function videoContentSrc(video: Pick<VideoContent, "ref"> | null | undefined): string | null {
	if (!video || !video.ref) return null;
	return videoBlobUrl(video.ref);
}
