import { useRef, useState } from "react";
import { atomWithStorage } from "jotai/utils";
import { NotebookPen } from "lucide-react";
import { useAtom } from "jotai";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "../ui-shadcn/dialog";
import { Textarea } from "../ui-shadcn/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui-shadcn/tooltip";
import { Button } from "../ui-shadcn/button";
import { t } from "../../i18n";

export const memoTextAtom = atomWithStorage<string>("apix:memo-text:v1", "", undefined, { getOnInit: true });

export function MemoEditor() {
	const [open, setOpen] = useState(false);
	const [text, setText] = useAtom(memoTextAtom);
	const [draft, setDraft] = useState(text);

	const [tooltipOpen, setTooltipOpen] = useState(false);
	const pointerInsideRef = useRef(false);

	const openEditor = (next: boolean) => {
		if (next) {
			setDraft(text);

			pointerInsideRef.current = false;
			setTooltipOpen(false);
		}
		setOpen(next);
	};

	return (
		<Dialog open={open} onOpenChange={openEditor}>
			<Tooltip
				open={tooltipOpen}
				onOpenChange={(next) => {
					if (!next) {
						setTooltipOpen(false);
						return;
					}

					if (pointerInsideRef.current) setTooltipOpen(true);
				}}
				delayDuration={300}
			>
				<TooltipTrigger asChild>
					<DialogTrigger asChild>
						<Button
							type="button"
							variant="ghost"
							className="size-full rounded-full text-muted-foreground hover:bg-bg-hover hover:text-foreground"
							aria-label={t("memo.title")}
							onPointerEnter={() => {
								pointerInsideRef.current = true;
							}}
							onPointerLeave={() => {
								pointerInsideRef.current = false;

								setTooltipOpen(false);
							}}
							onBlur={() => setTooltipOpen(false)}
							onClick={() => {
								pointerInsideRef.current = false;
							}}
						>
							<NotebookPen className="size-4" />
						</Button>
					</DialogTrigger>
				</TooltipTrigger>
				<TooltipContent side="right" sideOffset={6}>
					{t("memo.title")}
				</TooltipContent>
			</Tooltip>
			<DialogContent className="flex h-[min(720px,80vh)] flex-col sm:max-w-3xl">
				<DialogHeader>
					<DialogTitle>{t("memo.title")}</DialogTitle>
					<DialogDescription>{t("memo.description")}</DialogDescription>
				</DialogHeader>
				<Textarea value={draft} onChange={(event) => setDraft(event.target.value)} placeholder={t("memo.placeholder")} className="min-h-0 flex-1 resize-none font-mono text-sm leading-6" spellCheck={false} autoFocus />
				<div className="flex items-center justify-between gap-2 text-caption text-muted-foreground">
					<span>{t("memo.characterCount", { count: String(draft.length) })}</span>
					<Button
						type="button"
						size="sm"
						onClick={() => {
							setText(draft);
							setOpen(false);
						}}
					>
						{t("memo.save")}
					</Button>
				</div>
			</DialogContent>
		</Dialog>
	);
}
