package media

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// A file arrives in pieces; one sent again after a failure is refused and says where to go on; nobody else can see,
// add to or take another person's upload.
func TestUploadInPieces(t *testing.T) {
	s := Store{Root: t.TempDir()}
	if _, err := s.StartUpload(Upload{User: "ana", Kind: "audiobook", Name: "Book.m4b", Size: 2000}, 1000); err == nil {
		t.Fatal("a file over the limit was accepted")
	}
	u, err := s.StartUpload(Upload{User: "ana", Kind: "audiobook", Name: "../../Book.m4b", Size: 10}, 1000)
	if err != nil || u.Name != "Book.m4b" {
		t.Fatalf("start: %+v %v", u, err)
	}
	if _, err := s.AppendUpload(u.ID, "bob", 0, strings.NewReader("hello")); !errors.Is(err, ErrNoUpload) {
		t.Errorf("bob added to ana's upload: %v", err)
	}
	if got, err := s.AppendUpload(u.ID, "ana", 0, strings.NewReader("hello")); err != nil || got.Received != 5 {
		t.Fatalf("first piece: %+v %v", got, err)
	}
	if got, err := s.AppendUpload(u.ID, "ana", 0, strings.NewReader("hello")); !errors.Is(err, ErrWrongOffset) || got.Received != 5 {
		t.Errorf("a piece sent twice: %+v %v", got, err)
	}
	if _, _, err := s.TakeUpload(u.ID, "ana"); err == nil {
		t.Error("half a file was taken")
	}
	if _, err := s.AppendUpload(u.ID, "ana", 5, strings.NewReader("world, and more")); err == nil {
		t.Error("more than the file's size was accepted")
	}
	if got, _ := s.GetUpload(u.ID, "ana"); got.Received != 5 {
		t.Errorf("a refused piece left something behind: %d", got.Received)
	}
	s.AppendUpload(u.ID, "ana", 5, strings.NewReader("world"))
	if _, _, err := s.TakeUpload(u.ID, "bob"); !errors.Is(err, ErrNoUpload) {
		t.Errorf("bob took ana's file: %v", err)
	}
	_, dir, err := s.TakeUpload(u.ID, "ana")
	if err != nil {
		t.Fatal(err)
	}
	it := Item{ID: NewItemID(), Kind: "audiobook", Title: "Book"}
	if err := s.FileItem(it, dir, "media.m4b", ""); err != nil {
		t.Fatal(err)
	}
	got, err := s.Find(it.ID)
	if data, _ := os.ReadFile(s.Path(got, got.File)); err != nil || string(data) != "helloworld" {
		t.Fatalf("filed: %+v %q %v", got, data, err)
	}
	if len(s.Uploads()) != 0 {
		t.Error("a filed upload is still listed")
	}
}

func TestUploadLimitsAndCleaning(t *testing.T) {
	s := Store{Root: t.TempDir()}
	for i := range MaxOpenUploads {
		if _, err := s.StartUpload(Upload{User: "ana", Kind: "podcast", Name: "e.mp3", Size: 1}, 10); err != nil {
			t.Fatalf("upload %d: %v", i, err)
		}
	}
	if _, err := s.StartUpload(Upload{User: "Ana", Kind: "podcast", Name: "e.mp3", Size: 1}, 10); err == nil {
		t.Error("ana sent more files at once than allowed")
	}
	if _, err := s.StartUpload(Upload{User: "bob", Kind: "podcast", Name: "e.mp3", Size: 1}, 10); err != nil {
		t.Errorf("ana's uploads held bob back: %v", err)
	}
	old := time.Now().Add(-48 * time.Hour)
	for _, u := range s.Uploads() {
		if u.User == "ana" {
			os.Chtimes(filepath.Join(s.uploadDir(u.ID), "data"), old, old)
		}
	}
	s.CleanUploads(24 * time.Hour)
	if n := len(s.Uploads()); n != 1 {
		t.Errorf("after cleaning, %d uploads are left", n)
	}
}

// What ffprobe says decides what a file is, never its name.
func TestParseProbe(t *testing.T) {
	book := `{"format":{"format_name":"mov,mp4,m4a,3gp,3g2,mj2","duration":"7260.5","tags":{"title":"Dune","artist":"Frank Herbert","comment":"A desert planet"}},
	"streams":[{"codec_type":"audio","codec_name":"aac"},{"codec_type":"video","codec_name":"mjpeg","disposition":{"attached_pic":1}}],
	"chapters":[{"start_time":"0.000","tags":{"title":"Opening"}},{"start_time":"1800.0","tags":{}}]}`
	p, err := parseProbe([]byte(book), "dune.M4B")
	if err != nil || p.Ext != ".m4b" || p.Title != "Dune" || p.Artist != "Frank Herbert" || !p.Picture || p.Duration != 7260.5 || p.Comment != "A desert planet" {
		t.Fatalf("book: %+v %v", p, err)
	}
	if len(p.Chapters) != 2 || p.Chapters[1].Title != "Chapter 2" || p.Chapters[1].Start != 1800 {
		t.Errorf("chapters: %+v", p.Chapters)
	}
	for name, raw := range map[string]string{
		"ogg opus":  `{"format":{"format_name":"ogg"},"streams":[{"codec_type":"audio","codec_name":"opus"}]}`,
		"plain mp3": `{"format":{"format_name":"mp3"},"streams":[{"codec_type":"audio","codec_name":"mp3"}]}`,
	} {
		if _, err := parseProbe([]byte(raw), "x.bin"); err != nil {
			t.Errorf("%s refused: %v", name, err)
		}
	}
	for name, raw := range map[string]string{
		"a picture":  `{"format":{"format_name":"png_pipe"},"streams":[{"codec_type":"video","codec_name":"png"}]}`,
		"a video":    `{"format":{"format_name":"mov,mp4,m4a"},"streams":[{"codec_type":"video","codec_name":"h264"},{"codec_type":"audio","codec_name":"aac"}]}`,
		"a document": `not json`,
		"unknown":    `{"format":{"format_name":"asf"},"streams":[{"codec_type":"audio","codec_name":"wmav2"}]}`,
	} {
		if _, err := parseProbe([]byte(raw), "x.mp3"); err == nil {
			t.Errorf("%s was accepted", name)
		}
	}
}
