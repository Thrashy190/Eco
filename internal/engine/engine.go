// Package engine turns "a song in the catalogue" into "a tagged file in the library":
// find the right video, download its audio, write the tags and cover, put it where it belongs.
// Both the CLI and the web server use it.
package engine

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/Thrashy190/eco/internal/catalog"
	"github.com/Thrashy190/eco/internal/catalog/itunes"
	"github.com/Thrashy190/eco/internal/catalog/musicbrainz"
	"github.com/Thrashy190/eco/internal/config"
	"github.com/Thrashy190/eco/internal/library"
	"github.com/Thrashy190/eco/internal/match"
	"github.com/Thrashy190/eco/internal/spotify"
	"github.com/Thrashy190/eco/internal/tag"
	"github.com/Thrashy190/eco/internal/ytdlp"
)

// Stage is a step of a download, reported to the caller for progress bars.
type Stage string

const (
	Searching   Stage = "searching"
	Downloading Stage = "downloading"
	Tagging     Stage = "tagging"
	Done        Stage = "done"
)

// Codec is the audio container eco writes.
const Codec = "m4a"

// Engine holds the clients every operation needs.
type Engine struct {
	Cfg     *config.Config
	YT      *ytdlp.Runner
	Catalog catalog.Source  // search and song information
	Spotify *spotify.Client // app credentials, for `eco get -s` and CATALOG=spotify
	http    *http.Client
}

// New builds an engine from the configuration.
func New(cfg *config.Config) *Engine {
	client := spotify.New(&spotify.AppCredentials{ID: cfg.SpotifyID, Secret: cfg.SpotifySecret})
	var source catalog.Source = musicbrainz.New(cfg.MusicBrainzURL)
	if cfg.Catalog == "spotify" {
		spot := &spotify.Source{Client: client}
		if cfg.SpotifyID == "" || cfg.SpotifySecret == "" {
			spot.Missing = "CATALOG=spotify needs SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET"
		}
		source = spot
	} else if cfg.CatalogBackup == "itunes" {
		source = &catalog.Fallback{Main: source, Backup: itunes.New(cfg.ITunesCountry)}
	}
	return &Engine{
		Cfg: cfg,
		YT: &ytdlp.Runner{Bin: cfg.YtDlp, CookiesBrowser: cfg.CookiesBrowser,
			CookiesFile: cfg.CookiesFile, JSRuntimes: cfg.JSRuntimes},
		Catalog: source,
		Spotify: client,
		http:    &http.Client{Timeout: 30 * time.Second},
	}
}

// DestDir is the folder downloads are written to.
func (e *Engine) DestDir() string { return filepath.Join(e.Cfg.MusicDir, "YouTube") }

// retry runs fn, waiting and retrying while YouTube answers with a temporary 403/429.
func retry[T any](ctx context.Context, fn func() (T, error)) (T, error) {
	var zero T
	for attempt := 0; ; attempt++ {
		v, err := fn()
		if err == nil || !ytdlp.IsRateLimited(err) || attempt == 3 {
			return v, err
		}
		select {
		case <-time.After(time.Duration(15*(attempt+1)) * time.Second):
		case <-ctx.Done():
			return zero, ctx.Err()
		}
	}
}

// FindVideo looks for the best video for a song. It tries a plain YouTube search first (one cheap call)
// and only asks YouTube Music, which is slower and rate-limited sooner, when that was not conclusive.
// The boolean is false when nothing was found at all.
func (e *Engine) FindVideo(ctx context.Context, song match.Song) (match.Result, bool, error) {
	query := match.SearchQuery(song)
	cands, err := retry(ctx, func() ([]match.Video, error) { return e.YT.Search(ctx, query, 5) })
	if err != nil {
		return match.Result{}, false, err
	}
	if best, ok := match.Best(song, cands); !ok || !best.Clear() {
		if more, err := retry(ctx, func() ([]match.Video, error) { return e.YT.MusicSearch(ctx, query, 2) }); err == nil {
			cands = append(cands, more...)
		}
		// a failing YouTube Music search is not fatal: keep what the plain search found
	}
	best, ok := match.Best(song, cands)
	return best, ok, nil
}

// SongOf describes a song as something to look for.
func SongOf(m catalog.Meta) match.Song {
	return match.Song{Title: m.Title, Artist: m.Artist, DurationSec: float64(m.DurationMs) / 1000}
}

// Fetch downloads link, tags it with m and stores it under destDir. It returns the final path.
// progress receives the audio download percentage (0–100) and may be nil.
func (e *Engine) Fetch(ctx context.Context, link string, m catalog.Meta, destDir string, progress func(Stage, float64)) (string, error) {
	say := func(s Stage, p float64) {
		if progress != nil {
			progress(s, p)
		}
	}
	m = library.JoinAlbum(m, destDir)
	final := library.DestPath(m, Codec, destDir)
	if err := os.MkdirAll(destDir, 0o755); err != nil {
		return "", err
	}
	// The scratch folder lives next to the destination so the final move is a cheap rename;
	// hidden folders are ignored by Navidrome.
	tmp, err := os.MkdirTemp(destDir, ".eco-")
	if err != nil {
		return "", err
	}
	defer os.RemoveAll(tmp)

	say(Downloading, 0)
	audio, err := e.YT.Download(ctx, link, tmp, Codec, func(p float64) { say(Downloading, p) })
	if err != nil {
		return "", err
	}
	say(Tagging, 100)
	cover := e.fetchCover(ctx, m.CoverURL)
	if finder, ok := e.Catalog.(catalog.CoverFinder); ok && len(cover) == 0 { // a volunteer catalogue may have no picture
		find, cancel := context.WithTimeout(ctx, 10*time.Second)
		cover = e.fetchCover(ctx, finder.FindCover(find, m.Album, m.Artist))
		cancel()
	}
	if err := tag.Write(ctx, e.Cfg.FFmpeg, audio, Codec, m, cover); err != nil {
		return "", err
	}
	if err := os.MkdirAll(filepath.Dir(final), 0o755); err != nil {
		return "", err
	}
	if err := os.Rename(audio, final); err != nil {
		return "", err
	}
	if len(cover) > 0 {
		coverFile := filepath.Join(filepath.Dir(final), "cover.jpg")
		if _, err := os.Stat(coverFile); err != nil {
			os.WriteFile(coverFile, cover, 0o644)
		}
	}
	say(Done, 100)
	return final, nil
}

// fetchCover downloads the album art. A missing cover never fails a download.
func (e *Engine) fetchCover(ctx context.Context, link string) []byte {
	if link == "" {
		return nil
	}
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, link, nil)
	resp, err := e.http.Do(req)
	if err != nil {
		return nil
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil
	}
	data, _ := io.ReadAll(io.LimitReader(resp.Body, 10<<20))
	return data
}

// ErrNoMatch means YouTube had no video that matches the song closely enough.
var ErrNoMatch = errors.New("no confident match on YouTube")

// DownloadSong finds a video for m, downloads it and stores it in the library. It returns the final path.
func (e *Engine) DownloadSong(ctx context.Context, m catalog.Meta, progress func(Stage, float64)) (string, error) {
	if progress != nil {
		progress(Searching, 0)
	}
	res, ok, err := e.FindVideo(ctx, SongOf(m))
	if err != nil {
		return "", err
	}
	if !ok || !res.OK() {
		reason := "nothing found"
		if ok {
			reason = fmt.Sprintf("best was %q (%.0fs off %s)", res.Video.Title, res.DiffSec, strings.Join(res.Odd, ", "))
		}
		return "", fmt.Errorf("%w: %s", ErrNoMatch, strings.TrimSpace(reason))
	}
	return e.Fetch(ctx, "https://www.youtube.com/watch?v="+res.Video.ID, m, e.DestDir(), progress)
}

// DownloadTrack is DownloadSong for a song in the catalogue.
func (e *Engine) DownloadTrack(ctx context.Context, trackID string, progress func(Stage, float64)) (catalog.Meta, string, error) {
	t, err := e.Catalog.Track(ctx, trackID)
	if err != nil {
		return catalog.Meta{}, "", err
	}
	path, err := e.DownloadSong(ctx, t.Meta, progress)
	return t.Meta, path, err
}
