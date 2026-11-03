package itunes

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/Thrashy190/eco/internal/catalog"
)

func songResult(id int64, title, artist, album string, ms int) map[string]any {
	return map[string]any{"wrapperType": "track", "kind": "song", "trackId": id, "collectionId": id * 10, "artistId": 7, "trackName": title, "artistName": artist,
		"collectionName": album, "trackTimeMillis": ms, "trackNumber": 2, "trackCount": 9, "discNumber": 1, "releaseDate": "2024-04-11T12:00:00Z",
		"artworkUrl100": "https://is1.mzstatic.com/x/100x100bb.jpg", "trackViewUrl": "https://music.apple.com/x", "trackExplicitness": "explicit"}
}

func serve(t *testing.T, results ...map[string]any) (*Client, *atomic.Int32) {
	t.Helper()
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		if !strings.Contains(r.Header.Get("User-Agent"), "eco") {
			t.Errorf("User-Agent = %q", r.Header.Get("User-Agent"))
		}
		json.NewEncoder(w).Encode(map[string]any{"resultCount": len(results), "results": results})
	}))
	t.Cleanup(server.Close)
	c := New("mx")
	c.base = server.URL
	return c, &calls
}

func TestSearchCleansWhatAppleAdds(t *testing.T) {
	c, calls := serve(t, songResult(1, "Espresso", "Sabrina Carpenter", "Espresso - Single", 175000))
	got, err := c.Search(context.Background(), "espresso")
	if err != nil {
		t.Fatal(err)
	}
	if len(got.Tracks) != 1 {
		t.Fatalf("tracks = %+v", got.Tracks)
	}
	m := got.Tracks[0]
	if m.ID != "it-1" || m.Album != "Espresso" || m.Date != "2024-04-11" || m.Meta.Track != 2 || m.Tracks != 9 || m.Disc != 1 || m.DurationMs != 175000 || !strings.Contains(m.CoverURL, "600x600") {
		t.Errorf("track = %+v", m)
	}
	if len(got.Albums) != 1 || got.Albums[0].Name != "Espresso" || got.Albums[0].Type != "single" {
		t.Errorf("albums = %+v", got.Albums)
	}
	c.Search(context.Background(), "espresso")
	if calls.Load() != 1 {
		t.Errorf("%d requests for the same question", calls.Load())
	}
}

func TestSearchLeavesOutWhatIsNotTheSong(t *testing.T) {
	cleaned := songResult(2, "One", "Metallica", "...And Justice for All", 446000)
	cleaned["trackExplicitness"] = "cleaned"
	c, _ := serve(t,
		songResult(1, "One (Karaoke Version)", "Karaoke Hits", "Sing Along", 446000),
		songResult(3, "One - Live", "Metallica", "S&M", 500000),
		songResult(4, "One Tribe", "Black Eyed Peas", "The E.N.D.", 200000),
		cleaned,
		songResult(5, "One", "Metallica", "...And Justice for All", 446000),
	)
	got, err := c.Search(context.Background(), "metallica one")
	if err != nil {
		t.Fatal(err)
	}
	if len(got.Tracks) != 1 || got.Tracks[0].ID != "it-5" {
		t.Fatalf("tracks = %+v", got.Tracks)
	}
}

func TestThePlainSongWinsOverItsVersions(t *testing.T) {
	c, _ := serve(t, songResult(1, "Espresso (On Vacation Version)", "Sabrina Carpenter", "Espresso EP", 175000), songResult(2, "Espresso", "Sabrina Carpenter", "Short n' Sweet", 175000))
	got, err := c.Search(context.Background(), "espresso")
	if err != nil || len(got.Tracks) != 1 || got.Tracks[0].ID != "it-2" {
		t.Fatalf("%+v %v", got.Tracks, err)
	}
}

// A wrong song in a library is worse than a missing one.
func TestFindTrackOnlyAcceptsTheSameSong(t *testing.T) {
	want := catalog.Wanted{Title: "Brattiputy", Artist: "Yeri Mua, Uzielito Mix", Album: "Brattiputy", DurationMs: 180000}
	for name, result := range map[string]map[string]any{
		"another artist":  songResult(1, "Brattiputy", "Otra Persona", "x", 180000),
		"another title":   songResult(1, "Brattiputy 2", "Yeri Mua", "x", 180000),
		"another version": songResult(1, "Brattiputy (Remix)", "Yeri Mua", "x", 180000),
		"another length":  songResult(1, "Brattiputy", "Yeri Mua", "x", 240000),
	} {
		c, _ := serve(t, result)
		if got, ok, err := c.FindTrack(context.Background(), want); ok || err != nil {
			t.Errorf("%s accepted: %+v %v", name, got, err)
		}
	}
	single := songResult(1, "Brattiputy", "Yeri Mua & Uzielito Mix", "Otro Disco", 180000)
	right := songResult(2, "Brattiputy", "Yeri Mua, Uzielito Mix & Jey F", "Brattiputy - Single", 181000)
	c, _ := serve(t, single, right)
	got, ok, err := c.FindTrack(context.Background(), want)
	if err != nil || !ok || got.ID != "it-2" {
		t.Errorf("the album they listed should win: %+v %v %v", got, ok, err)
	}
}

func TestAlbumInOrder(t *testing.T) {
	second := songResult(2, "Second", "A", "Album", 1000)
	first := songResult(1, "First", "A", "Album", 1000)
	first["trackNumber"] = 1
	otherDisc := songResult(3, "Other Disc", "A", "Album", 1000)
	otherDisc["discNumber"] = 2
	otherDisc["trackNumber"] = 1
	c, _ := serve(t, map[string]any{"wrapperType": "collection", "collectionId": 50, "collectionName": "Album - EP", "artistName": "A", "artworkUrl100": "https://x/100x100bb.jpg", "trackCount": 3, "releaseDate": "2020-01-01T00:00:00Z"}, otherDisc, second, first)
	album, err := c.Album(context.Background(), "it-50")
	if err != nil {
		t.Fatal(err)
	}
	if album.Name != "Album" || album.Type != "ep" || len(album.Tracks) != 3 || album.Tracks[0].Title != "First" || album.Tracks[2].Title != "Other Disc" {
		t.Errorf("album = %+v", album)
	}
}

func TestValidID(t *testing.T) {
	c := New("")
	for id, want := range map[string]bool{"it-1440857781": true, "it-": false, "1440857781": false, "it-1/../x": false, "84d02be5-6a13-40de-8154-61b6ce78b3f8": false} {
		if c.ValidID(id) != want {
			t.Errorf("ValidID(%q) = %v", id, !want)
		}
	}
}

func TestApplesLimitIsRespected(t *testing.T) {
	c, _ := serve(t)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	for i := 0; i < perMinute; i++ {
		if err := c.reserve(ctx); err != nil {
			t.Fatalf("request %d: %v", i, err)
		}
	}
	if err := c.reserve(ctx); !catalog.IsBusy(err) {
		t.Errorf("over the limit: %v", err)
	}
}

func TestARefusalStopsAsking(t *testing.T) {
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		calls.Add(1)
		w.WriteHeader(http.StatusForbidden)
	}))
	defer server.Close()
	c := New("")
	c.base = server.URL
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if _, err := c.Search(ctx, "a"); !catalog.IsBusy(err) {
		t.Fatalf("err = %v", err)
	}
	if _, err := c.Search(ctx, "b"); !catalog.IsBusy(err) {
		t.Fatalf("err = %v", err)
	}
	if calls.Load() != 1 {
		t.Errorf("%d requests after a refusal", calls.Load())
	}
}
