package library

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"testing"

	"github.com/Thrashy190/eco/internal/catalog"
	ecotag "github.com/Thrashy190/eco/internal/tag"
)

// storedSong writes a real tagged M4A where Eco would keep it.
func storedSong(t *testing.T, dir string, m catalog.Meta) {
	t.Helper()
	ffmpeg, err := exec.LookPath("ffmpeg")
	if err != nil {
		t.Skip("ffmpeg is not installed")
	}
	path := DestPath(m, "m4a", dir)
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if out, err := exec.Command(ffmpeg, "-y", "-loglevel", "error", "-f", "lavfi", "-i", "anullsrc=r=44100:cl=mono", "-t", "1", "-c:a", "aac", path).CombinedOutput(); err != nil {
		t.Skipf("ffmpeg cannot make a test file: %s", out)
	}
	if err := ecotag.Write(context.Background(), ffmpeg, path, "m4a", m, nil); err != nil {
		t.Fatal(err)
	}
}

// Sanctuary was dated 2020-09-24 and the rest of Nectar 2020-09-25, and Navidrome showed two albums called Nectar.
func TestJoinAlbumKeepsTheDateOnDisk(t *testing.T) {
	dir := t.TempDir()
	storedSong(t, dir, catalog.Meta{Title: "Ew", Artist: "Joji", AlbumArtist: "Joji", Album: "Nectar", Date: "2020-09-25", Track: 1})
	got := JoinAlbum(catalog.Meta{Title: "Sanctuary", Artist: "Joji", AlbumArtist: "Joji", Album: "Nectar", Date: "2020-09-24", Track: 8}, dir)
	if got.Date != "2020-09-25" {
		t.Errorf("date = %q", got.Date)
	}
	if got.Title != "Sanctuary" || got.Track != 8 {
		t.Errorf("changed the song itself: %+v", got)
	}
}

// Plan B's two songs were dated 2010-07-20 and 2010, which made two albums, and spelled "House of Pleasure" and
// "House Of Pleasure", which made two folders.
func TestJoinAlbumKeepsTheSpellingOnDisk(t *testing.T) {
	dir := t.TempDir()
	storedSong(t, dir, catalog.Meta{Title: "Por Que Te Demoras", Artist: "Plan B", AlbumArtist: "Plan B", Album: "House of Pleasure", Date: "2010-01-01", Track: 3})
	song := catalog.Meta{Title: "Es un Secreto", Artist: "Plan B", AlbumArtist: "Plan B", Album: "House Of Pleasure", Date: "2010-06-01", Track: 6}
	got := JoinAlbum(song, dir)
	if got.Album != "House of Pleasure" || got.Date != "2010-01-01" {
		t.Errorf("got %q %q", got.Album, got.Date)
	}
	if folder := filepath.Dir(DestPath(got, "m4a", dir)); filepath.Base(folder) != "House of Pleasure" {
		t.Errorf("would go to the folder %q", folder)
	}
}

func TestJoinAlbumFollowsMostOfTheAlbum(t *testing.T) {
	dir := t.TempDir()
	album := catalog.Meta{Artist: "Slayer", AlbumArtist: "Slayer", Album: "Repentless"}
	for i, one := range []struct{ title, date string }{{"Repentless", "2015-06-19"}, {"Take Control", "2015-09-11"}, {"Vices", "2015-09-11"}} {
		song := album
		song.Title, song.Date, song.Track = one.title, one.date, i+1
		storedSong(t, dir, song)
	}
	song := album
	song.Title, song.Date, song.Track = "Cast the First Stone", "2015-06-19", 4
	if got := JoinAlbum(song, dir); got.Date != "2015-09-11" {
		t.Errorf("date = %q", got.Date)
	}
}

func TestJoinAlbumLeavesOtherSongsAlone(t *testing.T) {
	dir := t.TempDir()
	storedSong(t, dir, catalog.Meta{Title: "Ew", Artist: "Joji", AlbumArtist: "Joji", Album: "Nectar", Date: "2020-09-25", Track: 1})
	for name, song := range map[string]catalog.Meta{
		"another album by the artist":         {Title: "Glimpse", Artist: "Joji", AlbumArtist: "Joji", Album: "Smithereens", Date: "2022-11-04"},
		"the same album name by someone else": {Title: "Honey", Artist: "Someone", AlbumArtist: "Someone", Album: "Nectar", Date: "1999-01-01"},
	} {
		if got := JoinAlbum(song, dir); got.Album != song.Album || got.Date != song.Date {
			t.Errorf("%s: changed to %q %q", name, got.Album, got.Date)
		}
	}
}

// Reading must never stop a download: a folder holding nothing readable leaves the song as the catalogue said.
func TestJoinAlbumWithNothingToRead(t *testing.T) {
	dir := t.TempDir()
	folder := filepath.Join(dir, "Joji", "Nectar")
	if err := os.MkdirAll(folder, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(folder, "01 - Ew.m4a"), []byte("not audio"), 0o644); err != nil {
		t.Fatal(err)
	}
	song := catalog.Meta{Title: "Run", Artist: "Joji", AlbumArtist: "Joji", Album: "Nectar", Date: "2020-09-25"}
	if got := JoinAlbum(song, dir); got.Album != "Nectar" || got.Date != "2020-09-25" {
		t.Errorf("got %q %q", got.Album, got.Date)
	}
}
