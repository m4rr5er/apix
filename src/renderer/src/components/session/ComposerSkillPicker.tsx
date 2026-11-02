import { useEffect, useState } from "react";
import { useAtomValue } from "jotai";
import { ChevronLeft, CornerDownLeft, Eye, Loader2, Sparkles } from "lucide-react";
import { toSkillInvocationToken } from "../../composerBehavior";
import { t } from "../../i18n";
import { desktopApi } from "../../desktopApi";
import { projectByIdAtomFamily } from "../../atoms";
import type { AgentBackend } from "../../../../shared/types";
import { emptyProjectResourceDiscovery, type SkillCatalogEntry, mergePiSkillCatalog } from "../../../../shared/skillCatalog";
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "../ui-shadcn/command";
import { Button } from "../ui-shadcn/button";
import { PickerDialog } from "./ComposerComponents";
import { showNotice } from "../../utils/notice";

type SkillItem = SkillCatalogEntry;

type SkillDetailState = {
	item: SkillItem;
	loading: boolean;
	content?: string;
	error: string | null;
};

export function ComposerSkillPicker(props: {
	projectId?: string;
	onClose: () => void;
	onPick: (name: string) => void;

	onInsertContent?: (content: string) => void;
}) {
	const [items, setItems] = useState<SkillItem[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [detail, setDetail] = useState<SkillDetailState | null>(null);

	const chatProject = useAtomValue(projectByIdAtomFamily(props.projectId ?? ""));
	const isChatSessionProject = chatProject?.kind === "chat";
	const hasProjectResources = Boolean(props.projectId) && !isChatSessionProject;

	useEffect(() => {
		let cancelled = false;
		setLoading(true);
		setError(null);
		void Promise.all([hasProjectResources ? desktopApi.projectResources.list(props.projectId as string).then((result) => result.skills) : Promise.resolve([]), desktopApi.skills.list().then((result) => result.skills), desktopApi.projectResources.discovery(props.projectId).catch(() => emptyProjectResourceDiscovery())])
			.then(([projectSkills, globalSkills, discovery]) => mergePiSkillCatalog({ projectSkills, globalSkills, discovery }))
			.then((next) => {
				if (!cancelled) setItems(next);
			})
			.catch((reason) => {
				if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason));
			})
			.finally(() => {
				if (!cancelled) setLoading(false);
			});
		return () => {
			cancelled = true;
		};
	}, [hasProjectResources, isChatSessionProject, props.projectId]);

	function readContent(item: SkillItem): Promise<string | undefined> {
		if (!item.path) return Promise.resolve(undefined);
		return desktopApi.skills.readContent(item.path).then((result) => result.content);
	}

	function openDetail(item: SkillItem) {
		setDetail({ item, loading: true, error: null });
		void readContent(item)
			.then((content) => {
				setDetail((prev) => (prev?.item.name === item.name ? { item, content, loading: false, error: null } : prev));
			})
			.catch((reason) => {
				setDetail((prev) =>
					prev?.item.name === item.name
						? {
								item,
								loading: false,
								error: reason instanceof Error ? reason.message : String(reason),
							}
						: prev,
				);
			});
	}

	function insertContent(item: SkillItem) {
		void readContent(item)
			.then((content) => {
				if (content !== undefined) props.onInsertContent?.(content);
			})
			.catch((reason) => {
				showNotice(reason instanceof Error ? reason.message : String(reason), 4000);
			});
	}

	if (detail) {
		return (
			<PickerDialog title={t("app.skillPreviewTitle", { name: "/" + detail.item.name })} onClose={props.onClose} className="skill-picker">
				<div className="picker-preview-inline">
					<div className="flex items-center justify-between gap-2">
						<Button type="button" variant="ghost" className="h-auto gap-1 px-1 text-caption" onClick={() => setDetail(null)} title={t("app.skillPreviewBack")}>
							<ChevronLeft size={16} strokeWidth={2.2} />
							{t("app.skillPreviewBack")}
						</Button>

						{props.onInsertContent && (
							<Button type="button" variant="outline" size="sm" className="h-7 gap-1" disabled={!detail.content} onClick={() => detail.content !== undefined && props.onInsertContent?.(detail.content)} title={t("app.pickerInsertContent")}>
								<CornerDownLeft size={13} strokeWidth={2} aria-hidden="true" />
								{t("app.pickerInsertContent")}
							</Button>
						)}
					</div>
					{detail.loading ? (
						<div className="flex items-center justify-center gap-2 py-6 text-caption text-muted-foreground">
							<Loader2 size={14} className="animate-pideck-spin" aria-hidden="true" />
							{t("app.skillPickerLoading")}
						</div>
					) : detail.error ? (
						<div className="flex flex-col items-center gap-1.5 px-4 py-6 text-caption">
							<span className="font-medium text-foreground">{t("app.skillContentLoadFailed")}</span>
							<span className="text-muted-foreground">{t("app.skillPickerLoadFailedNote")}</span>
							<pre className="max-h-28 w-full overflow-auto whitespace-pre-wrap break-all rounded-md border border-border/60 bg-muted/40 p-2.5 font-mono text-micro leading-relaxed text-muted-foreground">{detail.error}</pre>
						</div>
					) : (
						<pre className="picker-preview-content">{detail.content}</pre>
					)}
				</div>
			</PickerDialog>
		);
	}

	const globalOnly = !hasProjectResources;

	return (
		<PickerDialog title={t("app.skillPickerTitle")} hint={t("app.skillPickerHint")} onClose={props.onClose} className="skill-picker">
			<Command>
				<CommandInput placeholder={t("app.skillPickerSearchPlaceholder")} autoFocus />
				<CommandList className="max-h-[min(420px,55vh)]">
					{!loading && !error && <CommandEmpty>{t("app.skillPickerSearchEmpty")}</CommandEmpty>}
					{loading ? (
						<div className="flex items-center justify-center gap-2 py-6 text-caption text-muted-foreground">
							<Loader2 size={14} className="animate-pideck-spin" aria-hidden="true" />
							{t("app.skillPickerLoading")}
						</div>
					) : error ? (
						<div className="flex flex-col items-center gap-1.5 px-4 py-6 text-caption">
							<span className="font-medium text-foreground">{t("app.skillPickerLoadFailed")}</span>
							<span className="text-muted-foreground">{t("app.skillPickerLoadFailedNote")}</span>
							{error && <pre className="max-h-28 w-full overflow-auto whitespace-pre-wrap break-all rounded-md border border-border/60 bg-muted/40 p-2.5 font-mono text-micro leading-relaxed text-muted-foreground">{error}</pre>}
						</div>
					) : items.length === 0 ? (
						<div className="px-6 py-10 text-center text-caption text-muted-foreground">{globalOnly ? (isChatSessionProject ? t("app.skillPickerChatProject") : t("app.skillPickerNoProject")) : t("app.skillPickerEmpty")}</div>
					) : (
						items.map((skill) => (
							<CommandItem key={skill.name} value={`/${skill.name}`} keywords={[skill.name, skill.description, skill.whenToUse ?? "", toSkillInvocationToken("pi", skill.name)]} onSelect={() => props.onPick(skill.name)} className="group min-h-10 items-center gap-2.5 rounded-md px-3 py-2">
								<span className="grid size-7 shrink-0 place-items-center rounded-md bg-muted/70 text-muted-foreground">
									<Sparkles size={14} strokeWidth={1.8} aria-hidden="true" />
								</span>
								<span className="min-w-0 flex-1">
									<span className="flex items-center gap-1.5">
										<span className="truncate font-mono text-control font-semibold text-foreground" title={`/${toSkillInvocationToken("pi", skill.name)}`}>
											/{toSkillInvocationToken("pi", skill.name)}
										</span>

										{skill.source && (
											<span className="shrink-0 inline-flex items-center rounded bg-sky-500/12 px-1.5 py-0.5 text-micro font-medium text-sky-600 dark:text-sky-400" title={skill.sourceLabel}>
												{skill.source === "global" ? t("app.skillBadgeGlobal") : t("app.skillBadgeProject")}
											</span>
										)}
									</span>
									{skill.description && (
										<span className="mt-0.5 block truncate text-caption text-muted-foreground" title={skill.description}>
											{skill.description}
										</span>
									)}
								</span>

								{skill.path && (
									<Button
										type="button"
										variant="ghost"
										size="icon-sm"
										title={t("common.preview")}
										onClick={(e) => {
											e.stopPropagation();
											openDetail(skill);
										}}
									>
										<Eye size={14} strokeWidth={1.8} aria-hidden="true" />
									</Button>
								)}
								{skill.path && props.onInsertContent && (
									<Button
										type="button"
										variant="ghost"
										size="icon-sm"
										title={t("app.pickerInsertContent")}
										onClick={(e) => {
											e.stopPropagation();
											insertContent(skill);
										}}
									>
										<CornerDownLeft size={14} strokeWidth={1.8} aria-hidden="true" />
									</Button>
								)}
							</CommandItem>
						))
					)}
				</CommandList>
			</Command>
		</PickerDialog>
	);
}
