# CLAUDE.md

Guidance for Claude Code (claude.ai/code) when working in this repository.

The maintainer writes in Spanish: **reply to them in Spanish**, with complete code examples when explaining technical things. Everything in the repository (code, comments, docs, UI text, commit messages) is **English**: the project is meant to be open source.

## What this is

**eco** is a self-hosted music app: a web app (installable on phones) that plays a [Navidrome](https://www.navidrome.org) library, searches both that library and Spotify's catalogue, and downloads songs that are not in the library yet (yt-dlp + ffmpeg, tagged with Spotify's metadata). Go backend, plain-JavaScript web app embedded in the binary. See `README.md` for users and `docs/architecture.md` for how it works.

Status: running on the maintainer's laptop with `docker compose up -d` (Navidrome + eco + Cloudflare tunnel + File Browser). Public hostnames: `music.<domain>` → Navidrome (Subsonic apps), `eco.<domain>` → eco. A home server is the target. Go module path: `github.com/Thrashy190/eco`. License: MIT.

## Commands

```bash
make check          # gofmt, go vet, go test, node --check — what CI runs. Run it before finishing.
make run            # build + serve on http://127.0.0.1:8000 (needs Navidrome and a .env)
make doctor         # eco doctor: yt-dlp, ffmpeg, JS runtime, Navidrome, Spotify, cookies
make tools          # download yt-dlp into bin/

docker compose up -d --build                      # core: Navidrome + eco
docker compose --profile tunnel up -d             # + Cloudflare tunnel
docker compose --profile uploads up -d            # + File Browser for uploads
docker compose --profile downloads up -d          # + Lidarr / Prowlarr / qBittorrent

./bin/eco get -n URL                  # dry run of the single-link download
./bin/eco likes <export|search|download|favorites|playlist|all> [--playlist NAME] [--first N] [--limit N] [--csv PATH] [--music DIR]
```

Tests are Go unit tests (`internal/match`, `internal/lists`, `internal/media`, `internal/server`, `internal/ytdlp`) plus `node --check` on the web app. There is no automated browser test; when changing the UI, load it in a real browser (Brave/Chromium can be driven headless with puppeteer-core) and look at the result.

## Rules that are easy to break

- **The web app is embedded** (`web/embed.go`, `//go:embed static`). Editing `web/static/**` changes nothing until you rebuild the binary *and restart the server*. A stale server once hid a fixed bug for several test runs.
- **Never aim a test at the real library or CSVs.** Use `--csv` and `--music` with a scratch copy. `--limit 0` means *no limit*, not zero: a "harmless" check with it started a real download. Back up `data/likes.csv` before running anything that rewrites it (the first read migrates the old Spanish CSV format in place).
- **`internal/match` decides which video is the song.** A wrong song in someone's library is worse than a failed download. Keep the duration, unwanted-version and title checks; add a test naming the real case for every change there. `Norm` keeps any alphabet (`\p{L}\p{N}`): collapsing non-Latin titles to "" made every Cyrillic/Japanese title of one artist look identical.
- **`library.Safe` strips leading dots.** A folder named `.5- The Gray Chapter` is hidden on Linux and Navidrome ignores it.
- **Search with YouTube first, YouTube Music only if unsure.** YouTube Music is slower and triggers 403s sooner; `--playlist-end 5` is mandatory there or yt-dlp pages through ~20 result pages per song.
- **When YouTube answers "not a bot", stop** (`ytdlp.IsBlocked`): retrying makes it worse. Cookies (`YT_COOKIES_BROWSER` on a desktop, `YT_COOKIES_FILE` on a server) are the fix; a fixed pause between downloads did not prevent it.
- **Liked songs are Navidrome favourites, not a playlist** (`eco likes favorites`, `internal/lists/favorites.go`). Navidrome stores each favourite's timestamp with nanosecond precision and lists the newest first, so songs are starred from the *oldest* like to the newest (a 3 ms gap between calls) and the favourites then read exactly like the Spotify likes. Run the sync only after the downloads finish: starring songs later puts them in front of newer ones. Only Spotify *playlists* (`--playlist NAME`) become `.m3u` playlists.
- **Navidrome's `path` field is synthetic** (`01-09 - Title.m4a`, not the real file name). Match songs by title + artist, tie-break by album then length (`findSong`), never by path.
- **yt-dlp rewrites the cookies file it is given.** `ytdlp.cookieCopy` hands it a private temp copy on every call; the original may be a read-only mount (`./secrets:/secrets:ro`) and without the copy every download exits 1 *after* downloading.
- **Downloads run in a scratch folder next to the destination** (`.eco-*`, hidden) so the final move is an atomic rename.
- **Imported media (videos, podcasts, audiobooks) lives in `data/media/`, never in `music/`** — Navidrome would shuffle audiobooks into the music. eco serves it itself (`internal/media`, `ServeContent` for `Range`). Accept **only YouTube hosts** (`youtubeURL`, tested): arbitrary URLs would make the server fetch internal addresses. Items are keyed by the video id, which also validates the path segment; keep `ValidID`/`ValidKind` in front of every path join.
- **Go 1.22 `ServeMux` panics at startup** when a method-less pattern overlaps a method pattern (`/api/media/preview` vs `DELETE /api/media/{id}`). Always give routes a method when mixing; run the server once after touching routes.
- **`append(null)` / `replaceChildren(null)` print the word "null".** Filter falsy children (`h()` already does). The UI test checks every screen for stray `null`/`undefined`/`NaN`.
- **Offline = IndexedDB blobs.** A song is deleted from the device only when no collection and no individual save holds it (`refs`/`direct` in `store.js`). Screens that show a collection must fall back to `offline.collectionSongs` when `settings.online()` is false.
- **A finished job is history, not state.** The server keeps jobs for an hour; a UI that resumes a job must check it is still running, or it shows "added" for an item that was deleted.
- **Navidrome mounts the music read-only.** Only eco writes, and only under `music/YouTube/`. Lidarr's folder (`music/Lidarr/`) stays separate from `Originals/` and `Uploads/` because Lidarr matches against MusicBrainz.
- **Auth is Navidrome's.** `/api/*` verifies Subsonic credentials with `ping`. The web app stores user + token + salt, never the password. Do not add an account system.
- **Secrets only in `.env` / `secrets/`**, never in compose files or code. `.env`, `secrets/`, `data/` are git-ignored.
- **No build step, no framework in `web/static`.** Build DOM with `h()` (`js/ui.js`), which treats text as text; never assign untrusted strings to `innerHTML`.
- Spotify (development mode) returns at most 10 results per page, needs the app owner to have Premium, and may omit fields (ISRC, genres): read them as optional.
- ffmpeg does not write the ISRC into M4A; Navidrome does not need it.

## Layout

`cmd/eco` (CLI) · `internal/{server,engine,match,ytdlp,tag,spotify,subsonic,lists,library,jobs,config}` · `web/static` (UI) · `scripts/` (Lidarr hook, `upload.sh`) · `docs/` · `Dockerfile`, `docker-compose.yml` (+ `docker-compose.vpn.yml`).

Before the Go rewrite the tool was Python (`bajar.py`, `likes.py`) with Spanish docs; a backup of those sources is in `data/backup/` on the maintainer's machine, not in the repository.

## Pending

Torrent sources for single songs (Prowlarr search + qBittorrent file selection) once a VPN provider is chosen; testing offline playback and background audio on a real iPhone; a first commit and a public repository.
