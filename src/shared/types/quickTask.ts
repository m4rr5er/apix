export type QuickTaskErrorCode = "invalidPath" | "notDirectory" | "notFound" | "permissionDenied" | "unknown";

export interface QuickTaskState {
	active: boolean;
	requestId: number;
	path?: string;

	error?: QuickTaskErrorCode;
}
