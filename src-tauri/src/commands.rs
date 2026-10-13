use serde_json::Value;
use tauri::{AppHandle, Manager, State};

use crate::pi::{PiLocation, PiRegistry};

/// Spawn (or restart) the `pi --mode rpc` engine for one conversation slot.
///
/// `skills` is the conversation's skill allowlist, as SKILL.md paths. Passing it
/// switches the engine to "only these skills exist"; passing `None` leaves pi's
/// own discovery alone. An empty list is a real instruction too — no skill is
/// enabled, so none is offered to the model.
///
/// `session` opens that session file at start-up, which saves the separate
/// `switch_session` round trip — and with it a full runtime rebuild.
#[tauri::command]
pub async fn pi_start(
    app: AppHandle,
    registry: State<'_, PiRegistry>,
    slot: String,
    cwd: Option<String>,
    skills: Option<Vec<String>>,
    session: Option<String>,
) -> Result<PiLocation, String> {
    let handle = registry.get_or_create(&slot);
    handle.start(app, cwd, skills, session).await
}

/// Escape hatch: send a raw RPC command record to one slot's engine.
#[tauri::command]
pub async fn pi_send(
    registry: State<'_, PiRegistry>,
    slot: String,
    command: Value,
) -> Result<(), String> {
    let handle = registry
        .get(&slot)
        .ok_or_else(|| format!("槽位 {slot} 没有引擎"))?;
    handle.send(command).await
}

/// Convenience wrapper for the `prompt` command.
#[tauri::command]
pub async fn pi_prompt(
    registry: State<'_, PiRegistry>,
    slot: String,
    message: String,
    streaming_behavior: Option<String>,
) -> Result<(), String> {
    let handle = registry
        .get(&slot)
        .ok_or_else(|| format!("槽位 {slot} 没有引擎"))?;
    let mut command = serde_json::json!({ "type": "prompt", "message": message });
    if let Some(behavior) = streaming_behavior {
        if let Some(map) = command.as_object_mut() {
            map.insert("streamingBehavior".to_string(), Value::String(behavior));
        }
    }
    handle.send(command).await
}

#[tauri::command]
pub async fn pi_abort(registry: State<'_, PiRegistry>, slot: String) -> Result<(), String> {
    let handle = registry
        .get(&slot)
        .ok_or_else(|| format!("槽位 {slot} 没有引擎"))?;
    handle.send(serde_json::json!({ "type": "abort" })).await
}

#[tauri::command]
pub async fn pi_stop(
    app: AppHandle,
    registry: State<'_, PiRegistry>,
    slot: String,
) -> Result<(), String> {
    if let Some(handle) = registry.get(&slot) {
        handle.stop(Some(app)).await?;
    }
    registry.remove(&slot);
    Ok(())
}

#[tauri::command]
pub async fn pi_status(
    registry: State<'_, PiRegistry>,
    slot: String,
) -> Result<Value, String> {
    match registry.get(&slot) {
        Some(handle) => Ok(handle.status().await),
        None => Ok(serde_json::json!({ "running": false })),
    }
}

/// Default working directory offered by the UI on first launch.
#[tauri::command]
pub fn pi_default_cwd() -> Result<String, String> {
    std::env::current_dir()
        .map(|path| path.to_string_lossy().into_owned())
        .map_err(|err| err.to_string())
}

/// Set the native window background colour.
///
/// WebView2 paints its own default — white — while a resize is in flight and
/// the page has not repainted yet, which flashes on a dark theme. Giving the
/// window an explicit background removes that flash. The frontend pushes the
/// resolved `--apx-bg` here whenever the theme changes.
#[tauri::command]
pub fn window_set_background(
    window: tauri::WebviewWindow,
    color: Option<String>,
) -> Result<(), String> {
    let parsed = match color {
        Some(value) => {
            let hex = value.trim().trim_start_matches('#');
            if hex.len() != 6 {
                return Err(format!("颜色必须是 #RRGGBB 形式，收到：{value}"));
            }
            let channel = |range: std::ops::Range<usize>| {
                u8::from_str_radix(&hex[range], 16)
                    .map_err(|_| format!("颜色里有非法十六进制：{value}"))
            };
            Some(tauri::window::Color(
                channel(0..2)?,
                channel(2..4)?,
                channel(4..6)?,
                255,
            ))
        }
        None => None,
    };

    window
        .set_background_color(parsed)
        .map_err(|err| err.to_string())
}

// ---------------------------------------------------------------------------
// Composer: polish a prompt draft
// ---------------------------------------------------------------------------

/// How long one polishing call may take before the child is killed.
///
/// A reasoning model on a slow provider can take a while, but a hung request
/// must not leave a spinner turning forever — the UI has no other way to find
/// out that nothing is coming.
const ENHANCE_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(90);

/// Instruction the polishing pass runs under.
///
/// The reply is pasted straight back into the input box, so the wording spends
/// its effort on output *shape*: no preamble, no commentary, no code fence, no
/// quotes, and the draft's own language. Anything that explains the edit would
/// become part of the user's prompt.
const ENHANCE_INSTRUCTION: &str = "\
你是一个提示词润色助手。把下面这段草稿改写成一条更清晰、更具体、更适合交给编码智能体执行的指令。

要求：
1. 保留原意与全部约束，不要新增草稿里没有的需求，不要替用户做技术选型。
2. 把缺失的表达补成明确的说法：目标、范围、验收标准、边界与禁止事项；无法从草稿推断的不要编造。
3. 使用草稿本身的语言（中文草稿就用中文）。
4. 只输出润色后的提示词本身：不要解释、不要前言后语、不要用 Markdown 代码块包裹、不要加引号、不要说明你改了什么。
5. 篇幅与草稿相当或略长，不要注水。

草稿：
";

/// Strip the wrappers a model adds out of habit even when told not to.
fn clean_reply(raw: &str) -> String {
    let trimmed = raw.trim();
    let unfenced = strip_code_fence(trimmed).unwrap_or(trimmed).trim();
    strip_wrapping_quotes(unfenced).trim().to_string()
}

/// The body of a reply that is exactly one fenced block.
fn strip_code_fence(text: &str) -> Option<&str> {
    let rest = text.strip_prefix("```")?;
    let first_newline = rest.find('\n')?;
    let body = &rest[first_newline + 1..];
    let end = body.rfind("```")?;
    Some(&body[..end])
}

/// Drop a single pair of wrapping quotes, ASCII or CJK.
fn strip_wrapping_quotes(text: &str) -> &str {
    for (open, close) in [('"', '"'), ('\'', '\''), ('“', '”'), ('「', '」'), ('《', '》')] {
        if !text.starts_with(open) || !text.ends_with(close) {
            continue;
        }
        if text.chars().count() <= 2 {
            continue;
        }
        return &text[open.len_utf8()..text.len() - close.len_utf8()];
    }
    text
}

/// Polish a prompt draft with the same model the session is using.
///
/// Runs `pi --print --no-session` as a separate short-lived process rather than
/// talking to the engine over RPC: the RPC protocol has no single-shot
/// completion command, and reusing the running engine would mean either
/// polluting the live session with a throwaway exchange or inventing a side
/// channel. A separate process also inherits the user's own auth and provider
/// setup for free, so no credentials have to be re-implemented here.
///
/// `--no-session` is load-bearing: this call must not appear in the rail or
/// leave a file behind.
#[tauri::command]
pub async fn prompt_enhance(
    text: String,
    model: Option<String>,
    cwd: Option<String>,
) -> Result<String, String> {
    let draft = text.trim();
    if draft.is_empty() {
        return Err("输入为空，没有需要润色的内容".to_string());
    }

    let location = crate::pi::locate()?;
    let mut command = tokio::process::Command::new(&location.node);
    command
        .arg(&location.entry)
        .arg("--print")
        .arg("--no-session");
    // `--model` takes pi's own `provider/model` form, which is exactly what the
    // composer already displays, so no name translation is needed.
    if let Some(name) = model.as_deref().map(str::trim).filter(|name| !name.is_empty()) {
        command.arg("--model").arg(name);
    }
    // Run in the workspace pi is already working in, so project-level config and
    // trust decisions match what the user sees.
    if let Some(dir) = cwd.as_deref().map(str::trim).filter(|dir| !dir.is_empty()) {
        let path = std::path::Path::new(dir);
        if path.is_dir() {
            command.current_dir(path);
        }
    }
    command.arg(format!("{ENHANCE_INSTRUCTION}{draft}"));
    command
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .kill_on_drop(true);
    #[cfg(windows)]
    command.creation_flags(crate::pi::CREATE_NO_WINDOW);

    let child = command
        .spawn()
        .map_err(|err| format!("启动润色进程失败：{err}"))?;

    // `kill_on_drop` is what makes the timeout real: dropping the future with
    // the child still alive inside it terminates the process.
    let output = match tokio::time::timeout(ENHANCE_TIMEOUT, child.wait_with_output()).await {
        Ok(result) => result.map_err(|err| format!("润色进程异常：{err}"))?,
        Err(_) => {
            return Err(format!(
                "润色超时（超过 {} 秒），已终止",
                ENHANCE_TIMEOUT.as_secs()
            ))
        }
    };

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let message = stderr.trim();
        if message.is_empty() {
            return Err(format!("润色失败：pi 退出码 {:?}", output.status.code()));
        }
        // pi writes the provider's own error to stderr; keep it short enough to
        // read in a transcript notice.
        let clipped: String = message.chars().take(400).collect();
        return Err(format!("润色失败：{clipped}"));
    }

    let polished = clean_reply(&String::from_utf8_lossy(&output.stdout));
    if polished.is_empty() {
        return Err("润色没有返回内容".to_string());
    }
    Ok(polished)
}

// ---------------------------------------------------------------------------
// Tray menu window
// ---------------------------------------------------------------------------

/// Show the tray menu, sized to `width` × `height` (logical px) and placed
/// around the cursor that opened it.
///
/// The frontend measures its own content first and passes the size in, so the
/// menu is the right size on its first paint instead of resizing under the
/// pointer. The click's position is held in [`crate::TrayCursor`] because the
/// tray event arrives before the frontend has had a chance to answer.
#[tauri::command]
pub fn tray_menu_show(app: AppHandle, width: f64, height: f64) -> Result<(), String> {
    let window = app
        .get_webview_window(crate::TRAY_MENU)
        .ok_or_else(|| "托盘菜单窗口不存在".to_string())?;

    let scale = window.scale_factor().unwrap_or(1.0);
    let size = tauri::PhysicalSize::new(
        (width * scale).round().max(1.0) as u32,
        (height * scale).round().max(1.0) as u32,
    );
    window.set_size(size).map_err(|err| err.to_string())?;

    let cursor = app.try_state::<crate::TrayCursor>().and_then(|state| {
        *state
            .0
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    });

    if let Some(cursor) = cursor {
        // Tray menus open up and to the left of the pointer.
        let mut x = cursor.x - size.width as f64;
        let mut y = cursor.y - size.height as f64;

        if let Ok(Some(monitor)) = app.monitor_from_point(cursor.x, cursor.y) {
            let origin = monitor.position();
            let area = monitor.size();
            let margin = 8.0 * scale;
            let left = origin.x as f64 + margin;
            let top = origin.y as f64 + margin;
            // `max` before `min`: on a monitor narrower than the menu the two
            // bounds would otherwise cross and `clamp` would panic.
            let right = (origin.x as f64 + area.width as f64 - size.width as f64 - margin).max(left);
            let bottom =
                (origin.y as f64 + area.height as f64 - size.height as f64 - margin).max(top);
            x = x.max(left).min(right);
            y = y.max(top).min(bottom);
        }

        window
            .set_position(tauri::PhysicalPosition::new(
                x.round() as i32,
                y.round() as i32,
            ))
            .map_err(|err| err.to_string())?;
    }

    window.show().map_err(|err| err.to_string())?;
    window.set_focus().map_err(|err| err.to_string())?;
    Ok(())
}

/// Hide the tray menu — Escape, or after an action ran.
#[tauri::command]
pub fn tray_menu_hide(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(crate::TRAY_MENU) {
        window.hide().map_err(|err| err.to_string())?;
    }
    Ok(())
}

/// Run one of the menu's actions, then close the menu.
///
/// The ids are the ones the native menu used, so both commands keep their
/// original behaviour.
#[tauri::command]
pub fn tray_menu_action(app: AppHandle, action: String) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(crate::TRAY_MENU) {
        let _ = window.hide();
    }
    match action.as_str() {
        "show" => {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
            Ok(())
        }
        "quit" => {
            app.exit(0);
            Ok(())
        }
        other => Err(format!("未知的托盘菜单动作：{other}")),
    }
}
