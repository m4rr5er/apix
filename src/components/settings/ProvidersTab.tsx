import { useCallback, useEffect, useMemo, useState } from "react";

import {
  PI_APIS,
  PI_OAUTH,
  PROVIDER_ID_PATTERN,
  configApi,
  emptyModel,
  pruneBlank,
  type ConfigPaths,
  type ModelsDocument,
  type ProviderConfig,
  type ProviderModel,
  type SettingsDocument,
} from "../../lib/configBridge";
import type { AppearanceApi } from "../../hooks/useAppearance";
import { providerNames, type ModelOption } from "../../lib/protocol";
import {
  PRESET_GROUPS,
  PROVIDER_PRESETS,
  detectPreset,
} from "../../lib/providerPresets";
import {
  IconCopy,
  IconEye,
  IconEyeOff,
  IconPencil,
  IconPlus,
  IconRefresh,
  IconSpark,
  IconStar,
  IconTrash,
  IconTune,
} from "../ui/Icons";
import {
  Badge,
  Card,
  CardBody,
  CardFooter,
  CardHeader,
  Drawer,
  EmptyState,
  Field,
  FieldGroup,
  FieldRow,
  IconButton,
} from "../ui/kit";
import {
  Collapsible,
  FormSection,
  JsonField,
  KeyValueEditor,
  Select,
  Switch,
  SwitchRow,
  TokenInput,
} from "../ui/form";
import { CompatEditor } from "./CompatEditor";
import { ModelEditor } from "./ModelEditor";
import { Tooltip } from "../ui/Tooltip";

type Status = { level: "ok" | "error" | "warn"; text: string } | null;

interface Draft {
  name: string;
  /** Key the entry was loaded under; empty for a new provider. */
  original: string;
  presetId: string;
  /** The provider object as it will be written, minus pruning. */
  config: ProviderConfig;
}

// ---------------------------------------------------------------- validation
// Mirrors StackFerry's editor-validation: errors stay hidden until the first
// submit, so a fresh form is not covered in red.

function missingText(value: string | undefined | null): boolean {
  return !(value ?? "").trim();
}

function nonHttpUrl(value: string | undefined | null): boolean {
  const trimmed = (value ?? "").trim();
  if (!trimmed) return false;
  // $ENV / !command indirection cannot be parsed as a URL, and is legitimate.
  if (trimmed.startsWith("$") || trimmed.startsWith("!")) return false;
  try {
    const url = new URL(trimmed);
    return url.protocol !== "http:" && url.protocol !== "https:";
  } catch {
    return true;
  }
}

/** Blank-looking values are dropped rather than written as "". */
function cleanProvider(config: ProviderConfig): ProviderConfig {
  const out = pruneBlank(config) as ProviderConfig;
  if (Array.isArray(out.models)) {
    out.models = out.models.map(
      (model) => pruneBlank(model) as ProviderModel,
    );
  }
  out.models = out.models ?? [];
  return out;
}

// ------------------------------------------------------------------- widgets

/** Password field with a reveal toggle, like StackFerry's API key input. */
function ApiKeyField({
  value,
  onChange,
  visible,
  onToggle,
  placeholder,
}: {
  value: string;
  onChange: (next: string) => void;
  visible: boolean;
  onToggle: () => void;
  placeholder?: string;
}) {
  return (
    <div className="input-group">
      <input
        className="input"
        type={visible ? "text" : "password"}
        autoComplete="off"
        spellCheck={false}
        placeholder={placeholder ?? "$DEEPSEEK_API_KEY"}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      <IconButton title={visible ? "隐藏 apiKey" : "显示 apiKey"} onClick={onToggle}>
        {visible ? <IconEyeOff /> : <IconEye />}
      </IconButton>
    </div>
  );
}

export function ProvidersTab({
  paths,
  onDirty,
  appearance,
  allModels,
}: {
  paths: ConfigPaths | null;
  onDirty: () => void;
  appearance: AppearanceApi;
  allModels: ModelOption[];
}) {
  const [doc, setDoc] = useState<ModelsDocument | null>(null);
  const [settings, setSettings] = useState<SettingsDocument | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [openModel, setOpenModel] = useState<number | null>(null);
  const [status, setStatus] = useState<Status>(null);
  const [busy, setBusy] = useState(false);
  const [probe, setProbe] = useState<{ ids: string[]; error: string | null } | null>(null);
  const [showKey, setShowKey] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [defaultFor, setDefaultFor] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [models, config] = await Promise.all([
        configApi.modelsRead(),
        configApi.settingsRead(),
      ]);
      setDoc(models);
      setSettings(config);
    } catch (error) {
      setStatus({ level: "error", text: String(error) });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const providers = useMemo(() => doc?.providers ?? {}, [doc]);
  const names = useMemo(() => Object.keys(providers), [providers]);

  // ------------------------------------------------------------------ drafts

  const resetDrawerState = () => {
    setProbe(null);
    setShowKey(false);
    setConfirming(null);
    setOpenModel(null);
    setSubmitted(false);
    setStatus(null);
  };

  const openCreate = (presetId = "custom") => {
    resetDrawerState();
    const preset = PROVIDER_PRESETS.find((item) => item.id === presetId) ?? PROVIDER_PRESETS[0];
    setDraft({
      name: preset.id === "custom" ? "" : preset.id,
      original: "",
      presetId: preset.id,
      config: structuredClone(preset.config),
    });
  };

  const openEdit = (name: string) => {
    const provider = providers[name];
    if (!provider) return;
    resetDrawerState();
    setDraft({
      name,
      original: name,
      presetId: detectPreset(provider),
      config: structuredClone(provider),
    });
  };

  const duplicate = async (name: string) => {
    if (!doc) return;
    const provider = providers[name];
    if (!provider) return;
    let next = `${name}-copy`;
    let counter = 2;
    while (doc.providers[next]) next = `${name}-copy-${counter++}`;
    const nextProviders = { ...doc.providers, [next]: structuredClone(provider) };
    const ok = await persist({ ...doc, providers: nextProviders }, `已复制为 ${next}`);
    if (ok) {
      resetDrawerState();
      setDraft({
        name: next,
        original: next,
        presetId: detectPreset(provider),
        config: structuredClone(provider),
      });
    }
  };

  const closeDrawer = () => {
    setDraft(null);
    resetDrawerState();
  };

  const applyPreset = (presetId: string) => {
    if (!draft) return;
    const preset = PROVIDER_PRESETS.find((item) => item.id === presetId);
    if (!preset) return;
    setDraft({
      ...draft,
      presetId,
      name: draft.original ? draft.name : preset.id === "custom" ? draft.name : preset.id,
      config: structuredClone(preset.config),
    });
  };

  const patchConfig = (patch: Partial<ProviderConfig>) => {
    if (!draft) return;
    setDraft({ ...draft, config: { ...draft.config, ...patch } });
  };

  // -------------------------------------------------------------------- I/O

  const persist = async (next: ModelsDocument, message: string): Promise<boolean> => {
    setBusy(true);
    setStatus(null);
    try {
      await configApi.modelsWrite(next);
      setDoc(next);
      setStatus({ level: "ok", text: message });
      onDirty();
      return true;
    } catch (error) {
      setStatus({ level: "error", text: String(error) });
      return false;
    } finally {
      setBusy(false);
    }
  };

  const errors = useMemo(() => {
    if (!draft || !submitted) return { name: false, baseUrl: false, models: false };
    const config = draft.config;
    const ids = (config.models ?? []).map((model) => (model.id ?? "").trim());
    return {
      name: missingText(draft.name) || !PROVIDER_ID_PATTERN.test(draft.name.trim()),
      baseUrl: missingText(config.baseUrl) || nonHttpUrl(config.baseUrl),
      models: ids.some((id) => !id),
    };
  }, [draft, submitted]);

  const saveDraft = async () => {
    if (!doc || !draft) return;
    setSubmitted(true);
    const name = draft.name.trim();
    if (!name) {
      setStatus({ level: "error", text: "供应商标识不能为空" });
      return;
    }
    if (!PROVIDER_ID_PATTERN.test(name)) {
      setStatus({ level: "error", text: "标识只能用字母、数字、点、下划线和连字符" });
      return;
    }
    if (name !== draft.original && doc.providers[name]) {
      setStatus({ level: "error", text: `供应商 ${name} 已存在` });
      return;
    }
    const ids = (draft.config.models ?? []).map((model) => (model.id ?? "").trim());
    const blank = ids.findIndex((id) => !id);
    if (blank >= 0) {
      setOpenModel(blank);
      setStatus({ level: "error", text: `第 ${blank + 1} 个模型缺少 id` });
      return;
    }
    const duplicateId = ids.find((id, index) => ids.indexOf(id) !== index);
    if (duplicateId) {
      setStatus({ level: "error", text: `模型 id 重复：${duplicateId}` });
      return;
    }

    // pi rejects a provider whose object is empty: it has to say *something*
    // about the endpoint. Mirrors the check in provider-composer so the failure
    // surfaces here instead of on the next engine start.
    const config = draft.config;
    const specifiesSomething =
      Boolean((config.baseUrl ?? "").trim()) ||
      Boolean(config.compat) ||
      Boolean(config.headers) ||
      Boolean(config.modelOverrides) ||
      Boolean((config.apiKey ?? "").trim()) ||
      Boolean(config.oauth) ||
      config.authHeader !== undefined ||
      ids.length > 0;
    if (!specifiesSomething) {
      setStatus({
        level: "error",
        text: "这家供应商什么都没配：至少要有 baseUrl、apiKey、headers、compat 或一个模型。",
      });
      return;
    }

    const nextProviders: Record<string, ProviderConfig> = { ...doc.providers };
    if (draft.original && draft.original !== name) delete nextProviders[draft.original];
    nextProviders[name] = cleanProvider(config);

    const ok = await persist(
      { ...doc, providers: nextProviders },
      `${draft.original ? "已保存" : "已创建"}供应商 ${name}`,
    );
    if (ok) setDraft({ ...draft, name, original: name });
  };

  const removeProvider = async (name: string) => {
    if (!doc) return;
    const nextProviders = { ...doc.providers };
    delete nextProviders[name];
    const ok = await persist({ ...doc, providers: nextProviders }, `已移除供应商 ${name}`);
    if (ok) {
      setConfirming(null);
      if (draft?.original === name) closeDrawer();
    }
  };

  /** Makes this provider the one new sessions start on. */
  const makeDefault = async (name: string, model?: string) => {
    setBusy(true);
    setStatus(null);
    try {
      const next = await configApi.settingsPatch({
        defaultProvider: name,
        defaultModel: model ?? null,
      });
      setSettings(next);
      setStatus({
        level: model ? "ok" : "warn",
        text: model
          ? `新会话默认使用 ${name}/${model}`
          : `已把 ${name} 设为默认供应商，但它还没有模型，新会话会回落到 pi 的自动选择`,
      });
      setDefaultFor(null);
      onDirty();
    } catch (error) {
      setStatus({ level: "error", text: String(error) });
    } finally {
      setBusy(false);
    }
  };

  const runProbe = async () => {
    if (!draft) return;
    setProbe(null);
    setBusy(true);
    try {
      const ids = await configApi.probeModels(draft.config.baseUrl ?? "", draft.config.apiKey ?? "");
      setProbe({ ids, error: null });
    } catch (error) {
      setProbe({ ids: [], error: String(error) });
    } finally {
      setBusy(false);
    }
  };

  // -------------------------------------------------------------- model edit

  const models = draft?.config.models ?? [];

  const setModels = (next: ProviderModel[]) => patchConfig({ models: next });

  const addModels = (ids: string[]) => {
    const next = [...models];
    for (const raw of ids) {
      const id = raw.trim();
      if (id && !next.some((model) => (model.id ?? "").trim() === id)) next.push(emptyModel(id));
    }
    setModels(next);
  };

  const patchModel = (index: number, patch: Partial<ProviderModel>) => {
    const next = [...models];
    next[index] = { ...next[index], ...patch };
    setModels(next);
  };

  const removeModel = (index: number) => {
    setModels(models.filter((_, position) => position !== index));
    setOpenModel((current) => {
      if (current === null) return null;
      if (current === index) return null;
      return current > index ? current - 1 : current;
    });
  };

  const defaultProvider = settings?.defaultProvider ?? "";
  const defaultModel = settings?.defaultModel ?? "";

  // ---------------------------------------------------- picker visibility
  //
  // `models.json` decides what the composer offers. Providers arriving any other
  // way — a pi extension registering its own, or a plain `/login` — would be
  // filtered out entirely, so they are listed here and can be switched on.

  const candidates = useMemo(() => {
    const counts = new Map<string, number>();
    for (const model of allModels) {
      counts.set(model.provider, (counts.get(model.provider) ?? 0) + 1);
    }
    return providerNames(allModels).map((provider) => ({
      provider,
      count: counts.get(provider) ?? 0,
      declared: names.includes(provider),
    }));
  }, [allModels, names]);

  const visibleSet = new Set(appearance.prefs.visibleProviders);
  const hiddenCount = candidates.filter(
    (entry) => !entry.declared && !visibleSet.has(entry.provider),
  ).length;

  const toggleProvider = (provider: string, on: boolean) => {
    const current = appearance.prefs.visibleProviders;
    appearance.update({
      visibleProviders: on
        ? [...new Set([...current, provider])]
        : current.filter((entry) => entry !== provider),
    });
  };

  return (
    <>
      <Card>
        <CardHeader
          title="模型供应商"
          description="写进 models.json 的 providers。pi 是唯一数据源，改完 CLI 立刻能读到。"
          action={
            <button className="btn btn-primary" type="button" onClick={() => openCreate("custom")}>
              <IconPlus />
              新增供应商
            </button>
          }
        />
        <CardBody flush={names.length > 0}>
          {names.length === 0 ? (
            <EmptyState
              title="还没有自定义供应商"
              description="如果 pi 内置的供应商不满足需要，在这里加一个 OpenAI / Anthropic / Google 兼容的端点。"
              action={
                <button className="btn btn-primary" type="button" onClick={() => openCreate("deepseek")}>
                  <IconPlus />
                  从预设开始
                </button>
              }
            />
          ) : (
            <table className="dtable">
              <thead>
                <tr>
                  <th>名称</th>
                  <th style={{ width: 176 }}>协议</th>
                  <th style={{ width: 66 }}>模型</th>
                  <th style={{ width: 128 }} />
                </tr>
              </thead>
              <tbody>
                {names.map((name) => {
                  const provider = providers[name];
                  const count = (provider.models ?? []).length;
                  const isDefault = name === defaultProvider;
                  return [
                    <tr key={name}>
                      <td>
                        <div className="cell-strong">
                          {name}
                          {isDefault ? (
                            <Tooltip
                              label={`新会话默认：${defaultModel || "未指定模型"}`}
                              side="right"
                            >
                              <span className="cell-flag">
                                <IconStar size={11} />
                                默认
                              </span>
                            </Tooltip>
                          ) : null}
                        </div>
                        <div className="cell-sub">{provider.baseUrl || "未填 baseUrl"}</div>
                      </td>
                      <td>
                        <span className="cell-mono">{provider.api ?? "—"}</span>
                        {provider.compat ? <span className="cell-tag">compat</span> : null}
                        {provider.modelOverrides ? <span className="cell-tag">override</span> : null}
                      </td>
                      <td className="cell-num">
                        {count > 0 ? <Badge>{count}</Badge> : <span className="cell-muted">0</span>}
                      </td>
                      <td>
                        {confirming === name ? (
                          <div className="row-actions">
                            <button
                              className="btn btn-danger"
                              type="button"
                              disabled={busy}
                              onClick={() => void removeProvider(name)}
                            >
                              确认删除
                            </button>
                            <button
                              className="btn btn-ghost"
                              type="button"
                              onClick={() => setConfirming(null)}
                            >
                              取消
                            </button>
                          </div>
                        ) : (
                          <div className="row-actions">
                            <IconButton
                              title={`把 ${name} 设为新会话默认`}
                              onClick={() =>
                                setDefaultFor((current) => (current === name ? null : name))
                              }
                            >
                              <IconStar />
                            </IconButton>
                            <IconButton title={`复制 ${name}`} onClick={() => void duplicate(name)}>
                              <IconCopy />
                            </IconButton>
                            <IconButton title={`编辑 ${name}`} onClick={() => openEdit(name)}>
                              <IconPencil />
                            </IconButton>
                            <IconButton
                              title={`删除 ${name}`}
                              tone="danger"
                              onClick={() => setConfirming(name)}
                            >
                              <IconTrash />
                            </IconButton>
                          </div>
                        )}
                      </td>
                    </tr>,
                    defaultFor === name ? (
                      <tr className="probe-row" key={`${name}-default`}>
                        <td colSpan={4}>
                          <div className="probe-cell">
                            <span className="probe-label">新会话默认模型</span>
                            <div className="chips">
                              {(provider.models ?? []).map((model) => (
                                <button
                                  key={model.id}
                                  type="button"
                                  className={`chip${
                                    isDefault && model.id === defaultModel ? " chip-done" : ""
                                  }`}
                                  disabled={busy}
                                  onClick={() => void makeDefault(name, model.id)}
                                >
                                  {model.id}
                                </button>
                              ))}
                              <button
                                type="button"
                                className="chip chip-strong"
                                disabled={busy}
                                onClick={() => void makeDefault(name)}
                              >
                                只设供应商
                              </button>
                              <button
                                type="button"
                                className="chip"
                                onClick={() => setDefaultFor(null)}
                              >
                                取消
                              </button>
                            </div>
                          </div>
                        </td>
                      </tr>
                    ) : null,
                  ];
                })}
              </tbody>
            </table>
          )}
        </CardBody>
        <CardFooter>
          {status ? (
            <span className={`inline-status status-${status.level}`}>{status.text}</span>
          ) : null}
          <span className="spacer" />
          <button
            className="btn btn-ghost"
            type="button"
            onClick={() => {
              setStatus(null);
              void load();
            }}
          >
            <IconRefresh />
            重新加载
          </button>
          <button
            className="btn btn-ghost"
            type="button"
            onClick={() => void configApi.openPath(paths?.models ?? "")}
          >
            打开 models.json
          </button>
        </CardFooter>
      </Card>

      <Card>
        <CardHeader
          title="模型选择器可见的供应商"
          description="上面那张表决定聊天框里能选什么。这里补上不是从 models.json 来的供应商——pi 扩展自己注册的、或者用 /login 登录的。"
          action={
            hiddenCount > 0 ? <Badge tone="warn">{hiddenCount} 家被隐藏</Badge> : null
          }
        />
        <CardBody flush={candidates.length > 0}>
          {candidates.length === 0 ? (
            <EmptyState
              title="pi 还没有报告任何模型"
              description="引擎没运行，或者还没有任何可用凭据。启动引擎、配好 apiKey 或完成 /login 之后再回来看。"
            />
          ) : (
            <table className="dtable">
              <thead>
                <tr>
                  <th>供应商</th>
                  <th style={{ width: 104 }}>来源</th>
                  <th style={{ width: 66 }}>模型</th>
                  <th style={{ width: 62 }}>显示</th>
                </tr>
              </thead>
              <tbody>
                {candidates.map((entry) => {
                  const on = entry.declared || visibleSet.has(entry.provider);
                  return (
                    <tr key={entry.provider}>
                      <td>
                        <div className="cell-strong">{entry.provider}</div>
                        {entry.declared ? null : (
                          <div className="cell-sub">不在 models.json 里</div>
                        )}
                      </td>
                      <td>
                        <span className="cell-tag cell-tag-lead">
                          {entry.declared ? "models.json" : "其他来源"}
                        </span>
                      </td>
                      <td className="cell-num">
                        <Badge>{entry.count}</Badge>
                      </td>
                      <td>
                        <Switch
                          checked={on}
                          disabled={entry.declared}
                          label={
                            entry.declared
                              ? `${entry.provider} 由 models.json 声明，始终显示`
                              : `${on ? "隐藏" : "显示"} ${entry.provider} 的模型`
                          }
                          onChange={(next) => toggleProvider(entry.provider, next)}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </CardBody>
        <CardFooter>
          <span className="inline-status">
            {hiddenCount > 0
              ? `${hiddenCount} 家供应商的模型当前不会出现在聊天框里。`
              : "聊天框里的模型列表和上面这张表一致。"}
          </span>
          <span className="spacer" />
          <button
            className="btn btn-ghost"
            type="button"
            disabled={appearance.prefs.visibleProviders.length === 0}
            onClick={() => appearance.update({ visibleProviders: [] })}
          >
            全部恢复默认
          </button>
        </CardFooter>
      </Card>

      <Drawer
        open={draft !== null}
        title={draft?.original ? `编辑 ${draft.original}` : "新增供应商"}
        description="baseUrl + apiKey 指向端点，模型列表决定 /model 里能选到什么。"
        onClose={closeDrawer}
        footer={
          draft ? (
            <>
              {status ? (
                <span className={`inline-status status-${status.level}`}>{status.text}</span>
              ) : null}
              <span className="spacer" />
              {draft.original ? (
                confirming === "__drawer__" ? (
                  <>
                    <span className="inline-status status-error">确认删除 {draft.original}？</span>
                    <button
                      className="btn btn-danger"
                      type="button"
                      disabled={busy}
                      onClick={() => void removeProvider(draft.original)}
                    >
                      确认删除
                    </button>
                    <button
                      className="btn btn-ghost"
                      type="button"
                      onClick={() => setConfirming(null)}
                    >
                      取消
                    </button>
                  </>
                ) : (
                  <button
                    className="btn btn-danger"
                    type="button"
                    onClick={() => setConfirming("__drawer__")}
                  >
                    <IconTrash />
                    删除
                  </button>
                )
              ) : null}
              <button className="btn btn-ghost" type="button" onClick={closeDrawer}>
                取消
              </button>
              <button
                className="btn btn-primary"
                type="button"
                disabled={busy}
                onClick={() => void saveDraft()}
              >
                {draft.original ? "保存" : "创建"}
              </button>
            </>
          ) : null
        }
      >
        {draft ? (
          <>
            <FormSection
              title="基本信息"
              description="标识是写进 models.json 的键名，也是 /model 里显示的供应商名。"
            >
              <FieldGroup>
                <FieldRow>
                  <Field
                    label="标识"
                    hint={
                      errors.name
                        ? "只能用小写字母、数字、点、下划线和连字符。"
                        : "例如 deepseek、openrouter、my-gateway"
                    }
                  >
                    <input
                      className={`input${errors.name ? " is-invalid" : ""}`}
                      placeholder="openrouter"
                      spellCheck={false}
                      value={draft.name}
                      onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                    />
                  </Field>
                  <Field label="预设" hint="填一份常见的 baseUrl / 协议 / 环境变量名。">
                    <select
                      className="input input-select"
                      value={draft.presetId}
                      onChange={(event) => applyPreset(event.target.value)}
                    >
                      {PRESET_GROUPS.map((group) => (
                        <optgroup key={group} label={group}>
                          {PROVIDER_PRESETS.filter((preset) => preset.group === group).map((preset) => (
                            <option key={preset.id} value={preset.id}>
                              {preset.label}
                            </option>
                          ))}
                        </optgroup>
                      ))}
                    </select>
                  </Field>
                </FieldRow>

                <FieldRow>
                  <Field
                    label="baseUrl"
                    hint={
                      errors.baseUrl
                        ? "必须是以 http:// 或 https:// 开头的地址。"
                        : "OpenAI 兼容端点通常写到 /v1。"
                    }
                  >
                    <input
                      className={`input${errors.baseUrl ? " is-invalid" : ""}`}
                      placeholder="https://api.deepseek.com"
                      spellCheck={false}
                      value={draft.config.baseUrl ?? ""}
                      onChange={(event) => patchConfig({ baseUrl: event.target.value })}
                    />
                  </Field>
                  <Field label="协议 api" hint="端点说的是哪种线协议。">
                    <Select
                      className="input"
                      value={draft.config.api ?? ""}
                      placeholder="跟随 pi 的默认判断"
                      onChange={(next) => patchConfig({ api: next })}
                      options={PI_APIS.map((api) => ({ value: api, label: api }))}
                    />
                  </Field>
                </FieldRow>

                <Field
                  label="apiKey"
                  hint="支持 $ENV / ${ENV} 环境变量插值、!command 执行命令，或直接写明文。留空则只用环境变量或 auth.json。"
                >
                  <ApiKeyField
                    value={draft.config.apiKey ?? ""}
                    onChange={(apiKey) => patchConfig({ apiKey })}
                    visible={showKey}
                    onToggle={() => setShowKey((value) => !value)}
                  />
                </Field>

                <FieldRow>
                  <Field label="OAuth 流程" hint="pi 内置的只有 radius 一个。">
                    <Select
                      className="input"
                      value={draft.config.oauth ?? ""}
                      placeholder="不使用"
                      onChange={(next) =>
                        patchConfig({ oauth: (next || undefined) as ProviderConfig["oauth"] })
                      }
                      options={PI_OAUTH.map((value) => ({ value, label: value }))}
                    />
                  </Field>
                  <Field label="authHeader" hint="把凭据放进裸 Authorization 头，而不是协议默认的位置。">
                    <SwitchRow
                      label="使用 authHeader"
                      checked={draft.config.authHeader === true}
                      onChange={(next) => patchConfig({ authHeader: next ? true : undefined })}
                    />
                  </Field>
                </FieldRow>
              </FieldGroup>
            </FormSection>

            <Collapsible
              title="额外请求头"
              count={Object.keys(draft.config.headers ?? {}).length}
              hint="对这家供应商的所有请求都带上"
            >
              <KeyValueEditor
                value={draft.config.headers}
                onChange={(next) => patchConfig({ headers: next })}
                keyPlaceholder="头名称"
                valuePlaceholder="值"
                secret
              />
            </Collapsible>

            <FormSection
              title={`模型（${models.length}）`}
              description="每一条都是 /model 里可选的一项。保存时就按这个列表替换供应商的 models。"
            >
              <div className="models-head">
                <span className="spacer" />
                <button
                  className="btn btn-ghost"
                  type="button"
                  disabled={busy || !(draft.config.baseUrl ?? "").trim()}
                  onClick={() => void runProbe()}
                >
                  <IconRefresh />
                  拉取模型列表
                </button>
                <button className="btn btn-ghost" type="button" onClick={() => addModels([""])}>
                  <IconPlus />
                  手动添加
                </button>
              </div>

              {probe ? (
                probe.error ? (
                  <p className="inline-status status-error">{probe.error}</p>
                ) : (
                  <div className="chips">
                    {probe.ids.map((id) => {
                      const added = models.some((model) => model.id === id);
                      return (
                        <Tooltip key={id} label={added ? "已在列表中" : "点击添加"}>
                          <button
                            type="button"
                            className={`chip${added ? " chip-done" : ""}`}
                            onClick={() => addModels([id])}
                          >
                            {id}
                            {added ? " ✓" : " +"}
                          </button>
                        </Tooltip>
                      );
                    })}
                    <button
                      type="button"
                      className="chip chip-strong"
                      onClick={() => addModels(probe.ids)}
                    >
                      全部添加
                    </button>
                  </div>
                )
              ) : null}

              {models.length === 0 ? (
                <EmptyState
                  title="还没有模型"
                  description="填好 baseUrl 和 apiKey 后点「拉取模型列表」，或者手动加一条。"
                  action={
                    <button className="btn" type="button" onClick={() => addModels([""])}>
                      <IconPlus />
                      手动添加一条
                    </button>
                  }
                />
              ) : (
                <div className="table-scroll">
                  <table className="dtable dtable-models">
                    <thead>
                      <tr>
                        <th style={{ minWidth: 180 }}>模型 id</th>
                        <th style={{ minWidth: 150 }}>显示名</th>
                        <th style={{ width: 86 }}>上下文</th>
                        <th style={{ width: 86 }}>最大输出</th>
                        <th style={{ width: 46 }}>推理</th>
                        <th style={{ width: 46 }}>图像</th>
                        <th style={{ width: 62 }} />
                      </tr>
                    </thead>
                    <tbody>
                      {models.map((model, index) => {
                        const open = openModel === index;
                        const tagged =
                          model.compat || model.thinkingLevelMap || model.inputLimits || model.promptCache;
                        return [
                          <tr key={`model-${index}`} className={open ? "is-open" : undefined}>
                            <td>
                              <input
                                className={`input input-cell${errors.models && !(model.id ?? "").trim() ? " is-invalid" : ""}`}
                                placeholder="deepseek-v4-flash"
                                spellCheck={false}
                                value={model.id ?? ""}
                                onChange={(event) => patchModel(index, { id: event.target.value })}
                              />
                            </td>
                            <td>
                              <input
                                className="input input-cell"
                                value={model.name ?? ""}
                                onChange={(event) => patchModel(index, { name: event.target.value })}
                              />
                            </td>
                            <td>
                              <TokenInput
                                className="input input-cell"
                                value={model.contextWindow}
                                onChange={(next) => patchModel(index, { contextWindow: next })}
                                placeholder="1M"
                              />
                            </td>
                            <td>
                              <TokenInput
                                className="input input-cell"
                                value={model.maxTokens}
                                onChange={(next) => patchModel(index, { maxTokens: next })}
                                placeholder="64K"
                              />
                            </td>
                            <td className="cell-center">
                              <input
                                type="checkbox"
                                className="cell-check"
                                checked={Boolean(model.reasoning)}
                                onChange={(event) =>
                                  patchModel(index, { reasoning: event.target.checked })
                                }
                              />
                            </td>
                            <td className="cell-center">
                              <input
                                type="checkbox"
                                className="cell-check"
                                checked={(model.input ?? []).includes("image")}
                                onChange={(event) =>
                                  patchModel(index, {
                                    input: event.target.checked ? ["text", "image"] : ["text"],
                                  })
                                }
                              />
                            </td>
                            <td>
                              <div className="row-actions">
                                <IconButton
                                  title={open ? "收起这个模型的全部字段" : "展开这个模型的全部字段"}
                                  onClick={() => setOpenModel(open ? null : index)}
                                >
                                  {tagged ? (
                                    <span className="icon-badge">
                                      <IconTune />
                                    </span>
                                  ) : (
                                    <IconTune />
                                  )}
                                </IconButton>
                                <IconButton
                                  title="删除这个模型"
                                  tone="danger"
                                  onClick={() => removeModel(index)}
                                >
                                  <IconTrash size={13} />
                                </IconButton>
                              </div>
                            </td>
                          </tr>,
                          open ? (
                            <tr className="model-detail" key={`detail-${index}`}>
                              <td colSpan={7}>
                                <ModelEditor
                                  model={model}
                                  onChange={(patch) => patchModel(index, patch)}
                                />
                              </td>
                            </tr>
                          ) : null,
                        ];
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </FormSection>

            <Collapsible
              title="模型覆盖 modelOverrides"
              count={Object.keys(draft.config.modelOverrides ?? {}).length}
              hint="改内置／扩展模型的信息，但不替换供应商的模型列表"
            >
              <JsonField
                value={draft.config.modelOverrides}
                onChange={(next) =>
                  patchConfig({ modelOverrides: next as ProviderConfig["modelOverrides"] })
                }
                rows={8}
                placeholder={'{\n  "gpt-6-luna": { "contextWindow": 1000000 }\n}'}
                hint="键是模型 id，值是模型字段的子集。id 对不上会被 pi 忽略。"
              />
            </Collapsible>

            <Collapsible
              title="兼容性 compat"
              count={
                draft.config.compat ? Object.keys(draft.config.compat).length : 0
              }
              hint="端点行为和标准不一致时才开"
            >
              <CompatEditor
                compat={draft.config.compat}
                onChange={(next) => patchConfig({ compat: next })}
              />
            </Collapsible>

            <Collapsible title="这个供应商的完整 JSON" hint="表单没覆盖到的键都在这里">
              <JsonField
                value={draft.config}
                onChange={(next) => {
                  if (!next || typeof next !== "object") return;
                  setDraft({ ...draft, config: next as ProviderConfig });
                }}
                rows={16}
                hint="整体替换表单里的内容（标识不在这里改）。"
              />
            </Collapsible>

            <p className="drawer-note">
              <IconSpark size={12} />
              保存时会丢掉空白值，保留 <code className="inline-code">false</code> 和{" "}
              <code className="inline-code">0</code>——空字符串不是「不设置」，会被 pi 的 schema
              判错。
            </p>
          </>
        ) : null}
      </Drawer>
    </>
  );
}
