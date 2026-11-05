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
