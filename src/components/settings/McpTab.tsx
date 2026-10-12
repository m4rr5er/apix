import { useCallback, useEffect, useMemo, useState } from "react";

import {
  configApi,
  MCP_EXPOSURES,
  mcpTransport,
  type ConfigPaths,
  type McpDocument,
  type McpExposure,
  type McpServerConfig,
} from "../../lib/configBridge";
import { IconPencil, IconPlus, IconRefresh, IconTrash } from "../ui/Icons";
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

type Status = { level: "ok" | "error"; text: string } | null;

interface Draft {
  name: string;
  /** Key the entry was loaded under, so renaming removes the old one. */
  original: string;
  isNew: boolean;
  transport: "stdio" | "http";
  command: string;
  argsText: string;
  cwd: string;
  url: string;
  headersText: string;
  envText: string;
  exposure: McpExposure;
  description: string;
  timeoutText: string;
  enabled: boolean;
}

function parseMap(text: string): Record<string, string> | undefined {
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  const parsed: unknown = JSON.parse(trimmed);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error('必须是 JSON 对象，例如 {"Authorization": "Bearer xxx"}');
  }
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    out[key] = String(value);
  }
  return out;
}

function draftFrom(name: string, config: McpServerConfig, isNew: boolean): Draft {
  return {
    name,
    original: isNew ? "" : name,
    isNew,
    transport: mcpTransport(config),
    command: config.command ?? "",
    argsText: (config.args ?? []).join(" "),
    cwd: config.cwd ?? "",
    url: config.url ?? "",
    headersText: config.headers ? JSON.stringify(config.headers, null, 2) : "",
    envText: config.env ? JSON.stringify(config.env, null, 2) : "",
    exposure: (config.exposure as McpExposure) ?? "codemode",
    description: config.description ?? "",
    timeoutText: config.timeout !== undefined ? String(config.timeout) : "",
    enabled: config.enabled !== false,
  };
}

function configFrom(draft: Draft): McpServerConfig {
  const config: McpServerConfig = { type: draft.transport };

  if (draft.transport === "stdio") {
    if (draft.command.trim()) config.command = draft.command.trim();
    const args = draft.argsText.split(/\s+/).filter(Boolean);
    if (args.length) config.args = args;
    if (draft.cwd.trim()) config.cwd = draft.cwd.trim();
    const env = parseMap(draft.envText);
    if (env) config.env = env;
  } else {
    if (draft.url.trim()) config.url = draft.url.trim();
    const headers = parseMap(draft.headersText);
    if (headers) config.headers = headers;
  }

  if (draft.exposure !== "codemode") config.exposure = draft.exposure;
  if (draft.description.trim()) config.description = draft.description.trim();
  const timeout = Number(draft.timeoutText.trim());
  if (draft.timeoutText.trim() && Number.isFinite(timeout)) config.timeout = timeout;
  if (!draft.enabled) config.enabled = false;

  return config;
}

export function McpTab({
  paths,
  onDirty,
}: {
  paths: ConfigPaths | null;
  onDirty: () => void;
}) {
  const [doc, setDoc] = useState<McpDocument | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [status, setStatus] = useState<Status>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);

  const load = useCallback(async () => {
    setStatus(null);
    try {
      setDoc(await configApi.mcpRead());
    } catch (error) {
      setStatus({ level: "error", text: String(error) });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const servers = useMemo(() => doc?.mcpServers ?? {}, [doc]);
  const names = useMemo(() => Object.keys(servers), [servers]);

  const persist = async (next: McpDocument, message: string): Promise<boolean> => {
    setBusy(true);
    setStatus(null);
    try {
      await configApi.mcpWrite(next);
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

  const openCreate = () => {
    setStatus(null);
    setConfirming(null);
    setDraft(draftFrom("", {}, true));
  };

  const openEdit = (name: string) => {
    setStatus(null);
    setConfirming(null);
    setDraft(draftFrom(name, servers[name], false));
  };

  const closeDrawer = () => {
    setDraft(null);
    setConfirming(null);
    setStatus(null);
  };

  const saveDraft = async () => {
    if (!doc || !draft) return;
    const name = draft.name.trim();
    if (!name) {
      setStatus({ level: "error", text: "服务器名不能为空" });
      return;
    }
    if (name !== draft.original && doc.mcpServers[name]) {
      setStatus({ level: "error", text: `服务器 ${name} 已存在` });
      return;
    }

    let config: McpServerConfig;
    try {
      config = configFrom(draft);
    } catch (error) {
      setStatus({ level: "error", text: `env / headers 解析失败：${String(error)}` });
      return;
    }
    if (draft.isNew && !config.command && !config.url) {
      setStatus({ level: "error", text: "stdio 需要 command，HTTP 需要 url" });
      return;
    }

    const nextServers: Record<string, McpServerConfig> = { ...doc.mcpServers };
    if (draft.original && draft.original !== name) delete nextServers[draft.original];
    nextServers[name] = config;

    const ok = await persist(
      { ...doc, mcpServers: nextServers },
      `${draft.isNew ? "已创建" : "已保存"}服务器 ${name}`,
    );
    if (ok) {
      setDraft(draftFrom(name, config, false));
      setConfirming(null);
    }
  };

  const removeServer = async (name: string) => {
    if (!doc) return;
    const nextServers = { ...doc.mcpServers };
    delete nextServers[name];
    const ok = await persist({ ...doc, mcpServers: nextServers }, `已移除服务器 ${name}`);
    if (ok) {
      setConfirming(null);
      if (draft?.original === name) setDraft(null);
    }
  };

  const toggleCodemode = async () => {
    if (!doc) return;
    await persist(
      { ...doc, autoEnableCodemode: !(doc.autoEnableCodemode ?? true) },
      "已更新 mcp.json",
    );
  };

  return (
    <>
      <Card>
        <CardHeader
          title="MCP 服务器"
          description="写进 mcp.json 的 mcpServers。和 Claude Code 等客户端同形，已有配置可以直接拷过来。"
          action={
            <button className="btn btn-primary" type="button" onClick={openCreate}>
              <IconPlus />
              新增服务器
            </button>
          }
        />
        <CardBody flush={names.length > 0}>
          {names.length === 0 ? (
            <EmptyState
              title="还没有配置 MCP 服务器"
              description="加一个 stdio 本地进程，或者一个 http 远程端点。连上后工具会以 mcp__<服务器名>__<工具名> 暴露。"
              action={
                <button className="btn btn-primary" type="button" onClick={openCreate}>
                  <IconPlus />
                  新增服务器
                </button>
              }
            />
          ) : (
            <table className="dtable">
              <thead>
                <tr>
                  <th>名称</th>
                  <th style={{ width: 84 }}>传输</th>
                  <th style={{ width: 96 }}>exposure</th>
                  <th style={{ width: 76 }}>状态</th>
                  <th style={{ width: 88 }} />
                </tr>
              </thead>
              <tbody>
                {names.map((name) => {
                  const config = servers[name];
                  const disabled = config.enabled === false;
                  return (
                    <tr key={name}>
                      <td>
                        <div className="cell-strong">{name}</div>
                        <div className="cell-sub">
                          {config.description ||
                            (mcpTransport(config) === "stdio" ? config.command : config.url) ||
                            "—"}
                        </div>
                      </td>
                      <td>
                        <span className="cell-mono">{mcpTransport(config)}</span>
                      </td>
                      <td>
                        <span className="cell-mono">{config.exposure ?? "codemode"}</span>
                      </td>
                      <td>
                        <Badge tone={disabled ? "default" : "ok"}>
                          {disabled ? "已禁用" : "启用"}
                        </Badge>
                      </td>
                      <td>
                        {confirming === name ? (
                          <div className="row-actions">
                            <button
                              className="btn btn-danger"
                              type="button"
                              disabled={busy}
                              onClick={() => void removeServer(name)}
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
                    </tr>
                  );
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
          <button className="btn btn-ghost" type="button" onClick={() => void load()}>
            <IconRefresh />
            重新加载
          </button>
          <button
            className="btn btn-ghost"
            type="button"
            onClick={() => void configApi.openPath(paths?.mcp ?? "")}
          >
            打开 mcp.json
          </button>
        </CardFooter>
      </Card>

      <Card>
        <CardHeader
          title="Codemode"
          description="有 codemode 暴露的服务器连上时，自动启用 codemode 工具，让模型用脚本组合调用 MCP 工具。"
        />
        <CardBody>
          <label className="check">
            <input
              type="checkbox"
              checked={doc?.autoEnableCodemode ?? true}
              disabled={busy || !doc}
              onChange={() => void toggleCodemode()}
            />
            <span>autoEnableCodemode</span>
          </label>
        </CardBody>
      </Card>

      <Drawer
        open={draft !== null}
        title={draft?.isNew ? "新增服务器" : `编辑 ${draft?.original ?? ""}`}
        description="stdio 跑本地进程，http 连远程端点。没有 Authorization 头的 http 服务器返回 401 时走 OAuth。"
        onClose={closeDrawer}
        footer={
          draft ? (
            <>
              {status ? (
                <span className={`inline-status status-${status.level}`}>{status.text}</span>
              ) : null}
              <span className="spacer" />
              {!draft.isNew && draft.original ? (
                confirming === "__drawer__" ? (
                  <>
                    <span className="inline-status status-error">
                      确认删除 {draft.original}？
                    </span>
                    <button
                      className="btn btn-danger"
                      type="button"
                      disabled={busy}
                      onClick={() => void removeServer(draft.original)}
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
                disabled={busy || !draft.name.trim()}
                onClick={() => void saveDraft()}
              >
                {draft.isNew ? "创建" : "保存"}
              </button>
            </>
          ) : null
        }
      >
        {draft ? (
          <FieldGroup>
            <FieldRow>
              <Field label="服务器名" hint="工具会挂在 mcp__<服务器名>__ 命名空间下">
                <input
                  className="input"
                  placeholder="filesystem"
                  value={draft.name}
                  onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                />
              </Field>
              <Field label="传输">
                <select
                  className="input"
                  value={draft.transport}
                  onChange={(event) =>
                    setDraft({ ...draft, transport: event.target.value as "stdio" | "http" })
                  }
                >
                  <option value="stdio">stdio — 本地进程</option>
                  <option value="http">http — 远程端点</option>
                </select>
              </Field>
            </FieldRow>

            {draft.transport === "stdio" ? (
              <>
                <FieldRow>
                  <Field label="command">
                    <input
                      className="input"
                      placeholder="npx"
                      value={draft.command}
                      onChange={(event) => setDraft({ ...draft, command: event.target.value })}
                    />
                  </Field>
                  <Field label="args" hint="空格分隔；带空格的参数请走原始文件编辑。">
                    <input
                      className="input"
                      placeholder="-y @modelcontextprotocol/server-filesystem ."
                      value={draft.argsText}
                      onChange={(event) => setDraft({ ...draft, argsText: event.target.value })}
                    />
                  </Field>
                </FieldRow>

                <Field label="cwd" hint="留空则用 pi 会话的工作目录。">
                  <input
                    className="input"
                    value={draft.cwd}
                    onChange={(event) => setDraft({ ...draft, cwd: event.target.value })}
                  />
                </Field>

                <Field label="env（JSON）" hint="值可以是 ${NAME} 环境变量引用。">
                  <textarea
                    className="json-area json-area-sm"
                    spellCheck={false}
                    placeholder={'{\n  "TOKEN": "${MY_TOKEN}"\n}'}
                    value={draft.envText}
                    onChange={(event) => setDraft({ ...draft, envText: event.target.value })}
                  />
                </Field>
              </>
            ) : (
              <>
                <Field label="url" hint="必须是 https，除非指向 loopback。">
                  <input
                    className="input"
                    placeholder="https://example.com/mcp"
                    value={draft.url}
                    onChange={(event) => setDraft({ ...draft, url: event.target.value })}
                  />
                </Field>
                <Field label="headers（JSON）" hint="值可以是 ${NAME} 环境变量引用。">
                  <textarea
                    className="json-area json-area-sm"
                    spellCheck={false}
                    placeholder={'{\n  "Authorization": "Bearer ${DOCS_TOKEN}"\n}'}
                    value={draft.headersText}
                    onChange={(event) => setDraft({ ...draft, headersText: event.target.value })}
                  />
                </Field>
              </>
            )}

            <div className="field-sep" />

            <FieldRow>
              <Field label="exposure" hint="工具怎么暴露给模型">
                <select
                  className="input"
                  value={draft.exposure}
                  onChange={(event) =>
                    setDraft({ ...draft, exposure: event.target.value as McpExposure })
                  }
                >
                  {MCP_EXPOSURES.map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="timeout（秒）">
                <input
                  className="input"
                  placeholder="60"
                  value={draft.timeoutText}
                  onChange={(event) => setDraft({ ...draft, timeoutText: event.target.value })}
                />
              </Field>
            </FieldRow>

            <Field label="description" hint="一句话说明这个服务器提供什么，工具搜索会用到。">
              <input
                className="input"
                value={draft.description}
                onChange={(event) => setDraft({ ...draft, description: event.target.value })}
              />
            </Field>

            <label className="check">
              <input
                type="checkbox"
                checked={draft.enabled}
                onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })}
              />
              <span>启用这个服务器</span>
            </label>
          </FieldGroup>
        ) : null}
      </Drawer>
    </>
  );
}
