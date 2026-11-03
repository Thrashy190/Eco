package library

import (
	"os"
	"path/filepath"
	"testing"
)

// id3File writes an MP3-looking file with an ID3v2.3 title tag and the given total size.
func id3File(t *testing.T, path, title string, size int) {
	t.Helper()
	text := append([]byte{0}, []byte(title)...) // encoding byte, then the text
	frame := append([]byte("TIT2"), 0, 0, byte(len(text)>>8), byte(len(text)), 0, 0)
	frame = append(frame, text...)
	n := len(frame)
	data := append([]byte{'I', 'D', '3', 3, 0, 0, byte(n >> 21 & 0x7f), byte(n >> 14 & 0x7f), byte(n >> 7 & 0x7f), byte(n & 0x7f)}, frame...)
	if len(data) > size {
		t.Fatalf("size %d is too small for the tag (%d)", size, len(data))
	}
	data = append(data, make([]byte, size-len(data))...)
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, data, 0o644); err != nil {
		t.Fatal(err)
	}
}

func TestFindSongFile(t *testing.T) {
	root := t.TempDir()
	target := filepath.Join(root, "YouTube", "Pantera", "VDOP", "03 - Walk.mp3")
	id3File(t, target, "Walk", 5000)
	id3File(t, filepath.Join(root, "YouTube", "Other", "Same Size.mp3"), "Something Else", 5000)
	id3File(t, filepath.Join(root, "YouTube", "Pantera", "Other Size.mp3"), "Walk", 6000)

	got, err := FindSongFile(root, 5000, "MP3", "Walk")
	if err != nil || got != target {
		t.Fatalf("got %q, %v", got, err)
	}
}

// Metallica's "...And Justice For All" starts with a dot and Navidrome lists it all the same, so it can be deleted.
func TestFindSongFileLooksInFoldersStartingWithDots(t *testing.T) {
	root := t.TempDir()
	target := filepath.Join(root, "YouTube", "Metallica", "...And Justice For All", "04 - One.mp3")
	id3File(t, target, "One", 5000)
	if got, err := FindSongFile(root, 5000, "mp3", "One"); err != nil || got != target {
		t.Fatalf("got %q, %v", got, err)
	}
}

// Each of these once could have deleted the wrong file, or would if the checks went away.
func TestFindSongFileRefusesWhenNotCertain(t *testing.T) {
	root := t.TempDir()
	id3File(t, filepath.Join(root, "a", "one.mp3"), "Twin", 5000)
	id3File(t, filepath.Join(root, "b", "two.mp3"), "Twin", 5000)
	id3File(t, filepath.Join(root, "c", "three.mp3"), "Lonely", 5000)
	id3File(t, filepath.Join(root, ".eco-123", "audio.mp3"), "Scratch", 7000)
	if err := os.WriteFile(filepath.Join(root, "c", "notes.txt"), make([]byte, 5000), 0o644); err != nil {
		t.Fatal(err)
	}

	cases := []struct {
		name, suffix, title string
		size                int64
	}{
		{"two files match exactly", "mp3", "Twin", 5000},
		{"right size, wrong title", "mp3", "Not This Song", 5000},
		{"right title, wrong size", "mp3", "Lonely", 5001},
		{"right size and title, wrong extension", "m4a", "Lonely", 5000},
		{"a download still in progress", "mp3", "Scratch", 7000},
		{"no size from Navidrome", "mp3", "Lonely", 0},
		{"no title from Navidrome", "mp3", "", 5000},
		{"no extension from Navidrome", "", "Lonely", 5000},
	}
	for _, c := range cases {
		if got, err := FindSongFile(root, c.size, c.suffix, c.title); err == nil {
			t.Errorf("%s: picked %q", c.name, got)
		}
	}
}

// Almost every album folder holds a cover.jpg: without this, deleting a whole album leaves its folder behind.
func TestRemoveEmptyFoldersTakesTheCoverOfTheLastSong(t *testing.T) {
	root := t.TempDir()
	write := func(rel string) string {
		path := filepath.Join(root, rel)
		id3File(t, path, "x", 100)
		return path
	}
	last := write("YouTube/Artist/Album/song.m4a")
	cover := write("YouTube/Artist/Album/cover.jpg")
	os.Remove(last)
	RemoveEmptyFolders(root, last)
	if _, err := os.Stat(cover); !os.IsNotExist(err) {
		t.Error("the cover of an album with no songs left stayed")
	}
	if _, err := os.Stat(filepath.Join(root, "YouTube", "Artist")); !os.IsNotExist(err) {
		t.Error("the empty artist folder stayed")
	}

	// A cover next to other songs stays
	one := write("YouTube/Band/Album/one.m4a")
	two := write("YouTube/Band/Album/two.m4a")
	keptCover := write("YouTube/Band/Album/cover.jpg")
	os.Remove(one)
	RemoveEmptyFolders(root, one)
	if _, err := os.Stat(keptCover); err != nil {
		t.Error("the cover of an album with songs left was removed")
	}
	if _, err := os.Stat(two); err != nil {
		t.Error("another song was removed")
	}

	// Anything eco did not create is left alone, along with the folder
	song := write("Originals/Demo/song.m4a")
	notes := write("Originals/Demo/lyrics.txt")
	demoCover := write("Originals/Demo/cover.jpg")
	os.Remove(song)
	RemoveEmptyFolders(root, song)
	for _, kept := range []string{notes, demoCover} {
		if _, err := os.Stat(kept); err != nil {
			t.Errorf("%s was removed", filepath.Base(kept))
		}
	}
}

func TestRemoveEmptyFolders(t *testing.T) {
	root := t.TempDir()
	song := filepath.Join(root, "YouTube", "Artist", "Album", "song.m4a")
	sibling := filepath.Join(root, "YouTube", "Artist", "Other Album", "song.m4a")
	for _, p := range []string{song, sibling} {
		id3File(t, p, "x", 100)
	}
	os.Remove(song)
	RemoveEmptyFolders(root, song)
	if _, err := os.Stat(filepath.Dir(song)); !os.IsNotExist(err) {
		t.Error("the empty album folder stayed")
	}
	if _, err := os.Stat(sibling); err != nil {
		t.Error("a folder with music in it was removed")
	}

	os.Remove(sibling)
	RemoveEmptyFolders(root, sibling)
	if _, err := os.Stat(filepath.Join(root, "YouTube", "Artist")); !os.IsNotExist(err) {
		t.Error("the empty artist folder stayed")
	}
	if _, err := os.Stat(filepath.Join(root, "YouTube")); err != nil {
		t.Error("the top folder must stay even when empty: docker mounts and Lidarr rely on it")
	}
	RemoveEmptyFolders(root, filepath.Join(root, "song.m4a"))
	if _, err := os.Stat(root); err != nil {
		t.Error("the root was removed")
	}
}
