package tag

import (
	"bytes"
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/Thrashy190/eco/internal/catalog"
)

// With the index at the end a player must jump there before it can start, one more slow trip for every song.
func TestM4AKeepsItsIndexFirst(t *testing.T) {
	ffmpeg, err := exec.LookPath("ffmpeg")
	if err != nil {
		t.Skip("ffmpeg is not installed")
	}
	path := filepath.Join(t.TempDir(), "song.m4a")
	if out, err := exec.Command(ffmpeg, "-y", "-loglevel", "error", "-f", "lavfi", "-i", "anullsrc=r=44100:cl=mono", "-t", "1", "-c:a", "aac", path).CombinedOutput(); err != nil {
		t.Skipf("ffmpeg cannot make a test file: %s", out)
	}
	if err := Write(context.Background(), ffmpeg, path, "m4a", catalog.Meta{Title: "One", Artist: "Someone"}, nil); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	moov, mdat := bytes.Index(data, []byte("moov")), bytes.Index(data, []byte("mdat"))
	if moov < 0 || mdat < 0 || moov > mdat {
		t.Fatalf("moov at %d, mdat at %d", moov, mdat)
	}
}

func makeSong(t *testing.T, ffmpeg string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "song.m4a")
	if out, err := exec.Command(ffmpeg, "-y", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=1", "-c:a", "aac",
		"-metadata", "title=Infeliz", "-metadata", "artist=Arcángel, Bad Bunny", "-metadata", "album_artist=Arcángel", "-metadata", "album=Historias", path).CombinedOutput(); err != nil {
		t.Skipf("ffmpeg cannot make a test file: %s", out)
	}
	return path
}

func tagsOf(t *testing.T, path string) string {
	t.Helper()
	ffprobe, err := exec.LookPath("ffprobe")
	if err != nil {
		t.Skip("ffprobe is not installed")
	}
	out, err := exec.Command(ffprobe, "-v", "error", "-of", "default=nw=1", "-show_entries", "format_tags=title,artist,album_artist,album,genre,date,track,disc", path).Output()
	if err != nil {
		t.Fatal(err)
	}
	return string(out)
}

// Navidrome makes two artists of "Arcángel; Bad Bunny", and one of "Arcángel, Bad Bunny".
func TestSetArtistsChangesOnlyThatTag(t *testing.T) {
	ffmpeg, err := exec.LookPath("ffmpeg")
	if err != nil {
		t.Skip("ffmpeg is not installed")
	}
	ctx := context.Background()
	path := makeSong(t, ffmpeg)
	original, _ := os.ReadFile(path)
	before, err := audioHash(ctx, ffmpeg, path)
	if err != nil {
		t.Fatal(err)
	}
	backup := filepath.Join(t.TempDir(), "backup", "folder", "song.m4a")
	if err := SetArtists(ctx, ffmpeg, path, "Arcángel"+Separator+"Bad Bunny", "", backup); err != nil {
		t.Fatal(err)
	}
	tags := tagsOf(t, path)
	for _, want := range []string{"artist=Arcángel; Bad Bunny", "album_artist=Arcángel", "title=Infeliz", "album=Historias"} {
		if !strings.Contains(strings.ToLower(tags), strings.ToLower(want)) {
			t.Errorf("%q not in:\n%s", want, tags)
		}
	}
	after, err := audioHash(ctx, ffmpeg, path)
	if err != nil {
		t.Fatal(err)
	}
	if before != after {
		t.Error("the audio changed")
	}
	saved, err := os.ReadFile(backup)
	if err != nil || !bytes.Equal(saved, original) {
		t.Errorf("the backup is not the original file (%v)", err)
	}
	left, _ := filepath.Glob(filepath.Join(filepath.Dir(path), ".eco-*"))
	if len(left) != 0 {
		t.Errorf("left behind: %v", left)
	}
}

func TestSetArtistsLeavesTheFileAloneWhenItCannotWorkOnIt(t *testing.T) {
	path := filepath.Join(t.TempDir(), "song.m4a")
	os.WriteFile(path, []byte("not audio"), 0o644)
	ffmpeg, err := exec.LookPath("ffmpeg")
	if err != nil {
		t.Skip("ffmpeg is not installed")
	}
	if err := SetArtists(context.Background(), ffmpeg, path, "A; B", "", filepath.Join(t.TempDir(), "b.m4a")); err == nil {
		t.Fatal("expected an error")
	}
	if data, _ := os.ReadFile(path); string(data) != "not audio" {
		t.Error("the file was changed")
	}
}

func TestSeveralArtistsAreWrittenSoNavidromeSeparatesThem(t *testing.T) {
	got := fields(catalog.Meta{Title: "x", Artist: "Tyler, The Creator, Frank Ocean", Artists: []string{"Tyler, The Creator", "Frank Ocean"}, AlbumArtist: "Tyler, The Creator", AlbumArtists: []string{"Tyler, The Creator"}})
	if got["artist"] != "Tyler, The Creator; Frank Ocean" || got["album_artist"] != "Tyler, The Creator" {
		t.Errorf("got %+v", got)
	}
	// A CSV row has one string: nobody knows whether its comma separates artists, so it stays
	if got := fields(catalog.Meta{Artist: "Bad Bunny, Chuwi"}); got["artist"] != "Bad Bunny, Chuwi" {
		t.Errorf("got %q", got["artist"])
	}
}

// Editing a song by hand: what changes is written, an empty value takes the tag away, and the rest stays.
func TestSetChangesAndRemovesTags(t *testing.T) {
	ffmpeg, err := exec.LookPath("ffmpeg")
	if err != nil {
		t.Skip("ffmpeg is not installed")
	}
	ctx := context.Background()
	path := makeSong(t, ffmpeg)
	before, err := audioHash(ctx, ffmpeg, path)
	if err != nil {
		t.Fatal(err)
	}
	backup := filepath.Join(t.TempDir(), "song.m4a")
	if err := Set(ctx, ffmpeg, path, map[string]string{"artist": "Calle 13", "album_artist": "Calle 13", "genre": "Hip hop", "album": ""}, backup); err != nil {
		t.Fatal(err)
	}
	tags := strings.ToLower(tagsOf(t, path))
	for _, want := range []string{"artist=calle 13", "album_artist=calle 13", "genre=hip hop", "title=infeliz"} {
		if !strings.Contains(tags, want) {
			t.Errorf("%q not in:\n%s", want, tags)
		}
	}
	if strings.Contains(tags, "album=") {
		t.Errorf("the album is still there:\n%s", tags)
	}
	if after, _ := audioHash(ctx, ffmpeg, path); after != before {
		t.Error("the audio changed")
	}
	if _, err := os.Stat(backup); err != nil {
		t.Errorf("no backup: %v", err)
	}
}
