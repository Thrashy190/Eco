# Eco on a Roku TV

Eco has an app for Roku TVs and sticks (`roku/`). It does two things:

- **Use it with the remote.** Home, Library, Search and Settings, with the look of your account in the web app: your accent, or with *Dynamic colour* on, the colour of the album playing (the same colour the web app picks), its glow behind everything, rounded or sharp corners, a floating top bar. When music starts, the player fills the screen, like Spotify on a TV: the big cover, the song, the controls and what comes next; after a few seconds without a key only the cover and the song stay. Back returns to where you were.
- **Send music to it from your phone.** The TV is one of your devices in **Listen on**, like any other browser where Eco is open. Choose it and the music plays on the TV; the phone keeps the controls, the queue and the progress bar.

It is not in the Roku Channel Store: you install it yourself on a Roku in developer mode. That is free, takes a few minutes, and only your Roku has it.

## 1. Developer mode on the Roku

With the Roku remote, on the home screen press **Home ×3, Up ×2, Right, Left, Right, Left, Right**. Accept the agreement, set a password for the user `rokudev` and let the Roku restart. It shows its address (such as `192.168.1.80`); you also find it under **Settings ▸ Network ▸ About**.

## 2. Let the Roku reach Eco

The TV talks to Eco directly, so it needs an address it can reach. Pick one:

| Address | When | What to set |
|---|---|---|
| `http://<computer's address>:8000` | Eco runs on a computer at home (fastest: the music never leaves your network) | `ECO_BIND=0.0.0.0` in `.env`, then `docker compose up -d` |
| `https://eco.<your domain>` | you already reach Eco through a tunnel | nothing |

`ECO_BIND=0.0.0.0` makes Eco reachable by every device on your network, which is what the TV needs. Every request still needs a Navidrome account, and the port must not be opened to the internet (see [deployment](deployment.md)).

## 3. Install the app

Add to `.env` (these values stay on your computer):

```bash
ROKU_IP=192.168.1.80                  # the Roku's address
ROKU_PASS=the-rokudev-password        # set when you turned on developer mode
ROKU_ECO_URL=http://192.168.1.50:8000 # the address from step 2
```

Then:

```bash
make roku-install   # packages roku/ into bin/eco-roku.zip, installs it and opens it on the TV
```

The app appears on the Roku's home screen as **Eco** (a developer app, at the end of the list). Run `make roku-install` again after pulling a new version. Without `ROKU_ECO_URL` the TV asks for the address the first time, and you can change it later in Settings on the TV.

## 4. Sign the TV in

The TV shows a six-letter code. On your phone or computer, open Eco, go to **Settings ▸ This device ▸ Connect a TV**, and type it. The TV signs in to your account a moment later, without anyone typing a password with the remote. A code works once, for ten minutes, and only the TV that asked for it can use it.

Several people can each sign the TV in to their own account; one at a time, like in a browser. **Settings ▸ Sign out of this TV** goes back to the code.

## The remote

| Key | Does |
|---|---|
| Arrows, OK | move and choose |
| Back | the screen before, then the top bar; on Home it leaves (asking first while music plays) |
| Play/Pause | play or pause, on any screen |
| Rewind / Fast forward | 15 seconds back or ahead |
| Instant replay | the song before |
| Options (✱) | on a song: play next, add to the queue, go to its album or artist, add to Favorites. Elsewhere: the player |
| Down, in the player | the queue; OK on a song jumps to it |

## From the phone

Open **Listen on** (the devices button in the player) and choose the TV. What plays moves there, and every control on the phone (play, skip, the queue, shuffle, repeat, Autoplay) acts on the TV. Choosing the phone again brings the music back, at the same second. Volume stays with the TV's remote: a Roku app cannot change it, so the phone hides that slider.

## Good to know

- **Formats.** The TV plays MP3, M4A/AAC, FLAC and WAV as they are. Anything else (Opus, Ogg) is converted to MP3 by Navidrome as it plays, and so is a file the TV fails to play the first time.
- **Screensaver.** While Eco is open, the Roku's screensaver shows the cover playing, moving slowly so nothing burns into the screen.
- **Nothing is stored on the TV** but the server address, the sign-in (user, token and salt, never a password) and whether Autoplay is on.
- **Logs.** `make roku-logs` shows what the app prints and its errors, live.
- **Opening it from the computer.** `make roku-install` opens the app after installing it if the Roku allows it: **Settings ▸ System ▸ Advanced system settings ▸ Control by mobile apps ▸ Network access**. *Limited* blocks it (and remote keys sent over the network); the app still installs and opens from the TV's home screen.

## For developers

The app is BrightScript and SceneGraph, no build step: `roku/source/main.brs` starts `components/MainScene`, which holds the player (`Player.brs`), Connect (`Connect.brs`) and a stack of screens (`components/screens`). Network calls run in Task nodes (`components/tasks`), since Roku does not allow them on the screen's thread.

- `make roku-check` validates every file with the BrighterScript compiler and bslint, and runs the tests of the pure logic (`roku/tests`, the queue rules and JSON helpers) in the brs-node interpreter. CI runs it as part of `make check`.
- The queue follows the same rules as the web app: `components/lib/queue.brs` is `web/src/lib/queue.ts` translated, with the same tests. Change both together.
- Songs sent to the phone must keep their keys' capitals (`albumId`, `artistId`, `mediaId`). BrightScript stores `song.albumId = x` as `albumid`, so those keys are always written in brackets: `song["albumId"] = x`.
- The brs-node simulator can run the whole app on a computer: `roku/node_modules/.bin/brs-cli bin/eco-roku.zip -e -s` (ECP keys on port 8060, Ctrl+S saves a screenshot). It draws text only with fonts from the package (`roku/fonts`), and blocks a task while it waits for a request, which is why polling and reporting run in separate tasks. Point it at a scratch Eco and a fake Navidrome, never at your real library.
- Covers are rounded on the server, never with `MaskGroup`: inside a RowList or a grid a real Roku draws the mask in the wrong place (the simulator does not), and a card must not draw outside itself either, since the list cuts it there. That is why the focus ring sits on the cover's edge.
- The look comes from the account (`GET /api/me/look`, `Theme.brs`), and everything on screen reads `m.global.theme`: a new setting the TV should follow goes there.
- The pictures come from `roku/tools/make-images.py` and the two fonts (Bricolage Grotesque, SIL Open Font License) from `roku/tools/make-fonts.py`.

On the server, a TV needs two things a browser does not:

| Endpoint | |
|---|---|
| `POST /api/tv/pair` | a code to show and the secret to collect it with (no sign-in) |
| `GET /api/tv/pair/{code}?secret=` | 202 while waiting, then the credentials once (no sign-in) |
| `POST /api/tv/approve` | `{code}`: sign that TV in to this account |
| `GET /api/connect/poll?device=&name=&can_volume=` | Connect without a stream: waits up to 25 s and returns the events since the last poll |
| `GET /api/covers/accent?id=&theme=dark\|black` | a cover's colour and the accent the web app's dynamic colour makes of it (`internal/palette`, the maths of `lib/color.ts`) |
| `GET /api/covers/shaped?id=\|playlist=&size=&shape=soft\|sharp\|circle` | a cover cut to that shape, as a PNG with transparent corners (`internal/coverart`) |

A Roku cannot read a response that has not finished, so it cannot follow Server-Sent Events. `connect.Hub.Hold` keeps a polling device connected for 20 s after each poll ends, so the other devices never see it leave and come back between two polls, and holds the events meant for it until it asks.
