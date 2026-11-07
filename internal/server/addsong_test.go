package server

import (
	"bytes"
	"context"
	"encoding/json"
	"image"
	"image/jpeg"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"testing/fstest"

	"github.com/Thrashy190/eco/internal/catalog"
	"github.com/Thrashy190/eco/internal/config"
	"github.com/Thrashy190/eco/internal/engine"
	"github.com/Thrashy190/eco/internal/library"
	"github.com/Thrashy190/eco/internal/subsonic"
	ecotag "github.com/Thrashy190/eco/internal/tag"
)

func TestSongMetaChecksWhatWasTyped(t *testing.T) {
	m, err := songMeta(addSongRequest{Title: "  Ew  ", Artists: []string{" Joji ", "", "joji", "Diplo"}, Track: 3})
	if err != nil {
		t.Fatal(err)
	}
	if m.Title != "Ew" || strings.Join(m.Artists, "|") != "Joji|Diplo" || m.Artist != "Joji, Diplo" || m.Track != 3 {
		t.Errorf("meta = %+v", m)
	}
	bad := map[string]addSongRequest{
		"no title":         {Artists: []string{"Joji"}},
		"no artist":        {Title: "Ew", Artists: []string{" "}},
		"semicolon":        {Title: "Ew", Artists: []string{"Joji; Diplo"}}, // the tag separator: it would make two artists
		"track":            {Title: "Ew", Artists: []string{"Joji"}, Track: -1},
		"disc":             {Title: "Ew", Artists: []string{"Joji"}, Disc: 100},
		"too many artists": {Title: "Ew", Artists: strings.Split("a b c d e f g h i j k", " ")},
	}
	for name, req := range bad {
		if _, err := songMeta(req); err == nil {
			t.Errorf("%s: accepted", name)
		}
	}
}

func TestNewAlbumMeta(t *testing.T) {
	song := catalog.Meta{Title: "Ew", Artists: []string{"Joji", "Diplo"}, Artist: "Joji, Diplo"}
	m, err := newAlbumMeta(song, addSongAlbum{Name: "Nectar", Date: "2020-09-25"})
	if err != nil {
		t.Fatal(err)
	}
	if m.Album != "Nectar" || strings.Join(m.AlbumArtists, "|") != "Joji|Diplo" || m.Date != "2020-09-25" {
		t.Errorf("an album by nobody in particular is by the song's artists: %+v", m)
	}
	m, _ = newAlbumMeta(song, addSongAlbum{Name: "Nectar", Artists: []string{"Joji"}, Date: "2020"})
	if m.AlbumArtist != "Joji" || m.Date != "2020" {
		t.Errorf("meta = %+v", m)
	}
	for _, a := range []addSongAlbum{{}, {Name: "Nectar", Date: "25/09/2020"}, {Name: "Nectar", Date: "2020-9"}, {Name: "N", Artists: []string{"A;B"}}} {
		if _, err := newAlbumMeta(song, a); err == nil {
			t.Errorf("%+v accepted", a)
		}
	}
}

func jpegOf(t *testing.T, w, h int) []byte {
	t.Helper()
	var out bytes.Buffer
	if err := jpeg.Encode(&out, image.NewRGBA(image.Rect(0, 0, w, h)), nil); err != nil {
		t.Fatal(err)
	}
	return out.Bytes()
}

// hqdefault.jpg is 4:3 with black bars around a 16:9 frame: the cover is a square of the frame, not of the bars.
func TestSquareFrame(t *testing.T) {
	for _, c := range []struct{ w, h, side int }{{1280, 720, 720}, {480, 360, 270}, {300, 300, 168}} {
		img, err := jpeg.DecodeConfig(bytes.NewReader(squareFrame(jpegOf(t, c.w, c.h))))
		if err != nil || img.Width != c.side || img.Height != c.side {
			t.Errorf("%dx%d gave %dx%d (%v), want %d", c.w, c.h, img.Width, img.Height, err, c.side)
		}
	}
	if squareFrame([]byte("not a picture")) != nil {
		t.Error("made a cover out of nothing")
	}
}

// Everything that can be refused is refused before asking YouTube.
func TestAddSongRefusesBeforeDownloading(t *testing.T) {
	_, h, _ := libraryServer(t)
	for name, body := range map[string]string{
		"not youtube": `{"url":"http://192.168.1.1/x","title":"Ew","artists":["Joji"],"album":{"name":"Nectar"}}`,
		"no album":    `{"url":"https://youtu.be/dQw4w9WgXcQ","title":"Ew","artists":["Joji"],"album":{}}`,
		"bad album":   `{"url":"https://youtu.be/dQw4w9WgXcQ","title":"Ew","artists":["Joji"],"album":{"library":"../x"}}`,
		"bad cover":   `{"url":"https://youtu.be/dQw4w9WgXcQ","title":"Ew","artists":["Joji"],"album":{"name":"N","cover":"upload","picture":"PHNjcmlwdD4="}}`,
		"no title":    `{"url":"https://youtu.be/dQw4w9WgXcQ","artists":["Joji"],"album":{"name":"N"}}`,
		"not json":    `{`,
	} {
		if rec := as(t, h, "diego", "POST", "/api/songs/add", body); rec.Code != http.StatusBadRequest {
			t.Errorf("%s: %d %s", name, rec.Code, rec.Body)
		}
	}
}

// A song added to an album in the library repeats the album's tags as its files write them, and goes in its folder.
func TestJoinLibraryAlbumRepeatsItsFiles(t *testing.T) {
	ffmpeg, err := exec.LookPath("ffmpeg")
	if err != nil {
		t.Skip("ffmpeg is not installed")
	}
	dir := t.TempDir()
	cfg := &config.Config{MediaDir: filepath.Join(dir, "media"), UsersDir: filepath.Join(dir, "users"), MusicDir: filepath.Join(dir, "music"), DataDir: dir, FFmpeg: ffmpeg}
	existing := catalog.Meta{Title: "Ew", Artist: "Joji", AlbumArtists: []string{"Joji", "Diplo"}, AlbumArtist: "Joji, Diplo", Album: "Nectar", Date: "2020-09-25", Track: 1, Tracks: 18}
	path := library.DestPath(existing, "m4a", filepath.Join(cfg.MusicDir, "YouTube"))
	os.MkdirAll(filepath.Dir(path), 0o755)
	if out, err := exec.Command(ffmpeg, "-y", "-loglevel", "error", "-f", "lavfi", "-i", "anullsrc=r=44100:cl=mono", "-t", "1", "-c:a", "aac", path).CombinedOutput(); err != nil {
		t.Skipf("ffmpeg cannot make a test file: %s", out)
	}
	if err := ecotag.Write(context.Background(), ffmpeg, path, "m4a", existing, nil); err != nil {
		t.Fatal(err)
	}
	info, _ := os.Stat(path)
	cover := jpegOf(t, 40, 40)
	nd := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, "getCoverArt") {
			w.Header().Set("Content-Type", "image/jpeg")
			w.Write(cover)
			return
		}
		// Navidrome shows the album artist its own way and only knows the year
		json.NewEncoder(w).Encode(map[string]any{"subsonic-response": map[string]any{"status": "ok", "album": map[string]any{
			"id": "al-1", "name": "Nectar", "artist": "Joji • Diplo", "year": 2020, "coverArt": "al-1",
			"song": []map[string]any{{"id": "s1", "title": "Ew", "size": info.Size(), "suffix": "m4a", "displayAlbumArtist": "Joji • Diplo"}},
		}}})
	}))
	defer nd.Close()
	cfg.NavidromeURL = nd.URL
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	s, err := New(ctx, cfg, engine.New(cfg), fstest.MapFS{"index.html": {Data: []byte("x")}})
	if err != nil {
		t.Fatal(err)
	}
	m, folder, got, err := s.joinLibraryAlbum(ctx, subsonic.Cred{User: "diego", Token: "t", Salt: "s"}, "al-1", catalog.Meta{Title: "Sanctuary", Artists: []string{"Joji"}, Artist: "Joji", Track: 8})
	if err != nil {
		t.Fatal(err)
	}
	if m.Album != "Nectar" || m.AlbumArtist != "Joji; Diplo" || len(m.AlbumArtists) != 0 || m.Date != "2020-09-25" || m.Tracks != 18 {
		t.Errorf("meta = %+v", m)
	}
	if m.Title != "Sanctuary" || m.Track != 8 {
		t.Errorf("changed the song itself: %+v", m)
	}
	if folder != filepath.Dir(path) {
		t.Errorf("folder = %s", folder)
	}
	if !bytes.Equal(got, cover) {
		t.Error("the album's cover was not kept")
	}
}
