package library

import (
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strings"

	"github.com/dhowden/tag"

	"github.com/Thrashy190/eco/internal/match"
)

// FindSongFile locates the file of a song Navidrome knows about, in order to delete it. Navidrome's path is
// synthetic, so a song is found by what cannot be made up: the exact size in bytes and extension, confirmed by the
// title in the file's tags. Deleting the wrong file cannot be undone, so anything short of exactly one match is an
// error and nothing should be deleted.
func FindSongFile(root string, size int64, suffix, title string) (string, error) {
	if size <= 0 || suffix == "" || title == "" {
		return "", errors.New("Navidrome gave too little information to identify the file")
	}
	ext := "." + strings.ToLower(suffix)
	var sameSize []string
	err := filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return nil // skip what cannot be read; the search goes on in the rest of the library
		}
		if d.IsDir() {
			// Only eco's scratch folders. A leading dot alone proves nothing: Navidrome does list "...And Justice For All"
			if path != root && strings.HasPrefix(d.Name(), ".eco-") {
				return filepath.SkipDir
			}
			return nil
		}
		if !d.Type().IsRegular() || strings.ToLower(filepath.Ext(path)) != ext {
			return nil
		}
		if info, err := d.Info(); err == nil && info.Size() == size {
			sameSize = append(sameSize, path)
		}
		return nil
	})
	if err != nil {
		return "", err
	}
	var found []string
	for _, path := range sameSize {
		if tagTitle(path) == match.Norm(title) {
			found = append(found, path)
		}
	}
	switch len(found) {
	case 1:
		return found[0], nil
	case 0:
		return "", errors.New("could not find this song's file in the music folder")
	default:
		return "", fmt.Errorf("%d files look like this song", len(found))
	}
}

func tagTitle(path string) string {
	f, err := os.Open(path)
	if err != nil {
		return ""
	}
	defer f.Close()
	md, err := tag.ReadFrom(f)
	if err != nil {
		return ""
	}
	return match.Norm(md.Title())
}

// RemoveEmptyFolders removes the folders left with no music after deleting file, from the deepest up. An album's
// cover goes with its last song, or the folder would stay for ever; any other file stops it there. It never touches
// root or the folder directly inside it (YouTube, Originals…).
func RemoveEmptyFolders(root, file string) {
	root = filepath.Clean(root)
	for dir := filepath.Dir(file); filepath.Dir(dir) != root && strings.HasPrefix(dir, root+string(filepath.Separator)); dir = filepath.Dir(dir) {
		entries, err := os.ReadDir(dir)
		if err != nil {
			return
		}
		for _, e := range entries {
			if !e.Type().IsRegular() || !coverNames[strings.ToLower(e.Name())] {
				return // music, or something eco did not put there
			}
		}
		for _, e := range entries {
			if os.Remove(filepath.Join(dir, e.Name())) != nil {
				return
			}
		}
		if os.Remove(dir) != nil {
			return
		}
	}
}

var coverNames = map[string]bool{"cover.jpg": true, "cover.jpeg": true, "cover.png": true, "folder.jpg": true}
