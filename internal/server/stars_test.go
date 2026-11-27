package server

import (
	"encoding/json"
	"net/http"
	"testing"
)

// The library is copied once for everyone, by whoever asks when the copy is old, and Navidrome marks each song with
// the stars of whoever asked. Lists made from that copy must show the asker's own hearts, never those of whoever filled
// it: Luis's favourites once showed up as Ana's.
func TestSharedLibraryShowsYourOwnStars(t *testing.T) {
	_, h, _ := libraryServer(t, song("a", "Alpha", "X", "One"), song("b", "Beta", "X", "One"))
	as(t, h, "luis", "GET", "/rest/star?id=b", "")
	as(t, h, "ana", "GET", "/rest/star?id=a", "")
	starred := func(user, path string) map[string]bool {
		t.Helper()
		rec := as(t, h, user, "GET", path, "")
		if rec.Code != http.StatusOK {
			t.Fatalf("%s %s: %d %s", user, path, rec.Code, rec.Body)
		}
		var out struct{ Songs []songOut }
		json.Unmarshal(rec.Body.Bytes(), &out)
		got := map[string]bool{}
		for _, song := range out.Songs {
			got[song.ID] = song.Starred != ""
		}
		return got
	}
	if got := starred("luis", "/api/songs"); !got["b"] || got["a"] { // Luis fills the copy
		t.Errorf("luis's songs: %v", got)
	}
	for _, path := range []string{"/api/songs", "/api/artists/songs?name=X"} {
		if got := starred("ana", path); !got["a"] || got["b"] {
			t.Errorf("ana's %s: %v, want only a", path, got)
		}
	}
	// A heart taken away through Eco shows at once, not when the copy is next filled
	as(t, h, "ana", "GET", "/rest/unstar?id=a", "")
	if got := starred("ana", "/api/songs"); got["a"] {
		t.Errorf("after unstarring: %v", got)
	}
}
