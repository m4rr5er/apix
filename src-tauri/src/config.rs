//! Read/write access to pi's own configuration files.
//!
//! APIX is an editor over `~/.pi/agent/*`, never a parallel store. pi stays the
//! single source of truth: anything configured here is immediately visible to
//! `pi` on the command line, and vice versa.
//!
//! | Feature        | File                                     |
//! |----------------|------------------------------------------|
//! | providers      | `<agent>/models.json`                    |
//! | defaults/misc  | `<agent>/settings.json`                  |
//! | MCP servers    | `<agent>/mcp.json`                       |
//! | skills         | `<agent>/skills/<name>/SKILL.md`         |
//!
//! Writes are atomic (temp file + rename) and formatting is preserved as
//! 2-space JSON, which is what pi itself emits. Deletion of a skill never
//! unlinks anything: the directory is moved into `<agent>/.trash/`.

use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;
use serde_json::{json, Map, Value};

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

const FILE_MODELS: &str = "models.json";
const FILE_SETTINGS: &str = "settings.json";
const FILE_MCP: &str = "mcp.json";

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

fn home_dir() -> Result<PathBuf, String> {
    std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .map(PathBuf::from)
        .filter(|path| !path.as_os_str().is_empty())
        .ok_or_else(|| "cannot determine the home directory".to_string())
}

/// pi's agent directory. `APIX_AGENT_DIR` overrides it for unusual installs.
pub fn agent_dir() -> Result<PathBuf, String> {
    if let Ok(dir) = std::env::var("APIX_AGENT_DIR") {
        if !dir.trim().is_empty() {
            return Ok(PathBuf::from(dir));
        }
    }
    Ok(home_dir()?.join(".pi").join("agent"))
}

fn config_file(name: &str) -> Result<PathBuf, String> {
    Ok(agent_dir()?.join(name))
}

fn skills_root() -> Result<PathBuf, String> {
    Ok(agent_dir()?.join("skills"))
}

/// `~/.agents/skills` — pi also reads this location. Listed read-only.
fn shared_skills_root() -> Result<PathBuf, String> {
    Ok(home_dir()?.join(".agents").join("skills"))
}

fn trash_root() -> Result<PathBuf, String> {
    Ok(agent_dir()?.join(".trash"))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigPaths {
    pub agent_dir: String,
    pub models: String,
    pub settings: String,
    pub mcp: String,
    pub auth: String,
    pub skills_dir: String,
    pub shared_skills_dir: String,
}

// ---------------------------------------------------------------------------
// File helpers
// ---------------------------------------------------------------------------

fn read_json(path: &Path) -> Result<Value, String> {
    if !path.is_file() {
        return Ok(json!({}));
    }
    let text =
        std::fs::read_to_string(path).map_err(|e| format!("read {} failed: {e}", path.display()))?;
    if text.trim().is_empty() {
        return Ok(json!({}));
    }
    serde_json::from_str(&text).map_err(|e| format!("{} is not valid JSON: {e}", path.display()))
}

fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("create {} failed: {e}", parent.display()))?;
    }
    let temp = path.with_extension("apix-tmp");
    std::fs::write(&temp, bytes).map_err(|e| format!("write {} failed: {e}", temp.display()))?;

    // `rename` replaces an existing file on Windows, so the first attempt
    // normally succeeds; the retries cover the transient sharing violation a
    // virus scanner or search indexer causes while it has the target open. The
    // remove-then-rename fallback is a last resort, because a crash inside it
    // would leave the old file gone and the new one not yet in place.
    let mut last = String::new();
    for attempt in 0..3u32 {
        match std::fs::rename(&temp, path) {
            Ok(()) => return Ok(()),
            Err(error) => {
                last = error.to_string();
                if attempt < 2 {
                    std::thread::sleep(std::time::Duration::from_millis(25));
                }
            }
        }
    }
    let _ = std::fs::remove_file(path);
    std::fs::rename(&temp, path).map_err(|error| {
        format!(
            "save {} failed: {error}（重命名也失败：{last}）",
            path.display()
        )
    })
}

fn write_json(path: &Path, value: &Value) -> Result<(), String> {
    let text = serde_json::to_string_pretty(value).map_err(|e| e.to_string())?;
    write_atomic(path, format!("{text}\n").as_bytes())
}
// ---------------------------------------------------------------------------
// Commands: paths and raw files
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn config_paths() -> Result<ConfigPaths, String> {
    let agent = agent_dir()?;
    Ok(ConfigPaths {
        agent_dir: agent.to_string_lossy().into_owned(),
        models: config_file(FILE_MODELS)?.to_string_lossy().into_owned(),
        settings: config_file(FILE_SETTINGS)?.to_string_lossy().into_owned(),
        mcp: config_file(FILE_MCP)?.to_string_lossy().into_owned(),
        auth: agent.join("auth.json").to_string_lossy().into_owned(),
        skills_dir: skills_root()?.to_string_lossy().into_owned(),
        shared_skills_dir: shared_skills_root()?.to_string_lossy().into_owned(),
    })
}

/// `which` is `models`, `settings`, or `mcp`.
fn file_for(which: &str) -> Result<PathBuf, String> {
    match which {
        "models" => config_file(FILE_MODELS),
        "settings" => config_file(FILE_SETTINGS),
        "mcp" => config_file(FILE_MCP),
        other => Err(format!("unknown config file: {other}")),
    }
}

#[tauri::command]
pub fn config_read_raw(which: String) -> Result<String, String> {
    let path = file_for(&which)?;
    if !path.is_file() {
        return Ok("{}".to_string());
    }
    std::fs::read_to_string(&path).map_err(|e| format!("read {} failed: {e}", path.display()))
}

#[tauri::command]
pub fn config_write_raw(which: String, content: String) -> Result<Value, String> {
    // Reject broken JSON before it ever reaches pi.
    let parsed: Value = serde_json::from_str(&content)
        .map_err(|e| format!("JSON 语法错误，未写入：{e}"))?;
    let path = file_for(&which)?;
    write_json(&path, &parsed)?;
    Ok(parsed)
}

// ---------------------------------------------------------------------------
// Commands: models.json
// ---------------------------------------------------------------------------

fn models_document() -> Result<Value, String> {
    let value = read_json(&config_file(FILE_MODELS)?)?;
    if value.is_object() {
        Ok(value)
    } else {
        Ok(json!({}))
    }
}

/// The whole `models.json`, normalised so `providers` always exists.
#[tauri::command]
pub fn models_read() -> Result<Value, String> {
    let mut value = models_document()?;
    if let Some(map) = value.as_object_mut() {
        if !map.contains_key("providers") || !map["providers"].is_object() {
            map.insert("providers".to_string(), json!({}));
        }
    }
    Ok(value)
}

#[tauri::command]
pub fn models_write(document: Value) -> Result<(), String> {
    let providers = document
        .get("providers")
        .and_then(Value::as_object)
        .ok_or_else(|| "models.json 需要一个 providers 对象".to_string())?;

    for (name, provider) in providers {
        let provider = provider
            .as_object()
            .ok_or_else(|| format!("供应商 {name} 的值必须是对象"))?;
        if let Some(base_url) = provider.get("baseUrl") {
            if !base_url.is_string() {
                return Err(format!("供应商 {name} 的 baseUrl 必须是字符串"));
            }
        }
        if let Some(models) = provider.get("models") {
            let models = models
                .as_array()
                .ok_or_else(|| format!("供应商 {name} 的 models 必须是数组"))?;
            for (index, model) in models.iter().enumerate() {
                let model = model.as_object().ok_or_else(|| {
                    format!("供应商 {name} 的第 {} 个模型必须是对象", index + 1)
                })?;
                let id = model.get("id").and_then(Value::as_str).unwrap_or("");
                if id.trim().is_empty() {
                    return Err(format!("供应商 {name} 的第 {} 个模型缺少 id", index + 1));
                }
            }
        }
    }

    write_json(&config_file(FILE_MODELS)?, &document)
}

// ---------------------------------------------------------------------------
// Commands: settings.json
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn settings_read() -> Result<Value, String> {
    read_json(&config_file(FILE_SETTINGS)?)
}

/// Shallow merge. A `null` value removes the key.
#[tauri::command]
pub fn settings_patch(patch: Value) -> Result<Value, String> {
    let patch = patch
        .as_object()
        .ok_or_else(|| "patch 必须是对象".to_string())?;

    let path = config_file(FILE_SETTINGS)?;
    let mut current = read_json(&path)?;
    if !current.is_object() {
        current = json!({});
    }
    let map = current.as_object_mut().expect("checked above");

    for (key, value) in patch {
        if value.is_null() {
            map.remove(key);
        } else {
            map.insert(key.clone(), value.clone());
        }
    }

    write_json(&path, &current)?;
    Ok(current)
}

// ---------------------------------------------------------------------------
// Commands: mcp.json
// ---------------------------------------------------------------------------

fn mcp_document() -> Result<Value, String> {
    let value = read_json(&config_file(FILE_MCP)?)?;
    if value.is_object() {
        Ok(value)
    } else {
        Ok(json!({}))
    }
}

#[tauri::command]
pub fn mcp_read() -> Result<Value, String> {
    let mut value = mcp_document()?;
    if let Some(map) = value.as_object_mut() {
        if !map.contains_key("mcpServers") || !map["mcpServers"].is_object() {
            map.insert("mcpServers".to_string(), json!({}));
        }
    }
    Ok(value)
}

#[tauri::command]
pub fn mcp_write(document: Value) -> Result<(), String> {
    let servers = document
        .get("mcpServers")
        .and_then(Value::as_object)
        .ok_or_else(|| "mcp.json 需要一个 mcpServers 对象".to_string())?;

    for (name, server) in servers {
        let server = server
            .as_object()
            .ok_or_else(|| format!("服务器 {name} 的值必须是对象"))?;
        let command = server.get("command").and_then(Value::as_str).unwrap_or("");
        let url = server.get("url").and_then(Value::as_str).unwrap_or("");
        if !command.is_empty() && !url.is_empty() {
            return Err(format!("服务器 {name} 不能同时有 command 和 url"));
        }
        // An entry that only toggles settings may legitimately omit both.
        if let Some(args) = server.get("args") {
            if !args.is_array() {
                return Err(format!("服务器 {name} 的 args 必须是数组"));
            }
        }
    }

    write_json(&config_file(FILE_MCP)?, &document)
}

// ---------------------------------------------------------------------------
// Commands: skills
// ---------------------------------------------------------------------------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillEntry {
    pub id: String,
    pub name: String,
    pub description: String,
    /// `agent` (`<agent>/skills`, writable) or `agents` (`~/.agents/skills`).
    pub source: String,
    pub path: String,
    pub writable: bool,
    pub disable_model_invocation: bool,
    /// True for a skill APIX itself ships — part of the app, not the user's own.
    ///
    /// Identified by the marker the installer writes into SKILL.md, not by the
    /// directory: built-ins live in the same skills root as everything else, so
    /// nothing about the path distinguishes them.
    pub builtin: bool,
}

fn is_valid_skill_id(id: &str) -> bool {
    if id.is_empty() || id.len() > 64 {
        return false;
    }
    let bytes = id.as_bytes();
    if !bytes[0].is_ascii_lowercase() && !bytes[0].is_ascii_digit() {
        return false;
    }
    if !bytes[bytes.len() - 1].is_ascii_alphanumeric() {
        return false;
    }
    id.bytes()
        .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
        && !id.contains("--")
}

/// Minimal frontmatter reader: we only need name, description and the
/// model-invocation flag, and pi warns rather than fails on odd fields.
fn parse_frontmatter(text: &str) -> (Option<String>, Option<String>, bool) {
    let mut name = None;
    let mut description = None;
    let mut disable = false;

    let text = text.trim_start_matches('\u{feff}');
    if !text.starts_with("---") {
        return (name, description, disable);
    }

    let mut lines = text.lines();
    lines.next();

    for line in lines {
        let trimmed = line.trim();
        if trimmed == "---" || trimmed == "..." {
            break;
        }
        let Some((key, value)) = trimmed.split_once(':') else {
            continue;
        };
        let value = value.trim().trim_matches('"').trim_matches('\'').to_string();
        match key.trim() {
            "name" => name = Some(value),
            "description" => description = Some(value),
            "disable-model-invocation" => disable = value == "true",
            _ => {}
        }
    }

    (name, description, disable)
}

fn scan_skills(root: &Path, source: &str, writable: bool, out: &mut Vec<SkillEntry>) {
    let Ok(entries) = std::fs::read_dir(root) else {
        return;
    };
    for entry in entries.flatten() {
        let dir = entry.path();
        if !dir.is_dir() {
            continue;
        }
        let manifest = dir.join("SKILL.md");
        if !manifest.is_file() {
            continue;
        }
        let id = entry.file_name().to_string_lossy().into_owned();
        let text = std::fs::read_to_string(&manifest).unwrap_or_default();
        let (name, description, disable) = parse_frontmatter(&text);
        out.push(SkillEntry {
            name: name.filter(|n| !n.is_empty()).unwrap_or_else(|| id.clone()),
            description: description.unwrap_or_default(),
            id,
            source: source.to_string(),
            path: manifest.to_string_lossy().into_owned(),
            writable,
            disable_model_invocation: disable,
            builtin: text.contains(BUILTIN_MARKER),
        });
    }
}

#[tauri::command]
pub fn skills_list() -> Result<Vec<SkillEntry>, String> {
    let mut out = Vec::new();
    scan_skills(&skills_root()?, "agent", true, &mut out);
    if let Ok(shared) = shared_skills_root() {
        scan_skills(&shared, "agents", false, &mut out);
    }
    out.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(out)
}

/// Resolve `(source, id)` to the skill directory, refusing anything that could
/// escape the skills root.
fn skill_dir(source: &str, id: &str) -> Result<PathBuf, String> {
    if !is_valid_skill_id(id) {
        return Err(format!(
            "非法 skill 名称「{id}」：只允许小写字母、数字和连字符，最长 64 字符"
        ));
    }
    let root = match source {
        "agent" => skills_root()?,
        "agents" => shared_skills_root()?,
        other => return Err(format!("未知来源：{other}")),
    };
    let dir = root.join(id);
    if !dir.starts_with(&root) {
        return Err("路径越界".to_string());
    }
    Ok(dir)
}

#[tauri::command]
pub fn skill_read(source: String, id: String) -> Result<String, String> {
    let manifest = skill_dir(&source, &id)?.join("SKILL.md");
    std::fs::read_to_string(&manifest).map_err(|e| format!("read {} failed: {e}", manifest.display()))
}

#[tauri::command]
pub fn skill_write(source: String, id: String, content: String) -> Result<(), String> {
    if source != "agent" {
        return Err("~/.agents/skills 下的 skill 是只读的".to_string());
    }
    let manifest = skill_dir(&source, &id)?.join("SKILL.md");
    write_atomic(&manifest, content.as_bytes())
}

#[tauri::command]
pub fn skill_create(id: String, name: String, description: String) -> Result<SkillEntry, String> {
    let dir = skill_dir("agent", &id)?;
    if dir.exists() {
        return Err(format!("同名 skill 已存在：{id}"));
    }
    std::fs::create_dir_all(&dir).map_err(|e| format!("create {} failed: {e}", dir.display()))?;

    let display = if name.trim().is_empty() { &id } else { name.trim() };
    let about = if description.trim().is_empty() {
        "TODO: 说明这个 skill 做什么、以及什么时候该用它。"
    } else {
        description.trim()
    };
    let template = format!(
        "---\nname: {id}\ndescription: {about}\n---\n\n# {display}\n\n在这里写具体指令。可以引用本目录下的相对路径，例如 `references/notes.md`。\n"
    );
    let manifest = dir.join("SKILL.md");
    write_atomic(&manifest, template.as_bytes())?;

    Ok(SkillEntry {
        id: id.clone(),
        name: display.to_string(),
        description: about.to_string(),
        source: "agent".to_string(),
        path: manifest.to_string_lossy().into_owned(),
        writable: true,
        disable_model_invocation: false,
        builtin: false,
    })
}

/// Never unlinks: moves `<agent>/skills/<id>` into `<agent>/.trash/<ts>-<id>`.
///
/// Refuses a built-in skill. The UI hides its delete button, but the guard
/// belongs here as well: a built-in skill is part of the app, and `pi` would
/// keep working without it only by accident. Editing one is still allowed —
/// `ensure_builtin_skills` reinstates the shipped body only when the marker is
/// gone, so a user's tweak survives.
#[tauri::command]
pub fn skill_delete(id: String) -> Result<String, String> {
    let dir = skill_dir("agent", &id)?;
    if !dir.is_dir() {
        return Err(format!("skill 不存在：{id}"));
    }
    let manifest = dir.join("SKILL.md");
    if std::fs::read_to_string(&manifest)
        .map(|text| text.contains(BUILTIN_MARKER))
        .unwrap_or(false)
    {
        return Err(format!("{id} 是 APIX 内置 skill，不能删除（可以编辑内容）"));
    }

    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let trash = trash_root()?;
    std::fs::create_dir_all(&trash).map_err(|e| format!("create {} failed: {e}", trash.display()))?;

    let target = trash.join(format!("{stamp}-{id}"));
    std::fs::rename(&dir, &target).map_err(|e| {
        format!(
            "移动 {} 到回收站失败：{e}",
            dir.display()
        )
    })?;
    Ok(target.to_string_lossy().into_owned())
}

// ---------------------------------------------------------------------------
// Built-in skills
// ---------------------------------------------------------------------------

/// Marker that marks a file as APIX-managed inside a built-in skill.
const BUILTIN_MARKER: &str = "apix-managed";

/// Skills APIX ships, embedded at compile time and materialised on disk so pi
/// discovers them through its normal skill scan.
///
/// Built-in skills are always enabled (`src/lib/skills.ts` locks their switch
/// on), so each one costs its name, description and path in the system prompt.
/// The body is not paid for until the skill is actually used: pi advertises
/// `name`/`description`/`location` and the model reads the file only when the
/// task matches. Keep every description short for that reason.
const BUILTIN_SKILLS: &[(&str, &str)] = &[
    (
        "apix-context-handoff",
        include_str!("../assets/skills/apix-context-handoff/SKILL.md"),
    ),
    (
        "apix-skill-author",
        include_str!("../assets/skills/apix-skill-author/SKILL.md"),
    ),
    (
        "apix-mcp-author",
        include_str!("../assets/skills/apix-mcp-author/SKILL.md"),
    ),
];

/// Write the built-in skills into `<agent>/skills/`.
///
/// A file is written only when it is missing, or when the existing copy still
/// carries APIX's marker comment. Removing the marker takes ownership: APIX
/// then leaves that file alone forever, so a local edit survives upgrades.
pub fn ensure_builtin_skills() -> Result<Vec<(String, PathBuf)>, String> {
    let root = skills_root()?;
    let mut result = Vec::new();

    for (id, body) in BUILTIN_SKILLS {
        let dir = root.join(id);
        std::fs::create_dir_all(&dir)
            .map_err(|err| format!("create {} failed: {err}", dir.display()))?;

        let manifest = dir.join("SKILL.md");
        let should_write = match std::fs::read_to_string(&manifest) {
            Ok(existing) => existing != *body && existing.contains(BUILTIN_MARKER),
            Err(_) => true,
        };
        if should_write {
            write_atomic(&manifest, body.as_bytes())?;
        }

        result.push(((*id).to_string(), manifest));
    }

    Ok(result)
}

/// Ensure the built-in skills exist, then return one skill's absolute path.
#[tauri::command]
pub fn skill_builtin_path(id: String) -> Result<String, String> {
    ensure_builtin_skills()?
        .into_iter()
        .find(|(name, _)| *name == id)
        .map(|(_, path)| path.to_string_lossy().into_owned())
        .ok_or_else(|| format!("没有名为 {id} 的内置 skill"))
}

/// pi exposes its in-place reload — `ctx.reload()` — to *extensions* only:
/// there is no RPC command for it. So the one way to make a running pi re-read
/// `models.json`, `settings.json`, `mcp.json` and the skills directory without
/// replacing the process is to load an extension that registers a command
/// which calls it.
///
/// APIX writes this next to its own state file rather than into
/// `<agent>/extensions`, so pi's other frontends (its own TUI, dsh) never
/// inherit an APIX-only command.
const APIX_RELOAD_EXTENSION: &str = r#"/**
 * APIX: re-read settings, skills, MCP servers and models without a restart.
 *
 * Loaded with `pi --extension <this file>`. APIX sends `/apix-reload` after it
 * writes a configuration file; `ctx.reload()` replays the session-start work
 * against the files as they now are, which rebuilds the runtime (~1.1s) instead
 * of respawning pi (~5.6s) and leaves the open session and its transcript
 * untouched.
 *
 * The handler must not touch `ctx` after awaiting `reload()`: the reload
 * invalidates it, and any later call throws "This extension ctx is stale".
 */
export default function apixReload(pi) {
  pi.registerCommand("apix-reload", {
    description: "APIX: re-read settings and resources in place",
    handler: async (_args, ctx) => {
      await ctx.reload();
    },
  });
}
"#;

/// Write the reload extension (only when its content differs) and return its
/// path, ready to be handed to pi as `--extension`.
pub fn apix_reload_extension() -> Result<PathBuf, String> {
    let path = apix_dir()?.join("apix-reload.js");
    let should_write = match std::fs::read_to_string(&path) {
        Ok(existing) => existing != APIX_RELOAD_EXTENSION,
        // An unreadable file is rewritten, not reported: the reload is optional
        // and pi must be able to start whether or not this file is usable.
        Err(_) => true,
    };
    if should_write {
        write_atomic(&path, APIX_RELOAD_EXTENSION.as_bytes())?;
    }
    Ok(path)
}

// ---------------------------------------------------------------------------
// Commands: list pi's session files for a workspace
// ---------------------------------------------------------------------------

/// One `.jsonl` session file pi wrote for a workspace.
#[derive(Serialize)]
pub struct SessionFileInfo {
    pub path: String,
    pub file_name: String,
    /// File mtime, ms since the epoch.
    pub modified_ms: u64,
    pub size: u64,
}

/// The inventory APIX needs to decide how to reopen a chat.
#[derive(Serialize)]
pub struct SessionListing {
    /// The session directory pi would use for this cwd (may not exist yet).
    pub dir: String,
    /// Every session file in it, newest first.
    pub files: Vec<SessionFileInfo>,
    /// Whether the caller's recorded session path is a real file on disk.
    ///
    /// pi happily "opens" a session path that does not exist: `switch_session`
    /// succeeds, `get_state` hands the same missing path back, and the session
    /// has zero messages. So the UI cannot tell "resumed" from "resumed into
    /// nothing" without this check — and that difference is exactly the
    /// difference between showing a conversation and showing a blank page.
    pub recorded_exists: bool,
}

/// Directory pi stores a cwd's sessions in.
///
/// Mirrors pi's own encoding (`core/session-manager.js`): the resolved cwd
/// loses its leading separator, every `/`, `\` and `:` becomes `-`, and the
/// result is wrapped in `--`. Getting this wrong silently returns no files, so
/// it is duplicated here rather than guessed at the call site.
fn session_dir_for(cwd: &str) -> Result<PathBuf, String> {
    let trimmed = cwd.trim().trim_end_matches(['/', '\\']);
    if trimmed.is_empty() {
        return Err("工作区路径为空".to_string());
    }
    let body = trimmed
        .trim_start_matches(['/', '\\'])
        .replace(['/', '\\', ':'], "-");
    Ok(agent_dir()?.join("sessions").join(format!("--{body}--")))
}

fn modified_ms(meta: &std::fs::Metadata) -> u64 {
    meta.modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|delta| delta.as_millis() as u64)
        .unwrap_or(0)
}

/// List the pi session files belonging to a workspace.
///
/// Read-only, and deliberately tolerant: an unreadable directory or entry
/// yields an empty/partial list rather than an error, because the caller's
/// fallback (open a fresh session) is better than refusing to open the chat.
#[tauri::command]
pub fn sessions_list(cwd: String, recorded: Option<String>) -> Result<SessionListing, String> {
    let dir = session_dir_for(&cwd)?;
    let dir_text = dir.to_string_lossy().into_owned();

    let recorded_exists = recorded
        .as_deref()
        .map(str::trim)
        .filter(|path| !path.is_empty())
        .map(|path| Path::new(path).is_file())
        .unwrap_or(false);

    if !dir.is_dir() {
        return Ok(SessionListing {
            dir: dir_text,
            files: Vec::new(),
            recorded_exists,
        });
    }

    let mut files = Vec::new();
    let entries = std::fs::read_dir(&dir).map_err(|error| format!("读取会话目录失败：{error}"))?;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|ext| ext.to_str()) != Some("jsonl") {
            continue;
        }
        let Ok(meta) = entry.metadata() else { continue };
        if !meta.is_file() {
            continue;
        }
        files.push(SessionFileInfo {
            path: path.to_string_lossy().into_owned(),
            file_name: entry.file_name().to_string_lossy().into_owned(),
            modified_ms: modified_ms(&meta),
            size: meta.len(),
        });
    }
    files.sort_by(|a, b| b.modified_ms.cmp(&a.modified_ms));

    Ok(SessionListing {
        dir: dir_text,
        files,
        recorded_exists,
    })
}

// ---------------------------------------------------------------------------
// Commands: reveal in the file manager
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn open_path(path: String) -> Result<(), String> {
    if path.trim().is_empty() {
        return Err("路径为空".to_string());
    }
    let target = PathBuf::from(&path);
    let existing = if target.exists() {
        target
    } else {
        target
            .parent()
            .map(Path::to_path_buf)
            .filter(|p| p.exists())
            .ok_or_else(|| format!("路径不存在：{path}"))?
    };

    #[cfg(windows)]
    let mut command = {
        use std::os::windows::process::CommandExt;
        let mut c = std::process::Command::new("explorer.exe");
        c.arg(existing.as_os_str()).creation_flags(CREATE_NO_WINDOW);
        c
    };
    #[cfg(target_os = "macos")]
    let mut command = {
        let mut c = std::process::Command::new("open");
        c.arg(existing.as_os_str());
        c
    };
    #[cfg(all(unix, not(target_os = "macos")))]
    let mut command = {
        let mut c = std::process::Command::new("xdg-open");
        c.arg(existing.as_os_str());
        c
    };

    command
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("无法打开文件管理器：{e}"))?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Commands: remember the last workspace
// ---------------------------------------------------------------------------

/// APIX's own directory. Deliberately outside pi's agent directory, so nothing
/// APIX writes here is ever mistaken for a pi-owned config file.
fn apix_dir() -> Result<PathBuf, String> {
    let base = std::env::var_os("APPDATA")
        .map(PathBuf::from)
        .or_else(|| home_dir().ok().map(|home| home.join(".config")))
        .ok_or_else(|| "cannot determine the app data directory".to_string())?;
    Ok(base.join("APIX"))
}

/// APIX's own small state file.
fn state_file() -> Result<PathBuf, String> {
    Ok(apix_dir()?.join("state.json"))
}

/// Guards every read-modify-write of APIX's own state file.
///
/// Three writers touch it: the `workspaces` and `ui` commands, and
/// `remember_workdir`, which fires on *every* engine start — i.e. at exactly the
/// moment the frontend is writing session bindings. Each one reads the whole
/// document, replaces one key and writes it back, so two overlapping writes make
/// the later one publish a snapshot that predates the first: the session index
/// silently reverts to what it looked like before the new chat was bound. That
/// is the same symptom as a lost conversation, so it is worth the mutex.
static STATE_LOCK: Mutex<()> = Mutex::new(());

/// Take the state lock, ignoring poisoning: a panic in one writer must not
/// disable persistence for the rest of the run.
fn lock_state() -> std::sync::MutexGuard<'static, ()> {
    STATE_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// Read APIX's state, recovering from a damaged file.
///
/// `read_json` reports invalid JSON as an error, which is the worst outcome
/// here: every read would fail (so the UI shows no workspaces at all) *and*
/// every write would fail (so the file can never be repaired from inside the
/// app). This document is a rebuildable index, so the damaged bytes are moved
/// aside — never deleted — and an empty document is returned instead, with the
/// backup path reported so the UI can say what happened.
fn read_state_file(path: &Path) -> Result<Value, String> {
    match read_json(path) {
        Ok(value) => Ok(value),
        Err(error) => {
            let backup = path.with_file_name(format!(
                "{}.corrupt-{}",
                path.file_name()
                    .map(|name| name.to_string_lossy().into_owned())
                    .unwrap_or_else(|| "state.json".to_string()),
                now_millis()
            ));
            let moved = std::fs::rename(path, &backup).is_ok();
            eprintln!(
                "APIX: state.json 无法解析（{error}），{}",
                if moved {
                    format!("已备份到 {}", backup.display())
                } else {
                    "原地保留".to_string()
                }
            );
            Ok(json!({
                "workspaces": [],
                "recoveredFrom": backup.to_string_lossy(),
            }))
        }
    }
}

/// Remembered so a desktop-shortcut launch reopens the last project instead of
/// defaulting to the executable's own folder.
pub fn remember_workdir(path: &Path) {
    let Ok(file) = state_file() else {
        return;
    };
    let _guard = lock_state();
    let mut value = read_state_file(&file).unwrap_or_else(|_| json!({}));
    if !value.is_object() {
        value = json!({});
    }
    if let Some(map) = value.as_object_mut() {
        map.insert(
            "lastWorkdir".to_string(),
            Value::String(path.to_string_lossy().into_owned()),
        );
        map.insert("updatedAt".to_string(), Value::String(now_millis()));
    }
    let _ = write_json(&file, &value);
}

/// Milliseconds since the epoch, as a string. Used only for bookkeeping.
fn now_millis() -> String {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis().to_string())
        .unwrap_or_default()
}

/// Read APIX's own state. Never touches pi's agent directory.
#[tauri::command]
pub fn state_read() -> Result<Value, String> {
    let _guard = lock_state();
    let mut value = read_state_file(&state_file()?)?;
    if !value.is_object() {
        value = json!({});
    }
    if let Some(map) = value.as_object_mut() {
        if !map.get("workspaces").map(Value::is_array).unwrap_or(false) {
            map.insert("workspaces".to_string(), json!([]));
        }
    }
    Ok(value)
}

/// Replace the workspace index.
///
/// Only the `workspaces` key is written: `lastWorkdir` is owned by the engine
/// startup path, and a whole-document write from the UI would race with it.
#[tauri::command]
pub fn state_write_workspaces(workspaces: Value) -> Result<Value, String> {
    if !workspaces.is_array() {
        return Err("workspaces 必须是数组".to_string());
    }

    let _guard = lock_state();
    let file = state_file()?;
    let mut value = read_state_file(&file)?;
    if !value.is_object() {
        value = json!({});
    }
    if let Some(map) = value.as_object_mut() {
        map.insert("workspaces".to_string(), workspaces);
        map.insert("updatedAt".to_string(), Value::String(now_millis()));
    }
    write_json(&file, &value)?;
    Ok(value)
}

/// Replace the `ui` preferences block (theme, motion, …).
///
/// Kept separate from `workspaces` so the two writers never clobber each other,
/// and separate from `lastWorkdir`, which the engine startup path owns.
#[tauri::command]
pub fn state_write_ui(ui: Value) -> Result<Value, String> {
    if !ui.is_object() {
        return Err("ui 必须是对象".to_string());
    }

    let _guard = lock_state();
    let file = state_file()?;
    let mut value = read_state_file(&file)?;
    if !value.is_object() {
        value = json!({});
    }
    if let Some(map) = value.as_object_mut() {
        map.insert("ui".to_string(), ui);
        map.insert("updatedAt".to_string(), Value::String(now_millis()));
    }
    write_json(&file, &value)?;
    Ok(value)
}

/// The remembered workspace, when it still exists.
#[tauri::command]
pub fn state_last_workdir() -> Result<Option<String>, String> {
    let _guard = lock_state();
    let value = read_state_file(&state_file()?)?;
    let path = value
        .get("lastWorkdir")
        .and_then(Value::as_str)
        .map(str::to_string);
    Ok(path.filter(|candidate| Path::new(candidate).is_dir()))
}

// ---------------------------------------------------------------------------
// Commands: probe an OpenAI-compatible /models endpoint
// ---------------------------------------------------------------------------

/// Resolve the `apiKey` syntax pi supports: `$NAME`, `${NAME}`, `$$`, `$!`.
fn resolve_secret(raw: &str) -> Option<String> {
    let raw = raw.trim();
    if raw.is_empty() {
        return None;
    }
    if let Some(rest) = raw.strip_prefix("$$") {
        return Some(format!("${rest}"));
    }
    if let Some(rest) = raw.strip_prefix("$!") {
        return Some(format!("!{rest}"));
    }
    if let Some(rest) = raw.strip_prefix('$') {
        let name = rest.trim_start_matches('{').trim_end_matches('}');
        return std::env::var(name).ok().filter(|v| !v.is_empty());
    }
    // A leading `!` runs a command at request time; we do not execute it here.
    if raw.starts_with('!') {
        return None;
    }
    Some(raw.to_string())
}

/// Node is guaranteed to exist because pi requires it, so we borrow its fetch
/// instead of adding an HTTP stack to the Rust side.
const PROBE_SCRIPT: &str = r#"
const base = process.env.APIX_PROBE_URL || "";
const key = process.env.APIX_PROBE_KEY || "";
const url = base.replace(/\/+$/, "") + "/models";
const headers = {};
if (key) headers["Authorization"] = "Bearer " + key;
fetch(url, { headers })
  .then((r) => r.text().then((t) => ({ ok: r.ok, status: r.status, t })))
  .then(({ ok, status, t }) => {
    if (!ok) { console.error("HTTP " + status + ": " + t.slice(0, 300)); process.exit(1); }
    let parsed;
    try { parsed = JSON.parse(t); } catch { console.error("响应不是 JSON: " + t.slice(0, 200)); process.exit(1); }
    let list;
    if (Array.isArray(parsed)) list = parsed;
    else if (parsed && Array.isArray(parsed.data)) list = parsed.data;
    else if (parsed && Array.isArray(parsed.models)) list = parsed.models;
    else list = [];
    const ids = list
      .map((m) => (typeof m === "string" ? m : m && typeof m.id === "string" ? m.id : m && typeof m.name === "string" ? m.name : null))
      .filter(Boolean);
    if (!ids.length) { console.error("响应里没有解析到任何模型 id"); process.exit(1); }
    console.log(JSON.stringify([...new Set(ids)]));
  })
  .catch((e) => { console.error(String((e && e.message) || e)); process.exit(1); });
"#;

fn probe_blocking(base_url: &str, api_key: &str) -> Result<Vec<String>, String> {
    let base = base_url.trim();
    if base.is_empty() {
        return Err("请先填写 baseUrl".to_string());
    }
    if !base.starts_with("http://") && !base.starts_with("https://") {
        return Err("baseUrl 必须以 http:// 或 https:// 开头".to_string());
    }

    let node = crate::pi::resolve_node();

    let mut command = std::process::Command::new(&node);
    command
        .arg("-e")
        .arg(PROBE_SCRIPT)
        .env("APIX_PROBE_URL", base)
        .env("APIX_PROBE_KEY", resolve_secret(api_key).unwrap_or_default())
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(CREATE_NO_WINDOW);
    }

    let output = command
        .output()
        .map_err(|e| format!("无法启动 node（{}）：{e}", node.display()))?;

    if !output.status.success() {
        let message = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if message.is_empty() {
            "拉取模型列表失败".to_string()
        } else {
            message
        });
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let trimmed = stdout.trim();
    if trimmed.is_empty() {
        return Err("拉取模型列表失败：没有输出".to_string());
    }
    serde_json::from_str::<Vec<String>>(trimmed).map_err(|e| format!("解析模型列表失败：{e}"))
}

#[tauri::command]
pub async fn config_probe_models(base_url: String, api_key: String) -> Result<Vec<String>, String> {
    // `std::process::Command::output` blocks, so keep it off the runtime threads.
    tokio::task::spawn_blocking(move || probe_blocking(&base_url, &api_key))
        .await
        .map_err(|e| e.to_string())?
}

// ---------------------------------------------------------------------------
// Commands: convenience read for the picker
// ---------------------------------------------------------------------------

/// Providers and their model IDs from `models.json`, for the default-model UI.
#[tauri::command]
pub fn models_summary() -> Result<Value, String> {
    let document = models_document()?;
    let mut summary = Map::new();
    if let Some(providers) = document.get("providers").and_then(Value::as_object) {
        for (name, provider) in providers {
            let ids = provider
                .get("models")
                .and_then(Value::as_array)
                .map(|models| {
                    models
                        .iter()
                        .filter_map(|m| m.get("id").and_then(Value::as_str))
                        .map(|s| Value::String(s.to_string()))
                        .collect::<Vec<_>>()
                })
                .unwrap_or_default();
            summary.insert(name.clone(), Value::Array(ids));
        }
    }
    Ok(Value::Object(summary))
}
