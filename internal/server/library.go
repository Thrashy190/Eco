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
	songs   []subsonic.Song     // sorted by title
	byTitle map[string][]string // normalised title → normalised first artists
}

// has reports whether the library already holds this title by this artist.
func (sn *snapshot) has(title, artist string) bool {
	a := match.FirstArtist(artist)
	for _, owned := range sn.byTitle[match.Norm(title)] {
		if owned != "" && a != "" && (owned == a || contains(owned, a) || contains(a, owned)) {
			return true
		}
	}
	return false
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
		res, err := s.nd.Search(ctx, cred, "", page, offset, 0)
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
	sn := &snapshot{at: time.Now(), songs: songs, byTitle: map[string][]string{}}
	for _, song := range songs {
		t := match.Norm(song.Title)
		sn.byTitle[t] = append(sn.byTitle[t], match.FirstArtist(song.Artist))
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
