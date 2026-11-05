package library

import (
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"

	"github.com/Thrashy190/eco/internal/catalog"
	"github.com/dhowden/tag"
)

// JoinAlbum makes a song about to be stored agree with the copy of its album already on disk. Navidrome counts the release
// date as part of what makes an album one album, and songs are looked up one by one: the catalogue can date a single apart
// from its album, and the album comes apart. A different spelling ("House Of Pleasure", "House of Pleasure") would also make
// a second folder. What is on disk wins, so downloading never splits an album you have. If nothing can be read, the song
// keeps what the catalogue said.
func JoinAlbum(m catalog.Meta, dir string) catalog.Meta {
	artistDir := filepath.Join(dir, Safe(m.AlbumArtist))
	entries, err := os.ReadDir(artistDir)
	if err != nil {
		return m
	}
	wanted := Safe(m.Album)
	folders := []string{}
	for _, e := range entries {
		if e.IsDir() && strings.EqualFold(e.Name(), wanted) {
			folders = append(folders, e.Name())
		}
	}
	// The folder spelled exactly as the catalogue spells it first, then always in the same order
	sort.Slice(folders, func(a, b int) bool {
		if exactA, exactB := folders[a] == wanted, folders[b] == wanted; exactA != exactB {
			return exactA
		}
		return folders[a] < folders[b]
	})
	for _, folder := range folders {
		album, date := albumOnDisk(filepath.Join(artistDir, folder))
		if album == "" || !strings.EqualFold(Safe(album), wanted) {
			continue
		}
		m.Album = album
		if date != "" {
			m.Date = date
		}
		return m
	}
	return m
}

// albumOnDisk reads how the songs in a folder name and date their album. If they disagree, most of them are right.
func albumOnDisk(folder string) (album, date string) {
	entries, err := os.ReadDir(folder)
	if err != nil {
		return "", ""
	}
	albums, dates := map[string]int{}, map[string]int{}
	for _, e := range entries {
		if e.IsDir() || !audioExts[strings.ToLower(filepath.Ext(e.Name()))] {
			continue
		}
		name, when := readAlbum(filepath.Join(folder, e.Name()))
		if name != "" {
			albums[name]++
		}
		if when != "" {
			dates[when]++
		}
	}
	return mostCommon(albums), mostCommon(dates)
}

func readAlbum(path string) (album, date string) {
	f, err := os.Open(path)
	if err != nil {
		return "", ""
	}
	defer f.Close()
	md, err := tag.ReadFrom(f)
	if err != nil {
		return "", ""
	}
	// Year() would lose the month and day, and those are what separated Nectar from its own song
	if day, ok := md.Raw()["\xa9day"].(string); ok && day != "" {
		return md.Album(), day
	}
	if md.Year() > 0 {
		return md.Album(), strconv.Itoa(md.Year())
	}
	return md.Album(), ""
}

func mostCommon(counts map[string]int) string {
	best := ""
	for value, n := range counts {
		if n > counts[best] || (n == counts[best] && (best == "" || value < best)) {
			best = value
		}
	}
	return best
}
