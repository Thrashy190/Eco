package server

import (
	"testing"

	"github.com/Thrashy190/eco/internal/subsonic"
)

func TestNewestFirst(t *testing.T) {
	// Real shape of Navidrome's dates: the digits after the second vary, so these two sort backwards as text
	songs := []subsonic.Song{
		{ID: "no date"},
		{ID: "older", Created: "2026-11-02T21:25:18.3Z"},
		{ID: "tied 1", Created: "2026-11-03T10:00:00Z"},
		{ID: "tied 2", Created: "2026-11-03T10:00:00Z"},
		{ID: "newest", Created: "2026-11-05T06:21:19.31Z"},
		{ID: "newer", Created: "2026-11-05T06:21:19.3Z"},
	}
	want := []string{"newest", "newer", "tied 1", "tied 2", "older", "no date"}
	got := newestFirst(songs)
	for i, id := range want {
		if got[i].ID != id {
			t.Fatalf("position %d is %q, want %q (all: %v)", i, got[i].ID, id, got)
		}
	}
	if songs[0].ID != "no date" {
		t.Error("the alphabetical list the other lookups read was reordered")
	}
}

func TestOrderSongs(t *testing.T) {
	// Come sorted by title, as library() hands them over. The discs of an album must not mix: a real double album
	// has a track 1 on each.
	songs := []subsonic.Song{
		{ID: "bonus", Title: "Bonus", Artist: "Zoé", Album: "Reptilectric", AlbumID: "r", Disc: 2, Track: 1, Duration: 100, Created: "2026-11-01T00:00:00Z"},
		{ID: "long", Title: "Long Song", Artist: "Ana", Album: "Other", AlbumID: "o", Disc: 1, Track: 1, Duration: 900, Created: "2026-11-05T00:00:00Z"},
		{ID: "second", Title: "Second", Artist: "Zoé", Album: "Reptilectric", AlbumID: "r", Disc: 1, Track: 2, Duration: 200, Created: "2026-11-03T00:00:00Z"},
		{ID: "first", Title: "Zero First", Artist: "Zoe", Album: "Reptilectric", AlbumID: "r", Disc: 1, Track: 1, Duration: 300, Created: "2026-11-02T00:00:00Z"},
	}
	want := map[string][]string{
		"added":  {"long", "second", "first", "bonus"},
		"title":  {"bonus", "long", "second", "first"},
		"artist": {"long", "first", "second", "bonus"}, // "Zoé" and "Zoe" are one artist
		"album":  {"long", "first", "second", "bonus"},
		"length": {"long", "first", "second", "bonus"},
	}
	orders := orderSongs(songs)
	if len(orders) != len(want) {
		t.Fatalf("%d orders, want %d", len(orders), len(want))
	}
	for name, ids := range want {
		for i, id := range ids {
			if orders[name][i].ID != id {
				t.Errorf("%s: position %d is %q, want %q", name, i, orders[name][i].ID, id)
			}
		}
	}
	if songs[0].ID != "bonus" {
		t.Error("the list by title that the other lookups read was reordered")
	}
}
