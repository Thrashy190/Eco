// Package catalog describes what eco needs from a music catalogue: finding songs and albums that are not in the
// library yet, and the metadata written into the files it downloads. The source behind it can change (see Source).
package catalog

import (
	"context"
	"errors"
	"strings"
)

// Meta is the flattened metadata that gets written into audio tags and CSV rows. Artist and AlbumArtist are for people
// and folder names; Artists and AlbumArtists keep the names apart when the source knows them, so a name that contains a
// comma is never mistaken for two artists.
type Meta struct {
	Title, Artist, AlbumArtist, Album, Date string
	Artists, AlbumArtists                   []string
	Track, Tracks, Disc, DurationMs         int
	ISRC, CoverURL, SourceURL               string
}

// Track is a song in the catalogue. ID is whatever Source.Track needs to find it again.
type Track struct {
	ID string
	Meta
}

// Album is an album in the catalogue. Tracks is only filled by Source.Album and Source.FindAlbum.
type Album struct {
	ID          string
	Name        string
	Artists     []string
	Type        string // album, single, ep or compilation
	Date        string
	TotalTracks int
	CoverURL    string
	Tracks      []Track
}

// Artist returns the album's artists as one string.
func (a Album) Artist() string { return strings.Join(a.Artists, ", ") }

// Results is what a free-text search finds.
type Results struct {
	Tracks []Track
	Albums []Album
	// Artist is set when the search is clearly asking for one artist: Tracks then also lists their other songs.
	Artist string
}

// Source is a music catalogue. Nothing may wait on one to show the library: callers use a short timeout.
type Source interface {
	// Name is how the source is called on screen.
	Name() string
	// Ready returns an error saying what is missing when the source cannot be used.
	Ready() error
	// ValidID reports whether id could have come from this source. IDs reach the server from the web app.
	ValidID(id string) bool
	Search(ctx context.Context, query string) (Results, error)
	Track(ctx context.Context, id string) (Track, error)
	Album(ctx context.Context, id string) (Album, error)
	// FindAlbum looks for the album with this name by this artist. The boolean is false when there is none.
	FindAlbum(ctx context.Context, name, artist string) (Album, bool, error)
	// FindTrack looks for one song, for a list imported from elsewhere. Any field but title and artist may be empty.
	// The boolean is false when nothing is close enough: a wrong song in a library is worse than a missing one.
	FindTrack(ctx context.Context, want Wanted) (Track, bool, error)
	// ByArtist lists what the catalogue has by the artist called name.
	ByArtist(ctx context.Context, name string) ([]Track, []Album, error)
}

// Wanted describes a song to look for.
type Wanted struct {
	Title, Artist, Album, ISRC string
	DurationMs                 int
}

// ErrNotFound means the source does not have what was asked for.
var ErrNotFound = errors.New("not in the catalogue")

// Busy is implemented by errors meaning the source asked eco to slow down. Error() is written to be shown to people.
type Busy interface {
	error
	Busy()
}

// IsBusy reports whether err means the source asked eco to slow down.
func IsBusy(err error) bool {
	var busy Busy
	return errors.As(err, &busy)
}
