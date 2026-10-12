import { useCallback, useEffect, useState } from "react";

import {
  configApi,
  SKILL_ID_PATTERN,
  skillKey,
  type ConfigPaths,
  type SkillEntry,
} from "../../lib/configBridge";
import { IconPencil, IconPlus, IconRefresh, IconTrash } from "../ui/Icons";
import { Switch } from "../ui/form";
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
import { Tooltip } from "../ui/Tooltip";

type Status = { level: "ok" | "error"; text: string } | null;

type Mode = { kind: "create" } | { kind: "edit"; skill: SkillEntry } | null;

export function SkillsTab({
  paths,
  onDirty,
  globalSkills,
  onSetGlobal,
}: {
  paths: ConfigPaths | null;
  onDirty: () => void;
  /** Skills that are on by default in every conversation, by {@link skillKey}. */
  globalSkills: string[];
  onSetGlobal: (key: string, global: boolean) => void;
}) {
  const [skills, setSkills] = useState<SkillEntry[]>([]);
  const [mode, setMode] = useState<Mode>(null);
  const [text, setText] = useState("");
  const [draft, setDraft] = useState({ id: "", name: "", description: "" });
  const [status, setStatus] = useState<Status>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);

  const globalSet = new Set(globalSkills);
  const globalRows = skills.filter((skill) => globalSet.has(skillKey(skill)));
  const addableToGlobal = skills.filter((skill) => !globalSet.has(skillKey(skill)));

  const load = useCallback(async () => {
    setStatus(null);
    try {
      setSkills(await configApi.skillsList());
    } catch (error) {
      setStatus({ level: "error", text: String(error) });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const openCreate = () => {
    setStatus(null);
    setConfirming(null);
    setDraft({ id: "", name: "", description: "" });
    setMode({ kind: "create" });
  };

  const openEdit = async (skill: SkillEntry, confirmDelete = false) => {
    setStatus(null);
    setMode({ kind: "edit", skill });
    setConfirming(confirmDelete ? skill.id : null);
    setText("");
    try {
      setText(await configApi.skillRead(skill.source, skill.id));
    } catch (error) {
      setStatus({ level: "error", text: String(error) });
    }
  };

  const closeDrawer = () => {
    setMode(null);
    setConfirming(null);
    setStatus(null);
  };

  const create = async () => {
    const id = draft.id.trim();
    if (!SKILL_ID_PATTERN.test(id)) {
      setStatus({
        level: "error",
        text: "名称只允许小写字母、数字和连字符，不能以连字符开头或结尾",
      });
      return;
    }
    setBusy(true);
    setStatus(null);
    try {
      const created = await configApi.skillCreate(id, draft.name, draft.description);
      await load();
      onDirty();
      await openEdit(created);
    } catch (error) {
      setStatus({ level: "error", text: String(error) });
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (mode?.kind !== "edit") return;
    setBusy(true);
    setStatus(null);
    try {
      await configApi.skillWrite(mode.skill.source, mode.skill.id, text);
      setStatus({ level: "ok", text: "已保存 SKILL.md" });
      onDirty();
      await load();
    } catch (error) {
      setStatus({ level: "error", text: String(error) });
    } finally {
      setBusy(false);
    }
  };

  const remove = async (skill: SkillEntry) => {
    setBusy(true);
    setStatus(null);
    try {
      const trash = await configApi.skillDelete(skill.id);
      setConfirming(null);
      await load();
      onDirty();
      closeDrawer();
      setStatus({ level: "ok", text: `已移入回收站：${trash}` });
    } catch (error) {
      setStatus({ level: "error", text: String(error) });
    } finally {
      setBusy(false);
    }
  };

  const editing = mode?.kind === "edit" ? mode.skill : null;
  const writable = editing?.writable ?? false;

  return (
    <>
      <Card>
        <CardHeader
          title="全局 skills"
          description="加进这里的 skill，每个对话都默认开启——不用在每个对话里重新挑一遍。对话里仍然可以单独关掉它，那不会改变这里的设置。"
        />
        <CardBody flush={globalRows.length > 0}>
          {globalRows.length === 0 ? (
            <EmptyState
              title="还没有全局 skill"
              description="把想「每个对话都带着」的 skill 加进来。例如把省 token 的那类放进来，之后新开的对话一开始就带着它。"
            />
          ) : (
            <table className="dtable">
              <thead>
                <tr>
                  <th style={{ width: 70 }}>默认开</th>
                  <th>名称</th>
                  <th style={{ width: 116 }}>来源</th>
                </tr>
              </thead>
              <tbody>
                {globalRows.map((skill) => (
                  <tr key={skillKey(skill)}>
                    <td>
                      <Tooltip label="每个对话默认开启。关掉＝从全局列表移出（对话里单独设过的开关不受影响）">
                        <Switch
                          checked
                          onChange={() => onSetGlobal(skillKey(skill), false)}
                          label={`把 ${skill.name} 移出全局`}
                        />
                      </Tooltip>
                    </td>
                    <td>
                      <div className="cell-strong">{skill.name}</div>
                      <div className="cell-sub">
                        {skill.description || "（没有 description，不会被自动加载）"}
                      </div>
                    </td>
                    <td>
                      <div className="chip-row">
                        {skill.builtin ? <Badge tone="info">内置</Badge> : null}
                        {skill.writable ? <Badge tone="ok">agent</Badge> : <Badge>只读</Badge>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardBody>
        {addableToGlobal.length > 0 ? (
          <CardFooter>
            <span className="inline-status">加入全局：</span>
            <div className="global-add-row">
              {addableToGlobal.map((skill) => (
                <button
                  key={skillKey(skill)}
                  className="btn btn-ghost"
                  type="button"
                  onClick={() => onSetGlobal(skillKey(skill), true)}
                >
                  <IconPlus />
                  {skill.name}
                  {skill.builtin ? <Badge tone="info">内置</Badge> : null}
                </button>
              ))}
            </div>
          </CardFooter>
        ) : null}
      </Card>

      <Card>
        <CardHeader
          title="全部 skills"
          description="skill 池：内置的加上你自己写的。pi 递归扫描 skills 目录下含 SKILL.md 的文件夹，description 决定模型什么时候会想起它。想让它每个对话都带着，就加到上面的「全局 skills」里；否则在对话里单独添加。"
          action={
            <button className="btn btn-primary" type="button" onClick={openCreate}>
              <IconPlus />
              新建 skill
            </button>
          }
        />
        <CardBody flush={skills.length > 0}>
          {skills.length === 0 ? (
            <EmptyState
              title="还没有 skill"
              description="skill 是一段按需加载的指令，可以附带脚本和参考资料。写清「做什么」和「什么时候用」。"
              action={
                <button className="btn btn-primary" type="button" onClick={openCreate}>
                  <IconPlus />
                  新建 skill
                </button>
              }
            />
          ) : (
            <table className="dtable">
              <thead>
                <tr>
                  <th>名称</th>
                  <th style={{ width: 116 }}>来源</th>
                  <th style={{ width: 88 }} />
                </tr>
              </thead>
              <tbody>
                {skills.map((skill) => {
                  const key = skillKey(skill);
                  return (
                    <tr key={key}>
                      <td>
                        <div className="cell-strong">{skill.name}</div>
                        <div className="cell-sub">
                          {skill.description || "（没有 description，不会被自动加载）"}
                        </div>
                      </td>
                      <td>
                        <div className="chip-row">
                          {skill.builtin ? <Badge tone="info">内置</Badge> : null}
                          {skill.writable ? <Badge tone="ok">agent</Badge> : <Badge>只读</Badge>}
                        </div>
                      </td>
                      <td>
                        <div className="row-actions">
                          <IconButton
                            title={`编辑 ${skill.id}`}
                            onClick={() => void openEdit(skill)}
                          >
                            <IconPencil />
                          </IconButton>
                          {/* Built-in skills are part of APIX: no delete control at
                              all, and the host refuses the call as well. */}
                          {skill.builtin ? null : (
                            <IconButton
                              title={skill.writable ? `删除 ${skill.id}` : "只读，不能删除"}
                              tone="danger"
                              disabled={!skill.writable}
                              onClick={() => void openEdit(skill, true)}
                            >
                              <IconTrash />
                            </IconButton>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </CardBody>
        <CardFooter>
          {status && mode === null ? (
            <span className={`inline-status status-${status.level}`}>{status.text}</span>
          ) : null}
          <span className="spacer" />
          <span className="inline-status">
            内置 skill 由 APIX 提供，不能删除（可以编辑）；要不要启用由上面两个列表决定
          </span>
          <button className="btn btn-ghost" type="button" onClick={() => void load()}>
            <IconRefresh />
            重新加载
          </button>
          <button
            className="btn btn-ghost"
            type="button"
            onClick={() => void configApi.openPath(paths?.skillsDir ?? "")}
          >
            打开 skills 目录
          </button>
        </CardFooter>
      </Card>

      <Drawer
        open={mode !== null}
        title={
          mode?.kind === "create" ? "新建 skill" : `${editing?.id ?? ""}/SKILL.md`
        }
        description={
          mode?.kind === "create"
            ? "创建后会自动打开 SKILL.md 让你接着写正文。"
            : editing?.path
        }
        onClose={closeDrawer}
        footer={
          mode ? (
            <>
              {status ? (
                <span className={`inline-status status-${status.level}`}>{status.text}</span>
              ) : null}
              <span className="spacer" />
              {editing ? (
                confirming === editing.id ? (
                  <>
                    <span className="inline-status status-error">
                      移到 .trash（可恢复）？
                    </span>
                    <button
                      className="btn btn-danger"
                      type="button"
                      disabled={busy}
                      onClick={() => void remove(editing)}
                    >
                      确认
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
                  <Tooltip label={writable ? "删除这个 skill" : "~/.agents/skills 下的 skill 只读"}>
                    <button
                      className="btn btn-danger"
                      type="button"
                      disabled={!writable}
                      onClick={() => setConfirming(editing.id)}
                    >
                      <IconTrash />
                      删除
                    </button>
                  </Tooltip>
                )
              ) : null}
              <button className="btn btn-ghost" type="button" onClick={closeDrawer}>
                取消
              </button>
              {mode.kind === "create" ? (
                <button
                  className="btn btn-primary"
                  type="button"
                  disabled={busy || !draft.id.trim()}
                  onClick={() => void create()}
                >
                  创建
                </button>
              ) : (
                <button
                  className="btn btn-primary"
                  type="button"
                  disabled={busy || !writable}
                  onClick={() => void save()}
                >
                  保存
                </button>
              )}
            </>
          ) : null
        }
      >
        {mode?.kind === "create" ? (
          <FieldGroup>
            <FieldRow>
              <Field label="名称" hint="目录名，只允许小写字母、数字和连字符。">
                <input
                  className="input"
                  placeholder="pdf-tools"
                  value={draft.id}
                  onChange={(event) => setDraft({ ...draft, id: event.target.value })}
                />
              </Field>
              <Field label="显示名">
                <input
                  className="input"
                  placeholder="PDF tools"
                  value={draft.name}
                  onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                />
              </Field>
            </FieldRow>
            <Field
              label="description"
              hint="这一句决定模型什么时候会想起加载它。要同时说清「做什么」和「什么时候用」。"
            >
              <input
                className="input"
                placeholder="Extract text and tables from PDF files. Use when reading or converting PDFs."
                value={draft.description}
                onChange={(event) => setDraft({ ...draft, description: event.target.value })}
              />
            </Field>
          </FieldGroup>
        ) : (
          <>
            <Field label="SKILL.md">
              <textarea
                className="skill-area"
                spellCheck={false}
                value={text}
                onChange={(event) => setText(event.target.value)}
              />
            </Field>
            <p className="card-desc">
              正文里引用同目录文件用相对路径，例如{" "}
              <code className="inline-code">references/formats.md</code>。
            </p>
          </>
        )}
      </Drawer>
    </>
  );
}
