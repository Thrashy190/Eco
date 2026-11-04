package server

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"

	"github.com/Thrashy190/eco/internal/catalog"
	"github.com/Thrashy190/eco/internal/config"
	"github.com/Thrashy190/eco/internal/engine"
	"github.com/Thrashy190/eco/internal/match"
	"github.com/Thrashy190/eco/internal/subsonic"
	"github.com/Thrashy190/eco/internal/userdata"
)

func libraryOf(songs ...subsonic.Song) *snapshot {
	sn := &snapshot{songs: songs, byTitle: map[string][]subsonic.Song{}}
	for _, s := range songs {
		key := match.Norm(s.Title)
		sn.byTitle[key] = append(sn.byTitle[key], s)
	}
	return sn
}

// The same song can be on a studio album and a compilation. The album page must link to the copy from that album.
func TestFindPrefersTheSameAlbum(t *testing.T) {
	lib := libraryOf(
		subsonic.Song{ID: "best-of", Title: "walk", Artist: "Pantera", Album: "Reinventing Hell"},
		subsonic.Song{ID: "studio", Title: "walk", Artist: "Pantera", Album: "Vulgar Display of Power"},
	)
	if got, ok := lib.find("Walk", "Pantera", "Vulgar Display of Power"); !ok || got.ID != "studio" {
		t.Errorf("got %q, want the copy on that album", got.ID)
	}
	if got, ok := lib.find("Walk", "Pantera", "Some Other Album"); !ok || got.ID != "best-of" {
		t.Errorf("got %q, want any copy when the album differs", got.ID)
	}
	if _, ok := lib.find("Walk", "Somebody Else", ""); ok {
		t.Error("a song by another artist counted as owned")
	}
}

func TestAlbumTracksMarksWhatIsDownloaded(t *testing.T) {
	song := func(id, title string, number int) catalog.Track {
		return catalog.Track{ID: id, Meta: catalog.Meta{Title: title, Artist: "Pantera", DurationMs: 315000, Track: number, Disc: 1}}
	}
	album := catalog.Album{ID: "a", Name: "Vulgar Display of Power", Tracks: []catalog.Track{song("t1", "Walk", 3), song("t2", "Fucking Hostile", 4)}}

	rows := albumTracks(album, libraryOf(subsonic.Song{ID: "lib1", Title: "walk", Artist: "Pantera", Album: "Vulgar Display of Power"}))
	if len(rows) != 2 || rows[0].Track != 3 || rows[1].Track != 4 {
		t.Fatalf("order lost: %+v", rows)
	}
	if rows[0].Library == nil || rows[0].Library.ID != "lib1" {
		t.Errorf("owned track not marked: %+v", rows[0])
	}
	if rows[1].Library != nil {
		t.Errorf("missing track marked as owned: %+v", rows[1])
	}
	if rows[0].Duration != 315 {
		t.Errorf("duration = %d", rows[0].Duration)
	}
}

func TestDuplicateAlbumsNamesWhatTheCatalogueAlsoShows(t *testing.T) {
	local := []subsonic.Album{{ID: "1", Name: "Vulgar Display of Power", Artist: "Pantera"}, {ID: "2", Name: "My Own Demos", Artist: "Diego"}}
	got := duplicateAlbums(local, []externalAlbumOut{{Name: "VULGAR DISPLAY OF POWER", Artist: "Pantera"}})
	if len(got) != 1 || got[0] != "1" {
		t.Fatalf("got %+v", got)
	}
}

func TestMissingAlbumsKeepsOnlyThisArtistsAlbumsNotInTheLibrary(t *testing.T) {
	album := func(id, name, artist string) catalog.Album {
		return catalog.Album{ID: id, Name: name, Artists: []string{artist}}
	}
	lib := &snapshot{songs: []subsonic.Song{{Title: "Walk", Album: "Vulgar Display of Power", Artist: "Pantera"}}}
	got := missingAlbums([]catalog.Album{
		album("owned", "VULGAR DISPLAY OF POWER", "Pantera"),
		album("tribute", "Pantera Tribute", "Someone Else"),
		album("wanted", "Far Beyond Driven", "Pantera"),
	}, "Pantera", lib)
	if len(got) != 1 || got[0].ID != "wanted" {
		t.Fatalf("got %+v", got)
	}
}

func TestNavidromeRecentsGoBehindAndDoNotRepeat(t *testing.T) {
	st := userdata.State{Recents: []userdata.Entry{{Type: "artist", ID: "x", Name: "An artist"}, {Type: "album", ID: "a1", Name: "Opened"}}}
	got := withNavidromeRecents(st, []subsonic.Album{{ID: "a1", Name: "Opened"}, {ID: "x", Name: "Same ID, not an artist"}})
	if len(got.Recents) != 3 || got.Recents[0].ID != "x" || got.Recents[0].Type != "artist" || got.Recents[2].Type != "album" {
		t.Fatalf("recents = %+v", got.Recents)
	}
}

// fakeNavidrome answers ping (and every other call) with "ok".
func fakeNavidrome(t *testing.T) *httptest.Server {
	t.Helper()
	nd := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, "/getPlaylist") && r.URL.Query().Get("id") == "missing" {
			w.Write([]byte(`{"subsonic-response":{"status":"failed","error":{"code":70,"message":"not found"}}}`))
			return
		}
		w.Write([]byte(`{"subsonic-response":{"status":"ok"}}`))
	}))
	t.Cleanup(nd.Close)
	return nd
}

func newTestServer(t *testing.T) http.Handler {
	t.Helper()
	cfg := &config.Config{NavidromeURL: fakeNavidrome(t).URL, MediaDir: t.TempDir(), UsersDir: t.TempDir()}
	web := fstest.MapFS{"index.html": {Data: []byte("<!doctype html>")}, "assets/app-abc.js": {Data: []byte("1")}, "manifest.webmanifest": {Data: []byte("{}")}}
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	s, err := New(ctx, cfg, engine.New(cfg), web)
	if err != nil {
		t.Fatal(err)
	}
	return s.Handler() // panics here if two routes conflict (Go's ServeMux checks at registration)
}

func call(t *testing.T, h http.Handler, method, path, body string) *httptest.ResponseRecorder {
	t.Helper()
	sep := "?"
	if strings.Contains(path, "?") {
		sep = "&"
	}
	req := httptest.NewRequest(method, path+sep+"u=diego&t=token&s=salt", strings.NewReader(body))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

func TestLibraryEndpoints(t *testing.T) {
	h := newTestServer(t)
	if rec := call(t, h, "POST", "/api/me/pins", `{"type":"song","id":"s1","name":"Walk"}`); rec.Code != 200 {
		t.Fatalf("pin: %d %s", rec.Code, rec.Body)
	}
	if rec := call(t, h, "POST", "/api/me/recents", `{"type":"album","id":"a1","name":"An album"}`); rec.Code != 200 {
		t.Fatalf("touch: %d %s", rec.Code, rec.Body)
	}
	if rec := call(t, h, "POST", "/api/me/recents", `{"type":"album","id":"../../x","name":"Nope"}`); rec.Code != 400 {
		t.Fatalf("bad id accepted: %d", rec.Code)
	}
	var st userdata.State
	rec := call(t, h, "GET", "/api/me/library", "")
	if err := json.Unmarshal(rec.Body.Bytes(), &st); err != nil {
		t.Fatal(err)
	}
	if len(st.Pins) != 1 || len(st.Recents) != 1 {
		t.Fatalf("state = %+v", st)
	}
	if rec := call(t, h, "DELETE", "/api/me/pins/song/s1", ""); rec.Code != 200 {
		t.Fatalf("unpin: %d", rec.Code)
	}
}

func TestCoverEndpointsCheckThePlaylist(t *testing.T) {
	h := newTestServer(t)
	if rec := call(t, h, "PUT", "/api/covers/playlists/missing", "x"); rec.Code != 404 {
		t.Errorf("cover for a missing playlist: %d", rec.Code)
	}
	if rec := call(t, h, "PUT", "/api/covers/playlists/favorites", "not a jpeg"); rec.Code != 400 {
		t.Errorf("non-JPEG accepted: %d", rec.Code)
	}
	if rec := call(t, h, "GET", "/api/covers/playlists/favorites", ""); rec.Code != 404 {
		t.Errorf("no cover set yet: %d", rec.Code)
	}
}

func TestEveryAPIRouteNeedsCredentials(t *testing.T) {
	h := newTestServer(t)
	for _, target := range []string{"GET /api/me/library", "POST /api/me/pins", "PUT /api/covers/playlists/favorites", "GET /api/catalog/albums/b3073a10-2d7c-484c-b387-e49ae629da3d"} {
		method, path, _ := strings.Cut(target, " ")
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, httptest.NewRequest(method, path, nil))
		if rec.Code != http.StatusUnauthorized {
			t.Errorf("%s without credentials: %d", target, rec.Code)
		}
	}
}

func TestManifestHasItsOwnContentType(t *testing.T) {
	rec := httptest.NewRecorder()
	newTestServer(t).ServeHTTP(rec, httptest.NewRequest("GET", "/manifest.webmanifest", nil))
	if got := rec.Header().Get("Content-Type"); got != "application/manifest+json" {
		t.Errorf("Content-Type = %q", got)
	}
}

func TestHashedAssetsAreCachedForever(t *testing.T) {
	h := newTestServer(t)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest("GET", "/assets/app-abc.js", nil))
	if !strings.Contains(rec.Header().Get("Cache-Control"), "immutable") {
		t.Errorf("assets: %q", rec.Header().Get("Cache-Control"))
	}
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest("GET", "/", nil))
	if rec.Code != 200 || rec.Header().Get("Cache-Control") != "no-cache" {
		t.Errorf("index: %d %q", rec.Code, rec.Header().Get("Cache-Control"))
	}
}

// silentCatalogue never answers in time, or answers that it has nothing.
type silentCatalogue struct {
	catalog.Source
	err error
}

func (silentCatalogue) Ready() error { return nil }
func (c silentCatalogue) FindAlbum(context.Context, string, string) (catalog.Album, bool, error) {
	return catalog.Album{}, false, c.err
}

// The album page only shows what the library holds when the catalogue has no such album. Telling a slow catalogue apart
// from that is what lets it ask again, instead of staying short until the album is opened a second time.
func TestAlbumMatchTellsSlowFromMissing(t *testing.T) {
	cfg := &config.Config{NavidromeURL: fakeNavidrome(t).URL, MediaDir: t.TempDir(), UsersDir: t.TempDir()}
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	s, err := New(ctx, cfg, engine.New(cfg), fstest.MapFS{"index.html": {Data: []byte("<!doctype html>")}})
	if err != nil {
		t.Fatal(err)
	}
	s.eng.Catalog = silentCatalogue{err: context.DeadlineExceeded}
	if rec := call(t, s.Handler(), "GET", "/api/albums/match?name=SKINS&artist=XXXTENTACION", ""); rec.Code != http.StatusServiceUnavailable {
		t.Errorf("no answer in time: %d %s", rec.Code, rec.Body)
	}
	s.eng.Catalog = silentCatalogue{}
	if rec := call(t, s.Handler(), "GET", "/api/albums/match?name=SKINS&artist=XXXTENTACION", ""); rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"album":null`) {
		t.Errorf("no such album: %d %s", rec.Code, rec.Body)
	}
}
