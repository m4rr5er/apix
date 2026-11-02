import { useEffect, useRef } from "react";
import { useStore } from "jotai";
import type { AgentRuntimeState } from "../../../shared/types";
import { applySessionRuntimeEventAtom, openSettingsAtom, replaceSessionRuntimesAtom, sessionRuntimeByIdAtom, setSessionDraftAtom } from "../atoms";
import { agentExitedAtom } from "../atoms/runtime-atoms";
import { desktopApi } from "../desktopApi";
import { t } from "../i18n";
import type { TranslationKey } from "../i18n/rendererCopy.zh-CN";
import { showNotice } from "../utils/notice";
import type { NoticeActions, NoticeKind } from "../utils/notice";

type RuntimeBridgeCallbacks = {
	onRuntimeCapabilityChanged?: (input: { sessionId: string; agentId: string; previous?: AgentRuntimeState; current: AgentRuntimeState; patch: AgentRuntimeState }) => void;

	onRestartSessionRuntime?: (sessionId: string) => void;
};

export function useSessionRuntimeBridge(callbacks: RuntimeBridgeCallbacks = {}): void {
	const store = useStore();
	const callbacksRef = useRef(callbacks);
	callbacksRef.current = callbacks;

	useEffect(() => {
		let disposed = false;
		void desktopApi.sessions
			.listRuntimes()
			.then((runtimes) => {
				if (!disposed) store.set(replaceSessionRuntimesAtom, runtimes);
			})
			.catch(() => undefined);

		const offRuntimeEvents = desktopApi.sessions.onRuntimeEvent((event) => {
			if (event.sourceChannel === "agents:state" && Array.isArray(event.payload)) {
				for (const tab of event.payload as Array<{ id?: string; status?: string }>) {
					if (typeof tab.id === "string" && tab.status === "closed") {
						store.set(agentExitedAtom, tab.id);
					}
				}
			}

			if (event.sourceChannel === "agents:queue-cleared" && event.payload && typeof event.payload === "object") {
				const payload = event.payload as { steering?: unknown; followUp?: unknown };
				const texts = [...(Array.isArray(payload.steering) ? payload.steering : []), ...(Array.isArray(payload.followUp) ? payload.followUp : [])].filter((item): item is string => typeof item === "string" && item.trim().length > 0);
				if (texts.length > 0) {
					const joined = texts.join("\n\n");
					store.set(setSessionDraftAtom, { sessionId: event.sessionId, value: (current: string) => (current.trim() ? `${current}\n\n${joined}` : joined) });
				}
				return;
			}

			if (event.sourceChannel === "agents:notice" && event.payload && typeof event.payload === "object") {
				const notice = event.payload as {
					message?: string;
					i18nKey?: string;

					i18nParams?: Record<string, string | number>;
					kind?: NoticeKind;
					duration?: number;

					action?: string;
				};
				const text = notice.i18nKey ? t(notice.i18nKey as TranslationKey, notice.i18nParams) : notice.message;
				if (text) {
					const kind = notice.kind ?? "info";

					const actions: NoticeActions | undefined =
						notice.action === "openDevExtensionsSettings"
							? {
									action: {
										label: t("notice.openDevExtensionsSettings"),
										onClick: () => store.set(openSettingsAtom, { tab: "dev", section: "dev-pi-rpc" }),
									},
								}
							: notice.action === "openMcpSettings"
								? {
										action: {
											label: t("notice.openMcpSettings"),
											onClick: () => store.set(openSettingsAtom, { pane: "config", tab: "dev", configTab: "mcp" }),
										},
									}
								: notice.action === "restartSessionRuntime" && event.sessionId
									? {
											action: {
												label: t("notice.restartSessionRuntime"),
												onClick: () => callbacksRef.current.onRestartSessionRuntime?.(event.sessionId),
											},
										}
									: undefined;
					showNotice(
						text,
						kind === "error" ? Number.POSITIVE_INFINITY : undefined,
						kind,
						undefined,
						actions,

						notice.i18nKey,
					);
				}
				return;
			}
			const previousRuntime = store.get(sessionRuntimeByIdAtom)[event.sessionId];
			store.set(applySessionRuntimeEventAtom, event);
			if (event.sourceChannel !== "agents:runtime-state") return;
			const currentRuntime = store.get(sessionRuntimeByIdAtom)[event.sessionId];
			if (currentRuntime?.agentId !== event.agentId || currentRuntime.runtimeGeneration !== event.runtimeGeneration || !currentRuntime.state || !event.payload || typeof event.payload !== "object") {
				return;
			}
			const patch = (event.payload as { state?: AgentRuntimeState }).state;
			if (!patch) return;
			callbacksRef.current.onRuntimeCapabilityChanged?.({
				sessionId: event.sessionId,
				agentId: event.agentId,
				previous: previousRuntime?.agentId === event.agentId && previousRuntime.runtimeGeneration === event.runtimeGeneration ? previousRuntime.state : undefined,
				current: currentRuntime.state,
				patch,
			});
		});
		return () => {
			disposed = true;
			offRuntimeEvents();
		};
	}, [store]);
}
