import { useMemo } from "react";
import { atom, useAtomValue } from "jotai";
import { Loader } from "../motion/loader";
import { sessionRuntimeUiByIdAtom, unreadSessionIdsAtom } from "../../atoms/session-atoms";
import { hasPendingAskForSession } from "../../utils/askUi";
import { t } from "../../i18n";

export function isSessionExecutingStatus(status?: string | null): boolean {
	return status === "running" || status === "starting";
}

export function SessionActivityIndicator(props: { status?: string | null; sessionId?: string; waiting?: boolean; busy?: boolean }) {
	const pendingAtom = useMemo(() => atom((get) => hasPendingAskForSession(props.sessionId, get(sessionRuntimeUiByIdAtom))), [props.sessionId]);
	const pending = useAtomValue(pendingAtom);
	const unread = useAtomValue(unreadSessionIdsAtom);

	const running = props.busy || isSessionExecutingStatus(props.status);
	const waiting = !running && (props.waiting || pending || props.status === "waiting" || props.status === "pending");
	if (running) return <Loader variant="dot-matrix" size={16} speed={1.1} label={t("app.statusRunning")} className="size-3 shrink-0 text-warning" />;
	if (waiting) return <span className="session-activity-waiting size-1.5 shrink-0 rounded-full bg-warning" aria-hidden="true" />;
	if (props.status === "idle" && props.sessionId && unread.includes(props.sessionId)) return <span className="size-1.5 shrink-0 rounded-full bg-info animate-pulse" aria-label={t("app.statusIdle")} />;
	if (props.status === "error") return <span className="size-1.5 shrink-0 rounded-full bg-danger" aria-label={t("app.statusError")} />;
	return null;
}
