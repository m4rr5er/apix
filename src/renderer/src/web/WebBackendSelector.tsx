import { useState } from "react";
import { Check, ChevronsUpDown, Image as ImageIcon, SquareTerminal } from "lucide-react";
import type { AgentBackend } from "../../../shared/types";
import { Button } from "@/components/ui-shadcn/button";
import { t } from "@/i18n";
import { cn } from "@/lib/utils";
import { WebBottomSheet } from "./WebBottomSheet";

function backendOptions(): { value: AgentBackend; label: string; desc: string }[] {
	return [
		{ value: "pi", label: "Pi", desc: t("web.backendPiDesc") },
		{ value: "imagegen", label: t("web.backendImagegen"), desc: t("web.backendImagegenDesc") },
	];
}

function BackendOptionMark(props: { backend: AgentBackend }) {
	if (props.backend === "imagegen") return <ImageIcon className="size-4 text-violet-600 dark:text-violet-400" aria-hidden="true" />;
	return <SquareTerminal className="size-4" aria-hidden="true" />;
}

export function WebBackendSelector(props: { backend: AgentBackend; locked: boolean; onChange: (backend: AgentBackend) => void }) {
	const [open, setOpen] = useState(false);
	const options = backendOptions();
	const label = options.find((option) => option.value === props.backend)?.label ?? "Pi";

	return (
		<>
			<Button
				type="button"
				variant="ghost"
				disabled={props.locked}
				aria-label={t("session.backendPickerHint")}
				title={props.locked ? t("session.backendLockedHint") : t("session.backendPickerHint")}
				className="h-8 shrink-0 gap-1 px-1 text-caption text-muted-foreground hover:bg-muted/60 hover:text-foreground disabled:opacity-60 pointer-coarse:h-9"
				onClick={() => setOpen(true)}
			>
				<span className="min-w-0 truncate">{label}</span>
				<ChevronsUpDown className="size-3.5 shrink-0" aria-hidden="true" />
			</Button>
			<WebBottomSheet open={open} onOpenChange={setOpen} title={t("web.backendSheetTitle")}>
				{props.locked ? (
					<p className="px-4 py-4 text-sm text-muted-foreground">{t("session.backendLockedNotice")}</p>
				) : (
					<div className="flex flex-col pb-2">
						{options.map((option) => {
							const selected = option.value === props.backend;
							return (
								<button
									type="button"
									key={option.value}
									aria-pressed={selected}
									className={cn("flex h-12 w-full items-center gap-3 px-4 text-left transition-colors hover:bg-muted/60", selected && "bg-muted/40")}
									onClick={() => {
										setOpen(false);
										if (!selected) props.onChange(option.value);
									}}
								>
									<span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-foreground">
										<BackendOptionMark backend={option.value} />
									</span>
									<span className="min-w-0 flex-1">
										<span className="block truncate text-sm font-medium text-foreground">{option.label}</span>
										<span className="block truncate text-xs text-muted-foreground">{option.desc}</span>
									</span>
									{selected && <Check className="size-4 shrink-0 text-primary" aria-hidden="true" />}
								</button>
							);
						})}
					</div>
				)}
			</WebBottomSheet>
		</>
	);
}
