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

	"github.com/Thrashy190/eco/internal/config"
	"github.com/Thrashy190/eco/internal/engine"
	"github.com/Thrashy190/eco/internal/library"
	"github.com/Thrashy190/eco/internal/spotify"
)

// Noise typical of YouTube titles that gets in the way of a Spotify search.
var (
	reNoise  = regexp.MustCompile(`(?i)[\(\[][^\)\]]*(official|oficial|video|vídeo|audio|lyric|letra|visualizer|hd|4k|mv|remaster)[^\)\]]*[\)\]]`)
	reFeat   = regexp.MustCompile(`(?i)\s+(ft\.?|feat\.?)\s+.*`)
	reSymbol = regexp.MustCompile(`[|\-–—]+`)
	reTrack  = regexp.MustCompile(`[A-Za-z0-9]{22}`)
)

func get(ctx context.Context, args []string) error {
	cfg := config.Load()
	fs := flag.NewFlagSet("get", flag.ExitOnError)
	query := fs.String("q", "", "search Spotify for this instead of the video title")
	track := fs.String("s", "", "Spotify track link or ID (skips the search)")
	yes := fs.Bool("y", false, "do not ask; use the first Spotify result")
	dry := fs.Bool("n", false, "only show the metadata, download nothing")
	dest := fs.String("d", "", "destination folder (default MUSIC/YouTube)")
	fs.Usage = func() {
		fmt.Fprintln(os.Stderr, "usage: eco get [flags] URL\n\nDownloads the audio of a YouTube link and tags it with Spotify's metadata.")
		fs.PrintDefaults()
	}
	fs.Parse(args)
	if fs.NArg() != 1 {
		fs.Usage()
		return errors.New("expected exactly one URL")
	}
	link := strings.ReplaceAll(fs.Arg(0), `\`, "") // zsh escapes ? and = when pasting
	if cfg.SpotifyID == "" || cfg.SpotifySecret == "" {
		return errors.New("SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET are not set (see README)")
	}
	eng := engine.New(cfg)

	fmt.Println("Reading the video…")
	video, uploaded, err := eng.YT.InfoFull(ctx, link)
	if err != nil {
		return err
	}
	fmt.Printf("YouTube: %s  (%s, %s)\n", video.Title, video.Channel, clock(int(video.DurationSec*1000)))

	var m spotify.Meta
	if *track != "" {
		id := reTrack.FindString(*track)
		if id == "" {
			return fmt.Errorf("not a Spotify track: %s", *track)
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
	fmt.Printf("\nSpotify metadata:\n  Title:   %s\n  Artist:  %s\n  Album:   %s (%s)\n  Date:    %s   Track: %d/%d   Disc: %d\n  Cover:   %s\n  Spotify: %s\n",
		m.Title, m.Artist, m.Album, m.AlbumArtist, m.Date, m.Track, m.Tracks, m.Disc, orDash(m.CoverURL), m.SpotifyURL)
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

// choose searches Spotify and lets the user pick a result (or takes the first with -y).
func choose(ctx context.Context, eng *engine.Engine, query string, videoMs int, auto bool) (spotify.Meta, error) {
	in := bufio.NewReader(os.Stdin)
	for {
		fmt.Printf("\nSearching Spotify: %s\n", query)
		results, err := eng.Spotify.SearchTracks(ctx, query, 0)
		if err != nil {
			return spotify.Meta{}, err
		}
		if len(results) == 0 {
			if auto {
				return spotify.Meta{}, errors.New("Spotify found nothing; try -q \"artist song\"")
			}
			if query = ask(in, "No results. Type another search (empty = cancel): "); query == "" {
				return spotify.Meta{}, errors.New("cancelled")
			}
			continue
		}
		for i, t := range results {
			m := t.Meta()
			warn := ""
			if d := abs(m.DurationMs-videoMs) / 1000; d > 10 {
				warn = fmt.Sprintf("  ⚠ %ds off", d)
			}
			fmt.Printf("  %d. %s — %s  [%s]  %s%s\n", i+1, m.Artist, m.Title, m.Album, clock(m.DurationMs), warn)
		}
		if auto {
			return results[0].Meta(), nil
		}
		switch a := ask(in, "Pick [1], 0 = cancel, or type another search: "); {
		case a == "":
			return results[0].Meta(), nil
		case a == "0":
			return spotify.Meta{}, errors.New("cancelled")
		default:
			if n, err := strconv.Atoi(a); err == nil && n >= 1 && n <= len(results) {
				return results[n-1].Meta(), nil
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
