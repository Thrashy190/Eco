package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"os"
	"path/filepath"

	"github.com/Thrashy190/eco/internal/config"
	"github.com/Thrashy190/eco/internal/engine"
	"github.com/Thrashy190/eco/internal/library"
	"github.com/Thrashy190/eco/internal/lists"
	"github.com/Thrashy190/eco/internal/spotify"
	"github.com/Thrashy190/eco/internal/subsonic"
)

const likesUsage = `usage: eco likes <step> [flags]

Your Spotify liked songs (or a playlist, with --playlist NAME), in resumable steps:
  export     Spotify → CSV (asks you to sign in the first time)
  search     find the YouTube video of every song
  download   fetch every song marked "found"
  favorites  mark the downloaded songs as favourites in Navidrome, keeping their order (liked songs only)
  playlist   write the .m3u that Navidrome imports (playlists only; "download" does it too)
  all        everything above that applies

Flags:
`

func likes(ctx context.Context, args []string) error {
	if len(args) == 0 || args[0] == "-h" || args[0] == "--help" {
		fmt.Fprint(os.Stderr, likesUsage)
		return nil
	}
	step := args[0]
	cfg := config.Load()

	fs := flag.NewFlagSet("likes "+step, flag.ExitOnError)
	playlist := fs.String("playlist", "", "work on this Spotify playlist of yours instead of your liked songs")
	first := fs.Int("first", 0, "only consider the first N rows (your most recent likes); 0 = all")
	limit := fs.Int("limit", 0, "process at most N songs; 0 = no limit")
	workers := fs.Int("workers", 3, "parallel YouTube searches")
	pause := fs.Duration("pause", 0, "wait between downloads, e.g. 5s (only if YouTube starts blocking you)")
	csvPath := fs.String("csv", "", "CSV to use (default data/likes.csv, or data/playlists/NAME.csv)")
	fs.StringVar(&cfg.MusicDir, "music", cfg.MusicDir, "music library folder")
	fs.Usage = func() { fmt.Fprint(os.Stderr, likesUsage); fs.PrintDefaults() }
	fs.Parse(args[1:])

	likesCSV := filepath.Join(cfg.DataDir, "likes.csv")
	path, name, isPlaylist := likesCSV, "", *playlist != ""
	if isPlaylist {
		path, name = filepath.Join(cfg.DataDir, "playlists", library.Safe(*playlist)+".csv"), *playlist
	}
	if *csvPath != "" {
		path = *csvPath
	}

	run := &lists.Runner{Engine: engine.New(cfg), CSV: path, Out: os.Stdout}
	opts := lists.Options{First: *first, Limit: *limit, Workers: *workers, Pause: *pause}

	steps := map[string]func() error{
		"export": func() error { return export(ctx, cfg, run, *playlist, likesCSV) },
		"search": func() error { return run.Search(ctx, opts) },
		"download": func() error {
			if err := run.Download(ctx, opts); err != nil {
				return err
			}
			if isPlaylist {
				return run.WritePlaylist(name)
			}
			return nil
		},
		"favorites": func() error {
			if isPlaylist {
				return errors.New("favorites is for your liked songs; a playlist becomes a Navidrome playlist (step: playlist)")
			}
			return favorites(ctx, cfg, run)
		},
		"playlist": func() error {
			if !isPlaylist {
				return errors.New("liked songs are Navidrome favourites, not a playlist: use the favorites step (or --playlist NAME)")
			}
			return run.WritePlaylist(name)
		},
	}
	order := []string{"export", "search", "download"}
	if !isPlaylist {
		order = append(order, "favorites")
	}
	if step == "all" {
		for _, s := range order {
			if err := steps[s](); err != nil {
				return err
			}
		}
		return summary(run)
	}
	do, ok := steps[step]
	if !ok {
		return fmt.Errorf("unknown step %q (use export, search, download, favorites, playlist or all)", step)
	}
	if err := do(); err != nil {
		return err
	}
	return summary(run)
}

func export(ctx context.Context, cfg *config.Config, run *lists.Runner, playlist, likesCSV string) error {
	if cfg.SpotifyID == "" {
		return fmt.Errorf("SPOTIFY_CLIENT_ID is not set (see docs/configuration.md)")
	}
	user := spotify.New(&spotify.UserLogin{ClientID: cfg.SpotifyID, RedirectURI: cfg.SpotifyRedirect,
		CacheFile: cfg.TokenFile(), Interactive: true})
	if playlist == "" {
		return run.Export(ctx, user.LikedSongs, "", true)
	}
	id, err := user.FindPlaylist(ctx, playlist)
	if err != nil {
		return err
	}
	walk := func(ctx context.Context, fn func(spotify.Item, int) error) error {
		return user.PlaylistTracks(ctx, id, fn)
	}
	return run.Export(ctx, walk, likesCSV, false)
}

func favorites(ctx context.Context, cfg *config.Config, run *lists.Runner) error {
	if cfg.NavidromeUser == "" || cfg.NavidromePassword == "" {
		return errors.New("ND_USER and ND_PASS are not set: they are the Navidrome account whose favourites to fill (see docs/configuration.md)")
	}
	nd := subsonic.New(cfg.NavidromeURL)
	cred := subsonic.NewCred(cfg.NavidromeUser, cfg.NavidromePassword)
	if err := nd.Ping(ctx, cred); err != nil {
		return fmt.Errorf("Navidrome rejected ND_USER / ND_PASS: %w", err)
	}
	res, err := run.SyncFavorites(ctx, nd, cred)
	fmt.Fprintln(run.Out, res.Describe())
	return err
}

func summary(run *lists.Runner) error {
	rows, err := lists.Read(run.CSV)
	if err != nil {
		return err
	}
	fmt.Fprintf(os.Stdout, "\nSummary:")
	for _, s := range []string{lists.Pending, lists.Found, lists.Review, lists.Downloaded, lists.Failed} {
		if n := lists.Count(rows)[s]; n > 0 {
			fmt.Fprintf(os.Stdout, "  %s: %d", s, n)
		}
	}
	fmt.Fprintln(os.Stdout)
	return nil
}
