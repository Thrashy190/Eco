# Eco on your computer

The desktop app (`desktop/`) is Eco in a window of its own: the same app as in a browser, with the same screens and everything they do, and a few things a browser tab cannot do. Closing the window keeps the music playing, the keyboard's media keys work, it opens without a connection to play what you saved, and it updates itself.

It needs an **Eco server**, not only Navidrome: most of what the app shows (Home, search, downloads, Connect, your look) comes from Eco. Any Eco server works, yours or someone else's, as long as you have an account on it.

| System | Installer | Tried |
|---|---|---|
| Linux: Ubuntu, Pop!_OS, Debian, Mint | `Eco_<version>_amd64.deb` | yes, on Ubuntu 22.04 (what Pop!_OS 22.04 is built on) |
| Linux, other distributions | `Eco_<version>_amd64.AppImage` | yes, on Ubuntu 22.04; it carries its own GStreamer, AAC included |
| macOS, Apple Silicon | `Eco_<version>_aarch64.dmg` | not yet |
| Windows | `Eco_<version>_x64-setup.exe` | not yet |

The installers are attached to every [release](https://github.com/Thrashy190/eco/releases), and the app has the same version as Eco. If you try it on a system marked *not yet*, an issue saying how it went is very welcome.

## Install

### Linux (.deb)

Download the `.deb` from the newest release, then:

```bash
sudo apt install ./Eco_*_amd64.deb
```

`apt` also installs what it needs, including `gstreamer1.0-libav`, which plays the `.m4a` (AAC) files Eco downloads. Eco then appears among your applications.

### Linux (AppImage)

For distributions without `apt`: make the file executable and open it.

```bash
chmod +x Eco_*_amd64.AppImage
./Eco_*_amd64.AppImage
```

### macOS

Open the `.dmg` and drag Eco to Applications. Eco is not signed with an Apple Developer ID, so the first time macOS refuses to open it. Allow it once:

1. Open Eco. macOS says it cannot check it; close that message.
2. Open **System Settings ▸ Privacy & Security**, scroll down to the message about Eco and choose **Open Anyway**.

If macOS says instead that Eco "is damaged", run this once in Terminal and open it again:

```bash
xattr -dr com.apple.quarantine /Applications/Eco.app
```

### Windows

Run the `-setup.exe`. Windows warns about an app from an unknown publisher (SmartScreen): choose **More info ▸ Run anyway**. This installer has not been tried yet.

## Sign in

The first screen asks for three things: your **server**, your **username** and your **password**, the same account as in the web app.

- **Server** is the address you open Eco at, such as `eco.example.com`. Without `http://` or `https://` the app uses `https://`. On your home network it also tries plain `http://`, so `192.168.1.20:8000` works; a public address never falls back to `http://`, because your sign-in would travel unencrypted.
- The app checks that the address is an Eco server before saving it. The address of Navidrome (`music.example.com`) is refused with a message saying so.
- As in the web app, your password is never stored: only the username and a token made from it.

## Using it

- **Closing the window keeps the music playing.** On Linux and Windows the icon in the system tray brings it back and has *Play / Pause*, *Next*, *Previous* and *Quit Eco*. On a Mac, click Eco in the Dock; ⌘Q quits. Opening Eco again also brings the window back, which is the way back on a Linux desktop with no tray.
- **Media keys and the system's music controls** work on Linux (MPRIS, as in GNOME's top bar), where they come with the web view. On macOS and Windows they have not been tried yet.
- **Offline.** Downloads live in the app's own storage, separate from your browser's. The app opens with no connection, and *Library ▸ Downloads* plays what you saved.
- **Links** to the release notes or GitHub open in your browser.
- **Connect** names the app *Eco on Linux*, *Eco on Mac* or *Eco on Windows*; rename it in *Settings ▸ This device*.
- **Settings ▸ About** shows the server, with **Change**, and the app's own version. If the server runs an older Eco than the app, it says so: some screens may ask the server for things it does not have yet.

## Changing server

*Settings ▸ About ▸ Server ▸ Change* signs you out and asks for the new address. Songs saved on this computer belong to the server they came from, so changing removes them, after asking. Signing in to another server while songs from the first one are still on the computer is refused, with a message saying which server they are from.

## Updates

The app looks for a new version when it opens and every six hours. When there is one it asks first, because installing restarts it. From the `.deb`, installing also asks for your computer's password, as any system package does. The AppImage replaces itself. Each update is checked against a signature before it is installed.

## Where it keeps things

| | Linux | |
|---|---|---|
| The server's address | `~/.config/eco.music.thrashy/server.json` | |
| Sign-in, settings and downloads | `~/.local/share/eco.music.thrashy/` | the web view's storage |

macOS and Windows use their usual folders for the identifier `eco.music.thrashy`.

## Troubleshooting

| Symptom | Try |
|---|---|
| "Eco cannot start: it needs port 27493" | Another program uses that port. Close it and open Eco again. Two copies of Eco never run at once. |
| No sound on Linux | `sudo apt install gstreamer1.0-libav` (the `.deb` installs it; another way of installing may not). |
| No tray icon on GNOME | GNOME shows tray icons only with the AppIndicator extension (Ubuntu and Pop!_OS have it on). Without it, open Eco again to see the window. |
| "Nothing answered at …" | The address is wrong, or the server is off or not reachable from this computer. Try it in a browser. |
| "… answers, but it is not an Eco server" | That is probably Navidrome's address. Use Eco's. |
| The app says your server is older | Update the server ([Updating](../README.md#updating)). |

## For developers

### How it works

The web app expects to be served by Eco itself: its files at `/`, and `/api` and `/rest` at the same address, with no CORS (`web/src/lib/api.ts`). So the desktop app runs a small server of its own on `127.0.0.1:27493` (`desktop/src-tauri/src/server.rs`, axum) and the window shows that:

- `/` serves the web app built into the program (`npm run build:desktop` in `web/`, into `desktop/dist`), with the same Content-Security-Policy Eco sends.
- `/api/*` and `/rest/*` go to the chosen server as streams in both directions, so audio with `Range`, Connect's event stream and uploads behave as they do from Eco. A server that does not answer gives a 502 with the web app's own words ("No connection to the server"), which it already treats like a proxy whose server is off.
- `/desktop/*` is the app's own, and needs the token only the window has (below).

The port is fixed because the web view keeps the sign-in and the downloads per address: another port would be another site, empty. The server answers only requests addressed to `127.0.0.1:27493` or `localhost:27493`, which stops a page elsewhere from reaching it through DNS rebinding.

The window gets an initialization script (`bridge_script` in `lib.rs`) that gives the page `window.__ECO_DESKTOP__`: the app's version, the system and a random token made at each launch. `web/src/lib/desktop.ts` reads it; `isDesktop` is true only in the desktop build (`vite build --mode desktop`), so a browser never runs any of it.

| Endpoint | |
|---|---|
| `GET /desktop/server` | the saved server, or `null` |
| `PUT /desktop/server` | `{server}`: checks it is an Eco server (`/healthz` says `ok` and its page is Eco's), then saves it |
| `POST /desktop/open` | `{url}`: opens a web or mail link in the browser |
| `POST /desktop/dialog` | `{kind, message, value}`: `alert`, `confirm` or (on a Mac) `prompt` as the system's own message box |

All of them need the header `X-Eco-Desktop` with the token, and refuse another page's `Origin`.

What the web app does differently in the desktop build, all behind `isDesktop`: the sign-in asks for the server (`views/Login.tsx`); *Settings ▸ About* shows it with **Change** and the app's version (`DesktopServer` in `views/Settings.tsx`); the welcome message for a new account gives the server's address (`views/Users.tsx`); Connect's default name (`stores/connect.ts`); the tray's controls (`__ecoDesktopCommand` in `stores/player.ts`); no service worker (`main.tsx`); and `stores/desktop.ts` for links and dialogs.

### Things that were learned the hard way

- **No Tauri plugin that puts scripts in the page.** The dialog plugin replaces `window.confirm` with an asynchronous one: a promise is truthy, so `if (!confirm(...)) return` went ahead without asking, before deleting a song for everyone. The opener plugin takes over every `target="_blank"` click. The app uses `rfd` and `open` from Rust instead (`dialogs.rs`, `open_outside`).
- **Each web view handles dialogs differently.** WebKitGTK (Linux) and WebView2 (Windows) draw `confirm` and `prompt` themselves; WKWebView (macOS) draws nothing unless the app does. So `alert` and `confirm` always go to `/desktop/dialog`, synchronously as they are, and `prompt` does on a Mac (AppleScript's `display dialog`). A message box is made on the main thread and awaited elsewhere: rfd's blocking `show()` called on the main thread waits for that same thread and freezes the app.
- **Links open from the page**, through `/desktop/open`: not every web view hands `target="_blank"` to the app.
- **MPRIS comes from WebKitGTK**, with the name GLib knows the program by, so `lib.rs` sets it to *Eco*.
- `beforeBuildCommand`'s `cwd` in `tauri.conf.json` is relative to `src-tauri/`, not to `desktop/`.

### Build and check

On Linux you need Rust, Node 22 and WebKitGTK's development files:

```bash
sudo apt install libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev libxdo-dev gstreamer1.0-libav
make desktop-dev     # run it from the source (the web app is built first)
make desktop         # the installers for this computer, in desktop/src-tauri/target/release/bundle
make desktop-check   # rustfmt, clippy and the Rust tests; CI runs it
```

The AppImage also needs `patchelf`. A build made by hand carries the version `git describe` gives (`1.12.0-3-gabc123`) and never updates itself from a release.

To try a change without touching your own setup, run the app in a container with a virtual screen: an Ubuntu 22.04 image with `xvfb`, `xdotool`, `dbus-x11` and `pulseaudio` (a null sink as its output), the `.deb` installed with `apt`, and a scratch Eco and Navidrome as its server. `xdotool` clicks and types, `import -window root` takes screenshots, and `dbus-send` on the session bus reads and drives MPRIS. A small window manager (`openbox`) is needed for closing the window to arrive as a real close request. Never point it at your real library.

### Releases

`.github/workflows/desktop.yml` runs after every release (the `installers` job in `ci.yml`): it builds on Ubuntu 22.04, macOS (Apple Silicon) and Windows, attaches the installers and their signatures to the release, and then writes `latest.json`, the list the app checks for updates (`plugins.updater` in `tauri.conf.json`). Pull requests do not build the installers (CI's `desktop` job checks the Rust code on each of them). To try a branch's installers before a release, run it by hand: **Actions ▸ Desktop ▸ Run workflow**, pick the branch and leave the tag empty, and the installers stay with the run for two weeks (its *Artifacts*). With a release tag it builds that release's installers again.

Updates are signed with a key made by `tauri signer generate`. Its public half is in `tauri.conf.json`; the private half and its password are the repository secrets `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`. Without them the installers are still built, but with nothing to update from. Losing the private key means installed apps can no longer verify an update: keep a copy somewhere safe.
