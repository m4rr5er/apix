import type { ReactNode } from "react";
import type { PromptTemplateInfo } from "../../composerBehavior";
import { ModelPicker, PromptTemplatePicker } from "./ComposerParts";
import { ThinkingLevelDropdown } from "./ModelThinkingChip";
import { ComposerSkillPicker } from "./ComposerSkillPicker";
import { t } from "../../i18n";
import { ConfirmDialog } from "../app/AppParts";
import type { ComposerPickerKind } from "../../hooks/useSessionComposerController";
import { useSessionPreferenceController } from "../../hooks/useSessionPreferenceController";

export type ComposerPickerHostProps = {
	sessionId: string;
	picker: ComposerPickerKind | null;
	templates: PromptTemplateInfo[];
	onClose: () => void;
	onOpenThinking: () => void;
	thinkingDisabled?: boolean;

	children: (thinkingControl: ReactNode) => ReactNode;
	onInsertTemplate: (template: PromptTemplateInfo) => void;

	onInsertTemplateContent: (template: PromptTemplateInfo) => void;

	onInsertSkill: (name: string) => void;

	onInsertSkillContent: (content: string) => void;

	defaultModel?: { provider?: string; modelId?: string; modelName?: string };
	defaultThinkingLevel?: string;

	modelThinkingLevels?: Record<string, string>;
};

export function ComposerPickerHost(props: ComposerPickerHostProps) {
	const preference = useSessionPreferenceController({
		sessionId: props.sessionId,
		pickerOpen: props.picker === "model" || props.picker === "thinking",
		thinkingPickerOpen: props.picker === "thinking",
		defaultModel: props.defaultModel,
		defaultThinkingLevel: props.defaultThinkingLevel,
		modelThinkingLevels: props.modelThinkingLevels,

		onApplied: props.onClose,
	});

	const thinkingControl = (
		<ThinkingLevelDropdown
			current={preference.currentThinkingLevel}
			levels={preference.thinkingLevels}
			open={props.picker === "thinking"}
			onOpenChange={(open) => (open ? props.onOpenThinking() : props.onClose())}
			disabled={props.thinkingDisabled}
			onPick={(level) => void preference.applyThinking(level, { keepOpen: true })}
		/>
	);

	return (
		<>
			{props.children(thinkingControl)}
			{renderDialog()}
		</>
	);

	function renderDialog() {
		if (props.picker === "template") {
			return <PromptTemplatePicker templates={props.templates} onClose={props.onClose} onPick={props.onInsertTemplate} onInsertContent={props.onInsertTemplateContent} />;
		}
		if (props.picker === "skill") {
			return <ComposerSkillPicker projectId={preference.projectId} onClose={props.onClose} onPick={props.onInsertSkill} onInsertContent={props.onInsertSkillContent} />;
		}
		if (props.picker === "model") {
			return (
				<ModelPicker
					models={preference.models}
					report={preference.report}
					loading={preference.catalogLoading}
					refreshing={preference.refreshing}
					onRefresh={() => preference.reloadCatalog(true)}
					current={preference.currentModel}
					onClose={props.onClose}
					onPick={(model) => void preference.applyModel(model)}
					onClear={preference.canClearModel ? () => void preference.clearModel() : undefined}
					favoriteModels={preference.favoriteModels}
					onToggleFavorite={(provider, modelId) => void preference.toggleFavorite(provider, modelId)}
					recentProviders={preference.recentProviders}
					providerOrder={preference.providerOrder}
					hiddenProviders={preference.hiddenProviders}
					hiddenModels={preference.hiddenModels}
					onToggleHideModel={(provider, modelId) => void preference.toggleHideModel(provider, modelId)}
					backend="pi"
				/>
			);
		}
		return (
			<>
				{preference.restartTarget && (
					<ConfirmDialog
						title={t("app.modelRestartTitle")}
						message={t("app.modelRestartBody", { model: preference.restartTarget.model })}
						confirmLabel={t("common.confirm")}
						onConfirm={() => {
							void preference.confirmRestart();
						}}
						onCancel={() => {
							preference.cancelRestart();
						}}
					/>
				)}
			</>
		);
	}
}
