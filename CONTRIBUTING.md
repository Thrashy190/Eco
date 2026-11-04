# Contributing

Thanks for helping. A few things make it quick.

## Set up

```bash
make tools      # yt-dlp into bin/ (or install it yourself)
make doctor     # what is missing on your machine
make check      # gofmt, go vet, go test, TypeScript, web tests and build — what CI runs
make run        # http://127.0.0.1:8000 (needs a running Navidrome: see README)
make web-dev    # the web app with hot reload on :5173, using the eco running on :8000
```

You need Go 1.22+, Node 22.22+ (React Router asks for it), ffmpeg and yt-dlp (which also uses deno or Node to solve YouTube's challenges).

## Guidelines

- **Code, comments, commit messages and docs are in English.** So is the interface.
- **Keep the matching logic honest.** `internal/match` decides whether a video is the right song, and a wrong song in someone's library is worse than a failed download. Every fix there needs a test (`internal/match/match_test.go`) that names the real case it came from.
- **Keep the web app light.** `web/src` is React and TypeScript with `react-query` and `zustand`; avoid adding UI kits or CSS frameworks. Let React escape text: never use `dangerouslySetInnerHTML`.
- **Never run network-touching code in tests.** Tests must pass offline.
- **Do not commit secrets or personal data.** `.env`, `secrets/` and `data/` are git-ignored.
- Keep changes small and say *why* in the description, not only what.

## Commit messages and releases

Releases are automatic. When a push to `main` passes CI, [semantic-release](https://semantic-release.gitbook.io) reads the commit messages since the last tag, decides the version, tags it (`v1.2.3`) and publishes a GitHub release with the notes. So the first word of a commit message matters:

| Commit message | Means | `v1.2.3` becomes |
|---|---|---|
| `fix: stop the album page from showing part of an album` | a bug fixed | `v1.2.4` |
| `feat: resume offline downloads` | something new | `v1.3.0` |
| a footer `BREAKING CHANGE: ...`, or `feat!:` | people must change something when updating | `v2.0.0` |
| `docs:`, `test:`, `refactor:`, `ci:`, `chore:` | nothing changes for people | no release |

Write what changes for the person using Eco: the message becomes the release notes.

## Where things are

See [docs/architecture.md](docs/architecture.md) for the code map and how a download works.

## Reporting a security problem

Please do not open a public issue. See [SECURITY.md](SECURITY.md).

## Code of conduct

Everyone taking part follows the [code of conduct](CODE_OF_CONDUCT.md).
