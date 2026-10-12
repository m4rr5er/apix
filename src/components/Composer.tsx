import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  skillKey,
  type ChatSkillState,
  type SkillEntry,
} from "../lib/configBridge";
import type { ModelOption } from "../lib/protocol";
import { addableSkills, skillRows, type SkillRow } from "../lib/skills";
import { Switch } from "./ui/form";
import { IconChevronDown, IconClose, IconPlus, IconSpark } from "./ui/Icons";
import { IconButton, Popover, Spinner } from "./ui/kit";
import { Tooltip } from "./ui/Tooltip";

/**
 * The body of the Skills popover.
 *
 * Its own component so the add-picker resets itself: `Popover` unmounts its
 * children when closed, so this state cannot survive a close — which is what we
 * want, rather than a picker that is still open the next time the popover is.
 *
 * The list itself is **this conversation's** skills and nothing else: the global
 * ones (on unless this conversation turned them off) plus what this conversation
 * added (off until switched on). The pool of everything installed is behind the
 * plus, so an installed skill never shows up here just because it exists — and
 * a built-in one no more than any other.
 *
 * The header is one line — title plus a plus that is always there (hiding it
 * when nothing is addable read as "the feature is missing") — and an empty list
 * says so in one short line. The explanatory prose used to live here too; it
 * went to the trigger's tooltip, where the count already is.
 */
export function SkillsPanel({
  skillList,
  addable,
  onSetChatSkill,
  onForgetChatSkill,
}: {
  skillList: SkillRow[];
  addable: SkillEntry[];
  onSetChatSkill: (key: string, on: boolean) => void;
  onForgetChatSkill: (key: string) => void;
}) {
  const [picking, setPicking] = useState(false);

  return (
    <div className="skills-popover">
      <div className="skills-popover-bar">
        <span className="skills-popover-title">本会话常驻skills</span>
        <IconButton
          title={picking ? "收起已安装的 skill" : "从已安装的 skill 里添加"}
          onClick={() => setPicking((value) => !value)}
        >
          {picking ? <IconClose size={12} /> : <IconPlus size={12} />}
        </IconButton>
      </div>

      <div className="popover-list skills-popover-list">
        {skillList.map((row) => (
          <div className="skill-row" key={row.key}>
            <div className="skill-row-copy">
              <span className="skill-row-name">
                {row.skill.name}
                {row.global ? <span className="skill-row-tag">全局</span> : null}
                {row.skill.builtin ? (
                  <span className="skill-row-tag is-muted">内置</span>
                ) : null}
              </span>
              <span className="skill-row-desc">
                {row.skill.description || "（没有 description，不会被自动加载）"}
              </span>
            </div>
            <Switch
              checked={row.on}
              onChange={(next) => onSetChatSkill(row.key, next)}
              label={`${row.on ? "关闭" : "开启"} ${row.skill.name}`}
            />
            {row.added ? (
              <Tooltip label="从本会话移除（设置页和全局配置不受影响）">
                <IconButton title="从本会话移除" onClick={() => onForgetChatSkill(row.key)}>
                  <IconClose size={11} />
                </IconButton>
              </Tooltip>
            ) : null}
          </div>
        ))}
        {skillList.length === 0 ? <p className="popover-empty">暂无 skill</p> : null}
      </div>

      {picking ? (
        <>
          <p className="skills-popover-head">已安装的 skill</p>
          <div className="popover-list skills-picker">
            {addable.map((skill) => (
              <button
                key={skillKey(skill)}
                type="button"
                className="popover-item"
                onClick={() => {
                  onSetChatSkill(skillKey(skill), false);
                  setPicking(false);
                }}
              >
                <span className="popover-item-name">{skill.name}</span>
                <span className="popover-item-sub">
                  {skill.builtin ? "内置" : skill.source}
                </span>
              </button>
            ))}
            {addable.length === 0 ? (
              <p className="popover-empty">没有可添加的 skill</p>
            ) : null}
          </div>
        </>
      ) : null}
    </div>
  );
}

/** Text pushed in from outside, e.g. when a previous prompt is being edited. */
export interface ComposerSeed {
  text: string;
  /** Bumped on every seed so re-seeding the same text still takes effect. */
  nonce: number;
}

/**
 * Model and thinking level live here rather than in Settings, because they are
 * per-session decisions you make while working — the same place dsh puts them.
 *
 * Both lists are computed by the engine hook: the model list is narrowed to
 * what `models.json` declares, and the thinking levels are what pi accepts for
 * the *current* model with anything the model maps to `null` removed. This
 * component only renders them.
 */
export function Composer({
  busy,
  disabled,
  model,
  thinkingLevel,
  models,
  levels,
  seed,
  onSend,
  onAbort,
  onEnhance,
  skills,
  chatSkills,
  globalSkills,
  onSetChatSkill,
  onForgetChatSkill,
  onSetModel,
  onSetThinkingLevel,
}: {
  busy: boolean;
  disabled: boolean;
  model: string | null;
  thinkingLevel: string | null;
  models: ModelOption[];
  levels: string[];
  seed: ComposerSeed | null;
  onSend: (text: string, behavior?: "steer" | "followUp") => void;
  onAbort: () => void;
  /** Rewrite a draft with the model; rejects with a readable reason. */
  onEnhance: (text: string) => Promise<string>;
  /** The whole skill library, for the per-conversation switches. */
  skills: SkillEntry[];
  /** This conversation's own on/off decisions, by {@link skillKey}. */
  chatSkills: ChatSkillState;
  /** In the global list (Settings → Skills): offered in every conversation, on by default. */
  globalSkills: string[];
  onSetChatSkill: (key: string, on: boolean) => void;
  /** Drop a skill this conversation added; global ones are removed in Settings. */
  onForgetChatSkill: (key: string) => void;
  onSetModel: (provider: string, modelId: string) => void;
  onSetThinkingLevel: (level: string) => void;
}) {
  const [value, setValue] = useState("");
  const [query, setQuery] = useState("");
  const [enhancing, setEnhancing] = useState(false);
  const [enhanceError, setEnhanceError] = useState<string | null>(null);
  const areaRef = useRef<HTMLTextAreaElement>(null);

  /** Fit the textarea to its content. Shared by typing, seeding and rewriting. */
  const fitArea = useCallback(() => {
    const area = areaRef.current;
    if (!area) return;
    area.style.height = "auto";
    area.style.height = `${Math.min(area.scrollHeight, 200)}px`;
  }, []);

  useEffect(() => {
    fitArea();
  }, [value, fitArea]);

  // Adopting an edited prompt: replace the draft and put the caret at the end,
  // so the user lands in the same place they were typing when they sent it.
  useEffect(() => {
    if (!seed) return;
    setValue(seed.text);
    requestAnimationFrame(() => {
      const area = areaRef.current;
      if (!area) return;
      area.focus();
      area.setSelectionRange(seed.text.length, seed.text.length);
      fitArea();
    });
    // Only the nonce matters: seeding identical text twice must still re-fire.
  }, [seed?.nonce, fitArea]);

  /**
   * Ask the model to rewrite the draft, then put the rewrite back in the field.
   *
   * The draft is only replaced on success: a failed pass must leave exactly what
   * the user typed, and the reason is rendered under the field rather than in
   * the transcript (it is this input's error, not the conversation's).
   */
  const enhance = async () => {
    const draft = value.trim();
    if (!draft || enhancing) return;
    setEnhancing(true);
    setEnhanceError(null);
    try {
      const polished = await onEnhance(draft);
      setValue(polished);
      requestAnimationFrame(() => {
        const area = areaRef.current;
        if (!area) return;
        area.focus();
        area.setSelectionRange(polished.length, polished.length);
        fitArea();
      });
    } catch (error) {
      setEnhanceError(String(error instanceof Error ? error.message : error));
    } finally {
      setEnhancing(false);
    }
  };

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const list = needle
      ? models.filter(
          (entry) =>
            `${entry.provider}/${entry.id}`.toLowerCase().includes(needle) ||
            (entry.name ?? "").toLowerCase().includes(needle),
        )
      : models;
    return list.slice(0, 300);
  }, [models, query]);

  const submit = (behavior?: "steer" | "followUp") => {
    const text = value.trim();
    if (!text) return;
    // While pi is running, a bare prompt is a steering message by design.
    onSend(text, busy ? (behavior ?? "steer") : undefined);
    setValue("");
    requestAnimationFrame(() => areaRef.current?.focus());
  };

  const levelsAdjustable = levels.length > 1;

  // The conversation's skill switches: the global list (on unless this
  // conversation turned it off) plus whatever this conversation added (off until
  // it is switched on). Nothing else is here — a skill the pool has but this
  // conversation never picked up is not in the session at all.
  const skillList = useMemo(
    () => skillRows(skills, globalSkills, chatSkills),
    [skills, globalSkills, chatSkills],
  );
  const addable = useMemo(
    () => addableSkills(skills, globalSkills, chatSkills),
    [skills, globalSkills, chatSkills],
  );
  const enabledSkills = skillList.filter((row) => row.on).length;
  const skillsTip =
    skills.length === 0
      ? "还没有任何 skill。先去「设置 → Skills」新建或添加。"
      : enabledSkills === 0
        ? "本会话没有启用任何 skill，模型不会被触发任何 skill"
        : `本会话启用 ${enabledSkills} 个 skill（开启的才会被触发）`;

  const thinkingTip = !model
    ? "还没有选中模型"
    : levelsAdjustable
      ? "切换思考强度（对当前模型生效）"
      : levels.length === 1
        ? `当前模型只有 ${levels[0]} 一档思考强度`
        : "pi 还没报告可用思考等级";

  const placeholder = disabled
    ? "引擎未就绪 · 用侧栏底部的重启按钮恢复"
    : busy
      ? "pi 正在工作 · Enter 追加指令 · Alt+Enter 排队等待"
      : "给 pi 一个任务 · Enter 发送 · Shift+Enter 换行";

  const enhanceTip = enhancing
    ? "正在润色当前提示词…"
    : !value.trim()
      ? "先写一句草稿，再让模型补齐约束和验收标准"
      : "用当前模型润色这条提示词（成功会直接替换输入框内容，失败则原样保留）";

  return (
    <div className="composer">
      {/* The polish control lives inside the field and is anchored to its
          bottom-right, so it tracks the textarea as it grows. */}
      <div className="composer-field">
        <textarea
          className="composer-input"
          ref={areaRef}
          rows={1}
          value={value}
          disabled={disabled}
          spellCheck={false}
          placeholder={placeholder}
          onChange={(event) => {
            setValue(event.target.value);
            // A stale failure would sit under text it no longer describes.
            setEnhanceError(null);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              submit(event.altKey ? "followUp" : undefined);
              return;
            }
            if (event.key === "Escape" && busy) {
              event.preventDefault();
              onAbort();
            }
          }}
        />
        <Tooltip label={enhanceTip}>
          <button
            className="composer-enhance"
            type="button"
            aria-label="用 AI 润色当前提示词"
            aria-busy={enhancing}
            disabled={disabled || enhancing || !value.trim()}
            onClick={() => void enhance()}
          >
            {enhancing ? <Spinner size={13} /> : <IconSpark size={14} />}
          </button>
        </Tooltip>
      </div>

      {enhanceError ? <p className="composer-status">{enhanceError}</p> : null}

      <div className="composer-row">
        <Popover
          title="切换模型"
          disabled={disabled}
          label={
            <>
              <span className="picker-key">模型</span>
              <span className="picker-value">{model ?? "—"}</span>
              <IconChevronDown size={11} />
            </>
          }
        >
          {(close) => (
            <>
              <div className="popover-search-row">
                <input
                  className="popover-search"
                  autoFocus
                  spellCheck={false}
                  placeholder="搜索模型"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
              </div>
              <div className="popover-list">
                {filtered.map((entry) => {
                  const full = `${entry.provider}/${entry.id}`;
                  // Some providers expose internal codes as the model id. Lead
                  // with the readable name and keep the code underneath,
                  // otherwise the picker becomes a list of identifiers that only
                  // the provider's own source understands.
                  const readable = Boolean(entry.name && entry.name !== entry.id);
                  return (
                    <button
                      key={full}
                      type="button"
                      className={`popover-item${model === full ? " is-active" : ""}`}
                      onClick={() => {
                        onSetModel(entry.provider, entry.id);
                        close();
                      }}
                    >
                      <span className="popover-item-name">{readable ? entry.name : entry.id}</span>
                      <span className="popover-item-sub">
                        {readable ? `${entry.provider} · ${entry.id}` : entry.provider}
                      </span>
                    </button>
                  );
                })}
                {filtered.length === 0 ? (
                  <p className="popover-empty">{disabled ? "引擎未运行" : "没有匹配的模型"}</p>
                ) : null}
              </div>
            </>
          )}
        </Popover>

        <Popover
          title={thinkingTip}
          disabled={disabled || !levelsAdjustable}
          label={
            <>
              <span className="picker-key">思考</span>
              <span className="picker-value">
                {thinkingLevel ?? (levels.length === 1 ? levels[0] : "—")}
              </span>
              <IconChevronDown size={11} />
            </>
          }
        >
          {(close) => (
            <div className="popover-list popover-list-short">
              {levels.map((level) => (
                <button
                  key={level}
                  type="button"
                  className={`popover-item${thinkingLevel === level ? " is-active" : ""}`}
                  onClick={() => {
                    onSetThinkingLevel(level);
                    close();
                  }}
                >
                  <span className="popover-item-name">{level}</span>
                </button>
              ))}
            </div>
          )}
        </Popover>

        <Popover
          title={skillsTip}
          disabled={disabled}
          panelClass="popover-panel-skills"
          label={
            <>
              <span className="picker-key">Skills</span>
              <span className="picker-value">
                {skillList.length === 0 ? "—" : `${enabledSkills}/${skillList.length}`}
              </span>
              <IconChevronDown size={11} />
            </>
          }
        >
          {() => (
            <SkillsPanel
              skillList={skillList}
              addable={addable}
              onSetChatSkill={onSetChatSkill}
              onForgetChatSkill={onForgetChatSkill}
            />
          )}
        </Popover>

        <span className="spacer" />

        {busy ? (
          <button className="btn btn-danger" type="button" onClick={onAbort}>
            中断 <kbd>Esc</kbd>
          </button>
        ) : null}
        <button
          className="btn btn-primary"
          type="button"
          disabled={disabled || !value.trim()}
          onClick={() => submit()}
        >
          {busy ? "追加" : "发送"}
        </button>
      </div>
    </div>
  );
}
