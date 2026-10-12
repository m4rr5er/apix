mod commands;
mod config;
mod pi;

use std::sync::Mutex;

use pi::PiHandle;
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{Emitter, Manager, PhysicalPosition, WindowEvent};

/// The tray menu is its own window, because Windows draws a native menu itself
/// and gives no way to theme one beyond the OS dark-mode flag. A decorated-in-web
/// window can be styled like the rest of APIX.
pub(crate) const TRAY_MENU: &str = "tray-menu";
const MAIN: &str = "main";

/// Cursor position of the last tray click, in physical pixels.
///
/// The click carries it, but the menu is shown a moment later — by the frontend,
/// once it has measured its own content — so the position has to be held.
pub(crate) struct TrayCursor(pub(crate) Mutex<Option<PhysicalPosition<f64>>>);

fn show_main(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window(MAIN) {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

/// Build the tray icon.
///
/// No native menu is attached: the custom window below replaces it, and keeping
/// both would mean two menus for one right-click. That changes left-click from
/// "open the menu" to "bring the window back", which is the Windows convention
/// and the more useful default once the menu lives on right-click.
fn build_tray(app: &tauri::AppHandle) -> tauri::Result<()> {
    let mut builder = TrayIconBuilder::with_id("apix")
        .tooltip("APIX")
        .show_menu_on_left_click(false)
        .on_tray_icon_event(|tray, event| {
            let app = tray.app_handle();
            let TrayIconEvent::Click {
                button,
                button_state,
                position,
                ..
            } = event
            else {
                return;
            };
            // React on release only, so a press-release pair does not open twice.
            if button_state != MouseButtonState::Up {
                return;
            }
            match button {
                MouseButton::Left => show_main(app),
                MouseButton::Right => {
                    if let Some(state) = app.try_state::<TrayCursor>() {
                        let mut slot = state
                            .0
                            .lock()
                            .unwrap_or_else(|poisoned| poisoned.into_inner());
                        *slot = Some(position);
                    }
                    if let Some(menu) = app.get_webview_window(TRAY_MENU) {
                        // The window stays hidden until `tray_menu_show` runs, so
                        // the first paint is already the right size and place.
                        let _ = menu.emit("tray://menu-request", ());
                    }
                }
                _ => {}
            }
        });

    if let Some(icon) = app.default_window_icon().cloned() {
        builder = builder.icon(icon);
    }

    builder.build(app)?;
    Ok(())
}

/// Create the tray menu window, hidden and reused for every open.
fn build_tray_menu_window(app: &tauri::AppHandle) -> tauri::Result<()> {
    tauri::WebviewWindowBuilder::new(
        app,
        TRAY_MENU,
        tauri::WebviewUrl::App("tray-menu.html".into()),
    )
    .title("APIX")
    // Sized properly by `tray_menu_show` from the measured content; this is only
    // the starting geometry.
    .inner_size(220.0, 108.0)
    .resizable(false)
    .maximizable(false)
    .minimizable(false)
    .decorations(false)
    // Fully transparent so the panel's rounded corners are the only thing on
    // screen. The panel fills the window edge to edge, so if a machine refuses
    // transparency the cost is square corners, not a black frame.
    .transparent(true)
    .background_color(tauri::window::Color(0, 0, 0, 0))
    .shadow(false)
    .always_on_top(true)
    .skip_taskbar(true)
    .visible(false)
    .build()?;
    Ok(())
}

pub fn run() {
    tauri::Builder::default()
        // Second launch just focuses the existing window.
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            show_main(app);
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(PiHandle::new())
        .manage(TrayCursor(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![
            commands::pi_start,
            commands::pi_send,
            commands::pi_prompt,
            commands::pi_abort,
            commands::pi_stop,
            commands::pi_status,
            commands::pi_default_cwd,
            commands::prompt_enhance,
            commands::window_set_background,
            commands::tray_menu_show,
            commands::tray_menu_hide,
            commands::tray_menu_action,
            config::config_paths,
            config::config_read_raw,
            config::config_write_raw,
            config::models_read,
            config::models_write,
            config::models_summary,
            config::settings_read,
            config::settings_patch,
            config::mcp_read,
            config::mcp_write,
            config::skills_list,
            config::skill_read,
            config::skill_write,
            config::skill_create,
            config::skill_delete,
            config::skill_builtin_path,
            config::config_probe_models,
            config::state_read,
            config::state_write_workspaces,
            config::state_write_ui,
            config::state_last_workdir,
            config::sessions_list,
            config::open_path,
        ])
        .setup(|app| {
            // Ship APIX's built-in skills before pi starts, so they show up in
            // the first session rather than the second.
            if let Err(err) = config::ensure_builtin_skills() {
                eprintln!("APIX: could not install built-in skills: {err}");
            }

            // Seed the native background dark, matching the stylesheet default,
            // so the window never shows white before the frontend resolves the
            // saved theme.
            if let Some(window) = app.get_webview_window(MAIN) {
                let _ = window.set_background_color(Some(tauri::window::Color(0, 0, 0, 255)));
            }
            // The menu window is created up front and kept alive: creating a
            // webview on right-click would show nothing until it had loaded.
            build_tray_menu_window(app.handle())?;
            build_tray(app.handle())?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() == TRAY_MENU {
                // The menu is a popup: clicking anywhere else dismisses it. It is
                // never closed, only hidden, so the next open is instant.
                match event {
                    WindowEvent::Focused(false) => {
                        let _ = window.hide();
                    }
                    WindowEvent::CloseRequested { api, .. } => {
                        api.prevent_close();
                        let _ = window.hide();
                    }
                    _ => {}
                }
                return;
            }
            // Closing the window parks APIX in the tray instead of killing the
            // session. Quit from the tray menu or Ctrl+Q.
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .build(tauri::generate_context!())
        .expect("failed to build APIX")
        .run(|app, event| {
            if let tauri::RunEvent::ExitRequested { .. } = event {
                if let Some(pi) = app.try_state::<PiHandle>() {
                    let _ = tauri::async_runtime::block_on(pi.stop(None));
                }
            }
        });
}
