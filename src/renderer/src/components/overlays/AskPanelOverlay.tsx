import { useEffect, useMemo, useRef, useState } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import { Check, ChevronDown, ChevronRight, Clipboard, CornerDownLeft, Loader2, MessageSquarePlus, Send, X } from "lucide-react";
import removeMarkdown from "remove-markdown";
import { useAskPanel } from "../../hooks/useAskPanel";
import { claimSessionRuntimeUiResponseAtom, rollbackSessionRuntimeUiResponseAtom, sessionMessageCacheBySessionIdAtomFamily } from "../../atoms/session-atoms";
import { sessionRuntimeBySessionIdAtomFamily, sessionRuntimeUiBySessionIdAtomFamily } from "../../atoms/session-selectors";
import { setSessionDraftAtom } from "../../atoms/composer-atoms";
import { Input } from "../ui-shadcn/input";
import { createSessionRuntimeUiResponder, SessionRuntimeUiOverlay } from "../overlays/SessionRuntimeUiOverlay";
import { desktopApi } from "../../desktopApi";
import { t } from "../../i18n";
import { showNotice } from "../../utils/notice";
import { clampCapsulePosition, expandedPanelSize, PANEL_GAP, VIEWPORT_MARGIN } from "../../utils/askPanelGeometry";
import { OwnedSessionMessageTimeline } from "../session/OwnedSessionMessageTimeline";

const DRAG_THRESHOLD_PX = 4;

export function AskPanelOverlay() {
	const panel = useAskPanel();
	const [expanded, setExpanded] = useState(false);

	const [followUpText, setFollowUpText] = useState("");
	const setInsertComposer = useSetAtom(setSessionDraftAtom);

	const [dragPos, setDragPos] = useState<{ x: number; y: number } | null>(null);

	const dragRef = useRef<{
		startX: number;
		startY: number;
		origX: number;
		origY: number;
		moved: boolean;
	} | null>(null);

	const lastDragMovedRef = useRef(false);

	const sessionId = panel.sessionId;
	const cache = useAtomValue(sessionMessageCacheBySessionIdAtomFamily(sessionId ?? ""));
	const runtime = useAtomValue(sessionRuntimeBySessionIdAtomFamily(sessionId ?? ""));

	const sessionRuntimeUi = useAtomValue(sessionRuntimeUiBySessionIdAtomFamily(sessionId ?? ""));
	const claimSessionUiResponse = useSetAtom(claimSessionRuntimeUiResponseAtom);
	const rollbackSessionUiResponse = useSetAtom(rollbackSessionRuntimeUiResponseAtom);
	const runtimeRef = useRef(runtime);
	runtimeRef.current = runtime;

	const runtimeUiResponder = useMemo(() => {
		if (!sessionId || !runtime?.agentId) return undefined;
		const binding = {
			sessionId,
			agentId: runtime.agentId,
			runtimeGeneration: runtime.runtimeGeneration,
		};
		return createSessionRuntimeUiResponder({
			binding,
			readBinding: () => {
				const latest = runtimeRef.current;
				return latest?.agentId
					? {
							sessionId,
							agentId: latest.agentId,
							runtimeGeneration: latest.runtimeGeneration,
						}
					: undefined;
			},
			claim: claimSessionUiResponse,
			rollback: rollbackSessionUiResponse,
			send: (input) => desktopApi.sessions.sendUiResponse(input),
			onError: (error) => showNotice(error instanceof Error ? error.message : String(error), 4000),
		});
	}, [claimSessionUiResponse, rollbackSessionUiResponse, runtime?.agentId, runtime?.runtimeGeneration, sessionId]);

	useEffect(() => {
		setExpanded(false);
		setDragPos(null);
	}, [sessionId]);

	useEffect(() => {
		const clampNow = () => {
			setDragPos((prev) =>
				prev
					? clampCapsulePosition(
							prev.x,
							prev.y,
							{
								width: window.innerWidth,
								height: window.innerHeight,
							},
							expanded,
						)
					: prev,
			);
		};
		clampNow();
		window.addEventListener("resize", clampNow);
		return () => window.removeEventListener("resize", clampNow);
	}, [expanded]);

	if (!panel.isOpen || !sessionId) return null;

	const messages = cache?.messages ?? [];
	const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant" && m.text.trim().length > 0);
	const summary = lastAssistant ? removeMarkdown(lastAssistant.text).replace(/\s+/g, " ").trim().slice(0, 36) : "";
	const lastUser = [...messages].reverse().find((m) => m.role === "user" && m.text.trim().length > 0);
	const questionSummary = lastUser ? removeMarkdown(lastUser.text).replace(/\s+/g, " ").trim().slice(0, 36) : "";

	const fullAnswer = messages
		.filter((m) => m.role === "assistant" && m.text.trim().length > 0)
		.map((m) => m.text.trim())
		.join("\n\n");

	const running = runtime?.status === "running" || runtime?.status === "idle";

	const done = !running && summary.length > 0;

	const copyAnswer = () => {
		if (!fullAnswer) return;
		void navigator.clipboard
			.writeText(fullAnswer)
			.then(() => showNotice(t("askPanel.copyAnswerDone"), 3000))
			.catch((error) => showNotice(error instanceof Error ? error.message : String(error), 4000, "error"));
	};

	const insertToComposer = () => {
		const origin = panel.originSessionId;
		if (!origin || !fullAnswer) return;
		setInsertComposer({
			sessionId: origin,
			value: (current) => (current ? `${current}\n\n${fullAnswer}` : fullAnswer),
		});
		showNotice(t("askPanel.insertToComposerDone"), 3000);
	};

	const submitFollowUp = () => {
		const text = followUpText.trim();
		if (!text) return;
		void panel.sendFollowUp(text).then((ok) => {
			if (ok) setFollowUpText("");
		});
	};

	const handlePointerDown = (event: React.PointerEvent<HTMLButtonElement>) => {
		if (event.button !== 0) return;
		const rect = event.currentTarget.getBoundingClientRect();
		const drag = {
			startX: event.clientX,
			startY: event.clientY,
			origX: dragPos?.x ?? rect.left,
			origY: dragPos?.y ?? rect.top,
			moved: false,
		};
		dragRef.current = drag;
		lastDragMovedRef.current = false;

		const onMove = (moveEvent: PointerEvent) => {
			const current = dragRef.current;
			if (!current) return;
			const dx = moveEvent.clientX - current.startX;
			const dy = moveEvent.clientY - current.startY;

			if (!current.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
			current.moved = true;

			setDragPos(
				clampCapsulePosition(
					current.origX + dx,
					current.origY + dy,
					{
						width: window.innerWidth,
						height: window.innerHeight,
					},
					expanded,
				),
			);
		};
		const onUp = () => {
			lastDragMovedRef.current = dragRef.current?.moved ?? false;
			dragRef.current = null;
			window.removeEventListener("pointermove", onMove);
			window.removeEventListener("pointerup", onUp);
		};
		window.addEventListener("pointermove", onMove);
		window.addEventListener("pointerup", onUp);
	};

	return (
		<div
			className="ask-panel-root fixed z-50 flex flex-col items-end"
			style={
				dragPos
					? { left: dragPos.x, top: dragPos.y }
					: expanded
						? {
								right: 16,
								top: expandedPanelSize(window.innerWidth, window.innerHeight).height + PANEL_GAP + VIEWPORT_MARGIN,
							}
						: { right: 16, top: "25%" }
			}
		>
			{expanded && (
				<div className="ask-panel-detail mb-2 flex h-[min(48vh,400px)] w-[min(560px,calc(100vw-2rem))] animate-in fade-in-0 zoom-in-95 duration-base flex-col overflow-hidden rounded-xl border bg-popover shadow-md">
					<div className="flex shrink-0 items-center gap-2 border-b px-3 py-2">
						<MessageSquarePlus size={14} className="text-muted-foreground" aria-hidden="true" />
						<div className="min-w-0">
							<div className="truncate text-sm font-medium">{t("askPanel.title")}</div>
							{questionSummary || summary ? (
								<div className="truncate text-micro text-muted-foreground" title={questionSummary || summary}>
									{questionSummary || summary}
								</div>
							) : null}
						</div>
						{running ? (
							<span className="inline-flex shrink-0 items-center gap-1 text-micro font-medium text-emerald-600 dark:text-emerald-400">
								<span className="size-1.5 animate-pulse rounded-full bg-emerald-500" aria-hidden="true" />
								{t("askPanel.running")}
							</span>
						) : done ? (
							<Check size={13} className="shrink-0 text-emerald-500" aria-hidden="true" />
						) : null}
						<span className="flex-1" />
						<button className="flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-muted/60 hover:text-foreground disabled:opacity-40" aria-label={t("askPanel.copyAnswer")} title={t("askPanel.copyAnswer")} disabled={!fullAnswer} onClick={copyAnswer}>
							<Clipboard size={13} aria-hidden="true" />
						</button>
						<button
							className="flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-muted/60 hover:text-foreground disabled:opacity-40"
							aria-label={t("askPanel.insertToComposer")}
							title={panel.originSessionId ? t("askPanel.insertToComposer") : t("askPanel.insertToComposerUnavailable")}
							disabled={!fullAnswer || !panel.originSessionId}
							onClick={insertToComposer}
						>
							<CornerDownLeft size={13} aria-hidden="true" />
						</button>
						<button className="flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-muted/60 hover:text-foreground" aria-label={t("askPanel.minimize")} title={t("askPanel.minimize")} onClick={() => setExpanded(false)}>
							<X size={14} aria-hidden="true" />
						</button>
					</div>

					<div className="min-h-0 flex-1">
						{messages.length > 0 ? (
							<OwnedSessionMessageTimeline
								sessionId={sessionId}
								hasProject={false}
								onCreateSession={() => undefined}
								showThinking={false}
								validCommandNames={new Set()}
								validFilePaths={new Set()}
								onPreviewImage={() => undefined}
								onOpenExternal={(url) => void desktopApi.app.openExternal(url)}
								onToast={showNotice}
								runtimeUi={runtimeUiResponder ? <SessionRuntimeUiOverlay sessionId={sessionId} runtime={runtime} ui={sessionRuntimeUi} responder={runtimeUiResponder} /> : undefined}
							/>
						) : (
							<div className="flex h-full items-center justify-center gap-2 text-xs text-muted-foreground">
								<Loader2 size={13} className="animate-pideck-spin" aria-hidden="true" />
								{t("askPanel.waiting")}
							</div>
						)}
					</div>

					<form
						className="flex shrink-0 items-center gap-1.5 border-t px-3 py-2"
						onSubmit={(event) => {
							event.preventDefault();
							submitFollowUp();
						}}
					>
						<Input size="sm" className="min-w-0 flex-1 rounded-md px-2.5 py-1 text-sm focus-visible:ring-0" value={followUpText} onChange={(event) => setFollowUpText(event.target.value)} placeholder={t("askPanel.followUpPlaceholder")} aria-label={t("askPanel.followUpPlaceholder")} disabled={panel.creating} />
						<button type="submit" className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted/60 hover:text-foreground disabled:opacity-40" aria-label={t("askPanel.sendFollowUp")} title={t("askPanel.sendFollowUp")} disabled={panel.creating || !followUpText.trim()}>
							<Send size={13} aria-hidden="true" />
						</button>
					</form>
				</div>
			)}

			<button
				className="ask-panel-pill flex h-9 max-w-[min(340px,calc(100vw-2rem))] cursor-grab touch-none items-center gap-2 rounded-full border bg-popover pl-2.5 pr-1 shadow-md hover:bg-accent-soft active:cursor-grabbing"
				aria-label={t("askPanel.title")}
				aria-expanded={expanded}
				onPointerDown={handlePointerDown}
				onClick={() => {
					if (lastDragMovedRef.current) {
						lastDragMovedRef.current = false;
						return;
					}
					setExpanded((value) => !value);
				}}
			>
				{panel.creating ? (
					<Loader2 size={14} className="animate-pideck-spin text-muted-foreground" aria-hidden="true" />
				) : running ? (
					<span className="relative flex size-2" aria-hidden="true">
						<span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-75" />
						<span className="relative inline-flex size-2 rounded-full bg-emerald-500" />
					</span>
				) : done ? (
					<Check size={14} className="text-emerald-500" aria-hidden="true" />
				) : (
					<MessageSquarePlus size={14} className="text-muted-foreground" aria-hidden="true" />
				)}
				<span className="truncate text-xs text-foreground/90">{questionSummary || summary || (panel.creating ? t("askPanel.creating") : t("askPanel.waiting"))}</span>
				{running && !panel.creating ? (
					<span className="inline-flex shrink-0 items-center gap-0.5 text-micro font-medium text-emerald-600 dark:text-emerald-400">
						<span className="size-1.5 animate-pulse rounded-full bg-emerald-500" aria-hidden="true" />
						{t("askPanel.running")}
					</span>
				) : null}
				<span
					className="flex size-5 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted/60 hover:text-foreground"
					aria-label={t("askPanel.close")}
					title={t("askPanel.close")}
					role="button"
					tabIndex={-1}
					onClick={(event) => {
						event.stopPropagation();
						void panel.close();
					}}
				>
					<X size={12} aria-hidden="true" />
				</span>
				{expanded ? <ChevronDown size={13} className="shrink-0 text-muted-foreground" aria-hidden="true" /> : <ChevronRight size={13} className="shrink-0 text-muted-foreground" aria-hidden="true" />}
			</button>
		</div>
	);
}
