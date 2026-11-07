package server

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"testing/fstest"

	"github.com/Thrashy190/eco/internal/config"
	"github.com/Thrashy190/eco/internal/engine"
	"github.com/Thrashy190/eco/internal/subsonic"
)

func codes(issue albumIssue) string {
	out := []string{}
	for _, p := range issue.Problems {
		out = append(out, p.Code)
	}
	return strings.Join(out, ",")
}

func TestFindAlbumIssues(t *testing.T) {
	tagged := func(id, title, album, albumID string, year, track int) subsonic.Song {
		return subsonic.Song{ID: id, Title: title, Artist: "Joji", AlbumArtist: "Joji", Album: album, AlbumID: albumID, Year: year, Track: track, Disc: 1}
	}
	songs := []subsonic.Song{
		tagged("1", "Ew", "Nectar", "al-n", 2020, 1), tagged("2", "Sanctuary", "Nectar", "al-n", 2020, 2), // fine
		tagged("3", "Glimpse", "Ballads", "al-b", 0, 0), tagged("4", "Slow (Official Video)", "Ballads", "al-b", 0, 0),
		tagged("5", "A", "Smithereens", "al-s1", 2022, 1), tagged("6", "B", "Smithereens", "al-s2", 2022, 1), tagged("7", "C", "Smithereens", "al-s2", 2022, 1),
		{ID: "8", Title: "Lost", Album: "Odd", AlbumID: "al-o", Year: 2019, Track: 1},
	}
	noCover := map[string]bool{"3": true} // Ballads has no picture; Smithereens' files are not on disk
	issues := findAlbumIssues(songs, func(s subsonic.Song) (bool, bool) {
		if s.AlbumID == "al-s1" || s.AlbumID == "al-s2" {
			return false, false
		}
		return !noCover[s.ID], true
	})
	got := map[string]string{}
	for _, i := range issues {
		got[i.ID] = codes(i)
	}
	want := map[string]string{
		"al-b":  "no_cover,no_year,no_tracks,video_title",
		"al-s1": "split",
		"al-s2": "same_track,split",
		"al-o":  "no_artist",
	}
	if len(got) != len(want) {
		t.Errorf("issues = %v", got)
	}
	for id, w := range want {
		if got[id] != w {
			t.Errorf("%s: %q, want %q", id, got[id], w)
		}
	}
}

// An administrator's picture becomes a cover.jpg next to the album's songs; one already there is never replaced.
func TestCleanupCoverWritesNextToTheSongs(t *testing.T) {
	dir := t.TempDir()
	cfg := &config.Config{MediaDir: filepath.Join(dir, "media"), UsersDir: filepath.Join(dir, "users"), MusicDir: filepath.Join(dir, "music"), DataDir: dir, FFmpeg: "ffmpeg"}
	album := filepath.Join(cfg.MusicDir, "YouTube", "Joji", "Nectar")
	os.MkdirAll(album, 0o755)
	os.WriteFile(filepath.Join(album, "01 - Ew.m4a"), []byte("not really audio"), 0o644)
	nd := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		var body map[string]any
		switch filepath.Base(r.URL.Path) {
		case "getUser":
			body = map[string]any{"user": map[string]any{"adminRole": q.Get("u") == "admin"}}
		case "getAlbum":
			body = map[string]any{"album": map[string]any{"id": "al-1", "name": "Nectar", "song": []map[string]any{{"id": "s1", "title": "Ew", "size": 16, "suffix": "m4a"}}}}
		default:
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
	picture := jpegOf(t, 16, 16)
	body := `{"picture":"` + base64.StdEncoding.EncodeToString(picture) + `"}`

	if rec := as(t, h, "diego", "PUT", "/api/admin/cleanup/covers/al-1", body); rec.Code != http.StatusForbidden {
		t.Errorf("not an administrator: %d", rec.Code)
	}
	if rec := as(t, h, "admin", "PUT", "/api/admin/cleanup/covers/al-1", `{"picture":"PHNjcmlwdD4="}`); rec.Code != http.StatusBadRequest {
		t.Errorf("not a picture: %d", rec.Code)
	}
	if rec := as(t, h, "admin", "PUT", "/api/admin/cleanup/covers/al-1", body); rec.Code != http.StatusOK {
		t.Fatalf("%d %s", rec.Code, rec.Body)
	}
	if got, _ := os.ReadFile(filepath.Join(album, "cover.jpg")); !bytes.Equal(got, picture) {
		t.Error("cover.jpg is not the picture")
	}
	if rec := as(t, h, "admin", "PUT", "/api/admin/cleanup/covers/al-1", `{"picture":"`+base64.StdEncoding.EncodeToString(jpegOf(t, 20, 20))+`"}`); rec.Code != http.StatusConflict {
		t.Errorf("replaced a cover: %d", rec.Code)
	}
	if got, _ := os.ReadFile(filepath.Join(album, "cover.jpg")); !bytes.Equal(got, picture) {
		t.Error("the cover changed")
	}
}
