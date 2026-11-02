export type SessionOutlineEntry = {
	entryId: string;
	messageIndex: number;

	turnOrdinal: number;
	timestamp?: string;

	preview?: string;
};

export type SessionOutlineSnapshot = {
	entries: SessionOutlineEntry[];

	total: number;

	truncated: boolean;
};
