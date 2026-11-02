import { X } from "lucide-react";
import { t } from "../../i18n";
import { cn } from "../../lib/utils";
import { Button } from "../ui-shadcn/button";
import { ConfirmDialog as ShadcnConfirmDialog } from "../ui-shadcn/ConfirmDialog";
import { Dialog, DialogClose, DialogContent, DialogHeader, DialogTitle } from "../ui-shadcn/dialog";
import type { PiInstallation, PiInstallStatus, PiInstallExecResult } from "../../../../shared/types";
import type { PiEnvironmentGuide } from "../../hooks/usePiEnvironmentGuide";
import { PiCommandSourcePanel } from "../app/PiCommandSourcePanel";
import { shouldOfferInstallationChoice } from "../../utils/piInstallationOptions";
import { EnvironmentSetupPanel, type EnvironmentSetupPanelProps } from "./EnvironmentSetupPanel";

export function EnvironmentDialog(props: {
	status: PiInstallStatus | null;
	checking: boolean;

	setupPreview?: boolean;
	onClose: () => void;
	onRecheck: () => void;
	onOpenInstallDocs: () => void;

	guide: PiEnvironmentGuide;

	customPath: string;

	customPathValidating: boolean;

	customPathResult: PiInstallStatus | null;
	onCustomPathChange: (path: string) => void;
	onValidateCustomPath: () => void;

	installations?: PiInstallation[];

	applyingInstallationPath?: string | null;
	onChooseInstallation?: (path: string) => void;

	onShellProbeInstallations?: () => void;
	shellProbingInstallations?: boolean;

	onBrowsePiPath: () => void;
	browsingPiPath: boolean;

	installCommand: string;

	installExecuting: boolean;

	installResult: PiInstallExecResult | null;

	installCompleted: boolean;
	onInstallCommandChange: (cmd: string) => void;
	onExecInstall: () => void;
	onRestartApp: () => void;

	onClearCheckFlag?: () => void;
}) {
	const installed = !props.setupPreview && (props.status?.installed || props.customPathResult?.installed);
	const searchedDirs = props.status?.searchedDirs.slice(0, 16) ?? [];
	const errorText = props.status?.error ?? props.customPathResult?.error;

	return (
		<Dialog open onOpenChange={(next) => !next && props.onClose()}>
			<DialogContent showCloseButton={false} className={cn("flex flex-col gap-0 overflow-hidden p-0 sm:max-w-[min(800px,calc(100vw-48px))] max-h-[calc(100vh-48px)]", "environment-dialog")}>
				<DialogHeader className="flex-row items-center justify-between px-4 py-3">
					<DialogTitle>{t("environment.title")}</DialogTitle>
					<DialogClose asChild>
						<Button variant="ghost" size="icon" aria-label={t("common.close")} title={t("common.close")}>
							<X size={18} strokeWidth={2.2} aria-hidden="true" />
						</Button>
					</DialogClose>
				</DialogHeader>
				<div className="environment-body">
					{props.checking && (
						<div className="env-card env-loading-card">
							<div className="loader animate-pideck-spin" />
							<span>{t("environment.checking")}</span>
						</div>
					)}

					{!props.checking && installed && (
						<>
							<div className="env-card env-success-card">
								<div className="env-success-icon">✓</div>
								<div className="env-success-info">
									<strong>{t("environment.passed")}</strong>
									<span>
										{t("environment.path")}：{(props.customPathResult || props.status)?.command}
									</span>
									{(props.customPathResult || props.status)?.version && (
										<span>
											{t("environment.version")}：{(props.customPathResult || props.status)!.version}
										</span>
									)}

									{!shouldOfferInstallationChoice(props.installations ?? []) && <small>{t("environment.autoClose")}</small>}
								</div>
							</div>

							{shouldOfferInstallationChoice(props.installations ?? []) && props.onChooseInstallation && (
								<div className="env-card">
									<PiCommandSourcePanel
										variant="dialog"
										installations={props.installations ?? []}
										applyingPath={props.applyingInstallationPath}
										onChoose={props.onChooseInstallation}
										onShellProbe={props.onShellProbeInstallations}
										shellProbing={props.shellProbingInstallations}
										onBrowse={props.onBrowsePiPath}
										browsing={props.browsingPiPath}
									/>
								</div>
							)}
						</>
					)}

					{!props.checking && !installed && (
						<>
							{props.setupPreview && <p className="m-0 shrink-0 rounded-md border border-border-subtle bg-muted px-3 py-2 text-text-secondary text-caption">{t("environment.setupPreviewBanner")}</p>}
							<EnvironmentSetupPanel
								guide={props.guide}
								errorText={errorText}
								searchedDirs={searchedDirs}
								onOpenInstallDocs={props.onOpenInstallDocs}
								onChooseInstallation={props.onChooseInstallation}
								manual={{
									command: props.installCommand,
									executing: props.installExecuting,
									result: props.installResult,
									completed: props.installCompleted,
									onCommandChange: props.onInstallCommandChange,
									onExec: props.onExecInstall,
									onRestartApp: props.onRestartApp,
								}}
								customPath={{
									value: props.customPath,
									validating: props.customPathValidating,
									result: props.customPathResult,
									browsing: props.browsingPiPath,
									onChange: props.onCustomPathChange,
									onValidate: props.onValidateCustomPath,
									onBrowse: props.onBrowsePiPath,
								}}
							/>
						</>
					)}
				</div>

				<div className="environment-footer">
					<Button variant="default" size="sm" className="h-auto rounded-sm px-4 py-2.5 text-control" onClick={props.onRecheck} disabled={props.checking || props.customPathValidating || props.guide.installing}>
						{t("environment.recheck")}
					</Button>
					{props.onClearCheckFlag && (
						<Button variant="ghost" size="sm" className="env-clear-flag-btn h-auto rounded-sm px-4 py-2.5 text-control" onClick={props.onClearCheckFlag} title={t("environment.clearCheckFlagHint")}>
							{t("environment.clearCheckFlag")}
						</Button>
					)}
				</div>
			</DialogContent>
		</Dialog>
	);
}

export function ConfirmDialog(props: { title: string; message: string; onConfirm: () => void; onCancel: () => void; confirmLabel?: string; danger?: boolean }) {
	return <ShadcnConfirmDialog {...props} />;
}
