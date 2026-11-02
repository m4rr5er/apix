import type { SessionRecord } from "../../../shared/types";

export function isDisplayableSessionRecord(session: Pick<SessionRecord, "filePath" | "backend">): boolean {
	if (session.backend === "qoder") return false;
	return Boolean(session.filePath) || session.backend === "imagegen" || session.backend === "acp";
}
