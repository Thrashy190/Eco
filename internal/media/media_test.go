package media

import (
	"os"
	"path/filepath"
	"testing"
)

func TestStoreRoundTrip(t *testing.T) {
	s := Store{Root: t.TempDir()}
	it := Item{ID: "dQw4w9WgXcQ", Kind: "podcast", Title: "Episode", File: "media.m4a", AddedAt: 5}
	if err := os.MkdirAll(s.Dir(it.Kind, it.ID), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := s.Save(it); err != nil {
		t.Fatal(err)
	}
	got, err := s.Find(it.ID)
	if err != nil || got.Title != "Episode" {
		t.Fatalf("Find: %v %+v", err, got)
	}
	if n := len(s.List("")); n != 1 {
		t.Fatalf("List all = %d", n)
	}
	if n := len(s.List("video")); n != 0 {
		t.Fatalf("List video = %d", n)
	}
	if err := s.Delete(it.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Find(it.ID); err == nil {
		t.Fatal("deleted item still found")
	}
}

// IDs and kinds become path segments: nothing that could climb out of the root may pass.
func TestPathsCannotEscape(t *testing.T) {
	for _, bad := range []string{"../etc", "a/b", "..", "", "x", "id with space", "a\x00b"} {
		if ValidID(bad) {
			t.Errorf("ValidID(%q) = true", bad)
		}
	}
	if ValidKind("../podcast") || ValidKind("") || ValidKind("video") {
		t.Error("invalid kind accepted")
	}
	s := Store{Root: "/data/media"}
	if p := s.Path(Item{ID: "abcdefgh", Kind: "podcast"}, "../../meta.json"); filepath.Dir(p) != "/data/media/podcast/abcdefgh" {
		t.Errorf("file name escaped: %s", p)
	}
	if _, err := (Store{Root: t.TempDir()}).Find("../etc/passwd"); err == nil {
		t.Error("Find accepted a traversal")
	}
}
