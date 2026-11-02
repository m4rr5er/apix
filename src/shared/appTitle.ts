import { resolveAppDisplayName } from "./types/settings";

export function composeAppTitle(displayName: string | null | undefined, devBranch?: string | null): string {
	const name = resolveAppDisplayName(displayName);
	const branch = typeof devBranch === "string" ? devBranch.trim() : "";
	return branch === "" ? name : `${name} · ${branch}`;
}
