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
	orders  map[string][]subsonic.Song // the same songs in each order /api/songs offers
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
	sn := &snapshot{at: time.Now(), songs: songs, orders: orderSongs(songs), byTitle: map[string][]subsonic.Song{}}
	for _, song := range songs {
		t := match.Norm(song.Title)
		sn.byTitle[t] = append(sn.byTitle[t], song)
	}
	s.mu.Lock()
	s.lib = sn
	s.mu.Unlock()
	return sn, nil
}

// defaultSongOrder is what /api/songs uses when asked for nothing, or for an order it does not know.
const defaultSongOrder = "added"

// orderSongs prepares every order /api/songs offers. The names are the ones in web/src/lib/sorting.ts. Songs must come
// sorted by title, which is also the last resort of the other orders. Within an album, songs keep the album's order.
func orderSongs(songs []subsonic.Song) map[string][]subsonic.Song {
	type words struct{ artist, album string }
	norm := make(map[string]words, len(songs))
	for _, song := range songs {
		norm[song.ID] = words{match.Norm(song.Artist), match.Norm(song.Album)}
	}
	sorted := func(less func(a, b subsonic.Song) bool) []subsonic.Song {
		out := append([]subsonic.Song(nil), songs...)
		sort.SliceStable(out, func(i, j int) bool { return less(out[i], out[j]) })
		return out
	}
	inAlbum := func(a, b subsonic.Song) bool {
		if a.Disc != b.Disc {
			return a.Disc < b.Disc
		}
		return a.Track < b.Track
	}
	return map[string][]subsonic.Song{
		defaultSongOrder: newestFirst(songs),
		"title":          songs,
		"artist": sorted(func(a, b subsonic.Song) bool {
			x, y := norm[a.ID], norm[b.ID]
			if x.artist != y.artist {
				return x.artist < y.artist
			}
			if x.album != y.album {
				return x.album < y.album
			}
			return inAlbum(a, b)
		}),
		"album": sorted(func(a, b subsonic.Song) bool {
			x, y := norm[a.ID], norm[b.ID]
			if x.album != y.album {
				return x.album < y.album
			}
			if a.AlbumID != b.AlbumID { // two albums with one name stay apart
				return a.AlbumID < b.AlbumID
			}
			return inAlbum(a, b)
		}),
		"length": sorted(func(a, b subsonic.Song) bool { return a.Duration > b.Duration }),
	}
}

// newestFirst orders songs by when they joined the library. Songs with the same date keep the order they came in, and
// songs with no date go last. The dates are parsed because their fractions of a second vary in length, so comparing
// them as text puts "19.3Z" after "19.31Z". With ND_RECENTLYADDEDBYMODTIME on, Navidrome reports the last change to the
// file here, so a song whose tags are rewritten moves up; Subsonic offers no other date.
func newestFirst(songs []subsonic.Song) []subsonic.Song {
	added := make(map[string]time.Time, len(songs))
	for _, song := range songs {
		if when, err := time.Parse(time.RFC3339Nano, song.Created); err == nil {
			added[song.ID] = when
		}
	}
	out := append([]subsonic.Song(nil), songs...)
	sort.SliceStable(out, func(i, j int) bool { return added[out[i].ID].After(added[out[j].ID]) })
	return out
}

// forgetLibrary drops the cache, e.g. after a download finished.
func (s *Server) forgetLibrary() {
	s.mu.Lock()
	s.lib = nil
	s.mu.Unlock()
}
