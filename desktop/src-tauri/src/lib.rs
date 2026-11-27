//! Eco for the desktop: the same web app a browser gets, built into this program and shown in its own window. A small
//! server on 127.0.0.1 (`server`) serves it and passes `/api` and `/rest` on to the Eco server the person chose, so it
//! works exactly as it does from Eco. See docs/desktop.md.

mod config;
mod dialogs;
#[cfg(target_os = "linux")]
mod graphics;
mod server;
mod shell;
mod update;

use std::sync::Arc;

use tauri::webview::NewWindowResponse;
use tauri::{Manager, Url, WebviewUrl, WebviewWindowBuilder};

pub fn run() {
    tauri::Builder::default()
        // Opening Eco again shows the window already running: two copies would fight over the port. It is also the
        // way back to a hidden window on a desktop with no tray
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            shell::show(app)
        }))
        // No plugin that puts scripts in the page (Tauri's dialog and opener plugins do): they replace window.confirm
        // and take over links, and the page here is the web app, which relies on both (see dialogs.rs)
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(setup)
        .on_window_event(shell::on_window_event)
        .build(tauri::generate_context!())
        .expect("Eco could not start")
        .run(shell::on_run_event);
}

fn setup(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    // The name Linux's media controls show for the music playing (MPRIS, which WebKitGTK provides); else "eco-desktop"
    #[cfg(target_os = "linux")]
    glib::set_application_name("Eco");

    let listener = match std::net::TcpListener::bind(("127.0.0.1", server::PORT)) {
        Ok(listener) => listener,
        Err(err) => {
            let message = format!(
                "Eco cannot start: it needs port {} on this computer, and something else is using it ({err}). Close that program and open Eco again.",
                server::PORT
            );
            // The box needs the app's loop running, which starts once setup is over: it closes the app when answered
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                dialogs::ask(&handle, &message, dialogs::Buttons::Ok).await;
                handle.exit(1);
            });
            return Ok(());
        }
    };
    let config = config::Config::load(app.path().app_config_dir()?);
    let token = random_token()?;
    let updates = update::Updates::new(app.handle().clone());
    let shared = Arc::new(server::Shared::new(
        app.handle().clone(),
        config,
        token.clone(),
        Arc::clone(&updates),
    ));
    tauri::async_runtime::spawn(server::serve(listener, shared));

    let home: Url = format!("{}/", server::origin()).parse()?;
    let version = app.package_info().version.to_string();
    #[cfg(target_os = "linux")]
    let lite = graphics::paints_on_processor();
    #[cfg(not(target_os = "linux"))]
    let lite = false;
    WebviewWindowBuilder::new(app, "main", WebviewUrl::External(home))
        .title("Eco")
        .inner_size(1280.0, 820.0)
        .min_inner_size(360.0, 560.0)
        .initialization_script(bridge_script(&token, &version, lite))
        // The window only ever shows the app; any other address opens in the browser
        .on_navigation(move |url| {
            if is_the_app(url) {
                return true;
            }
            open_outside(url);
            false
        })
        .on_new_window(|url, _| {
            open_outside(&url);
            NewWindowResponse::Deny
        })
        .build()?;

    #[cfg(not(target_os = "macos"))]
    shell::tray(app)?;
    update::watch(updates);
    Ok(())
}

fn is_the_app(url: &Url) -> bool {
    url.scheme() == "http"
        && url.host_str() == Some("127.0.0.1")
        && url.port() == Some(server::PORT)
}

/// Only web pages and mail go to other programs: never a file or a program of this computer.
fn opens_outside(url: &Url) -> bool {
    matches!(url.scheme(), "http" | "https" | "mailto")
}

/// Links to the release notes or to GitHub open in the browser, as `target="_blank"` does on the web.
fn open_outside(url: &Url) {
    if !opens_outside(url) {
        return;
    }
    if let Err(err) = open::that_detached(url.as_str()) {
        eprintln!("eco: could not open {url} in the browser: {err}");
    }
}

/// What the web app knows about the window it runs in (`web/src/lib/desktop.ts`). Only this app's own page gets it.
/// `lite` says the window is painted on the processor (graphics.rs).
fn bridge_script(token: &str, version: &str, lite: bool) -> String {
    let platform = if cfg!(target_os = "macos") {
        "macos"
    } else if cfg!(windows) {
        "windows"
    } else {
        "linux"
    };
    let origin = server::origin();
    format!(
        "if (location.origin === {origin:?}) Object.defineProperty(window, \"__ECO_DESKTOP__\", {{ value: Object.freeze({{ token: {token:?}, version: {version:?}, platform: {platform:?}, lite: {lite} }}) }});"
    )
}

fn random_token() -> Result<String, getrandom::Error> {
    let mut bytes = [0u8; 16];
    getrandom::fill(&mut bytes)?;
    Ok(bytes.iter().map(|b| format!("{b:02x}")).collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_window_stays_on_the_app() {
        assert!(is_the_app(
            &format!("{}/#/album/1", server::origin()).parse().unwrap()
        ));
        assert!(!is_the_app(
            &"https://github.com/Thrashy190/eco".parse().unwrap()
        ));
        assert!(!is_the_app(&"http://127.0.0.1:8000/".parse().unwrap()));
        assert!(!is_the_app(&"http://localhost:27493/".parse().unwrap()));
    }

    #[test]
    fn only_web_and_mail_links_leave_the_app() {
        assert!(opens_outside(
            &"https://github.com/Thrashy190/eco".parse().unwrap()
        ));
        assert!(opens_outside(
            &"mailto:someone@example.com".parse().unwrap()
        ));
        assert!(!opens_outside(&"file:///etc/passwd".parse().unwrap()));
        assert!(!opens_outside(&"smb://server/share".parse().unwrap()));
    }

    #[test]
    fn tokens_are_new_each_time() {
        let (a, b) = (random_token().unwrap(), random_token().unwrap());
        assert_eq!(a.len(), 32);
        assert_ne!(a, b);
    }

    // The page draws a lighter Eco only where WebKitGTK paints on the processor (graphics.rs)
    #[test]
    fn the_page_learns_whether_it_is_painted_on_the_processor() {
        assert!(bridge_script("t", "2.1.2", true).contains("lite: true"));
        assert!(bridge_script("t", "2.1.2", false).contains("lite: false"));
    }
}
