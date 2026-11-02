import type { PiSkillLocation } from "./types/skills";

export type GlobalSkillSourceId = Extract<PiSkillLocation["id"], "pi-global" | "agents-global">;

export function isGlobalSkillSourceId(sourceId: PiSkillLocation["id"]): sourceId is GlobalSkillSourceId {
	return sourceId === "pi-global" || sourceId === "agents-global";
}
