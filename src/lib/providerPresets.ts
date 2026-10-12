/**
 * Starting points for a new provider, mirroring StackFerry's preset picker.
 *
 * A preset only fills the form — picking one writes nothing on its own. Model
 * ids are deliberately sparse: they churn faster than this file can follow, so
 * a preset that lists models carries only ones that have been stable for a
 * long time. Everything else says "click 拉取模型列表".
 */

import type { ProviderConfig } from "./configBridge";

export interface ProviderPreset {
  id: string;
  /** Shown in the dropdown. */
  label: string;
  /** Role of this preset in the list. */
  group: "常用" | "国际" | "国内" | "本地";
  note: string;
  config: ProviderConfig;
}

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: "custom",
    label: "自定义",
    group: "常用",
    note: "从空白开始，自己填 baseUrl 和协议。",
    config: {
      baseUrl: "",
      api: "openai-completions",
      apiKey: "",
      models: [],
    },
  },
  {
    id: "deepseek",
    label: "DeepSeek 官方",
    group: "国内",
    note: "api.deepseek.com，密钥用 $DEEPSEEK_API_KEY。",
    config: {
      baseUrl: "https://api.deepseek.com",
      api: "openai-completions",
      apiKey: "$DEEPSEEK_API_KEY",
      compat: { thinkingFormat: "deepseek" },
      models: [
        { id: "deepseek-chat", name: "DeepSeek Chat", contextWindow: 128000, maxTokens: 8192 },
        { id: "deepseek-reasoner", name: "DeepSeek Reasoner", contextWindow: 128000, maxTokens: 65536, reasoning: true },
      ],
    },
  },
  {
    id: "infer-ai",
    label: "InferAI 中转",
    group: "常用",
    note: "api.inferaiapi.com 的中转端点，模型 id 以对方文档为准。",
    config: {
      baseUrl: "https://api.inferaiapi.com/v1",
      api: "openai-completions",
      apiKey: "",
      models: [],
    },
  },
  {
    id: "openai",
    label: "OpenAI",
    group: "国际",
    note: "走 responses 协议。已有 /login 凭据时不用填 apiKey。",
    config: {
      baseUrl: "https://api.openai.com/v1",
      api: "openai-responses",
      apiKey: "$OPENAI_API_KEY",
      models: [],
    },
  },
  {
    id: "anthropic",
    label: "Anthropic",
    group: "国际",
    note: "走 anthropic-messages 协议。",
    config: {
      baseUrl: "https://api.anthropic.com",
      api: "anthropic-messages",
      apiKey: "$ANTHROPIC_API_KEY",
      models: [],
    },
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    group: "国际",
    note: "一个 key 打通多家，模型 id 形如 vendor/model。",
    config: {
      baseUrl: "https://openrouter.ai/api/v1",
      api: "openai-completions",
      apiKey: "$OPENROUTER_API_KEY",
      models: [],
    },
  },
  {
    id: "google",
    label: "Google Gemini",
    group: "国际",
    note: "generativelanguage.googleapis.com。",
    config: {
      baseUrl: "https://generativelanguage.googleapis.com",
      api: "google-generative-ai",
      apiKey: "$GOOGLE_API_KEY",
      models: [],
    },
  },
  {
    id: "xai",
    label: "xAI Grok",
    group: "国际",
    note: "api.x.ai。",
    config: {
      baseUrl: "https://api.x.ai/v1",
      api: "openai-completions",
      apiKey: "$XAI_API_KEY",
      models: [],
    },
  },
  {
    id: "mistral",
    label: "Mistral",
    group: "国际",
    note: "走 mistral-conversations 协议。",
    config: {
      baseUrl: "https://api.mistral.ai/v1",
      api: "mistral-conversations",
      apiKey: "$MISTRAL_API_KEY",
      models: [],
    },
  },
  {
    id: "groq",
    label: "Groq",
    group: "国际",
    note: "api.groq.com 的 OpenAI 兼容端点。",
    config: {
      baseUrl: "https://api.groq.com/openai/v1",
      api: "openai-completions",
      apiKey: "$GROQ_API_KEY",
      models: [],
    },
  },
  {
    id: "moonshot",
    label: "Moonshot / Kimi",
    group: "国内",
    note: "api.moonshot.cn。",
    config: {
      baseUrl: "https://api.moonshot.cn/v1",
      api: "openai-completions",
      apiKey: "$MOONSHOT_API_KEY",
      models: [],
    },
  },
  {
    id: "zhipu",
    label: "智谱 GLM",
    group: "国内",
    note: "open.bigmodel.cn 的 v4 端点。",
    config: {
      baseUrl: "https://open.bigmodel.cn/api/paas/v4",
      api: "openai-completions",
      apiKey: "$ZHIPU_API_KEY",
      compat: { thinkingFormat: "zai" },
      models: [],
    },
  },
  {
    id: "dashscope",
    label: "阿里云百炼 / Qwen",
    group: "国内",
    note: "DashScope 的 OpenAI 兼容模式。",
    config: {
      baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
      api: "openai-completions",
      apiKey: "$DASHSCOPE_API_KEY",
      compat: { thinkingFormat: "qwen" },
      models: [],
    },
  },
  {
    id: "ark",
    label: "火山方舟 / 豆包",
    group: "国内",
    note: "ark.cn-beijing.volces.com 的 v3 端点。",
    config: {
      baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
      api: "openai-completions",
      apiKey: "$ARK_API_KEY",
      models: [],
    },
  },
  {
    id: "siliconflow",
    label: "SiliconFlow 硅基流动",
    group: "国内",
    note: "api.siliconflow.cn。",
    config: {
      baseUrl: "https://api.siliconflow.cn/v1",
      api: "openai-completions",
      apiKey: "$SILICONFLOW_API_KEY",
      models: [],
    },
  },
  {
    id: "ollama",
    label: "Ollama（本机）",
    group: "本地",
    note: "本机 11434。dummy key 让 pi 认为端点可用，Ollama 自己会忽略它。",
    config: {
      baseUrl: "http://localhost:11434/v1",
      api: "openai-completions",
      apiKey: "ollama",
      models: [],
    },
  },
  {
    id: "lmstudio",
    label: "LM Studio（本机）",
    group: "本地",
    note: "本机 1234，需要先在 LM Studio 里开 server。",
    config: {
      baseUrl: "http://localhost:1234/v1",
      api: "openai-completions",
      apiKey: "lm-studio",
      models: [],
    },
  },
  {
    id: "vllm",
    label: "vLLM / SGLang（本机）",
    group: "本地",
    note: "本机 8000，模型 id 通常是服务端 --served-model-name。",
    config: {
      baseUrl: "http://localhost:8000/v1",
      api: "openai-completions",
      apiKey: "EMPTY",
      models: [],
    },
  },
];

/** Presets grouped for the picker, in declaration order. */
export const PRESET_GROUPS = ["常用", "国际", "国内", "本地"] as const;

export function findPreset(id: string): ProviderPreset | undefined {
  return PROVIDER_PRESETS.find((preset) => preset.id === id);
}

/**
 * Which preset, if any, a saved provider looks like. Only reports a match when
 * the shape is unambiguous, so the picker never claims a provider is something
 * the user has since changed.
 */
export function detectPreset(config: ProviderConfig): string {
  const base = (config.baseUrl ?? "").replace(/\/+$/, "");
  if (!base) return "custom";
  for (const preset of PROVIDER_PRESETS) {
    if (preset.id === "custom") continue;
    const target = (preset.config.baseUrl ?? "").replace(/\/+$/, "");
    if (target && target === base) return preset.id;
  }
  return "custom";
}
