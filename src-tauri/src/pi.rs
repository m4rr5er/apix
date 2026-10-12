//! Locating and driving the `pi` coding agent over its RPC protocol.
//!
//! APIX never re-implements the agent loop. It spawns `pi --mode rpc` as a
//! child process and speaks strict JSONL over that process' stdin/stdout.
//!
//! Two things matter and are easy to get wrong:
//!
//! 1. On Windows `pi` is an npm `.cmd` shim. Spawning the shim would give us a
//!    `cmd.exe` handle, so killing it would leak the real node process. We
//!    resolve the underlying `dist/cli.js` and run it with `node` directly.
//! 2. Records are framed by LF only. `tokio::io::AsyncBufReadExt::lines()`
//!    splits on `\n` (and strips a trailing `\r`), so it is safe here. A reader
//!    that also treats `U+2028`/`U+2029` as boundaries would corrupt records.

use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Arc;
use std::time::Duration;

use serde::Serialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, AsyncRead, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, Command};
use tokio::sync::Mutex;

/// Windows process creation flag: never allocate a visible console for the child.
#[cfg(windows)]
pub(crate) const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// Path from a Node install prefix to pi's real CLI entry point.
const PI_ENTRY_REL: &str = "node_modules/@earendil-works/pi-coding-agent/dist/cli.js";

/// Event names used to talk to the webview.
pub const EVT_RECORD: &str = "pi://record";
pub const EVT_STATUS: &str = "pi://status";
pub const EVT_LOG: &str = "pi://log";

#[derive(Debug, Clone, Serialize)]
pub struct PiLocation {
    /// Absolute path to `node` / `node.exe`.
    pub node: String,
    /// Absolute path to `.../@earendil-works/pi-coding-agent/dist/cli.js`.
    pub entry: String,
}

// ---------------------------------------------------------------------------
// Locator
// ---------------------------------------------------------------------------

fn is_file(path: &Path) -> bool {
    path.is_file()
}

fn path_dirs() -> Vec<PathBuf> {
    std::env::var_os("PATH")
        .map(|value| std::env::split_paths(&value).collect())
        .unwrap_or_default()
}

fn find_on_path(names: &[&str]) -> Option<PathBuf> {
    for dir in path_dirs() {
        for name in names {
            let candidate = dir.join(name);
            if is_file(&candidate) {
                return Some(candidate);
            }
        }
    }
    None
}

/// Given a directory holding a `pi` shim, resolve the real `dist/cli.js`.
/// Handles the Windows layout (`<prefix>/node_modules/...`) and the
/// unix/global layout (`<prefix>/lib/node_modules/...`), plus `bin/` shims.
fn entry_in(dir: &Path) -> Option<PathBuf> {
    let candidates = [
        dir.join(PI_ENTRY_REL),
        dir.join("lib").join(PI_ENTRY_REL),
    ];
    for candidate in candidates {
        if is_file(&candidate) {
            return Some(candidate);
        }
    }
    if let Some(parent) = dir.parent() {
        let one_up = parent.join(PI_ENTRY_REL);
        if is_file(&one_up) {
            return Some(one_up);
        }
    }
    None
}

fn node_beside(dir: &Path) -> Option<PathBuf> {
    for name in ["node.exe", "node"] {
        let candidate = dir.join(name);
        if is_file(&candidate) {
            return Some(candidate);
        }
    }
    None
}

/// Resolve the `node` binary. Shared with the config layer, which borrows
/// Node's fetch for endpoint probing.
pub fn resolve_node() -> PathBuf {
    find_on_path(&["node.exe", "node"]).unwrap_or_else(|| PathBuf::from("node"))
}

/// Run a command and return trimmed stdout on success. Only used for the
/// `npm root -g` fallback, so an occasional failure is not fatal.
fn capture(program: &str, args: &[&str]) -> Option<String> {
    #[cfg(windows)]
    let mut command = {
        use std::os::windows::process::CommandExt;
        let mut c = std::process::Command::new("cmd.exe");
        c.arg("/C")
            .arg(program)
            .args(args)
            .creation_flags(CREATE_NO_WINDOW);
        c
    };
    #[cfg(not(windows))]
    let mut command = {
        let mut c = std::process::Command::new(program);
        c.args(args);
        c
    };

    let output = command.output().ok()?;
    if !output.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if text.is_empty() {
        None
    } else {
        Some(text)
    }
}

/// Find the `node` binary and pi's `cli.js`.
///
/// Resolution order:
/// 1. `APIX_PI_ENTRY` (+ optional `APIX_NODE`) — explicit escape hatch.
/// 2. The `pi` / `pi.cmd` shim on `PATH`.
/// 3. `npm root -g`.
pub fn locate() -> Result<PiLocation, String> {
    if let Ok(entry) = std::env::var("APIX_PI_ENTRY") {
        let entry_path = PathBuf::from(&entry);
        if !is_file(&entry_path) {
            return Err(format!("APIX_PI_ENTRY points at a missing file: {entry}"));
        }
        let node = std::env::var("APIX_NODE")
            .map(PathBuf::from)
            .ok()
            .filter(|path| is_file(path))
            .unwrap_or_else(resolve_node);
        return Ok(PiLocation {
            node: node.to_string_lossy().into_owned(),
            entry: entry_path.to_string_lossy().into_owned(),
        });
    }

    if let Some(shim) = find_on_path(&["pi.cmd", "pi"]) {
        if let Some(dir) = shim.parent() {
            if let Some(entry) = entry_in(dir) {
                let node = node_beside(dir).unwrap_or_else(resolve_node);
                return Ok(PiLocation {
                    node: node.to_string_lossy().into_owned(),
                    entry: entry.to_string_lossy().into_owned(),
                });
            }
        }
    }

    let npm = if cfg!(windows) { "npm.cmd" } else { "npm" };
    if let Some(root) = capture(npm, &["root", "-g"]) {
        let dir = PathBuf::from(root);
        if let Some(entry) = entry_in(&dir) {
            let node = node_beside(&dir).unwrap_or_else(resolve_node);
            return Ok(PiLocation {
                node: node.to_string_lossy().into_owned(),
                entry: entry.to_string_lossy().into_owned(),
            });
        }
    }

    Err("Unable to locate the pi CLI. Install or upgrade it with \
         `npm install -g --ignore-scripts @earendil-works/pi-coding-agent`, \
         or set APIX_PI_ENTRY to the absolute path of dist/cli.js."
        .to_string())
}

// ---------------------------------------------------------------------------
// Process handle
// ---------------------------------------------------------------------------

struct PiInner {
    child: Option<Child>,
    stdin: Option<ChildStdin>,
    location: Option<PiLocation>,
    cwd: Option<PathBuf>,
    seq: u64,
}

/// Owns the single `pi --mode rpc` child process backing the window.
pub struct PiHandle {
    inner: Arc<Mutex<PiInner>>,
}

impl PiHandle {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(Mutex::new(PiInner {
                child: None,
                stdin: None,
                location: None,
                cwd: None,
                seq: 0,
            })),
        }
    }

    /// Spawn a fresh `pi --mode rpc`, replacing any running instance.
    pub async fn start(
        &self,
        app: AppHandle,
        cwd: Option<String>,
        skills: Option<Vec<String>>,
        session: Option<String>,
    ) -> Result<PiLocation, String> {
        let mut inner = self.inner.lock().await;

        if inner.child.is_some() {
            shutdown(&mut inner).await;
        }

        let location = locate()?;

        let workdir = match cwd {
            Some(dir) if !dir.trim().is_empty() => PathBuf::from(dir),
            _ => std::env::current_dir().map_err(|e| format!("cannot read current dir: {e}"))?,
        };
        if !workdir.is_dir() {
            return Err(format!(
                "working directory does not exist: {}",
                workdir.display()
            ));
        }

        // Remember it so the next launch (typically from a desktop shortcut,
        // where the process cwd is the install folder) reopens this project.
        crate::config::remember_workdir(&workdir);

        let mut command = Command::new(&location.node);
        command
            .arg(&location.entry)
            .arg("--mode")
            .arg("rpc");
        // Skill allowlist. `--no-skills` turns off discovery, so the only skills
        // the model can see are the ones named by `--skill` — that is how a
        // conversation's on/off switches are honoured (`formatSkillsForPrompt`
        // would otherwise offer every skill it found in the skills directory).
        //
        // `Some(vec![])` is meaningful and is passed through as such: nothing is
        // enabled, so nothing is offered. `None` means the caller does not
        // manage skills and pi's own discovery stands.
        if let Some(paths) = &skills {
            command.arg("--no-skills");
            for path in paths {
                if !path.trim().is_empty() {
                    command.arg("--skill").arg(path);
                }
            }
        }
        // Open a session at start-up rather than calling `switch_session` after
        // it. `switch_session` tears the runtime down and builds a new one, which
        // measures at ~1.2s on a real workspace — paid twice for one restart,
        // since the engine has just built a runtime for its own session. The flag
        // also avoids the extra RPC round trip. Only ever passed a path that
        // exists: `--session` means "use this file", not "create it".
        if let Some(path) = &session {
            if !path.trim().is_empty() {
                command.arg("--session").arg(path);
            }
        }
        // APIX's own extension, which exposes pi's in-place reload as a command
        // so a settings write does not have to cost a restart. A failure to
        // write it only costs that: `--extension` is skipped and pi starts
        // normally, with APIX falling back to the restart path.
        if let Ok(extension) = crate::config::apix_reload_extension() {
            command.arg("--extension").arg(extension);
        }
        command
            .current_dir(&workdir)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        // `tokio::process::Command` exposes `creation_flags` as an inherent
        // method on Windows, so no CommandExt import is needed here.
        #[cfg(windows)]
        command.creation_flags(CREATE_NO_WINDOW);

        let mut child = command.spawn().map_err(|err| {
            format!(
                "failed to spawn pi\n  node:  {}\n  entry: {}\n  error: {err}",
                location.node, location.entry
            )
        })?;

        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| "pi stdin pipe unavailable".to_string())?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| "pi stdout pipe unavailable".to_string())?;
        let stderr = child
            .stderr
            .take()
            .ok_or_else(|| "pi stderr pipe unavailable".to_string())?;

        inner.child = Some(child);
        inner.stdin = Some(stdin);
        inner.location = Some(location.clone());
        inner.cwd = Some(workdir.clone());
        inner.seq = 0;

        let _ = app.emit(
            EVT_STATUS,
            json!({
                "state": "running",
                "cwd": workdir.to_string_lossy(),
                "location": location,
            }),
        );

        spawn_record_reader(app.clone(), stdout);
        spawn_log_reader(app.clone(), stderr);
        spawn_exit_watcher(app.clone(), Arc::clone(&self.inner));

        Ok(location)
    }

    /// Write one JSONL command record to pi's stdin.
    pub async fn send(&self, command: Value) -> Result<(), String> {
        let mut guard = self.inner.lock().await;

        let mut record = command;
        let Some(map) = record.as_object_mut() else {
            return Err("RPC command must be a JSON object".to_string());
        };
        if !map.contains_key("id") {
            guard.seq += 1;
            let id = format!("req-{}", guard.seq);
            map.insert("id".to_string(), Value::String(id));
        }

        let stdin = guard
            .stdin
            .as_mut()
            .ok_or_else(|| "pi is not running".to_string())?;

        let mut payload = serde_json::to_string(&record).map_err(|e| e.to_string())?;
        payload.push('\n');

        stdin
            .write_all(payload.as_bytes())
            .await
            .map_err(|e| format!("write to pi failed: {e}"))?;
        stdin
            .flush()
            .await
            .map_err(|e| format!("flush to pi failed: {e}"))?;
        Ok(())
    }

    /// Close stdin (orderly shutdown) and reap the child.
    pub async fn stop(&self, app: Option<AppHandle>) -> Result<(), String> {
        let mut guard = self.inner.lock().await;
        if guard.child.is_none() && guard.stdin.is_none() {
            return Ok(());
        }
        shutdown(&mut guard).await;
        drop(guard);

        if let Some(app) = app {
            let _ = app.emit(EVT_STATUS, json!({ "state": "stopped" }));
        }
        Ok(())
    }

    pub async fn status(&self) -> Value {
        let guard = self.inner.lock().await;
        json!({
            "running": guard.child.is_some(),
            "cwd": guard.cwd.as_ref().map(|p| p.to_string_lossy().into_owned()),
            "location": guard.location.clone(),
        })
    }
}

impl Default for PiHandle {
    fn default() -> Self {
        Self::new()
    }
}

async fn shutdown(inner: &mut PiInner) {
    if let Some(mut stdin) = inner.stdin.take() {
        let _ = stdin.shutdown().await;
    }
    if let Some(mut child) = inner.child.take() {
        match tokio::time::timeout(Duration::from_secs(3), child.wait()).await {
            Ok(_) => {}
            Err(_) => {
                let _ = child.kill().await;
            }
        }
    }
    inner.location = None;
    inner.cwd = None;
}

// ---------------------------------------------------------------------------
// Background readers
// ---------------------------------------------------------------------------

/// Split pi's stdout into records and forward each one to the webview.
fn spawn_record_reader<R>(app: AppHandle, stream: R)
where
    R: AsyncRead + Unpin + Send + 'static,
{
    tauri::async_runtime::spawn(async move {
        let mut lines = BufReader::new(stream).lines();
        loop {
            match lines.next_line().await {
                Ok(Some(raw)) => {
                    let line = raw.trim_end_matches('\r');
                    if line.trim().is_empty() {
                        continue;
                    }
                    match serde_json::from_str::<Value>(line) {
                        Ok(record) => {
                            let _ = app.emit(EVT_RECORD, record);
                        }
                        Err(_) => {
                            let _ = app.emit(EVT_LOG, json!({ "stream": "stdout", "line": line }));
                        }
                    }
                }
                Ok(None) => break,
                Err(err) => {
                    let _ = app.emit(
                        EVT_LOG,
                        json!({ "stream": "stdout", "error": err.to_string() }),
                    );
                    break;
                }
            }
        }
    });
}

/// Diagnostics only — never parsed as protocol data.
fn spawn_log_reader<R>(app: AppHandle, stream: R)
where
    R: AsyncRead + Unpin + Send + 'static,
{
    tauri::async_runtime::spawn(async move {
        let mut lines = BufReader::new(stream).lines();
        loop {
            match lines.next_line().await {
                Ok(Some(raw)) => {
                    let _ = app.emit(
                        EVT_LOG,
                        json!({ "stream": "stderr", "line": raw.trim_end_matches('\r') }),
                    );
                }
                Ok(None) => break,
                Err(_) => break,
            }
        }
    });
}

/// Poll for child exit so the UI can show a dead engine instead of hanging.
fn spawn_exit_watcher(app: AppHandle, inner: Arc<Mutex<PiInner>>) {
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(Duration::from_millis(400)).await;

            let mut guard = inner.lock().await;
            let (exited, code) = match guard.child.as_mut() {
                Some(child) => match child.try_wait() {
                    Ok(Some(status)) => (true, status.code()),
                    Ok(None) => (false, None),
                    Err(_) => (true, None),
                },
                // Stopped deliberately; nothing to report.
                None => return,
            };

            if exited {
                guard.child = None;
                guard.stdin = None;
                drop(guard);
                let _ = app.emit(EVT_STATUS, json!({ "state": "exited", "code": code }));
                return;
            }
        }
    });
}
