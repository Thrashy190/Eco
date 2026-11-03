# Deployment

How to run eco on a home server and reach it safely from anywhere.

## 1. Prepare the server (Ubuntu example)

```bash
curl -fsSL https://get.docker.com | sh && sudo usermod -aG docker $USER   # log out and in afterwards
git clone <this repository> ~/eco && cd ~/eco
cp .env.example .env                      # then edit: PUID/PGID (run `id`), TZ
mkdir -p data/music navidrome secrets
docker compose up -d --build
docker compose exec eco eco doctor        # checks yt-dlp, ffmpeg, Navidrome, the catalogue, cookies
```

Create your first Navidrome account at `http://<server>:4533` (the first user is the administrator), then add other people under **Settings ▸ Users**. They sign in to eco with those same accounts. Give them a non-administrator account.

By default both ports listen on `127.0.0.1` only. For a quick test from another machine on your network set `ECO_BIND=0.0.0.0` in `.env`; for anything beyond that use one of the options below.

## 2. Reaching it from outside your home

Never forward a router port straight to eco or Navidrome. Pick one of these.

### Option A — Cloudflare Tunnel (public URL, no open ports)

Needs a free Cloudflare account and a domain managed there.

1. [Cloudflare Zero Trust](https://one.dash.cloudflare.com) ▸ **Networks ▸ Tunnels** ▸ create a tunnel of type *Cloudflared*, choose **Docker** and copy the token (only the part after `--token`).
2. Put it in `.env`: `TUNNEL_TOKEN=...`
3. In the same tunnel add **two published application routes** (*Public Hostname* tab):

   | Hostname | Service | For |
   |---|---|---|
   | `eco.yourdomain.com` | `http://eco:8000` | the eco web app: listen, search, download |
   | `music.yourdomain.com` | `http://navidrome:4533` | Navidrome itself, for Subsonic apps (Symfonium, Substreamer, JellyBox…) and its admin UI |

   Use `http://`, not `https://`: TLS is added by Cloudflare. Skip the second route if you only use eco.
4. `docker compose --profile tunnel up -d`
5. Open `https://eco.yourdomain.com` and sign in with your Navidrome account.

Notes:
- Do **not** put Cloudflare Access in front of these routes if you also use Subsonic apps (Symfonium, Substreamer…): they cannot pass its login page. eco's own login (your Navidrome accounts) protects it. Use strong passwords.
- Cloudflare terminates TLS, so it can technically see your traffic. Its terms also restrict serving large amounts of media through the free proxy; a couple of users streaming music is small, but it is a grey area and not guaranteed.

### Option B — Tailscale (private, nothing public)

Install [Tailscale](https://tailscale.com) on the server and on every phone. Then on the server:

```bash
sudo tailscale serve --bg 8000
tailscale serve status        # prints your https://<machine>.<tailnet>.ts.net URL
```

Needs MagicDNS and HTTPS certificates enabled in your tailnet. Everyone who should listen must be on your tailnet. To limit a guest to eco only, use an ACL:

```json
{
  "acls": [
    { "action": "accept", "src": ["autogroup:admin"], "dst": ["*:*"] },
    { "action": "accept", "src": ["guest@example.com"], "dst": ["homelab:443"] }
  ]
}
```

### Option C — your own reverse proxy

Any proxy that terminates HTTPS and forwards to `127.0.0.1:8000` works (Caddy, nginx, Traefik). Forward everything, including `/rest/` (audio uses `Range` requests) and `/api/`. Disable response buffering for `/rest/`.

## 3. Backups

What is irreplaceable and what is not:

| Back up | Because |
|---|---|
| `navidrome/` | users, playlists, favourites, play counts |
| `data/likes.csv`, `data/playlists/` | the state of your bulk downloads |
| `data/music/Originals/` | your own recordings, if you have any |
| `data/users/` | recents, pins and playlist covers |
| `data/media/` | imported podcasts and audiobooks |
| *(not needed)* `data/music/YouTube/` | can be downloaded again from the CSV |

Example with [restic](https://restic.net) to another machine:

```bash
restic -r sftp:user@other-host:/backups/eco backup ~/eco/navidrome ~/eco/data/likes.csv ~/eco/data/playlists ~/eco/data/music/Originals
```

Run it from a systemd timer or cron.

## 4. Security checklist

- Strong, unique passwords for every Navidrome account; non-admin for guests.
- Only HTTPS is reachable from outside; `ECO_BIND`, `ND_BIND` stay on `127.0.0.1` unless you know why not.
- `.env` and `secrets/` are private (they hold API keys and your YouTube session). They are git-ignored; keep it that way.
- Keep images fresh: `docker compose pull && docker compose up -d --build`.
