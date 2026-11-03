package server

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"testing/fstest"

	"github.com/Thrashy190/eco/internal/config"
	"github.com/Thrashy190/eco/internal/engine"
	"github.com/Thrashy190/eco/internal/imports"
	"github.com/Thrashy190/eco/internal/match"
	"github.com/Thrashy190/eco/internal/subsonic"
)

// fakeLibrary is just enough of a Navidrome: songs, playlists per user, stars.
type fakeLibrary struct {
	mu        sync.Mutex
	songs     []map[string]any
	playlists map[string][]string // id → songs
	owner     map[string]string   // id → user
	stars     []string
	writes    int
}

func (f *fakeLibrary) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	f.mu.Lock()
	defer f.mu.Unlock()
	q := r.URL.Query()
	reply := func(body map[string]any) {
		body["status"] = "ok"
		json.NewEncoder(w).Encode(map[string]any{"subsonic-response": body})
	}
	entries := func(ids []string) []map[string]any {
		out := []map[string]any{}
		for _, id := range ids {
			for _, s := range f.songs {
				if s["id"] == id {
					out = append(out, s)
				}
			}
		}
		return out
	}
	switch filepath.Base(r.URL.Path) {
	case "search3":
		if q.Get("songOffset") != "0" {
			reply(map[string]any{"searchResult3": map[string]any{}})
			return
		}
		reply(map[string]any{"searchResult3": map[string]any{"song": f.songs}})
	case "getUser":
		reply(map[string]any{"user": map[string]any{"adminRole": q.Get("u") == "admin"}})
	case "getSong":
		for _, s := range f.songs {
			if s["id"] == q.Get("id") {
				reply(map[string]any{"song": s})
				return
			}
		}
		json.NewEncoder(w).Encode(map[string]any{"subsonic-response": map[string]any{"status": "failed", "error": map[string]any{"code": 70, "message": "not found"}}})
	case "getPlaylists":
		list := []map[string]any{}
		for id, who := range f.owner {
			if who == q.Get("u") {
				list = append(list, map[string]any{"id": id, "name": id, "songCount": len(f.playlists[id])})
			}
		}
		reply(map[string]any{"playlists": map[string]any{"playlist": list}})
	case "getPlaylist":
		ids, ok := f.playlists[q.Get("id")]
		if !ok || f.owner[q.Get("id")] != q.Get("u") {
			json.NewEncoder(w).Encode(map[string]any{"subsonic-response": map[string]any{"status": "failed", "error": map[string]any{"code": 70, "message": "not found"}}})
			return
		}
		reply(map[string]any{"playlist": map[string]any{"id": q.Get("id"), "entry": entries(ids)}})
	case "createPlaylist":
		f.writes++
		id := q.Get("playlistId")
		if id == "" {
			id = "pl-" + q.Get("name")
			f.owner[id] = q.Get("u")
		}
		f.playlists[id] = q["songId"]
		reply(map[string]any{"playlist": map[string]any{"id": id}})
	case "star":
		f.stars = append(f.stars, q.Get("id"))
		reply(map[string]any{})
	default:
		reply(map[string]any{})
	}
}

func libraryServer(t *testing.T, songs ...map[string]any) (*fakeLibrary, http.Handler, *config.Config) {
	t.Helper()
	fake := &fakeLibrary{songs: songs, playlists: map[string][]string{}, owner: map[string]string{}}
	nd := httptest.NewServer(fake)
	t.Cleanup(nd.Close)
	dir := t.TempDir()
	cfg := &config.Config{NavidromeURL: nd.URL, MediaDir: filepath.Join(dir, "media"), UsersDir: filepath.Join(dir, "users"), MusicDir: filepath.Join(dir, "music"), DataDir: dir, FFmpeg: "ffmpeg"}
	os.MkdirAll(cfg.MusicDir, 0o755)
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	s, err := New(ctx, cfg, engine.New(cfg), fstest.MapFS{"index.html": {Data: []byte("x")}})
	if err != nil {
		t.Fatal(err)
	}
	return fake, s.Handler(), cfg
}

func song(id, title, artist, album string) map[string]any {
	return map[string]any{"id": id, "title": title, "artist": artist, "album": album, "albumId": "a-" + album, "duration": 200, "size": 1000, "suffix": "m4a"}
}

func saveList(t *testing.T, h http.Handler, user string, list imports.List) importOut {
	t.Helper()
	body, _ := json.Marshal(list)
	rec := as(t, h, user, "POST", "/api/imports", string(body))
	if rec.Code != 200 {
		t.Fatalf("save: %d %s", rec.Code, rec.Body)
	}
	var out importOut
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatal(err)
	}
	return out
}

func TestImportMakesAPlaylistInTheListsOrder(t *testing.T) {
	fake, h, _ := libraryServer(t, song("walk", "Walk", "Pantera", "Vulgar"), song("one", "One", "Metallica", "Justice"))
	out := saveList(t, h, "diego", imports.List{Name: "Gym", Rows: []imports.Row{
		{Title: "ONE", Artist: "Metallica"}, {Title: "Not Here", Artist: "Nobody"}, {Title: "Walk", Artist: "Pantera, Someone"},
	}})
	if out.Total != 3 || out.Owned != 2 || out.PlaylistID != "pl-Gym" {
		t.Fatalf("out = %+v", out)
	}
	if got := strings.Join(fake.playlists["pl-Gym"], ","); got != "one,walk" {
		t.Errorf("playlist = %s", got)
	}
	if out.Rows[1].Library != nil || out.Rows[1].Key == "" {
		t.Errorf("missing row = %+v", out.Rows[1])
	}
}

// A newer file of the same list updates it. Songs added to the playlist by hand stay.
func TestImportingAgainUpdatesTheSamePlaylist(t *testing.T) {
	fake, h, _ := libraryServer(t, song("walk", "Walk", "Pantera", "V"), song("one", "One", "Metallica", "J"), song("mine", "Mine", "Me", "M"))
	first := saveList(t, h, "diego", imports.List{Name: "Gym", Rows: []imports.Row{{Title: "One", Artist: "Metallica"}}})
	fake.mu.Lock()
	fake.playlists[first.PlaylistID] = append(fake.playlists[first.PlaylistID], "mine") // added by hand
	fake.mu.Unlock()
	again := saveList(t, h, "diego", imports.List{Name: "gym", Rows: []imports.Row{{Title: "Walk", Artist: "Pantera"}}})
	if again.ID != first.ID || again.PlaylistID != first.PlaylistID {
		t.Fatalf("a second playlist was made: %+v", again)
	}
	if got := strings.Join(fake.playlists[first.PlaylistID], ","); got != "walk,mine" {
		t.Errorf("playlist = %s", got)
	}
	writes := fake.writes
	if rec := as(t, h, "diego", "POST", "/api/imports/"+first.ID+"/sync", ""); rec.Code != 200 {
		t.Fatalf("sync: %d %s", rec.Code, rec.Body)
	}
	if fake.writes != writes {
		t.Error("a playlist that is up to date was written again")
	}
}

func TestImportsArePrivate(t *testing.T) {
	_, h, _ := libraryServer(t, song("one", "One", "Metallica", "J"))
	mine := saveList(t, h, "diego", imports.List{Name: "Secret", Rows: []imports.Row{{Title: "One", Artist: "Metallica"}}})
	for _, target := range []string{"GET /api/imports/" + mine.ID, "POST /api/imports/" + mine.ID + "/sync", "POST /api/imports/" + mine.ID + "/download", "DELETE /api/imports/" + mine.ID} {
		method, path, _ := strings.Cut(target, " ")
		if rec := as(t, h, "ana", method, path, ""); rec.Code != http.StatusNotFound {
			t.Errorf("%s as someone else: %d", target, rec.Code)
		}
	}
	var listed struct {
		Imports []importOut `json:"imports"`
	}
	json.Unmarshal(as(t, h, "ana", "GET", "/api/imports", "").Body.Bytes(), &listed)
	if len(listed.Imports) != 0 {
		t.Errorf("another user sees %+v", listed.Imports)
	}
	json.Unmarshal(as(t, h, "DIEGO", "GET", "/api/imports", "").Body.Bytes(), &listed)
	if len(listed.Imports) != 1 {
		t.Errorf("Navidrome ignores case in usernames, and so must this: %+v", listed.Imports)
	}
}

func TestParseSavesNothing(t *testing.T) {
	_, h, _ := libraryServer(t, song("one", "One", "Metallica", "J"))
	path := "/api/imports/parse?name=" + url.QueryEscape("Road trip.csv")
	rec := as(t, h, "diego", "POST", path, "Track Name,Artist Name\nOne,Metallica\nGone,Nobody\n")
	if rec.Code != 200 {
		t.Fatalf("%d %s", rec.Code, rec.Body)
	}
	var out struct {
		Lists []struct {
			Name  string        `json:"name"`
			Rows  []imports.Row `json:"rows"`
			Owned int           `json:"owned"`
		} `json:"lists"`
	}
	json.Unmarshal(rec.Body.Bytes(), &out)
	if len(out.Lists) != 1 || out.Lists[0].Name != "Road trip" || out.Lists[0].Owned != 1 || len(out.Lists[0].Rows) != 2 {
		t.Errorf("out = %+v", out)
	}
	var listed struct {
		Imports []importOut `json:"imports"`
	}
	json.Unmarshal(as(t, h, "diego", "GET", "/api/imports", "").Body.Bytes(), &listed)
	if len(listed.Imports) != 0 {
		t.Errorf("saved: %+v", listed.Imports)
	}
	if rec := as(t, h, "diego", "POST", "/api/imports/parse?name=x.csv", "not,a\nlist,of songs\n"); rec.Code != 400 {
		t.Errorf("not a list: %d", rec.Code)
	}
}

func TestFindDuplicates(t *testing.T) {
	copyOf := func(id, title, artist, album string, seconds int, starred string) subsonic.Song {
		return subsonic.Song{ID: id, Title: title, Artist: artist, Album: album, AlbumID: album, Duration: seconds, Starred: starred}
	}
	songs := []subsonic.Song{
		copyOf("single", "Por Esos Ojos", "Fuerza Regida", "Por Esos Ojos", 188, ""),
		copyOf("album", "Por Esos Ojos", "Fuerza Regida", "111XPANTIA", 188, ""),
		copyOf("other", "Otra", "Fuerza Regida", "111XPANTIA", 200, ""),
		copyOf("live", "Walk (Live)", "Pantera", "Live", 315, ""),
		copyOf("studio", "Walk", "Pantera", "Vulgar", 315, ""),
		copyOf("short", "Intro", "Slayer", "A", 60, ""),
		copyOf("long", "Intro", "Slayer", "B", 120, ""),
		copyOf("them", "Walk", "Somebody Else", "X", 315, ""),
	}
	groups := findDuplicates(songs)
	if len(groups) != 1 {
		t.Fatalf("groups = %+v", groups)
	}
	if groups[0].Keep != "album" {
		t.Errorf("the fullest album should stay, got %q", groups[0].Keep)
	}
}

// "Tyler, The Creator" is one person and "Offset, Metro Boomin" are two. Without proof a name stays unticked.
func TestFindCombinedArtists(t *testing.T) {
	got := findCombinedArtists([]subsonic.Song{
		{Artist: "Bad Bunny"},
		{Artist: "Bad Bunny, Chuwi"},
		{Artist: "Offset, Metro Boomin"},
		{Artist: "21 Savage, Offset, Metro Boomin"},
		{Artist: "Tyler, The Creator"},
		{Artist: "Arcángel", AlbumArtist: "League of Legends, Against The Current"},
	})
	sure := map[string]bool{}
	for _, fix := range got {
		sure[fix.Name] = fix.Sure
	}
	for name, want := range map[string]bool{"Bad Bunny, Chuwi": true, "Offset, Metro Boomin": true, "21 Savage, Offset, Metro Boomin": true, "Tyler, The Creator": false, "League of Legends, Against The Current": false} {
		value, listed := sure[name]
		if !listed || value != want {
			t.Errorf("%q: listed %v, sure %v, want %v", name, listed, value, want)
		}
	}
	if got := separated("Bad Bunny, Chuwi", map[string]bool{"Bad Bunny, Chuwi": true}); got != "Bad Bunny; Chuwi" {
		t.Errorf("got %q", got)
	}
	if got := separated("Tyler, The Creator", map[string]bool{"Bad Bunny, Chuwi": true}); got != "" {
		t.Errorf("a name nobody chose would be rewritten: %q", got)
	}
	if match.FirstArtist("Bad Bunny; Chuwi") != "bad bunny" {
		t.Error("a separated tag must still read as its first artist")
	}
}

func TestCleanupIsForAdministrators(t *testing.T) {
	_, h, _ := libraryServer(t, song("one", "One", "Metallica", "J"))
	for _, target := range []string{"GET /api/admin/cleanup", "POST /api/admin/cleanup/duplicates", "POST /api/admin/cleanup/artists"} {
		method, path, _ := strings.Cut(target, " ")
		if rec := as(t, h, "ana", method, path, `{"names":["A, B"],"keep":"a","remove":["b"]}`); rec.Code != http.StatusForbidden {
			t.Errorf("%s as a normal user: %d", target, rec.Code)
		}
	}
	if rec := as(t, h, "admin", "GET", "/api/admin/cleanup", ""); rec.Code != 200 {
		t.Errorf("as an administrator: %d %s", rec.Code, rec.Body)
	}
}

func TestDeletingADuplicateMovesWhatThePersonHadOnIt(t *testing.T) {
	keep := song("keep", "Por Esos Ojos", "Fuerza Regida", "111XPANTIA")
	drop := song("drop", "Por Esos Ojos", "Fuerza Regida", "Por Esos Ojos")
	drop["starred"] = "2024-01-01T00:00:00Z"
	stranger := song("stranger", "Otra", "Otro", "Otro")
	fake, h, _ := libraryServer(t, keep, drop, stranger)
	fake.playlists["p"] = []string{"stranger", "drop"}
	fake.owner["p"] = "admin"

	// Not copies of the same song: nothing happens, whatever the app sent
	if rec := as(t, h, "admin", "POST", "/api/admin/cleanup/duplicates", `{"keep":"keep","remove":["stranger"]}`); rec.Code != 400 {
		t.Fatalf("different songs: %d %s", rec.Code, rec.Body)
	}
	// No file can be identified: nothing is deleted, and nothing else changes either
	rec := as(t, h, "admin", "POST", "/api/admin/cleanup/duplicates", `{"keep":"keep","remove":["drop"]}`)
	if rec.Code != http.StatusConflict {
		t.Fatalf("got %d %s", rec.Code, rec.Body)
	}
	if len(fake.stars) != 0 || strings.Join(fake.playlists["p"], ",") != "stranger,drop" {
		t.Errorf("stars = %v, playlist = %v", fake.stars, fake.playlists["p"])
	}
}
