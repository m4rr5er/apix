import { Input } from "../components/ui-shadcn/input";
import { Label } from "../components/ui-shadcn/label";
import { t } from "../i18n";
import { ApiTypeInput, SecretInput } from "./ConfigShared";

export function ProviderEndpointFields(props: {
	baseUrl: string;
	api: string;
	apiKey: string;
	onChangeBaseUrl: (value: string) => void;
	onChangeApi: (value: string) => void;
	onChangeApiKey: (value: string) => void;

	catalogProvider?: boolean;
	backend?: "pi";
}) {
	return (
		<>
			<div className="config-provider-field items-center">
				<Label className="pl-0.5 text-left text-xs font-medium text-text-secondary">{t("config.field.baseUrl")}</Label>
				<div className="config-base-url-field">
					<Input value={props.baseUrl} aria-label={t("config.field.baseUrl")} size="sm" className="min-w-0" onChange={(event) => props.onChangeBaseUrl(event.target.value)} placeholder="https://api.openai.com/v1" />
					<span className="mt-1 block text-micro leading-relaxed text-text-tertiary">{t("config.baseUrlHint")}</span>
				</div>
			</div>
			{!props.catalogProvider && (
				<div className="config-provider-field items-center">
					<Label className="pl-0.5 text-left text-xs font-medium text-text-secondary">{t("config.field.apiType")}</Label>
					<ApiTypeInput value={props.api} onChange={props.onChangeApi} backend={props.backend} />
				</div>
			)}
			<div className="config-provider-field items-center">
				<Label className="pl-0.5 text-left text-xs font-medium text-text-secondary">{t("config.field.apiKey")}</Label>
				<div className="flex min-w-0 flex-col gap-1">
					<SecretInput value={props.apiKey} onChange={props.onChangeApiKey} />
					{/* 空 apiKey 的供应商仍可能被 pi 解析，于是出现「设置页有、会话与代理名单没有」。登录（/login）或环境变量可补。 */}
					{props.apiKey.trim() === "" && <span className="text-micro leading-relaxed text-text-tertiary">{t("config.field.apiKeyEmptyHint")}</span>}
				</div>
			</div>
		</>
	);
}
