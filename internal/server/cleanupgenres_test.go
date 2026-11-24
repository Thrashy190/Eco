package server

import (
	"context"
	"testing"
	"time"

	"github.com/Thrashy190/eco/internal/subsonic"
)

func TestOnlySongsWithNoGenreAreGivenOneByAlbum(t *testing.T) {
	songs := []subsonic.Song{
		{ID: "1", Title: "Moscow Mule", Album: "Un Verano Sin Ti", AlbumID: "uvst", Artist: "Bad Bunny", AlbumArtist: "Bad Bunny"},
		{ID: "2", Title: "Tití Me Preguntó", Album: "Un Verano Sin Ti", AlbumID: "uvst", Artist: "Bad Bunny", AlbumArtist: "Bad Bunny"},
		{ID: "3", Title: "Me Porto Bonito", Album: "Un Verano Sin Ti", AlbumID: "uvst", Artist: "Bad Bunny • Chencho Corleone", AlbumArtist: "Bad Bunny", Genre: "Reggaeton"},
		{ID: "4", Title: "Espresso", Album: "Espresso", AlbumID: "esp", Artist: "Sabrina Carpenter", Genres: []subsonic.GenreName{{Name: "Pop"}}},
		{ID: "5", Title: "DtMF", Album: "DeBÍ TiRAR MáS FOToS", AlbumID: "dtmf", Artist: "Bad Bunny", AlbumArtist: "Bad Bunny • Someone"},
		{ID: "6", Title: "No album", Artist: "Someone"},
	}
	got := albumsWithoutGenre(songs)
	if len(got) != 2 {
		t.Fatalf("albums = %+v", got)
	}
	// The album with most songs to do comes first; the song that has a genre keeps it
	if got[0].Name != "Un Verano Sin Ti" || len(got[0].Songs) != 2 || got[1].Name != "DeBÍ TiRAR MáS FOToS" {
		t.Errorf("albums = %+v", got)
	}
	// Navidrome shows several album artists as "A • B": the catalogue is asked for the first one
	if got[1].Artist != "Bad Bunny; Someone" {
		t.Errorf("artist = %q", got[1].Artist)
	}
	if n, albums := songsWithoutGenre(songs); n != 3 || albums != 2 {
		t.Errorf("%d songs on %d albums", n, albums)
	}
}

type busyGenres struct{ asked, busyFor int }

type stillBusy struct{}

func (stillBusy) Error() string { return "busy" }
func (stillBusy) Busy()         {}

func (b *busyGenres) AlbumGenres(context.Context, string, string) ([]string, error) {
	b.asked++
	if b.asked <= b.busyFor {
		return nil, stillBusy{}
	}
	return []string{"Rock"}, nil
}

// A long run must not lose albums to a minute when MusicBrainz is busy: it waits and asks again, but not forever.
func TestABusyCatalogueIsAskedAgain(t *testing.T) {
	finder := &busyGenres{busyFor: 1}
	got, err := albumGenres(context.Background(), finder, genreAlbum{Name: "A", Artist: "B"}, time.Millisecond)
	if err != nil || len(got) != 1 || finder.asked != 2 {
		t.Errorf("got %q, %v after %d tries", got, err, finder.asked)
	}
	finder = &busyGenres{busyFor: 10}
	if _, err := albumGenres(context.Background(), finder, genreAlbum{Name: "A", Artist: "B"}, time.Millisecond); err == nil || finder.asked != genreTries {
		t.Errorf("err = %v after %d tries", err, finder.asked)
	}
}
