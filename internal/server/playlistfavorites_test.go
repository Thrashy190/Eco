package server

import (
	"net/http"
	"strings"
	"testing"
)

// The heart on a playlist makes its songs favourites of whoever taps it, from the bottom up so that Favorites reads like
// the playlist. A song that already is one keeps its date, a song listed twice is starred once, and tapping again
// changes nothing. Someone who cannot see the playlist stars nothing; someone who can (a public playlist) only stars
// their own.
func TestFavoritePlaylist(t *testing.T) {
	fake, h, _ := libraryServer(t, song("a", "Alpha", "X", "One"), song("b", "Beta", "X", "One"), song("c", "Gamma", "X", "Two"), song("d", "Delta", "X", "Two"))
	fake.playlists["mix"] = []string{"a", "b", "c", "b", "d"}
	fake.owner["mix"] = "ana"
	fake.starred = map[string]map[string]bool{"ana": {"c": true}}
	fake.starredAt = map[string]map[string]string{"ana": {"c": "2023-06-01T10:00:00Z"}}
	favorite := func(user, id string) (int, string) {
		rec := as(t, h, user, "POST", "/api/playlists/"+id+"/favorites", "")
		return rec.Code, strings.TrimSpace(rec.Body.String())
	}

	if code, body := favorite("ana", "mix"); code != http.StatusOK || body != `{"added":3,"already":1}` {
		t.Fatalf("first tap: %d %s", code, body)
	}
	if got, want := fake.starLog(), "ana:d,ana:b,ana:a"; got != want {
		t.Errorf("stars: %s, want %s", got, want)
	}
	if code, body := favorite("ana", "mix"); code != http.StatusOK || body != `{"added":0,"already":4}` {
		t.Errorf("second tap: %d %s", code, body)
	}
	if got := fake.starLog(); got != "ana:d,ana:b,ana:a" {
		t.Errorf("the second tap starred again: %s", got)
	}

	if code, _ := favorite("luis", "mix"); code != http.StatusNotFound {
		t.Errorf("luis on ana's private playlist: %d", code)
	}
	if strings.Contains(fake.starLog(), "luis") {
		t.Fatal("luis got favourites from a playlist he cannot see")
	}
	fake.public = map[string]bool{"mix": true}
	if code, body := favorite("luis", "mix"); code != http.StatusOK || body != `{"added":4,"already":0}` {
		t.Errorf("luis on the public playlist: %d %s", code, body)
	}
	if got := len(fake.starred["luis"]); got != 4 {
		t.Errorf("luis has %d favourites, want 4", got)
	}
	if got := strings.Count(fake.starLog(), "ana:"); got != 3 {
		t.Errorf("luis's tap starred songs for ana: %s", fake.starLog())
	}

	if code, _ := favorite("ana", "nope"); code != http.StatusNotFound {
		t.Errorf("a playlist that does not exist: %d", code)
	}
}
