export type AnnouncementLevel = "info" | "warn" | "critical";

export type AnnouncementCategory = "flash" | "notice" | "guide";

export type AnnouncementItem = {
	id: string;

	title: string;

	body: string;
	level: AnnouncementLevel;

	category: AnnouncementCategory;

	publishedAt: string;

	effectiveUntil: string;

	minVersion?: string;
};

export type AnnouncementFeed = {
	version: number;
	announcements: AnnouncementItem[];
};

export type AnnouncementSnapshot = {
	items: AnnouncementItem[];

	fetchedAt: number | null;

	source: "remote" | "cache" | "builtin";
};

export type AnnouncementState = AnnouncementSnapshot & {
	readIds: string[];

	notifiedIds: string[];
};
