package server

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/Thrashy190/eco/internal/media"
)

// fakeProbe is an ffprobe that answers what a book file would.
func fakeProbe(t *testing.T, answer string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "ffprobe")
	if err := os.WriteFile(path, []byte("#!/bin/sh\ncat <<'JSON'\n"+answer+"\nJSON\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	return path
}

// A file sent in pieces becomes a part of the chosen book, with the chapters inside it; it is the sender's to change.
func TestUploadingABook(t *testing.T) {
	s, h := accountsServer(t)
	s.cfg.FFprobe = fakeProbe(t, `{"format":{"format_name":"mov,mp4,m4a","duration":"3600","tags":{"artist":"Frank Herbert"}},"streams":[{"codec_type":"audio","codec_name":"aac"}],"chapters":[{"start_time":"0","tags":{"title":"One"}},{"start_time":"900","tags":{"title":"Two"}}]}`)
	book, _ := s.media.CreateCollection(media.Collection{Kind: "audiobook", Title: "Dune"}, "bob")
	rec := as(t, h, "ana", "POST", "/api/uploads", `{"kind":"audiobook","collection":"`+book.ID+`","name":"Dune part 1.m4b","size":8}`)
	var started struct {
		Upload media.Upload `json:"upload"`
		Chunk  int          `json:"chunk"`
	}
	if json.Unmarshal(rec.Body.Bytes(), &started); rec.Code != http.StatusCreated || started.Chunk != media.ChunkSize {
		t.Fatalf("start: %d %s", rec.Code, rec.Body)
	}
	id := started.Upload.ID
	as(t, h, "ana", "PUT", "/api/uploads/"+id+"?offset=0", "1234")
	if rec := as(t, h, "ana", "PUT", "/api/uploads/"+id+"?offset=0", "1234"); rec.Code != http.StatusConflict || !strings.Contains(rec.Body.String(), `"received":4`) {
		t.Errorf("a piece sent twice: %d %s", rec.Code, rec.Body)
	}
	if rec := as(t, h, "bob", "GET", "/api/uploads/"+id, ""); rec.Code != http.StatusNotFound {
		t.Errorf("bob sees ana's upload: %d", rec.Code)
	}
	as(t, h, "ana", "PUT", "/api/uploads/"+id+"?offset=4", "5678")
	rec = as(t, h, "ana", "POST", "/api/uploads/"+id+"/finish", "")
	var it media.Item
	if json.Unmarshal(rec.Body.Bytes(), &it); rec.Code != http.StatusCreated || it.Parent != book.ID || it.Part != 1 || it.Title != "Dune part 1" || it.AddedBy != "ana" || it.File != "media.m4b" || it.Duration != 3600 {
		t.Fatalf("finish: %d %s", rec.Code, rec.Body)
	}
	if chapters := s.media.Chapters(it); len(chapters) != 2 || chapters[1].Title != "Two" {
		t.Errorf("chapters: %+v", chapters)
	}
	if rec := as(t, h, "ana", "GET", "/api/media/"+it.ID+"/file", ""); rec.Code != http.StatusOK || rec.Header().Get("Content-Type") != "audio/mp4" || rec.Body.String() != "12345678" {
		t.Errorf("serving it: %d %q %s", rec.Code, rec.Header().Get("Content-Type"), rec.Body)
	}
	if rec := as(t, h, "bob", "DELETE", "/api/media/"+it.ID, ""); rec.Code != http.StatusForbidden {
		t.Errorf("bob deleted ana's upload: %d", rec.Code)
	}
}

// Something that is not audio never reaches the library.
func TestUploadThatIsNotAudioIsThrownAway(t *testing.T) {
	s, h := accountsServer(t)
	s.cfg.FFprobe = fakeProbe(t, `{"format":{"format_name":"png_pipe"},"streams":[{"codec_type":"video","codec_name":"png"}]}`)
	var started struct {
		Upload media.Upload `json:"upload"`
	}
	json.Unmarshal(as(t, h, "ana", "POST", "/api/uploads", `{"kind":"podcast","name":"ep.mp3","size":3}`).Body.Bytes(), &started)
	as(t, h, "ana", "PUT", "/api/uploads/"+started.Upload.ID+"?offset=0", "png")
	if rec := as(t, h, "ana", "POST", "/api/uploads/"+started.Upload.ID+"/finish", ""); rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("finish: %d %s", rec.Code, rec.Body)
	}
	if n := len(s.media.List("")); n != 0 {
		t.Errorf("%d items in the library", n)
	}
	if entries, _ := os.ReadDir(filepath.Join(s.cfg.MediaDir, ".uploads")); len(entries) != 0 {
		t.Errorf("the refused file is still on disk: %v", entries)
	}
}
