import type { SessionRecord } from "../../../shared/types";

export function supportsSessionFind(record: Pick<SessionRecord, "backend" | "filePath"> | undefined): boolean {
	if (!record) return false;
	return (!record.backend || record.backend === "pi") && Boolean(record.filePath);
}
