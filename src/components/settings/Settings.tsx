import { useEffect, useRef, useState, type ComponentType } from "react";

import type { AppearanceApi } from "../../hooks/useAppearance";
import { configApi, type ArchivedChat, type ConfigPaths } from "../../lib/configBridge";
import type { ModelOption } from "../../lib/protocol";
import {
  IconAppearance,
  IconArchive,
  IconChip,
  IconChevronRight,
  IconFile,
  IconPlug,
  IconSliders,
  IconSpark,
} from "../ui/Icons";
import { Tooltip } from "../ui/Tooltip";
import { AppearanceTab } from "./AppearanceTab";
import { ArchiveTab } from "./ArchiveTab";
import { GeneralTab, RawTab } from "./GeneralTab";
import { McpTab } from "./McpTab";
import { ProvidersTab } from "./ProvidersTab";
import { SkillsTab } from "./SkillsTab";

type SectionId =
  | "appearance"
  | "providers"
  | "mcp"
  | "skills"
  | "archive"
  | "general"
  | "raw";

const SECTIONS: Array<{
  id: SectionId;
  label: string;
  Icon: ComponentType<{ size?: number }>;
}> = [
  { id: "appearance", label: "外观", Icon: IconAppearance },
  { id: "providers", label: "模型供应商", Icon: IconChip },
  { id: "mcp", label: "MCP", Icon: IconPlug },
  { id: "skills", label: "Skills", Icon: IconSpark },
  { id: "archive", label: "已归档会话", Icon: IconArchive },
  { id: "general", label: "通用", Icon: IconSliders },
  { id: "raw", label: "原始文件", Icon: IconFile },
];

/**
 * Settings is a full page with a section rail on the left, matching how
 * StackFerry lays settings out — a page, not a modal, so tables and drawers
 * have room to breathe.
 */
export function Settings({
  onClose,
  onApplyConfig,
  onRestartEngine,
  appearance,
  allModels,
  archived,
  onUnarchive,
  onRemoveArchived,
  onSetGlobalSkill,
}: {
  onClose: () => void;
  /**
   * Make the engine re-read its configuration in place. Resolves `false` when
   * that failed, which is the only case in which a restart is still offered.
   */
  onApplyConfig: () => Promise<boolean>;
  /** The fallback when the in-place reload did not take. */
  onRestartEngine: () => void;
  appearance: AppearanceApi;
  /** Every model pi reports, so the provider tab can offer them for the picker. */
  allModels: ModelOption[];
  /** Archived chats across all workspaces, for the 已归档会话 section. */
  archived: ArchivedChat[];
  onUnarchive: (workspacePath: string, chatId: string) => void;
  onRemoveArchived: (workspacePath: string, chatId: string) => void;
  /** Add a skill to (or remove it from) the global list: on in every conversation. */
  onSetGlobalSkill: (key: string, global: boolean) => void;
}) {
  const [section, setSection] = useState<SectionId>("appearance");
  const [paths, setPaths] = useState<ConfigPaths | null>(null);
  const [pathsError, setPathsError] = useState<string | null>(null);
  /** `null` when nothing is pending; otherwise how the last apply went. */
  const [apply, setApply] = useState<"applying" | "ok" | "error" | null>(null);
  const applyTimer = useRef<number | null>(null);
  const applying = useRef(false);
  const queued = useRef(false);

  useEffect(() => {
    void configApi
      .paths()
      .then(setPaths)
      .catch((error: unknown) => setPathsError(String(error)));
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  /**
   * Re-read the engine after a configuration write.
   *
   * Every tab that writes a file calls this. It used to raise a "pi 不会自动重读"
   * banner with a restart button, which priced each edit at a full engine
   * restart (~5.6s, and the session went blank while it came back). pi can
   * re-read its configuration in place instead, so the write is simply followed
   * by a reload.
   *
   * Debounced and trailing-coalesced: a row of switches is one change as far as
   * the engine is concerned, and a write that lands mid-reload queues exactly
   * one more run rather than racing the one in flight.
   */
  const runApply = async () => {
    if (applying.current) {
      queued.current = true;
      return;
    }
    applying.current = true;
    setApply("applying");
    const ok = await onApplyConfig();
    applying.current = false;
    setApply(ok ? "ok" : "error");
    if (queued.current) {
      queued.current = false;
      await runApply();
    }
  };

  const markDirty = () => {
    if (applyTimer.current !== null) window.clearTimeout(applyTimer.current);
    applyTimer.current = window.setTimeout(() => {
      applyTimer.current = null;
      void runApply();
    }, 300);
  };

  useEffect(
    () => () => {
      if (applyTimer.current !== null) window.clearTimeout(applyTimer.current);
    },
    [],
  );

  // Success is feedback, not a status: it goes away on its own. Failure stays,
  // because it is the only thing that explains the button beside it.
  useEffect(() => {
    if (apply !== "ok") return;
    const timer = window.setTimeout(() => setApply(null), 2600);
    return () => window.clearTimeout(timer);
  }, [apply]);

  return (
    <div className="settings-page">
      <nav className="settings-nav" aria-label="设置分区">
        <button className="nav-item nav-item-back" type="button" onClick={onClose}>
          <IconChevronRight size={14} />
          返回对话
        </button>

        <div className="nav-sep" />

        {SECTIONS.map(({ id, label, Icon }) => (
          <button
            key={id}
            type="button"
            className={`nav-item${section === id ? " is-active" : ""}`}
            aria-current={section === id ? "page" : undefined}
            onClick={() => setSection(id)}
          >
            <Icon size={15} />
            {label}
          </button>
        ))}

        <div className="nav-foot">
          {apply === "error" ? (
            <div className="dirty-block">
              <p className="dirty-text is-error">配置未能自动应用</p>
              <button className="btn btn-block" type="button" onClick={onRestartEngine}>
                重启引擎
              </button>
            </div>
          ) : apply ? (
            <p className={`dirty-text${apply === "ok" ? " is-ok" : ""}`}>
              {apply === "ok" ? "配置已应用，无需重启" : "正在应用配置…"}
            </p>
          ) : null}
          <Tooltip label={paths?.agentDir ?? pathsError ?? "读取中…"} side="right" wide block>
            <p className="nav-path">{paths?.agentDir ?? pathsError ?? "读取中…"}</p>
          </Tooltip>
        </div>
      </nav>

      <div className="settings-main">
        <div className="settings-inner">
          {section === "appearance" ? <AppearanceTab appearance={appearance} /> : null}
          {section === "providers" ? (
            <ProvidersTab
              paths={paths}
              onDirty={markDirty}
              appearance={appearance}
              allModels={allModels}
            />
          ) : null}
          {section === "mcp" ? <McpTab paths={paths} onDirty={markDirty} /> : null}
          {section === "skills" ? (
            <SkillsTab
              paths={paths}
              onDirty={markDirty}
              globalSkills={appearance.prefs.globalSkills}
              onSetGlobal={onSetGlobalSkill}
            />
          ) : null}
          {section === "archive" ? (
            <ArchiveTab
              archived={archived}
              onUnarchive={onUnarchive}
              onRemove={onRemoveArchived}
            />
          ) : null}
          {section === "general" ? <GeneralTab onDirty={markDirty} /> : null}
          {section === "raw" ? <RawTab paths={paths} onDirty={markDirty} /> : null}
        </div>
      </div>
    </div>
  );
}
