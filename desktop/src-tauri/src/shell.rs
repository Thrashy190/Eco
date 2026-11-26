//! How the window behaves, like a music player's: closing it only hides it and the music keeps playing; quitting, from
//! the tray (Linux, Windows) or the app menu (macOS, ⌘Q), stops it.

use tauri::{AppHandle, Manager, RunEvent, Window, WindowEvent};

pub fn show(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// Hands a player control to the web app (`desktopCommands` in web/src/stores/player.ts).
pub fn command(app: &AppHandle, name: &str) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.eval(format!(
            "window.__ecoDesktopCommand && window.__ecoDesktopCommand({name:?})"
        ));
    }
}

pub fn on_window_event(window: &Window, event: &WindowEvent) {
    if let WindowEvent::CloseRequested { api, .. } = event {
        api.prevent_close();
        let _ = window.hide();
    }
}

pub fn on_run_event(app: &AppHandle, event: RunEvent) {
    // macOS: clicking the app in the Dock brings back a hidden window
    #[cfg(target_os = "macos")]
    if let RunEvent::Reopen { .. } = event {
        show(app);
    }
    #[cfg(not(target_os = "macos"))]
    let _ = (app, event);
}

/// The icon in the system tray, the way back to a hidden window on Linux and Windows. On GNOME it needs the
/// AppIndicator extension (Ubuntu and Pop!_OS have it on); without one, opening Eco again shows the window.
#[cfg(not(target_os = "macos"))]
pub fn tray(app: &tauri::App) -> tauri::Result<()> {
    use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
    use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};

    let item = |id: &str, text: &str| MenuItem::with_id(app, id, text, true, None::<&str>);
    let menu = Menu::with_items(
        app,
        &[
            &item("show", "Show Eco")?,
            &PredefinedMenuItem::separator(app)?,
            &item("toggle", "Play / Pause")?,
            &item("next", "Next")?,
            &item("previous", "Previous")?,
            &PredefinedMenuItem::separator(app)?,
            &item("quit", "Quit Eco")?,
        ],
    )?;
    let mut tray = TrayIconBuilder::with_id("main")
        .tooltip("Eco")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "show" => show(app),
            "quit" => app.exit(0),
            name => command(app, name),
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;
    Ok(())
}
