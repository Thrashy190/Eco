package server

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"path/filepath"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/Thrashy190/eco/internal/library"
	"github.com/Thrashy190/eco/internal/subsonic"
	"github.com/Thrashy190/eco/internal/tag"
	"github.com/Thrashy190/eco/internal/userdata"
)

// Editing what a song says about itself, for administrators: the library is everyone's. The tags are rewritten in the
// file where it is (tag.Set), never by moving it, so the song keeps its ID, favourites and playlists. A new album or
// album artist makes Navidrome see another album, with an ID of its own.

// songEdit is what the song should say. Only what differs from the file is written.
type songEdit struct {
	Title        string   `json:"title"`
	Artists      []string `json:"artists"`
	Album        string   `json:"album"`
	AlbumArtists []string `json:"album_artists"`
	Date         string   `json:"date"`
	Track        int      `json:"track"`
	Disc         int      `json:"disc"`
	Genre        string   `json:"genre"`
	// WholeAlbum gives the album's other songs the same album, album artist and date, so the album stays one
	WholeAlbum bool `json:"whole_album"`
}

const maxAlbumSongs = 200

func oneLine(s string) string { return strings.Join(strings.Fields(s), " ") }

// cleaned checks an edit and tidies its spaces.
func (e songEdit) cleaned() (songEdit, error) {
	e.Title, e.Album, e.Date, e.Genre = oneLine(e.Title), oneLine(e.Album), strings.TrimSpace(e.Date), oneLine(e.Genre)
	if e.Title == "" {
		return e, errors.New("the song needs a title")
	}
	if e.Album == "" {
		return e, errors.New("the song needs an album")
	}
	if utf8.RuneCountInString(e.Title) > maxNameRunes || utf8.RuneCountInString(e.Album) > maxNameRunes || utf8.RuneCountInString(e.Genre) > maxNameRunes {
		return e, errors.New("that is too long")
	}
	var err error
	if e.Artists, err = cleanNames(e.Artists); err != nil {
		return e, err
	}
	if len(e.Artists) == 0 {
		return e, errors.New("the song needs an artist")
	}
	if e.AlbumArtists, err = cleanNames(e.AlbumArtists); err != nil {
		return e, err
	}
	if e.Date != "" && !datePattern.MatchString(e.Date) {
		return e, errors.New("write the date as a year (2021) or a full date (2021-05-14)")
	}
	if e.Track < 0 || e.Track > 999 || e.Disc < 0 || e.Disc > 99 {
		return e, errors.New("that track or disc number is out of range")
	}
	return e, nil
}

func number(n, total int) string {
	switch {
	case n <= 0:
		return "" // takes the tag away
	case total > 0:
		return strconv.Itoa(n) + "/" + strconv.Itoa(total)
	default:
		return strconv.Itoa(n)
	}
}

// albumChanges is what must change in a file for it to be on the album described.
func albumChanges(now library.SongTags, want songEdit) map[string]string {
	out := map[string]string{}
	if now.Album != want.Album {
		out["album"] = want.Album
	}
	if a := strings.Join(want.AlbumArtists, tag.Separator); strings.Join(now.AlbumArtists, tag.Separator) != a {
		out["album_artist"] = a
	}
	if now.Date != want.Date {
		out["date"] = want.Date
	}
	return out
}

// songChanges is what must change in a file for it to say what the edit says.
func songChanges(now library.SongTags, want songEdit) map[string]string {
	out := albumChanges(now, want)
	if now.Title != want.Title {
		out["title"] = want.Title
	}
	if a := strings.Join(want.Artists, tag.Separator); strings.Join(now.Artists, tag.Separator) != a {
		out["artist"] = a
	}
	if now.Track != want.Track {
		out["track"] = number(want.Track, now.Tracks)
	}
	if now.Disc != want.Disc {
		out["disc"] = number(want.Disc, 0)
	}
	if now.Genre != want.Genre {
		out["genre"] = want.Genre
	}
	return out
}

// songFile finds a song's file and reads its tags.
func (s *Server) songFile(ctx context.Context, cred subsonic.Cred, id string) (subsonic.Song, string, library.SongTags, int, error) {
	song, err := s.nd.Song(ctx, cred, id)
	if err != nil {
		var refused *subsonic.APIError
		if errors.As(err, &refused) {
			return song, "", library.SongTags{}, http.StatusNotFound, errors.New("That song is no longer in the library")
		}
		return song, "", library.SongTags{}, http.StatusBadGateway, errors.New("Navidrome: " + err.Error())
	}
	path, err := library.FindSongFile(s.cfg.MusicDir, song.Size, song.Suffix, song.Title)
	if err != nil {
		return song, "", library.SongTags{}, http.StatusConflict, errors.New("Nothing was changed: " + err.Error())
	}
	tags, err := library.ReadSongTags(path)
	if err != nil {
		return song, "", library.SongTags{}, http.StatusConflict, errors.New("Nothing was changed: " + err.Error())
	}
	return song, path, tags, http.StatusOK, nil
}

// songTags answers what the file of a song says, and how many other songs share its album.
func (s *Server) songTags(w http.ResponseWriter, r *http.Request, cred subsonic.Cred) {
	id := r.PathValue("id")
	if !userdata.ValidID(id) {
		fail(w, http.StatusBadRequest, "invalid song id")
		return
	}
	song, _, tags, code, err := s.songFile(r.Context(), cred, id)
	if err != nil {
		fail(w, code, err.Error())
		return
	}
	others := 0
	if song.AlbumID != "" {
		if _, songs, err := s.nd.Album(r.Context(), cred, song.AlbumID); err == nil {
			others = max(len(songs)-1, 0)
		}
	}
	respond(w, http.StatusOK, map[string]any{"tags": tags, "album_songs": others})
}

// editSong rewrites the tags of a song, and with whole_album the album tags of the songs beside it.
func (s *Server) editSong(w http.ResponseWriter, r *http.Request, cred subsonic.Cred) {
	id := r.PathValue("id")
	if !userdata.ValidID(id) {
		fail(w, http.StatusBadRequest, "invalid song id")
		return
	}
	var body songEdit
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<16)).Decode(&body); err != nil {
		fail(w, http.StatusBadRequest, "invalid body")
		return
	}
	want, err := body.cleaned()
	if err != nil {
		fail(w, http.StatusBadRequest, err.Error())
		return
	}
	if !s.editing.TryLock() {
		fail(w, http.StatusConflict, "Another song is being changed. Try again in a moment")
		return
	}
	defer s.editing.Unlock()
	ctx := r.Context()
	song, path, now, code, err := s.songFile(ctx, cred, id)
	if err != nil {
		fail(w, code, err.Error())
		return
	}
	type change struct {
		title, path string
		fields      map[string]string
	}
	todo := []change{{song.Title, path, songChanges(now, want)}}
	failed := []retagError{}
	if want.WholeAlbum && song.AlbumID != "" {
		_, songs, err := s.nd.Album(ctx, cred, song.AlbumID)
		if err != nil {
			fail(w, http.StatusBadGateway, "Navidrome: "+err.Error())
			return
		}
		if len(songs) > maxAlbumSongs {
			fail(w, http.StatusBadRequest, fmt.Sprintf("That album has more than %d songs", maxAlbumSongs))
			return
		}
		for _, other := range songs {
			if other.ID == song.ID {
				continue
			}
			_, otherPath, otherTags, _, err := s.songFile(ctx, cred, other.ID)
			if err != nil {
				failed = append(failed, retagError{other.Title, err.Error()})
				continue
			}
			todo = append(todo, change{other.Title, otherPath, albumChanges(otherTags, want)})
		}
	}
	backup := filepath.Join(s.cfg.DataDir, "backup", "edits-"+time.Now().Format("2006-01-02-150405"))
	changed := 0
	for i, c := range todo {
		if len(c.fields) == 0 {
			continue
		}
		write, cancel := context.WithTimeout(s.ctx, 2*time.Minute) // a file half done must not be left by a closed request
		err := tag.Set(write, s.cfg.FFmpeg, c.path, c.fields, filepath.Join(backup, library.Rel(s.cfg.MusicDir, c.path)))
		cancel()
		if err != nil {
			if i == 0 {
				fail(w, http.StatusInternalServerError, "Nothing was changed: "+err.Error())
				return
			}
			failed = append(failed, retagError{c.title, err.Error()})
			continue
		}
		changed++
	}
	if changed > 0 {
		log.Printf("admin %s changed the tags of %d songs, starting with %q (backup in %s)", cred.User, changed, song.Title, backup)
		s.rescan(ctx, cred)
		s.forgetLibrary()
	}
	albumID := song.AlbumID
	if fresh, err := s.nd.Song(ctx, cred, id); err == nil {
		albumID = fresh.AlbumID // a new album or album artist is another album for Navidrome
	}
	respond(w, http.StatusOK, map[string]any{"changed": changed, "failed": failed, "album_id": albumID})
}
