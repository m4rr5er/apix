import { useAtomValue } from "jotai";
import { cn } from "../../lib/utils";
import { sessionStatusDotClass } from "../../agentListDisplay";
import { unreadSessionIdsAtom } from "../../atoms/session-atoms";
import { t } from "../../i18n";

/** 3×3 点阵延迟：按对角波次点亮，running/starting 不再退回静态色点。 */
const DOT_DELAYS = [0, 80, 160, 80, 160, 240, 160, 240, 320];

export function SidebarStatusDot(props: { status?: string | null; sessionId?: string }) {
	const unreadSessionIds = useAtomValue(unreadSessionIdsAtom);
	if (props.status === "running" || props.status === "starting") {
		return (
			<span role="status" aria-label={t("app.statusRunning")} className="pideck-dot-wave size-3 shrink-0 text-warning">
				{DOT_DELAYS.map((delay, index) => (
					<span key={index} style={{ animationDelay: `${delay}ms` }} />
				))}
			</span>
		);
	}
	const dotClass = sessionStatusDotClass(props.status);
	if (!dotClass || (props.status === "idle" && (!props.sessionId || !unreadSessionIds.includes(props.sessionId)))) return null;
	return <span className={cn("size-1.5 shrink-0 rounded-full", dotClass, props.status === "idle" && "animate-pulse")} aria-hidden="true" />;
}
