type AcpConfigOptionLike = {
	id?: string;
	name?: string;
	category?: string;
	currentValue?: string | boolean;
};

const OPTION_LABEL_KEYS: Record<string, string> = {
	mode: "acpConfig.option.mode",
	model: "acpConfig.option.model",
	reasoning_effort: "acpConfig.option.reasoningEffort",
	thought_level: "acpConfig.option.reasoningEffort",
	model_config: "acpConfig.option.modelConfig",
	context_window: "acpConfig.option.contextWindow",
	contextWindow: "acpConfig.option.contextWindow",
};

const VALUE_LABEL_KEYS: Record<string, string> = {
	default: "acpConfig.value.default",
	acceptEdits: "acpConfig.value.acceptEdits",
	accept_edits: "acpConfig.value.acceptEdits",
	auto: "acpConfig.value.auto",
	dontAsk: "acpConfig.value.dontAsk",
	dont_ask: "acpConfig.value.dontAsk",
	yolo: "acpConfig.value.yolo",
	bypass_permissions: "acpConfig.value.yolo",
	none: "acpConfig.value.none",
	off: "acpConfig.value.none",
	minimal: "acpConfig.value.minimal",
	low: "acpConfig.value.low",
	medium: "acpConfig.value.medium",
	high: "acpConfig.value.high",
	xhigh: "acpConfig.value.xhigh",
	max: "acpConfig.value.max",
	adaptive: "acpConfig.value.adaptive",
	enabled: "acpConfig.value.enabled",
	disabled: "acpConfig.value.disabled",
};

export function acpConfigOptionLabelKey(option: AcpConfigOptionLike): string | undefined {
	const key = option.id ?? option.category;
	return key ? OPTION_LABEL_KEYS[key] : undefined;
}

export function acpConfigValueLabelKey(option: AcpConfigOptionLike, value: string): string | undefined {
	if (option.category === "model" || option.id === "model") return undefined;
	return VALUE_LABEL_KEYS[value];
}

export function acpCreditMultiplier(description: string | undefined): string | undefined {
	const match = /(\d+(?:\.\d+)?)\s*x\s*Credit/i.exec(description ?? "");
	return match ? `${match[1]}×` : undefined;
}
