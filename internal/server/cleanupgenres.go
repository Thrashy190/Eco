package server

import (
	"context"
	"errors"
	"log"
	"net/http"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/Thrashy190/eco/internal/catalog"
	"github.com/Thrashy190/eco/internal/library"
	"github.com/Thrashy190/eco/internal/subsonic"
	"github.com/Thrashy190/eco/internal/tag"
)

// Genres for songs already in the library. Downloads get theirs from the catalogue with the rest of their tags; songs
// that came before (or from elsewhere) have none, so Navidrome shows no genres and statistics cannot say what people
// like. Asking the catalogue song by song would take hours at MusicBrainz's one request per second, so it is asked once
// per album, and every song of the album without a genre gets the album's. Songs that have a genre keep it.

// genreAlbum is an album with songs that have no genre.
type genreAlbum struct {
	Name, Artist string
	Songs        []subsonic.Song
}

// catalogArtist turns how Navidrome shows an artist into a name the catalogue can look for: "A • B" becomes "A; B", so
// catalog.FirstName finds "A".
func catalogArtist(song subsonic.Song) string {
	artist := song.AlbumArtist
	if artist == "" {
		artist = song.Artist
	}
	return strings.ReplaceAll(artist, " • ", "; ")
}

// albumsWithoutGenre groups the songs with no genre by album, the biggest albums first, so the first minutes of a long
// run already cover most songs.
func albumsWithoutGenre(songs []subsonic.Song) []genreAlbum {
	byID := map[string]*genreAlbum{}
	var order []string
	for _, song := range songs {
		if len(song.GenreList()) > 0 || song.Album == "" {
			continue
		}
		a, ok := byID[song.AlbumID]
		if !ok {
			a = &genreAlbum{Name: song.Album, Artist: catalogArtist(song)}
			byID[song.AlbumID] = a
			order = append(order, song.AlbumID)
		}
		a.Songs = append(a.Songs, song)
	}
	out := make([]genreAlbum, 0, len(order))
	for _, id := range order {
		out = append(out, *byID[id])
	}
	sort.SliceStable(out, func(i, j int) bool { return len(out[i].Songs) > len(out[j].Songs) })
	return out
}

// songsWithoutGenre counts what albumsWithoutGenre would give a genre to.
func songsWithoutGenre(songs []subsonic.Song) (songCount, albumCount int) {
	for _, a := range albumsWithoutGenre(songs) {
		songCount += len(a.Songs)
		albumCount++
	}
	return songCount, albumCount
}

// cleanupGenres starts giving genres to the songs that have none. Like the artist clean-up it keeps a copy of every file
// it changes and only replaces one once the audio of the new file is proven identical (tag.Set). Only the genre tag is
// added; the path stays, so songs keep their IDs, favourites and playlists.
func (s *Server) cleanupGenres(w http.ResponseWriter, r *http.Request, cred subsonic.Cred) {
	finder, ok := s.eng.Catalog.(catalog.GenreFinder)
	if !ok {
		fail(w, http.StatusConflict, s.eng.Catalog.Name()+" cannot say an album's genres")
		return
	}
	songs, err := s.nd.AllSongs(r.Context(), cred)
	if err != nil {
		fail(w, http.StatusBadGateway, "Navidrome: "+err.Error())
		return
	}
	albums := albumsWithoutGenre(songs)
	total := 0
	for _, a := range albums {
		total += len(a.Songs)
	}
	if total == 0 {
		fail(w, http.StatusBadRequest, "Every song already has a genre")
		return
	}
	backup := filepath.Join(s.cfg.DataDir, "backup", "genres-"+time.Now().Format("2006-01-02-150405"))
	ctx, cancel := context.WithCancel(s.ctx)
	s.mu.Lock()
	if s.retag.Running {
		s.mu.Unlock()
		cancel()
		fail(w, http.StatusConflict, "A clean-up is already running")
		return
	}
	s.retag = retagTask{Kind: "genres", Running: true, Total: total, Failed: []retagError{}, Backup: library.Rel(s.cfg.DataDir, backup)}
	s.stopRetag = cancel
	task := s.retag
	s.mu.Unlock()
	log.Printf("admin %s is adding genres to %d songs on %d albums (backup in %s)", cred.User, total, len(albums), backup)
	go s.runGenres(ctx, cancel, cred, finder, albums, backup)
	respond(w, http.StatusAccepted, task)
}

// stopCleanup stops a clean-up between two songs. What was done stays done.
func (s *Server) stopCleanup(w http.ResponseWriter, _ *http.Request, _ subsonic.Cred) {
	s.mu.Lock()
	if s.retag.Running && s.stopRetag != nil {
		s.stopRetag()
	}
	task := s.retag
	s.mu.Unlock()
	respond(w, http.StatusOK, task)
}

// genreTries is how often an album is asked again when the catalogue is busy, a minute apart.
const genreTries = 3

// albumGenres asks the catalogue, waiting when it asks to slow down: a long run must not lose albums to a busy minute.
func albumGenres(ctx context.Context, finder catalog.GenreFinder, a genreAlbum, pause time.Duration) ([]string, error) {
	var err error
	for try := 0; try < genreTries; try++ {
		ask, cancel := context.WithTimeout(ctx, 2*time.Minute)
		var genres []string
		genres, err = finder.AlbumGenres(ask, a.Name, a.Artist)
		cancel()
		if err == nil || ctx.Err() != nil || !catalog.IsBusy(err) {
			return genres, err
		}
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-time.After(pause):
		}
	}
	return nil, err
}

func (s *Server) runGenres(ctx context.Context, cancel context.CancelFunc, cred subsonic.Cred, finder catalog.GenreFinder, albums []genreAlbum, backup string) {
	defer cancel()
	files := library.IndexFiles(s.cfg.MusicDir)
	for _, a := range albums {
		if ctx.Err() != nil {
			break
		}
		genres, err := albumGenres(ctx, finder, a, time.Minute)
		if ctx.Err() != nil {
			break
		}
		for _, song := range a.Songs {
			songErr := err
			if songErr == nil && len(genres) > 0 {
				songErr = s.addGenre(ctx, files, song, genres, backup)
			}
			s.mu.Lock()
			s.retag.Done++
			switch {
			case songErr != nil:
				s.retag.Failed = append(s.retag.Failed, retagError{song.Title, songErr.Error()})
			case len(genres) == 0:
				s.retag.Unknown++
			}
			s.mu.Unlock()
		}
	}
	s.rescan(s.ctx, cred)
	s.forgetLibrary()
	s.mu.Lock()
	s.retag.Running = false
	s.retag.Stopped = ctx.Err() != nil && s.ctx.Err() == nil
	s.stopRetag = nil
	log.Printf("genre clean-up finished: %d of %d songs, %d with no genre known, %d failed", s.retag.Done, s.retag.Total, s.retag.Unknown, len(s.retag.Failed))
	s.mu.Unlock()
}

// addGenre writes the genre tag of one song. The file is found as everywhere else (exact size and extension, the title
// in its tags), and left alone unless exactly one file matches.
func (s *Server) addGenre(ctx context.Context, files *library.Files, song subsonic.Song, genres []string, backup string) error {
	path, ok := files.Find(song.Size, song.Suffix, song.Title)
	if !ok {
		return errors.New("its file could not be told apart from the others")
	}
	// Written by hand or by another app since Navidrome last looked: what is in the file stays
	if tags, err := library.ReadSongTags(path); err == nil && tags.Genre != "" {
		return nil
	}
	write, cancel := context.WithTimeout(ctx, 2*time.Minute)
	defer cancel()
	saved := filepath.Join(backup, library.Rel(s.cfg.MusicDir, path))
	return tag.Set(write, s.cfg.FFmpeg, path, map[string]string{"genre": strings.Join(genres, tag.Separator)}, saved)
}
