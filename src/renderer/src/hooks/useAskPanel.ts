import { useCallback } from "react";
import { useAtom, useAtomValue, useStore } from "jotai";
import { askPanelCreatingAtom, askPanelOpenAtom, askPanelOriginSessionIdAtom, askPanelSessionIdAtom } from "../atoms/ask-panel-atoms";
import { sessionRecordsAtom } from "../atoms/session-atoms";
import { sessionRuntimeBySessionIdAtomFamily } from "../atoms/session-selectors";
import { desktopApi } from "../desktopApi";
import { t } from "../i18n";
import { buildAskContextForSession } from "../utils/askPanelContextSource";
import { showNotice } from "../utils/notice";

export function useAskPanel() {
	const [isOpen, setOpen] = useAtom(askPanelOpenAtom);
	const [sessionId, setSessionId] = useAtom(askPanelSessionIdAtom);
	const [originSessionId, setOriginSessionId] = useAtom(askPanelOriginSessionIdAtom);
	const [creating, setCreating] = useAtom(askPanelCreatingAtom);
	const defaultAgentBackend = "pi" as const;
	const store = useStore();

	const ensureSession = useCallback(
		async (projectId: string): Promise<string | null> => {
			if (sessionId) return sessionId;
			setCreating(true);
			try {
				const { session } = await desktopApi.sessions.createAnonymous({
					projectId,
					title: t("askPanel.sessionTitle"),

					backend: defaultAgentBackend,
				});

				store.set(sessionRecordsAtom, {
					...store.get(sessionRecordsAtom),
					[session.id]: session,
				});
				setSessionId(session.id);
				return session.id;
			} catch (error) {
				setOpen(false);

				showNotice(error instanceof Error ? error.message : String(error), Number.POSITIVE_INFINITY, "error");
				return null;
			} finally {
				setCreating(false);
			}
		},
		[sessionId, setCreating, setOpen, setSessionId, store, defaultAgentBackend],
	);

	const waitRuntimeReady = useCallback(
		async (sessionId: string, timeoutMs = 15000): Promise<boolean> => {
			const deadline = Date.now() + timeoutMs;
			while (Date.now() < deadline) {
				const runtime = store.get(sessionRuntimeBySessionIdAtomFamily(sessionId));
				if (runtime?.status === "running" || runtime?.status === "idle") return true;
				await new Promise((resolve) => setTimeout(resolve, 250));
			}
			return false;
		},
		[store],
	);

	const dispatchPrompt = useCallback(
		async (id: string, text: string, context?: string): Promise<boolean> => {
			if (!(await waitRuntimeReady(id))) {
				showNotice(t("askPanel.runtimeTimeout"), Number.POSITIVE_INFINITY, "error");
				return false;
			}
			try {
				await desktopApi.sessions.sendPrompt({
					sessionId: id,
					requestId: crypto.randomUUID(),
					message: text,
					...(context ? { agentMessage: `${context}\n\n${text}` } : {}),
				});
				return true;
			} catch (error) {
				showNotice(error instanceof Error ? error.message : String(error), Number.POSITIVE_INFINITY, "error");
				return false;
			}
		},
		[waitRuntimeReady],
	);

	const sendToAsk = useCallback(
		async (projectId: string, text: string, options?: { context?: string; originSessionId?: string }): Promise<boolean> => {
			const context = options?.context ?? buildAskContextForSession(store, options?.originSessionId) ?? undefined;
			const id = await ensureSession(projectId);
			if (!id) return false;

			setOpen(true);
			setCreating(true);

			if (options?.originSessionId) setOriginSessionId(options.originSessionId);
			try {
				const ok = await dispatchPrompt(id, text, context);
				return ok;
			} finally {
				setCreating(false);
			}
		},
		[dispatchPrompt, ensureSession, setCreating, setOpen, setOriginSessionId, store],
	);

	const sendFollowUp = useCallback(
		async (text: string): Promise<boolean> => {
			if (!sessionId) return false;
			const trimmed = text.trim();
			if (!trimmed) return false;
			return dispatchPrompt(sessionId, trimmed);
		},
		[dispatchPrompt, sessionId],
	);

	const close = useCallback(async () => {
		setOpen(false);
		if (!sessionId) return;

		const runtime = store.get(sessionRuntimeBySessionIdAtomFamily(sessionId));
		if (runtime?.agentId) {
			try {
				await desktopApi.sessions.stopRuntime({
					sessionId,
					agentId: runtime.agentId,
					runtimeGeneration: runtime.runtimeGeneration,
				});
			} catch {}
		}
		setSessionId(null);
		setOriginSessionId(null);
	}, [sessionId, setOpen, setSessionId, setOriginSessionId, store]);

	return { isOpen, sessionId, originSessionId, creating, sendToAsk, sendFollowUp, close };
}
