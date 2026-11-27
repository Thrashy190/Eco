//! The app's own small web server, on 127.0.0.1. The web app expects to be served by Eco itself: its files at `/`, and
//! `/api` and `/rest` at the same address (`web/src/lib/api.ts`). This server gives it exactly that, and passes `/api`
//! and `/rest` on to the Eco server the person chose. So the Eco server needs no change for this app, and the web app
//! asks for everything the way it does in a browser: audio with `Range`, Connect's long-lived event stream, uploads.

use std::sync::Arc;
use std::time::Duration;

use axum::body::Body;
use axum::extract::{Request, State};
use axum::http::{header, HeaderMap, HeaderName, StatusCode, Uri};
use axum::middleware::{self, Next};
use axum::response::{IntoResponse, Response};
use axum::routing::{any, get, post};
use axum::{Json, Router};
use serde::Deserialize;
use serde_json::json;
use tauri::{AppHandle, Url};

use crate::config::{self, Config};
use crate::dialogs;
use crate::update::{Refused, Updates};

/// Fixed, because the browser inside keeps the sign-in and the saved songs per address: another port would look like
/// another site and start empty. It is below every system's range of temporary ports (Linux's starts at 32768).
pub const PORT: u16 = 27493;

/// The same policy the Eco server sends (`secure` in internal/server/server.go).
const CSP: &str = "default-src 'self'; img-src 'self' https: data: blob:; media-src 'self' blob:; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'";

/// Headers that belong to one connection, not to the request, plus what only matters between the window and here.
const LOCAL_ONLY: &[&str] = &[
    "connection",
    "keep-alive",
    "proxy-connection",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade",
    "host",
    "origin",
    "referer",
    "x-eco-desktop",
];

pub fn origin() -> String {
    format!("http://127.0.0.1:{PORT}")
}

pub struct Shared {
    app: AppHandle,
    config: Config,
    /// Proves a request to `/desktop/*` comes from this app's window: only its page is given it (`bridge_script`).
    token: String,
    client: reqwest::Client,
    updates: Arc<Updates>,
}

impl Shared {
    pub fn new(app: AppHandle, config: Config, token: String, updates: Arc<Updates>) -> Self {
        let client = reqwest::Client::builder()
            // A redirect goes back to the window as it is, as it would in a browser talking to Eco
            .redirect(reqwest::redirect::Policy::none())
            .connect_timeout(Duration::from_secs(10))
            // No overall timeout: audio and Connect's event stream stay open for as long as they are used
            .build()
            .expect("an HTTP client");
        Self {
            app,
            config,
            token,
            client,
            updates,
        }
    }
}

pub async fn serve(listener: std::net::TcpListener, shared: Arc<Shared>) {
    let router = Router::new()
        .route("/api/{*rest}", any(proxy))
        .route("/rest/{*rest}", any(proxy))
        .route("/desktop/server", get(current_server).put(choose_server))
        .route("/desktop/open", post(open_link))
        .route("/desktop/dialog", post(dialog))
        .route("/desktop/update", get(update_status))
        .route("/desktop/update/check", post(update_check))
        .route("/desktop/update/install", post(update_install))
        .fallback(asset)
        .layer(middleware::from_fn(only_this_app))
        .with_state(shared);
    let listener = listener
        .set_nonblocking(true)
        .and_then(|_| tokio::net::TcpListener::from_std(listener));
    match listener {
        Ok(listener) => {
            if let Err(err) = axum::serve(listener, router).await {
                eprintln!("eco: the local server stopped: {err}");
            }
        }
        Err(err) => eprintln!("eco: the local server could not start: {err}"),
    }
}

/// Answers only requests addressed to this server by its own name. Anything else is a web page elsewhere reaching it
/// through DNS rebinding, which would otherwise read the app's files and use the proxy.
async fn only_this_app(request: Request, next: Next) -> Response {
    let host = request
        .headers()
        .get(header::HOST)
        .and_then(|h| h.to_str().ok())
        .unwrap_or("");
    if host != format!("127.0.0.1:{PORT}") && host != format!("localhost:{PORT}") {
        return StatusCode::MISDIRECTED_REQUEST.into_response();
    }
    next.run(request).await
}

/// `/desktop/*` changes where the sign-in goes, so it needs the window's token. A web page in a browser cannot send
/// that header without asking first (CORS), and this server never says yes.
fn from_the_app(headers: &HeaderMap, token: &str) -> bool {
    let token_ok = headers
        .get("x-eco-desktop")
        .is_some_and(|v| v.as_bytes() == token.as_bytes());
    let origin_ok = headers
        .get(header::ORIGIN)
        .is_none_or(|o| o.as_bytes() == origin().as_bytes());
    token_ok && origin_ok
}

fn problem(status: StatusCode, message: &str) -> Response {
    (status, Json(json!({ "error": message }))).into_response()
}

async fn current_server(State(shared): State<Arc<Shared>>, headers: HeaderMap) -> Response {
    if !from_the_app(&headers, &shared.token) {
        return StatusCode::FORBIDDEN.into_response();
    }
    Json(json!({ "server": shared.config.server().map(|u| u.to_string()) })).into_response()
}

#[derive(Deserialize)]
struct Link {
    url: String,
}

/// A link that leaves the app, such as the release notes, opens in the browser (`openLinksOutside` in
/// web/src/stores/desktop.ts). The web views do not all hand `target="_blank"` to the app, so the page asks here.
async fn open_link(
    State(shared): State<Arc<Shared>>,
    headers: HeaderMap,
    Json(link): Json<Link>,
) -> Response {
    if !from_the_app(&headers, &shared.token) {
        return StatusCode::FORBIDDEN.into_response();
    }
    match Url::parse(&link.url) {
        Ok(url) if crate::opens_outside(&url) => {
            crate::open_outside(&url);
            StatusCode::NO_CONTENT.into_response()
        }
        _ => problem(
            StatusCode::BAD_REQUEST,
            "Only web and mail links open outside the app",
        ),
    }
}

#[derive(Deserialize)]
struct Dialog {
    kind: String,
    message: String,
    #[serde(default)]
    value: String,
}

/// `alert`, `confirm` and `prompt` from the page, as the system's own message boxes (see dialogs.rs). The page waits
/// for the answer, as it does for the web view's own.
async fn dialog(
    State(shared): State<Arc<Shared>>,
    headers: HeaderMap,
    Json(dialog): Json<Dialog>,
) -> Response {
    if !from_the_app(&headers, &shared.token) {
        return StatusCode::FORBIDDEN.into_response();
    }
    let answer = match dialog.kind.as_str() {
        "alert" => {
            dialogs::ask(&shared.app, &dialog.message, dialogs::Buttons::Ok).await;
            json!({ "ok": true })
        }
        "confirm" => {
            let ok = dialogs::ask(
                &shared.app,
                &dialog.message,
                dialogs::Buttons::OkCancel(None),
            )
            .await;
            json!({ "ok": ok })
        }
        "prompt" => match dialogs::prompt(&dialog.message, &dialog.value).await {
            Some(value) => json!({ "ok": true, "value": value }),
            None => json!({ "ok": false }),
        },
        _ => return problem(StatusCode::BAD_REQUEST, "Unknown dialog"),
    };
    Json(answer).into_response()
}

/// Whether a newer version is ready, and how installing it goes (update.rs). The page lights its Update button from this.
async fn update_status(State(shared): State<Arc<Shared>>, headers: HeaderMap) -> Response {
    if !from_the_app(&headers, &shared.token) {
        return StatusCode::FORBIDDEN.into_response();
    }
    Json(shared.updates.status()).into_response()
}

/// Looks for a newer version now, when someone asks.
async fn update_check(State(shared): State<Arc<Shared>>, headers: HeaderMap) -> Response {
    if !from_the_app(&headers, &shared.token) {
        return StatusCode::FORBIDDEN.into_response();
    }
    Json(shared.updates.check().await).into_response()
}

/// Installs the newer version: it downloads, then Eco closes and opens again. The page follows with `update_status`.
async fn update_install(State(shared): State<Arc<Shared>>, headers: HeaderMap) -> Response {
    if !from_the_app(&headers, &shared.token) {
        return StatusCode::FORBIDDEN.into_response();
    }
    match shared.updates.install() {
        Ok(status) => (StatusCode::ACCEPTED, Json(status)).into_response(),
        Err(Refused::Busy) => problem(StatusCode::CONFLICT, "Eco is already updating"),
        Err(Refused::Nothing) => {
            problem(StatusCode::CONFLICT, "There is no newer version to install")
        }
    }
}

#[derive(Deserialize)]
struct Choice {
    server: String,
}

enum Check {
    NoAnswer,
    NotEco,
}

/// Saves the server someone typed, once it is certain that it is an Eco server: it answers `/healthz` and its page is
/// Eco's. A Navidrome address would otherwise be saved and every screen would fail.
async fn choose_server(
    State(shared): State<Arc<Shared>>,
    headers: HeaderMap,
    Json(choice): Json<Choice>,
) -> Response {
    if !from_the_app(&headers, &shared.token) {
        return StatusCode::FORBIDDEN.into_response();
    }
    let candidates = match config::candidates(&choice.server) {
        Ok(candidates) => candidates,
        Err(message) => return problem(StatusCode::BAD_REQUEST, &message),
    };
    let host = shown(&candidates[0]);
    for url in candidates {
        match check(&shared.client, &url).await {
            Ok(()) => {
                if let Err(err) = shared.config.set_server(url.clone()) {
                    return problem(
                        StatusCode::INTERNAL_SERVER_ERROR,
                        &format!("The app could not save the server: {err}"),
                    );
                }
                return Json(json!({ "server": url.to_string() })).into_response();
            }
            Err(Check::NotEco) => {
                return problem(
                    StatusCode::BAD_REQUEST,
                    &format!("{host} answers, but it is not an Eco server. If it is Navidrome, use the address of Eco instead"),
                )
            }
            Err(Check::NoAnswer) => continue,
        }
    }
    problem(
        StatusCode::BAD_REQUEST,
        &format!("Nothing answered at {host}. Check the address, and that the server is on"),
    )
}

/// A server as people typed it: its host, and the port when there is one (`192.168.1.20:8000`).
fn shown(url: &Url) -> String {
    let host = url.host_str().unwrap_or_default();
    match url.port() {
        Some(port) => format!("{host}:{port}"),
        None => host.to_string(),
    }
}

async fn check(client: &reqwest::Client, server: &Url) -> Result<(), Check> {
    let fetch = |path: &str| {
        let mut url = server.clone();
        url.set_path(path);
        client.get(url).timeout(Duration::from_secs(10)).send()
    };
    let health = fetch("/healthz").await.map_err(|_| Check::NoAnswer)?;
    let healthy =
        health.status().is_success() && health.text().await.is_ok_and(|t| t.trim() == "ok");
    let page = fetch("/").await.map_err(|_| Check::NoAnswer)?;
    let eco = page.status().is_success()
        && page
            .text()
            .await
            .is_ok_and(|t| t.contains("<title>Eco</title>"));
    if healthy && eco {
        Ok(())
    } else {
        Err(Check::NotEco)
    }
}

fn passes(name: &HeaderName) -> bool {
    !LOCAL_ONLY.contains(&name.as_str())
}

/// Passes a request on to the Eco server and its answer back, both as streams: nothing is held in memory, so a song
/// starts as soon as its first bytes arrive and Connect's events arrive as they happen. Compressed answers stay
/// compressed; the window decompresses them, as it would from Eco.
async fn proxy(State(shared): State<Arc<Shared>>, request: Request) -> Response {
    let Some(mut target) = shared.config.server() else {
        return problem(
            StatusCode::SERVICE_UNAVAILABLE,
            "Choose your Eco server first",
        );
    };
    let (parts, body) = request.into_parts();
    // Only the path and query are taken from the request, so it can never point somewhere else
    target.set_path(parts.uri.path());
    target.set_query(parts.uri.query());

    let mut outgoing = shared.client.request(parts.method.clone(), target);
    for (name, value) in &parts.headers {
        if passes(name) {
            outgoing = outgoing.header(name, value);
        }
    }
    if parts.method != axum::http::Method::GET && parts.method != axum::http::Method::HEAD {
        outgoing = outgoing.body(reqwest::Body::wrap_stream(body.into_data_stream()));
    }
    // The same words as the web app's own message when the network is down (`request` in web/src/lib/api.ts); a 502
    // is also what it already gets from a proxy whose server is off (`streamProblem` in lib/retry.ts)
    let answer = match outgoing.send().await {
        Ok(answer) => answer,
        Err(_) => return problem(StatusCode::BAD_GATEWAY, "No connection to the server"),
    };
    let mut response = Response::builder().status(answer.status());
    for (name, value) in answer.headers() {
        if passes(name) {
            response = response.header(name, value);
        }
    }
    response
        .body(Body::from_stream(answer.bytes_stream()))
        .unwrap_or_else(|_| StatusCode::BAD_GATEWAY.into_response())
}

/// The web app's files, built into this program (`frontendDist` in tauri.conf.json).
async fn asset(State(shared): State<Arc<Shared>>, uri: Uri) -> Response {
    let path = uri.path().trim_start_matches('/');
    let key = if path.is_empty() { "index.html" } else { path };
    let Some(found) = shared.app.asset_resolver().get(key.to_string()) else {
        return StatusCode::NOT_FOUND.into_response();
    };
    // Tauri answers index.html for a file it does not have: here, a missing file is missing, as it is from Eco
    if found.mime_type.starts_with("text/html") && !key.ends_with(".html") {
        return StatusCode::NOT_FOUND.into_response();
    }
    let content_type = if key.ends_with(".webmanifest") {
        "application/manifest+json".to_string()
    } else {
        found.mime_type.clone()
    };
    // Files under assets/ carry a hash of their content in their name, so they never change
    let cache = if key.starts_with("assets/") {
        "public, max-age=31536000, immutable"
    } else {
        "no-cache"
    };
    Response::builder()
        .header(header::CONTENT_TYPE, content_type)
        .header(header::CACHE_CONTROL, cache)
        .header(header::X_CONTENT_TYPE_OPTIONS, "nosniff")
        .header(header::CONTENT_SECURITY_POLICY, CSP)
        .body(Body::from(found.bytes))
        .unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response())
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::HeaderValue;

    fn headers(pairs: &[(&'static str, &str)]) -> HeaderMap {
        let mut map = HeaderMap::new();
        for (name, value) in pairs {
            map.insert(*name, HeaderValue::from_str(value).unwrap());
        }
        map
    }

    #[test]
    fn only_the_window_may_choose_the_server() {
        let token = "abc123";
        assert!(from_the_app(&headers(&[("x-eco-desktop", token)]), token));
        assert!(from_the_app(
            &headers(&[("x-eco-desktop", token), ("origin", &origin())]),
            token
        ));
        // A page elsewhere has no token, and its origin gives it away
        assert!(!from_the_app(&headers(&[]), token));
        assert!(!from_the_app(
            &headers(&[("x-eco-desktop", "guess")]),
            token
        ));
        assert!(!from_the_app(
            &headers(&[("x-eco-desktop", token), ("origin", "https://evil.example")]),
            token
        ));
    }

    #[test]
    fn connection_headers_stay_here() {
        for name in [
            "host",
            "connection",
            "transfer-encoding",
            "origin",
            "x-eco-desktop",
        ] {
            assert!(
                !passes(&HeaderName::from_static(name)),
                "{name} must not pass"
            );
        }
        for name in [
            "range",
            "content-type",
            "accept-encoding",
            "content-range",
            "cookie",
        ] {
            assert!(passes(&HeaderName::from_static(name)), "{name} must pass");
        }
    }
}
