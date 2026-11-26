package server

import (
	"encoding/json"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/Thrashy190/eco/internal/subsonic"
)

// "Buurman Uit Berlijn" by MCR-T and Joost showed on MCR-T's page and not on Joost's: Navidrome lists an artist's
// albums, and the tag names both as one artist. Every artist a song names should find it.
func TestArtistSongsIncludeFeaturedArtists(t *testing.T) {
	buurman := song("buurman", "Buurman Uit Berlijn", "MCR-T, Joost", "Buurman Uit Berlijn")
	buurman["displayAlbumArtist"] = "MCR-T"
	_, h, _ := libraryServer(t,
		buurman,
		song("joost", "Wachtrij", "Joost", "Fissa"),
		song("diran", "Diran De Mi", "Natanael Cano; Tito Torbellino Jr", "Diran De Mi"),
		song("earfquake", "Earfquake", "Tyler, The Creator", "IGOR"),
		song("other", "Other", "Somebody", "Elsewhere"),
	)
	byArtist := func(name string) string {
		rec := as(t, h, "ana", "GET", "/api/artists/songs?name="+url.QueryEscape(name), "")
		if rec.Code != http.StatusOK {
			t.Fatalf("%s: %d %s", name, rec.Code, rec.Body)
		}
		var out struct {
			Songs []struct {
				ID string `json:"id"`
			} `json:"songs"`
		}
		json.Unmarshal(rec.Body.Bytes(), &out)
		var ids []string
		for _, s := range out.Songs {
			ids = append(ids, s.ID)
		}
		return strings.Join(ids, ",")
	}
	for name, want := range map[string]string{
		"Joost":              "buurman,joost", // by album: Buurman Uit Berlijn, then Fissa
		"joost":              "buurman,joost",
		"MCR-T":              "buurman",
		"Tito Torbellino Jr": "diran",
		"Natanael Cano":      "diran",
		"Tyler, The Creator": "earfquake",
		"The Creator":        "", // a comma inside a name is not a list of artists
		"Nobody":             "",
	} {
		if got := byArtist(name); got != want {
			t.Errorf("%s: got %q, want %q", name, got, want)
		}
	}
}

func TestPopularSongsAreTheMostPlayedThenAlbumOrder(t *testing.T) {
	track := func(id, title string, seconds int) subsonic.Song {
		return subsonic.Song{ID: id, Title: title, Duration: seconds}
	}
	ids := func(songs []subsonic.Song, plays map[string]int, n int) string {
		return strings.Join(popular(songs, plays, n), ",")
	}
	songs := []subsonic.Song{
		track("intro1", "Intro", 60), track("a", "A", 200), track("b", "B", 180), track("x-album", "X", 201),
		track("intro2", "Intro", 95), track("c", "C", 240), track("x-single", "x ", 200), track("d", "D", 210),
	}
	// The single and the album's X are one song: 3 + 4 plays put it first, shown as the album's copy, which has more.
	// The two Intros are different songs (different lengths); nobody played B, D or the second Intro.
	plays := map[string]int{"x-single": 3, "x-album": 4, "c": 5, "a": 2, "intro1": 1}
	if got, want := ids(songs, plays, 10), "x-album,c,a,intro1,b,intro2,d"; got != want {
		t.Errorf("popular = %s, want %s", got, want)
	}
	if got, want := ids(songs, plays, 3), "x-album,c,a"; got != want {
		t.Errorf("top 3 = %s, want %s", got, want)
	}
	// Nothing played yet: the first songs in album order
	if got, want := ids(songs, nil, 4), "intro1,a,b,x-album"; got != want {
		t.Errorf("no plays = %s, want %s", got, want)
	}
	if got := ids(nil, plays, 10); got != "" {
		t.Errorf("no songs = %q", got)
	}
}

// The popular songs count everyone's plays, but the answer only holds their order. Songs nobody played fill the list,
// the artist's own before the ones they appear on, even on an album that comes first.
func TestArtistSongsListThePopularOnesByEveryonesPlays(t *testing.T) {
	own := func(id, title string) map[string]any {
		s := song(id, title, "Joost", "Fissa")
		s["displayAlbumArtist"] = "Joost"
		return s
	}
	feat := song("feat", "Feat", "Somebody; Joost", "Aardvark")
	feat["displayAlbumArtist"] = "Somebody"
	_, h, cfg := libraryServer(t, own("one", "One"), own("two", "Two"), own("three", "Three"), feat, song("other", "Other", "Somebody", "Elsewhere"))
	os.MkdirAll(cfg.StatsDir, 0o755)
	lines := []string{
		`{"at":"2026-11-20T20:00:00Z","user":"ana","song":"three","title":"Three","artists":["Joost"],"duration":200}`,
		`{"at":"2026-11-21T20:00:00Z","user":"luis","song":"three","title":"Three","artists":["Joost"],"duration":200}`,
		`{"at":"2026-11-22T20:00:00Z","user":"luis","song":"two","title":"Two","artists":["Joost"],"duration":200}`,
		`{"at":"2026-11-22T20:10:00Z","user":"luis","song":"other","title":"Other","artists":["Somebody"],"duration":200}`,
	}
	if err := os.WriteFile(filepath.Join(cfg.StatsDir, "plays.jsonl"), []byte(strings.Join(lines, "\n")+"\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	rec := as(t, h, "ana", "GET", "/api/artists/songs?name=Joost", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("%d %s", rec.Code, rec.Body)
	}
	var out struct {
		Songs   []json.RawMessage `json:"songs"`
		Popular []string          `json:"popular"`
	}
	json.Unmarshal(rec.Body.Bytes(), &out)
	if got := strings.Join(out.Popular, ","); got != "three,two,one,feat" || len(out.Songs) != 4 {
		t.Errorf("popular = %s with %d songs, want three,two,one,feat with 4", got, len(out.Songs))
	}
	if strings.Contains(rec.Body.String(), "plays") || strings.Contains(rec.Body.String(), "luis") {
		t.Errorf("the answer tells who played what: %s", rec.Body)
	}
}
