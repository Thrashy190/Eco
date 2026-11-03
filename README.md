# eco

**Your own music app.** Listen to your library, search for any song, and download what you do not have yet — all in one place, on a server you control.

- **Listen**: a fast web app you can install on your phone, with a queue, lock-screen controls, playlists and offline mode.
- **Search everything**: one search box finds songs in your library *and* songs you do not own. Search an artist and see their other songs too.
- **One tap to download**: tapped songs are fetched, tagged with proper metadata and cover art, and appear in your library in seconds.
- **Offline, Spotify-style**: tap **Download** on your favorites, a playlist or an album (or save single songs) and they play with no connection. Downloaded collections stay in sync, and *Offline mode* in Settings forces the app to use only what is on your phone.
- **More than music**: paste a YouTube link, say what it is (podcast, audiobook, video or other) and it appears in the matching Library tab. Podcasts and audiobooks remember where you stopped and play at your speed.
- **Yours to style**: themes (auto, dark, light, black), any accent colour, compact lists, sharp or soft corners and adjustable animations, saved per account on each device.
- **Yours**: your files, your server. Everything is [Navidrome](https://www.navidrome.org) underneath, so any Subsonic app also works.

```
 your phone / browser ──► eco (this project) ──► Navidrome ──► your music files
                              │                      ▲
                              └─ yt-dlp + ffmpeg ────┘   downloads, tags, covers
```

> **Status:** early, actively developed. The interface is English only for now.

## Quick start (Docker)

You need a machine that is always on (a PC, a Raspberry Pi 4+, a home server, a VPS) with [Docker](https://docs.docker.com/engine/install/) and Docker Compose v2.

```bash
git clone <this repository> eco && cd eco
cp .env.example .env
mkdir -p data/music navidrome secrets       # folders the containers use
docker compose up -d --build
```

Then:

1. Open **http://localhost:4533** and create your first account. The first user is the administrator.
2. Open **http://localhost:8000** — that is eco. Sign in with the account you just created.
3. Add some music (see [Adding music](#adding-music)) and search for it.

Searching beyond your library and downloading need Spotify credentials and, usually, YouTube cookies. Both are explained below; without them eco is still a good player.

## Prerequisites

| You need | Why | Notes |
|---|---|---|
| **Docker + Compose v2** | runs everything | `docker compose version` should print v2.x |
| A **Spotify developer app** (free) | song search and metadata | [setup](docs/configuration.md#spotify). Optional, but needed to search/download |
| **YouTube cookies** | YouTube blocks anonymous downloads after a while | [setup](docs/configuration.md#youtube-cookies). Optional at first |
| ~1 GB of free RAM, disk for your music | | Navidrome uses ~70 MB, eco ~30 MB |

Not using Docker? You need [Go 1.22+](https://go.dev/dl/), [ffmpeg](https://ffmpeg.org), [yt-dlp](https://github.com/yt-dlp/yt-dlp) and [deno](https://deno.com) or Node.js 20+, plus a running Navidrome. See [Running without Docker](#running-without-docker).

## Configuration

Every setting lives in `.env`, and [docs/configuration.md](docs/configuration.md) explains each one and where to get it. The two you will want first:

- **Spotify credentials** (`SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`): a free developer app, [two minutes](docs/configuration.md#spotify). Needed to search beyond your library and to download.
- **YouTube cookies** (`YT_COOKIES_BROWSER` or `secrets/cookies.txt`): [how to set them up](docs/configuration.md#youtube-cookies). YouTube blocks anonymous downloads after a while.

## Adding music

Use whichever fits you; they all end up in the same library.

| Way | Good for |
|---|---|
| **The search box in eco** | Anything on Spotify's catalogue: search, tap **Get**. |
| **`eco likes`** | Download your whole Spotify *Liked Songs* or a playlist in bulk. See [CLI](#command-line). |
| **Copy files** into `data/music/` | Music you already own. Navidrome scans every minute. |
| **`scripts/upload.sh`** | Your own recordings: converts, tags and uploads them. |
| **A YouTube link** (podcast, audiobook, video…) | Paste it in the search box. It is stored apart from your music, in `data/media/`. |
| **Upload page** (`--profile uploads`) | Drag-and-drop uploads from a browser, for trusted people. |
| **Lidarr** (`--profile downloads`) | Whole albums through the \*arr stack. [Guide](docs/downloads-stack.md). |

Downloads land in `data/music/YouTube/Artist/Album/NN - Title.m4a`, tagged and with a cover.

## Videos, podcasts and audiobooks

Paste a YouTube link into the search box (a single video, not a playlist). eco shows what it is, you choose a category and whether to keep the picture, and it downloads in the background:

| Category | Plays as | Extras |
|---|---|---|
| **Podcast**, **Audiobook** | audio | remembers where you stopped, speed button (0.75× to 2×), can be saved for offline |
| **Video** | a full-screen video player | remembers where you stopped; picture quality is set in Settings (up to 1080p) |
| **Other** | audio or video, your choice | for talks, lectures, sounds… |

These files live in `data/media/`, **not** in your music folder, so Navidrome never mixes them into your artists, albums or shuffled mixes. Only YouTube links are accepted. Videos are too large to save for offline use, so offline mode covers audio only.

## Use it from your phone

Open eco in your phone's browser and use **Add to Home Screen** (iPhone: Share ▸ Add to Home Screen; Android: menu ▸ Install app). It then behaves like an app.

To reach your server from outside your home you need HTTPS. Options, easiest first, are described in [docs/deployment.md](docs/deployment.md): a **Cloudflare Tunnel** (`--profile tunnel`), **Tailscale**, or a reverse proxy of your own. Do not expose the port directly to the internet.

## Command line

The `eco` binary is also a toolbox. With Docker: `docker compose run --rm eco <command>`; without: `./bin/eco <command>`.

```bash
eco doctor                          # check yt-dlp, ffmpeg, Navidrome, Spotify, cookies
eco get "https://youtube.com/watch?v=..."     # one YouTube link → tagged song
eco get -q "artist song" URL        # pick the Spotify match yourself (-y: take the first, -n: dry run)

# Your Spotify liked songs, step by step (each step can be interrupted and resumed)
eco likes export                    # signs in to Spotify the first time
eco likes search --first 200        # find the YouTube video of your 200 most recent likes
eco likes download                  # fetch every song marked "found"
eco likes favorites                 # mark them as favourites in Navidrome, in the order you liked them
eco likes all                       # every step above

# A Spotify playlist becomes a Navidrome playlist
eco likes all --playlist "My playlist"
```

Your **liked songs become your Navidrome favourites** (the *Favorites* tab in eco), not a playlist; playlists are for Spotify playlists you choose. `favorites` needs `ND_USER` and `ND_PASS` ([configuration](docs/configuration.md#nd_user-nd_pass)) and is safe to repeat: songs already favourited are skipped.

`eco likes` keeps its state in `data/likes.csv` (or `data/playlists/NAME.csv`). A song is `pending`, `found`, `review` (needs a human look), `downloaded` or `error`; edit the file freely. `--limit N` processes at most N songs (`0` means no limit).

`eco likes export` opens a browser for the Spotify login, so run it on a machine with a browser; the CSV files it produces can then be used anywhere.

## Running without Docker

```bash
make tools          # downloads yt-dlp into bin/ (Linux x86_64; elsewhere install it yourself)
make doctor         # tells you what is missing
make run            # http://127.0.0.1:8000
```

eco reads `.env` from the current directory. Point it at your Navidrome with `ECO_NAVIDROME_URL` (default `http://127.0.0.1:4533`).

## Updating

```bash
git pull
docker compose up -d --build
```

yt-dlp changes whenever YouTube does. If downloads start failing everywhere, rebuild without cache to get the latest: `docker compose build --no-cache eco && docker compose up -d`.

## Troubleshooting

| Symptom | Try |
|---|---|
| `eco doctor` reports something missing | Follow the hint it prints. |
| "Sign in to confirm you're not a bot" | [YouTube cookies](docs/configuration.md#youtube-cookies). |
| "no confident match on YouTube" | eco refused a doubtful video (wrong length or title). Use `eco get -q ... URL` to pick one by hand. |
| Searching only shows your library | `SPOTIFY_CLIENT_ID` / `SPOTIFY_CLIENT_SECRET` are not set or are wrong. |
| A new song does not show up | Navidrome scans every minute; give it a moment. |
| Wrong username or password | Use your **Navidrome** account: eco has no accounts of its own. |

## How it works

See [docs/architecture.md](docs/architecture.md).

## Development

```bash
make check          # gofmt, go vet, go test, JavaScript syntax — the same as CI
make run            # build and serve
```

The Go code lives in `cmd/` and `internal/`; the web app in `web/static/` is plain JavaScript modules with no build step and is embedded into the binary. See [CONTRIBUTING.md](CONTRIBUTING.md).

## Responsible use

eco is a tool for managing and playing a personal music library. It downloads audio from YouTube using yt-dlp; doing so may violate YouTube's terms of service and, depending on where you live and what you download, copyright law. You are responsible for what you download and for having the right to do so. Do not use eco to distribute copyrighted music. Buying music from the artists you love is always welcome.

## License

[MIT](LICENSE). Use it, change it, share it.
