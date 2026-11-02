import { useId } from "react";
import { useAtomValue } from "jotai";
import { PanelRight } from "lucide-react";
import type { AgentBackend, SessionChannel, SessionSource } from "../../../../shared/types";
import type { AcpToolConfig } from "../../../../shared/types/acp";
import { ImageIcon, Terminal as TerminalIcon } from "lucide-react";
import { t } from "../../i18n";
import { cn } from "../../lib/utils";
import { acpToolsAtom } from "../../atoms/acp-atoms";
import { Badge } from "../ui-shadcn/badge";
import { PiTuiLogoMark, useBrandGlyph } from "../app/PiTuiLogo";
import { resolveAcpToolBrand, type AcpToolBrand } from "./acpToolBrand";

const SOURCE_LABELS: Record<SessionSource, string> = {
	pi: t("sessionSource.pi"),
	codex: t("sessionSource.codex"),
	claude: t("sessionSource.claude"),
	qoder: t("sessionSource.qoder"),
	opencode: t("sessionSource.opencode"),
	zcode: t("sessionSource.zcode"),
	workbuddy: t("sessionSource.workbuddy"),
	cursor: t("sessionSource.cursor"),
	kimi: t("sessionSource.kimi"),
	kimiwork: t("sessionSource.kimiwork"),
	minimax: t("sessionSource.minimax"),
};

const SOURCE_TONES: Record<SessionSource, string> = {
	pi: "border-cyan-300/70 text-cyan-700 dark:border-cyan-700/70 dark:text-cyan-300",
	codex: "border-indigo-300/70 text-indigo-700 dark:border-indigo-700/70 dark:text-indigo-300",
	claude: "border-amber-300/70 text-amber-700 dark:border-amber-700/70 dark:text-amber-300",

	opencode: "border-muted-foreground/40 text-muted-foreground",

	zcode: "border-muted-foreground/40 text-muted-foreground",

	workbuddy: "border-muted-foreground/40 text-muted-foreground",

	cursor: "border-muted-foreground/40 text-muted-foreground",

	qoder: "border-muted-foreground/40 text-muted-foreground",

	kimi: "border-muted-foreground/40 text-muted-foreground",

	kimiwork: "border-muted-foreground/40 text-muted-foreground",

	minimax: "border-muted-foreground/40 text-muted-foreground",
};

type BrandKey = SessionSource | Extract<AcpToolBrand, "gemini" | "qwen" | "codebuddy" | "qoder">;

function BrandMark(props: { brand: BrandKey; className?: string }) {
	const cls = props.className ?? "size-3.5";

	if (props.brand === "codex") {
		return (
			<svg viewBox="0 0 256 260" className={cls} aria-hidden="true" focusable="false">
				<path
					fill="currentColor"
					d="M239.184 106.203a64.72 64.72 0 0 0-5.576-53.103C219.452 28.459 191 15.784 163.213 21.74A65.586 65.586 0 0 0 52.096 45.22a64.72 64.72 0 0 0-43.23 31.36c-14.31 24.602-11.061 55.634 8.033 76.74a64.67 64.67 0 0 0 5.525 53.102c14.174 24.65 42.644 37.324 70.446 31.36a64.72 64.72 0 0 0 48.754 21.744c28.481.025 53.714-18.361 62.414-45.481a64.77 64.77 0 0 0 43.229-31.36c14.137-24.558 10.875-55.423-8.083-76.483m-97.56 136.338a48.4 48.4 0 0 1-31.105-11.255l1.535-.87l51.67-29.825a8.6 8.6 0 0 0 4.247-7.367v-72.85l21.845 12.636c.218.111.37.32.409.563v60.367c-.056 26.818-21.783 48.545-48.601 48.601M37.158 197.93a48.35 48.35 0 0 1-5.781-32.589l1.534.921l51.722 29.826a8.34 8.34 0 0 0 8.441 0l63.181-36.425v25.221a.87.87 0 0 1-.358.665l-52.335 30.184c-23.257 13.398-52.97 5.431-66.404-17.803M23.549 85.38a48.5 48.5 0 0 1 25.58-21.333v61.39a8.29 8.29 0 0 0 4.195 7.316l62.874 36.272l-21.845 12.636a.82.82 0 0 1-.767 0L41.353 151.53c-23.211-13.454-31.171-43.144-17.804-66.405zm179.466 41.695l-63.08-36.63L161.73 77.86a.82.82 0 0 1 .768 0l52.233 30.184a48.6 48.6 0 0 1-7.316 87.635v-61.391a8.54 8.54 0 0 0-4.4-7.213m21.742-32.69l-1.535-.922l-51.619-30.081a8.39 8.39 0 0 0-8.492 0L99.98 99.808V74.587a.72.72 0 0 1 .307-.665l52.233-30.133a48.652 48.652 0 0 1 72.236 50.391zM88.061 139.097l-21.845-12.585a.87.87 0 0 1-.41-.614V65.685a48.652 48.652 0 0 1 79.757-37.346l-1.535.87l-51.67 29.825a8.6 8.6 0 0 0-4.246 7.367zm11.868-25.58L128.067 97.3l28.188 16.218v32.434l-28.086 16.218l-28.188-16.218z"
				/>
			</svg>
		);
	}

	if (props.brand === "claude") {
		return (
			<svg viewBox="0 0 256 176" className={cls} aria-hidden="true" focusable="false">
				<path fill="currentColor" d="m147.487 0 70.081 175.78H256L185.919 0zM66.183 106.221l23.98-61.774 23.98 61.774zM70.07 0 0 175.78h39.18l14.33-36.914h73.308l14.328 36.914h39.179L110.255 0z" />
			</svg>
		);
	}

	if (props.brand === "opencode") {
		return (
			<svg viewBox="0 0 24 24" className={cls} aria-hidden="true" focusable="false">
				<path fill="currentColor" d="M22 24H2V0h20zM17 4.8H7v14.4h10z" />
			</svg>
		);
	}

	if (props.brand === "zcode") {
		return (
			<svg viewBox="0 0 24 24" className={cls} aria-hidden="true" focusable="false">
				<path fill="currentColor" d="M4 3h16v3.2L10.8 16H20v5H4v-3.2L13.2 8H4z" />
			</svg>
		);
	}

	if (props.brand === "workbuddy") {
		return (
			<svg viewBox="0 0 24 24" className={cls} aria-hidden="true" focusable="false">
				<path fill="currentColor" d="M1.6 4h3.3l2.5 12.2L10 4h4l2.6 12.2L19.1 4h3.3l-3.9 16h-3.7l-2.8-12-2.8 12H5.5z" />
			</svg>
		);
	}

	if (props.brand === "cursor") {
		return (
			<svg viewBox="0 0 24 24" className={cls} aria-hidden="true" focusable="false">
				<path fill="currentColor" d="M12 2.2 20.8 7.2 12 12.2 3.2 7.2Z" />
				<path fill="currentColor" opacity="0.66" d="M3.2 7.2 12 12.2V21.8L3.2 16.8Z" />
				<path fill="currentColor" opacity="0.4" d="M12 12.2 20.8 7.2V16.8L12 21.8Z" />
			</svg>
		);
	}

	if (props.brand === "kimi") {
		return (
			<svg viewBox="0 0 24 24" className={cls} aria-hidden="true" focusable="false">
				<path fill="currentColor" d="M4 3h3.4v7.4L15.6 3h4.2l-9.2 8.4L20.4 21h-4.3l-7.2-7.2-1.5 1.4V21H4z" />
			</svg>
		);
	}

	if (props.brand === "kimiwork") {
		return (
			<svg viewBox="0 0 24 24" className={cls} aria-hidden="true" focusable="false">
				<path fill="currentColor" d="M3 3.6h3.4V11l8.2-7.4h4.2l-9.2 8.4L20 20.4h-4.3l-7.2-7.2-1.1 1V20.4H3z" />
				<path fill="currentColor" d="M17.2 1.8h5v5h-5z" />
			</svg>
		);
	}

	if (props.brand === "minimax") {
		return (
			<svg viewBox="0 0 24 24" className={cls} aria-hidden="true" focusable="false">
				<path fill="currentColor" d="M3 4h3.3l6.7 10.2L19.7 4H23v16h-3.4v-9.9L13.9 18h-1.8L6.4 10.1V20H3z" />
			</svg>
		);
	}

	if (props.brand === "gemini") {
		return (
			<svg viewBox="0 0 24 24" className={cls} aria-hidden="true" focusable="false">
				<path fill="currentColor" d="M12 2c.6 3.3 1.8 5.4 3.6 6.4 1 .55 2.3.9 3.9 1.1l2.5.3-2.5.3c-1.6.2-2.9.55-3.9 1.1-1.8 1-3 3.1-3.6 6.4-.6-3.3-1.8-5.4-3.6-6.4-1-.55-2.3-.9-3.9-1.1L2 9.8l2.5-.3c1.6-.2 2.9-.55 3.9-1.1C10.2 7.4 11.4 5.3 12 2Z" />
				<path fill="currentColor" d="M18.6 15.4c.3 1.5.8 2.5 1.6 3 .5.25 1.05.4 1.8.5l-1.8.5c-.75.1-1.3.25-1.8.5-.8.5-1.3 1.5-1.6 3-.3-1.5-.8-2.5-1.6-3-.5-.25-1.05-.4-1.8-.5l1.8-.5c.75-.1 1.3-.25 1.8-.5.8-.5 1.3-1.5 1.6-3Z" />
			</svg>
		);
	}

	if (props.brand === "qwen") {
		return (
			<svg viewBox="0 0 24 24" className={cls} aria-hidden="true" focusable="false">
				<path fill="currentColor" fillRule="evenodd" d="M12 2.4a9.6 9.6 0 1 0 4.9 17.9l3 3 2.2-2.2-3-3A9.6 9.6 0 0 0 12 2.4Zm0 3.4a6.2 6.2 0 1 1 0 12.4 6.2 6.2 0 0 1 0-12.4Z" />
			</svg>
		);
	}

	if (props.brand === "codebuddy") {
		return (
			<svg viewBox="0 0 24 24" className={cls} aria-hidden="true" focusable="false">
				<path fill="currentColor" fillRule="evenodd" d="M12 2a10 10 0 1 0 8.7 14.9l-3.3-1.7A6.3 6.3 0 1 1 17.4 8l3.3-1.7A10 10 0 0 0 12 2Z" />
			</svg>
		);
	}

	return <PiLogo className={cls} />;
}

export function AcpToolLogo(props: { tool?: Pick<AcpToolConfig, "command" | "args" | "name">; className?: string }) {
	const brand = props.tool ? resolveAcpToolBrand(props.tool) : "generic";
	if (brand === "generic") return <TerminalIcon className={cn("text-muted-foreground", props.className ?? "size-3.5")} aria-hidden="true" />;
	return <BrandMark brand={brand} className={props.className} />;
}

export function PiLogo(props: { className?: string; "aria-label"?: string; title?: string }) {
	const { style: logoStyle, customLogo } = useBrandGlyph();

	if (customLogo) {
		return <img src={customLogo} alt={props["aria-label"] ?? ""} title={props.title} className={cn(props.className ?? "size-3.5", "object-contain")} />;
	}
	if (logoStyle === "pi-tui") {
		return <PiTuiLogoMark size={14} className={props.className ?? "size-3.5"} />;
	}
	return (
		<svg viewBox="140 140 520 520" className={props.className ?? "size-3.5"} aria-hidden="true" focusable="false">
			<path fill="currentColor" fillRule="evenodd" d="M165.29 165.29H517.36V400H400v117.36H282.65V634.72H165.29ZM282.65 282.65V400H400V282.65Z" />
			<path fill="currentColor" d="M517.36 400H634.72V634.72H517.36Z" />
		</svg>
	);
}

export function SessionBackendBadge(props: { backend?: AgentBackend; className?: string }) {
	const backend = props.backend ?? "pi";
	const isImageGen = backend === "imagegen";
	const isAcp = backend === "acp";
	const label = isImageGen ? t("sessionBackend.imagegen") : t("sessionBackend.acp");
	return (
		<Badge
			variant="outline"
			aria-label={label}
			title={label}
			data-backend={backend}
			className={cn("h-4 rounded px-1 text-[9px] font-semibold leading-none tracking-wide", isImageGen ? "border-violet-300/70 text-violet-700 dark:border-violet-700/70 dark:text-violet-300" : "border-muted-foreground/40 text-muted-foreground", props.className)}
		>
			{isImageGen && <ImageIcon className="mr-0.5 size-2.5" aria-hidden="true" />}
			{isAcp && <TerminalIcon className="mr-0.5 size-2.5" aria-hidden="true" />}
			{label}
		</Badge>
	);
}

export function SessionBackendMark(props: { backend?: AgentBackend; className?: string; executing?: boolean }) {
	const label = props.backend === "pi" || !props.backend ? t("sessionBackend.pi") : props.backend === "imagegen" ? t("sessionBackend.imagegen") : t("sessionBackend.acp");

	if (props.executing) return null;
	if (props.backend === "pi" || !props.backend)
		return (
			<span role="img" aria-label={label} title={label} className={cn("inline-flex shrink-0 items-center justify-center", props.className)}>
				<PiLogo className="size-3.5" aria-label={label} title={label} />
			</span>
		);
	if (props.backend === "imagegen" || props.backend === "acp") return <SessionBackendBadge backend={props.backend} className={props.className} />;
	return null;
}

export function AcpBackendMark(props: { acpToolId?: string | null; className?: string }) {
	const tools = useAtomValue(acpToolsAtom);
	const tool = props.acpToolId ? tools.find((item) => item.id === props.acpToolId) : undefined;
	return <AcpToolLogo tool={tool} className={props.className} />;
}

export function SessionSourceBadge(props: { source: SessionSource; label?: string; className?: string }) {
	const label = props.label ?? SOURCE_LABELS[props.source];
	return (
		<Badge variant="outline" aria-label={label} title={label} data-source={props.source} className={cn("size-5 rounded-md p-0", SOURCE_TONES[props.source], props.className)}>
			<BrandMark brand={props.source} />
		</Badge>
	);
}

export function ImageGenSourceBadge(props: { className?: string }) {
	const label = t("sessionBackend.imagegen");
	return (
		<Badge variant="outline" aria-label={label} title={label} data-source="imagegen" className={cn("size-5 rounded-md p-0 border-violet-300/70 text-violet-700 dark:border-violet-700/70 dark:text-violet-300", props.className)}>
			<ImageIcon className="size-3" aria-hidden="true" />
		</Badge>
	);
}

function WeChatLogo() {
	const green = "#07C160";
	return (
		<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="size-3" aria-hidden="true">
			<path d="M9.4 2.6C4.9 2.6 1.3 5.5 1.3 9c0 1.9 1 3.6 2.6 4.7l-.8 2.6 2.9-1.5c.9.3 1.9.5 2.9.5h.6a6.6 6.6 0 0 1-.2-1.6c0-3.6 3.4-6.4 7.5-6.4.4 0 .8 0 1.1.1-.8-3.1-3.9-4.8-8.5-4.8Z" fill={green} />
			<circle cx="6.6" cy="7.5" r="1.15" fill="#fff" />
			<circle cx="11.9" cy="7.5" r="1.15" fill="#fff" />

			<path d="M16.4 8.6c-3.7 0-6.7 2.4-6.7 5.4 0 3 3 5.4 6.7 5.4.8 0 1.6-.1 2.4-.4l2.9 1.5-.8-2.6c1.5-1 2.4-2.4 2.4-3.9 0-3-3-5.4-6.9-5.4Z" fill={green} />
			<circle cx="14" cy="13.7" r="1" fill="#fff" />
			<circle cx="18.8" cy="13.7" r="1" fill="#fff" />
		</svg>
	);
}

function FeishuChannelLogo() {
	return (
		<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="size-3" aria-hidden="true">
			<path
				d="M12.9238 12.8029C12.9427 12.784 12.9616 12.7682 12.9806 12.7493C13.0184 12.7146 13.0563 12.6767 13.091 12.6389L13.1667 12.5631L13.397 12.336L14.7315 11.0173L15.0659 10.686C15.129 10.6229 15.1952 10.563 15.2615 10.5031C15.3845 10.3926 15.5076 10.2854 15.6369 10.1813C15.7536 10.0866 15.8767 9.99514 15.9997 9.9068C16.1732 9.78376 16.3499 9.67019 16.5329 9.55977C16.7127 9.45251 16.8957 9.35471 17.085 9.26322C17.2616 9.17804 17.4415 9.09917 17.6276 9.02661C17.7317 8.9856 17.8326 8.94774 17.9399 8.91304C17.9935 8.89411 18.044 8.87834 18.0977 8.86256C17.6276 7.00439 16.7632 5.3008 15.5991 3.84959C15.3719 3.56566 15.0249 3.40161 14.6589 3.40161H5.0084C4.83489 3.40161 4.76233 3.6256 4.90114 3.72656C8.18528 6.13997 10.9236 9.24114 12.9017 12.825C12.908 12.8187 12.9175 12.8124 12.9238 12.8029Z"
				fill="#00D6B9"
			/>
			<path
				d="M9.09696 21.2986C14.0815 21.2986 18.4225 18.5476 20.6877 14.4843C20.7666 14.3423 20.8454 14.1972 20.918 14.052C20.8044 14.2729 20.6751 14.4811 20.5394 14.6767C20.4889 14.7461 20.4385 14.8155 20.388 14.8818C20.3217 14.9669 20.2555 15.049 20.1861 15.1278C20.1324 15.1909 20.0757 15.2509 20.0189 15.3108C19.9021 15.4307 19.7823 15.5474 19.6561 15.6547C19.5867 15.7146 19.5141 15.7714 19.4415 15.8282C19.3564 15.8944 19.268 15.9575 19.1797 16.0143C19.1229 16.0522 19.0661 16.09 19.0093 16.1247C18.9494 16.1626 18.8895 16.1973 18.8264 16.232C18.7002 16.3014 18.574 16.3645 18.4446 16.4245C18.3311 16.4749 18.2175 16.5223 18.1008 16.5633C17.9746 16.6106 17.8452 16.6516 17.7159 16.6863C17.5234 16.7399 17.3247 16.7809 17.1259 16.8125C16.9808 16.8346 16.8357 16.8504 16.6874 16.863C16.5328 16.8724 16.3751 16.8787 16.2173 16.8756C16.0438 16.8724 15.8703 16.863 15.6936 16.844C15.5643 16.8314 15.435 16.8125 15.3056 16.7873C15.192 16.7683 15.0785 16.7431 14.9649 16.7178C14.9049 16.7021 14.845 16.6895 14.7851 16.6737C14.6179 16.6295 14.4538 16.5822 14.2898 16.5349C14.2077 16.5096 14.1257 16.4875 14.0437 16.4623C13.9206 16.4245 13.7976 16.3897 13.6777 16.3519C13.5768 16.3203 13.479 16.2888 13.378 16.2572C13.2834 16.2257 13.1887 16.1942 13.0941 16.1626C13.031 16.1405 12.9647 16.1184 12.9016 16.0964C12.8228 16.0711 12.7471 16.0427 12.6682 16.0143C12.6114 15.9954 12.5578 15.9765 12.501 15.9544C12.3906 15.9134 12.2802 15.8755 12.1729 15.8345C12.1098 15.8093 12.0467 15.7872 11.9836 15.7619C11.8984 15.7304 11.8132 15.6957 11.7312 15.6641C11.6429 15.6294 11.5514 15.5947 11.4631 15.5569C11.4063 15.5348 11.3463 15.5096 11.2895 15.4875C11.217 15.4591 11.1476 15.4275 11.075 15.3991C11.0214 15.3771 10.9646 15.3518 10.911 15.3297C10.8542 15.3045 10.7974 15.2793 10.7406 15.254C10.6901 15.2319 10.6428 15.2099 10.5923 15.1878C10.5482 15.1688 10.5008 15.1468 10.4567 15.1278C10.4094 15.1057 10.3652 15.0868 10.3179 15.0647C10.2705 15.0427 10.2232 15.0206 10.1759 14.9985C10.116 14.9701 10.056 14.9417 9.99608 14.9165C9.93299 14.8881 9.87304 14.8565 9.80995 14.8281C9.7437 14.7966 9.67745 14.765 9.6112 14.7303C9.55441 14.7019 9.49762 14.6735 9.44084 14.6483C6.45324 13.1592 3.80321 11.1717 1.54438 8.76145C1.43081 8.64157 1.23206 8.72044 1.23206 8.88449L1.23836 18.0933C1.23836 18.494 1.43712 18.8726 1.77153 19.0934C3.86631 20.4878 6.38699 21.2986 9.09696 21.2986Z"
				fill="#3370FF"
			/>
			<path
				d="M23.7322 9.29488C22.7226 8.79642 21.5838 8.5188 20.3818 8.5188C19.6688 8.5188 18.9747 8.6166 18.3217 8.80273C18.246 8.82481 18.1703 8.8469 18.0977 8.86898C18.0441 8.88476 17.9905 8.90368 17.94 8.91946C17.8359 8.95416 17.7318 8.99202 17.6276 9.03303C17.4447 9.10559 17.2617 9.18446 17.085 9.26964C16.8957 9.36113 16.7128 9.45893 16.5329 9.56619C16.35 9.67345 16.1701 9.79018 15.9998 9.91322C15.8767 10.0016 15.7569 10.093 15.637 10.1877C15.5076 10.2918 15.3846 10.3991 15.2616 10.5095C15.1953 10.5694 15.1322 10.6325 15.066 10.6925L14.7315 11.0206L13.3939 12.3424L13.1636 12.5696L13.0879 12.6453C13.05 12.6831 13.0122 12.7178 12.9775 12.7557C12.9586 12.7746 12.9396 12.7904 12.9207 12.8093C12.8923 12.8377 12.8639 12.863 12.8355 12.8882C12.804 12.9166 12.7724 12.9481 12.7409 12.9765C11.9143 13.7368 10.9931 14.3899 9.99304 14.923C10.053 14.9514 10.1129 14.9798 10.1729 15.0051C10.2202 15.0271 10.2675 15.0492 10.3148 15.0713C10.359 15.0934 10.4063 15.1123 10.4536 15.1344C10.4978 15.1533 10.5451 15.1754 10.5893 15.1943C10.6398 15.2164 10.6871 15.2385 10.7376 15.2606C10.7944 15.2858 10.8511 15.3111 10.9079 15.3363C10.9616 15.3584 11.0184 15.3836 11.072 15.4057C11.1445 15.4373 11.2139 15.4657 11.2865 15.4941C11.3433 15.5193 11.4032 15.5414 11.46 15.5635C11.5484 15.5982 11.6367 15.636 11.7282 15.6707C11.8134 15.7023 11.8954 15.737 11.9806 15.7685C12.0437 15.7938 12.1068 15.8158 12.1699 15.8411C12.2803 15.8821 12.3875 15.9231 12.498 15.961C12.5547 15.9799 12.6084 16.002 12.6652 16.0209C12.744 16.0493 12.8197 16.0745 12.8986 16.1029C12.9617 16.125 13.028 16.1471 13.0911 16.1692C13.1857 16.2007 13.2803 16.2323 13.375 16.2638C13.4728 16.2954 13.5737 16.3269 13.6747 16.3585C13.7977 16.3963 13.9176 16.4342 14.0406 16.4689C14.1227 16.4941 14.2047 16.5162 14.2867 16.5414C14.4508 16.5888 14.618 16.6361 14.782 16.6803C14.842 16.696 14.9019 16.7118 14.9618 16.7244C15.0754 16.7528 15.189 16.7749 15.3026 16.7938C15.4319 16.8159 15.5613 16.8348 15.6906 16.8506C15.8673 16.8695 16.0408 16.8822 16.2143 16.8822C16.372 16.8853 16.5298 16.879 16.6844 16.8695C16.8326 16.8601 16.9778 16.8412 17.1229 16.8191C17.3248 16.7875 17.5204 16.7465 17.7128 16.6929C17.8422 16.6582 17.9715 16.6172 18.0977 16.5698C18.2144 16.5257 18.328 16.4815 18.4416 16.4279C18.5709 16.3679 18.7003 16.3048 18.8233 16.2354C18.8833 16.2007 18.9464 16.166 19.0063 16.1282C19.0631 16.0935 19.1199 16.0556 19.1767 16.0178C19.265 15.9578 19.3533 15.8947 19.4385 15.8316C19.5111 15.7748 19.5836 15.718 19.653 15.6581C19.7792 15.5508 19.8991 15.4341 20.0158 15.3142C20.0726 15.2543 20.1294 15.1943 20.183 15.1313C20.2524 15.0524 20.3187 14.9704 20.3849 14.8852C20.4354 14.8189 20.4859 14.7495 20.5364 14.6801C20.672 14.4845 20.7982 14.2763 20.9118 14.0586L21.0411 13.7999L22.2084 11.4748L22.2053 11.4812C22.5807 10.6578 23.1012 9.91953 23.7322 9.29488Z"
				fill="#133C9A"
			/>
		</svg>
	);
}

const CHANNEL_LABELS: Record<SessionChannel, string> = {
	wechat: t("sessionChannel.wechat"),
	feishu: t("sessionChannel.feishu"),
};

const CHANNEL_TONES: Record<SessionChannel, string> = {
	wechat: "border-emerald-300/70 text-emerald-700 dark:border-emerald-700/70 dark:text-emerald-300",
	feishu: "border-sky-300/70 text-sky-700 dark:border-sky-700/70 dark:text-sky-300",
};

export function SessionChannelMark(props: { channel: SessionChannel; className?: string }) {
	const label = CHANNEL_LABELS[props.channel];
	return (
		<Badge variant="outline" aria-label={label} title={label} data-channel={props.channel} className={cn("size-4 shrink-0 rounded-md p-0", CHANNEL_TONES[props.channel], props.className)}>
			{props.channel === "wechat" ? <WeChatLogo /> : <FeishuChannelLogo />}
		</Badge>
	);
}

export function SideTaskMark(props: { className?: string }) {
	const label = t("sideTask.title");
	return (
		<Badge variant="outline" aria-label={label} title={label} data-side-task="true" className={cn("size-4 shrink-0 items-center justify-center rounded-md border-violet-300/70 p-0 text-violet-700 dark:border-violet-700/70 dark:text-violet-300", props.className)}>
			<PanelRight size={10} aria-hidden="true" />
		</Badge>
	);
}
