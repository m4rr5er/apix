import assert from "node:assert/strict";
import test from "node:test";
import { loadTsCommonJs } from "./helpers/loadTsCommonJs.mjs";

const { acpConfigOptionLabelKey, acpConfigValueLabelKey, acpCreditMultiplier } = loadTsCommonJs("src/renderer/src/components/session/acpConfigLabels.ts");

test("ACP 配置字段名翻译：Qoder 的 Mode/Model/Reasoning effort 有中文 key，未知字段不猜", () => {
	assert.equal(acpConfigOptionLabelKey({ id: "mode", category: "mode" }), "acpConfig.option.mode");
	assert.equal(acpConfigOptionLabelKey({ id: "model", category: "model" }), "acpConfig.option.model");
	assert.equal(acpConfigOptionLabelKey({ id: "reasoning_effort", category: "thought_level" }), "acpConfig.option.reasoningEffort");
	assert.equal(acpConfigOptionLabelKey({ id: "vendor_option", category: "custom" }), undefined);
});

test("ACP 固定枚举翻译：模式/推理档中文，模型品牌名保持原样", () => {
	const mode = { id: "mode", category: "mode" };
	assert.equal(acpConfigValueLabelKey(mode, "default"), "acpConfig.value.default");
	assert.equal(acpConfigValueLabelKey(mode, "acceptEdits"), "acpConfig.value.acceptEdits");
	assert.equal(acpConfigValueLabelKey(mode, "yolo"), "acpConfig.value.yolo");
	const effort = { id: "reasoning_effort", category: "thought_level" };
	assert.equal(acpConfigValueLabelKey(effort, "xhigh"), "acpConfig.value.xhigh");
	assert.equal(acpConfigValueLabelKey({ id: "model", category: "model" }, "Qwen3.8-Max"), undefined);
});

test("Qoder 模型倍率从官方描述提取，保留两位小数", () => {
	assert.equal(acpCreditMultiplier("Vision · 0.50x Credit"), "0.50×");
	assert.equal(acpCreditMultiplier("Reasoning · Vision · New · 8.00x Credit"), "8.00×");
	assert.equal(acpCreditMultiplier("Vision · 0.00x Credit"), "0.00×");
	assert.equal(acpCreditMultiplier("no multiplier"), undefined);
	assert.equal(acpCreditMultiplier(undefined), undefined);
});
