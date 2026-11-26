package server

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"

	"github.com/Thrashy190/eco/internal/imports"
)

func (f *fakeLibrary) starLog() string {
	f.mu.Lock()
	defer f.mu.Unlock()
	return strings.Join(f.stars, ",")
}

func (f *fakeLibrary) add(song map[string]any) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.songs = append(f.songs, song)
}

// Liked songs go to the favourites of whoever imported them, from the oldest like to the newest (Spotify lists the
// newest first), and no playlist is made. A song that arrives later goes on top, and once nothing else of the list is on
// its way the list's favourites are made again in order. A favourite taken away by hand is not given back.
func TestLikedSongsBecomeFavoritesInOrder(t *testing.T) {
	fake, s := libraryServerOf(t,
		song("a", "Alpha", "X", "One"), song("b", "Beta", "X", "One"), song("c", "Gamma", "X", "Two"),
	)
	h := s.Handler()
	list := imports.List{Name: "Liked Songs", Rows: []imports.Row{
		{Title: "Gamma", Artist: "X"}, {Title: "Delta", Artist: "X"}, {Title: "Beta", Artist: "X"}, {Title: "Alpha", Artist: "X"},
	}}
	body, _ := json.Marshal(map[string]any{"name": list.Name, "rows": list.Rows, "favorites": true})
	rec := as(t, h, "ana", "POST", "/api/imports", string(body))
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"favorites":true`) {
		t.Fatalf("save: %d %s", rec.Code, rec.Body)
	}
	var out importOut
	json.Unmarshal(rec.Body.Bytes(), &out)
	s.favorites.Wait()
	if got, want := fake.starLog(), "ana:a,ana:b,ana:c"; got != want {
		t.Errorf("first favourites: %s, want %s", got, want)
	}
	if len(fake.playlists) != 0 || out.PlaylistID != "" {
		t.Errorf("a playlist was made: %v", fake.playlists)
	}

	// Ana takes Beta out of her favourites (through Eco, as any Subsonic app would). Then Delta is downloaded: it goes on
	// top, and the list is put back in order without Beta (Delta was liked before Gamma)
	if rec := as(t, h, "ana", "GET", "/rest/unstar?id=b", ""); rec.Code != http.StatusOK {
		t.Fatalf("unstar: %d", rec.Code)
	}
	fake.add(song("d", "Delta", "X", "Two"))
	if rec := as(t, h, "ana", "POST", "/api/imports/"+out.ID+"/sync", ""); rec.Code != http.StatusOK {
		t.Fatalf("sync: %d %s", rec.Code, rec.Body)
	}
	s.favorites.Wait()
	if got, want := fake.starLog(), "ana:a,ana:b,ana:c,ana:d,ana:a,ana:d,ana:c"; got != want {
		t.Errorf("after a download: %s, want %s", got, want)
	}
	// Syncing again changes nothing
	as(t, h, "ana", "POST", "/api/imports/"+out.ID+"/sync", "")
	s.favorites.Wait()
	if got := fake.starLog(); strings.Count(got, ",") != 6 || fake.starred["ana"]["b"] {
		t.Errorf("syncing again changed the favourites: %s", got)
	}
	// Nobody else's favourites were touched, and Luis cannot sync Ana's list
	if strings.Contains(fake.starLog(), "luis") {
		t.Error("luis got favourites")
	}
	if rec := as(t, h, "luis", "POST", "/api/imports/"+out.ID+"/sync", ""); rec.Code != http.StatusNotFound {
		t.Errorf("luis syncing ana's list: %d", rec.Code)
	}
}

// Exportify writes when each song was liked: that order wins over the rows'. A song listed twice keeps its newest like,
// and a list where some dates are missing falls back to the rows, newest first.
func TestLikeOrder(t *testing.T) {
	row := func(id, at string) importRowOut {
		r := importRowOut{Row: imports.Row{Title: id, AddedAt: at}}
		if id != "" {
			r.Library = &songOut{ID: id}
		}
		return r
	}
	got := strings.Join(likeOrder([]importRowOut{
		row("b", "2024-03-01T10:00:00Z"), row("", "2024-02-01T10:00:00Z"), row("a", "2023-12-24T08:00:00Z"),
		row("c", "2024-05-01T10:00:00Z"), row("a", "2024-04-01T10:00:00Z"),
	}), ",")
	if got != "b,a,c" {
		t.Errorf("by date: %s, want b,a,c", got)
	}
	got = strings.Join(likeOrder([]importRowOut{row("c", ""), row("b", "2024-03-01T10:00:00Z"), row("a", "")}), ",")
	if got != "a,b,c" {
		t.Errorf("without every date: %s, want a,b,c", got)
	}
}
