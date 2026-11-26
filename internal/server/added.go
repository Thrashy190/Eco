package server

import (
	"log"
	"path/filepath"
	"slices"
	"strings"
	"time"

	"github.com/Thrashy190/eco/internal/jobs"
	"github.com/Thrashy190/eco/internal/subsonic"
	"github.com/Thrashy190/eco/internal/userdata"
)

// Who added what: each download that joins the library is written down for everyone who asked for it, in their own
// folder (userdata.Added). Library ▸ Songs can then show only the songs a person added. Nobody sees anyone else's list:
// the library is shared, what each person brought into it is theirs.

// rememberAdded writes down a song that just joined the library, for everyone who asked for it. Imported audio (podcasts,
// audiobooks) is not music in Navidrome and stays out.
func (s *Server) rememberAdded(payload any, set func(func(*jobs.Job))) {
	if _, media := payload.(mediaPayload); media {
		return
	}
	var done jobs.Job
	set(func(j *jobs.Job) {
		done = *j
		done.Users = slices.Clone(j.Users)
	})
	if done.File == "" {
		return
	}
	song := userdata.Added{SongID: done.LibraryID, Title: done.Title, Artist: done.Artist, Album: done.Album, File: s.inMusic(done.File), At: time.Now().UnixMilli()}
	if link, ok := payload.(linkPayload); ok && song.Title == "" { // a song added from a link names itself in its payload
		song.Title, song.Artist, song.Album = link.Meta.Title, link.Meta.Artist, link.Meta.Album
	}
	for _, user := range done.Users {
		if err := s.users.AddSong(user, song); err != nil {
			log.Printf("remembering that %s added %q: %v", user, song.Title, err)
		}
	}
}

// inMusic writes a file's path relative to the music folder, so the record survives the folder being mounted elsewhere.
func (s *Server) inMusic(path string) string {
	if rel, err := filepath.Rel(s.cfg.MusicDir, path); err == nil && !strings.HasPrefix(rel, "..") {
		return filepath.ToSlash(rel)
	}
	return path
}

// addedBy keeps, of the songs given and in their order, those this person added. A record with Navidrome's ID counts
// only while that song is there; one without is found by its title, artist and album.
func addedBy(added []userdata.Added, lib *snapshot, songs []subsonic.Song) []subsonic.Song {
	present := make(map[string]bool, len(songs))
	for _, song := range songs {
		present[song.ID] = true
	}
	mine := map[string]bool{}
	for _, a := range added {
		if a.SongID != "" {
			mine[a.SongID] = present[a.SongID]
			continue
		}
		if song, ok := lib.find(a.Title, a.Artist, a.Album); ok {
			mine[song.ID] = true
		}
	}
	out := []subsonic.Song{}
	for _, song := range songs {
		if mine[song.ID] {
			out = append(out, song)
		}
	}
	return out
}
