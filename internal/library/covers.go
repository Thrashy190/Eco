package library

import (
	"io/fs"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/Thrashy190/eco/internal/match"
	"github.com/dhowden/tag"
)

// Files finds the files of many songs with one walk of the music folder. FindSongFile walks it once per song, which is
// right before deleting one, and far too slow for checking every album of a library.
type Files struct {
	bySize map[string][]string // "<size>.<ext>" → paths
}

func sizeKey(size int64, ext string) string {
	return strconv.FormatInt(size, 10) + "." + strings.ToLower(strings.TrimPrefix(ext, "."))
}

// IndexFiles lists every audio file under root by size and extension. Eco's scratch folders are left out.
func IndexFiles(root string) *Files {
	f := &Files{bySize: map[string][]string{}}
	filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if d.IsDir() {
			if path != root && strings.HasPrefix(d.Name(), ".eco-") {
				return filepath.SkipDir
			}
			return nil
		}
		ext := filepath.Ext(path)
		if !d.Type().IsRegular() || !audioExts[strings.ToLower(ext)] {
			return nil
		}
		if info, err := d.Info(); err == nil {
			key := sizeKey(info.Size(), ext)
			f.bySize[key] = append(f.bySize[key], path)
		}
		return nil
	})
	return f
}

// Find returns the file of a song Navidrome lists, by the same rule as FindSongFile: exact size and extension, and the
// title in its tags when more than one file has that size. The boolean is false unless exactly one file matches.
func (f *Files) Find(size int64, suffix, title string) (string, bool) {
	paths := f.bySize[sizeKey(size, suffix)]
	if len(paths) == 1 {
		return paths[0], true
	}
	found := ""
	for _, path := range paths {
		if tagTitle(path) == match.Norm(title) {
			if found != "" {
				return "", false
			}
			found = path
		}
	}
	return found, found != ""
}

// folderPictures are the names Navidrome looks for next to an album's songs (its CoverArtPriority, before embedded).
var folderPictures = []string{"cover", "folder", "front", "album"}

// HasCover reports whether the album of the song at path has a picture: a cover file in its folder, or one inside the
// file itself.
func HasCover(path string) bool {
	if FolderCover(filepath.Dir(path)) != "" {
		return true
	}
	file, err := os.Open(path)
	if err != nil {
		return false
	}
	defer file.Close()
	md, err := tag.ReadFrom(file)
	return err == nil && md.Picture() != nil && len(md.Picture().Data) > 0
}

// FolderCover returns the cover picture in a folder, or "".
func FolderCover(dir string) string {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return ""
	}
	for _, e := range entries {
		name := strings.ToLower(e.Name())
		ext := filepath.Ext(name)
		if e.Type().IsRegular() && (ext == ".jpg" || ext == ".jpeg" || ext == ".png" || ext == ".webp") {
			for _, want := range folderPictures {
				if strings.TrimSuffix(name, ext) == want {
					return filepath.Join(dir, e.Name())
				}
			}
		}
	}
	return ""
}
