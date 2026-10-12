import { useCallback, useEffect, useState } from "react";

import { configApi, type ConfigPaths } from "../../lib/configBridge";
import { IconRefresh } from "../ui/Icons";
import { Card, CardBody, CardFooter, CardHeader, Field, FieldGroup, FieldRow } from "../ui/kit";
import { JsonEditor } from "./JsonEditor";

type Status = { level: "ok" | "error"; text: string } | null;

interface Form {
  shellPath: string;
  theme: string;
  httpProxy: string;
  defaultTools: string;
  enabledModels: string;
  hideThinkingBlock: boolean;
  showCacheMissNotices: boolean;
}

function listToText(value: unknown): string {
  return Array.isArray(value) ? value.filter((v) => typeof v === "string").join(", ") : "";
}

function textToList(value: string): string[] | null {
  const items = value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return items.length > 0 ? items : null;
}

export function GeneralTab({ onDirty }: { onDirty: () => void }) {
  const [form, setForm] = useState<Form>({
    shellPath: "",
    theme: "",
    httpProxy: "",
    defaultTools: "",
    enabledModels: "",
    hideThinkingBlock: false,
    showCacheMissNotices: false,
  });
  const [status, setStatus] = useState<Status>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setStatus(null);
    try {
      const settings = await configApi.settingsRead();
      setForm({
        shellPath: typeof settings.shellPath === "string" ? settings.shellPath : "",
        theme: typeof settings.theme === "string" ? settings.theme : "",
        httpProxy: typeof settings.httpProxy === "string" ? settings.httpProxy : "",
        defaultTools: listToText(settings.defaultTools),
        enabledModels: listToText(settings.enabledModels),
        hideThinkingBlock: settings.hideThinkingBlock === true,
        showCacheMissNotices: settings.showCacheMissNotices === true,
      });
    } catch (error) {
      setStatus({ level: "error", text: String(error) });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    setBusy(true);
    setStatus(null);
    try {
      await configApi.settingsPatch({
        shellPath: form.shellPath.trim() || null,
        theme: form.theme.trim() || null,
        httpProxy: form.httpProxy.trim() || null,
        defaultTools: textToList(form.defaultTools),
        enabledModels: textToList(form.enabledModels),
        hideThinkingBlock: form.hideThinkingBlock,
        showCacheMissNotices: form.showCacheMissNotices,
      });
      setStatus({ level: "ok", text: "已写入 settings.json" });
      onDirty();
    } catch (error) {
      setStatus({ level: "error", text: String(error) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader
        title="运行时设置"
        description="写进 settings.json 的常用项。留空即移除该键，交回 pi 的默认值。"
        action={
          <button className="btn btn-primary" type="button" disabled={busy} onClick={() => void save()}>
            保存
          </button>
        }
      />
      <CardBody>
        <FieldGroup>
          <FieldRow>
            <Field label="shellPath" hint="bash 工具用哪个 shell，留空走平台默认。">
              <input
                className="input"
                placeholder="C:\\Program Files\\Git\\bin\\bash.exe"
                value={form.shellPath}
                onChange={(event) => setForm({ ...form, shellPath: event.target.value })}
              />
            </Field>
            <Field label="theme" hint="只影响 pi 自己的终端界面，不动 APIX。">
              <input
                className="input"
                placeholder="dark"
                value={form.theme}
                onChange={(event) => setForm({ ...form, theme: event.target.value })}
              />
            </Field>
          </FieldRow>

          <Field
            label="httpProxy"
            hint="应用到 pi 自己发出的 HTTP 请求（HTTP_PROXY / HTTPS_PROXY）。"
          >
            <input
              className="input"
              placeholder="http://127.0.0.1:7897"
              value={form.httpProxy}
              onChange={(event) => setForm({ ...form, httpProxy: event.target.value })}
            />
          </Field>

          <div className="field-sep" />

          <Field
            label="defaultTools"
            hint="逗号分隔。内置可选：read、bash、powershell、edit、write、grep、find、ls、codemode、tool_search。+name 追加，-name 移除。"
          >
            <input
              className="input"
              placeholder="read, bash, edit, write"
              value={form.defaultTools}
              onChange={(event) => setForm({ ...form, defaultTools: event.target.value })}
            />
          </Field>

          <Field
            label="enabledModels"
            hint="逗号分隔的模型匹配模式，决定启动选择和 Ctrl+P 轮换范围。"
          >
            <input
              className="input"
              placeholder="deepseek/*, openrouter/anthropic/*"
              value={form.enabledModels}
              onChange={(event) => setForm({ ...form, enabledModels: event.target.value })}
            />
          </Field>

          <div className="field-sep" />

          <FieldRow>
            <label className="check">
              <input
                type="checkbox"
                checked={form.hideThinkingBlock}
                onChange={(event) =>
                  setForm({ ...form, hideThinkingBlock: event.target.checked })
                }
              />
              <span>hideThinkingBlock — 隐藏思考块</span>
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={form.showCacheMissNotices}
                onChange={(event) =>
                  setForm({ ...form, showCacheMissNotices: event.target.checked })
                }
              />
              <span>showCacheMissNotices — 缓存未命中提示</span>
            </label>
          </FieldRow>
        </FieldGroup>
      </CardBody>
      <CardFooter>
        {status ? (
          <span className={`inline-status status-${status.level}`}>{status.text}</span>
        ) : null}
        <span className="spacer" />
        <button className="btn btn-ghost" type="button" onClick={() => void load()}>
          <IconRefresh />
          重新加载
        </button>
      </CardFooter>
    </Card>
  );
}

export function RawTab({ paths, onDirty }: { paths: ConfigPaths | null; onDirty: () => void }) {
  const [which, setWhich] = useState<"models" | "settings" | "mcp">("models");

  const current =
    which === "models" ? paths?.models : which === "settings" ? paths?.settings : paths?.mcp;

  return (
    <Card>
      <CardHeader
        title="原始文件"
        description="直接编辑 pi 的配置文件。保存前后端会做 JSON 校验，语法错误不会落盘。"
        action={
          <select
            className="input input-select"
            value={which}
            onChange={(event) => setWhich(event.target.value as "models" | "settings" | "mcp")}
          >
            <option value="models">models.json</option>
            <option value="settings">settings.json</option>
            <option value="mcp">mcp.json</option>
          </select>
        }
      />
      <CardBody>
        <JsonEditor key={which} which={which} hint={current} onSaved={onDirty} />
      </CardBody>
    </Card>
  );
}
