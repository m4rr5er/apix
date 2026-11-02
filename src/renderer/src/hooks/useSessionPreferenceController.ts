import { useStore } from "jotai";
import { useCallback, useEffect, useRef, useState } from "react";
import type { AvailableModel, ModelListReport, SessionRuntimeModelSelection, SessionRuntimeTarget } from "../../../shared/types";
import { createSessionModelPreference } from "../../../shared/modelDisplayName";
import { currentSessionIdAtom, sessionFocusedByIdAtomFamily, sessionRuntimeByIdAtom } from "../atoms";
import { useSessionPreferenceState } from "./useSessionPreferenceState";
import { usePendingModelApply } from "./usePendingModelApply";
import { useSessionPaneServices } from "../components/session/SessionPaneServices";
import type { ThinkingPickerLevel } from "../components/session/sessionPickerOptions";
import { desktopApi } from "../desktopApi";
import { showNotice } from "../utils/notice";
import { t } from "../i18n";
import { SessionCommandFailure, requireSessionCommand, sessionCommandFailureToast, toSessionRuntimeTarget } from "../utils/sessionCommands";
import { resolveComposerLiveModel } from "../utils/modelPendingDisplay";
import { clampThinkingLevelToAllowed } from "../utils/thinkingDisplay";
import { modelKey, pickCycleModel, pickCycleThinkingLevel, resolveFavoriteCycleCandidates, type CycleDirection } from "../utils/preferenceCycle";
import { WELCOME_MODEL_KEY, WELCOME_THINKING_KEY } from "../utils/chatSessionBootstrap";

type PendingCycle = {
	kind: "model" | "thinking";
	isCurrent: () => boolean;
};

type ModelRestartIntent = {
	handle: SessionRuntimeTarget;
	isCurrent: () => boolean;
	provider: string;
	modelId: string;
	modelName: string;
};

export type SessionPreferenceController = {
	models: AvailableModel[];
	report: ModelListReport | null;
	catalogLoading: boolean;
	refreshing: boolean;
	reloadCatalog: (force?: boolean) => void;

	currentModel: { provider?: string; modelId?: string; modelName?: string };

	thinkingLevels: ThinkingPickerLevel[];

	currentThinkingLevel: string | undefined;

	favoriteModels: string[];
	recentProviders: string[];

	providerOrder: string[];
	hiddenProviders: string[];
	hiddenModels: string[];

	projectId: string | undefined;
	agentId: string | undefined;
	toggleFavorite: (provider: string, modelId: string) => Promise<void>;
	toggleHideModel: (provider: string, modelId: string) => Promise<void>;

	applyModel: (model: AvailableModel) => Promise<void>;

	canClearModel: boolean;
	clearModel: () => Promise<void>;

	applyThinking: (level: string, opts?: { keepOpen?: boolean }) => Promise<void>;

	cycleModel: (direction?: CycleDirection) => Promise<void>;

	cycleThinking: (direction?: CycleDirection) => Promise<void>;

	restartTarget: { handle: SessionRuntimeTarget; model: string } | null;
	restarting: boolean;
	confirmRestart: () => Promise<void>;
	cancelRestart: () => void;
};

export function useSessionPreferenceController(options: {
	sessionId: string;

	pickerOpen: boolean;

	thinkingPickerOpen: boolean;
	defaultModel?: { provider?: string; modelId?: string; modelName?: string };
	defaultThinkingLevel?: string;

	modelThinkingLevels?: Record<string, string>;

	onApplied: () => void;
}): SessionPreferenceController {
	const { sessionId, onApplied } = options;
	const store = useStore();

	const [cycleArmed, setCycleArmed] = useState(false);
	const [restartTarget, setRestartTarget] = useState<{
		handle: SessionRuntimeTarget;
		model: string;
	} | null>(null);
	const [restarting, setRestarting] = useState(false);
	const state = useSessionPreferenceState({
		sessionId,
		pickerOpen: options.pickerOpen,
		thinkingPickerOpen: options.thinkingPickerOpen,
		cycleArmed,
		defaultModel: options.defaultModel,
		defaultThinkingLevel: options.defaultThinkingLevel,
		modelThinkingLevels: options.modelThinkingLevels,
	});
	const { record, runtime, models, favoriteModels, favoritesLoaded, hiddenProviders, hiddenModels, modelPending, currentModel: resolvedLiveModel, thinkingLevels, currentThinkingLevel } = state;

	const { restartActiveAgent } = useSessionPaneServices();

	const restartIntentRef = useRef<ModelRestartIntent | null>(null);

	const restartingIntentRef = useRef<ModelRestartIntent | null>(null);
	const recordRef = useRef(record);
	recordRef.current = record;

	const selectionScopeRef = useRef({ sessionId, active: true });
	if (selectionScopeRef.current.sessionId !== sessionId) selectionScopeRef.current = { sessionId, active: true };
	useEffect(() => {
		const scope = selectionScopeRef.current;
		scope.active = true;
		return () => {
			scope.active = false;
		};
	}, [sessionId]);

	function captureSelection(handle: SessionRuntimeTarget | undefined) {
		const scope = selectionScopeRef.current;
		return () => {
			const current = currentHandle();
			return scope.sessionId === sessionId && selectionScopeRef.current === scope && scope.active && current?.agentId === handle?.agentId && current?.runtimeGeneration === handle?.runtimeGeneration;
		};
	}

	function writeSelectedModelToState(model: SessionRuntimeModelSelection) {
		const current = recordRef.current;
		if (!current) return;
		state.upsertSession({
			...current,
			model: createSessionModelPreference(model.provider, model.modelId, model.modelName),
			...(model.thinkingLevel !== undefined ? { thinkingLevel: model.thinkingLevel } : {}),
			updatedAt: Date.now(),
		});
	}

	function currentHandle() {
		return toSessionRuntimeTarget(sessionId, store.get(sessionRuntimeByIdAtom)[sessionId]);
	}

	function isUnavailableRuntimeFailure(error: unknown): boolean {
		return error instanceof SessionCommandFailure && error.code === "SESSION_RUNTIME_UNAVAILABLE";
	}

	function selectedModelPreference(model: AvailableModel) {
		return createSessionModelPreference(model.provider, model.id, model.name);
	}

	async function applyModelToRecord(model: AvailableModel, isCurrent: () => boolean) {
		const modelLevels = model.thinkingLevels;
		const nextThinking = modelLevels !== undefined ? clampThinkingLevelToAllowed(record?.thinkingLevel, modelLevels) : record?.thinkingLevel;
		const updated = await desktopApi.sessions.updateRecord(sessionId, {
			model: selectedModelPreference(model),
			...(nextThinking !== record?.thinkingLevel ? { thinkingLevel: nextThinking } : {}),
		});
		if (isCurrent()) state.upsertSession(updated);
	}

	function currentLiveModel() {
		return resolveComposerLiveModel({
			record: record?.model,
		});
	}

	function markModelPending(model: AvailableModel) {
		const live = currentLiveModel();
		const from = modelPending?.from ?? {
			provider: live.provider,
			modelId: live.modelId,
			modelName: live.modelName,
		};
		if (from.provider === model.provider && from.modelId === model.id) {
			state.setModelPending(undefined);
			return;
		}
		const selected = selectedModelPreference(model);
		state.setModelPending({
			from,
			to: selected,
		});
	}

	function offerModelRestart(handle: SessionRuntimeTarget, model: AvailableModel) {
		const isCurrent = captureSelection(handle);
		if (!isCurrent()) return;
		onApplied();
		const selected = selectedModelPreference(model);
		restartIntentRef.current = {
			handle,
			isCurrent,
			...selected,
		};
		setRestartTarget({
			handle,
			model: modelKey(model.provider, model.id),
		});
	}

	usePendingModelApply({
		sessionId,
		runtime,
		modelPending,
		applySelectedModel: (model) => writeSelectedModelToState(model),
		clearPending: () => state.setModelPending(undefined),
		offerRestart: offerModelRestart,
	});

	async function pickModelWhileBusy(handle: SessionRuntimeTarget, model: AvailableModel, isCurrent: () => boolean) {
		try {
			const listed = requireSessionCommand(await desktopApi.sessions.listRuntimeModels(handle));
			if (!isCurrent()) return;
			const snapshotHasModel = listed.value.some((item) => item.provider === model.provider && item.id === model.id);
			if (!snapshotHasModel) {
				offerModelRestart(handle, model);
				return;
			}
		} catch (error) {
			if (error instanceof SessionCommandFailure && error.code === "SESSION_RUNTIME_CHANGED") throw error;
		}
		if (!isCurrent()) return;
		await applyModelToRecord(model, isCurrent);
		if (!isCurrent()) return;
		markModelPending(model);
		onApplied();
	}

	async function applyModel(model: AvailableModel) {
		if (!record) {
			try {
				localStorage.setItem(WELCOME_MODEL_KEY, JSON.stringify(selectedModelPreference(model)));
			} catch {}
			onApplied();
			return;
		}
		const selected = selectedModelPreference(model);
		const handle = currentHandle();
		const isCurrent = captureSelection(handle);
		try {
			if (handle) {
				try {
					const applied = requireSessionCommand(await desktopApi.sessions.setRuntimeModel(handle, selected.provider, selected.modelId, selected.modelName));
					if (!isCurrent()) return;
					writeSelectedModelToState(applied.value);
					state.setModelPending(undefined);
				} catch (error) {
					if (!isCurrent()) return;
					if (error instanceof SessionCommandFailure && error.code === "SESSION_RUNTIME_BUSY") {
						await pickModelWhileBusy(handle, model, isCurrent);
						return;
					}

					if (!isUnavailableRuntimeFailure(error)) throw error;
					await applyModelToRecord(model, isCurrent);
				}
			} else {
				await applyModelToRecord(model, isCurrent);
			}
			if (isCurrent()) onApplied();
		} catch (error) {
			if (!isCurrent()) return;

			if (error instanceof SessionCommandFailure && error.needsRestart && handle) {
				offerModelRestart(handle, model);
				return;
			}

			showNotice(sessionCommandFailureToast(error), 4000);
		}
	}

	const canClearModel = (!record || record.status === "draft") && !runtime?.agentId;

	async function clearModel() {
		const ownsSelection = captureSelection(undefined);
		const isCurrent = () => ownsSelection() && (record ? recordRef.current?.status === "draft" : !recordRef.current);
		if (!isCurrent()) return;
		try {
			if (record) {
				const updated = await desktopApi.sessions.updateRecord(sessionId, { model: null });
				if (!isCurrent()) return;
				state.upsertSession(updated);
			} else {
				localStorage.removeItem(WELCOME_MODEL_KEY);
			}
			state.setModelPending(undefined);
			onApplied();
		} catch (error) {
			if (isCurrent()) showNotice(error instanceof Error ? error.message : String(error), 4000);
		}
	}

	async function applyThinking(level: string, opts?: { keepOpen?: boolean }) {
		const keepOpen = opts?.keepOpen ?? false;

		if (!record) {
			try {
				localStorage.setItem(WELCOME_THINKING_KEY, level);
			} catch {}

			if (keepOpen) state.bumpWelcomePreference();
			if (!keepOpen) onApplied();
			return;
		}
		const handle = currentHandle();
		const isCurrent = captureSelection(handle);
		try {
			if (handle) {
				try {
					const applied = requireSessionCommand(await desktopApi.sessions.setRuntimeThinking(handle, level));
					if (!isCurrent()) return;
					const current = recordRef.current;
					if (current) {
						state.upsertSession({ ...current, thinkingLevel: applied.value.thinkingLevel, updatedAt: Date.now() });
					}
				} catch (error) {
					if (!isCurrent()) return;

					if (!isUnavailableRuntimeFailure(error)) throw error;
					const updated = await desktopApi.sessions.updateRecord(sessionId, {
						thinkingLevel: level,
					});
					if (isCurrent()) state.upsertSession(updated);
				}
			} else {
				const updated = await desktopApi.sessions.updateRecord(sessionId, {
					thinkingLevel: level,
				});
				if (isCurrent()) state.upsertSession(updated);
			}
			if (isCurrent() && !keepOpen) onApplied();
		} catch (error) {
			if (!isCurrent()) return;

			showNotice(sessionCommandFailureToast(error), 4000);
		}
	}

	const applyModelRef = useRef(applyModel);
	applyModelRef.current = applyModel;
	const applyThinkingRef = useRef(applyThinking);
	applyThinkingRef.current = applyThinking;

	const cycleModel = useCallback(
		async (direction: CycleDirection = "forward") => {
			const currentKey = resolvedLiveModel.provider && resolvedLiveModel.modelId ? modelKey(resolvedLiveModel.provider, resolvedLiveModel.modelId) : undefined;
			const candidates = resolveFavoriteCycleCandidates({
				favorites: favoriteModels,
				models,
				hiddenProviders,
				hiddenModels,
				backend: "pi",
			});
			if (candidates.length === 0) {
				showNotice(t("app.cycleModelEmpty"), 2500, "info", undefined, undefined, "preference-cycle");
				return;
			}
			if (candidates.length === 1) {
				const only = candidates[0];

				if (modelKey(only.provider, only.id) !== currentKey) await applyModelRef.current(only);
				else showNotice(t("app.cycleModelSingle"), 2500, "info", undefined, undefined, "preference-cycle");
				return;
			}
			const target = pickCycleModel({ candidates, currentKey, direction });
			if (target) await applyModelRef.current(target);
		},
		[resolvedLiveModel.provider, resolvedLiveModel.modelId, favoriteModels, models, hiddenProviders, hiddenModels],
	);

	const cycleThinking = useCallback(
		async (direction: CycleDirection = "forward") => {
			const next = pickCycleThinkingLevel({
				levels: thinkingLevels,
				current: currentThinkingLevel,
				direction,
			});
			if (!next) {
				showNotice(t("app.cycleThinkingUnsupported"), 2500, "info", undefined, undefined, "preference-cycle");
				return;
			}
			await applyThinkingRef.current(next);
		},
		[thinkingLevels, currentThinkingLevel],
	);

	const cycleModelRef = useRef(cycleModel);
	cycleModelRef.current = cycleModel;
	const cycleThinkingRef = useRef(cycleThinking);
	cycleThinkingRef.current = cycleThinking;

	const pendingCycleRef = useRef<PendingCycle | null>(null);
	useEffect(() => {
		const focusedAtom = sessionFocusedByIdAtomFamily(sessionId);
		return store.sub(focusedAtom, () => {
			if (!store.get(focusedAtom)) pendingCycleRef.current = null;
		});
	}, [sessionId, store]);
	const catalogReady = models.length > 0;
	useEffect(() => {
		const pending = pendingCycleRef.current;
		if (!pending) return;

		if (!pending.isCurrent() || store.get(currentSessionIdAtom) !== sessionId) {
			pendingCycleRef.current = null;
			return;
		}
		if (!favoritesLoaded) return;
		if (!catalogReady) {
			if (state.report !== null && !state.catalogLoading) {
				pendingCycleRef.current = null;
				showNotice(t("app.cycleModelCatalogFailed"), 3000, "warning", undefined, undefined, "preference-cycle");
			}
			return;
		}
		pendingCycleRef.current = null;
		if (pending.kind === "model") void cycleModelRef.current("forward");
		else void cycleThinkingRef.current("forward");
	}, [sessionId, runtime?.agentId, runtime?.runtimeGeneration, store, favoritesLoaded, catalogReady, state.catalogLoading, state.report]);

	useEffect(() => {
		return desktopApi.app.onShortcutTriggered((id) => {
			if (id !== "cycleModel" && id !== "cycleThinking") return;

			if (store.get(currentSessionIdAtom) !== sessionId) return;
			if (!catalogReady || !favoritesLoaded) {
				setCycleArmed(true);
				pendingCycleRef.current = {
					kind: id === "cycleModel" ? "model" : "thinking",
					isCurrent: captureSelection(currentHandle()),
				};
				return;
			}
			if (id === "cycleModel") void cycleModelRef.current("forward");
			else void cycleThinkingRef.current("forward");
		});
	}, [sessionId, store, catalogReady, favoritesLoaded]);

	const confirmationIntent = restartIntentRef.current;

	async function confirmRestart() {
		const intent = confirmationIntent;
		if (!intent || restartIntentRef.current !== intent || intent.handle.sessionId !== sessionId || !intent.isCurrent() || restartingIntentRef.current?.isCurrent()) return;
		restartingIntentRef.current = intent;
		setRestarting(true);

		setRestartTarget(null);
		try {
			const updated = await desktopApi.sessions.updateRecord(intent.handle.sessionId, {
				model: {
					provider: intent.provider,
					modelId: intent.modelId,
					modelName: intent.modelName,
				},
			});

			if (!intent.isCurrent() || restartIntentRef.current !== intent) return;
			state.upsertSession(updated);
			state.setModelPending(undefined);
			await restartActiveAgent(intent.handle.agentId);
		} catch (error) {
			if (intent.isCurrent()) showNotice(error instanceof Error ? error.message : String(error), 4000);
		} finally {
			if (restartIntentRef.current === intent) restartIntentRef.current = null;
			if (restartingIntentRef.current === intent) {
				restartingIntentRef.current = null;
				setRestarting(false);
			}
		}
	}

	function cancelRestart() {
		if (confirmationIntent && restartIntentRef.current === confirmationIntent && confirmationIntent.isCurrent()) setRestartTarget(null);
	}

	return {
		models,
		report: state.report,
		catalogLoading: state.catalogLoading,
		refreshing: state.refreshing,
		reloadCatalog: state.reloadCatalog,
		currentModel: resolvedLiveModel,
		thinkingLevels,
		currentThinkingLevel,
		favoriteModels,
		recentProviders: state.recentProviders,
		providerOrder: state.providerOrder,
		hiddenProviders,
		hiddenModels,
		projectId: state.projectId,
		agentId: state.agentId,
		toggleFavorite: state.toggleFavorite,
		toggleHideModel: state.toggleHideModel,
		applyModel: (model) => applyModelRef.current(model),
		canClearModel,
		clearModel,
		applyThinking: (level, opts) => applyThinkingRef.current(level, opts),
		cycleModel,
		cycleThinking,
		restartTarget: restartIntentRef.current?.isCurrent() ? restartTarget : null,
		restarting: restarting && Boolean(restartingIntentRef.current?.isCurrent()),
		confirmRestart,
		cancelRestart,
	};
}
