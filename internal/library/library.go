// Package library knows where songs live on disk and which ones are already there.
package library

import (
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"

	"github.com/dhowden/tag"

	"github.com/Thrashy190/eco/internal/catalog"
	"github.com/Thrashy190/eco/internal/match"
)

var (
	reUnsafe  = regexp.MustCompile(`[/\\:*?"<>|]`)
	audioExts = map[string]bool{".m4a": true, ".mp3": true, ".flac": true, ".ogg": true, ".opus": true, ".wav": true, ".aac": true}
)

// Safe turns a title into something usable as a file or folder name.
// Leading dots are dropped: ".5: The Gray Chapter" would become a hidden folder that Navidrome ignores.
func Safe(s string) string {
	s = strings.TrimLeft(strings.TrimSpace(reUnsafe.ReplaceAllString(s, "-")), ". ")
	if s == "" {
		return "Unknown"
	}
	return s
}

// DestPath is where a song goes: <dir>/<album artist>/<album>/NN - <title>.<codec>.
func DestPath(m catalog.Meta, codec, dir string) string {
	prefix := ""
	if m.Track > 0 {
		prefix = pad2(m.Track) + " - "
	}
	return filepath.Join(dir, Safe(m.AlbumArtist), Safe(m.Album), prefix+Safe(m.Title)+"."+codec)
}

func pad2(n int) string {
	s := strconv.Itoa(n)
	if len(s) < 2 {
		return "0" + s
	}
	return s
}

// Index lists the songs found by reading the tags of every audio file under a directory.
type Index struct {
	byTitle map[string][]entry
	root    string
}

type entry struct {
	artists string // normalised artist + album artist
	path    string
}

// Scan reads the tags of every audio file under root. Unreadable files are skipped.
func Scan(root string) *Index {
	idx := &Index{byTitle: map[string][]entry{}, root: root}
	filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() || !audioExts[strings.ToLower(filepath.Ext(path))] {
			return nil
		}
		f, err := os.Open(path)
		if err != nil {
			return nil
		}
		defer f.Close()
		md, err := tag.ReadFrom(f)
		if err != nil || md.Title() == "" {
			return nil
		}
		t := match.Norm(md.Title())
		idx.byTitle[t] = append(idx.byTitle[t], entry{match.Norm(md.Artist() + " " + md.AlbumArtist()), path})
		return nil
	})
	return idx
}

// Find returns the path of a song already on disk with this title and first artist.
func (i *Index) Find(title, artist string) (string, bool) {
	first, _, _ := strings.Cut(artist, ",")
	first = match.Norm(first)
	if first == "" {
		return "", false
	}
	for _, e := range i.byTitle[match.Norm(title)] {
		if strings.Contains(e.artists, first) {
			return e.path, true
		}
	}
	return "", false
}

// Rel makes a path relative to the library root, so state files stay valid when the library moves.
func (i *Index) Rel(path string) string { return Rel(i.root, path) }

// Rel makes path relative to root when it is inside it.
func Rel(root, path string) string {
	if r, err := filepath.Rel(root, path); err == nil && !strings.HasPrefix(r, "..") {
		return r
	}
	return path
}
