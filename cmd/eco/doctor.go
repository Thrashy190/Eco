package main

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"strings"
	"time"

	"github.com/Thrashy190/eco/internal/config"
	"github.com/Thrashy190/eco/internal/engine"
)

// doctor checks everything eco depends on and says how to fix what is missing.
func doctor(ctx context.Context) error {
	cfg := config.Load()
	failed := 0
	check := func(ok bool, required bool, good, bad string) {
		switch {
		case ok:
			fmt.Println("  ✔", good)
		case required:
			fmt.Println("  ✖", bad)
			failed++
		default:
			fmt.Println("  !", bad)
		}
	}
	toolVersion := func(bin string, arg string) (string, bool) {
		out, err := exec.CommandContext(ctx, bin, arg).Output()
		if err != nil {
			return "", false
		}
		first, _, _ := strings.Cut(strings.TrimSpace(string(out)), "\n")
		return first, true
	}

	fmt.Printf("eco %s\n\nTools\n", version)
	v, ok := toolVersion(cfg.YtDlp, "--version")
	check(ok, true, "yt-dlp "+v, "yt-dlp not found: install it from https://github.com/yt-dlp/yt-dlp/releases (or set YTDLP_BIN)")
	v, ok = toolVersion(cfg.FFmpeg, "-version")
	check(ok, true, v, "ffmpeg not found: sudo apt install ffmpeg (or set FFMPEG_BIN)")
	check(len(cfg.JSRuntimes) > 0, true, "JavaScript runtime for yt-dlp: "+strings.Join(cfg.JSRuntimes, ", "),
		"no deno or node on PATH: yt-dlp needs one to solve YouTube's challenges (install deno or nodejs)")

	fmt.Println("\nServices")
	client := &http.Client{Timeout: 5 * time.Second}
	resp, err := client.Get(cfg.NavidromeURL + "/rest/ping")
	if err == nil {
		resp.Body.Close()
	}
	check(err == nil, true, "Navidrome answers at "+cfg.NavidromeURL, "Navidrome is not reachable at "+cfg.NavidromeURL+" (set ECO_NAVIDROME_URL)")
	source := engine.New(cfg).Catalog
	ready, missing := source.Ready(), ""
	if ready != nil {
		missing = ready.Error()
	}
	check(ready == nil, false, "catalogue: "+source.Name(), missing)
	check(cfg.SpotifyID != "" && cfg.SpotifySecret != "", false, "Spotify credentials are set",
		"SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET are not set: only `eco likes export` and `eco get -s` need them")

	fmt.Println("\nLibrary")
	_, err = os.Stat(cfg.MusicDir)
	check(err == nil, false, "music folder: "+cfg.MusicDir, "music folder does not exist yet: "+cfg.MusicDir)
	check(cfg.CookiesBrowser != "" || cfg.CookiesFile != "", false, "YouTube cookies configured",
		"no YouTube cookies (YT_COOKIES_BROWSER or YT_COOKIES_FILE): fine to start, but YouTube may ask for a sign-in after many downloads")

	if failed > 0 {
		return fmt.Errorf("%d required item(s) missing", failed)
	}
	fmt.Println("\nAll set.")
	return nil
}
