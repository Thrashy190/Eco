package server

import (
	"encoding/json"
	"net/http"
	"net/url"
	"strings"
	"testing"
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
