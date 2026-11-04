# Album downloads with Lidarr, Prowlarr and qBittorrent (optional)

Eco downloads **single songs** from YouTube. If you also want **whole albums** from indexers you configure yourself, the standard *arr stack is included as an opt-in profile. Eco does not depend on it, and Eco is not affected if you never turn it on.

```bash
docker compose --profile downloads up -d        # Lidarr :8686, Prowlarr :9696, qBittorrent :8080 (all on 127.0.0.1)
```

Reach the three web UIs from your own machine with an SSH tunnel:

```bash
ssh -L 8686:localhost:8686 -L 9696:localhost:9696 -L 8080:localhost:8080 user@server
```

## How it fits together

```
Lidarr (what to get) ◄──► Prowlarr (where to look, Torznab indexers)
   │
   └──► qBittorrent ──► data/torrents ──hardlink──► data/music/Lidarr/Artist/Album  ──► Navidrome
```

- **One shared mount.** Lidarr and qBittorrent both mount `${DATA_DIR}:/data`, so Lidarr can *hardlink* a finished download into the library instead of copying it. Do not split those mounts.
- **Separate folders.** Lidarr's root folder is `data/music/Lidarr`. Keep your own and Eco-made music out of it: Lidarr matches against MusicBrainz and would mark them unrecognised.
- **Hook.** `scripts/scan-navidrome.sh` asks Navidrome to rescan as soon as Lidarr imports something. It needs a Navidrome **admin** user: set `ND_USER` and `ND_PASS` in `.env` (the real password).

## Setup checklist

**qBittorrent** (`localhost:8080`)
- [ ] Read the temporary password: `docker logs qbittorrent 2>&1 | grep -i password`, sign in and change it.
- [ ] *Downloads ▸ Default Save Path*: `/data/torrents`. Set seeding limits.

**Lidarr** (`localhost:8686`, *Settings*)
- [ ] *Media Management*: root folder `/data/music/Lidarr`; enable *Rename Tracks* and (Show Advanced) *Use Hardlinks instead of Copy*.
- [ ] *Metadata*: write tags into the audio files.
- [ ] *Profiles*: a quality profile (prefer FLAC if you like).
- [ ] *Download Clients*: qBittorrent, host `qbittorrent` (or `gluetun` with the VPN override), port 8080, category `lidarr`.
- [ ] *Connect*: Custom Script `/scripts/scan-navidrome.sh`, on *Release Import* and *Upgrade*.
- [ ] *General*: copy the API key.

**Prowlarr** (`localhost:9696`)
- [ ] *Settings ▸ Apps ▸ Lidarr*: Prowlarr `http://prowlarr:9696`, Lidarr `http://lidarr:8686`, the API key.
- [ ] *Indexers*: add the sources you are entitled to use.

**Using it**: in Lidarr, *Library ▸ Add New*, root `/data/music/Lidarr`, monitor *None* to choose album by album; then monitor an album and search (automatic or interactive). Progress is in *Activity ▸ Queue*.

Verify hardlinks after an import (the first number should be 2): `stat -c '%h %n' data/music/Lidarr/*/*/* | head`.

## Running qBittorrent behind a VPN

Torrenting without a VPN exposes your home IP address to every peer. `docker-compose.vpn.yml` puts qBittorrent behind [gluetun](https://github.com/qdm12/gluetun) with a kill switch (if the VPN drops, qBittorrent has no network at all). Fill `VPN_PROVIDER`, `WG_PRIVATE_KEY`, `WG_ADDRESSES` and `VPN_COUNTRY` in `.env` (see the gluetun wiki for your provider), then:

```bash
docker compose --profile downloads -f docker-compose.yml -f docker-compose.vpn.yml up -d
```

Needs Docker Compose 2.24+. With the VPN, Lidarr must use host `gluetun`, not `qbittorrent`, for the download client.

## Responsible use

Only configure indexers and download content you have the right to. Internet Archive, Bandcamp and Qobuz purchases, Free Music Archive, Jamendo and your own CDs are all fine sources.
