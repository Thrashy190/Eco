package library

import (
	"errors"
	"os"
	"strings"

	"github.com/dhowden/tag"
)

// SongTags is what a file says about its song, read from the file itself: Navidrome's values are for display ("A • B"
// where the tag says "A; B") and cannot be written back.
type SongTags struct {
	Title        string   `json:"title"`
	Artists      []string `json:"artists"`
	Album        string   `json:"album"`
	AlbumArtists []string `json:"album_artists"`
	Date         string   `json:"date"`
	Track        int      `json:"track"`
	Tracks       int      `json:"tracks"` // the total in "3/12", kept when the number changes
	Disc         int      `json:"disc"`
	Genre        string   `json:"genre"`
}

// tagSeparator is tag.Separator (internal/tag): the one Navidrome splits artists on. A comma can be part of a name.
const tagSeparator = "; "

// SplitArtists turns an artist tag into names.
func SplitArtists(value string) []string {
	out := []string{}
	for _, name := range strings.Split(value, tagSeparator) {
		if name = strings.TrimSpace(name); name != "" {
			out = append(out, name)
		}
	}
	return out
}

// ReadSongTags reads the tags of an audio file. The date keeps its month and day.
func ReadSongTags(path string) (SongTags, error) {
	f, err := os.Open(path)
	if err != nil {
		return SongTags{}, err
	}
	defer f.Close()
	md, err := tag.ReadFrom(f)
	if err != nil {
		return SongTags{}, errors.New("could not read the tags of this song's file")
	}
	out := SongTags{Title: md.Title(), Artists: SplitArtists(md.Artist()), Album: md.Album(), AlbumArtists: SplitArtists(md.AlbumArtist()), Genre: md.Genre()}
	out.Track, out.Tracks = md.Track()
	out.Disc, _ = md.Disc()
	_, out.Date = readAlbum(path)
	return out, nil
}
