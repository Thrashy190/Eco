//! The system's own message boxes. The web views do not all show `confirm`, `alert` and `prompt`: WKWebView (macOS)
//! shows nothing unless the app draws them, and Tauri does not. So the page asks this app for them (`/desktop/dialog`,
//! `nativeDialogs` in web/src/stores/desktop.ts). Tauri's dialog plugin is not used on purpose: it replaces
//! `window.confirm` in the page with an asynchronous one, and Eco's `if (!confirm(...)) return` then always went ahead,
//! even before deleting a song for everyone.

use std::future::Future;
use std::pin::Pin;

use rfd::{AsyncMessageDialog, MessageButtons, MessageDialogResult, MessageLevel};
use tauri::{AppHandle, Manager};

const TITLE: &str = "Eco";

pub enum Buttons {
    /// An alert: one OK button
    Ok,
    /// A question: OK and Cancel, or two labels of its own
    OkCancel(Option<(String, String)>),
}

type Answer = Pin<Box<dyn Future<Output = MessageDialogResult> + Send>>;

/// Shows a message box and waits for the answer: true for OK. The box is made on the main thread, where every system
/// wants its windows, and the answer is awaited here. Waiting on the main thread instead would freeze the app: GTK
/// draws the box from that thread's loop (that is how Tauri's own dialog plugin does it too).
pub async fn ask(app: &AppHandle, message: &str, buttons: Buttons) -> bool {
    let (sender, receiver) = tokio::sync::oneshot::channel::<(Answer, Option<String>)>();
    let (handle, message) = (app.clone(), message.to_string());
    let sent = app.run_on_main_thread(move || {
        let _ = sender.send(open(&handle, &message, buttons));
    });
    if sent.is_err() {
        return false;
    }
    let Ok((answer, yes)) = receiver.await else {
        return false;
    };
    match (answer.await, yes) {
        (MessageDialogResult::Custom(label), Some(yes)) => label == yes,
        (MessageDialogResult::Ok | MessageDialogResult::Yes, _) => true,
        _ => false,
    }
}

fn open(app: &AppHandle, message: &str, buttons: Buttons) -> (Answer, Option<String>) {
    let (level, buttons, yes) = match buttons {
        Buttons::Ok => (MessageLevel::Info, MessageButtons::Ok, None),
        Buttons::OkCancel(None) => (MessageLevel::Warning, MessageButtons::OkCancel, None),
        Buttons::OkCancel(Some((yes, no))) => (
            MessageLevel::Info,
            MessageButtons::OkCancelCustom(yes.clone(), no),
            Some(yes),
        ),
    };
    let mut dialog = AsyncMessageDialog::new()
        .set_title(TITLE)
        .set_description(message)
        .set_level(level)
        .set_buttons(buttons);
    if let Some(window) = app.get_webview_window("main") {
        dialog = dialog.set_parent(&window);
    }
    (Box::pin(dialog.show()), yes)
}

/// `prompt` on macOS, where WKWebView has none. AppleScript's dialog with a text field is the system's own; the
/// message and the suggested text travel as arguments, never inside the script. None means Cancel.
#[cfg(target_os = "macos")]
pub async fn prompt(message: &str, value: &str) -> Option<String> {
    let (message, value) = (message.to_string(), value.to_string());
    tauri::async_runtime::spawn_blocking(move || {
        let output = std::process::Command::new("osascript")
            .args([
                "-e",
                "on run argv",
                "-e",
                "set answer to display dialog (item 1 of argv) default answer (item 2 of argv) with title \"Eco\"",
                "-e",
                "return text returned of answer",
                "-e",
                "end run",
            ])
            .arg(&message)
            .arg(&value)
            .output()
            .ok()?;
        // Cancel is AppleScript's error -128, which ends osascript with a failure
        output.status.success().then(|| {
            String::from_utf8_lossy(&output.stdout)
                .trim_end_matches('\n')
                .to_string()
        })
    })
    .await
    .ok()
    .flatten()
}

/// Elsewhere the web view's own `prompt` works, and the page does not ask (`nativeDialogs`).
#[cfg(not(target_os = "macos"))]
pub async fn prompt(_message: &str, _value: &str) -> Option<String> {
    None
}
