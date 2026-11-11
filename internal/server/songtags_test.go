package server

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"testing/fstest"

	"github.com/Thrashy190/eco/internal/config"
	"github.com/Thrashy190/eco/internal/engine"
	"github.com/Thrashy190/eco/internal/library"
)

// Two songs of Calle 13 downloaded as "C13": the artist is corrected by hand, and the album with it, without splitting it.
func TestSongChangesWritesOnlyWhatDiffers(t *testing.T) {
	now := library.SongTags{Title: "Atrévete-te-te", Artists: []string{"C13"}, Album: "Calle 13", AlbumArtists: []string{"C13"}, Date: "2005-11-29", Track: 3, Tracks: 15, Genre: ""}
	want, err := songEdit{Title: " Atrévete-te-te ", Artists: []string{"Calle 13"}, Album: "Calle 13", AlbumArtists: []string{"Calle 13"}, Date: "2005-11-29", Track: 4}.cleaned()
	if err != nil {
		t.Fatal(err)
	}
	got := songChanges(now, want)
	wanted := map[string]string{"artist": "Calle 13", "album_artist": "Calle 13", "track": "4/15"}
	if len(got) != len(wanted) {
		t.Errorf("got %v, want %v", got, wanted)
	}
	for k, v := range wanted {
		if got[k] != v {
			t.Errorf("%s = %q, want %q", k, got[k], v)
		}
	}
	// The songs beside it only take the album's tags, never this one's title or artists
	if got := albumChanges(library.SongTags{Title: "Suave", Artists: []string{"C13"}, Album: "Calle 13", AlbumArtists: []string{"C13"}, Date: "2005-11-29"}, want); len(got) != 1 || got["album_artist"] != "Calle 13" {
		t.Errorf("album changes = %v", got)
	}
	// Several artists are written with the separator Navidrome splits on; a comma stays part of a name
	two, _ := songEdit{Title: "x", Album: "y", Artists: []string{"Tyler, The Creator", "Kali Uchis"}}.cleaned()
	if got := songChanges(library.SongTags{Title: "x", Album: "y"}, two)["artist"]; got != "Tyler, The Creator; Kali Uchis" {
		t.Errorf("artist = %q", got)
	}
	// A number set to nothing takes the tag away
	if got, ok := songChanges(library.SongTags{Title: "x", Album: "y", Artists: []string{"a"}, Track: 2}, songEdit{Title: "x", Album: "y", Artists: []string{"a"}})["track"]; !ok || got != "" {
		t.Errorf("track = %q, %v", got, ok)
	}
}

func TestSongEditsAreChecked(t *testing.T) {
	for name, e := range map[string]songEdit{
		"no title":  {Album: "a", Artists: []string{"b"}},
		"no artist": {Title: "t", Album: "a"},
		"no album":  {Title: "t", Artists: []string{"b"}},
		"semicolon": {Title: "t", Album: "a", Artists: []string{"A; B"}},
		"bad date":  {Title: "t", Album: "a", Artists: []string{"b"}, Date: "last year"},
		"track":     {Title: "t", Album: "a", Artists: []string{"b"}, Track: 1000},
	} {
		if _, err := e.cleaned(); err == nil {
			t.Errorf("%s: accepted", name)
		}
	}
}

func makeTagged(t *testing.T, ffmpeg, path, title, artist string) {
	t.Helper()
	os.MkdirAll(filepath.Dir(path), 0o755)
	if out, err := exec.Command(ffmpeg, "-y", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=1", "-c:a", "aac",
		"-metadata", "title="+title, "-metadata", "artist="+artist, "-metadata", "album_artist="+artist, "-metadata", "album=Calle 13", "-metadata", "date=2005", path).CombinedOutput(); err != nil {
		t.Skipf("ffmpeg cannot make a test file: %s", out)
	}
}

func TestEditingASongRetagsItWhereItIs(t *testing.T) {
	ffmpeg, err := exec.LookPath("ffmpeg")
	if err != nil {
		t.Skip("ffmpeg is not installed")
	}
	dir := t.TempDir()
	cfg := &config.Config{MediaDir: filepath.Join(dir, "media"), UsersDir: filepath.Join(dir, "users"), MusicDir: filepath.Join(dir, "music"), DataDir: dir, FFmpeg: ffmpeg}
	folder := filepath.Join(cfg.MusicDir, "YouTube", "C13", "Calle 13")
	one, two := filepath.Join(folder, "01 - Atrévete.m4a"), filepath.Join(folder, "02 - Suave.m4a")
	makeTagged(t, ffmpeg, one, "Atrévete", "C13")
	makeTagged(t, ffmpeg, two, "Suave", "C13")
	sizes := map[string]int64{}
	for id, path := range map[string]string{"s1": one, "s2": two} {
		info, _ := os.Stat(path)
		sizes[id] = info.Size()
	}
	songs := []map[string]any{
		{"id": "s1", "title": "Atrévete", "albumId": "al-1", "size": sizes["s1"], "suffix": "m4a"},
		{"id": "s2", "title": "Suave", "albumId": "al-1", "size": sizes["s2"], "suffix": "m4a"},
	}
	nd := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		var body map[string]any
		switch filepath.Base(r.URL.Path) {
		case "getUser":
			body = map[string]any{"user": map[string]any{"adminRole": q.Get("u") == "admin"}}
		case "getSong":
			for _, s := range songs {
				if s["id"] == q.Get("id") {
					body = map[string]any{"song": s}
				}
			}
		case "getAlbum":
			body = map[string]any{"album": map[string]any{"id": "al-1", "name": "Calle 13", "song": songs}}
		}
		if body == nil {
			body = map[string]any{}
		}
		body["status"] = "ok"
		json.NewEncoder(w).Encode(map[string]any{"subsonic-response": body})
	}))
	defer nd.Close()
	cfg.NavidromeURL = nd.URL
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	s, err := New(ctx, cfg, engine.New(cfg), fstest.MapFS{"index.html": {Data: []byte("x")}})
	if err != nil {
		t.Fatal(err)
	}
	h := s.Handler()
	edit := `{"title":"Atrévete-te-te","artists":["Calle 13"],"album":"Calle 13","album_artists":["Calle 13"],"date":"2005","whole_album":true}`

	if rec := as(t, h, "ana", "PUT", "/api/admin/songs/s1/tags", edit); rec.Code != http.StatusForbidden {
		t.Errorf("not an administrator: %d", rec.Code)
	}
	rec := as(t, h, "admin", "GET", "/api/admin/songs/s1/tags", "")
	var read struct {
		Tags   library.SongTags `json:"tags"`
		Others int              `json:"album_songs"`
	}
	json.Unmarshal(rec.Body.Bytes(), &read)
	if rec.Code != http.StatusOK || read.Tags.Artists[0] != "C13" || read.Others != 1 {
		t.Fatalf("%d %s", rec.Code, rec.Body)
	}
	if rec := as(t, h, "admin", "PUT", "/api/admin/songs/s1/tags", edit); rec.Code != http.StatusOK {
		t.Fatalf("%d %s", rec.Code, rec.Body)
	}
	first, err := library.ReadSongTags(one)
	if err != nil || first.Title != "Atrévete-te-te" || first.Artists[0] != "Calle 13" || first.AlbumArtists[0] != "Calle 13" {
		t.Errorf("first song: %+v %v", first, err)
	}
	second, err := library.ReadSongTags(two)
	if err != nil || second.Title != "Suave" || second.Artists[0] != "C13" || second.AlbumArtists[0] != "Calle 13" {
		t.Errorf("the song beside it: %+v %v", second, err)
	}
	if _, err := os.Stat(one); err != nil {
		t.Error("the file moved")
	}
	backups, _ := filepath.Glob(filepath.Join(dir, "backup", "edits-*", "YouTube", "C13", "Calle 13", "*.m4a"))
	if len(backups) != 2 {
		t.Errorf("backups: %v", backups)
	}
}
