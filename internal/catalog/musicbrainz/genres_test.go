package musicbrainz

import (
	"context"
	"net/http"
	"slices"
	"strings"
	"testing"
)

// The genres of Un verano sin ti's release group as MusicBrainz listed them (inc=genres, November 2026): ten, eight of
// them with one vote.
const unVeranoGroupGenres = `[{"name":"afrobeats","count":1},{"name":"chillwave","count":1},{"name":"dancehall","count":1},{"name":"dembow","count":1},
	{"name":"electronic","count":1},{"name":"latin","count":1},{"name":"latin pop","count":5},{"name":"pop","count":1},{"name":"reggaeton","count":5},
	{"name":"synth-pop","count":1}]`

func TestOnlyTheGenresPeopleAgreeOnAreKept(t *testing.T) {
	got := pickGenres([]genre{{"afrobeats", 1}, {"latin pop", 5}, {"reggaeton", 5}, {"dembow", 2}, {"pop", 3}})
	if !slices.Equal(got, []string{"Latin Pop", "Reggaeton", "Pop"}) {
		t.Errorf("got %q", got)
	}
	if got := pickGenres(nil); len(got) != 0 {
		t.Errorf("no votes, no genre: %q", got)
	}
}

func TestGenresAreWrittenTheWayPeopleDo(t *testing.T) {
	for in, want := range map[string]string{"r&b": "R&B", "hip hop": "Hip Hop", "synth-pop": "Synth-Pop", "k-pop": "K-Pop", "uk garage": "UK Garage", "contemporary r&b": "Contemporary R&B", "rock": "Rock"} {
		if got := genreName(in); got != want {
			t.Errorf("%q → %q, want %q", in, got, want)
		}
	}
}

// A download asks for the release once, and its genres come in that same answer: the recording's own when people voted
// for some (Tití Me Preguntó: reggaeton), otherwise the album's.
func TestADownloadGetsItsGenresWithoutAnotherRequest(t *testing.T) {
	const rec, other, rel = "84d02be5-6a13-40de-8154-61b6ce78b3f8", "94d02be5-6a13-40de-8154-61b6ce78b3f8", "aded3f90-b758-451a-aad7-711d5985b05f"
	calls := 0
	c, server := testClient(func(w http.ResponseWriter, r *http.Request) {
		calls++
		if !strings.Contains(r.URL.Query().Get("inc"), "genres") {
			t.Errorf("genres were not asked for: inc=%s", r.URL.Query().Get("inc"))
		}
		w.Write([]byte(`{"id":"` + rel + `","title":"Un verano sin ti","genres":[],"artist-credit":[{"name":"Bad Bunny"}],
			"release-group":{"id":"group","genres":` + unVeranoGroupGenres + `},
			"media":[{"position":1,"track-count":23,"tracks":[
				{"position":4,"title":"Tití me preguntó","recording":{"id":"` + rec + `","genres":[{"name":"reggaeton","count":2}]}},
				{"position":1,"title":"Moscow Mule","recording":{"id":"` + other + `","genres":[]}}]}]}`))
	})
	defer server.Close()
	titi, err := c.Track(context.Background(), rec+"."+rel)
	if err != nil {
		t.Fatal(err)
	}
	if !slices.Equal(titi.Genres, []string{"Reggaeton"}) {
		t.Errorf("Tití: %q", titi.Genres)
	}
	mule, err := c.Track(context.Background(), other+"."+rel)
	if err != nil {
		t.Fatal(err)
	}
	if !slices.Equal(mule.Genres, []string{"Latin Pop", "Reggaeton"}) {
		t.Errorf("Moscow Mule should take the album's: %q", mule.Genres)
	}
	if calls != 1 {
		t.Errorf("%d requests, want 1 (the second song comes from memory)", calls)
	}
}

// A song already in the library gets its album's genres: a search for the release group, and its lookup.
func TestAlbumGenres(t *testing.T) {
	const group = "3f516400-c67b-4546-9e6f-d90bf2362fca"
	c, server := testClient(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/release-group":
			w.Write([]byte(`{"release-groups":[{"id":"` + group + `","title":"Un Verano Sin Ti","primary-type":"Album","artist-credit":[{"name":"Bad Bunny"}]}]}`))
		case "/release-group/" + group:
			w.Write([]byte(`{"id":"` + group + `","title":"Un Verano Sin Ti","genres":` + unVeranoGroupGenres + `}`))
		default:
			t.Errorf("asked for %s", r.URL.Path)
		}
	})
	defer server.Close()
	got, err := c.AlbumGenres(context.Background(), "Un Verano Sin Ti", "Bad Bunny")
	if err != nil || !slices.Equal(got, []string{"Latin Pop", "Reggaeton"}) {
		t.Errorf("got %q, %v", got, err)
	}
	// Another artist's album of the same name is not this one
	got, err = c.AlbumGenres(context.Background(), "Un Verano Sin Ti", "Someone Else")
	if err != nil || len(got) != 0 {
		t.Errorf("got %q, %v", got, err)
	}
}
