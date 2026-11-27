package server

import (
	"bytes"
	"encoding/json"
	"image"
	"image/jpeg"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/Thrashy190/eco/internal/stats"
)

func ids(songs []songOut) string {
	var out []string
	for _, s := range songs {
		out = append(out, s.ID)
	}
	return strings.Join(out, ",")
}

func profileOf(t *testing.T, h http.Handler, asker, name string) (int, profileOut, string) {
	t.Helper()
	rec := as(t, h, asker, "GET", "/api/people/"+name, "")
	var out profileOut
	if rec.Code == http.StatusOK {
		if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
			t.Fatal(err)
		}
	}
	return rec.Code, out, rec.Body.String()
}

func smallJPEG(t *testing.T) string {
	t.Helper()
	var b bytes.Buffer
	if err := jpeg.Encode(&b, image.NewRGBA(image.Rect(0, 0, 30, 10)), nil); err != nil {
		t.Fatal(err)
	}
	return b.String()
}

// People who signed in to Eco see each other's profiles: their top songs of the month (the order only), their public
// playlists and their favourites, newest first, with the asker's own hearts. Whatever someone hides answers like
// nothing, and a hidden profile like someone who never signed in; they still see their own.
func TestPeopleSeeEachOther(t *testing.T) {
	fake, s := libraryServerOf(t, song("a", "Alpha", "X", "One"), song("b", "Beta", "X", "One"), song("c", "Gamma", "X", "Two"))
	h := s.Handler()
	for _, user := range []string{"ana", "luis"} {
		if rec := as(t, h, user, "GET", "/api/me/library", ""); rec.Code != http.StatusOK {
			t.Fatalf("%s opening the app: %d", user, rec.Code)
		}
	}
	// Hearts go through Eco as the app sends them: Ana's b then a, Luis's c
	for _, star := range []struct{ user, id string }{{"ana", "b"}, {"ana", "a"}, {"luis", "c"}} {
		if rec := as(t, h, star.user, "GET", "/rest/star?id="+star.id, ""); rec.Code != http.StatusOK {
			t.Fatalf("star: %d", rec.Code)
		}
	}
	s.favorites.Wait()
	now := time.Now()
	for i, id := range []string{"c", "a", "c"} { // an hour apart, or two plays of a song are one
		if _, err := s.stats.Add(stats.Play{At: now.Add(time.Duration(i-3) * time.Hour), User: "ana", SongID: id, Title: id, Duration: 200}); err != nil {
			t.Fatal(err)
		}
	}
	fake.mu.Lock()
	fake.playlists["road"], fake.owner["road"] = []string{"a"}, "ana"
	fake.playlists["diary"], fake.owner["diary"] = []string{"b"}, "ana"
	fake.public = map[string]bool{"road": true}
	fake.mu.Unlock()

	rec := as(t, h, "luis", "GET", "/api/people", "")
	var list struct{ People []personOut }
	json.Unmarshal(rec.Body.Bytes(), &list)
	if len(list.People) != 2 {
		t.Fatalf("people: %s", rec.Body)
	}
	for _, p := range list.People {
		if p.Me != (p.User == "luis") {
			t.Errorf("who is me: %+v", p)
		}
	}

	code, ana, body := profileOf(t, h, "luis", "ANA")
	if code != http.StatusOK {
		t.Fatalf("ana's profile: %d %s", code, body)
	}
	if got := ids(ana.Top); got != "c,a" {
		t.Errorf("top: %s, want c,a", got)
	}
	if strings.Contains(body, `"plays"`) || strings.Contains(body, `"minutes"`) {
		t.Errorf("a profile told how often: %s", body)
	}
	if got := ids(ana.Favorites); got != "a,b" || ana.FavoriteCount != 2 {
		t.Errorf("favourites: %s (%d), want a,b", got, ana.FavoriteCount)
	}
	if len(ana.Playlists) != 1 || ana.Playlists[0].ID != "road" {
		t.Errorf("playlists: %+v, want only the public one", ana.Playlists)
	}
	if ana.Privacy != nil {
		t.Error("luis was shown ana's privacy settings")
	}
	// The hearts are Luis's: he starred c, Ana starred a and b
	for _, song := range append(ana.Top, ana.Favorites...) {
		if (song.Starred != "") != (song.ID == "c") {
			t.Errorf("song %s carries the wrong star: %q", song.ID, song.Starred)
		}
	}

	// A picture for the profile, then Ana hides her top songs and favourites
	if rec := as(t, h, "ana", "PUT", "/api/me/banner", smallJPEG(t)); rec.Code != http.StatusOK {
		t.Fatalf("banner: %d %s", rec.Code, rec.Body)
	}
	if rec := as(t, h, "luis", "GET", "/api/people/ana/banner", ""); rec.Code != http.StatusOK {
		t.Errorf("luis sees ana's banner: %d", rec.Code)
	}
	if rec := as(t, h, "ana", "PUT", "/api/me/profile", `{"display_name":"Ana M.","privacy":{"hide_top":true,"hide_favorites":true}}`); rec.Code != http.StatusOK {
		t.Fatalf("privacy: %d %s", rec.Code, rec.Body)
	}
	_, ana, _ = profileOf(t, h, "luis", "ana")
	if len(ana.Top) != 0 || len(ana.Favorites) != 0 || ana.FavoriteCount != 0 || ana.Name != "Ana M." {
		t.Errorf("hidden parts still show: %+v", ana)
	}
	if rec := as(t, h, "luis", "GET", "/api/people/ana/favorites", ""); !strings.Contains(rec.Body.String(), `"songs":[]`) {
		t.Errorf("hidden favourites through Show all: %s", rec.Body)
	}
	_, own, _ := profileOf(t, h, "ana", "ana")
	if ids(own.Favorites) != "a,b" || ids(own.Top) != "c,a" || own.Privacy == nil || !own.Privacy.HideTop {
		t.Errorf("ana's own profile: %+v", own)
	}

	// A hidden profile is nobody
	as(t, h, "ana", "PUT", "/api/me/profile", `{"privacy":{"hide_profile":true}}`)
	if code, _, _ := profileOf(t, h, "luis", "ana"); code != http.StatusNotFound {
		t.Errorf("hidden profile: %d", code)
	}
	for _, path := range []string{"/api/people/ana/banner", "/api/people/ana/avatar", "/api/people/ana/favorites"} {
		if rec := as(t, h, "luis", "GET", path, ""); rec.Code != http.StatusNotFound {
			t.Errorf("%s of a hidden profile: %d", path, rec.Code)
		}
	}
	if rec := as(t, h, "luis", "GET", "/api/people", ""); strings.Contains(rec.Body.String(), `"ana"`) {
		t.Errorf("a hidden profile is listed: %s", rec.Body)
	}
	if code, _, _ := profileOf(t, h, "ana", "ana"); code != http.StatusOK {
		t.Errorf("ana cannot see her own hidden profile: %d", code)
	}
	if code, _, _ := profileOf(t, h, "luis", "pedro"); code != http.StatusNotFound {
		t.Errorf("someone who never signed in: %d", code)
	}

	// Taking a heart away reaches the copy too
	as(t, h, "ana", "PUT", "/api/me/profile", `{}`)
	as(t, h, "ana", "GET", "/rest/unstar?id=a", "")
	s.favorites.Wait()
	if _, ana, _ = profileOf(t, h, "luis", "ana"); ids(ana.Favorites) != "b" {
		t.Errorf("after unstarring: %s, want b", ids(ana.Favorites))
	}
}

func TestDisplayNamesAreText(t *testing.T) {
	_, h, _ := libraryServer(t)
	if rec := as(t, h, "ana", "PUT", "/api/me/profile", `{"display_name":"`+strings.Repeat("x", 61)+`"}`); rec.Code != http.StatusBadRequest {
		t.Errorf("a long name: %d", rec.Code)
	}
	if rec := as(t, h, "ana", "PUT", "/api/me/profile", `{"display_name":"a\u0000b"}`); rec.Code != http.StatusBadRequest {
		t.Errorf("a control character: %d", rec.Code)
	}
	if rec := as(t, h, "ana", "PUT", "/api/me/banner", "not a picture"); rec.Code != http.StatusBadRequest {
		t.Errorf("a banner that is not a JPEG: %d", rec.Code)
	}
}
