package userdata

import (
	"bytes"
	"image"
	"image/jpeg"
	"path/filepath"
	"strings"
	"testing"
)

func entry(kind, id string) Entry { return Entry{Type: kind, ID: id, Name: id} }

func TestTouchMovesToFrontWithoutDuplicates(t *testing.T) {
	s := &Store{Root: t.TempDir()}
	for _, id := range []string{"a", "b", "a"} {
		if _, err := s.Touch("diego", entry("album", id)); err != nil {
			t.Fatal(err)
		}
	}
	got := s.Get("diego").Recents
	if len(got) != 2 || got[0].ID != "a" || got[1].ID != "b" {
		t.Fatalf("recents = %+v", got)
	}
	// The same ID of another type is another item: an artist and an album can share one in Navidrome
	s.Touch("diego", entry("artist", "a"))
	if n := len(s.Get("diego").Recents); n != 3 {
		t.Fatalf("recents = %d, want 3", n)
	}
}

func TestRecentsAreCapped(t *testing.T) {
	s := &Store{Root: t.TempDir()}
	for i := 0; i < MaxRecents+5; i++ {
		s.Touch("diego", entry("album", "id"+strings.Repeat("x", i)))
	}
	if n := len(s.Get("diego").Recents); n != MaxRecents {
		t.Fatalf("recents = %d, want %d", n, MaxRecents)
	}
}

func TestPinsSurviveForgetAndAreSeparatedByUser(t *testing.T) {
	s := &Store{Root: t.TempDir()}
	s.Touch("diego", entry("song", "s1"))
	s.Pin("diego", entry("song", "s1"))
	s.Forget("diego", "song", "s1")
	st := s.Get("diego")
	if len(st.Recents) != 0 || len(st.Pins) != 1 {
		t.Fatalf("state = %+v", st)
	}
	if n := len(s.Get("someone-else").Pins); n != 0 {
		t.Fatalf("another user sees %d pins", n)
	}
	if n := len(s.Get("DIEGO").Pins); n != 1 {
		t.Fatalf("usernames are case-insensitive in Navidrome, got %d pins", n)
	}
	s.Unpin("diego", "song", "s1")
	if n := len(s.Get("diego").Pins); n != 0 {
		t.Fatalf("pins after unpin = %d", n)
	}
}

func TestForgetEverywhereReachesEveryUser(t *testing.T) {
	s := &Store{Root: t.TempDir()}
	if err := s.ForgetEverywhere("song", "s1"); err != nil {
		t.Fatalf("with nobody stored yet: %v", err)
	}
	for _, user := range []string{"diego", "ana"} {
		s.Pin(user, entry("song", "s1"))
		s.Touch(user, entry("song", "s1"))
		s.Touch(user, entry("album", "s1")) // same ID, another kind of thing: it stays
	}
	if err := s.ForgetEverywhere("song", "s1"); err != nil {
		t.Fatal(err)
	}
	for _, user := range []string{"diego", "ana"} {
		st := s.Get(user)
		if len(st.Pins) != 0 || len(st.Recents) != 1 || st.Recents[0].Type != "album" {
			t.Errorf("%s: %+v", user, st)
		}
	}
}

func TestPinLimit(t *testing.T) {
	s := &Store{Root: t.TempDir()}
	for i := 0; i < maxPins; i++ {
		if _, err := s.Pin("diego", entry("song", "id"+strings.Repeat("x", i%60)+string(rune('a'+i/60)))); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := s.Pin("diego", entry("song", "one-too-many")); err != ErrTooManyPins {
		t.Fatalf("err = %v", err)
	}
}

// A username becomes a folder and a playlist ID a file name: neither may climb out of the root.
func TestPathsCannotEscape(t *testing.T) {
	s := &Store{Root: "/data/users"}
	if d := s.dir("../../etc"); filepath.Dir(d) != "/data/users" {
		t.Errorf("username escaped: %s", d)
	}
	for _, bad := range []string{"", "..", "../x", "a/b", "a b", "a\x00b", strings.Repeat("x", 65)} {
		if ValidID(bad) {
			t.Errorf("ValidID(%q) = true", bad)
		}
	}
	for _, good := range []string{"favorites", "3fa85f64-5717-4562-b3fc-2c963f66afa6", "7kW0cpKgSVsEqcc8xgbSb0"} {
		if !ValidID(good) {
			t.Errorf("ValidID(%q) = false", good)
		}
	}
}

func TestEntryValidate(t *testing.T) {
	if err := entry("album", "a").Validate(); err != nil {
		t.Error(err)
	}
	for _, bad := range []Entry{{Type: "nope", ID: "a", Name: "a"}, {Type: "album", ID: "../a", Name: "a"}, {Type: "album", ID: "a"},
		{Type: "album", ID: "a", Name: "a", CoverURL: "javascript:alert(1)"}} {
		if bad.Validate() == nil {
			t.Errorf("%+v accepted", bad)
		}
	}
}

func TestCoverOnlyAcceptsRealJPEG(t *testing.T) {
	s := &Store{Root: t.TempDir()}
	var buf bytes.Buffer
	jpeg.Encode(&buf, image.NewRGBA(image.Rect(0, 0, 8, 8)), nil)
	if _, err := s.SetCover("diego", "favorites", buf.Bytes()); err != nil {
		t.Fatal(err)
	}
	if s.Get("diego").Covers["favorites"] == 0 {
		t.Fatal("cover version not recorded")
	}
	for name, data := range map[string][]byte{"html": []byte("<script>alert(1)</script>"), "empty": nil, "huge": make([]byte, MaxCoverBytes+1)} {
		if _, err := s.SetCover("diego", "other", data); err == nil {
			t.Errorf("%s accepted", name)
		}
	}
	if _, err := s.RemoveCover("diego", "favorites"); err != nil {
		t.Fatal(err)
	}
	if _, ok := s.Get("diego").Covers["favorites"]; ok {
		t.Fatal("cover still listed after removal")
	}
	if _, err := s.RemoveCover("diego", "never-set"); err != nil {
		t.Fatalf("removing a missing cover: %v", err)
	}
}
