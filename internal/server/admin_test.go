package server

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"github.com/Thrashy190/eco/internal/userdata"
)

// id3File writes an MP3-looking file with an ID3v2.3 title tag and the given total size, which is what
// library.FindSongFile needs to recognise a song.
func id3File(t *testing.T, path, title string, size int) {
	t.Helper()
	text := append([]byte{0}, []byte(title)...)
	frame := append([]byte("TIT2"), 0, 0, byte(len(text)>>8), byte(len(text)), 0, 0)
	frame = append(frame, text...)
	n := len(frame)
	data := append([]byte{'I', 'D', '3', 3, 0, 0, byte(n >> 21 & 0x7f), byte(n >> 14 & 0x7f), byte(n >> 7 & 0x7f), byte(n & 0x7f)}, frame...)
	data = append(data, make([]byte, size-len(data))...)
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, data, 0o644); err != nil {
		t.Fatal(err)
	}
}

// deletingNavidrome behaves like Navidrome 0.64 around a deleted file: after a scan the song is only marked missing and
// keeps answering, with its album, until DELETE /api/missing removes it; then the album, left empty, goes too.
type deletingNavidrome struct {
	mu       sync.Mutex
	marks    bool // whether a scan marks the deleted file missing (false: the scan has not reached it)
	missing  bool
	purged   bool
	purgeIDs []string
}

func (nd *deletingNavidrome) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	nd.mu.Lock()
	defer nd.mu.Unlock()
	ok := func(body map[string]any) {
		body["status"] = "ok"
		json.NewEncoder(w).Encode(map[string]any{"subsonic-response": body})
	}
	notFound := func(what string) {
		json.NewEncoder(w).Encode(map[string]any{"subsonic-response": map[string]any{"status": "failed", "error": map[string]any{"code": 70, "message": what + " not found"}}})
	}
	switch {
	case r.URL.Path == "/auth/login":
		var login map[string]string
		json.NewDecoder(r.Body).Decode(&login)
		if login["password"] != "right" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		json.NewEncoder(w).Encode(map[string]string{"token": "session"})
	case r.URL.Path == "/api/missing" && r.Method == http.MethodDelete:
		if r.Header.Get("x-nd-authorization") != "Bearer session" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		nd.purgeIDs = append(nd.purgeIDs, r.URL.Query()["id"]...)
		if nd.missing && r.URL.Query().Get("id") == "s1" {
			nd.purged = true
		}
		w.Write([]byte(`{}`))
	case strings.HasSuffix(r.URL.Path, "/getUser"):
		ok(map[string]any{"user": map[string]any{"adminRole": r.URL.Query().Get("u") == "admin"}})
	case strings.HasSuffix(r.URL.Path, "/startScan"):
		if nd.marks {
			nd.missing = true
		}
		ok(map[string]any{})
	case strings.HasSuffix(r.URL.Path, "/getSong"):
		if nd.purged {
			notFound("Song")
			return
		}
		ok(map[string]any{"song": map[string]any{"id": "s1", "title": "Un Scar", "artist": "CT Pluss", "artistId": "ar1", "album": "Un Scar", "albumId": "al1", "size": 4000, "suffix": "mp3"}})
	case strings.HasSuffix(r.URL.Path, "/getAlbum"):
		if nd.purged {
			notFound("Album")
			return
		}
		ok(map[string]any{"album": map[string]any{"id": "al1"}})
	case strings.HasSuffix(r.URL.Path, "/getArtist"):
		ok(map[string]any{"artist": map[string]any{"id": "ar1"}}) // the artist has other albums
	default:
		ok(map[string]any{})
	}
}

func deletionServer(t *testing.T, marks bool) (*Server, http.Handler, *deletingNavidrome, string) {
	t.Helper()
	s, h := accountsServer(t)
	nd := &deletingNavidrome{marks: marks}
	fake := httptest.NewServer(nd)
	t.Cleanup(fake.Close)
	s.nd.BaseURL = fake.URL
	file := filepath.Join(s.cfg.MusicDir, "YouTube", "CT Pluss", "Un Scar", "01 - Un Scar.mp3")
	id3File(t, file, "Un Scar", 4000)
	for _, user := range []string{"admin", "ana"} {
		s.users.Touch(user, userdata.Entry{Type: "album", ID: "al1", Name: "Un Scar"})
		s.users.Pin(user, userdata.Entry{Type: "artist", ID: "ar1", Name: "CT Pluss"})
	}
	return s, h, nd, file
}

func has(entries []userdata.Entry, kind, id string) bool {
	for _, e := range entries {
		if e.Type == kind && e.ID == id {
			return true
		}
	}
	return false
}

// A deleted song used to stay in Navidrome as missing, and an album it left empty stayed in Recent, greyed out in
// Navidrome. Deleting now needs the session that lets Eco remove it there, and asks before touching the file.
func TestDeletingASongNeedsThePasswordFirst(t *testing.T) {
	_, h, nd, file := deletionServer(t, true)
	rec := as(t, h, "admin", "DELETE", "/api/admin/songs/s1", "")
	if rec.Code != http.StatusPreconditionRequired || !strings.Contains(rec.Body.String(), `"locked":true`) {
		t.Fatalf("without a session: %d %s", rec.Code, rec.Body)
	}
	if _, err := os.Stat(file); err != nil {
		t.Fatal("the file went before the session was open")
	}
	if rec := as(t, h, "admin", "POST", "/api/admin/cleanup/duplicates", `{"keep":"s2","remove":["s1"]}`); rec.Code != http.StatusPreconditionRequired {
		t.Errorf("removing a duplicate without a session: %d %s", rec.Code, rec.Body)
	}
	if len(nd.purgeIDs) != 0 {
		t.Errorf("asked Navidrome to remove %v", nd.purgeIDs)
	}
}

func TestDeletingASongRemovesItFromNavidrome(t *testing.T) {
	s, h, nd, file := deletionServer(t, true)
	if rec := as(t, h, "admin", "POST", "/api/admin/unlock", `{"password":"right"}`); rec.Code != http.StatusOK {
		t.Fatalf("unlocking: %d %s", rec.Code, rec.Body)
	}
	rec := as(t, h, "admin", "DELETE", "/api/admin/songs/s1", "")
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"purged":true`) {
		t.Fatalf("deleting: %d %s", rec.Code, rec.Body)
	}
	if _, err := os.Stat(file); !os.IsNotExist(err) {
		t.Error("the file is still there")
	}
	if !nd.purged || len(nd.purgeIDs) == 0 || nd.purgeIDs[0] != "s1" {
		t.Errorf("Navidrome was asked to remove %v", nd.purgeIDs)
	}
	for _, user := range []string{"admin", "ana"} {
		st := s.users.Get(user)
		if has(st.Recents, "album", "al1") {
			t.Errorf("%s: the emptied album is still in Recent", user)
		}
		if !has(st.Pins, "artist", "ar1") {
			t.Errorf("%s: lost the pin of an artist who still has albums", user)
		}
	}
}

// When the scan has not marked the song missing yet, Navidrome removes nothing. The file is gone all the same, so it
// is a success that says Navidrome still lists the song, and the album stays where it was.
func TestDeletingASongNavidromeHasNotNoticed(t *testing.T) {
	old := purgeWait
	purgeWait = 0
	t.Cleanup(func() { purgeWait = old })
	s, h, _, file := deletionServer(t, false)
	as(t, h, "admin", "POST", "/api/admin/unlock", `{"password":"right"}`)
	rec := as(t, h, "admin", "DELETE", "/api/admin/songs/s1", "")
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"purged":false`) {
		t.Fatalf("deleting: %d %s", rec.Code, rec.Body)
	}
	if _, err := os.Stat(file); !os.IsNotExist(err) {
		t.Error("the file is still there")
	}
	if !has(s.users.Get("admin").Recents, "album", "al1") {
		t.Error("forgot an album Navidrome still has")
	}
}
