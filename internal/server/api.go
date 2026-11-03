package server

import (
	"context"
	"net/http"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/Thrashy190/eco/internal/engine"
	"github.com/Thrashy190/eco/internal/jobs"
	"github.com/Thrashy190/eco/internal/match"
	"github.com/Thrashy190/eco/internal/spotify"
	"github.com/Thrashy190/eco/internal/subsonic"
)

// ---- JSON shapes (what the web app receives) ----

type songOut struct {
	ID       string `json:"id"`
	Title    string `json:"title"`
	Artist   string `json:"artist"`
	ArtistID string `json:"artist_id,omitempty"`
	Album    string `json:"album"`
	AlbumID  string `json:"album_id,omitempty"`
	Duration int    `json:"duration"`
	Cover    string `json:"cover,omitempty"`
	Starred  string `json:"starred,omitempty"` // when it was favourited
}

type artistOut struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	Cover      string `json:"cover,omitempty"`
	AlbumCount int    `json:"album_count"`
}

type albumOut struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Artist    string `json:"artist"`
	ArtistID  string `json:"artist_id,omitempty"`
	Cover     string `json:"cover,omitempty"`
	SongCount int    `json:"song_count"`
	Year      int    `json:"year,omitempty"`
}

// externalOut is a song that is not in the library yet and can be downloaded.
type externalOut struct {
	SpotifyID string `json:"spotify_id"`
	Title     string `json:"title"`
	Artist    string `json:"artist"`
	Album     string `json:"album"`
	Duration  int    `json:"duration"`
	CoverURL  string `json:"cover_url,omitempty"`
}

func songsOut(in []subsonic.Song) []songOut {
	out := make([]songOut, len(in))
	for i, s := range in {
		out[i] = songOut{s.ID, s.Title, s.Artist, s.ArtistID, s.Album, s.AlbumID, s.Duration, s.CoverArt, s.Starred}
	}
	return out
}

func albumsOut(in []subsonic.Album) []albumOut {
	out := make([]albumOut, len(in))
	for i, a := range in {
		out[i] = albumOut{a.ID, a.Name, a.Artist, a.ArtistID, a.CoverArt, a.SongCount, a.Year}
	}
	return out
}

// ---- Spotify results that are not in the library ----

// external turns Spotify tracks into download candidates, dropping what the library already has,
// duplicates, and anything in skip (keys already listed).
func external(tracks []spotify.Track, lib *snapshot, seen map[string]bool) []externalOut {
	var out []externalOut
	for _, t := range tracks {
		m := t.Meta()
		key := match.Norm(m.Title) + "|" + match.FirstArtist(m.Artist)
		if seen[key] || (lib != nil && lib.has(m.Title, m.Artist)) {
			continue
		}
		seen[key] = true
		out = append(out, externalOut{t.ID, m.Title, m.Artist, m.Album, m.DurationMs / 1000, m.CoverURL})
	}
	return out
}

// artistTracks lists Spotify tracks credited to the artist called name (up to three pages).
func (s *Server) artistTracks(ctx context.Context, name string) []spotify.Track {
	var out []spotify.Track
	want := match.Norm(name)
	for offset := 0; offset < 3*spotify.PageSize; offset += spotify.PageSize {
		page, err := s.eng.Spotify.SearchTracks(ctx, `artist:"`+name+`"`, offset)
		if err != nil || len(page) == 0 {
			break
		}
		for _, t := range page {
			for _, a := range t.Artists {
				if match.Norm(a.Name) == want {
					out = append(out, t)
					break
				}
			}
		}
	}
	return out
}

// artistMatch returns the Spotify artist a query is clearly asking for, if any.
func artistMatch(query string, artists []spotify.Artist) (string, bool) {
	q := match.Norm(query)
	if len(q) < 3 {
		return "", false
	}
	for _, a := range artists {
		if n := match.Norm(a.Name); n == q || strings.HasPrefix(n, q+" ") {
			return a.Name, true
		}
	}
	return "", false
}

// ---- Handlers ----

func (s *Server) search(w http.ResponseWriter, r *http.Request, cred subsonic.Cred) {
	q := strings.TrimSpace(r.URL.Query().Get("q"))
	resp := map[string]any{"songs": []songOut{}, "artists": []artistOut{}, "external": []externalOut{}}
	if len([]rune(q)) < 2 {
		respond(w, http.StatusOK, resp)
		return
	}
	var (
		wg        sync.WaitGroup
		local     subsonic.SearchResult
		lib       *snapshot
		tracks    []spotify.Track
		artists   []spotify.Artist
		errLocal  error
		errLib    error
		errSpot   error
		spotifyOK = s.cfg.SpotifyID != ""
	)
	wg.Add(3)
	go func() { defer wg.Done(); local, errLocal = s.nd.Search(r.Context(), cred, q, 30, 0, 8) }()
	go func() { defer wg.Done(); lib, errLib = s.library(r.Context(), cred) }()
	go func() {
		defer wg.Done()
		if !spotifyOK {
			return
		}
		tracks, errSpot = s.eng.Spotify.SearchTracks(r.Context(), q, 0)
		if errSpot == nil {
			artists, _ = s.eng.Spotify.SearchArtists(r.Context(), q)
		}
	}()
	wg.Wait()
	if errLocal != nil {
		fail(w, http.StatusBadGateway, "Navidrome: "+errLocal.Error())
		return
	}
	if errLib != nil {
		lib = nil // still useful without the "already owned" filter
	}

	resp["songs"] = songsOut(local.Songs)
	arts := make([]artistOut, len(local.Artists))
	for i, a := range local.Artists {
		arts[i] = artistOut{a.ID, a.Name, a.CoverArt, a.AlbumCount}
	}
	resp["artists"] = arts

	seen := map[string]bool{}
	ext := external(tracks, lib, seen)
	if name, ok := artistMatch(q, artists); ok { // searching an artist: also list their other songs
		ext = append(ext, external(s.artistTracks(r.Context(), name), lib, seen)...)
	}
	if len(ext) > 40 {
		ext = ext[:40]
	}
	resp["external"] = ext
	switch {
	case !spotifyOK:
		resp["warning"] = "Set SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET to search beyond your library."
	case errSpot != nil:
		resp["warning"] = "Could not search beyond your library: " + errSpot.Error()
	}
	respond(w, http.StatusOK, resp)
}

// discover lists songs by an artist that the library does not have yet.
func (s *Server) discover(w http.ResponseWriter, r *http.Request, cred subsonic.Cred) {
	name := strings.TrimSpace(r.URL.Query().Get("artist"))
	if name == "" {
		fail(w, http.StatusBadRequest, "artist is required")
		return
	}
	lib, _ := s.library(r.Context(), cred)
	ext := external(s.artistTracks(r.Context(), name), lib, map[string]bool{})
	if ext == nil {
		ext = []externalOut{}
	}
	respond(w, http.StatusOK, map[string]any{"external": ext})
}

// home gathers what the start page shows, in parallel.
func (s *Server) home(w http.ResponseWriter, r *http.Request, cred subsonic.Cred) {
	var (
		wg                       sync.WaitGroup
		newest, recent, frequent []subsonic.Album
		random                   []subsonic.Song
	)
	ctx := r.Context()
	wg.Add(4)
	go func() { defer wg.Done(); newest, _ = s.nd.AlbumList(ctx, cred, "newest", 12) }()
	go func() { defer wg.Done(); recent, _ = s.nd.AlbumList(ctx, cred, "recent", 12) }()
	go func() { defer wg.Done(); frequent, _ = s.nd.AlbumList(ctx, cred, "frequent", 12) }()
	go func() { defer wg.Done(); random, _ = s.nd.RandomSongs(ctx, cred, 12) }()
	wg.Wait()

	var fresh []jobs.Job
	for _, j := range s.jobs.List() {
		if j.State == jobs.Ready {
			fresh = append(fresh, j)
		}
	}
	sort.Slice(fresh, func(a, b int) bool { return fresh[a].FinishedAt > fresh[b].FinishedAt })
	if len(fresh) > 10 {
		fresh = fresh[:10]
	}
	respond(w, http.StatusOK, map[string]any{
		"newest": albumsOut(newest), "recent": albumsOut(recent), "frequent": albumsOut(frequent),
		"random_songs": songsOut(random), "downloads": nonNil(fresh),
	})
}

func nonNil(j []jobs.Job) []jobs.Job {
	if j == nil {
		return []jobs.Job{}
	}
	return j
}

// songs lists the whole library alphabetically, a page at a time.
func (s *Server) songs(w http.ResponseWriter, r *http.Request, cred subsonic.Cred) {
	lib, err := s.library(r.Context(), cred)
	if err != nil {
		fail(w, http.StatusBadGateway, "Navidrome: "+err.Error())
		return
	}
	offset, _ := strconv.Atoi(r.URL.Query().Get("offset"))
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	if limit <= 0 || limit > 300 {
		limit = 100
	}
	offset = min(max(offset, 0), len(lib.songs))
	end := min(offset+limit, len(lib.songs))
	respond(w, http.StatusOK, map[string]any{"songs": songsOut(lib.songs[offset:end]), "total": len(lib.songs), "has_more": end < len(lib.songs)})
}

var spotifyID = regexp.MustCompile(`^[A-Za-z0-9]{22}$`)

func (s *Server) download(w http.ResponseWriter, r *http.Request, cred subsonic.Cred) {
	if r.Method != http.MethodPost {
		fail(w, http.StatusMethodNotAllowed, "use POST")
		return
	}
	id := r.URL.Query().Get("spotify_id")
	if !spotifyID.MatchString(id) {
		fail(w, http.StatusBadRequest, "invalid spotify_id")
		return
	}
	job, isNew := s.jobs.Submit(id, cred.User, cred)
	code := http.StatusOK
	if isNew {
		code = http.StatusAccepted
	}
	respond(w, code, job)
}

func (s *Server) listJobs(w http.ResponseWriter, _ *http.Request, _ subsonic.Cred) {
	respond(w, http.StatusOK, s.jobs.List())
}

// runJob downloads one song and then waits for Navidrome to index it so the app can play it right away.
func (s *Server) runJob(ctx context.Context, job jobs.Job, payload any, set func(func(*jobs.Job))) error {
	if p, ok := payload.(mediaPayload); ok {
		return s.runMedia(ctx, p, set)
	}
	cred, _ := payload.(subsonic.Cred)
	track, err := s.eng.Spotify.Track(ctx, job.SpotifyID)
	if err != nil {
		return err
	}
	m := track.Meta()
	set(func(j *jobs.Job) { j.Title, j.Artist, j.Album, j.State = m.Title, m.Artist, m.Album, jobs.Searching })

	path, err := s.eng.DownloadSong(ctx, m, func(st engine.Stage, pct float64) {
		set(func(j *jobs.Job) {
			j.State, j.Progress = jobs.State(st), pct
			if st == engine.Done {
				j.State = jobs.Tagging
			}
		})
	})
	if err != nil {
		return err
	}
	set(func(j *jobs.Job) { j.File = path; j.State = jobs.Tagging })
	s.forgetLibrary()

	// Ask Navidrome to scan now and look for the new song, so the app gets an ID it can play.
	scan, cancel := context.WithTimeout(ctx, 25*time.Second)
	defer cancel()
	s.nd.StartScan(scan, cred)
	for scan.Err() == nil {
		time.Sleep(time.Second)
		res, err := s.nd.Search(scan, cred, m.Title, 20, 0, 0)
		if err != nil {
			continue
		}
		for _, song := range res.Songs {
			if match.Norm(song.Title) == match.Norm(m.Title) && match.FirstArtist(song.Artist) != "" && match.FirstArtist(m.Artist) != "" &&
				(match.FirstArtist(song.Artist) == match.FirstArtist(m.Artist) || contains(match.FirstArtist(m.Artist), match.FirstArtist(song.Artist))) {
				set(func(j *jobs.Job) { j.LibraryID = song.ID })
				s.forgetLibrary()
				return nil
			}
		}
	}
	return nil // downloaded; Navidrome will pick it up on its own schedule
}
