# Contributing

Thanks for helping. A few things make it quick.

## Set up

```bash
make tools      # yt-dlp into bin/ (or install it yourself)
make doctor     # what is missing on your machine
make check      # gofmt, go vet, go test, JavaScript syntax — what CI runs
make run        # http://127.0.0.1:8000 (needs a running Navidrome: see README)
```

You need Go 1.22+, ffmpeg, yt-dlp, deno or Node 20+, and Node for the JavaScript syntax check.

## Guidelines

- **Code, comments, commit messages and docs are in English.** So is the interface.
- **Keep the matching logic honest.** `internal/match` decides whether a video is the right song, and a wrong song in someone's library is worse than a failed download. Every fix there needs a test (`internal/match/match_test.go`) that names the real case it came from.
- **No build step for the web app.** `web/static` is plain ES modules; avoid adding a bundler or framework. Escape nothing by hand: build DOM with the `h()` helper, which never interprets text as HTML.
- **Never run network-touching code in tests.** Tests must pass offline.
- **Do not commit secrets or personal data.** `.env`, `secrets/` and `data/` are git-ignored.
- Keep changes small and say *why* in the description, not only what.

## Where things are

See [docs/architecture.md](docs/architecture.md) for the code map and how a download works.
