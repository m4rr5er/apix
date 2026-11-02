export const LOCAL_SERVICE_IDS = ["billion-context"] as const;
export type LocalServiceId = (typeof LOCAL_SERVICE_IDS)[number];

export function isLocalServiceId(value: unknown): value is LocalServiceId {
	return typeof value === "string" && (LOCAL_SERVICE_IDS as readonly string[]).includes(value);
}

export type LocalServiceStatus = {
	id: string;

	available: boolean;
	running: boolean;
	pid?: number;

	uiUrl?: string;
	version?: string;

	reason?: string;
};
