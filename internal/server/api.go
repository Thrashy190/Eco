package server

import (
	"context"
	"errors"
	"log"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/Thrashy190/eco/internal/catalog"
	"github.com/Thrashy190/eco/internal/engine"
	"github.com/Thrashy190/eco/internal/jobs"
	"github.com/Thrashy190/eco/internal/match"
	"github.com/Thrashy190/eco/internal/subsonic"
	"github.com/Thrashy190/eco/internal/ytdlp"
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
	ID       string `json:"id"`
	Title    string `json:"title"`
	Artist   string `json:"artist"`
	Album    string `json:"album"`
	Duration int    `json:"duration"`
	CoverURL string `json:"cover_url,omitempty"`
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

// ---- Catalogue results that are not in the library ----

// external turns catalogue tracks into download candidates, dropping what the library already has and duplicates.
func external(tracks []catalog.Track, lib *snapshot, seen map[string]bool) []externalOut {
	var out []externalOut
	for _, t := range tracks {
		key := match.Norm(t.Title) + "|" + match.FirstArtist(t.Artist)
		if seen[key] || (lib != nil && lib.has(t.Title, t.Artist)) {
			continue
		}
		seen[key] = true
		out = append(out, externalOut{t.ID, t.Title, t.Artist, t.Album, t.DurationMs / 1000, t.CoverURL})
	}
	return out
}

// ---- Handlers ----

// catalogTimeout is how long anything waits for the catalogue. The library is what matters; a catalogue only adds to
// it. It has to cover MusicBrainz's one request per second, and a slow answer can take seconds.
const catalogTimeout = 15 * time.Second

func catalogContext(r *http.Request) (context.Context, context.CancelFunc) {
	return context.WithTimeout(r.Context(), catalogTimeout)
}

// catalogWarning says in plain words why the results stop at the library.
func (s *Server) catalogWarning(err error) string {
	switch {
	case catalog.IsBusy(err):
		return err.Error() + ". Your library still works."
	case errors.Is(err, context.DeadlineExceeded):
		return "The catalogue is taking too long to answer. Your library still works."
	default:
		return "Could not search beyond your library: " + err.Error()
	}
}

// search looks in the library only. It never waits for the catalogue (see searchExternal), so it answers right away.
func (s *Server) search(w http.ResponseWriter, r *http.Request, cred subsonic.Cred) {
	q := strings.TrimSpace(r.URL.Query().Get("q"))
	if len([]rune(q)) < 2 {
		respond(w, http.StatusOK, map[string]any{"songs": []songOut{}, "artists": []artistOut{}, "albums": []albumOut{}})
		return
	}
	local, err := s.nd.Search(r.Context(), cred, q, 30, 0, 8, 8)
	if err != nil {
		fail(w, http.StatusBadGateway, "Navidrome: "+err.Error())
		return
	}
	arts := make([]artistOut, len(local.Artists))
	for i, a := range local.Artists {
		arts[i] = artistOut{a.ID, a.Name, a.CoverArt, a.AlbumCount}
	}
	respond(w, http.StatusOK, map[string]any{"songs": songsOut(local.Songs), "artists": arts, "albums": albumsOut(local.Albums)})
}

// searchExternal adds what the catalogue has and the library does not. hide_albums names library albums it also
// returned: its page lists every track, so showing both would be a duplicate.
func (s *Server) searchExternal(w http.ResponseWriter, r *http.Request, cred subsonic.Cred) {
	q := strings.TrimSpace(r.URL.Query().Get("q"))
	resp := map[string]any{"external": []externalOut{}, "external_albums": []externalAlbumOut{}, "hide_albums": []string{}}
	if len([]rune(q)) < 2 {
		respond(w, http.StatusOK, resp)
		return
	}
	source := s.eng.Catalog
	if err := source.Ready(); err != nil {
		resp["warning"] = err.Error()
		respond(w, http.StatusOK, resp)
		return
	}
	ctx, cancel := catalogContext(r)
	defer cancel()
	found, errSearch := source.Search(ctx, q)

	lib, err := s.library(r.Context(), cred)
	if err != nil {
		lib = nil // still useful without the "already owned" filter
	}
	ext := external(found.Tracks, lib, map[string]bool{})
	if len(ext) > 40 {
		ext = ext[:40]
	}
	if ext != nil {
		resp["external"] = ext
	}
	extAlbums := externalAlbums(found.Albums)
	resp["external_albums"] = extAlbums
	if local, err := s.nd.Search(r.Context(), cred, q, 0, 0, 0, 8); err == nil {
		resp["hide_albums"] = duplicateAlbums(local.Albums, extAlbums)
	}
	if errSearch != nil {
		resp["warning"] = s.catalogWarning(errSearch)
	}
	respond(w, http.StatusOK, resp)
}

// discover lists what the catalogue has by an artist and the library does not: songs and albums.
func (s *Server) discover(w http.ResponseWriter, r *http.Request, cred subsonic.Cred) {
	name := strings.TrimSpace(r.URL.Query().Get("artist"))
	if name == "" {
		fail(w, http.StatusBadRequest, "artist is required")
		return
	}
	resp := map[string]any{"external": []externalOut{}, "albums": []externalAlbumOut{}}
	source := s.eng.Catalog
	if source.Ready() != nil {
		respond(w, http.StatusOK, resp)
		return
	}
	ctx, cancel := catalogContext(r)
	defer cancel()
	lib, _ := s.library(r.Context(), cred)
	tracks, albums, err := source.ByArtist(ctx, name)
	ext := external(tracks, lib, map[string]bool{})
	if len(ext) > 40 {
		ext = ext[:40]
	}
	if ext != nil {
		resp["external"] = ext
	}
	resp["albums"] = missingAlbums(albums, name, lib)
	if err != nil {
		resp["warning"] = s.catalogWarning(err)
	}
	respond(w, http.StatusOK, resp)
}

// artistLookup finds the library's artist with exactly this name, so a name can be followed to its page.
func (s *Server) artistLookup(w http.ResponseWriter, r *http.Request, cred subsonic.Cred) {
	name := strings.TrimSpace(r.URL.Query().Get("name"))
	if name == "" {
		fail(w, http.StatusBadRequest, "name is required")
		return
	}
	found, err := s.nd.Search(r.Context(), cred, name, 0, 0, 20, 0)
	if err != nil {
		fail(w, http.StatusBadGateway, "Navidrome: "+err.Error())
		return
	}
	for _, a := range found.Artists {
		if match.Norm(a.Name) == match.Norm(name) {
			respond(w, http.StatusOK, map[string]any{"id": a.ID, "name": a.Name})
			return
		}
	}
	respond(w, http.StatusOK, map[string]any{"id": "", "name": name})
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
	for _, j := range s.jobs.List(cred.User) {
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

func (s *Server) download(w http.ResponseWriter, r *http.Request, cred subsonic.Cred) {
	if r.Method != http.MethodPost {
		fail(w, http.StatusMethodNotAllowed, "use POST")
		return
	}
	id := r.URL.Query().Get("id")
	if !s.eng.Catalog.ValidID(id) {
		fail(w, http.StatusBadRequest, "invalid id")
		return
	}
	job, isNew := s.jobs.Submit(id, cred.User, cred)
	code := http.StatusOK
	if isNew {
		code = http.StatusAccepted
	}
	respond(w, code, job)
}

func (s *Server) listJobs(w http.ResponseWriter, _ *http.Request, cred subsonic.Cred) {
	respond(w, http.StatusOK, s.jobs.List(cred.User))
}

// youtubePause is how long downloads stop after YouTube answers "not a bot". Retrying makes it worse, and with a whole
// imported playlist in the queue every song in it would retry.
const youtubePause = 30 * time.Minute

// runJob downloads one song and then waits for Navidrome to index it so the app can play it right away.
func (s *Server) runJob(ctx context.Context, job jobs.Job, payload any, set func(func(*jobs.Job))) error {
	s.mu.Lock()
	paused := time.Now().Before(s.youtubeBlocked)
	s.mu.Unlock()
	if paused {
		return errors.New("YouTube asked eco to stop for a while. Try again later, or set up cookies (see docs/configuration.md)")
	}
	err := s.runDownload(ctx, job, payload, set)
	if err != nil && ytdlp.IsBlocked(err) {
		s.mu.Lock()
		s.youtubeBlocked = time.Now().Add(youtubePause)
		s.mu.Unlock()
	}
	return err
}

func (s *Server) runDownload(ctx context.Context, job jobs.Job, payload any, set func(func(*jobs.Job))) error {
	switch p := payload.(type) {
	case mediaPayload:
		return s.runMedia(ctx, p, set)
	case importPayload:
		m := s.metaForImport(ctx, p.Row)
		err := s.fetchSong(ctx, m, p.Cred, set)
		if err == nil {
			if imp, ok := s.users.Import(p.Cred.User, p.ImportID); ok {
				if _, err := s.syncImport(ctx, p.Cred, imp); err != nil {
					log.Printf("updating the playlist of import %s: %v", imp.Name, err)
				}
			}
		}
		return err
	case subsonic.Cred:
		track, err := s.eng.Catalog.Track(ctx, job.Key)
		if err != nil {
			return err
		}
		return s.fetchSong(ctx, track.Meta, p, set)
	}
	return errors.New("unknown kind of job")
}

// fetchSong downloads one song and waits for Navidrome to list it.
func (s *Server) fetchSong(ctx context.Context, m catalog.Meta, cred subsonic.Cred, set func(func(*jobs.Job))) error {
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
		res, err := s.nd.Search(scan, cred, m.Title, 20, 0, 0, 0)
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
