package main

import (
	"bufio"
	"context"
	"errors"
	"flag"
	"fmt"
	"os"
	"regexp"
	"strconv"
	"strings"

	"github.com/Thrashy190/eco/internal/catalog"
	"github.com/Thrashy190/eco/internal/config"
	"github.com/Thrashy190/eco/internal/engine"
	"github.com/Thrashy190/eco/internal/library"
)

// Noise typical of YouTube titles that gets in the way of a catalogue search.
var (
	reNoise  = regexp.MustCompile(`(?i)[\(\[][^\)\]]*(official|oficial|video|vídeo|audio|lyric|letra|visualizer|hd|4k|mv|remaster)[^\)\]]*[\)\]]`)
	reFeat   = regexp.MustCompile(`(?i)\s+(ft\.?|feat\.?)\s+.*`)
	reSymbol = regexp.MustCompile(`[|\-–—]+`)
	reTrack  = regexp.MustCompile(`[A-Za-z0-9]{22}`)
)

func get(ctx context.Context, args []string) error {
	cfg := config.Load()
	fs := flag.NewFlagSet("get", flag.ExitOnError)
	query := fs.String("q", "", "search the catalogue for this instead of the video title")
	track := fs.String("s", "", "Spotify track link or ID (skips the search)")
	yes := fs.Bool("y", false, "do not ask; use the first result")
	dry := fs.Bool("n", false, "only show the metadata, download nothing")
	dest := fs.String("d", "", "destination folder (default MUSIC/YouTube)")
	fs.Usage = func() {
		fmt.Fprintln(os.Stderr, "usage: eco get [flags] URL\n\nDownloads the audio of a YouTube link and tags it with the catalogue's metadata.")
		fs.PrintDefaults()
	}
	fs.Parse(args)
	if fs.NArg() != 1 {
		fs.Usage()
		return errors.New("expected exactly one URL")
	}
	link := strings.ReplaceAll(fs.Arg(0), `\`, "") // zsh escapes ? and = when pasting
	eng := engine.New(cfg)
	if err := eng.Catalog.Ready(); err != nil {
		return err
	}

	fmt.Println("Reading the video…")
	video, uploaded, err := eng.YT.InfoFull(ctx, link)
	if err != nil {
		return err
	}
	fmt.Printf("YouTube: %s  (%s, %s)\n", video.Title, video.Channel, clock(int(video.DurationSec*1000)))

	var m catalog.Meta
	if *track != "" {
		id := reTrack.FindString(*track)
		if id == "" {
			return fmt.Errorf("not a Spotify track: %s", *track)
		}
		if cfg.SpotifyID == "" || cfg.SpotifySecret == "" {
			return errors.New("-s needs SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET (see README)")
		}
		t, err := eng.Spotify.Track(ctx, id)
		if err != nil {
			return err
		}
		m = t.Meta()
	} else {
		q := *query
		if q == "" {
			q = queryFromVideo(video.Title, uploaded)
		}
		if m, err = choose(ctx, eng, q, int(video.DurationSec*1000), *yes); err != nil {
			return err
		}
	}
	fmt.Printf("\nMetadata:\n  Title:   %s\n  Artist:  %s\n  Album:   %s (%s)\n  Date:    %s   Track: %d/%d   Disc: %d\n  Cover:   %s\n  Source:  %s\n",
		m.Title, m.Artist, m.Album, m.AlbumArtist, m.Date, m.Track, m.Tracks, m.Disc, orDash(m.CoverURL), m.SourceURL)
	if *dry {
		return nil
	}

	out := eng.DestDir()
	if *dest != "" {
		out = *dest
	}
	fmt.Println("\nDownloading and converting…")
	final, err := eng.Fetch(ctx, link, m, out, nil)
	if err != nil {
		return err
	}
	fmt.Printf("\n✔ Saved: %s\nIt will show up in Navidrome within a minute.\n", library.Rel(cfg.MusicDir, final))
	return nil
}

func queryFromVideo(title string, up struct{ Track, Artist string }) string {
	// "Provided to YouTube by…" uploads carry clean track and artist fields
	if up.Track != "" && up.Artist != "" {
		first, _, _ := strings.Cut(up.Artist, ",")
		return "track:" + up.Track + " artist:" + strings.TrimSpace(first)
	}
	title = reFeat.ReplaceAllString(reNoise.ReplaceAllString(title, ""), "")
	return strings.TrimSpace(reSymbol.ReplaceAllString(title, " "))
}

// choose searches the catalogue and lets the user pick a result (or takes the first with -y).
func choose(ctx context.Context, eng *engine.Engine, query string, videoMs int, auto bool) (catalog.Meta, error) {
	in := bufio.NewReader(os.Stdin)
	// A search result does not know its track number: the chosen one is looked up whole
	whole := func(t catalog.Track) (catalog.Meta, error) {
		full, err := eng.Catalog.Track(ctx, t.ID)
		return full.Meta, err
	}
	for {
		fmt.Printf("\nSearching %s: %s\n", eng.Catalog.Name(), query)
		found, err := eng.Catalog.Search(ctx, query)
		if err != nil {
			return catalog.Meta{}, err
		}
		results := found.Tracks
		if len(results) > 10 {
			results = results[:10]
		}
		if len(results) == 0 {
			if auto {
				return catalog.Meta{}, fmt.Errorf("%s found nothing; try -q \"artist song\"", eng.Catalog.Name())
			}
			if query = ask(in, "No results. Type another search (empty = cancel): "); query == "" {
				return catalog.Meta{}, errors.New("cancelled")
			}
			continue
		}
		for i, t := range results {
			warn := ""
			if d := abs(t.DurationMs-videoMs) / 1000; d > 10 {
				warn = fmt.Sprintf("  ⚠ %ds off", d)
			}
			fmt.Printf("  %d. %s — %s  [%s]  %s%s\n", i+1, t.Artist, t.Title, t.Album, clock(t.DurationMs), warn)
		}
		if auto {
			return whole(results[0])
		}
		switch a := ask(in, "Pick [1], 0 = cancel, or type another search: "); {
		case a == "":
			return whole(results[0])
		case a == "0":
			return catalog.Meta{}, errors.New("cancelled")
		default:
			if n, err := strconv.Atoi(a); err == nil && n >= 1 && n <= len(results) {
				return whole(results[n-1])
			}
			query = a
		}
	}
}

func ask(in *bufio.Reader, prompt string) string {
	fmt.Print(prompt)
	line, _ := in.ReadString('\n')
	return strings.TrimSpace(line)
}

func clock(ms int) string { s := (ms + 500) / 1000; return fmt.Sprintf("%d:%02d", s/60, s%60) }

func abs(n int) int {
	if n < 0 {
		return -n
	}
	return n
}

func orDash(s string) string {
	if s == "" {
		return "-"
	}
	return s
}
