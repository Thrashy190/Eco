# Configuration

Everything is configured with environment variables, normally in a `.env` file next to `docker-compose.yml`
(`cp .env.example .env`). Real environment variables win over `.env`. After changing `.env` run
`docker compose up -d` so the containers pick it up.

| Variable | Needed? | What it is |
|---|---|---|
| [`PUID`, `PGID`](#puid-pgid) | Docker | the user that owns your music files |
| [`TZ`](#tz) | no | time zone of the logs |
| [`DATA_DIR`](#data_dir) | no | where music and state live |
| [`COMPOSE_PROFILES`](#compose_profiles) | no | optional parts to start |
| [`CATALOG`, `MUSICBRAINZ_URL`, `CATALOG_BACKUP`, `ITUNES_COUNTRY`](#where-song-information-comes-from) | no | where song information comes from |
| [`SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`](#spotify) | only `eco likes export` | a Spotify developer app |
| `SPOTIFY_REDIRECT_URI` | no | only for `eco likes` |
| [`YT_COOKIES_BROWSER`](#youtube-cookies) / `YT_COOKIES_FILE` | recommended | a YouTube login for yt-dlp |
| [`ECO_BIND`, `ECO_PORT`, `ND_BIND`](#network) | no | which interface/port to listen on |
| [`TUNNEL_TOKEN`](#tunnel_token) | tunnel profile | your Cloudflare tunnel |
| [`ND_USER`, `ND_PASS`](#nd_user-nd_pass) | favourites sync, Lidarr | a Navidrome account |
| [`VPN_*`, `WG_*`](#vpn) | VPN override | provider details for gluetun |
| [advanced](#advanced) | no | binaries and addresses when not using Docker |

## PUID, PGID

Files eco and Navidrome create are owned by this user. Run `id -u` and `id -g` on the machine that will run
the containers and copy the numbers (both are `1000` on most single-user Linux installs). If these do not match
the owner of `DATA_DIR`, the containers cannot write to it.

## TZ

A [tz database name](https://en.wikipedia.org/wiki/List_of_tz_database_time_zones), such as `Europe/Madrid` or
`America/Mexico_City`. Only affects log timestamps.

## DATA_DIR

The folder that holds `music/` (the library) and eco's state (`likes.csv`, `playlists/`). Default `./data`
(next to the compose file). On a server `/srv/data` is a common choice; create it first and make your user the
owner: `sudo mkdir -p /srv/data/music && sudo chown -R $(id -u):$(id -g) /srv/data`.

## COMPOSE_PROFILES

A comma-separated list of optional parts to start with a plain `docker compose up -d`:

| Profile | Starts | See |
|---|---|---|
| `tunnel` | Cloudflare tunnel | [deployment.md](deployment.md) |
| `downloads` | Lidarr, Prowlarr, qBittorrent | [downloads-stack.md](downloads-stack.md) |

You can also choose per command: `docker compose --profile tunnel up -d`.

## Where song information comes from

Searching beyond your library, album pages and the tags of what you download come from [MusicBrainz](https://musicbrainz.org),
an encyclopedia of music made by volunteers, and pictures from the [Cover Art Archive](https://coverartarchive.org). There
is nothing to set up: no account, no key and no cost. MusicBrainz's core data is [public domain (CC0)](https://musicbrainz.org/doc/About/Data_License).

What to expect:

- **One request per second** is [its rule](https://musicbrainz.org/doc/MusicBrainz_API/Rate_Limiting) for everyone at one address, so a search takes a couple of seconds. eco keeps answers, so going back to a page costs nothing. The library always answers first.
- **It has no popularity figures.** eco ranks results itself; a search with the artist and the song in it works best.
- **Very new or very obscure releases can be missing** until a volunteer adds them, and a few albums have no cover. You can [add them yourself](https://musicbrainz.org/doc/How_to_Add_a_Release).

**iTunes is the backup.** eco asks the [iTunes Search API](https://performance-partners.apple.com/search-api) (free, no account) when MusicBrainz is down or does not have a song or album, and for a cover when it has none. Searches ask both at once, because MusicBrainz cannot rank what it finds: what both have comes first, and when their lengths disagree iTunes's version is the one offered. Past Apple's limit a search simply uses MusicBrainz alone. Apple asks for about 20 requests per minute, which eco keeps to, and says its data is for promoting its store, so whether that suits you is your call: `CATALOG_BACKUP=none` turns it off. `ITUNES_COUNTRY` chooses the store.

`MUSICBRAINZ_URL` points eco at [your own mirror](https://musicbrainz.org/doc/MusicBrainz_Server/Setup), which has no limit.
`CATALOG=spotify` goes back to Spotify, with the credentials below.

## Spotify

**Optional.** eco only needs Spotify for `eco likes export`, which reads your liked songs and playlists through your own
Spotify login, for `eco get -s`, and for `CATALOG=spotify`. To bring a playlist over without any of this, use **Import a
playlist** in the app, which reads a file.

1. Sign in at the [Spotify developer dashboard](https://developer.spotify.com/dashboard) and click **Create app**.
2. Fill it in: any **App name** and **Description**; **Redirect URI** `http://127.0.0.1:8888/callback` (press *Add*); tick **Web API** under *Which API/SDKs are you planning to use*.
3. Save, open the app and go to **Settings**. Copy the **Client ID**; click *View client secret* and copy that too.
4. Put them in `.env`:
   ```
   SPOTIFY_CLIENT_ID=...
   SPOTIFY_CLIENT_SECRET=...
   ```

Good to know: while an app is in *development mode* the owner of the app needs a Spotify Premium account, searches
return at most 10 results per page, and Spotify can stop answering for hours. eco works within that. To also download your **liked songs** or **playlists** in bulk
(`eco likes`), the first run opens a browser to ask your permission; the login is kept in `.spotify_token.json`.
`SPOTIFY_REDIRECT_URI` must stay equal to the one you registered in step 2.

## YouTube cookies

After many downloads YouTube answers *"Sign in to confirm you're not a bot"*. Giving yt-dlp a signed-in session fixes it.
Use an account you could live without: automated downloading is against YouTube's terms and can get an account restricted.

**On a computer with a browser.** Sign in to YouTube in that browser, then set `YT_COOKIES_BROWSER` to its name
(`firefox`, `chrome`, `chromium`, `brave`, `edge`, `opera`, `vivaldi` or `safari`). yt-dlp reads the session itself.
On Linux you may need `pip install secretstorage` for the Chromium family, and the browser can stay open.

**On a server or in Docker** there is no browser, so export a `cookies.txt`:

1. Easiest, on your own computer, in a terminal where yt-dlp is installed (this keeps only the YouTube and Google cookies):
   ```bash
   yt-dlp --cookies-from-browser firefox --cookies /tmp/all.txt --skip-download "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
   (echo "# Netscape HTTP Cookie File"; grep -E '(^|\s|#HttpOnly_)\.?(www\.)?(youtube|google)\.com' /tmp/all.txt) > cookies.txt
   rm /tmp/all.txt
   ```
   Alternatively, use a "cookies.txt" browser extension and export the youtube.com cookies.
2. Copy `cookies.txt` to the server as `secrets/cookies.txt` and run `chmod 600 secrets/cookies.txt`.
3. `docker compose restart eco`

Cookies expire after a few weeks; repeat if downloads start failing again. Treat the file like a password.

## Network

| Variable | Default | Meaning |
|---|---|---|
| `ECO_BIND` | `127.0.0.1` | interface for eco's port. `0.0.0.0` makes it reachable from your whole network |
| `ECO_PORT` | `8000` | eco's port on the host |
| `ND_BIND` | `127.0.0.1` | interface for Navidrome's own port (its admin UI; eco reaches it internally) |

Keep the defaults and use a [tunnel or Tailscale](deployment.md) for remote access. Opening these ports on your
router exposes your server to the whole internet.

## TUNNEL_TOKEN

Needed only with the `tunnel` profile. In [Cloudflare Zero Trust](https://one.dash.cloudflare.com) go to
**Networks ▸ Tunnels**, create a tunnel of type *Cloudflared*, choose **Docker** and copy the token from the command it
shows (just the long string after `--token`). The routes (which hostname goes to which service) are set in the same
tunnel's page; see [deployment.md](deployment.md#option-a--cloudflare-tunnel-public-url-no-open-ports).

## ND_USER, ND_PASS

The name and **real password** of one of your Navidrome users.

- `eco likes favorites` marks your Spotify liked songs as favourites of *this* user.
- Lidarr (the `downloads` profile) uses it to ask Navidrome to rescan after importing an album, which requires the user to be an **administrator**.

Create users in Navidrome under **Settings ▸ Users** (the first account you create is the administrator).

## VPN

Only for the optional [qBittorrent behind a VPN](downloads-stack.md#running-qbittorrent-behind-a-vpn) setup. Take the
values from your VPN provider following the [gluetun wiki](https://github.com/qdm12/gluetun-wiki): `VPN_PROVIDER` is the
provider's name there (for example `mullvad`, `protonvpn`), `WG_PRIVATE_KEY` and `WG_ADDRESSES` come from the WireGuard
configuration you download from them, and `VPN_COUNTRY` is a country name such as `Netherlands`.

## Advanced

You only need these when running the `eco` binary yourself instead of the container.

| Variable | Default | Meaning |
|---|---|---|
| `ECO_NAVIDROME_URL` | `http://127.0.0.1:4533` | where eco reaches Navidrome |
| `ECO_LISTEN` | `127.0.0.1:8000` | address eco serves on |
| `YTDLP_BIN` | `yt-dlp` on `PATH`, else `./bin/yt-dlp` | the yt-dlp binary (`make tools` downloads one) |
| `FFMPEG_BIN` | `ffmpeg` | the ffmpeg binary |
| `ECO_ROOT` | current folder | where `.env` and `.spotify_token.json` live |

Run `eco doctor` any time to check what is missing.
