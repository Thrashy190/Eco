//! Updates come from Eco's GitHub releases: CI signs every installer and lists them in `latest.json` (see
//! .github/workflows/desktop.yml). The app looks for a newer version when it opens and every hour, and the page lights
//! its Update button when there is one (`/desktop/update`, web/src/stores/desktop.ts). Installing waits for that click,
//! because it closes Eco and opens it again and, from a .deb, asks for the computer's password (pkexec). The same
//! button works on a Mac (the app is replaced), on Windows (its installer runs) and on Linux (.deb or AppImage).

use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::Serialize;
use tauri::AppHandle;
use tauri_plugin_updater::{Update, UpdaterExt};

const EVERY: Duration = Duration::from_secs(60 * 60);

/// What the app is doing about updates.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Stage {
    #[default]
    Idle,
    Checking,
    Downloading,
    Installing,
}

/// What the page is told (`UpdateStatus` in web/src/lib/desktop.ts).
#[derive(Clone, Debug, Default, PartialEq, Serialize)]
pub struct Status {
    /// The version running.
    pub current: String,
    /// False for a build made by hand, which never replaces itself with a release.
    pub can_update: bool,
    /// A newer version ready to install.
    pub available: Option<String>,
    pub stage: Stage,
    /// How much of the new version has arrived, from 0 to 1, while it downloads.
    pub progress: Option<f64>,
    /// Why the last check or install failed.
    pub error: Option<String>,
}

/// A build made by hand is 0.0.0, or carries what git describes (1.12.0-3-gabc123): the newest release would look like
/// an update to it and replace the work being tried.
pub fn can_update(version: &str) -> bool {
    !version.starts_with("0.") && !version.contains('-')
}

/// How much has arrived, when the server said how much there is.
fn share(done: u64, total: Option<u64>) -> Option<f64> {
    match total {
        Some(total) if total > 0 => Some((done as f64 / total as f64).min(1.0)),
        _ => None,
    }
}

struct Inner {
    status: Status,
    update: Option<Update>,
}

/// The app's updates, shared by the hourly check and the page's button.
pub struct Updates {
    app: AppHandle,
    inner: Mutex<Inner>,
}

/// Why an install did not start.
#[derive(Debug, PartialEq, Eq)]
pub enum Refused {
    Nothing,
    Busy,
}

impl Updates {
    pub fn new(app: AppHandle) -> Arc<Self> {
        let version = app.package_info().version.to_string();
        let status = Status {
            can_update: can_update(&version),
            current: version,
            ..Status::default()
        };
        Arc::new(Self {
            app,
            inner: Mutex::new(Inner {
                status,
                update: None,
            }),
        })
    }

    fn change(&self, f: impl FnOnce(&mut Inner)) -> Status {
        let mut inner = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        f(&mut inner);
        inner.status.clone()
    }

    pub fn status(&self) -> Status {
        self.change(|_| {})
    }

    /// Asks GitHub whether there is a newer version. Nothing is downloaded until someone asks for it.
    pub async fn check(&self) -> Status {
        let busy = self.change(|inner| {
            if inner.status.stage == Stage::Idle && inner.status.can_update {
                inner.status.stage = Stage::Checking;
            }
        });
        if busy.stage != Stage::Checking {
            return busy; // a build made by hand, or one already checking or installing
        }
        let found = match self.app.updater() {
            Ok(updater) => updater.check().await,
            Err(err) => Err(err),
        };
        self.change(|inner| {
            inner.status.stage = Stage::Idle;
            match found {
                Ok(update) => {
                    inner.status.available = update.as_ref().map(|u| u.version.clone());
                    inner.status.error = None;
                    inner.update = update;
                }
                Err(err) => inner.status.error = Some(format!("Could not look for updates: {err}")),
            }
        })
    }

    /// Downloads the new version, installs it and opens Eco again. The page follows along with `status`.
    pub fn install(self: &Arc<Self>) -> Result<Status, Refused> {
        let mut refused = None;
        let mut update = None;
        let status = self.change(|inner| {
            if inner.status.stage != Stage::Idle {
                refused = Some(Refused::Busy);
            } else if let Some(found) = inner.update.clone() {
                update = Some(found);
                inner.status.stage = Stage::Downloading;
                inner.status.progress = Some(0.0);
                inner.status.error = None;
            } else {
                refused = Some(Refused::Nothing);
            }
        });
        if let Some(refused) = refused {
            return Err(refused);
        }
        let Some(update) = update else {
            return Err(Refused::Nothing);
        };
        let updates = Arc::clone(self);
        tauri::async_runtime::spawn(async move {
            let mut done = 0u64;
            let downloaded = update
                .download(
                    |chunk, total| {
                        done += chunk as u64;
                        updates.change(|inner| inner.status.progress = share(done, total));
                    },
                    || {},
                )
                .await;
            let installed = downloaded.and_then(|bytes| {
                updates.change(|inner| {
                    inner.status.stage = Stage::Installing;
                    inner.status.progress = None;
                });
                // On Windows the installer takes over from here and closes Eco itself
                update.install(bytes)
            });
            match installed {
                Ok(()) => updates.app.restart(),
                Err(err) => {
                    eprintln!("eco: could not install the update: {err}");
                    updates.change(|inner| {
                        inner.status.stage = Stage::Idle;
                        inner.status.progress = None;
                        inner.status.error = Some(format!("Could not install the update: {err}"));
                    });
                }
            }
        });
        Ok(status)
    }
}

/// Looks for a newer version now and every hour while the app runs.
pub fn watch(updates: Arc<Updates>) {
    if !updates.status().can_update {
        return;
    }
    tauri::async_runtime::spawn(async move {
        loop {
            let status = updates.check().await;
            if let Some(error) = status.error {
                eprintln!("eco: {error}");
            }
            tokio::time::sleep(EVERY).await;
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_releases_update_themselves() {
        assert!(can_update("2.5.0"));
        assert!(!can_update("0.0.0"));
        assert!(!can_update("2.5.0-3-gabc123"));
    }

    #[test]
    fn progress_needs_a_size() {
        assert_eq!(share(50, Some(200)), Some(0.25));
        assert_eq!(share(300, Some(200)), Some(1.0));
        assert_eq!(share(50, None), None);
        assert_eq!(share(50, Some(0)), None);
    }

    #[test]
    fn the_page_reads_snake_case() {
        let status = Status {
            current: "2.5.0".into(),
            can_update: true,
            available: Some("2.6.0".into()),
            stage: Stage::Downloading,
            progress: Some(0.5),
            error: None,
        };
        let json = serde_json::to_string(&status).unwrap();
        assert_eq!(
            json,
            r#"{"current":"2.5.0","can_update":true,"available":"2.6.0","stage":"downloading","progress":0.5,"error":null}"#
        );
    }
}
