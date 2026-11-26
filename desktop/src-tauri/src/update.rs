//! Updates come from Eco's GitHub releases: CI signs every installer and lists them in `latest.json` (see
//! .github/workflows/desktop.yml). The app asks before installing, because installing restarts it and, from a .deb,
//! asks for the computer's password.

use std::time::Duration;

use tauri::AppHandle;
use tauri_plugin_updater::UpdaterExt;

use crate::dialogs::{self, Buttons};

const EVERY: Duration = Duration::from_secs(6 * 60 * 60);

pub fn watch(app: AppHandle) {
    let version = app.package_info().version.clone();
    // A build made by hand is 0.0.0, or carries what git describes (1.12.0-3-gabc123): the newest release would look
    // like an update to it and replace the work being tried
    if version.major == 0 || !version.pre.is_empty() {
        return;
    }
    tauri::async_runtime::spawn(async move {
        let mut offered = None;
        loop {
            if let Err(err) = check(&app, &mut offered).await {
                eprintln!("eco: could not check for updates: {err}");
            }
            tokio::time::sleep(EVERY).await;
        }
    });
}

/// Offers each new version once while the app runs; "Later" waits until the next time Eco opens.
async fn check(app: &AppHandle, offered: &mut Option<String>) -> tauri_plugin_updater::Result<()> {
    let Some(update) = app.updater()?.check().await? else {
        return Ok(());
    };
    if offered.as_deref() == Some(update.version.as_str()) {
        return Ok(());
    }
    *offered = Some(update.version.clone());

    let message = format!(
        "Eco {} is ready to install. You have {}.\n\nInstalling closes Eco and opens it again.",
        update.version, update.current_version
    );
    let buttons = Buttons::OkCancel(Some(("Install and restart".into(), "Later".into())));
    if dialogs::ask(app, &message, buttons).await {
        update.download_and_install(|_, _| {}, || {}).await?;
        app.restart();
    }
    Ok(())
}
