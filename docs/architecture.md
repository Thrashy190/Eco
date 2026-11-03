# Architecture

eco has three moving parts. Navidrome is the music server; eco sits in front of it; yt-dlp and ffmpeg do the downloading.

```
 browser / phone ──► eco ──────────────► Navidrome ──► data/music/**   (read-only for Navidrome)
   (web app)        │  /rest/*  passthrough                ▲
                    │  /api/*   search, discover, download │
                    └──► Spotify API (metadata only)       │
                    └──► yt-dlp ──► ffmpeg (tags, cover) ──┘  writes data/music/YouTube/**
```

## Why these choices

| Decision | Reason |
|---|---|
| **Navidrome as the server** | Light (~70 MB), speaks the Subsonic/OpenSubsonic API, has users, playlists, favourites and play counts. eco does not reimplement any of it. |
| **eco proxies `/rest/*` untouched** | The web app gets a single origin (no CORS) and any Subsonic client keeps working when pointed at eco. |
| **No database in eco** | Users and playlists live in Navidrome. Download history is a CSV; job state is in memory. Fewer things to back up. |
| **Authentication reuses Navidrome's** | Each request carries Subsonic credentials (`u`, `t = md5(password+salt)`, `s`); eco checks them with Navidrome's `ping` and remembers the answer for five minutes. The password is never stored by the web app. |
| **yt-dlp and ffmpeg are executed, not embedded** | YouTube changes constantly; yt-dlp must be updatable without rebuilding eco. Tags are written by remuxing with ffmpeg (no re-encoding). |
| **Go, one binary, web app embedded** | Easy to deploy and cross-compile; the web app is plain ES modules with no build step. |
| **Navidrome mounts the music read-only** | Nothing but eco's download folder ever changes files. |

## Library layout

```
data/music/
├── YouTube/<Album artist>/<Album>/NN - Title.m4a   downloads made by eco
├── Playlists/*.m3u                                  Navidrome imports these as playlists
├── Originals/                                       your own recordings (scripts/upload.sh)
├── Uploads/                                         files uploaded from the browser (profile "uploads")
└── Lidarr/                                          Lidarr's root folder (profile "downloads")

data/media/<kind>/<video id>/{media.mp4|m4a, media.jpg, meta.json}   imported videos, podcasts, audiobooks, other
```

`data/media/` is deliberately **outside** `music/`: Navidrome would otherwise index podcasts and audiobooks as albums and artists and shuffle them into your music. eco serves these files itself (with `Range` support, so seeking works).

`Originals/` and `Lidarr/` are kept apart on purpose: Lidarr matches against MusicBrainz and would flag your own music as unrecognised.

## A download, step by step

1. The web app calls `POST /api/download?spotify_id=…`. eco queues a job and answers at once.
2. A worker (one at a time, to be kind to YouTube) reads the track from Spotify: title, artists, album, cover, length.
3. **Choosing the video.** A plain YouTube search runs first (one cheap call that already returns length and channel). Only if that result is not clearly right does eco also search YouTube Music, which is slower and rate-limited sooner. Each candidate is scored by how far its length is from Spotify's, penalised for unwanted versions (live, remix, sped up…) unless the song itself is one, and rewarded for official channels. The title must also match: a different song of the same length is rejected.
4. A candidate is accepted automatically only if it is within 10 s and has nothing odd about its title; otherwise the job fails with the reason, so a wrong song never reaches your library.
5. yt-dlp downloads the audio (progress is reported), ffmpeg tags it and embeds the cover, and the file is moved into place.
6. eco asks Navidrome to scan and looks for the new song, so the app can play it immediately. The job then becomes `ready` with the song's Navidrome ID.

The web app polls `/api/jobs` and draws a spinner, then a progress ring, then a check.

## HTTP API

Everything under `/api` needs the Subsonic credentials as query parameters (`u`, `t`, `s`).

| Endpoint | Returns |
|---|---|
| `GET /api/search?q=` | `songs` and `artists` from your library; `external`: Spotify songs you do not own (plus the artist's other songs when the query is an artist) |
| `GET /api/discover?artist=` | songs by that artist that are not in your library |
| `GET /api/home` | newest, recently played and most played albums, random songs, recent downloads |
| `GET /api/songs?offset=&limit=` | the whole library, alphabetically, paged |
| `POST /api/download?spotify_id=` | queue a download; repeated calls for the same song return the same job |
| `GET /api/media/preview?url=` | what a YouTube link is (title, channel, length, thumbnail) and whether it is already imported |
| `POST /api/media/import?url=&kind=&format=&height=` | import a link as `video`, `podcast`, `audiobook` or `other` (`format` `audio` or `video`); the same video is never imported twice |
| `GET /api/media?kind=` | imported items, newest first |
| `GET /api/media/{id}/file`, `/thumb` · `DELETE /api/media/{id}` | the media (with `Range`), its thumbnail, delete |
| `GET /api/jobs` | recent jobs with `state` (`queued`, `searching`, `downloading`, `tagging`, `ready`, `error`) and `progress` |
| `/rest/*` | Navidrome's Subsonic API, passed through |
| `GET /healthz` | liveness |

## Imported media

`internal/media` keeps items on disk (one folder per video, with a `meta.json`), so there is still no database. Only `youtube.com`, `youtu.be` and their subdomains are accepted: letting a signed-in user make the server fetch arbitrary addresses would turn eco into a probe of your home network. Videos are fetched as H.264 when available (AV1 and VP9 do not play on many iPhones). A failed import removes its half-written folder.

## Offline in the web app

Everything saved for offline lives in the browser's IndexedDB: audio and cover as Blobs, plus a small record per song. A **collection** (favorites, a playlist, an album) remembers its list of songs, so it can be shown and played with no server. A song can be held by several collections and by an individual save; its files are deleted only when nothing holds it. When a downloaded collection is opened online, eco quietly downloads new songs and releases removed ones. The service worker caches only the app shell; audio and data never go through it.

## The likes workflow (`eco likes`)

For bulk downloads the CSV is the source of truth. Each step reads it, works, and saves after every song, so everything can be stopped and resumed. Before searching or downloading, eco scans the tags of your whole library and marks songs you already have as `downloaded` (so songs fetched by other means are never fetched twice). A download that finds YouTube demanding a sign-in stops and leaves the remaining songs as `found`.

Liked songs end up as **Navidrome favourites**: `eco likes favorites` stars every downloaded song for the user in `ND_USER`, oldest like first, so Navidrome's newest-first favourites list matches the order of your likes. Songs are matched by title, artist, album and length (Navidrome's `path` is not the file name). Spotify playlists, in contrast, become `.m3u` playlists.

## Code map

| Path | |
|---|---|
| `cmd/eco` | the CLI: `serve`, `get`, `likes`, `doctor` |
| `internal/server` | HTTP handlers, the Navidrome proxy, the library snapshot |
| `internal/engine` | find the video, download, tag, place the file |
| `internal/match` | normalising titles and scoring candidates (well tested; start here when a wrong song slips through) |
| `internal/ytdlp`, `internal/tag` | wrappers for yt-dlp and ffmpeg |
| `internal/spotify` | Web API client and the PKCE login |
| `internal/subsonic` | Navidrome client |
| `internal/lists` | the CSV workflow |
| `internal/library` | file naming and the on-disk index |
| `internal/jobs` | the download queue |
| `web/static` | the web app (ES modules, no build step), embedded into the binary |
