export interface MiniOverlaySessionRef {
	id: string;
	title: string;
	projectId: string;

	isRunning: boolean;
}

export type MiniOverlayLocale = "zh-CN" | "zh-TW" | "en-US";

export interface MiniOverlayState {
	visible: boolean;
	runningCount: number;
	activeCount: number;

	activeSessions: MiniOverlaySessionRef[];
	recentSessions: MiniOverlaySessionRef[];
	projects: Array<{ id: string; name: string; path: string }>;

	locale: MiniOverlayLocale;
}
