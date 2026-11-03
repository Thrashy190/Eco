# eco

**Your own music app.** Listen to your library, search for any song, and download what you do not have yet — all in one place, on a server you control.

- **Listen**: a fast web app you can install on your phone, with a queue, lock-screen controls, playlists and offline mode.
- **Search everything**: one search box finds songs in your library *and* songs and albums you do not own, from [MusicBrainz](https://musicbrainz.org), with iTunes as a backup. No account, key or subscription needed. Search an artist and see their other songs too.
- **Whole albums, your choice**: open an album to see every track in order and which ones you already have, then tick the ones to download.
- **One tap to download**: tapped songs are fetched, tagged with proper metadata and cover art, and appear in your library in seconds.
- **A library like Spotify's**: it opens on what you played lately, with Favorites and anything you pinned on top. Pin songs, albums, playlists and artists, and give your playlists their own cover.
- **Bring your playlists**: import a file exported from Spotify or anywhere else and get a real playlist of what you have, then download the rest if you want it.
- **A big-screen layout too**: on a computer or a tablet it becomes panels: your library always at hand, the page, a player bar and what plays next.
- **Offline, Spotify-style**: tap **Download** on your favorites, a playlist or an album (or save single songs) and they play with no connection. Downloaded collections stay in sync, and *Offline mode* in Settings forces the app to use only what is on your phone.
- **More than music**: paste a YouTube link, say what it is (podcast, audiobook or other) and its audio appears in the matching Library section. Podcasts and audiobooks remember where you stopped and play at your speed.
- **Every device, one remote**: see what plays on your other devices and control it from any of them: pause, skip, volume, or move the music to another device. Only your own devices, wherever they are.
- **Admins keep the library tidy**: a Navidrome administrator can delete songs, podcasts and audiobooks for everyone, right from the app, and review songs held twice and artists that are really several people.
- **Yours to style**: themes (auto, dark, light, black), any accent colour, fonts and text size, what Home shows and in what order, which tabs you get, grid or list, compact lists, sharp or soft corners and adjustable animations, saved per account on each device.
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

Searching beyond your library works right away. Downloading usually needs YouTube cookies, explained below; without them eco is still a good player.

## Prerequisites

| You need | Why | Notes |
|---|---|---|
| **Docker + Compose v2** | runs everything | `docker compose version` should print v2.x |
| **YouTube cookies** | YouTube blocks anonymous downloads after a while | [setup](docs/configuration.md#youtube-cookies). Optional at first |
| ~1 GB of free RAM, disk for your music | | Navidrome uses ~70 MB, eco ~30 MB |

Not using Docker? You need [Go 1.22+](https://go.dev/dl/), [ffmpeg](https://ffmpeg.org), [yt-dlp](https://github.com/yt-dlp/yt-dlp) and [deno](https://deno.com) or Node.js 20+, plus a running Navidrome. See [Running without Docker](#running-without-docker).

## Configuration

Every setting lives in `.env`, and [docs/configuration.md](docs/configuration.md) explains each one and where to get it. The one you will want first:

- **YouTube cookies** (`YT_COOKIES_BROWSER` or `secrets/cookies.txt`): [how to set them up](docs/configuration.md#youtube-cookies). YouTube blocks anonymous downloads after a while.

## Adding music

Use whichever fits you; they all end up in the same library.

| Way | Good for |
|---|---|
| **The search box in eco** | Anything in [MusicBrainz](docs/configuration.md#where-song-information-comes-from): search, tap **Get**, or open an album and choose its tracks. |
| **Import a playlist**, in the app | A list exported to a file from Spotify or elsewhere: it becomes a playlist, and you can download what is missing. |
| **`eco likes`** | Download your whole Spotify *Liked Songs* or a playlist in bulk, through your own [Spotify developer app](docs/configuration.md#spotify). See [CLI](#command-line). |
| **Copy files** into `data/music/` | Music you already own. Navidrome scans every minute. |
| **`scripts/upload.sh`** | Your own recordings: converts, tags and uploads them. |
| **A YouTube link** (podcast, audiobook…) | Paste it in the search box. Only the audio is kept, apart from your music, in `data/media/`. |
| **Lidarr** (`--profile downloads`) | Whole albums through the \*arr stack. [Guide](docs/downloads-stack.md). |

Downloads land in `data/music/YouTube/Artist/Album/NN - Title.m4a`, tagged and with a cover.

## Podcasts and audiobooks

Paste a YouTube link into the search box (a single video, not a playlist). eco shows what it is, you choose a category, and it downloads **only the audio** in the background:

| Category | Good for | Extras |
|---|---|---|
| **Podcast**, **Audiobook** | long listening | remembers where you stopped, speed button (0.75× to 2×), can be saved for offline |
| **Other** | talks, lectures, sounds… | the same |

These files live in `data/media/<category>/<video id>/`, **not** in your music folder, so Navidrome never sees them or mixes them into your artists, albums or shuffled mixes. eco stores and serves them itself. Only YouTube links are accepted.

## Use it from your phone

Open eco in your phone's browser and use **Add to Home Screen** (iPhone: Share ▸ Add to Home Screen; Android: menu ▸ Install app). It then behaves like an app.

To reach your server from outside your home you need HTTPS. Options, easiest first, are described in [docs/deployment.md](docs/deployment.md): a **Cloudflare Tunnel** (`--profile tunnel`), **Tailscale**, or a reverse proxy of your own. Do not expose the port directly to the internet.

## Command line

The `eco` binary is also a toolbox. With Docker: `docker compose run --rm eco <command>`; without: `./bin/eco <command>`.

```bash
eco doctor                          # check yt-dlp, ffmpeg, Navidrome, the catalogue, cookies
eco get "https://youtube.com/watch?v=..."     # one YouTube link → tagged song
eco get -q "artist song" URL        # pick the match yourself (-y: take the first, -n: dry run)

# Your Spotify liked songs, step by step (each step can be interrupted and resumed)
eco likes export                    # signs in to Spotify the first time
eco likes search --first 200        # find the YouTube video of your 200 most recent likes
eco likes download                  # fetch every song marked "found"
eco likes favorites                 # mark them as favourites in Navidrome, in the order you liked them
eco likes all                       # every step above

# A Spotify playlist becomes a Navidrome playlist
eco likes all --playlist "My playlist"
```

Your **liked songs become your Navidrome favourites**, which eco shows as a *Favorites* playlist at the top of your library. In Navidrome they stay favourites; real playlists are for Spotify playlists you choose. `favorites` needs `ND_USER` and `ND_PASS` ([configuration](docs/configuration.md#nd_user-nd_pass)) and is safe to repeat: songs already favourited are skipped.

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
| Searching only shows your library | The server cannot reach musicbrainz.org, or it asked eco to wait a moment; the search says which. |
| A song or album is not found | MusicBrainz is made by volunteers and may not have it yet. [Anyone can add it](https://musicbrainz.org/doc/How_to_Add_a_Release). |
| A new song does not show up | Navidrome scans every minute; give it a moment. |
| Wrong username or password | Use your **Navidrome** account: eco has no accounts of its own. |

## How it works

See [docs/architecture.md](docs/architecture.md).

## Development

```bash
make check          # gofmt, go vet, go test, TypeScript, web tests and build — the same as CI
make run            # build and serve
make web-dev        # the web app with hot reload, using the eco running on :8000
```

The Go code lives in `cmd/` and `internal/`; the web app in `web/src/` is React and TypeScript, built with Vite and embedded into the binary. See [CONTRIBUTING.md](CONTRIBUTING.md).

## Responsible use

eco is a tool for managing and playing a personal music library. It downloads audio from YouTube using yt-dlp; doing so may violate YouTube's terms of service and, depending on where you live and what you download, copyright law. You are responsible for what you download and for having the right to do so. Do not use eco to distribute copyrighted music. Buying music from the artists you love is always welcome.

## License

[MIT](LICENSE). Use it, change it, share it.
