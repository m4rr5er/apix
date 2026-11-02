export type SessionStatusPlacement = "sidebar" | "composer";
export const DEFAULT_SESSION_STATUS_PLACEMENT: SessionStatusPlacement = "composer";

export function parseSessionStatusPlacement(value: unknown): SessionStatusPlacement {
	return value === "sidebar" || value === "composer" ? value : DEFAULT_SESSION_STATUS_PLACEMENT;
}

export function placementShowsSidebarPanel(placement: SessionStatusPlacement): boolean {
	return placement === "sidebar";
}
