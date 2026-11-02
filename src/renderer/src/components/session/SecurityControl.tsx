import type { AgentBackend } from "../../../../shared/types";
import { SecurityLevelMenu } from "./SecurityLevelMenu";

export function SecurityControl(props: { sessionId: string; backend?: AgentBackend; disabled?: boolean }) {
	if (props.backend === "acp" || props.backend === "qoder") {
		return null;
	}
	return <SecurityLevelMenu sessionId={props.sessionId} disabled={props.disabled} />;
}
