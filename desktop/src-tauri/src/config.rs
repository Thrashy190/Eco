//! The Eco server this app talks to, kept in `server.json` in the app's config folder.

use std::fs;
use std::io;
use std::net::IpAddr;
use std::path::PathBuf;
use std::sync::RwLock;

use serde::{Deserialize, Serialize};
use tauri::Url;

#[derive(Default, Serialize, Deserialize)]
struct Saved {
    server: Option<String>,
}

pub struct Config {
    path: PathBuf,
    server: RwLock<Option<Url>>,
}

impl Config {
    /// Reads the saved server. A missing or unreadable file means none was chosen yet.
    pub fn load(dir: PathBuf) -> Self {
        let path = dir.join("server.json");
        let saved: Saved = fs::read(&path)
            .ok()
            .and_then(|bytes| serde_json::from_slice(&bytes).ok())
            .unwrap_or_default();
        let server = saved.server.and_then(|s| Url::parse(&s).ok());
        Self {
            path,
            server: RwLock::new(server),
        }
    }

    pub fn server(&self) -> Option<Url> {
        self.server.read().expect("config lock").clone()
    }

    /// Saves the server. It is written to a temporary file first, so a crash never leaves half a file behind.
    pub fn set_server(&self, url: Url) -> io::Result<()> {
        if let Some(dir) = self.path.parent() {
            fs::create_dir_all(dir)?;
        }
        let saved = Saved {
            server: Some(url.to_string()),
        };
        let temporary = self.path.with_extension("json.tmp");
        fs::write(&temporary, serde_json::to_vec_pretty(&saved)?)?;
        fs::rename(&temporary, &self.path)?;
        *self.server.write().expect("config lock") = Some(url);
        Ok(())
    }
}

/// The addresses to try for what a person typed, best first. `eco.example.com` means `https://eco.example.com/`;
/// an address on the home network (`192.168.1.20:8000`, `server.local`) may also be plain `http://`. A public name
/// never falls back to `http://`: the sign-in would then travel unencrypted. Only the server itself counts, so a
/// pasted link to a page (`https://eco.example.com/#/album/1`) gives the same address.
pub fn candidates(input: &str) -> Result<Vec<Url>, String> {
    let input = input.trim();
    if input.is_empty() {
        return Err("Type the address of your Eco server".into());
    }
    let explicit = input.contains("://");
    let first = if explicit {
        input.to_string()
    } else {
        format!("https://{input}")
    };
    let mut url = Url::parse(&first).map_err(|_| not_an_address())?;
    if !matches!(url.scheme(), "http" | "https") || url.host_str().is_none() {
        return Err(not_an_address());
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err("Leave your username and password out of the address: you sign in next".into());
    }
    url.set_path("/");
    url.set_query(None);
    url.set_fragment(None);

    let mut out = vec![url.clone()];
    if !explicit && is_local(&url) {
        let mut plain = url;
        plain.set_scheme("http").expect("http is a valid scheme");
        out.push(plain);
    }
    Ok(out)
}

fn not_an_address() -> String {
    "That is not a web address. Type the address you open Eco at, like eco.example.com".into()
}

/// Whether a server is on this computer or the home network, where plain `http://` is common.
fn is_local(url: &Url) -> bool {
    let Some(host) = url.host_str() else {
        return false;
    };
    let host = host.trim_start_matches('[').trim_end_matches(']');
    if let Ok(ip) = host.parse::<IpAddr>() {
        return match ip {
            IpAddr::V4(v4) => v4.is_private() || v4.is_loopback() || v4.is_link_local(),
            IpAddr::V6(v6) => v6.is_loopback() || (v6.segments()[0] & 0xfe00) == 0xfc00,
        };
    }
    let host = host.to_ascii_lowercase();
    !host.contains('.')
        || host.ends_with(".local")
        || host.ends_with(".lan")
        || host.ends_with(".home.arpa")
        || host.ends_with(".internal")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn strings(input: &str) -> Vec<String> {
        candidates(input)
            .unwrap()
            .into_iter()
            .map(|u| u.to_string())
            .collect()
    }

    #[test]
    fn a_bare_name_means_https() {
        assert_eq!(strings("eco.example.com"), ["https://eco.example.com/"]);
        assert_eq!(
            strings("  eco.example.com/  "),
            ["https://eco.example.com/"]
        );
    }

    #[test]
    fn a_pasted_link_to_a_page_gives_the_server() {
        assert_eq!(
            strings("https://eco.example.com/#/album/123?x=1"),
            ["https://eco.example.com/"]
        );
        assert_eq!(
            strings("https://eco.example.com/some/page?q=1"),
            ["https://eco.example.com/"]
        );
    }

    #[test]
    fn the_home_network_may_be_plain_http() {
        assert_eq!(
            strings("192.168.1.20:8000"),
            ["https://192.168.1.20:8000/", "http://192.168.1.20:8000/"]
        );
        assert_eq!(
            strings("server.local:8000"),
            ["https://server.local:8000/", "http://server.local:8000/"]
        );
        assert_eq!(strings("nas"), ["https://nas/", "http://nas/"]);
    }

    #[test]
    fn a_public_name_never_falls_back_to_http() {
        assert_eq!(
            strings("eco.example.com:8443"),
            ["https://eco.example.com:8443/"]
        );
        assert_eq!(strings("8.8.8.8"), ["https://8.8.8.8/"]);
    }

    #[test]
    fn a_written_scheme_is_kept() {
        assert_eq!(
            strings("http://192.168.1.20:8000"),
            ["http://192.168.1.20:8000/"]
        );
        assert_eq!(
            strings("http://eco.example.com"),
            ["http://eco.example.com/"]
        );
    }

    #[test]
    fn what_is_not_a_server_is_refused() {
        assert!(candidates("").is_err());
        assert!(candidates("ftp://eco.example.com").is_err());
        assert!(candidates("https://").is_err());
        assert!(candidates("https://me:secret@eco.example.com").is_err());
    }

    #[test]
    fn the_server_survives_a_restart() {
        let dir = std::env::temp_dir().join(format!("eco-desktop-test-{}", std::process::id()));
        let config = Config::load(dir.clone());
        assert!(config.server().is_none());
        config
            .set_server(Url::parse("https://eco.example.com/").unwrap())
            .unwrap();
        let again = Config::load(dir.clone());
        assert_eq!(again.server().unwrap().as_str(), "https://eco.example.com/");
        fs::remove_dir_all(dir).unwrap();
    }
}
