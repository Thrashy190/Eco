package server

import (
	"context"
	"sort"
	"time"

	"github.com/Thrashy190/eco/internal/match"
	"github.com/Thrashy190/eco/internal/subsonic"
)

const snapshotTTL = 30 * time.Second

// snapshot is a cached copy of every song in the library. It lets eco list the whole library in order,
// and tell instantly whether a Spotify result is already owned, without one Navidrome call per result.
type snapshot struct {
	at      time.Time
	songs   []subsonic.Song            // sorted by title
	byTitle map[string][]subsonic.Song // normalised title → songs with that title
}

// has reports whether the library already holds this title by this artist.
func (sn *snapshot) has(title, artist string) bool {
	_, ok := sn.find(title, artist, "")
	return ok
}

// find returns the library's copy of this title by this artist. A copy on the given album wins over one on
// another album, so a track on an album page links to that album's file when both exist.
func (sn *snapshot) find(title, artist, album string) (subsonic.Song, bool) {
	a := match.FirstArtist(artist)
	wantAlbum := match.Norm(album)
	var found subsonic.Song
	ok := false
	for _, song := range sn.byTitle[match.Norm(title)] {
		owned := match.FirstArtist(song.Artist)
		if owned == "" || a == "" || !(owned == a || contains(owned, a) || contains(a, owned)) {
			continue
		}
		if wantAlbum != "" && match.Norm(song.Album) == wantAlbum {
			return song, true
		}
		if !ok {
			found, ok = song, true
		}
	}
	return found, ok
}

func contains(s, sub string) bool {
	for i := 0; i+len(sub) <= len(s); i++ {
		if s[i:i+len(sub)] == sub {
			return true
		}
	}
	return false
}

// library returns the cached snapshot, rebuilding it when it is older than snapshotTTL.
func (s *Server) library(ctx context.Context, cred subsonic.Cred) (*snapshot, error) {
	s.mu.Lock()
	cached := s.lib
	s.mu.Unlock()
	if cached != nil && time.Since(cached.at) < snapshotTTL {
		return cached, nil
	}
	const page = 500
	var songs []subsonic.Song
	for offset := 0; ; offset += page {
		res, err := s.nd.Search(ctx, cred, "", page, offset, 0, 0)
		if err != nil {
			return nil, err
		}
		songs = append(songs, res.Songs...)
		if len(res.Songs) < page {
			break
		}
	}
	sort.SliceStable(songs, func(i, j int) bool {
		a, b := match.Norm(songs[i].Title), match.Norm(songs[j].Title)
		if a != b {
			return a < b
		}
		return songs[i].Artist < songs[j].Artist
	})
	sn := &snapshot{at: time.Now(), songs: songs, byTitle: map[string][]subsonic.Song{}}
	for _, song := range songs {
		t := match.Norm(song.Title)
		sn.byTitle[t] = append(sn.byTitle[t], song)
	}
	s.mu.Lock()
	s.lib = sn
	s.mu.Unlock()
	return sn, nil
}

// forgetLibrary drops the cache, e.g. after a download finished.
func (s *Server) forgetLibrary() {
	s.mu.Lock()
	s.lib = nil
	s.mu.Unlock()
}
