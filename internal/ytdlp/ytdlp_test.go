package ytdlp

import (
	"os"
	"path/filepath"
	"testing"
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
