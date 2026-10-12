/**
 * Full editor for one entry of a provider's `models` array.
 *
 * pi's model schema has sixteen top-level groups (core/model-config.d.ts).
 * Rather than expose a wall of inputs, the fields are split into sections that
 * mirror how the values are actually used: what the model is, how big it is,
 * what it costs, what it accepts, how it thinks, how it samples.
 *
 * Everything is emitted as a *patch*; the caller owns the model object and is
 * responsible for pruning blank keys before writing.
 */

import {
  PI_APIS,
  THINKING_LEVELS,
  THINKING_VALUE_HINTS,
  pruneBlank,
  type ImageLimits,
  type ModelCostTier,
  type ProviderModel,
  type ThinkingLevel,
} from "../../lib/configBridge";
import { IconClose, IconPlus } from "../ui/Icons";
import { Field, FieldRow, IconButton } from "../ui/kit";
import { CompatEditor } from "./CompatEditor";
import {
  Collapsible,
  FormSection,
  JsonField,
  KeyValueEditor,
  NumberInput,
  Select,
  SwitchRow,
  TokenInput,
} from "../ui/form";

export function ModelEditor({
  model,
  onChange,
}: {
  model: ProviderModel;
  onChange: (patch: Partial<ProviderModel>) => void;
}) {
  const limits = model.inputLimits ?? {};
  const images = limits.images ?? {};
  const resize = images.resize ?? {};
  const cost = model.cost ?? {};
  const tiers = cost.tiers ?? [];
  const acceptsImage = (model.input ?? []).includes("image");
  const levelMap = model.thinkingLevelMap ?? {};
  const sampleLevels = Object.keys(model.samplingParamsByThinkingLevel ?? {}) as ThinkingLevel[];

  const patchImages = (patch: Partial<ImageLimits>) =>
    onChange({
      inputLimits: pruneBlank({ ...limits, images: { ...images, ...patch } }),
    });

  const patchResize = (patch: Partial<typeof resize>) =>
    patchImages({ resize: { ...resize, ...patch } });

  const patchCost = (patch: Partial<NonNullable<ProviderModel["cost"]>>) =>
    onChange({ cost: pruneBlank({ ...cost, ...patch }) });

  const setTier = (index: number, patch: Partial<ModelCostTier>) => {
    const next = tiers.map((tier, position) => (position === index ? { ...tier, ...patch } : tier));
    patchCost({ tiers: next });
  };

  const setLevel = (level: ThinkingLevel, text: string) => {
    const next = { ...levelMap };
    const raw = text.trim();
    if (!raw) delete next[level];
    else if (raw === "null") next[level] = null;
    else next[level] = raw;
    onChange({ thinkingLevelMap: Object.keys(next).length > 0 ? next : undefined });
  };

  const setSamplingLevel = (level: ThinkingLevel, value: unknown) => {
    const next = { ...(model.samplingParamsByThinkingLevel ?? {}) };
    if (value === undefined || value === null) delete next[level];
    else next[level] = value as Record<string, unknown>;
    onChange({
      samplingParamsByThinkingLevel: Object.keys(next).length > 0 ? next : undefined,
    });
  };

  return (
    <div className="model-editor">
      <FormSection title="基础" description="决定 /model 里显示成什么，以及要不要走别的协议。">
        <FieldRow>
          <Field label="模型 id" hint="请求里真正发出去的 model 值。">
            <input
              className="input input-cell"
              placeholder="deepseek-v4-flash"
              spellCheck={false}
              value={model.id ?? ""}
              onChange={(event) => onChange({ id: event.target.value })}
            />
          </Field>
          <Field label="显示名" hint="留空则直接用 id。">
            <input
              className="input"
              placeholder="DeepSeek V4 Flash"
              value={model.name ?? ""}
              onChange={(event) => onChange({ name: event.target.value })}
            />
          </Field>
        </FieldRow>

        <FieldRow>
          <Field label="协议 api（覆盖供应商）" hint="不填就跟随供应商。">
            <Select
              className="input"
              value={model.api ?? ""}
              placeholder="跟随供应商"
              onChange={(next) => onChange({ api: next })}
              options={PI_APIS.map((api) => ({ value: api, label: api }))}
            />
          </Field>
          <Field label="baseUrl（覆盖供应商）" hint="单模型走别的端点时才填。">
            <input
              className="input"
              placeholder="跟随供应商"
              spellCheck={false}
              value={model.baseUrl ?? ""}
              onChange={(event) => onChange({ baseUrl: event.target.value })}
            />
          </Field>
        </FieldRow>

        <SwitchRow
          label="这是推理模型"
          hint="打开后 pi 会允许对这一档模型切换思考强度。"
          checked={Boolean(model.reasoning)}
          onChange={(next) => onChange({ reasoning: next })}
        />
      </FormSection>

      <FormSection title="容量与价格" description="上下文与最大输出按十进制记：1M = 1000000，128K = 128000。可以直接填 1M / 256K。价格单位是美元／百万 token。">
        <FieldRow>
          <Field label="上下文窗口" hint="1000000 填 1M 即可。留空则用 pi 的默认值 128000。">
            <TokenInput
              value={model.contextWindow}
              onChange={(next) => onChange({ contextWindow: next })}
              placeholder="1M"
            />
          </Field>
          <Field label="最大输出" hint="是输出上限，不是输入上限。留空则用 pi 的默认值 16384。">
            <TokenInput
              value={model.maxTokens}
              onChange={(next) => onChange({ maxTokens: next })}
              placeholder="64K"
            />
          </Field>
        </FieldRow>

        <FieldRow>
          <Field label="输入价 $/M">
            <NumberInput value={cost.input} onChange={(next) => patchCost({ input: next })} />
          </Field>
          <Field label="输出价 $/M">
            <NumberInput value={cost.output} onChange={(next) => patchCost({ output: next })} />
          </Field>
          <Field label="缓存读 $/M">
            <NumberInput value={cost.cacheRead} onChange={(next) => patchCost({ cacheRead: next })} />
          </Field>
          <Field label="缓存写 $/M">
            <NumberInput value={cost.cacheWrite} onChange={(next) => patchCost({ cacheWrite: next })} />
          </Field>
        </FieldRow>

        <Collapsible
          title="阶梯价"
          count={tiers.length}
          hint="超过某个输入长度后换价，只有部分厂商需要"
        >
          {tiers.map((tier, index) => (
            <div className="tier-row" key={index}>
              <Field label="超过输入 tokens">
                <NumberInput
                  value={tier.inputTokensAbove}
                  onChange={(next) => setTier(index, { inputTokensAbove: next ?? 0 })}
                  placeholder="200000"
                />
              </Field>
              <Field label="输入 $/M">
                <NumberInput
                  value={tier.input}
                  onChange={(next) => setTier(index, { input: next ?? 0 })}
                />
              </Field>
              <Field label="输出 $/M">
                <NumberInput
                  value={tier.output}
                  onChange={(next) => setTier(index, { output: next ?? 0 })}
                />
              </Field>
              <Field label="缓存读 $/M">
                <NumberInput
                  value={tier.cacheRead}
                  onChange={(next) => setTier(index, { cacheRead: next ?? 0 })}
                />
              </Field>
              <Field label="缓存写 $/M">
                <NumberInput
                  value={tier.cacheWrite}
                  onChange={(next) => setTier(index, { cacheWrite: next ?? 0 })}
                />
              </Field>
              <IconButton
                title="删除这一档"
                tone="danger"
                onClick={() =>
                  patchCost({ tiers: tiers.filter((_, position) => position !== index) })
                }
              >
                <IconClose size={12} />
              </IconButton>
            </div>
          ))}
          <button
            className="btn btn-ghost"
            type="button"
            onClick={() =>
              patchCost({
                tiers: [
                  ...tiers,
                  { inputTokensAbove: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
                ],
              })
            }
          >
            <IconPlus />
            添加一档
          </button>
        </Collapsible>
      </FormSection>

      <FormSection title="输入形态" description="模型收不收图片，以及图片在进对话前怎么压缩。">
        <SwitchRow
          label="接受图片输入"
          hint="关闭即为纯文本模型。"
          checked={acceptsImage}
          onChange={(next) => onChange({ input: next ? ["text", "image"] : ["text"] })}
        />

        <Collapsible
          title="图片与请求上限"
          hint="右侧这些是 pi 在把图片写进历史前做的压缩参数"
          defaultOpen={acceptsImage}
        >
          <FieldRow>
            <Field label="单请求最大字节" hint="整个请求体上限（catalog 描述用）。">
              <NumberInput
                value={limits.maxRequestBytes}
                onChange={(next) =>
                  onChange({ inputLimits: pruneBlank({ ...limits, maxRequestBytes: next }) })
                }
              />
            </Field>
            <Field label="单条消息图片数">
              <NumberInput
                value={images.maxPerMessage}
                onChange={(next) => patchImages({ maxPerMessage: next })}
              />
            </Field>
            <Field label="单请求图片数">
              <NumberInput
                value={images.maxPerRequest}
                onChange={(next) => patchImages({ maxPerRequest: next })}
              />
            </Field>
          </FieldRow>
          <FieldRow>
            <Field label="缩放最长边" hint="默认 2000。">
              <NumberInput value={resize.maxWidth} onChange={(next) => patchResize({ maxWidth: next })} />
            </Field>
            <Field label="缩放最高边" hint="默认 2000。">
              <NumberInput value={resize.maxHeight} onChange={(next) => patchResize({ maxHeight: next })} />
            </Field>
            <Field label="编码后最大字节" hint="默认 4.5 MiB。">
              <NumberInput value={resize.maxBytes} onChange={(next) => patchResize({ maxBytes: next })} />
            </Field>
            <Field label="JPEG 质量" hint="默认 80。">
              <NumberInput value={resize.jpegQuality} onChange={(next) => patchResize({ jpegQuality: next })} />
            </Field>
          </FieldRow>
        </Collapsible>
      </FormSection>

      <FormSection
        title="思考强度映射"
        description="把 pi 的七档翻译成厂商自己的取值。留空＝不设置，填 null＝这一档该模型不支持（会从选择器里去掉）。"
      >
        <div className="level-grid">
          {THINKING_LEVELS.map((level) => (
            <Field key={level} label={level}>
              <input
                className="input input-cell"
                list="apix-thinking-values"
                placeholder="未设置"
                spellCheck={false}
                value={levelMap[level] === null ? "null" : (levelMap[level] ?? "")}
                onChange={(event) => setLevel(level, event.target.value)}
              />
            </Field>
          ))}
        </div>
        <datalist id="apix-thinking-values">
          <option value="null" />
          {THINKING_VALUE_HINTS.map((value) => (
            <option key={value} value={value} />
          ))}
        </datalist>
        <p className="field-desc">
          例如你 models-store.json 里的 deepseek 就是 minimal → null、medium → null 这种形状。
        </p>
      </FormSection>

      <FormSection title="采样参数" description="只对 openai-completions / openai-responses / azure-openai-responses 生效。">
        <Field label="默认采样参数" hint="例如 {&quot;temperature&quot;: 1.0, &quot;top_p&quot;: 0.95}">
          <JsonField
            value={model.samplingParams}
            onChange={(next) => onChange({ samplingParams: next as ProviderModel["samplingParams"] })}
            rows={4}
            placeholder={'{\n  "temperature": 1.0\n}'}
          />
        </Field>
        <Collapsible
          title="按思考等级覆盖"
          count={sampleLevels.length}
          hint="键是 pi 的等级名，不是厂商的值"
        >
          {sampleLevels.map((level) => (
            <div className="sampling-level" key={level}>
              <div className="sampling-level-head">
                <span className="cell-mono">{level}</span>
                <span className="spacer" />
                <IconButton
                  title={`移除 ${level} 的覆盖`}
                  tone="danger"
                  onClick={() => setSamplingLevel(level, undefined)}
                >
                  <IconClose size={12} />
                </IconButton>
              </div>
              <JsonField
                value={model.samplingParamsByThinkingLevel?.[level]}
                onChange={(next) => setSamplingLevel(level, next)}
                rows={3}
                placeholder={'{\n  "top_k": 20\n}'}
              />
            </div>
          ))}
          <Select
            className="input input-select"
            value=""
            placeholder="添加一个等级…"
            onChange={(next) => {
              if (next) setSamplingLevel(next as ThinkingLevel, {});
            }}
            options={THINKING_LEVELS.filter((level) => !sampleLevels.includes(level)).map((level) => ({
              value: level,
              label: level,
            }))}
          />
        </Collapsible>
      </FormSection>

      <FormSection
        title="缓存寿命"
        description="声明厂商最好情况下的 prompt 缓存存活秒数，pi 用它决定要不要做缓存预热。"
      >
        <FieldRow>
          <Field label="短效缓存（秒）" hint="例如 claude 的 300。">
            <NumberInput
              value={model.promptCache?.short}
              onChange={(next) =>
                onChange({ promptCache: pruneBlank({ ...model.promptCache, short: next }) })
              }
            />
          </Field>
          <Field label="长效缓存（秒）" hint="例如 claude 的 3600。">
            <NumberInput
              value={model.promptCache?.long}
              onChange={(next) =>
                onChange({ promptCache: pruneBlank({ ...model.promptCache, long: next }) })
              }
            />
          </Field>
        </FieldRow>
      </FormSection>

      <FormSection
        title="请求头"
        description="只对这一个模型生效的额外请求头，会盖过供应商级的同名头。"
      >
        <KeyValueEditor
          value={model.headers}
          onChange={(next) => onChange({ headers: next })}
          keyPlaceholder="头名称"
          valuePlaceholder="值"
          secret
        />
      </FormSection>

      <FormSection
        title="兼容性 compat"
        description="只在端点确实和标准行为不一致时才打开。pi 的文档明确说过：不要因为对方声称「兼容 OpenAI」就开这些开关。"
      >
        <CompatEditor
          compat={model.compat}
          onChange={(next) => onChange({ compat: next })}
        />
      </FormSection>

      <Collapsible title="这个模型的完整 JSON" hint="直接改原始对象，比表单更彻底">
        <JsonField
          value={model}
          onChange={(next) => {
            if (!next || typeof next !== "object") return;
            onChange(next as Partial<ProviderModel>);
          }}
          rows={14}
          hint="这里改的是整个模型条目，会整体替换表单里的值。"
        />
      </Collapsible>
    </div>
  );
}
