package userdata

import (
	"encoding/json"
	"os"
	"path/filepath"
)

// Added is a song someone brought into the library: one they downloaded, or added from a link. The library is shared,
// but who added what belongs to that person: only they see their own list (Library ▸ Songs ▸ Added by you).
type Added struct {
	// SongID is Navidrome's ID, when Navidrome listed the song before the download finished. Without it the song is
	// found by its title, artist and album.
	SongID string `json:"song,omitempty"`
	Title  string `json:"title"`
	Artist string `json:"artist"`
	Album  string `json:"album,omitempty"`
	File   string `json:"file,omitempty"` // where it was saved, inside the music folder
	At     int64  `json:"at"`             // Unix milliseconds
}

// maxAdded is how many songs one person's list keeps: years of downloads, and still a small file.
const maxAdded = 50000

func (s *Store) addedPath(user string) string { return filepath.Join(s.dir(user), "added.json") }

func (s *Store) readAdded(user string) []Added {
	var list []Added
	if data, err := os.ReadFile(s.addedPath(user)); err == nil {
		json.Unmarshal(data, &list) // a damaged file is treated as an empty one
	}
	return list
}

// same reports whether two records are the same song: the same file, or the same song in Navidrome.
func (a Added) same(b Added) bool {
	return (a.File != "" && a.File == b.File) || (a.SongID != "" && a.SongID == b.SongID)
}

// AddSong remembers a song this person added. Adding the same one again keeps the first date, and learns its ID if the
// first record lacked it.
func (s *Store) AddSong(user string, song Added) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	list := s.readAdded(user)
	for i := range list {
		if list[i].same(song) {
			if list[i].SongID == "" && song.SongID != "" {
				list[i].SongID = song.SongID
				return writeJSON(s.dir(user), "added.json", list)
			}
			return nil
		}
	}
	list = append(list, song)
	if len(list) > maxAdded {
		list = list[len(list)-maxAdded:]
	}
	return writeJSON(s.dir(user), "added.json", list)
}

// AddedSongs lists the songs a person added, the oldest first.
func (s *Store) AddedSongs(user string) []Added {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.readAdded(user)
}

// writeJSON replaces a file of a user's folder atomically, so a crash never leaves half of it behind.
func writeJSON(dir, name string, v any) error {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	data, err := json.Marshal(v)
	if err != nil {
		return err
	}
	tmp, err := os.CreateTemp(dir, "."+name+"-*")
	if err != nil {
		return err
	}
	defer os.Remove(tmp.Name())
	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	return os.Rename(tmp.Name(), filepath.Join(dir, name))
}
