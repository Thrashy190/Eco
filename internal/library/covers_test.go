package library

import (
	"bytes"
	"context"
	"image"
	"image/jpeg"
	"os"
	"os/exec"
	"path/filepath"
	"testing"

	"github.com/Thrashy190/eco/internal/catalog"
	ecotag "github.com/Thrashy190/eco/internal/tag"
)

func TestFilesFindsSongsLikeFindSongFile(t *testing.T) {
	dir := t.TempDir()
	ew := catalog.Meta{Title: "Ew", Artist: "Joji", AlbumArtist: "Joji", Album: "Nectar", Track: 1}
	storedSong(t, dir, ew)
	path := DestPath(ew, "m4a", dir)
	info, _ := os.Stat(path)
	files := IndexFiles(dir)
	if got, ok := files.Find(info.Size(), "M4A", "Ew"); !ok || got != path {
		t.Errorf("found %q %v", got, ok)
	}
	if _, ok := files.Find(info.Size()+1, "m4a", "Ew"); ok {
		t.Error("found a file of another size")
	}
	// Two files of the same size: the title decides, and two with the same title are no answer
	twin := filepath.Join(dir, "Joji", "Nectar", "copy.m4a")
	data, _ := os.ReadFile(path)
	os.WriteFile(twin, data, 0o644)
	if _, ok := IndexFiles(dir).Find(info.Size(), "m4a", "Ew"); ok {
		t.Error("chose between two identical files")
	}
}

func TestHasCover(t *testing.T) {
	ffmpeg, err := exec.LookPath("ffmpeg")
	if err != nil {
		t.Skip("ffmpeg is not installed")
	}
	dir := t.TempDir()
	m := catalog.Meta{Title: "Ew", Artist: "Joji", AlbumArtist: "Joji", Album: "Nectar", Track: 1}
	storedSong(t, dir, m)
	path := DestPath(m, "m4a", dir)
	if HasCover(path) {
		t.Fatal("a song with no picture has a cover")
	}
	os.WriteFile(filepath.Join(filepath.Dir(path), "Folder.JPG"), []byte("x"), 0o644)
	if !HasCover(path) {
		t.Error("the folder's picture was not seen")
	}
	os.Remove(filepath.Join(filepath.Dir(path), "Folder.JPG"))

	var picture bytes.Buffer
	jpeg.Encode(&picture, image.NewRGBA(image.Rect(0, 0, 8, 8)), nil)
	if err := ecotag.Write(context.Background(), ffmpeg, path, "m4a", m, picture.Bytes()); err != nil {
		t.Fatal(err)
	}
	if !HasCover(path) {
		t.Error("the picture inside the file was not seen")
	}
}
