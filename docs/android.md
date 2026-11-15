# Eco on Android

Eco has a native app for Android phones (`mobile/`, written with Flutter). It plays the same library as the web app, with what a web app on a phone cannot do:

- **Music keeps playing** with the screen off or the app in the background, with the song, its cover and the controls on the lock screen, in the notification, on headphones and in a car over Bluetooth.
- **Downloads for offline carry on by themselves.** Save your favorites, a playlist or an album and Android's download service fetches it, with the app in the background or closed, showing its progress in a notification. A web app only downloads while it is on screen.
- **Native screens**: Home, Search (your library, then the catalogue), Library (Recent, playlists, albums, artists, what is on the phone), album, artist and playlist pages, the full-screen player and its queue. The colour of the music is behind everything, as in the web app.

Searching the catalogue and getting songs you do not have yet (**Get**, or choosing tracks on an album) works the same as in the web app: the server downloads them into your library.

Appearance, importing lists, adding a song from a YouTube link, podcasts and audiobooks, playing on another device, accounts and library clean-up are still in the web app. They will come in later versions.

It is not in the Play Store: you install the APK yourself. That is free and only takes a minute.

## Install

1. Get `eco-android.apk`: from the person who runs your Eco, or build it (below).
2. Open it on the phone. Android asks to allow installing apps from that source (the browser or the file manager): allow it, then **Install**.
3. Open **Eco** and sign in with the address of your Eco (such as `eco.example.com`) and your **Navidrome** account. The app keeps a token made from your password, never the password, in Android's encrypted storage.

A new version installs over the old one, keeping your sign-in and your downloads, **as long as both were signed with the same key**. An APK built by CI on a pull request is signed with a throwaway key: uninstall the app before trying one (that removes what was saved on the phone).

### Which address

| Address | When |
|---|---|
| `https://eco.<your domain>` | you reach Eco through a tunnel or a reverse proxy (works anywhere) |
| `http://<computer's address>:8000` | the phone is on your home network and Eco runs with `ECO_BIND=0.0.0.0` (see [the TV's notes](tv.md#2-let-the-roku-reach-eco) for the same setting) |

The app accepts plain `http://` because a server at home usually has no certificate. Over the internet, use HTTPS ([deployment](deployment.md)).

## Offline

Tap the download button on Favorites, a playlist or an album, or **Save on this phone** in a song's ⋮ menu. The same rules as in the web app:

- A kept list **follows its songs**: opened with a connection, new songs are fetched and removed ones let go.
- **Stopping keeps what arrived.** Tap the progress to stop; the list plays from what it has and offers to download the rest.
- A song is deleted from the phone only when no list and no single save holds it.
- A saved song plays from the phone, with no request for its audio. If that copy will not play and there is a connection, it streams instead.
- Navidrome reports a song it no longer has as an answer of a few bytes: the app checks before keeping a file, and a song that is gone leaves the list.

With no connection, Home, Search and Library show what is on the phone. **Settings** says how much space it takes and can remove all of it.

## For developers

You need Flutter (stable, 3.50 or later), JDK 17 and the Android SDK; `flutter doctor` says what is missing. The Android Studio IDE is not needed: the [command-line tools](https://developer.android.com/studio#command-line-tools-only) are enough.

```bash
make android-check     # flutter analyze + flutter test (what CI runs)
make android           # bin/eco-android.apk
make android-install   # the same, installed with adb on a phone with USB debugging
cd mobile && flutter run   # hot reload on a connected phone or an emulator
```

### The release key

Android only installs an update signed with the same key as the app it replaces. Release builds use `mobile/android/key.properties` when it exists (git-ignored, like the key itself):

```properties
storeFile=/absolute/path/to/eco-release.jks
storePassword=…
keyAlias=eco
keyPassword=…
```

Make a key once with `keytool -genkeypair -keystore eco-release.jks -storetype PKCS12 -alias eco -keyalg RSA -keysize 4096 -validity 10000`, keep it in `secrets/` and **back it up**: losing it means everyone uninstalls (and loses their downloads) before the next version. Without the file, `make android` signs with the machine's debug key.

### How it is built

| Path | |
|---|---|
| `lib/api/` | the client (`client.dart`: Subsonic through Eco's `/rest`, Eco's `/api`, the same credentials as the web app), the shapes of answers (`models.dart`) and the server's download jobs (`jobs.dart`) |
| `lib/player/` | `queue.dart` is `web/src/lib/queue.ts` translated, with the same tests; `player.dart` is the media service (`audio_service` + `just_audio`) |
| `lib/offline/` | saved songs and lists, downloaded with `background_downloader` into the app's private storage |
| `lib/ui/`, `lib/screens/` | the theme, shared widgets, navigation (`go_router`: three tabs, each with its own history) and the screens |

The rules of the web app hold here too: the queue's rules live in `queue.dart` and must change together with `queue.ts` and `queue.brs`; the library never waits for the catalogue; `/api/albums/match` answering 503 means "ask again", not "no such album"; a finished job is history (`liveJob`); a 200 with an unreadable body is checked before use (`LibraryState.tryParse`); favourites are stars, shown as the playlist `favorites`.
