package musicbrainz

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/Thrashy190/eco/internal/catalog"
)

func album(title, kind, date string, secondary ...string) release {
	return release{ID: title, Title: title, Status: "Official", Date: date, ReleaseGroup: releaseGroup{ID: "g-" + title, PrimaryType: kind, SecondaryTypes: secondary}}
}

func by(name string) []credit {
	c := credit{Name: name}
	c.Artist.ID, c.Artist.Name = "id-"+name, name
	return []credit{c}
}

// Bad Bunny's "Tití Me Preguntó" is on "Today's Hits" and on a megamix too. The tags must say Un Verano Sin Ti.
func TestASongIsPresentedOnItsOwnAlbum(t *testing.T) {
	hits := album("Today's Hits: June 2022", "Album", "2022-06-01", "Compilation")
	own := album("Un Verano Sin Ti", "Album", "2022-05-06")
	single := album("Tití Me Preguntó", "Single", "2022-05-01")
	if got := bestRelease([]release{hits, single, own}); got.Title != "Un Verano Sin Ti" {
		t.Errorf("got %q", got.Title)
	}
	show := album("2004-10-19: Wachovia Center, Philadelphia, PA", "Album", "2004-10-19")
	justice := album("...And Justice for All", "Album", "2004-10-20")
	if got := bestRelease([]release{show, justice}); got.Title != justice.Title {
		t.Errorf("a concert was presented as the album: %q", got.Title)
	}
}

// "metallica one" used to bring back covers named "One (Metallica)", and "espresso" whoever has the word in their name.
func TestSearchRanking(t *testing.T) {
	cover := recording{ID: "1", Title: "One (Metallica)", Score: 100, Credit: by("Стары Ольса"), Releases: []release{album("Medieval Classic Rock", "Album", "2015")}}
	real := recording{ID: "2", Title: "One", Score: 70, Credit: by("Metallica"), Length: 446000, Releases: []release{album("...And Justice for All", "Album", "1988")}}
	if got := rankRecordings("metallica one", []recording{cover, real}); got[0].ID != "2" {
		t.Errorf("first = %q", got[0].Title)
	}
	commentary := recording{ID: "3", Title: "Bad Bunny on BAILE INoLVIDABLE", Score: 100, Credit: by("Bad Bunny"), Releases: []release{album("Track by Track", "Other", "2025")}}
	song := recording{ID: "4", Title: "BAILE INoLVIDABLE", Score: 70, Credit: by("Bad Bunny"), Releases: []release{album("DeBÍ TiRAR MáS FOToS", "Album", "2025")}}
	if got := rankRecordings("bad bunny baile inolvidable", []recording{commentary, song}); got[0].ID != "4" {
		t.Errorf("first = %q", got[0].Title)
	}
	duo := recording{ID: "5", Title: "Lo echamos a suertes", Score: 100, Credit: by("Ella Baila Sola"), Releases: []release{album("Ella Baila Sola", "Album", "1996")}}
	hit := recording{ID: "6", Title: "Ella baila sola", Score: 80, Credit: by("Eslabón Armado"), Releases: []release{album("DESVELADO", "Album", "2023")}}
	if got := rankRecordings("ella baila sola", []recording{duo, hit}); got[0].ID != "6" {
		t.Errorf("a title typed in full should beat a band of that name, got %q", got[0].Title)
	}
}

func TestOneResultPerSongOnItsUsualLength(t *testing.T) {
	onAlbum := album("...And Justice for All", "Album", "1988")
	live := recording{ID: "live", Title: "One", Credit: by("Metallica"), Length: 494000, Releases: []release{album("By Request", "Album", "2014")}}
	studio := recording{ID: "studio", Title: "One", Credit: by("Metallica"), Length: 446000, Releases: []release{onAlbum, album("Enter Sandman / One", "Single", "1993")}}
	again := recording{ID: "again", Title: "One", Credit: by("Metallica"), Length: 446500, Releases: []release{album("Reissue", "Album", "2018")}}
	got := uniqueSongs([]recording{live, studio, again})
	if len(got) != 1 || got[0].ID != "studio" {
		t.Fatalf("got %+v", got)
	}
}

func TestRecordingsOfAnArtistStartWithTheirOwnAlbums(t *testing.T) {
	guest := recording{ID: "guest", Title: "Un Día", Credit: by("Bad Bunny"), Releases: []release{{Title: "Future Nostalgia", Status: "Official", Date: "2020", Credit: by("Dua Lipa"), ReleaseGroup: releaseGroup{PrimaryType: "Album"}}}}
	own := recording{ID: "own", Title: "Yonaguni", Credit: by("Bad Bunny"), Releases: []release{{Title: "Yonaguni", Status: "Official", Date: "2021", Credit: by("Bad Bunny"), ReleaseGroup: releaseGroup{PrimaryType: "Single"}}}}
	remix := recording{ID: "remix", Title: "K-POP (Chopped & Screwed)", Credit: by("Bad Bunny"), Releases: own.Releases}
	got := rankRecordingsOf("id-Bad Bunny", []recording{guest, remix, own})
	if len(got) != 2 || got[0].ID != "own" {
		t.Fatalf("got %+v", got)
	}
}

// A wrong song in a library is worse than a missing one.
func TestBestMatchOnlyAcceptsTheSameSong(t *testing.T) {
	want := catalog.Wanted{Title: "A Different World (feat. Corey Taylor)", Artist: "Korn, Corey Taylor", DurationMs: 200000}
	right := recording{ID: "right", Title: "A Different World", Length: 201000, Credit: by("Korn"), Releases: []release{album("The Serenity of Suffering", "Album", "2016")}}
	if got, ok := bestMatch(want, []recording{right}); !ok || got.ID != "right" {
		t.Errorf("the same song with and without the guest was not matched")
	}
	for name, r := range map[string]recording{
		"another artist": {Title: "A Different World", Length: 200000, Credit: by("Winger")},
		"another title":  {Title: "A Different Place", Length: 200000, Credit: by("Korn")},
		"another take":   {Title: "A Different World", Length: 260000, Credit: by("Korn")},
		"unknown length": {Title: "A Different World", Credit: by("Korn")},
		"another mix":    {Title: "A Different World - Extended Remix", Length: 200000, Credit: by("Korn")},
	} {
		if got, ok := bestMatch(want, []recording{r}); ok {
			t.Errorf("%s accepted: %+v", name, got)
		}
	}
	two := catalog.Wanted{Title: "Hasta Jesús Tuvo un Mal Día", Artist: "CA7RIEL & Paco Amoroso", Album: "FREE SPIRITS"}
	r := recording{ID: "x", Title: "Hasta Jesús tuvo un mal día", Credit: by("CA7RIEL & Paco Amoroso"), Releases: []release{album("Hasta Jesús tuvo un mal día", "Single", "2024"), album("FREE SPIRITS", "Album", "2024")}}
	got, ok := bestMatch(two, []recording{r})
	if !ok || bestRelease(got.Releases).Title != "FREE SPIRITS" {
		t.Errorf("the album they listed should win: %+v", got)
	}
}

func TestLuceneTermsAreEscaped(t *testing.T) {
	if got := terms(`AC/DC: "T.N.T" (live)`); strings.ContainsAny(got, `/:"()`) {
		t.Errorf("got %q", got)
	}
	if got := everyWord("metallica one", "recording"); got != "(artist:metallica OR recording:metallica) AND (artist:one OR recording:one)" {
		t.Errorf("got %q", got)
	}
}

func TestValidID(t *testing.T) {
	rec, rel := "84d02be5-6a13-40de-8154-61b6ce78b3f8", "3f516400-c67b-4546-9e6f-d90bf2362fca"
	c := New("http://mirror")
	for id, want := range map[string]bool{rec: true, rec + "." + rel: true, "": false, "../../etc": false, rec + "." + rel + ".x": false, "7kW0cpKgSVsEqcc8xgbSb0": false} {
		if c.ValidID(id) != want {
			t.Errorf("ValidID(%q) = %v", id, !want)
		}
	}
}

func testClient(handler http.HandlerFunc) (*Client, *httptest.Server) {
	server := httptest.NewServer(handler)
	c := New(server.URL)
	c.backoff = time.Millisecond
	return c, server
}

func TestRepeatedQuestionsAreAnsweredFromMemory(t *testing.T) {
	var calls atomic.Int32
	c, server := testClient(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		if r.Header.Get("User-Agent") == "" || !strings.Contains(r.Header.Get("User-Agent"), "eco") {
			t.Errorf("MusicBrainz asks for a User-Agent saying who is asking, got %q", r.Header.Get("User-Agent"))
		}
		w.Write([]byte(`{"recordings":[],"release-groups":[]}`))
	})
	defer server.Close()
	for range 3 {
		if _, err := c.Search(context.Background(), "metallica"); err != nil {
			t.Fatal(err)
		}
	}
	if calls.Load() != 2 { // one for songs, one for albums
		t.Errorf("%d requests", calls.Load())
	}
}

func TestThePublicServerIsAskedOncePerSecond(t *testing.T) {
	if got := New("").spacing; got < time.Second {
		t.Errorf("spacing = %v", got)
	}
	c := New("")
	c.spacing = 40 * time.Millisecond
	start := time.Now()
	for range 3 {
		if err := c.wait(context.Background()); err != nil {
			t.Fatal(err)
		}
	}
	if d := time.Since(start); d < 80*time.Millisecond {
		t.Errorf("three requests in %v", d)
	}
}

func TestARefusalIsWaitedOutThenReportedAsBusy(t *testing.T) {
	var calls atomic.Int32
	c, server := testClient(func(w http.ResponseWriter, _ *http.Request) {
		if calls.Add(1) == 1 {
			w.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		w.Write([]byte(`{"recordings":[]}`))
	})
	defer server.Close()
	var out struct{}
	if err := c.get(context.Background(), "recording", map[string][]string{"query": {"x"}}, time.Minute, &out); err != nil {
		t.Fatalf("a passing refusal should be retried: %v", err)
	}

	c, closed := testClient(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusServiceUnavailable) })
	defer closed.Close()
	err := c.get(context.Background(), "recording", map[string][]string{"query": {"y"}}, time.Minute, &out)
	if !catalog.IsBusy(err) {
		t.Fatalf("err = %v", err)
	}
	// Someone who cannot wait hears it at once, with nothing sent
	c.until = time.Now().Add(time.Hour)
	before := time.Now()
	ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
	defer cancel()
	if err := c.wait(ctx); !catalog.IsBusy(err) || time.Since(before) > time.Second {
		t.Errorf("err = %v after %v", err, time.Since(before))
	}
}

func TestMissingThingsAreNotFound(t *testing.T) {
	c, server := testClient(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusNotFound) })
	defer server.Close()
	if _, err := c.Album(context.Background(), "b3073a10-2d7c-484c-b387-e49ae629da3d"); !errors.Is(err, catalog.ErrNotFound) {
		t.Errorf("err = %v", err)
	}
}

func TestTrackOnAReleaseHasEverythingTheTagsNeed(t *testing.T) {
	const rec, rel = "84d02be5-6a13-40de-8154-61b6ce78b3f8", "3f516400-c67b-4546-9e6f-d90bf2362fca"
	c, server := testClient(func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasSuffix(r.URL.Path, "/release/"+rel) {
			t.Errorf("asked for %s", r.URL.Path)
		}
		w.Write([]byte(`{"id":"` + rel + `","title":"Album","date":"2025-01-05","artist-credit":[{"name":"Bad Bunny"}],"release-group":{"id":"group"},
			"media":[{"position":2,"track-count":9,"tracks":[{"position":4,"title":"Song","length":183685,"artist-credit":[{"name":"Bad Bunny"},{"name":"Chuwi"}],
			"recording":{"id":"` + rec + `","isrcs":["QM1"]}}]}]}`))
	})
	defer server.Close()
	got, err := c.Track(context.Background(), rec+"."+rel)
	if err != nil {
		t.Fatal(err)
	}
	m := got.Meta
	if m.Title != "Song" || m.Artist != "Bad Bunny, Chuwi" || len(m.Artists) != 2 || m.AlbumArtist != "Bad Bunny" || m.Album != "Album" ||
		m.Date != "2025-01-05" || m.Track != 4 || m.Tracks != 9 || m.Disc != 2 || m.DurationMs != 183685 || m.ISRC != "QM1" || !strings.HasSuffix(m.CoverURL, "/release-group/group/front-500") {
		t.Errorf("meta = %+v", m)
	}
}
