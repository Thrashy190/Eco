package ytdlp

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// yt-dlp rewrites the cookies file it is given. The original (often a read-only mount) must never be handed to it.
func TestCookieCopyIsPrivateAndRemoved(t *testing.T) {
	orig := filepath.Join(t.TempDir(), "cookies.txt")
	if err := os.WriteFile(orig, []byte("# Netscape HTTP Cookie File\n"), 0o400); err != nil {
		t.Fatal(err)
	}
	r := &Runner{CookiesFile: orig}
	path, done := r.cookieCopy()
	if path == orig || path == "" {
		t.Fatalf("expected a copy, got %q", path)
	}
	if data, _ := os.ReadFile(path); string(data) != "# Netscape HTTP Cookie File\n" {
		t.Fatalf("copy differs: %q", data)
	}
	done()
	if _, err := os.Stat(path); err == nil {
		t.Fatal("the copy was not removed")
	}
}

func TestNoCookiesFileMeansNoCopy(t *testing.T) {
	if path, done := (&Runner{}).cookieCopy(); path != "" {
		t.Fatalf("got %q", path)
	} else {
		done()
	}
}

func TestLastErrorFallsBackToTheLastLine(t *testing.T) {
	err := lastError("Traceback (most recent call last):\nPermissionError: cookies.txt\n", os.ErrInvalid)
	if err == nil || !contains(err.Error(), "PermissionError") {
		t.Fatalf("got %v", err)
	}
	if e := lastError("ERROR: [youtube] x: Sign in to confirm you're not a bot", os.ErrInvalid); !IsBlocked(e) {
		t.Fatalf("a bot check must be recognised, got %v", e)
	}
}

func contains(s, sub string) bool {
	for i := 0; i+len(sub) <= len(s); i++ {
		if s[i:i+len(sub)] == sub {
			return true
		}
	}
	return false
}

// YouTube Music's songs say what they are; any other video says nothing, and its title is no song information.
func TestPreviewMusic(t *testing.T) {
	es := decodeLines([]byte(`{"id":"a","title":"Joji - Ew (Official Video)","track":"Ew","artists":["Joji"],"album":"Nectar","release_year":2020}
{"id":"b","title":"Ew","track":"Ew","artist":"Joji"}
{"id":"c","title":"Joji - Ew (Official Video)","artist":"Joji"}`))
	want := []Music{{Track: "Ew", Artists: []string{"Joji"}, Album: "Nectar", Year: 2020}, {Track: "Ew", Artists: []string{"Joji"}}, {}}
	for i, e := range es {
		got := e.music()
		if got.Track != want[i].Track || strings.Join(got.Artists, "|") != strings.Join(want[i].Artists, "|") || got.Album != want[i].Album || got.Year != want[i].Year {
			t.Errorf("%s: %+v, want %+v", e.ID, got, want[i])
		}
	}
}

// A podcast keeps the uploader's chapters and when it was published; a video without them gives none.
func TestPreviewChaptersAndDate(t *testing.T) {
	es := decodeLines([]byte(`{"id":"a","title":"Ep 1","upload_date":"20240131","chapters":[{"start_time":0,"end_time":90,"title":"Intro"},{"start_time":90,"end_time":300,"title":"Interview"}]}
{"id":"b","title":"Ep 2","upload_date":"bad"}`))
	if len(es[0].Chapters) != 2 || es[0].Chapters[1].Start != 90 || es[0].Chapters[1].Title != "Interview" {
		t.Errorf("chapters = %+v", es[0].Chapters)
	}
	if got := time.Unix(es[0].published(), 0).UTC().Format("2006-01-02"); got != "2024-01-31" {
		t.Errorf("published = %s", got)
	}
	if es[1].published() != 0 || es[1].Chapters != nil {
		t.Errorf("b = %+v", es[1])
	}
}
